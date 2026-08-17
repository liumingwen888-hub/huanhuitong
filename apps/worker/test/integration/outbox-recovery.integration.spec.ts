import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import {
  createStageOneHarness,
  RecordingTelegramBotGatewayImpl
} from '@xht/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresOutboxStore } from '../../src/outbox/outbox-store.js';
import { OutboxWorker } from '../../src/outbox/outbox-worker.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

describe('outbox recovery', () => {
  it(
    '16: redelivers after external success before local acknowledgement',
    { timeout: 120_000 },
    async () => {
      const gateway = new RecordingTelegramBotGatewayImpl();
      const harness = await createStageOneHarness({
        projectRoot,
        requestHandler: () => undefined
      });
      const workerPool = new Pool({
        connectionString: harness.workerLogin.connectionString,
        max: 4,
        application_name: 'xht-t13-recovery'
      });
      const connections = {
        withClient: async <T>(operation: (client: {
          query<R extends object>(
            text: string,
            values: readonly unknown[]
          ): Promise<{ rows: R[] }>;
        }) => Promise<T>): Promise<T> => {
          const client = await workerPool.connect();
          try {
            await client.query('SET ROLE xht_worker');
            return await operation({
              query: async <R extends object>(
                text: string,
                values: readonly unknown[]
              ) => {
                const result = await client.query(text, values as unknown[]);
                return { rows: result.rows as R[] };
              }
            });
          } finally {
            client.release();
          }
        }
      };
      try {
        // Seed one identity and one menu outbox row (business transaction
        // already committed; only delivery remains).
        const bindingId = randomUUID();
        const uid = randomUUID();
        await harness.query(
          `INSERT INTO users (uid, status) VALUES ($1::uuid, 'ACTIVE')`,
          [uid]
        );
        await harness.query(
          `INSERT INTO channel_bindings
             (binding_id, channel_type, external_user_id, uid, status)
           VALUES ($1::uuid, 'TELEGRAM', '8801', $2::uuid, 'ACTIVE')`,
          [bindingId, uid]
        );
        const eventId = randomUUID();
        await harness.query(
          `INSERT INTO outbox_messages
             (outbox_id, topic, event_key, version, payload, correlation_id,
              status, attempt_count, available_at)
           VALUES ($1::uuid, 'telegram.main-menu-requested.v1',
                   $2, 1, $3::jsonb, $4::uuid, 'READY', 0, clock_timestamp())`,
          [
            eventId,
            `telegram:menu:9801`,
            JSON.stringify({
              type: 'telegram.main-menu-requested.v1',
              eventId,
              uid,
              bindingId,
              menuVersion: 'main-menu-v1',
              occurredAt: '2026-08-17T12:00:00.000Z',
              correlationId: randomUUID()
            }),
            randomUUID()
          ]
        );

        const store = new PostgresOutboxStore(connections);
        const sendMenu = async (): Promise<void> => {
          await gateway.sendMainMenu({
            externalUserId: '8801',
            text: '请选择操作',
            buttons: [
              { id: 'account', label: '我的账户' },
              { id: 'help', label: '帮助' }
            ],
            idempotencyKey: `telegram:menu:9801`
          });
        };

        // External success, then a crash before local acknowledgement.
        const firstLease = await store.claimBatch({
          workerId: 'worker-crashed',
          limit: 1,
          leaseMilliseconds: 1
        });
        expect(firstLease).toHaveLength(1);
        await sendMenu();
        // no markSucceeded: the process "crashed" here.
        await new Promise((resolve) => setTimeout(resolve, 20));

        // A new worker re-delivers after lease expiry.
        const worker = new OutboxWorker(store, {
          handler: { handle: async () => { await sendMenu(); } },
          clock: { now: () => new Date() },
          workerId: 'worker-recovered'
        });
        const run = await worker.runOnce();
        expect(run.succeeded).toBe(1);

        // at-least-once: two deliveries, one idempotent effect, one audit.
        expect(gateway.deliveries).toHaveLength(2);
        expect(gateway.effects.size).toBe(1);
        expect(gateway.duplicateRisks).toEqual([
          { key: 'telegram:menu:9801', reason: 'duplicate-delivery' }
        ]);
        const rows = await harness.query<{ status: string }>(
          `SELECT status FROM outbox_messages WHERE outbox_id=$1::uuid`,
          [eventId]
        );
        expect(rows[0]?.status).toBe('SUCCEEDED');
      } finally {
        await workerPool.end();
        await harness.stop();
      }
    }
  );
});
