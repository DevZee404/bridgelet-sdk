import { BadRequestException } from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';

export class StellarAddressValidator {
  /**
   * Checks if the given address is a valid Stellar public key (Ed25519).
   * @param address The address string to validate
   * @returns true if valid, false otherwise
   */
  static isValid(address: string): boolean {
    if (!address || typeof address !== 'string') return false;
    try {
      return StrKey.isValidEd25519PublicKey(address);
    } catch {
      return false;
    }
  }

  /**
   * Asserts that the given address is a valid Stellar public key.
   * Throws a BadRequestException if invalid.
   * @param address The address string to validate
   * @throws BadRequestException if the address is invalid
   */
  static assertValid(address: string): void {
    if (!StellarAddressValidator.isValid(address)) {
      throw new BadRequestException(`Invalid Stellar address: ${address}`);
    }
  }
}
