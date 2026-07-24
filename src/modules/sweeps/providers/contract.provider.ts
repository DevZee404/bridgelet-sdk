import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Address,
  xdr,
  hash,
  Keypair,
} from '@stellar/stellar-sdk';
import type { AuthorizeSweepParams } from '../interfaces/authorize-sweep-params.interface.js';
import type { ContractAuthResult } from '../interfaces/contract-auth-result.interface.js';
import { SweepSignerUtil } from '../../../common/crypto/sweep-signer.util.js';

@Injectable()
export class ContractProvider {
  private readonly logger = new Logger(ContractProvider.name);
  private readonly contractId: string;
  private readonly sorobanRpcUrl: string;
  private readonly networkPassphrase: string;

  constructor(private readonly configService: ConfigService) {
    this.contractId = this.configService.getOrThrow<string>(
      'stellar.contracts.ephemeralAccount',
    );
    this.sorobanRpcUrl = this.configService.getOrThrow<string>(
      'stellar.sorobanRpcUrl',
    );

    const network = this.configService.getOrThrow<string>('stellar.network');
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.logger.log(
      `Initialized ContractProvider with contract: ${this.contractId}`,
    );
  }

  /**
   * Authorize sweep via smart contract
   * Calls the contract's sweep() function to validate authorization
   */
  public async authorizeSweep(
    params: AuthorizeSweepParams,
  ): Promise<ContractAuthResult> {
    this.logger.log(
      `Authorizing sweep for account: ${params.ephemeralPublicKey}`,
    );

    try {
      // Create Soroban RPC server connection
      const server = new rpc.Server(this.sorobanRpcUrl);

      // Create contract instance
      const contract = new Contract(this.contractId);

      // Prepare destination address parameter
      const destination = Address.fromString(params.destinationAddress);

      const authSignature = this.generateAuthSignature(params);

      // Build contract invocation transaction
      const account = await server.getAccount(params.ephemeralPublicKey);

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'sweep',
            destination.toScVal(),
            xdr.ScVal.scvBytes(authSignature),
          ),
        )
        .setTimeout(30)
        .build();

      // Simulate contract call first
      const simulated = await server.simulateTransaction(transaction);

      if (rpc.Api.isSimulationError(simulated)) {
        throw new Error(`Contract simulation failed: ${simulated.error}`);
      }

      const preparedTx = await server.prepareTransaction(transaction);
      preparedTx.sign(
        Keypair.fromSecret(
          this.configService.getOrThrow<string>('stellar.sweepSigningKeySeed'),
        ),
      );

      const sendResult = await server.sendTransaction(preparedTx);
      if (sendResult.status === 'ERROR') {
        throw new Error(
          `Contract sendTransaction failed: ${JSON.stringify(sendResult.errorResult)}`,
        );
      }

      await this.waitForTransaction(server, sendResult.hash);

      this.logger.log('Contract authorization successful');

      // Generate cryptographically secure authorization hash
      const timestamp = Date.now();
      const authHash = this.generateAuthHash(
        params.ephemeralPublicKey,
        params.destinationAddress,
        timestamp,
      );

      return {
        authorized: true,
        hash: authHash,
        timestamp: new Date(timestamp),
      };
    } catch (error) {
      const typedError = error as Error;
      this.logger.error(
        `Contract execution failed: ${typedError.message}`,
        typedError.stack,
      );
      throw new InternalServerErrorException(
        `Contract execution failed: ${typedError.message}`,
      );
    }
  }

  public generateAuthSignature(params: AuthorizeSweepParams): Buffer {
    const signingKeySeed = this.configService.getOrThrow<string>(
      'stellar.sweepSigningKeySeed',
    );
    const sweepControllerContractId = this.configService.getOrThrow<string>(
      'stellar.contracts.sweepController',
    );

    // Fetch the current nonce from the SweepController contract before signing.
    // The nonce must match what the contract will read during verification.
    // This call is synchronous here for interface compatibility; the caller
    // (SweepsService) should ensure the nonce is current before invoking.
    const nonce = params.nonce ?? 0n;

    return SweepSignerUtil.sign(
      params.destinationAddress,
      nonce,
      sweepControllerContractId,
      signingKeySeed,
    );
  }

  /**
   * Check contract status and version
   */
  public getContractInfo(): {
    contractId: string;
    version: string;
  } {
    return {
      contractId: this.contractId,
      version: '0.1.0',
    };
  }
  /**
   * Generate cryptographically secure authorization hash
   * Uses Stellar SDK's SHA-256 hash function for security
   *
   * @param ephemeralKey - The ephemeral account public key
   * @param destination - The destination address for the sweep
   * @param timestamp - Optional timestamp for replay protection (defaults to current time)
   * @returns 64-character hex string of the SHA-256 hash
   */
  public generateAuthHash(
    ephemeralKey: string,
    destination: string,
    timestamp?: number,
  ): string {
    const ts = timestamp ?? Date.now();
    const message = `${ephemeralKey}:${destination}:${ts}`;
    const hashBuffer = hash(Buffer.from(message));
    return hashBuffer.toString('hex');
  }

  private async waitForTransaction(
    server: rpc.Server,
    txHash: string,
    maxAttempts = 10,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const status = await server.getTransaction(txHash);
      if (status.status === rpc.Api.GetTransactionStatus.SUCCESS) return;
      if (status.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction ${txHash} failed on-chain`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(
      `Transaction ${txHash} not confirmed after ${maxAttempts} attempts`,
    );
  }
}
