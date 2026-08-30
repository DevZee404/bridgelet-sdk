import type { SweepKind } from '../enums/sweep-kind.enum.js';

export interface SweepExecutionRequest {
  accountId: string;
  ephemeralPublicKey: string;
  ephemeralSecret: string;
  /**
   * For {@link SweepKind.CLAIM} sweeps the authoritative destination is read
   * from the account record (set during redemption lock). When supplied, it
   * must match that stored value or the sweep is rejected as a security event.
   * For {@link SweepKind.RECOVERY} sweeps this field is ignored; the
   * destination is always derived from `stellar.recoveryPublic`.
   */
  destinationAddress?: string;
  amount: string;
  asset: string;
  /** Defaults to {@link SweepKind.CLAIM}. */
  sweepKind?: SweepKind;
  /**
   * When true, the sweeper skips the smart-contract auth signature
   * generation AND the `execute_sweep` contract call (steps 2 and 3)
   * and only runs the Horizon payment (step 4). Used for retrying an
   * account in `PARTIAL_SWEEP` state whose contract is already in
   * `Swept` state from a prior partial failure — re-invoking
   * `execute_sweep` would revert on-chain.
   */
  skipContractAuth?: boolean;
  /**
   * When true, the sweeper queries all non-zero balances on the ephemeral
   * account and sweeps each one to the destination in a batch. The `amount`
   * and `asset` fields are still used for the primary asset; additional
   * assets are discovered from Horizon.
   */
  sweepAllAssets?: boolean;
  dryRun?: boolean;
}
