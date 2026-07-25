import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('contract_events')
export class ContractEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_type', type: 'varchar', length: 255 })
  eventType: string;

  @Column({ name: 'contract_address', type: 'varchar', length: 128 })
  contractAddress: string;

  @Column({ name: 'ledger_sequence', type: 'bigint' })
  ledgerSequence: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 64 })
  txHash: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
