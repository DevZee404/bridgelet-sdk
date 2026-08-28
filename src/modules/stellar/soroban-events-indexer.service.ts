import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { ContractEvent } from './entities/contract-event.entity.js';

export const TARGET_CONTRACT_EVENTS = [
  'AccountCreated',
  'PaymentReceived',
  'SweepExecutedMulti',
  'AccountExpired',
] as const;

export type TargetEventType = (typeof TARGET_CONTRACT_EVENTS)[number];

export interface RawSorobanEvent {
  id?: string;
  type?: string;
  ledger?: number | string;
  ledgerSequence?: number | string;
  contractId?: string;
  contractAddress?: string;
  topic?: string[] | unknown[];
  value?: unknown;
  txHash?: string;
  transactionHash?: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class SorobanEventsIndexerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SorobanEventsIndexerService.name);
  private readonly sorobanServer: SorobanRpc.Server;
  private readonly horizonUrl: string;
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(ContractEvent)
    private readonly contractEventRepository: Repository<ContractEvent>,
    private readonly configService: ConfigService,
  ) {
    const sorobanRpcUrl = this.configService.getOrThrow<string>(
      'stellar.sorobanRpcUrl',
    );
    this.horizonUrl =
      this.configService.getOrThrow<string>('stellar.horizonUrl');
    this.sorobanServer = new SorobanRpc.Server(sorobanRpcUrl);
  }

  onModuleInit(): void {
    const intervalMs = parseInt(
      this.configService.get<string>('stellar.contractEventPollIntervalMs') ??
        '30000',
      10,
    );

    this.pollHandle = setInterval(
      () => void this.pollLatestEvents(),
      intervalMs,
    );
    this.logger.log(
      `Contract event polling started (interval: ${intervalMs}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.logger.log('Contract event polling stopped');
  }

  async pollLatestEvents(): Promise<void> {
    try {
      const latestEvent = await this.contractEventRepository.findOne({
        order: { ledgerSequence: 'DESC' },
      });
      const startLedger = latestEvent
        ? Number(latestEvent.ledgerSequence) + 1
        : undefined;
      await this.pollEvents(startLedger);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Contract event poll failed: ${message}`);
    }
  }

  /**
   * Polls Soroban RPC / Horizon for contract events and persists matching
   * events (AccountCreated, PaymentReceived, SweepExecutedMulti, AccountExpired)
   * into the contract_events table.
   */
  async pollEvents(startLedger?: number): Promise<ContractEvent[]> {
    this.logger.debug(
      `Polling contract events starting from ledger ${startLedger ?? 'latest'}`,
    );

    let rawEvents: RawSorobanEvent[] = [];

    try {
      rawEvents = await this.fetchEventsFromRpc(startLedger);
    } catch (rpcErr) {
      this.logger.warn(
        `RPC getEvents failed: ${(rpcErr as Error).message}. Attempting Horizon /events fallback.`,
      );
      try {
        rawEvents = await this.fetchEventsFromHorizon(startLedger);
      } catch (horizonErr) {
        this.logger.error(
          `Failed to fetch events from Horizon: ${(horizonErr as Error).message}`,
        );
        return [];
      }
    }

    const savedEvents: ContractEvent[] = [];

    for (const raw of rawEvents) {
      const parsed = this.parseEvent(raw);
      if (!parsed) continue;

      // Check for deduplication
      const existing = await this.contractEventRepository.findOne({
        where: {
          txHash: parsed.txHash,
          eventType: parsed.eventType,
          contractAddress: parsed.contractAddress,
        },
      });

      if (existing) continue;

      const eventEntity = this.contractEventRepository.create({
        eventType: parsed.eventType,
        contractAddress: parsed.contractAddress,
        ledgerSequence: parsed.ledgerSequence,
        txHash: parsed.txHash,
        payload: parsed.payload,
      });

      try {
        const saved = await this.contractEventRepository.save(eventEntity);
        savedEvents.push(saved);
        this.logger.log(
          `Indexed contract event ${saved.eventType} for ${saved.contractAddress} (ledger ${saved.ledgerSequence})`,
        );
      } catch (err: unknown) {
        if (!this.isUniqueViolation(err)) throw err;
      }
    }

    return savedEvents;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    );
  }

  /**
   * Fetches raw events from Soroban RPC using sorobanServer.getEvents()
   */
  public async fetchEventsFromRpc(
    startLedger?: number,
  ): Promise<RawSorobanEvent[]> {
    const filters: SorobanRpc.Api.EventFilter[] = [
      {
        type: 'contract',
        topics: [TARGET_CONTRACT_EVENTS.map((e) => e)],
      },
    ];

    const response = await this.sorobanServer.getEvents({
      startLedger: startLedger ?? 1,
      filters,
    });

    return (response.events ?? []) as unknown as RawSorobanEvent[];
  }

  /**
   * Fallback: Fetches raw events directly from Horizon /events HTTP endpoint
   */
  public async fetchEventsFromHorizon(
    startLedger?: number,
  ): Promise<RawSorobanEvent[]> {
    const url = new URL(`${this.horizonUrl}/events`);
    if (startLedger) {
      url.searchParams.set('start_ledger', startLedger.toString());
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Horizon /events returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as { events?: RawSorobanEvent[] };
    return data.events ?? [];
  }

  /**
   * Parses and validates a raw event object into a structured payload if it matches
   * one of the target event types.
   */
  public parseEvent(raw: RawSorobanEvent): {
    eventType: string;
    contractAddress: string;
    ledgerSequence: string;
    txHash: string;
    payload: Record<string, unknown>;
  } | null {
    let eventType: string | undefined;

    // Check topics for target event type
    if (Array.isArray(raw.topic)) {
      for (const t of raw.topic) {
        const topicStr = String(t);
        if ((TARGET_CONTRACT_EVENTS as readonly string[]).includes(topicStr)) {
          eventType = topicStr;
          break;
        }
      }
    }

    if (!eventType && typeof raw.type === 'string') {
      if ((TARGET_CONTRACT_EVENTS as readonly string[]).includes(raw.type)) {
        eventType = raw.type;
      }
    }

    if (!eventType) return null;

    const contractAddress =
      raw.contractAddress ?? raw.contractId ?? 'unknown_contract';
    const ledgerSequence = String(raw.ledgerSequence ?? raw.ledger ?? 0);
    const txHash = raw.txHash ?? raw.transactionHash ?? '0'.repeat(64);

    let payload: Record<string, unknown> = {};
    if (raw.payload && typeof raw.payload === 'object') {
      payload = raw.payload;
    } else if (raw.value && typeof raw.value === 'object') {
      payload = raw.value as Record<string, unknown>;
    } else if (raw.value !== undefined) {
      payload = { value: raw.value };
    }

    return {
      eventType,
      contractAddress,
      ledgerSequence,
      txHash,
      payload,
    };
  }
}
