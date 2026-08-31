import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Webhook } from './webhook.entity.js';

@Entity('webhook_deliveries')
@Index('IDX_webhook_deliveries_subscription_id_created_at', [
  'subscriptionId',
  'createdAt',
])
export class WebhookDelivery {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  @ManyToOne(() => Webhook, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'subscription_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'FK_webhook_deliveries_subscription_id',
  })
  subscription: Webhook;

  @Column({ name: 'event_type', type: 'varchar', length: 255 })
  eventType: string;

  @Column({ name: 'payload_hash', type: 'varchar', length: 128 })
  payloadHash: string;

  @Column({ name: 'attempt_count', type: 'integer', default: 1 })
  attemptCount: number;

  @Column({ name: 'last_response_code', type: 'integer', nullable: true })
  lastResponseCode: number | null;

  @Column({
    name: 'last_response_body',
    type: 'varchar',
    length: 2048,
    nullable: true,
  })
  lastResponseBody: string | null;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
