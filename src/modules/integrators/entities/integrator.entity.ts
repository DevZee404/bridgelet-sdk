import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { IntegratorRole } from './integrator-role.enum.js';

/**
 * A caller of the /accounts API (server-to-server, not a human end-user).
 * Auth is by API key (see ApiKeyAuthGuard), not JWT: see
 * src/modules/accounts/FUTURE_AUTH_SCOPING.md for the design rationale.
 *
 * The raw API key is never stored - only its SHA-256 hash. The raw value is
 * shown to the caller exactly once, at creation time (see
 * src/scripts/create-integrator.ts).
 */
@Entity('integrators')
export class Integrator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', unique: true })
  @Index('IDX_integrators_apiKeyHash')
  apiKeyHash: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** Null = active. Set to revoke instantly without deleting the row. */
  @Column({ type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  /** Access tier — determines which endpoints this key may call. */
  @Column({
    type: 'text',
    default: IntegratorRole.Integrator,
  })
  role: IntegratorRole;
}
