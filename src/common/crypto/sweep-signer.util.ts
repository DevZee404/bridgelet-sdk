import * as crypto from 'crypto';
import { Address } from '@stellar/stellar-sdk';

/**
 * SweepSignerUtil
 *
 * Produces Ed25519 signatures for sweep authorization that match the
 * message format verified on-chain by SweepController.authorization.rs.
 *
 * Message format (mirrors construct_sweep_message in bridgelet-core):
 *   SHA256( destination_xdr_bytes | nonce_u64_big_endian | contract_id_xdr_bytes )
 *
 * The signing key must be the Ed25519 private key whose corresponding
 * public key was registered in SweepController.initialize() as authorized_signer.
 *
 * Key format: 64-byte hex string (32-byte seed || 32-byte public key),
 * as produced by Stellar Keypair.rawSecretKey() + Keypair.rawPublicKey().
 * Alternatively, supply the raw 32-byte seed as a 64-character hex string.
 */
export class SweepSignerUtil {
  /**
   * Sign a sweep authorization for the given destination and nonce.
   *
   * @param destinationStrKey  - Stellar G... address of the sweep destination
   * @param nonce              - Current sweep nonce from SweepController storage
   * @param sweepControllerContractId - C... address of the deployed SweepController
   * @param signingKeySeed     - 32-byte Ed25519 seed as 64-char hex string
   * @returns 64-byte signature as a Buffer
   */
  static sign(
    destinationStrKey: string,
    nonce: bigint,
    sweepControllerContractId: string,
    signingKeySeed: string,
  ): Buffer {
    const message = SweepSignerUtil.buildMessage(
      destinationStrKey,
      nonce,
      sweepControllerContractId,
    );

    const seed = Buffer.from(signingKeySeed, 'hex');
    if (seed.length !== 32) {
      throw new Error(
        `Signing key seed must be 32 bytes (64 hex chars). Got ${seed.length} bytes.`,
      );
    }

    // Node.js crypto supports Ed25519 via createPrivateKey with type 'ed25519'
    const privateKey = crypto.createPrivateKey({
      key: seed,
      format: 'der',
      type: 'pkcs8',
    });

    return crypto.sign(null, message, privateKey);
  }

  /**
   * Reconstruct the exact message bytes that the on-chain contract hashes.
   * Must stay in sync with construct_sweep_message() in:
   * bridgelet-core/contracts/sweep_controller/src/authorization.rs
   */
  static buildMessage(
    destinationStrKey: string,
    nonce: bigint,
    sweepControllerContractId: string,
  ): Buffer {
    // XDR-encode the destination address (Stellar SDK ScVal encoding)
    // Soroban Address.to_xdr() serializes as an AccountId ScVal
    const destXdr = encodeAddressToXdr(destinationStrKey);
    const contractXdr = encodeAddressToXdr(sweepControllerContractId);

    // Encode nonce as 8-byte big-endian u64
    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64BE(nonce);

    const combined = Buffer.concat([destXdr, nonceBuf, contractXdr]);

    // SHA256 hash — mirrors env.crypto().sha256() in Soroban
    return crypto.createHash('sha256').update(combined).digest();
  }
}

/**
 * Minimal XDR encoding for a Stellar StrKey address as Soroban serializes it.
 * Soroban's Address.to_xdr() produces an ScVal of type SCV_ADDRESS containing
 * an AccountId (for G... keys) or ContractId (for C... keys).
 *
 * Use @stellar/stellar-sdk's xdr module for correctness — do not hand-roll.
 */
function encodeAddressToXdr(strKey: string): Buffer {
  const scVal = Address.fromString(strKey).toScVal();
  return Buffer.from(scVal.toXDR());
}
