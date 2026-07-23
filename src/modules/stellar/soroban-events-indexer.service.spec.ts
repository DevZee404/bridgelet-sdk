import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import {
  SorobanEventsIndexerService,
  RawSorobanEvent,
} from './soroban-events-indexer.service.js';
import { ContractEvent } from './entities/contract-event.entity.js';

describe('SorobanEventsIndexerService', () => {
  let service: SorobanEventsIndexerService;

  const mockContractEventRepository = {
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest
      .fn()
      .mockImplementation((event) =>
        Promise.resolve({ id: 'event-uuid-123', ...event }),
      ),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      const map: Record<string, string> = {
        'stellar.sorobanRpcUrl': 'https://soroban-testnet.stellar.org',
        'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
      };
      if (!(key in map)) throw new Error(`Config key not found: ${key}`);
      return map[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanEventsIndexerService,
        {
          provide: getRepositoryToken(ContractEvent),
          useValue: mockContractEventRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<SorobanEventsIndexerService>(
      SorobanEventsIndexerService,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('parseEvent', () => {
    it('parses AccountCreated event correctly', () => {
      const raw: RawSorobanEvent = {
        type: 'contract',
        topic: ['AccountCreated'],
        contractId: 'CACCOUNT_CONTRACT',
        ledgerSequence: 12345,
        txHash: 'a'.repeat(64),
        payload: { owner: 'G123' },
      };

      const parsed = service.parseEvent(raw);
      expect(parsed).toEqual({
        eventType: 'AccountCreated',
        contractAddress: 'CACCOUNT_CONTRACT',
        ledgerSequence: '12345',
        txHash: 'a'.repeat(64),
        payload: { owner: 'G123' },
      });
    });

    it('parses PaymentReceived event correctly', () => {
      const raw: RawSorobanEvent = {
        type: 'contract',
        topic: ['PaymentReceived'],
        contractAddress: 'CPAYMENT_CONTRACT',
        ledger: 67890,
        transactionHash: 'b'.repeat(64),
        value: { amount: '100' },
      };

      const parsed = service.parseEvent(raw);
      expect(parsed).toEqual({
        eventType: 'PaymentReceived',
        contractAddress: 'CPAYMENT_CONTRACT',
        ledgerSequence: '67890',
        txHash: 'b'.repeat(64),
        payload: { amount: '100' },
      });
    });

    it('parses SweepExecutedMulti event correctly', () => {
      const raw: RawSorobanEvent = {
        type: 'SweepExecutedMulti',
        contractId: 'CSWEEP_CONTRACT',
        ledger: 100,
        txHash: 'c'.repeat(64),
        payload: { count: 3 },
      };

      const parsed = service.parseEvent(raw);
      expect(parsed).toEqual({
        eventType: 'SweepExecutedMulti',
        contractAddress: 'CSWEEP_CONTRACT',
        ledgerSequence: '100',
        txHash: 'c'.repeat(64),
        payload: { count: 3 },
      });
    });

    it('parses AccountExpired event correctly', () => {
      const raw: RawSorobanEvent = {
        type: 'contract',
        topic: ['AccountExpired'],
        contractId: 'CEXP_CONTRACT',
        ledgerSequence: 200,
        txHash: 'd'.repeat(64),
        value: 'expired',
      };

      const parsed = service.parseEvent(raw);
      expect(parsed).toEqual({
        eventType: 'AccountExpired',
        contractAddress: 'CEXP_CONTRACT',
        ledgerSequence: '200',
        txHash: 'd'.repeat(64),
        payload: { value: 'expired' },
      });
    });

    it('returns null for non-matching event types', () => {
      const raw: RawSorobanEvent = {
        type: 'contract',
        topic: ['UnknownEvent'],
      };

      const parsed = service.parseEvent(raw);
      expect(parsed).toBeNull();
    });
  });

  describe('pollEvents', () => {
    it('fetches events via RPC, parses, deduplicates and saves them', async () => {
      const rawRpcEvents: RawSorobanEvent[] = [
        {
          type: 'contract',
          topic: ['AccountCreated'],
          contractId: 'C1',
          ledgerSequence: 10,
          txHash: '1'.repeat(64),
          payload: { test: 1 },
        },
      ];

      jest
        .spyOn(service, 'fetchEventsFromRpc')
        .mockResolvedValueOnce(rawRpcEvents);
      mockContractEventRepository.findOne.mockResolvedValueOnce(null);

      const events = await service.pollEvents(100);

      expect(events).toHaveLength(1);
      expect(mockContractEventRepository.create).toHaveBeenCalledWith({
        eventType: 'AccountCreated',
        contractAddress: 'C1',
        ledgerSequence: '10',
        txHash: '1'.repeat(64),
        payload: { test: 1 },
      });
      expect(mockContractEventRepository.save).toHaveBeenCalled();
    });

    it('skips saving if event already exists in database', async () => {
      const rawRpcEvents: RawSorobanEvent[] = [
        {
          type: 'contract',
          topic: ['PaymentReceived'],
          contractId: 'C2',
          ledgerSequence: 20,
          txHash: '2'.repeat(64),
        },
      ];

      jest
        .spyOn(service, 'fetchEventsFromRpc')
        .mockResolvedValueOnce(rawRpcEvents);
      mockContractEventRepository.findOne.mockResolvedValueOnce({
        id: 'existing-id',
      });

      const events = await service.pollEvents();

      expect(events).toHaveLength(0);
      expect(mockContractEventRepository.save).not.toHaveBeenCalled();
    });

    it('falls back to Horizon /events if RPC fails', async () => {
      const rawHorizonEvents: RawSorobanEvent[] = [
        {
          type: 'contract',
          topic: ['SweepExecutedMulti'],
          contractId: 'C3',
          ledgerSequence: 30,
          txHash: '3'.repeat(64),
        },
      ];

      jest
        .spyOn(service, 'fetchEventsFromRpc')
        .mockRejectedValueOnce(new Error('RPC Error'));
      jest
        .spyOn(service, 'fetchEventsFromHorizon')
        .mockResolvedValueOnce(rawHorizonEvents);
      mockContractEventRepository.findOne.mockResolvedValueOnce(null);

      const events = await service.pollEvents();

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('SweepExecutedMulti');
    });

    it('handles HTTP error in fetchEventsFromHorizon gracefully', async () => {
      jest
        .spyOn(service, 'fetchEventsFromRpc')
        .mockRejectedValueOnce(new Error('RPC Error'));
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: false, status: 500 } as Response);

      const events = await service.pollEvents();
      expect(events).toEqual([]);
    });

    it('successfully fetches events from Horizon endpoint when HTTP response is ok', async () => {
      const rawEvent = {
        type: 'contract',
        topic: ['AccountExpired'],
        contractId: 'CHORIZON',
        ledgerSequence: 50,
        txHash: '5'.repeat(64),
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ events: [rawEvent] }),
      } as Response);

      const events = await service.fetchEventsFromHorizon(100);
      expect(events).toHaveLength(1);
      expect(events[0].topic).toContain('AccountExpired');
    });

    it('fetches events via Soroban RPC getEvents()', async () => {
      const getEventsSpy = jest
        .spyOn(service['sorobanServer'], 'getEvents')
        .mockResolvedValueOnce({ events: [{ id: 'rpc-event-1' }] } as any);

      const result = await service.fetchEventsFromRpc(500);

      expect(getEventsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 500 }),
      );
      expect(result).toHaveLength(1);
    });
  });
});
