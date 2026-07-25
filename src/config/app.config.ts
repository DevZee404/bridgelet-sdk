import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  claimTokenExpiry: parseInt(process.env.CLAIM_TOKEN_EXPIRY ?? '2592000', 10),
  webhookRetryAttempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS ?? '3', 10),
  webhookTimeout: parseInt(process.env.WEBHOOK_TIMEOUT ?? '5000', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
}));
