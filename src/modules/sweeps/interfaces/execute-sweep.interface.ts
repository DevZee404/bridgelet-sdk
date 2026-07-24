export interface SweepExecutionRequest {
  accountId: string;
  ephemeralPublicKey: string;
  ephemeralSecret: string;
  destinationAddress: string;
  amount: string;
  asset: string;
  dryRun?: boolean;
}
