export interface AuthorizeSweepParams {
  ephemeralPublicKey: string;
  destinationAddress: string;
  nonce?: bigint;
}
