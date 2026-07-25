import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  ClaimAuditLog,
  ClaimOutcome,
} from '../entities/claim-audit-log.entity.js';

export interface AuditClaimAttemptParams {
  accountId: string;
  destination: string;
  ip?: string | null;
  outcome: ClaimOutcome;
  failureReason?: string | null;
}

@Injectable()
export class ClaimAuditProvider {
  private readonly logger = new Logger(ClaimAuditProvider.name);

  constructor(
    @InjectRepository(ClaimAuditLog)
    private readonly auditRepository: Repository<ClaimAuditLog>,
  ) {}

  async record(params: AuditClaimAttemptParams): Promise<void> {
    try {
      const entry = this.auditRepository.create({
        accountId: params.accountId,
        destinationHash: this.hash(params.destination),
        ipHash: params.ip ? this.hash(params.ip) : null,
        outcome: params.outcome,
        failureReason: params.failureReason ?? null,
      });
      await this.auditRepository.save(entry);
    } catch (err) {
      // Audit failures must never surface to the caller.
      this.logger.error(
        `Failed to write claim audit log for account ${params.accountId}: ${(err as Error).message}`,
      );
    }
  }

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
