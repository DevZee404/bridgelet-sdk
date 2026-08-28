import {
  ACCOUNT_STATUS_TRANSITIONS,
  assertValidAccountStatusTransition,
  InvalidAccountStatusTransitionException,
} from './account-status-transitions.js';
import { AccountStatus } from './account-status.enum.js';

describe('account-status-transitions (issue #460)', () => {
  const nonTerminalStates = [
    AccountStatus.INITIALIZING,
    AccountStatus.PENDING_PAYMENT,
    AccountStatus.PENDING_CLAIM,
    AccountStatus.CLAIMING,
    AccountStatus.PARTIAL_SWEEP,
  ];

  describe('ACCOUNT_STATUS_TRANSITIONS', () => {
    it('enumerates the expected valid transitions', () => {
      expect(ACCOUNT_STATUS_TRANSITIONS).toEqual({
        [AccountStatus.INITIALIZING]: [
          AccountStatus.PENDING_PAYMENT,
          AccountStatus.FAILED,
        ],
        [AccountStatus.PENDING_PAYMENT]: [
          AccountStatus.PENDING_CLAIM,
          AccountStatus.EXPIRED,
          AccountStatus.FAILED,
        ],
        [AccountStatus.PENDING_CLAIM]: [
          AccountStatus.CLAIMING,
          AccountStatus.EXPIRED,
          AccountStatus.FAILED,
        ],
        [AccountStatus.CLAIMING]: [
          AccountStatus.CLAIMED,
          AccountStatus.PARTIAL_SWEEP,
          AccountStatus.PENDING_CLAIM,
        ],
        [AccountStatus.PARTIAL_SWEEP]: [
          AccountStatus.CLAIMING,
          AccountStatus.CLAIMED,
          AccountStatus.FAILED,
        ],
        [AccountStatus.CLAIMED]: [],
        [AccountStatus.EXPIRED]: [],
        [AccountStatus.FAILED]: [],
      });
    });

    it('has no terminal state with an outgoing transition', () => {
      for (const terminal of [
        AccountStatus.CLAIMED,
        AccountStatus.EXPIRED,
        AccountStatus.FAILED,
      ]) {
        expect(ACCOUNT_STATUS_TRANSITIONS[terminal]).toEqual([]);
      }
    });

    it('lists every status in the enum as a key', () => {
      const all = Object.values(AccountStatus);
      for (const status of all) {
        expect(ACCOUNT_STATUS_TRANSITIONS).toHaveProperty(status);
      }
    });
  });

  describe('assertValidAccountStatusTransition', () => {
    it('allows every enumerated valid transition', () => {
      for (const from of nonTerminalStates) {
        for (const to of ACCOUNT_STATUS_TRANSITIONS[from]) {
          expect(() =>
            assertValidAccountStatusTransition(from, to),
          ).not.toThrow();
        }
      }
    });

    it('allows a no-op transition from any state', () => {
      for (const status of Object.values(AccountStatus)) {
        expect(() =>
          assertValidAccountStatusTransition(status, status),
        ).not.toThrow();
      }
    });

    it('rejects invalid transitions from each non-terminal state', () => {
      const invalidPairs: Array<[AccountStatus, AccountStatus]> = [
        [AccountStatus.INITIALIZING, AccountStatus.CLAIMED],
        [AccountStatus.PENDING_PAYMENT, AccountStatus.CLAIMING],
        [AccountStatus.PENDING_CLAIM, AccountStatus.CLAIMED],
        [AccountStatus.CLAIMING, AccountStatus.PENDING_PAYMENT],
        [AccountStatus.PARTIAL_SWEEP, AccountStatus.PENDING_CLAIM],
      ];
      for (const [from, to] of invalidPairs) {
        expect(() => assertValidAccountStatusTransition(from, to)).toThrow(
          InvalidAccountStatusTransitionException,
        );
      }
    });

    it('rejects any transition out of terminal states', () => {
      for (const terminal of [
        AccountStatus.CLAIMED,
        AccountStatus.EXPIRED,
        AccountStatus.FAILED,
      ]) {
        for (const to of Object.values(AccountStatus)) {
          if (to === terminal) continue;
          expect(() =>
            assertValidAccountStatusTransition(terminal, to),
          ).toThrow(InvalidAccountStatusTransitionException);
        }
      }
    });
  });
});
