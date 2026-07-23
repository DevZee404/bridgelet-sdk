export interface SweepResult {
  success: boolean;
  /**
   * True when the smart contract `execute_sweep` succeeded but the
   * subsequent Horizon `Operation.payment` failed. The contract is
   * therefore in `Swept` state but no funds have moved. Marking
   * `isPartial` (rather than throwing) lets the caller transition the
   * account to `PARTIAL_SWEEP` and emit a structured `sweep.partial`
   * webhook event.
   *
   * The next redemption attempt on the same account passes
   * `skipContractAuth: true` and only re-submits the Horizon payment.
   */
  isPartial?: boolean;
  txHash?: string;
  contractAuthHash: string;
  amountSwept: string;
  destination: string;
  timestamp?: Date;
  /**
   * Populated only when `isPartial` is true; carries the underlying error
   * message from the failed Horizon submission so it can be surfaced in
   * the `sweep.partial` webhook payload.
   */
  error?: string;
}
