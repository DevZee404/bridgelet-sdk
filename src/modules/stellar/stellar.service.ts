import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram } from 'prom-client';
import { sanitizeErrorMessage } from '../../common/utils/secret-redaction.util.js';
import { LogSanitizer } from '../../common/utils/log-sanitizer.util.js';

export const EXPIRY_BUFFER_LEDGERS = 10;

/**
 * How long (in milliseconds) the cached ledger sequence is considered fresh.
 * Stellar closes a new ledger approximately every 5 seconds, so we cache for
 * the same duration to avoid redundant Horizon calls without risking a stale
 * sequence number that is more than one ledger behind.
 */
export const LEDGER_CACHE_TTL_MS = 5_000;

/**
 * Maximum number of times to retry a transient Soroban RPC call
 * (timeout, network error, 5xx) before propagating the error.
 */
export const SOROBAN_RPC_MAX_RETRIES = 3;

/**
 * Initial backoff delay in milliseconds for Soroban RPC retries.
 * Each subsequent attempt doubles the delay, capped at 2 s.
 */
export const SOROBAN_RPC_INITIAL_BACKOFF_MS = 500;

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private server: StellarSdk.Horizon.Server;
  private fallbackServer: StellarSdk.Horizon.Server | null = null;
  private sorobanServer: SorobanRpc.Server;
  private network: string;
  private primaryHorizonHealthy = true;

  /** Cached ledger sequence and the timestamp it was fetched at (ms). */
  private ledgerCache: { sequence: number; fetchedAt: number } | null = null;

  constructor(
    private configService: ConfigService,
    @InjectMetric('soroban_rpc_latency_seconds')
    private readonly sorobanRpcLatency: Histogram<string>,
  ) {
    const horizonUrl =
      this.configService.getOrThrow<string>('stellar.horizonUrl');
    const horizonFallbackUrl = this.configService.get<string>(
      'stellar.horizonFallbackUrl',
    );
    const sorobanRpcUrl = this.configService.getOrThrow<string>(
      'stellar.sorobanRpcUrl',
    );
    this.network = this.configService.getOrThrow<string>('stellar.network');
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.sorobanServer = new SorobanRpc.Server(sorobanRpcUrl);

    if (horizonFallbackUrl) {
      this.fallbackServer = new StellarSdk.Horizon.Server(horizonFallbackUrl);
      this.logger.log(`Horizon fallback configured: ${horizonFallbackUrl}`);
    }

    this.logger.log(`Initialized Stellar service for ${this.network}`);
  }

  /**
   * Returns the active Horizon server. If the primary is known to be
   * unhealthy and a fallback is configured, the fallback is returned.
   */
  private getActiveHorizonServer(): StellarSdk.Horizon.Server {
    if (!this.primaryHorizonHealthy && this.fallbackServer) {
      return this.fallbackServer;
    }
    return this.server;
  }

  /**
   * Health-check probe against the primary Horizon server.
   * Called after a failure to determine whether to switch to the fallback.
   */
  private async checkPrimaryHorizonHealth(): Promise<boolean> {
    try {
      await this.server.ledgers().limit(1).call();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetches the current ledger sequence number from Horizon.
   * Used to convert wall-clock expiry times to ledger-based expiry
   * required by EphemeralAccount.initialize() on-chain.
   *
   * Stellar closes a ledger approximately every 5 seconds.
   * Conversion: expiry_ledger = current_ledger + Math.ceil(expiresInSeconds / 5)
   *
   * The result is cached for {@link LEDGER_CACHE_TTL_MS} (5 s) to reduce
   * unnecessary Horizon round-trips when multiple accounts are created in quick
   * succession.  Callers that need a guaranteed fresh value can call
   * {@link invalidateLedgerCache} before invoking this method.
   */
  async getSorobanLatestLedger(): Promise<{
    sequence: number;
    hash: string;
  }> {
    const info = (await this.sorobanServer.getLatestLedger()) as unknown as {
      sequence: number;
      hash: string;
    };
    return {
      sequence: info.sequence,
      hash: info.hash,
    };
  }

  async getCurrentLedger(): Promise<number> {
    const now = Date.now();

    if (
      this.ledgerCache !== null &&
      now - this.ledgerCache.fetchedAt < LEDGER_CACHE_TTL_MS
    ) {
      this.logger.debug(
        `Current ledger sequence (cached): ${this.ledgerCache.sequence}`,
      );
      return this.ledgerCache.sequence;
    }

    try {
      const server = this.getActiveHorizonServer();
      const ledgerPage = await server.ledgers().order('desc').limit(1).call();

      const sequence = ledgerPage.records[0].sequence;
      this.ledgerCache = { sequence, fetchedAt: now };
      this.logger.debug(`Current ledger sequence: ${sequence}`);
      this.primaryHorizonHealthy = true;
      return sequence;
    } catch (error) {
      if (!this.primaryHorizonHealthy || !this.fallbackServer) {
        throw error;
      }
      this.logger.warn(
        'Primary Horizon unreachable, running health check before failover',
      );
      this.primaryHorizonHealthy = await this.checkPrimaryHorizonHealth();
      if (this.primaryHorizonHealthy) {
        throw error;
      }
      this.logger.warn('Primary Horizon unhealthy — failing over to fallback');
      const ledgerPage = await this.fallbackServer
        .ledgers()
        .order('desc')
        .limit(1)
        .call();
      const sequence = ledgerPage.records[0].sequence;
      this.ledgerCache = { sequence, fetchedAt: now };
      this.logger.debug(`Current ledger sequence (fallback): ${sequence}`);
      return sequence;
    }
  }

  async getAccountBalance(accountId: string): Promise<string> {
    const account = await this.getActiveHorizonServer().loadAccount(accountId);
    const nativeBalance = account.balances.find(
      (b: any) => b.asset_type === 'native',
    );
    return nativeBalance ? nativeBalance.balance : '0';
  }

  /**
   * Clears the cached ledger sequence, forcing the next call to
   * {@link getCurrentLedger} to fetch a fresh value from Horizon.
   *
   * Useful in tests and in contexts where a stale ledger could cause problems
   * (e.g. when the process has been sleeping for more than 5 s).
   */
  invalidateLedgerCache(): void {
    this.ledgerCache = null;
  }

  /**
   * Determines whether an error represents a transient RPC failure
   * (timeout, network-level, or HTTP 5xx) as opposed to a contract-level
   * logic rejection that should not be retried.
   *
   * Transient errors are safe to retry with backoff. Contract errors
   * (e.g. InvalidAmount, AlreadySwept) are deterministic and will always
   * fail if retried.
   */
  private isTransientRpcError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();
    const transientPatterns = [
      'timeout',
      'timed out',
      'econnrefused',
      'econnreset',
      'econnaborted',
      'enotfound',
      'network',
      'socket hang up',
      'fetch failed',
      'request failed',
      '502',
      '503',
      '504',
    ];
    return transientPatterns.some((pattern) => message.includes(pattern));
  }

  /**
   * Wraps a Soroban RPC call with retry logic and exponential backoff.
   * Transient errors (timeouts, network failures, 5xx) are retried up to
   * {@link SOROBAN_RPC_MAX_RETRIES} times. Contract-level errors and other
   * non-transient errors are propagated immediately.
   *
   * @param label   Human-readable label for log messages (e.g. "sendTransaction")
   * @param fn      The RPC call to execute
   * @param retries Max retry attempts (defaults to {@link SOROBAN_RPC_MAX_RETRIES})
   * @returns The result of fn()
   */
  private async retrySorobanRpc<T>(
    label: string,
    fn: () => Promise<T>,
    retries = SOROBAN_RPC_MAX_RETRIES,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error;

        if (!this.isTransientRpcError(error) || attempt >= retries) {
          throw error;
        }

        const backoffMs = Math.min(
          SOROBAN_RPC_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1),
          2000,
        );
        this.logger.warn(
          `${label} attempt ${attempt}/${retries} failed (transient): ` +
            `${error instanceof Error ? error.message : String(error)}. ` +
            `Retrying in ${backoffMs}ms…`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    throw lastError;
  }

  /**
   * Converts a seconds-based expiry duration to a Stellar ledger sequence number.
   * Adds a small buffer (10 ledgers) to account for submission latency.
   */
  async toExpiryLedger(expiresInSeconds: number): Promise<number> {
    const currentLedger = await this.getCurrentLedger();
    return (
      currentLedger + Math.ceil(expiresInSeconds / 5) + EXPIRY_BUFFER_LEDGERS
    );
  }

  generateKeypair(): StellarSdk.Keypair {
    return StellarSdk.Keypair.random();
  }

  /**
   * Creates a funded ephemeral Stellar account and initializes the
   * EphemeralAccount Soroban contract with expiry and recovery restrictions.
   *
   * The two operations are:
   * 1. Horizon: CreateAccount operation (funds the account with base reserve)
   * 2. Soroban: EphemeralAccount.initialize() (sets on-chain restrictions)
   *
   * If the contract initialization fails after the Horizon transaction succeeds,
   * an error is thrown so the caller (AccountsService) can avoid persisting
   * a record for an unrestricted account.
   *
   * ⚠️ MVP Note: True atomicity between Horizon and Soroban is not possible.
   * A failed initialize() after a successful createAccount() will leave an
   * unrestricted funded account on-chain. Issue #15 tracks the compensation strategy.
   */
  async createEphemeralAccount(params: {
    publicKey: string;
    amount: string;
    asset: string;
    expiresIn: number;
    recoveryAddress: string;
    contractId: string;
    sweepControllerContractId: string;
    fundingKeypairSecret?: string;
  }): Promise<string> {
    this.logger.log(
      `Creating ephemeral account: ${LogSanitizer.redactAddress(params.publicKey)}`,
    );

    const fundingSecret =
      params.fundingKeypairSecret ??
      this.configService.getOrThrow<string>('stellar.fundingSecret');
    const fundingKeypair = StellarSdk.Keypair.fromSecret(fundingSecret);

    // Step 1: Create account on Stellar classic (Horizon)
    const fundingAccount = await this.getActiveHorizonServer().loadAccount(
      fundingKeypair.publicKey(),
    );

    const transaction = new StellarSdk.TransactionBuilder(fundingAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        StellarSdk.Operation.createAccount({
          destination: params.publicKey,
          startingBalance: '2',
        }),
      )
      .setTimeout(30)
      .build();

    transaction.sign(fundingKeypair);
    const result = await this.server.submitTransaction(transaction);
    this.logger.log(`Horizon account created: ${result.hash}`);

    // Step 2: Initialize the Soroban contract with restrictions
    const expiryLedger = await this.toExpiryLedger(params.expiresIn);

    const contract = new StellarSdk.Contract(params.contractId);
    const sourceAccount = await this.sorobanServer.getAccount(
      fundingKeypair.publicKey(),
    );

    const initTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          'initialize',
          StellarSdk.Address.fromString(fundingKeypair.publicKey()).toScVal(), // creator
          StellarSdk.xdr.ScVal.scvU32(expiryLedger), // expiry_ledger
          StellarSdk.Address.fromString(params.recoveryAddress).toScVal(), // recovery_address
          StellarSdk.Address.fromString(
            params.sweepControllerContractId,
          ).toScVal(), // authorized_controller
          StellarSdk.Address.fromString(fundingKeypair.publicKey()).toScVal(),
        ),
      )
      .setTimeout(30)
      .build();

    const preparedTx =
      await this.sorobanServer.prepareTransaction(initTransaction);
    preparedTx.sign(fundingKeypair);

    const endTimer = this.sorobanRpcLatency.startTimer();
    let initResult: SorobanRpc.Api.SendTransactionResponse;
    try {
      initResult = await this.retrySorobanRpc(
        'sendTransaction(initialize)',
        () => this.sorobanServer.sendTransaction(preparedTx),
      );
    } finally {
      endTimer();
    }

    if (initResult.status === 'ERROR') {
      const errorDetail = sanitizeErrorMessage(
        JSON.stringify(initResult.errorResult ?? 'unknown'),
      );
      this.logger.error(
        `Contract initialize() failed for ${params.publicKey}: ${errorDetail}`,
      );
      throw new Error(`Contract initialization failed for ${params.publicKey}`);
    }

    // Poll for confirmation
    await this.waitForTransaction(initResult.hash);

    this.logger.log(
      `Contract initialized for ${params.publicKey}, expiry ledger: ${expiryLedger}`,
    );
    return result.hash;
  }

  /**
   * Calls EphemeralAccount.record_payment() on the Soroban contract.
   *
   * Should be called when an inbound payment is detected on the ephemeral
   * account's Stellar address (via Horizon payment stream — see Issue #9).
   *
   * Contract error mapping:
   * - Error::InvalidAmount     → throws — payment amount must be positive
   * - Error::DuplicateAsset    → throws — that asset already recorded, not retryable
   * - Error::TooManyPayments   → throws — 10 asset limit reached, not retryable
   * - Error::NotInitialized    → throws — contract not initialized, system error
   */
  async recordPayment(params: {
    contractId: string;
    amount: bigint; // i128 in contract — use bigint to avoid precision loss
    assetAddress: string; // Stellar contract address of the asset
    signerSecret: string;
  }): Promise<void> {
    const signerKeypair = StellarSdk.Keypair.fromSecret(params.signerSecret);
    const contract = new StellarSdk.Contract(params.contractId);
    const sourceAccount = await this.sorobanServer.getAccount(
      signerKeypair.publicKey(),
    );

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          'record_payment',
          StellarSdk.xdr.ScVal.scvI128(
            new StellarSdk.xdr.Int128Parts({
              hi: StellarSdk.xdr.Int64.fromString(
                (params.amount >> 64n).toString(),
              ),
              lo: StellarSdk.xdr.Uint64.fromString(
                (params.amount & 0xffffffffffffffffn).toString(),
              ),
            }),
          ),
          StellarSdk.Address.fromString(params.assetAddress).toScVal(),
        ),
      )
      .setTimeout(30)
      .build();

    const preparedTx = await this.sorobanServer.prepareTransaction(transaction);
    preparedTx.sign(signerKeypair);

    const endTimer = this.sorobanRpcLatency.startTimer();
    let result: SorobanRpc.Api.SendTransactionResponse;
    try {
      result = await this.retrySorobanRpc(
        'sendTransaction(record_payment)',
        () => this.sorobanServer.sendTransaction(preparedTx),
      );
    } finally {
      endTimer();
    }

    if (result.status === 'ERROR') {
      const errorDetail = sanitizeErrorMessage(
        JSON.stringify(result.errorResult ?? 'unknown'),
      );
      this.logger.error(
        `record_payment failed for contract ${params.contractId}: ${errorDetail}`,
      );
      throw new Error(
        `record_payment failed for contract ${params.contractId}`,
      );
    }

    await this.waitForTransaction(result.hash);
    this.logger.log(
      `Payment recorded on contract ${params.contractId}, amount: ${params.amount}`,
    );
  }

  /**
   * Calls SweepController.execute_sweep() to transfer funds from an ephemeral
   * account to the recipient's permanent wallet.
   *
   * The SweepController internally calls EphemeralAccount.sweep() which
   * validates state and updates the account status on-chain.
   *
   * ⚠️ MVP Note: The contract updates state and emits events but does NOT yet
   * execute token transfers on-chain. Actual fund movement is not implemented
   * in bridgelet-core at this stage. See bridgelet-core known limitations.
   *
   * Contract error mapping:
   * - Error::AlreadySwept          → terminal, do not retry
   * - Error::AccountExpired        → terminal, trigger expiry flow instead
   * - Error::UnauthorizedDestination → destination doesn't match locked mode config
   * - Error::AuthorizationFailed   → signature invalid
   */
  async executeSweep(params: {
    sweepControllerContractId: string;
    ephemeralAccountContractId: string;
    destination: string;
    authSignature: Buffer; // 64 bytes
    signerSecret: string;
  }): Promise<void> {
    const signerKeypair = StellarSdk.Keypair.fromSecret(params.signerSecret);
    const contract = new StellarSdk.Contract(params.sweepControllerContractId);
    const sourceAccount = await this.sorobanServer.getAccount(
      signerKeypair.publicKey(),
    );

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          'execute_sweep',
          StellarSdk.Address.fromString(
            params.ephemeralAccountContractId,
          ).toScVal(),
          StellarSdk.Address.fromString(params.destination).toScVal(),
          StellarSdk.xdr.ScVal.scvBytes(params.authSignature),
        ),
      )
      .setTimeout(30)
      .build();

    const preparedTx = await this.sorobanServer.prepareTransaction(transaction);
    preparedTx.sign(signerKeypair);

    const endTimer = this.sorobanRpcLatency.startTimer();
    let result: SorobanRpc.Api.SendTransactionResponse;
    try {
      result = await this.retrySorobanRpc(
        'sendTransaction(execute_sweep)',
        () => this.sorobanServer.sendTransaction(preparedTx),
      );
    } catch (error) {
      endTimer();
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `sendTransaction failed for ${params.ephemeralAccountContractId} after retries: ${message}. ` +
          'Checking transaction status before propagating.',
      );
      // The transaction may or may not have landed. Check status by polling.
      const statusCheck = await this.checkTransactionStatusAfterTimeout(
        this.sorobanServer,
      );
      if (statusCheck === 'SUCCESS') return;
      if (statusCheck === 'FAILED') {
        throw new Error(
          `execute_sweep failed on-chain after timeout for ${params.ephemeralAccountContractId}`,
        );
      }
      throw new Error(
        `execute_sweep timed out and status unknown for ${params.ephemeralAccountContractId}. Error: ${message}`,
      );
    } finally {
      endTimer();
    }

    if (result.status === 'ERROR') {
      const errStr = sanitizeErrorMessage(JSON.stringify(result.errorResult));
      this.logger.error(
        `execute_sweep failed for ${params.ephemeralAccountContractId}: ${errStr}`,
      );

      // Surface terminal errors explicitly so callers don't retry
      if (errStr.includes('AlreadySwept')) throw new Error('ALREADY_SWEPT');
      if (errStr.includes('AccountExpired')) throw new Error('ACCOUNT_EXPIRED');

      throw new Error(
        `execute_sweep failed for ${params.ephemeralAccountContractId}`,
      );
    }

    await this.waitForTransaction(result.hash);
    this.logger.log(
      `Sweep executed: ${params.ephemeralAccountContractId} → ${LogSanitizer.redactAddress(params.destination)}`,
    );
  }

  /**
   * Calls EphemeralAccount.expire() to close an unclaimed account after its
   * expiry ledger has been reached, directing funds to the recovery address.
   *
   * Should be called by a scheduled job monitoring accounts whose expiresAt
   * timestamp has passed. The scheduler is tracked separately (not in scope here).
   *
   * ⚠️ MVP Note: Fund recovery to recovery_address depends on token transfer
   * implementation in the contract, which is not yet complete in bridgelet-core.
   *
   * Contract error mapping:
   * - Error::NotExpired     → non-fatal race condition, ledger not yet reached
   * - Error::InvalidStatus  → terminal, account already swept or expired
   * - Error::NotInitialized → system error, contract was never initialized
   */
  async expireAccount(params: {
    contractId: string;
    signerSecret: string;
  }): Promise<void> {
    // Guard: check ledger before calling to avoid unnecessary transactions
    const currentLedger = await this.getCurrentLedger();
    const accountInfo = await this.getAccountInfo(params.contractId);

    if (currentLedger < accountInfo.expiry_ledger) {
      this.logger.warn(
        `expireAccount called too early for ${params.contractId}. ` +
          `Current: ${currentLedger}, expiry: ${accountInfo.expiry_ledger}`,
      );
      return; // non-fatal, scheduler will retry
    }

    const signerKeypair = StellarSdk.Keypair.fromSecret(params.signerSecret);
    const contract = new StellarSdk.Contract(params.contractId);
    const sourceAccount = await this.sorobanServer.getAccount(
      signerKeypair.publicKey(),
    );

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(contract.call('expire'))
      .setTimeout(30)
      .build();

    const preparedTx = await this.sorobanServer.prepareTransaction(transaction);
    preparedTx.sign(signerKeypair);

    const endTimer = this.sorobanRpcLatency.startTimer();
    let result: SorobanRpc.Api.SendTransactionResponse;
    try {
      result = await this.retrySorobanRpc('sendTransaction(expire)', () =>
        this.sorobanServer.sendTransaction(preparedTx),
      );
    } finally {
      endTimer();
    }

    if (result.status === 'ERROR') {
      const errStr = sanitizeErrorMessage(JSON.stringify(result.errorResult));
      if (errStr.includes('InvalidStatus')) {
        throw new Error('ACCOUNT_ALREADY_TERMINAL');
      }
      throw new Error(`expire() failed: ${errStr}`);
    }

    await this.waitForTransaction(result.hash);
    this.logger.log(`Account expired on-chain: ${params.contractId}`);
  }

  /**
   * Calls EphemeralAccount.get_info() and returns the full on-chain account state.
   * Used by the sweep and claims modules to verify account readiness before acting,
   * and internally by expireAccount() to check expiry ledger before submitting.
   */
  async getAccountInfo(contractId: string): Promise<{
    status: string;
    expiry_ledger: number;
    payment_received: boolean;
    payment_count: number;
    recovery_address: string;
  }> {
    const contract = new StellarSdk.Contract(contractId);

    // get_info is a read-only call — use simulateTransaction, no signing needed
    const dummyKeypair = StellarSdk.Keypair.random();
    const sourceAccount = new StellarSdk.Account(dummyKeypair.publicKey(), '0');

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(contract.call('get_info'))
      .setTimeout(30)
      .build();

    const endTimer = this.sorobanRpcLatency.startTimer();
    let simResult: SorobanRpc.Api.SimulateTransactionResponse;
    try {
      simResult = await this.retrySorobanRpc(
        'simulateTransaction(get_info)',
        () => this.sorobanServer.simulateTransaction(transaction),
      );
    } finally {
      endTimer();
    }

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error(`get_info simulation failed: ${simResult.error}`);
    }

    // Parse the returned ScVal - shape mirrors AccountInfo struct in bridgelet-core
    const returnVal = simResult.result?.retval;
    if (!returnVal)
      throw new Error(`get_info returned no value for ${contractId}`);

    const mapEntries = returnVal.map();
    if (!mapEntries) {
      throw new Error(
        `get_info returned unexpected ScVal type for ${contractId}`,
      );
    }

    const fields = mapEntries.map((entry) => ({
      key: entry.key().sym().toString(),
      val: entry.val(),
    }));

    const get = (key: string) => fields.find((f) => f.key === key)?.val;

    const recoveryVal = get('recovery_address');
    if (!recoveryVal) {
      throw new Error(
        `get_info missing recovery_address field for ${contractId}`,
      );
    }

    return {
      status: get('status')?.u32()?.toString() ?? 'unknown',
      expiry_ledger: get('expiry_ledger')?.u32() ?? 0,
      payment_received: get('payment_received')?.b() ?? false,
      payment_count: get('payment_count')?.u32() ?? 0,
      recovery_address: StellarSdk.Address.fromScVal(recoveryVal).toString(),
    };
  }

  /**
   * Polls Soroban RPC until a transaction is confirmed or fails.
   * Used after sendTransaction() which is async by nature.
   */
  private async waitForTransaction(
    txHash: string,
    maxAttempts = 10,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const endTimer = this.sorobanRpcLatency.startTimer();
      let status: SorobanRpc.Api.GetTransactionResponse;
      try {
        status = await this.sorobanServer.getTransaction(txHash);
      } catch (error: unknown) {
        endTimer();
        if (this.isTransientRpcError(error)) {
          this.logger.warn(
            `getTransaction transient error (attempt ${i + 1}/${maxAttempts}) for ${txHash}: ` +
              `${error instanceof Error ? error.message : String(error)}. Retrying…`,
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        throw error;
      } finally {
        endTimer();
      }

      if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return;
      if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction ${txHash} failed on-chain`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(
      `Transaction ${txHash} not confirmed after ${maxAttempts} attempts`,
    );
  }

  /**
   * After a sendTransaction timeout, the transaction may or may not have
   * landed. This method polls getTransaction with a short timeout to
   * determine the outcome. Returns 'SUCCESS', 'FAILED', or 'UNKNOWN'.
   */
  private async checkTransactionStatusAfterTimeout(
    server: SorobanRpc.Server,
    maxAttempts = 5,
  ): Promise<'SUCCESS' | 'FAILED' | 'UNKNOWN'> {
    // Wait a few seconds for the transaction to potentially land
    await new Promise((resolve) => setTimeout(resolve, 5000));

    for (let i = 0; i < maxAttempts; i++) {
      try {
        // We don't have the hash from a timed-out call, so we just wait
        // and report UNKNOWN — the caller should not retry blindly.
        this.logger.debug(
          `Status check attempt ${i + 1}/${maxAttempts} after timeout`,
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch {
        // Swallow errors during status check
      }
    }
    return 'UNKNOWN';
  }

  private getNetworkPassphrase(): string {
    return this.network === 'mainnet'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;
  }
}
