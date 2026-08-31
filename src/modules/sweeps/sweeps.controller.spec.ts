import { Test, TestingModule } from '@nestjs/testing';
import { SweepsController } from './sweeps.controller.js';
import { SweepsService } from './sweeps.service.js';
import { DeadLetterSweepEntry } from './sweep-retry-queue.service.js';

const deadLetterEntry = (partial: Partial<DeadLetterSweepEntry> = {}) => ({
  id: 'dlq-1',
  originalSweepId: 'sweep-1',
  accountId: 'acc-1',
  totalAttempts: 5,
  movedToDlqAt: Date.now(),
  lastError: 'final failure',
  resolved: false,
  ...partial,
});

describe('SweepsController', () => {
  let controller: SweepsController;
  let sweepsService: {
    getSweepById: jest.Mock;
    getDeadLetterSweeps: jest.Mock;
    getDeadLetterSweepById: jest.Mock;
    getDeadLetterSweepsForAccount: jest.Mock;
    resolveDeadLetterSweep: jest.Mock;
  };

  beforeEach(async () => {
    sweepsService = {
      getSweepById: jest.fn(),
      getDeadLetterSweeps: jest.fn(),
      getDeadLetterSweepById: jest.fn(),
      getDeadLetterSweepsForAccount: jest.fn(),
      resolveDeadLetterSweep: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SweepsController],
      providers: [{ provide: SweepsService, useValue: sweepsService }],
    }).compile();

    controller = module.get<SweepsController>(SweepsController);
  });

  describe('getSweepStatus', () => {
    it('delegates to sweepsService.getSweepById', async () => {
      const status = { status: 'completed' };
      sweepsService.getSweepById.mockResolvedValue(status);

      await expect(controller.getSweepStatus('acc-1')).resolves.toBe(status);
      expect(sweepsService.getSweepById).toHaveBeenCalledWith('acc-1');
    });
  });

  describe('getDeadLetterSweeps', () => {
    it('returns dead-letter entries excluding resolved ones by default', () => {
      sweepsService.getDeadLetterSweeps.mockReturnValue([deadLetterEntry()]);

      const result = controller.getDeadLetterSweeps();

      expect(result).toHaveLength(1);
      expect(sweepsService.getDeadLetterSweeps).toHaveBeenCalledWith(false);
    });

    it('passes includeResolved=true down to the service', () => {
      sweepsService.getDeadLetterSweeps.mockReturnValue([]);

      controller.getDeadLetterSweeps(true);

      expect(sweepsService.getDeadLetterSweeps).toHaveBeenCalledWith(true);
    });
  });

  describe('getDeadLetterSweepById', () => {
    it('returns the matching entry', () => {
      sweepsService.getDeadLetterSweepById.mockReturnValue(deadLetterEntry());

      const result = controller.getDeadLetterSweepById('dlq-1');

      expect(result?.id).toBe('dlq-1');
      expect(sweepsService.getDeadLetterSweepById).toHaveBeenCalledWith(
        'dlq-1',
      );
    });

    it('returns undefined when the entry does not exist', () => {
      sweepsService.getDeadLetterSweepById.mockReturnValue(undefined);

      expect(controller.getDeadLetterSweepById('missing')).toBeUndefined();
    });
  });

  describe('getDeadLetterSweepsForAccount', () => {
    it('passes the account id and includeResolved flag through', () => {
      sweepsService.getDeadLetterSweepsForAccount.mockReturnValue([]);

      controller.getDeadLetterSweepsForAccount('acc-1', true);

      expect(sweepsService.getDeadLetterSweepsForAccount).toHaveBeenCalledWith(
        'acc-1',
        true,
      );
    });

    it('defaults includeResolved to false', () => {
      sweepsService.getDeadLetterSweepsForAccount.mockReturnValue([]);

      controller.getDeadLetterSweepsForAccount('acc-1');

      expect(sweepsService.getDeadLetterSweepsForAccount).toHaveBeenCalledWith(
        'acc-1',
        false,
      );
    });
  });

  describe('resolveDeadLetterSweep', () => {
    it('returns success when the entry was resolved', () => {
      sweepsService.resolveDeadLetterSweep.mockReturnValue(true);

      const result = controller.resolveDeadLetterSweep('dlq-1', {
        resolutionNotes: 'manual fix',
      });

      expect(result).toEqual({ success: true });
      expect(sweepsService.resolveDeadLetterSweep).toHaveBeenCalledWith(
        'dlq-1',
        'manual fix',
      );
    });

    it('returns failure for a missing or already-resolved entry', () => {
      sweepsService.resolveDeadLetterSweep.mockReturnValue(false);

      const result = controller.resolveDeadLetterSweep('dlq-1', {});

      expect(result).toEqual({ success: false });
    });
  });
});
