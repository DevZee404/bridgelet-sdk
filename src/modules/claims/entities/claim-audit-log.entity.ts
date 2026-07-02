import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type ClaimOutcome = 'success' | 'failure' | 'partial';

@Entity('claim_audit_log')
@Index(['accountId'])
@Index(['attemptedAt'])
export class ClaimAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  accountId: string;

  /** SHA-256 of the destination address — never stored in plain text */
  @Column({ type: 'varchar', length: 64 })
  destinationHash: string;

  /** SHA-256 of the requester IP — never stored in plain text */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ipHash: string | null;

  @Column({ type: 'varchar', length: 10 })
  outcome: ClaimOutcome;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn()
  attemptedAt: Date;
}
