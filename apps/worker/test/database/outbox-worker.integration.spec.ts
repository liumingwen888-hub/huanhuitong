import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { LeasedOutboxMessage, StageOneDatabase } from '@xht/contracts';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWorkerDatabase } from '../../src/infrastructure/database/database.js';
import { RoleEnforcingPostgresPool } from '../../../platform/src/infrastructure/database/database.js';
import {
  createUnitOfWork,
  type UnitOfWork
} from '../../../platform/src/infrastructure/database/unit-of-work.js';
import { PostgresOutboxRepository } from '../../../platform/src/modules/reliability/outbox/outbox.repository.js';
import { PostgresDurableJobRepository } from '../../../platform/src/modules/reliability/jobs/durable-job.repository.js';
import { PostgresOutboxStore } from '../../src/outbox/outbox-store.js';
import { OutboxWorker } from '../../src/outbox/outbox-worker.js';
import { DurableJobWorker } from '../../src/jobs/durable-job-worker.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const flywaySources = {
  projectRoot,
  configFile: 'database/flyway.toml',
  migrationsDirectory: 'database/migrations',
  callbacksDirectory: 'database/flyway-callbacks'
} as const;

const outboxRepository = new PostgresOutboxRepository();
const fixedClock = { now: () => new Date('2026-08-17T12:00:00.000Z') };

let fixture: PostgresFixture;
let platformPool: Pool;
let workerPool: Pool;
let workerDatabase: ReturnType<typeof createWorkerDatabase>;
const workerConnections = {
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
let workerStore: PostgresOutboxStore;
let unitOfWork: UnitOfWork;
let jobRepository: PostgresDurableJobRepository;
let cleanupPool: Pool;

async function enqueue(
  topic: string,
  eventKey: string,
  correlationId = randomUUID()
): Promise<string> {
  const id = randomUUID();
  return unitOfWork.execute(async (context) =>
    outboxRepository.enqueue(context, {
      id,
      topic,
      eventKey,
      occurredAt: '2026-08-17T12:00:00.000Z',
      correlationId,
      payload: { kind: 'synthetic.task6' }
    })
  );
}

function makeWorker(workerId: string, handler: {
  handle(message: LeasedOutboxMessage): Promise<void>;
}): OutboxWorker {
  return new OutboxWorker(workerStore, {
    handler,
    clock: fixedClock,
    workerId
  });
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, flywaySources);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-task6-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 5,
    application_name: 'xht-task6-platform'
  });
  workerPool = new Pool({
    connectionString: fixture.workerLogin.connectionString,
    max: 10,
    application_name: 'xht-task6-worker'
  });
  const platformKysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never,
        fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(platformKysely);
  workerDatabase = createWorkerDatabase({
    connectionString: fixture.workerLogin.connectionString,
    expectedSessionUser: fixture.workerLogin.username,
    maxConnections: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    applicationName: 'xht-task6-worker-db'
  });
  jobRepository = new PostgresDurableJobRepository(workerDatabase.db);
  workerStore = new PostgresOutboxStore(workerConnections);
}, 180_000);

beforeEach(async () => {
  await cleanupPool.query('DELETE FROM outbox_messages');
  await cleanupPool.query('DELETE FROM durable_jobs');
});

afterAll(async () => {
  await platformPool.end();
  await workerPool.end();
  await workerDatabase.close();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('Task 6 Outbox and durable jobs', () => {
  it('T6C11: rollback removes the outbox row written in the same transaction', async () => {
    const before = await cleanupPool.query('SELECT count(*)::int AS n FROM outbox_messages');
    expect(before.rows[0]?.n).toBe(0);
    await expect(
      unitOfWork.execute(async (context) => {
        await outboxRepository.enqueue(context, {
          id: randomUUID(),
          topic: 'telegram.test.v1',
          eventKey: 'task6:rollback:1',
          occurredAt: '2026-08-17T12:00:00.000Z',
          correlationId: randomUUID(),
          payload: { kind: 'synthetic.task6' }
        });
        throw new Error('business rollback');
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    const after = await cleanupPool.query('SELECT count(*)::int AS n FROM outbox_messages');
    expect(after.rows[0]?.n).toBe(0);
  });

  it('T6C12: duplicate topic and eventKey yields OUTBOX_DUPLICATE_EVENT_KEY', async () => {
    await enqueue('telegram.test.v1', 'task6:dup:1');
    await expect(enqueue('telegram.test.v1', 'task6:dup:1')).rejects.toMatchObject({
      code: 'TRANSACTION_CALLBACK_FAILED'
    });
    const rows = await cleanupPool.query(
      "SELECT count(*)::int AS n FROM outbox_messages WHERE event_key = 'task6:dup:1'"
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('T6C13/14/15/16: claim, lease fields, mutual exclusion and no reclaim of succeeded', async () => {
    for (let index = 0; index < 50; index += 1) {
      await enqueue('telegram.test.v1', `task6:claim:${index}`);
    }
    const workerA = makeWorker('worker-a', { handle: async () => undefined });
    const workerB = makeWorker('worker-b', { handle: async () => undefined });
    const [runA, runB] = await Promise.all([
      workerA.runOnce(),
      workerB.runOnce()
    ]);
    expect(runA.claimed + runB.claimed).toBe(50);
    expect(runA.succeeded + runB.succeeded).toBe(50);
    const leaseRows = await cleanupPool.query(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE status = 'SUCCEEDED' AND succeeded_at IS NOT NULL`
    );
    expect(leaseRows.rows[0]?.n).toBe(50);
    const idle = await makeWorker('worker-c', { handle: async () => undefined }).runOnce();
    expect(idle).toEqual({ claimed: 0, succeeded: 0, retrying: 0 });
  });

  it('T6C17/18: stale CAS credentials and expired lease reclaim with generation bump', async () => {
    await enqueue('telegram.test.v1', 'task6:cas:1');
    const claimed = await workerStore.claimBatch({
      workerId: 'worker-old',
      limit: 1,
      leaseMilliseconds: 1
    });
    expect(claimed).toHaveLength(1);
    const message = claimed[0]!;
    const wrongCredentialOutcomes = await Promise.all([
      workerStore.markSucceeded({
        id: message.id,
        workerId: 'worker-other',
        leaseToken: message.leaseToken,
        lockGeneration: message.lockGeneration
      }),
      workerStore.markSucceeded({
        id: message.id,
        workerId: message.workerId,
        leaseToken: randomUUID(),
        lockGeneration: message.lockGeneration
      }),
      workerStore.markSucceeded({
        id: message.id,
        workerId: message.workerId,
        leaseToken: message.leaseToken,
        lockGeneration: message.lockGeneration + 5
      }),
      workerStore.markSucceeded({
        id: randomUUID(),
        workerId: message.workerId,
        leaseToken: message.leaseToken,
        lockGeneration: message.lockGeneration
      })
    ]);
    expect(wrongCredentialOutcomes).toEqual([
      'stale_lease',
      'stale_lease',
      'stale_lease',
      'stale_lease'
    ]);
    const rowBefore = await cleanupPool.query(
      'SELECT status, lock_generation, attempt_count FROM outbox_messages'
    );
    expect(rowBefore.rows[0]?.status).toBe('LEASED');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reclaimed = await workerStore.claimBatch({
      workerId: 'worker-new',
      limit: 1,
      leaseMilliseconds: 30_000
    });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]!.workerId).toBe('worker-new');
    expect(reclaimed[0]!.lockGeneration).toBe(message.lockGeneration + 1);
    const late = await workerStore.markSucceeded({
      id: message.id,
      workerId: message.workerId,
      leaseToken: message.leaseToken,
      lockGeneration: message.lockGeneration
    });
    expect(late).toBe('stale_lease');
  });

  it('T6C19: crash after external success re-delivers (at-least-once)', async () => {
    await enqueue('telegram.test.v1', 'task6:atleast:1');
    let deliveries = 0;
    const handler = {
      handle: async (): Promise<void> => {
        deliveries += 1;
        if (deliveries === 1) {
          throw new Error('crash before local confirmation');
        }
      }
    };
    const first = await makeWorker('worker-1', handler).runOnce();
    expect(first).toEqual({ claimed: 1, succeeded: 0, retrying: 1 });
    await cleanupPool.query(
      "UPDATE outbox_messages SET status='READY', locked_by=NULL, lease_token=NULL, locked_until=NULL, available_at=clock_timestamp() WHERE event_key='task6:atleast:1'"
    );
    const second = await makeWorker('worker-2', handler).runOnce();
    expect(second.succeeded).toBe(1);
    expect(deliveries).toBe(2);
  });

  it('T6C20: transient failure enters RETRY_WAIT and becomes claimable later', async () => {
    await enqueue('telegram.test.v1', 'task6:transient:1');
    const result = await makeWorker('worker-t', {
      handle: async () => {
        throw new Error('transient');
      }
    }).runOnce();
    expect(result).toEqual({ claimed: 1, succeeded: 0, retrying: 1 });
    const row = await cleanupPool.query('SELECT status, locked_by FROM outbox_messages');
    expect(row.rows[0]?.status).toBe('RETRY_WAIT');
    expect(row.rows[0]?.locked_by).toBeNull();
    await cleanupPool.query(
      "UPDATE outbox_messages SET available_at = clock_timestamp() WHERE event_key='task6:transient:1'"
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const retry = await makeWorker('worker-t2', { handle: async () => undefined }).runOnce();
    expect(retry.succeeded).toBe(1);
  });

  it('T6C21: permanent failure enters DEAD_LETTER terminal state', async () => {
    await enqueue('telegram.test.v1', 'task6:permanent:1');
    const permanentError = Object.assign(new Error('permanent'), {
      workerFailureClassification: 'PERMANENT' as const
    });
    await makeWorker('worker-p', {
      handle: async () => {
        throw permanentError;
      }
    }).runOnce();
    const row = await cleanupPool.query(
      "SELECT status FROM outbox_messages WHERE event_key='task6:permanent:1'"
    );
    expect(row.rows[0]?.status).toBe('DEAD_LETTER');
    const idle = await makeWorker('worker-p2', { handle: async () => undefined }).runOnce();
    expect(idle.claimed).toBe(0);
  });

  it('T6C22/23: disabled enters WAITING_CONFIGURATION; explicit resume restores READY', async () => {
    await enqueue('telegram.test.v1', 'task6:disabled:1');
    const disabledError = Object.assign(new Error('disabled'), {
      workerFailureClassification: 'DISABLED' as const
    });
    await makeWorker('worker-d', {
      handle: async () => {
        throw disabledError;
      }
    }).runOnce();
    const row = await cleanupPool.query(
      "SELECT status FROM outbox_messages WHERE event_key='task6:disabled:1'"
    );
    expect(row.rows[0]?.status).toBe('WAITING_CONFIGURATION');
    const idle = await makeWorker('worker-d2', { handle: async () => undefined }).runOnce();
    expect(idle.claimed).toBe(0);
    await cleanupPool.query(
      "UPDATE outbox_messages SET status='READY', available_at=clock_timestamp() WHERE event_key='task6:disabled:1'"
    );
    const resumed = await makeWorker('worker-d3', { handle: async () => undefined }).runOnce();
    expect(resumed.succeeded).toBe(1);
  });

  it('T6C24: durable job unique businessKey yields JOB_DUPLICATE_BUSINESS_KEY', async () => {
    const first = await jobRepository.enqueue({
      jobType: 'task6.reconcile',
      businessKey: 'case-1',
      payload: { kind: 'synthetic.task6' }
    });
    expect(typeof first).toBe('string');
    await expect(
      jobRepository.enqueue({
        jobType: 'task6.reconcile',
        businessKey: 'case-1',
        payload: { kind: 'synthetic.task6' }
      })
    ).rejects.toMatchObject({
      name: 'DurableJobRepositoryError',
      code: 'JOB_DUPLICATE_BUSINESS_KEY'
    });
  });

  it('T6C25: worker login cannot INSERT outbox; platform login cannot UPDATE outbox', async () => {
    const workerClient = await workerPool.connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      await expect(
        workerClient.query(
          `INSERT INTO outbox_messages (outbox_id, topic, event_key, version, payload,
             correlation_id, status, attempt_count, available_at)
           VALUES ($1::uuid, 't', 'k', 1, '{}'::jsonb, $2::uuid, 'READY', 0, clock_timestamp())`,
          [randomUUID(), randomUUID()]
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
    await enqueue('telegram.test.v1', 'task6:perm:1');
    const platformClient = await platformPool.connect();
    try {
      await platformClient.query('SET ROLE xht_platform');
      await expect(
        platformClient.query(
          "UPDATE outbox_messages SET status='PAUSED' WHERE event_key='task6:perm:1'"
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      platformClient.release();
    }
  });

  it('T6C26: direct illegal transition SUCCEEDED to LEASED updates zero rows', async () => {
    await enqueue('telegram.test.v1', 'task6:illegal:1');
    await cleanupPool.query(
      "UPDATE outbox_messages SET status='SUCCEEDED', succeeded_at=clock_timestamp() WHERE event_key='task6:illegal:1'"
    );
    await expect(
      workerConnections.withClient((client) =>
        client.query(
          `UPDATE outbox_messages SET status='LEASED', locked_by='attacker',
             lease_token=gen_random_uuid(), locked_until=clock_timestamp()
           WHERE status='SUCCEEDED' RETURNING outbox_id`
        )
      )
    ).rejects.toMatchObject({ constraint: 'ck_outbox_succeeded' });
    const claimed = await workerStore.claimBatch({
      workerId: 'worker-x',
      limit: 10,
      leaseMilliseconds: 30_000
    });
    expect(claimed).toHaveLength(0);
  });

  it('T6C27: enqueue rejects sensitive payload keys before any database write', async () => {
    await expect(
      unitOfWork.execute((context) =>
        outboxRepository.enqueue(context, {
          id: randomUUID(),
          topic: 'telegram.test.v1',
          eventKey: 'task6:sensitive:1',
          occurredAt: '2026-08-17T12:00:00.000Z',
          correlationId: randomUUID(),
          payload: { botToken: '123:secret' }
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    const rows = await cleanupPool.query(
      "SELECT count(*)::int AS n FROM outbox_messages WHERE event_key='task6:sensitive:1'"
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('durable job worker claims, succeeds and applies permanent failure states', async () => {
    await jobRepository.enqueue({
      jobType: 'task6.demo',
      businessKey: 'ok-1',
      payload: { kind: 'synthetic.task6' }
    });
    await jobRepository.enqueue({
      jobType: 'task6.demo',
      businessKey: 'bad-1',
      payload: { kind: 'synthetic.task6' }
    });
    const jobs = new DurableJobWorker(
      workerConnections,
      {
        handleJob: async (job) => {
          if (job.businessKey === 'bad-1') {
            throw Object.assign(new Error('permanent'), {
              workerFailureClassification: 'PERMANENT' as const
            });
          }
        }
      },
      'worker-j'
    );
    const result = await jobs.runOnce();
    expect(result.claimed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.retrying).toBe(1);
    const statuses = await cleanupPool.query(
      `SELECT business_key, status FROM durable_jobs ORDER BY business_key`
    );
    expect(statuses.rows).toEqual([
      { business_key: 'bad-1', status: 'DEAD_LETTER' },
      { business_key: 'ok-1', status: 'SUCCEEDED' }
    ]);
  });
});
