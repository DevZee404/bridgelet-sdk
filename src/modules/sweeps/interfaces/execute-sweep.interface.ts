export interface SweepExecutionRequest {
  accountId: string;
  ephemeralPublicKey: string;
  ephemeralSecret: string;
  destinationAddress: string;
  amount: string;
  asset: string;
  /**
   * When true, the sweeper skips the smart-contract auth signature
   * generation AND the `execute_sweep` contract call (steps 2 and 3)
   * and only runs the Horizon payment (step 4). Used for retrying an
   * account in `PARTIAL_SWEEP` state whose contract is already in
   * `Swept` state from a prior partial failure — re-invoking
   * `execute_sweep` would revert on-chain.
   */
  skipContractAuth?: boolean;
}
