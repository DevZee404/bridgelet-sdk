import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import {
  SweepRetryQueueService,
  SweepRetryEntry,
} from './sweep-retry-queue.service.js';

let deadletterCounterInc: jest.Mock;
let resolvedDeadletterCounterInc: jest.Mock;

describe('SweepRetryQueueService', () => {
  let service: SweepRetryQueueService;

  beforeEach(async () => {
    deadletterCounterInc = jest.fn();
    resolvedDeadletterCounterInc = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SweepRetryQueueService,
        {
          provide: getToken('sweep_deadletter_total'),
          useValue: { inc: deadletterCounterInc },
        },
        {
          provide: getToken('sweep_deadletter_resolved_total'),
          useValue: { inc: resolvedDeadletterCounterInc },
        },
      ],
    }).compile();

    service = module.get<SweepRetryQueueService>(SweepRetryQueueService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('enqueue', () => {
    it('returns a non-terminal retry entry scheduled with the base delay', () => {
      const entry = service.enqueue('acc-1', 'Horizon unreachable');

      expect(entry).toMatchObject({
        accountId: 'acc-1',
        attempts: 1,
        maxAttempts: 5,
        terminal: false,
      });
      expect(entry!.nextRetryAt - entry!.lastAttemptAt).toBe(2_000);
      expect(service.pendingCount).toBe(1);
    });

    it.each([
      'ALREADY_SWEPT',
      'ACCOUNT_EXPIRED',
      'AlreadySwept',
      'AccountExpired',
      'NotInitialized',
    ])(
      'returns null and does not enqueue terminal error %s',
      (terminalError) => {
        const entry = service.enqueue('acc-1', terminalError + ': nope');

        expect(entry).toBeNull();
        expect(service.pendingCount).toBe(0);
      },
    );
  });

  describe('markAttempted', () => {
    it('removes the entry from the queue on success', () => {
      const entry = service.enqueue('acc-1', 'Horizon unreachable')!;

      service.markAttempted(entry, true);

      expect(service.pendingCount).toBe(0);
    });

    it('reschedules with exponential backoff on a retriable failure', () => {
      const entry = service.enqueue('acc-1', 'Horizon unreachable')!;

      service.markAttempted(entry, false, 'still down');

      expect(entry.attempts).toBe(2);
      expect(entry.lastError).toBe('still down');
      expect(entry.nextRetryAt - entry.lastAttemptAt).toBe(4_000);
      expect(service.pendingCount).toBe(1);
    });

    it('moves the entry to the dead-letter queue once max attempts are exhausted', () => {
      const entry = service.enqueue('acc-1', 'Horizon unreachable', 1)!;

      service.markAttempted(entry, false, 'permanent failure');

      expect(service.pendingCount).toBe(0);
      expect(service.deadLetterCount).toBe(1);
      expect(deadletterCounterInc).toHaveBeenCalledWith({
        account_id: 'acc-1',
      });
    });
  });

  describe('dead-letter queue', () => {
    let entry: SweepRetryEntry;

    beforeEach(() => {
      entry = service.enqueue('acc-2', 'Horizon unreachable', 1)!;
      service.markAttempted(entry, false, 'final failure');
    });

    it('resolves an unresolved entry and records resolution notes', () => {
      const [dlqEntry] = service.getDeadLetterEntries();

      const result = service.resolveDeadLetterEntry(dlqEntry.id, 'manual tx');

      expect(result).toBe(true);
      expect(dlqEntry.resolved).toBe(true);
      expect(dlqEntry.resolvedAt).toBeDefined();
      expect(dlqEntry.resolutionNotes).toBe('manual tx');
      expect(resolvedDeadletterCounterInc).toHaveBeenCalledWith({
        account_id: 'acc-2',
      });
    });

    it('returns false when resolving a missing or already-resolved entry', () => {
      expect(service.resolveDeadLetterEntry('does-not-exist')).toBe(false);

      const [dlqEntry] = service.getDeadLetterEntries();
      service.resolveDeadLetterEntry(dlqEntry.id);
      expect(service.resolveDeadLetterEntry(dlqEntry.id)).toBe(false);
    });

    it('excludes resolved entries by default and includes them when requested', () => {
      const [dlqEntry] = service.getDeadLetterEntries();
      service.resolveDeadLetterEntry(dlqEntry.id);

      expect(service.getDeadLetterEntries()).toHaveLength(0);
      expect(service.getDeadLetterEntries(true)).toHaveLength(1);
    });

    it('returns entries for a specific account only', () => {
      service.enqueue('acc-3', 'transient', 1);
      const otherEntry = service
        .getPendingEntries()
        .find((e) => e.accountId === 'acc-3')!;
      service.markAttempted(otherEntry, false, 'final failure');

      const acc2Entries = service.getDeadLetterEntriesForAccount('acc-2');
      const acc3Entries = service.getDeadLetterEntriesForAccount('acc-3');

      expect(acc2Entries).toHaveLength(1);
      expect(acc3Entries).toHaveLength(1);
    });

    it('returns undefined for an unknown dead-letter entry id', () => {
      expect(service.getDeadLetterEntryById('unknown')).toBeUndefined();
    });
  });

  describe('queue management', () => {
    it('returns only non-terminal pending entries', () => {
      const entry = service.enqueue('acc-1', 'transient error')!;

      expect(service.getPendingEntries()).toEqual([entry]);
      expect(service.pendingCount).toBe(1);
    });

    it('removes and clears entries', () => {
      const entry = service.enqueue('acc-1', 'transient error')!;

      expect(service.remove(entry.id)).toBe(true);
      expect(service.remove(entry.id)).toBe(false);

      service.enqueue('acc-1', 'transient error');
      service.clear();
      expect(service.pendingCount).toBe(0);
    });
  });

  describe('isTerminalError', () => {
    it('detects terminal error substrings', () => {
      expect(SweepRetryQueueService.isTerminalError('ALREADY_SWEPT')).toBe(
        true,
      );
      expect(SweepRetryQueueService.isTerminalError('ACCOUNT_EXPIRED')).toBe(
        true,
      );
      expect(SweepRetryQueueService.isTerminalError('temporary hiccup')).toBe(
        false,
      );
    });
  });

  describe('drain timer', () => {
    it('invokes the retry callback for entries whose retry time has arrived', () => {
      jest.useFakeTimers();
      const onRetry = jest.fn().mockResolvedValue(undefined);

      service.startDrainTimer(onRetry);
      service.enqueue('acc-1', 'transient error');

      jest.advanceTimersByTime(10_000);

      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'acc-1' }),
      );

      service.stopDrainTimer();
    });

    it('swallows errors thrown by the retry callback', () => {
      jest.useFakeTimers();
      const onRetry = jest.fn().mockRejectedValue(new Error('callback boom'));

      service.startDrainTimer(onRetry);
      service.enqueue('acc-1', 'transient error');

      jest.advanceTimersByTime(10_000);

      expect(onRetry).toHaveBeenCalled();
    });

    it('does not replace the callback when startDrainTimer runs a second time', () => {
      jest.useFakeTimers();
      const firstCallback = jest.fn().mockResolvedValue(undefined);
      const secondCallback = jest.fn().mockResolvedValue(undefined);

      service.startDrainTimer(firstCallback);
      service.startDrainTimer(secondCallback);
      service.enqueue('acc-1', 'transient error');

      jest.advanceTimersByTime(10_000);

      expect(firstCallback).toHaveBeenCalled();
      expect(secondCallback).not.toHaveBeenCalled();

      service.stopDrainTimer();
    });
  });
});
