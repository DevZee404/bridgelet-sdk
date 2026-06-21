import { registerAs } from '@nestjs/config';

export default registerAs('stellar', () => ({
  network: process.env.STELLAR_NETWORK || 'testnet',
  horizonUrl:
    process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl:
    process.env.STELLAR_SOROBAN_RPC_URL ||
    'https://soroban-testnet.stellar.org',
  fundingSecret: process.env.FUNDING_ACCOUNT_SECRET,
  recoveryPublic: process.env.RECOVERY_ACCOUNT_PUBLIC,
  contracts: {
    ephemeralAccount: process.env.EPHEMERAL_ACCOUNT_CONTRACT_ID,
    sweepController: process.env.STELLAR_SWEEP_CONTROLLER_CONTRACT_ID,
  },
  sweepSigningKeySeed: process.env.SWEEP_SIGNING_KEY_SEED,
  encryptionKey: process.env.ENCRYPTION_KEY || '64_char_hex_string_here',
}));
