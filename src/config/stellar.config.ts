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
  };
});
