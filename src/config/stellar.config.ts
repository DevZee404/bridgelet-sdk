import { registerAs } from '@nestjs/config';

const HORIZON_FALLBACK_URLS: Record<string, string> = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
};

export default registerAs('stellar', () => {
  const network = process.env.STELLAR_NETWORK || 'testnet';
  const primaryUrl =
    process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';

  const fallbackUrl =
    process.env.STELLAR_HORIZON_FALLBACK_URL ||
    HORIZON_FALLBACK_URLS[network] ||
    primaryUrl;

  return {
    network,
    horizonUrl: primaryUrl,
    horizonFallbackUrl: fallbackUrl === primaryUrl ? undefined : fallbackUrl,
    sorobanRpcUrl:
      process.env.STELLAR_SOROBAN_RPC_URL ||
      'https://soroban-testnet.stellar.org',
    contractEventPollIntervalMs: parseInt(
      process.env.STELLAR_CONTRACT_EVENT_POLL_INTERVAL_MS || '30000',
      10,
    ),
    fundingSecret: process.env.FUNDING_ACCOUNT_SECRET,
    recoveryPublic: process.env.RECOVERY_ACCOUNT_PUBLIC,
    // Minimum XLM (or asset-equivalent) an ephemeral account must be funded
    // with to clear the Stellar base reserve. Sourced from network config (not
    // hardcoded) because the reserve can change. Defaults to 0.5 XLM (2
    // operations x 0.25 base reserve).
    minimumReserveXlm: parseFloat(process.env.STELLAR_MIN_RESERVE_XLM ?? '0.5'),
    contracts: {
      ephemeralAccount: process.env.EPHEMERAL_ACCOUNT_CONTRACT_ID,
      sweepController:
        process.env.STELLAR_SWEEP_CONTROLLER_CONTRACT_ID ||
        process.env.SWEEP_CONTROLLER_CONTRACT_ID,
    },
    sweepSigningKeySeed: process.env.SWEEP_SIGNING_KEY_SEED,
    encryptionKey: process.env.ENCRYPTION_KEY || '64_char_hex_string_here',
    sweepControllerContractId:
      process.env.STELLAR_SWEEP_CONTROLLER_CONTRACT_ID ||
      process.env.SWEEP_CONTROLLER_CONTRACT_ID,
    // Fee strategy configuration
    maxFeeCeiling: parseInt(
      process.env.STELLAR_MAX_FEE_CEILING || '1000000',
      10,
    ), // 10 XLM in stroops
    feeCacheTtlMs: parseInt(
      process.env.STELLAR_FEE_CACHE_TTL_MS || '60000',
      10,
    ), // 60 seconds
    feeMultiplier: parseFloat(process.env.STELLAR_FEE_MULTIPLIER || '1.0'),
    fundingAccountBalanceCheckIntervalMs: parseInt(
      process.env.FUNDING_ACCOUNT_BALANCE_CHECK_INTERVAL_MS || '300000',
      10,
    ),
    fundingAccountLowBalanceThreshold: parseInt(
      process.env.FUNDING_ACCOUNT_LOW_BALANCE_THRESHOLD || '5000000',
      10,
    ),
    fundingAccountCriticalBalanceThreshold: parseInt(
      process.env.FUNDING_ACCOUNT_CRITICAL_BALANCE_THRESHOLD || '1000000',
      10,
    ),
  };
});
