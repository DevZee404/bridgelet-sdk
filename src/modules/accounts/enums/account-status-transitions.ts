import { AccountStatus } from './account-status.enum.js';

/**
 * Centralized definition of every allowed account status transition (issue
 * #460).
 *
 * Previous behavior scattered ad-hoc transition guards across services (or had
 * none at all). All valid transitions are enumerated here in exactly one place.
 * Anything not listed is an invalid transition and must be rejected by
 * {@link assertValidAccountStatusTransition}.
 *
 * Terminal states (`CLAIMED`, `EXPIRED`, `FAILED`) have no outgoing
 * transitions and must never move again.
 */
export const ACCOUNT_STATUS_TRANSITIONS: Readonly<
  Record<AccountStatus, readonly AccountStatus[]>
> = {
  [AccountStatus.INITIALIZING]: [
    AccountStatus.PENDING_PAYMENT, // contract initialized successfully
    AccountStatus.FAILED, // creation failed / stuck INITIALIZING cleanup
  ],
  [AccountStatus.PENDING_PAYMENT]: [
    AccountStatus.PENDING_CLAIM, // payment confirmed
    AccountStatus.EXPIRED, // expiry job
    AccountStatus.FAILED,
  ],
  [AccountStatus.PENDING_CLAIM]: [
    AccountStatus.CLAIMING, // claim locked for redemption
    AccountStatus.EXPIRED, // expiry job
    AccountStatus.FAILED,
  ],
  [AccountStatus.CLAIMING]: [
    AccountStatus.CLAIMED, // sweep + payment succeeded
    AccountStatus.PARTIAL_SWEEP, // contract authorized but Horizon payment failed
    AccountStatus.PENDING_CLAIM, // failed redeem reverts for a fresh retry
  ],
  [AccountStatus.PARTIAL_SWEEP]: [
    AccountStatus.CLAIMING, // retry of a partially-swept account
    AccountStatus.CLAIMED, // retry eventually succeeded
    AccountStatus.FAILED,
  ],
  [AccountStatus.CLAIMED]: [],
  [AccountStatus.EXPIRED]: [],
  [AccountStatus.FAILED]: [],
};

export class InvalidAccountStatusTransitionException extends Error {
  constructor(
    public readonly from: AccountStatus,
    public readonly to: AccountStatus,
  ) {
    super(
      `Invalid account status transition: ${from} -> ${to}. Allowed from ` +
        `${from}: ${ACCOUNT_STATUS_TRANSITIONS[from].join(', ') || 'none (terminal)'}.`,
    );
    this.name = 'InvalidAccountStatusTransitionException';
  }
}

/**
 * Throws {@link InvalidAccountStatusTransitionException} if `to` is not an
 * allowed successor of `from`, otherwise returns without error.
 */
export function assertValidAccountStatusTransition(
  from: AccountStatus,
  to: AccountStatus,
): void {
  if (from === to) return;
  if (!ACCOUNT_STATUS_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidAccountStatusTransitionException(from, to);
  }
}
