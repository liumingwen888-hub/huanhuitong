import type { OutboxHandler } from '@xht/contracts';
import type { OutboxWorker, WorkerClock } from '../outbox/outbox-worker.js';
import type { StoreClient, StoreConnectionFactory } from '../outbox/outbox-store.js';
import { PostgresOutboxStore } from '../outbox/outbox-store.js';
import type { DurableJobHandler, DurableJobWorker } from '../jobs/durable-job-worker.js';
import { DurableJobWorker as DurableJobWorkerClass } from '../jobs/durable-job-worker.js';
import { OutboxWorker as OutboxWorkerClass } from '../outbox/outbox-worker.js';

export interface WorkerPoolClient {
  query(
    text: string,
    values?: ReadonlyArray<unknown>
  ): Promise<{ rows: ReadonlyArray<unknown> }>;
  release(): void;
}

export interface WorkerPool {
  connect(): Promise<WorkerPoolClient>;
  end(): Promise<void>;
}

export interface WorkerRuntime {
  readonly outbox: OutboxWorker;
  readonly jobs: DurableJobWorker;
  readonly close: () => Promise<void>;
}

export interface CreateWorkerOptions {
  readonly pool: WorkerPool;
  readonly outboxHandler: OutboxHandler | undefined;
  readonly jobHandler: DurableJobHandler | undefined;
  readonly workerId: string;
  readonly clock: WorkerClock;
}

class PoolConnectionFactory implements StoreConnectionFactory {
  readonly #pool: WorkerPool;

  constructor(pool: WorkerPool) {
    this.#pool = pool;
  }

  public async withClient<T>(
    operation: (client: StoreClient) => Promise<T>
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      return await operation({
        query: async <R extends object>(
          text: string,
          values: readonly unknown[]
        ) => {
          const result = await client.query(text, values);
          return { rows: result.rows as R[] };
        }
      });
    } finally {
      client.release();
    }
  }
}

export function createWorker(options: CreateWorkerOptions): WorkerRuntime {
  const connections = new PoolConnectionFactory(options.pool);
  const outbox = new OutboxWorkerClass(new PostgresOutboxStore(connections), {
    handler:
      options.outboxHandler ?? { handle: async () => undefined },
    clock: options.clock,
    workerId: options.workerId
  });
  const jobs = new DurableJobWorkerClass(
    connections,
    options.jobHandler ?? { handleJob: async () => undefined },
    options.workerId
  );
  return {
    outbox,
    jobs,
    close: async () => {
      await options.pool.end();
    }
  };
}
