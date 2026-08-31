import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  SweepMonitorService,
  SweepTransactionCallback,
} from './sweep-monitor.service.js';

type StreamHandlers = {
  onmessage?: (tx: Record<string, unknown>) => void;
  onerror?: (err: unknown) => void;
  onclose?: () => void;
};

const mockConfigService = {
  getOrThrow: (key: string): string => {
    if (key === 'stellar.horizonUrl')
      return 'https://horizon-testnet.stellar.org';
    throw new Error('Config key not found: ' + key);
  },
};

describe('SweepMonitorService', () => {
  let service: SweepMonitorService;
  let server: {
    transactions: jest.Mock;
    streamHandler: StreamHandlers;
    closeFn: jest.Mock;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SweepMonitorService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SweepMonitorService>(SweepMonitorService);

    server = {
      streamHandler: {},
      closeFn: jest.fn(),
      transactions: jest.fn().mockReturnValue({
        transaction: jest.fn().mockReturnValue({
          stream: jest.fn().mockImplementation((handlers: StreamHandlers) => {
            server.streamHandler = handlers;
            return server.closeFn;
          }),
        }),
      }),
    };
    (service as unknown as { server: unknown }).server = server;
  });

  it('monitorTransaction registers an active stream for a new hash', () => {
    service.monitorTransaction('tx-hash-1', 'acc-1', jest.fn());

    expect(server.transactions).toHaveBeenCalledTimes(1);
    expect(service.activeStreamCount).toBe(1);
  });

  it('monitorTransaction does not duplicate a stream already being monitored', () => {
    const callback = jest.fn();
    service.monitorTransaction('tx-hash-1', 'acc-1', callback);
    service.monitorTransaction('tx-hash-1', 'acc-1', callback);

    expect(server.transactions).toHaveBeenCalledTimes(1);
    expect(service.activeStreamCount).toBe(1);
  });

  it('calls the callback with success status when the stream reports success', () => {
    const callback: SweepTransactionCallback = jest.fn();
    service.monitorTransaction('tx-hash-1', 'acc-1', callback);

    server.streamHandler.onmessage?.({
      hash: 'tx-hash-1',
      successful: true,
      ledger: 100,
      result_xdr: 'AAAA',
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: 'tx-hash-1',
        accountId: 'acc-1',
        status: 'success',
        ledger: 100,
        resultCode: 'AAAA',
      }),
    );
    expect(service.activeStreamCount).toBe(0);
  });

  it('calls the callback with failed status when the stream reports failure', () => {
    const callback: SweepTransactionCallback = jest.fn();
    service.monitorTransaction('tx-hash-1', 'acc-1', callback);

    server.streamHandler.onmessage?.({
      hash: 'tx-hash-1',
      successful: false,
      ledger: 101,
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', ledger: 101 }),
    );
  });

  it('calls the callback with the stream error when onerror fires', () => {
    const callback: SweepTransactionCallback = jest.fn();
    service.monitorTransaction('tx-hash-1', 'acc-1', callback);

    server.streamHandler.onerror?.(new Error('boom'));

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: 'tx-hash-1',
        accountId: 'acc-1',
        status: 'failed',
        error: 'boom',
      }),
    );
    expect(service.activeStreamCount).toBe(0);
  });

  it('handles string and unknown onerror payloads without crashing', () => {
    const callback: SweepTransactionCallback = jest.fn();
    service.monitorTransaction('tx-hash-1', 'acc-1', callback);

    server.streamHandler.onerror?.('stream reset');

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'stream reset' }),
    );

    service.monitorTransaction('tx-hash-2', 'acc-1', jest.fn());
    server.streamHandler.onerror?.(42);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('monitorAccount registers a callback and returns an unsubscribe function', () => {
    const callback = jest.fn();

    const unsubscribe = service.monitorAccount('acc-1', callback);
    expect(unsubscribe).toBeInstanceOf(Function);

    unsubscribe();
  });

  it('stopMonitoringTransaction closes the active stream for the hash', () => {
    service.monitorTransaction('tx-hash-1', 'acc-1', jest.fn());
    expect(service.activeStreamCount).toBe(1);

    service.stopMonitoringTransaction('tx-hash-1');

    expect(server.closeFn).toHaveBeenCalledTimes(1);
    expect(service.activeStreamCount).toBe(0);
  });

  it('stopAll closes every active stream and clears the maps', () => {
    service.monitorTransaction('tx-hash-1', 'acc-1', jest.fn());
    service.monitorTransaction('tx-hash-2', 'acc-2', jest.fn());
    expect(service.activeStreamCount).toBe(2);

    service.stopAll();

    expect(server.closeFn).toHaveBeenCalledTimes(2);
    expect(service.activeStreamCount).toBe(0);
  });
});
