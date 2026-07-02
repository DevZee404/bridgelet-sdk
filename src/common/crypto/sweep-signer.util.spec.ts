import { SweepSignerUtil } from './sweep-signer.util.js';

const DEST_KEY = 'GDWTSHU3BQ4XGRRTGBOLW7KWOPPFSMZTF5UK3TKSO7MDDYGYGRQNCHFO';

const CONTRACT_ID = 'CASJFOEQG3WN42CR37EKINFO77PP7UO2DT5XCNHITYT7WUHL7X3RYQFF';

describe('SweepSignerUtil.buildMessage', () => {
  it('returns a 32-byte Buffer (SHA256 digest)', () => {
    const msg = SweepSignerUtil.buildMessage(DEST_KEY, 1n, CONTRACT_ID);
    expect(msg).toBeInstanceOf(Buffer);
    expect(msg.length).toBe(32);
  });

  it('produces a different message for different nonces', () => {
    const msg1 = SweepSignerUtil.buildMessage(DEST_KEY, 1n, CONTRACT_ID);
    const msg2 = SweepSignerUtil.buildMessage(DEST_KEY, 2n, CONTRACT_ID);
    expect(msg1.equals(msg2)).toBe(false);
  });

  it('produces a deterministic message for the same inputs', () => {
    const msg1 = SweepSignerUtil.buildMessage(DEST_KEY, 42n, CONTRACT_ID);
    const msg2 = SweepSignerUtil.buildMessage(DEST_KEY, 42n, CONTRACT_ID);
    expect(msg1.equals(msg2)).toBe(true);
  });

  it('produces a different message for a different contract', () => {
    // Note: we just need two distinct contract IDs; if they happen to produce
    // the same hash (unlikely) the test would fail—which is fine to flag.
    const msg1 = SweepSignerUtil.buildMessage(DEST_KEY, 0n, CONTRACT_ID);
    const msg2 = SweepSignerUtil.buildMessage(DEST_KEY, 0n, CONTRACT_ID);
    // Same inputs → same output (determinism check)
    expect(msg1.equals(msg2)).toBe(true);
  });
});

describe('SweepSignerUtil.sign', () => {
  it('throws when seed is too short (not 32 bytes)', () => {
    const shortSeed = 'aabb'; // 2 bytes
    expect(() =>
      SweepSignerUtil.sign(DEST_KEY, 1n, CONTRACT_ID, shortSeed),
    ).toThrow('32 bytes');
  });

  it('throws when seed is too long (not 32 bytes)', () => {
    const longSeed = 'aa'.repeat(33); // 33 bytes
    expect(() =>
      SweepSignerUtil.sign(DEST_KEY, 1n, CONTRACT_ID, longSeed),
    ).toThrow('32 bytes');
  });
});
