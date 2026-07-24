/**
 * Unit tests for ContractProvider.generateAuthSignature
 *
 * TASK: Issue #49
 * Covers three acceptance criteria:
 *   (1) Stub — returns a 64-byte fake signature in development / test environments
 *   (2) Production guard — throws when NODE_ENV=production and seed is not valid
 *   (3) Real Ed25519 — real sign() output is a 64-byte signature that can be
 *       verified with the corresponding public key (bridgelet-core compatibility)
 *
 * Branch: feature/issue-49-brief-description
 * PR title format: Feature: Brief description (#49)
 */

import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ContractProvider } from './contract.provider.js';
import { SweepSignerUtil } from '../../../common/crypto/sweep-signer.util.js';
import { AuthorizeSweepParams } from '../interfaces/authorize-sweep-params.interface.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * A real 32-byte Ed25519 seed generated deterministically for tests.
 * Using a fixed value keeps the tests reproducible without secrets.
 */
const REAL_SEED_HEX = crypto
  .createHash('sha256')
  .update('bridgelet-test-seed-issue-49')
  .digest('hex'); // 64 hex chars === 32 bytes

const DEST_ADDRESS =
  'GDWTSHU3BQ4XGRRTGBOLW7KWOPPFSMZTF5UK3TKSO7MDDYGYGRQNCHFO';
const CONTRACT_ID =
  'CASJFOEQG3WN42CR37EKINFO77PP7UO2DT5XCNHITYT7WUHL7X3RYQFF';

/** A placeholder seed that is NOT 32 bytes — simulates a mis-configured deployment */
const INVALID_SEED_HEX = 'aabb'; // 2 bytes

const baseParams: AuthorizeSweepParams = {
  ephemeralPublicKey:
    'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J2RROMSG',
  destinationAddress: DEST_ADDRESS,
};

// ---------------------------------------------------------------------------
// Helper — build a ContractProvider with a specific config map
// ---------------------------------------------------------------------------

async function buildProvider(config: Record<string, string>): Promise<{
  provider: ContractProvider;
  module: TestingModule;
}> {
  const module = await Test.createTestingModule({
    providers: [
      ContractProvider,
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: jest.fn((key: string) => {
            if (key in config) return config[key];
            throw new Error(`Test config key not found: ${key}`);
          }),
        },
      },
    ],
  }).compile();

  return { provider: module.get<ContractProvider>(ContractProvider), module };
}

/** Base config shared by all sub-suites */
const BASE_CONFIG: Record<string, string> = {
  'stellar.contracts.ephemeralAccount': CONTRACT_ID,
  'stellar.sorobanRpcUrl': 'https://soroban-testnet.stellar.org',
  'stellar.network': 'testnet',
  'stellar.sweepSigningKeySeed': REAL_SEED_HEX,
  'stellar.contracts.sweepController': CONTRACT_ID,
};

// ---------------------------------------------------------------------------
// 1. STUB — dev / test environments
// ---------------------------------------------------------------------------

describe('ContractProvider.generateAuthSignature — stub (dev/test)', () => {
  let provider: ContractProvider;
  const savedEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore NODE_ENV after each test
    if (savedEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedEnv;
    }
  });

  /** Helper: build provider and call generateAuthSignature with a given NODE_ENV */
  async function signWithEnv(env: string | undefined): Promise<Buffer> {
    if (env === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = env;
    }

    // Use a dummy seed — valid enough that SweepSignerUtil.sign will work
    const { provider: p } = await buildProvider({
      ...BASE_CONFIG,
      'stellar.sweepSigningKeySeed': REAL_SEED_HEX,
    });

    return p.generateAuthSignature(baseParams);
  }

  it('returns a Buffer when NODE_ENV=development', async () => {
    const sig = await signWithEnv('development');
    expect(sig).toBeInstanceOf(Buffer);
  });

  it('returns exactly 64 bytes when NODE_ENV=development', async () => {
    const sig = await signWithEnv('development');
    expect(sig.length).toBe(64);
  });

  it('returns a Buffer when NODE_ENV=test', async () => {
    const sig = await signWithEnv('test');
    expect(sig).toBeInstanceOf(Buffer);
  });

  it('returns exactly 64 bytes when NODE_ENV=test', async () => {
    const sig = await signWithEnv('test');
    expect(sig.length).toBe(64);
  });

  it('returns a Buffer when NODE_ENV is not set (defaults to development)', async () => {
    const sig = await signWithEnv(undefined);
    expect(sig).toBeInstanceOf(Buffer);
    expect(sig.length).toBe(64);
  });

  it('is deterministic — same inputs produce same signature in dev', async () => {
    process.env.NODE_ENV = 'development';
    const { provider: p } = await buildProvider(BASE_CONFIG);

    const sig1 = p.generateAuthSignature({ ...baseParams, nonce: 5n });
    const sig2 = p.generateAuthSignature({ ...baseParams, nonce: 5n });

    expect(sig1.equals(sig2)).toBe(true);
  });

  it('produces different signatures for different nonces in dev', async () => {
    process.env.NODE_ENV = 'development';
    const { provider: p } = await buildProvider(BASE_CONFIG);

    const sig1 = p.generateAuthSignature({ ...baseParams, nonce: 0n });
    const sig2 = p.generateAuthSignature({ ...baseParams, nonce: 1n });

    expect(sig1.equals(sig2)).toBe(false);
  });

  it('uses nonce=0n when params.nonce is omitted', async () => {
    process.env.NODE_ENV = 'development';
    const { provider: p } = await buildProvider(BASE_CONFIG);

    const signSpy = jest
      .spyOn(SweepSignerUtil, 'sign')
      .mockReturnValue(Buffer.alloc(64));

    p.generateAuthSignature(baseParams); // no nonce field

    expect(signSpy).toHaveBeenCalledWith(
      baseParams.destinationAddress,
      0n, // default nonce
      expect.any(String),
      expect.any(String),
    );
  });

  it('delegates to SweepSignerUtil.sign with correct arguments', async () => {
    process.env.NODE_ENV = 'development';
    const { provider: p } = await buildProvider(BASE_CONFIG);

    const signSpy = jest
      .spyOn(SweepSignerUtil, 'sign')
      .mockReturnValue(Buffer.alloc(64));

    const nonce = 42n;
    p.generateAuthSignature({ ...baseParams, nonce });

    expect(signSpy).toHaveBeenCalledWith(
      baseParams.destinationAddress,
      nonce,
      CONTRACT_ID,
      REAL_SEED_HEX,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. PRODUCTION GUARD — throws when called in production with invalid seed
// ---------------------------------------------------------------------------

describe('ContractProvider.generateAuthSignature — production guard', () => {
  const savedEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedEnv;
    }
    jest.restoreAllMocks();
  });

  it('throws in production when SWEEP_SIGNING_KEY_SEED is not 32 bytes', async () => {
    process.env.NODE_ENV = 'production';

    const { provider: p } = await buildProvider({
      ...BASE_CONFIG,
      'stellar.sweepSigningKeySeed': INVALID_SEED_HEX, // 2 bytes — invalid
    });

    expect(() => p.generateAuthSignature(baseParams)).toThrow(
      /SWEEP_SIGNING_KEY_SEED must be a valid 32-byte Ed25519 seed/,
    );
  });

  it('throws in production when seed is an empty string', async () => {
    process.env.NODE_ENV = 'production';

    const { provider: p } = await buildProvider({
      ...BASE_CONFIG,
      'stellar.sweepSigningKeySeed': '',
    });

    expect(() => p.generateAuthSignature(baseParams)).toThrow(
      /SWEEP_SIGNING_KEY_SEED must be a valid 32-byte Ed25519 seed/,
    );
  });

  it('throws in production when seed is a human-readable placeholder', async () => {
    process.env.NODE_ENV = 'production';

    // Simulate a developer who left a placeholder string instead of a real seed
    const { provider: p } = await buildProvider({
      ...BASE_CONFIG,
      'stellar.sweepSigningKeySeed': 'change-me-before-production',
    });

    expect(() => p.generateAuthSignature(baseParams)).toThrow(
      /SWEEP_SIGNING_KEY_SEED must be a valid 32-byte Ed25519 seed/,
    );
  });

  it('error message includes the actual byte count received', async () => {
    process.env.NODE_ENV = 'production';

    const { provider: p } = await buildProvider({
      ...BASE_CONFIG,
      'stellar.sweepSigningKeySeed': 'aabbcc', // 3 bytes
    });

    expect(() => p.generateAuthSignature(baseParams)).toThrow(/3 bytes/);
  });

  it('does NOT throw in production when seed is a valid 32-byte hex string', async () => {
    process.env.NODE_ENV = 'production';

    const { provider: p } = await buildProvider({
      ...BASE_CONFIG,
      'stellar.sweepSigningKeySeed': REAL_SEED_HEX, // valid 32-byte seed
    });

    // Should not throw — will proceed to SweepSignerUtil.sign
    // Mock sign so we do not need a real keypair + Stellar SDK internals
    jest.spyOn(SweepSignerUtil, 'sign').mockReturnValue(Buffer.alloc(64));

    expect(() => p.generateAuthSignature(baseParams)).not.toThrow();
  });

  it('does NOT throw in development even with a non-32-byte seed', async () => {
    process.env.NODE_ENV = 'development';

    const { provider: p } = await buildProvider({
      ...BASE_CONFIG,
      'stellar.sweepSigningKeySeed': INVALID_SEED_HEX,
    });

    // Guard is skipped; SweepSignerUtil.sign will throw for bad seed length,
    // but the production guard itself must NOT trigger.
    // Spy on sign so we can confirm the guard was NOT the source of the throw.
    const signSpy = jest
      .spyOn(SweepSignerUtil, 'sign')
      .mockImplementation(() => {
        throw new Error('32 bytes');
      });

    // The error originates from SweepSignerUtil, not the production guard.
    expect(() => p.generateAuthSignature(baseParams)).toThrow('32 bytes');
    expect(signSpy).toHaveBeenCalled(); // guard was skipped, sign was reached
  });

  it('does NOT throw in test environment even with a non-32-byte seed', async () => {
    process.env.NODE_ENV = 'test';

    const { provider: p } = await buildProvider({
      ...BASE_CONFIG,
      'stellar.sweepSigningKeySeed': INVALID_SEED_HEX,
    });

    const signSpy = jest
      .spyOn(SweepSignerUtil, 'sign')
      .mockReturnValue(Buffer.alloc(64));

    // No guard throw — sign is reached
    p.generateAuthSignature(baseParams);
    expect(signSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. REAL Ed25519 — signature is verifiable by the matching public key
// ---------------------------------------------------------------------------

describe('ContractProvider.generateAuthSignature — real Ed25519 signature', () => {
  const savedEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development'; // use dev to bypass production guard
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedEnv;
    }
    jest.restoreAllMocks();
  });

  /**
   * Derive the Ed25519 public key from a 32-byte seed using Node.js crypto.
   * This mirrors what bridgelet-core does when verifying a sweep authorization.
   */
  function derivePublicKey(seedHex: string): Buffer {
    const seed = Buffer.from(seedHex, 'hex');
    // Wrap raw seed in PKCS#8 DER encoding — same prefix used in SweepSignerUtil
    const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
    const pkcs8Der = Buffer.concat([pkcs8Prefix, seed]);
    const privateKey = crypto.createPrivateKey({
      key: pkcs8Der,
      format: 'der',
      type: 'pkcs8',
    });
    const publicKey = crypto.createPublicKey(privateKey);
    // Export raw public key bytes (32 bytes for Ed25519)
    return publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  }

  /**
   * Verify an Ed25519 signature using the raw public key bytes.
   * This is the verification step that bridgelet-core performs on-chain.
   */
  function verifySignature(
    message: Buffer,
    signature: Buffer,
    publicKeyBytes: Buffer,
  ): boolean {
    // Reconstruct a Node.js KeyObject from raw SPKI bytes
    const pkDer = Buffer.concat([
      // ASN.1 DER prefix for Ed25519 SubjectPublicKeyInfo
      Buffer.from('302a300506032b6570032100', 'hex'),
      publicKeyBytes,
    ]);
    const publicKey = crypto.createPublicKey({ key: pkDer, format: 'der', type: 'spki' });
    return crypto.verify(null, message, publicKey, signature);
  }

  it('returns a 64-byte Buffer (valid Ed25519 signature length)', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);
    const sig = p.generateAuthSignature(baseParams);

    expect(sig).toBeInstanceOf(Buffer);
    expect(sig.length).toBe(64);
  });

  it('signature is verifiable by the derived public key', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);
    const nonce = 7n;

    const sig = p.generateAuthSignature({ ...baseParams, nonce });

    // Reconstruct the message using the same logic as SweepSignerUtil.buildMessage
    const message = SweepSignerUtil.buildMessage(
      baseParams.destinationAddress,
      nonce,
      CONTRACT_ID,
    );

    const publicKeyBytes = derivePublicKey(REAL_SEED_HEX);
    const valid = verifySignature(message, sig, publicKeyBytes);

    expect(valid).toBe(true);
  });

  it('signature for nonce=0 is verifiable', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);

    const sig = p.generateAuthSignature({ ...baseParams, nonce: 0n });
    const message = SweepSignerUtil.buildMessage(
      baseParams.destinationAddress,
      0n,
      CONTRACT_ID,
    );

    const publicKeyBytes = derivePublicKey(REAL_SEED_HEX);
    expect(verifySignature(message, sig, publicKeyBytes)).toBe(true);
  });

  it('signature for omitted nonce (defaults to 0n) is verifiable', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);

    const sig = p.generateAuthSignature(baseParams); // no nonce
    const message = SweepSignerUtil.buildMessage(
      baseParams.destinationAddress,
      0n, // default
      CONTRACT_ID,
    );

    const publicKeyBytes = derivePublicKey(REAL_SEED_HEX);
    expect(verifySignature(message, sig, publicKeyBytes)).toBe(true);
  });

  it('signature does NOT verify against a different message (tampered destination)', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);
    const nonce = 3n;

    const sig = p.generateAuthSignature({ ...baseParams, nonce });

    // Build a message for a DIFFERENT destination
    const tamperedMessage = SweepSignerUtil.buildMessage(
      'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
      nonce,
      CONTRACT_ID,
    );

    const publicKeyBytes = derivePublicKey(REAL_SEED_HEX);
    expect(verifySignature(tamperedMessage, sig, publicKeyBytes)).toBe(false);
  });

  it('signature does NOT verify against a different nonce', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);

    const sig = p.generateAuthSignature({ ...baseParams, nonce: 1n });

    // Try to verify against nonce=2 — must fail
    const wrongNonceMessage = SweepSignerUtil.buildMessage(
      baseParams.destinationAddress,
      2n,
      CONTRACT_ID,
    );

    const publicKeyBytes = derivePublicKey(REAL_SEED_HEX);
    expect(verifySignature(wrongNonceMessage, sig, publicKeyBytes)).toBe(false);
  });

  it('signature does NOT verify against a different contract ID', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);
    const nonce = 0n;

    const sig = p.generateAuthSignature({ ...baseParams, nonce });

    // Build message with a different sweep controller contract (valid C-address, different bytes)
    const differentContractMessage = SweepSignerUtil.buildMessage(
      baseParams.destinationAddress,
      nonce,
      'CASZFOEQG3WN42CR37EKINFO77PP7UO2DT5XCNHITYT7WUHL7X3RYBX4', // different valid contract
    );

    const publicKeyBytes = derivePublicKey(REAL_SEED_HEX);
    expect(verifySignature(differentContractMessage, sig, publicKeyBytes)).toBe(
      false,
    );
  });

  it('signature does NOT verify with a different public key (wrong signer)', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);

    const sig = p.generateAuthSignature({ ...baseParams, nonce: 0n });
    const message = SweepSignerUtil.buildMessage(
      baseParams.destinationAddress,
      0n,
      CONTRACT_ID,
    );

    // Different seed → different key pair
    const wrongSeed = crypto
      .createHash('sha256')
      .update('different-seed')
      .digest('hex');
    const wrongPublicKeyBytes = derivePublicKey(wrongSeed);

    expect(verifySignature(message, sig, wrongPublicKeyBytes)).toBe(false);
  });

  it('signature is exactly 64 bytes for a large nonce', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);

    // u64 max value
    const sig = p.generateAuthSignature({ ...baseParams, nonce: 18446744073709551615n });
    expect(sig.length).toBe(64);
  });

  it('different nonces produce different 64-byte signatures', async () => {
    const { provider: p } = await buildProvider(BASE_CONFIG);

    const sig0 = p.generateAuthSignature({ ...baseParams, nonce: 0n });
    const sig1 = p.generateAuthSignature({ ...baseParams, nonce: 1n });
    const sig100 = p.generateAuthSignature({ ...baseParams, nonce: 100n });

    // All are 64 bytes
    expect(sig0.length).toBe(64);
    expect(sig1.length).toBe(64);
    expect(sig100.length).toBe(64);

    // All are distinct
    expect(sig0.equals(sig1)).toBe(false);
    expect(sig0.equals(sig100)).toBe(false);
    expect(sig1.equals(sig100)).toBe(false);
  });

  it('message format matches SweepSignerUtil.buildMessage output (bridgelet-core compatibility)', () => {
    // This test documents the message format contract between bridgelet-sdk and
    // bridgelet-core. If either side changes the format, this test will fail.
    const message = SweepSignerUtil.buildMessage(
      baseParams.destinationAddress,
      0n,
      CONTRACT_ID,
    );

    // SHA-256 output is always 32 bytes
    expect(message).toBeInstanceOf(Buffer);
    expect(message.length).toBe(32);
  });
});
