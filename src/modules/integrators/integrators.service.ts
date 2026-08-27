import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { Integrator } from './entities/integrator.entity.js';
import { IntegratorRole } from './entities/integrator-role.enum.js';

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

@Injectable()
export class IntegratorsService {
  constructor(
    @InjectRepository(Integrator)
    private readonly integratorsRepository: Repository<Integrator>,
  ) {}

  /** Returns the integrator for an active (non-disabled) API key, or null. */
  async findActiveByApiKey(rawKey: string): Promise<Integrator | null> {
    return this.integratorsRepository.findOne({
      where: { apiKeyHash: hashApiKey(rawKey), disabledAt: IsNull() },
    });
  }

  /**
   * Mints a new integrator + raw API key. The raw key is returned exactly
   * once here and is not retrievable afterwards — only its hash is stored.
   * Intended for use by scripts/create-integrator.ts, not by any HTTP
   * endpoint (no self-service signup in the minimal version).
   */
  async create(
    name: string,
    role: IntegratorRole = IntegratorRole.Integrator,
  ): Promise<{ integrator: Integrator; rawApiKey: string }> {
    const rawApiKey = `bk_${randomBytes(32).toString('hex')}`;
    const integrator = await this.integratorsRepository.save(
      this.integratorsRepository.create({
        name,
        apiKeyHash: hashApiKey(rawApiKey),
        role,
      }),
    );
    return { integrator, rawApiKey };
  }
}
