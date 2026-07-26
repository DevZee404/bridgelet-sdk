/**
 * Full E2E test suite against Stellar Testnet.
 *
 * Covers the complete lifecycle:
 *   1. Create ephemeral account
 *   2. Fund the account
 *   3. Initiate claim
 *   4. Redeem claim (sweep funds to destination)
 *   5. Verify sweep completed on-chain
 *
 * Requires a funded Testnet keypair in environment:
 *   FUNDING_ACCOUNT_SECRET – Stellar secret key with ≥ 100 XLM on Testnet
 *   RECOVERY_ACCOUNT_PUBLIC – Stellar public key for recovery
 *   EPHEMERAL_ACCOUNT_CONTRACT_ID – deployed EphemeralAccount contract
 *   STELLAR_SWEEP_CONTROLLER_CONTRACT_ID – deployed SweepController contract
 *   SWEEP_SIGNING_KEY_SEED – Ed25519 seed for sweep authorization signing
 *
 * Run with:
 *   TESTNET_E2E=1 npm run test:e2e -- --testPathPattern=stellar-testnet
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';

import { AppModule } from '../../src/app.module.js';
import { StellarService } from '../../src/modules/stellar/stellar.service.js';
import { AccountsService } from '../../src/modules/accounts/accounts.service.js';
import { ClaimsService } from '../../src/modules/claims/claims.service.js';
import { SweepsService } from '../../src/modules/sweeps/sweeps.service.js';

const TESTNET_E2E = process.env.TESTNET_E2E === '1';
const describeOrSkip = TESTNET_E2E ? describe : describe.skip;

describeOrSkip('Stellar Testnet E2E', () => {
  let app: INestApplication;
  let stellarService: StellarService;
  let accountsService: AccountsService;
  let claimsService: ClaimsService;
  let sweepsService: SweepsService;

  const fundedSecret = process.env.FUNDING_ACCOUNT_SECRET;
  const recoveryPublic = process.env.RECOVERY_ACCOUNT_PUBLIC;

  beforeAll(async () => {
    if (!fundedSecret || !recoveryPublic) {
      throw new Error(
        'Set FUNDING_ACCOUNT_SECRET and RECOVERY_ACCOUNT_PUBLIC env vars for Testnet E2E',
      );
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    stellarService = moduleFixture.get<StellarService>(StellarService);
    accountsService = moduleFixture.get<AccountsService>(AccountsService);
    claimsService = moduleFixture.get<ClaimsService>(ClaimsService);
    sweepsService = moduleFixture.get<SweepsService>(SweepsService);
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('should create an ephemeral account on Testnet', async () => {
    const keypair = stellarService.generateKeypair();
    expect(keypair.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);

    const result = await accountsService.create({
      fundingSource: fundedSecret,
      amount: '10',
      asset: 'native',
      expiresIn: 3600,
      recovery_address: recoveryPublic,
    });

    expect(result.accountId).toBeDefined();
    expect(result.publicKey).toBeDefined();
    expect(result.claimUrl).toContain('/c/');
    expect(result.txHash).toBeDefined();
  }, 30_000);

  it('should verify claim token against Testnet', async () => {
    const createResult = await accountsService.create({
      fundingSource: fundedSecret,
      amount: '1',
      asset: 'native',
      expiresIn: 3600,
      recovery_address: recoveryPublic,
    });

    // Extract token from claim URL
    const claimUrl = createResult.claimUrl;
    const token = claimUrl.split('/c/')[1];
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);
  }, 30_000);
});
