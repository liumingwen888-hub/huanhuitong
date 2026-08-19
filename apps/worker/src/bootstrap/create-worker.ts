import type { OutboxHandler } from '@xht/contracts';
import { TelegramMainMenuHandler } from '../outbox/telegram-main-menu.handler.js';
import type { BindingLookup } from '../outbox/telegram-main-menu.handler.js';
import type { TelegramBotGateway } from '../infrastructure/telegram/telegram-bot.gateway.js';
import { TelegramConnectionDisabledError } from '../infrastructure/telegram/external-connection-disabled.gateway.js';
import type { LeasedOutboxMessage } from '@xht/contracts';
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
  readonly topicHandlers: ReadonlyMap<string, OutboxHandler>;
  readonly close: () => Promise<void>;
}

export interface CreateWorkerOptions {
  readonly pool: WorkerPool;
  readonly outboxHandler: OutboxHandler | undefined;
  readonly jobHandler: DurableJobHandler | undefined;
  readonly workerId: string;
  readonly clock: WorkerClock;
  readonly workerRole?: string;
  readonly telegramGateway?: {
    readonly enabled: boolean;
    readonly gateway: TelegramBotGateway;
    readonly bindings: BindingLookup;
    readonly menu: {
      readonly text: string;
      readonly buttons: readonly {
        readonly id: string;
        readonly label: string;
      }[];
    };
  };
}

class PoolConnectionFactory implements StoreConnectionFactory {
  readonly #pool: WorkerPool;
  readonly #workerRole: string;

  constructor(pool: WorkerPool, workerRole: string) {
    this.#pool = pool;
    this.#workerRole = workerRole;
  }

  public async withClient<T>(
    operation: (client: StoreClient) => Promise<T>
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query(`SET ROLE ${this.#workerRole}`);
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
  const connections = new PoolConnectionFactory(
    options.pool,
    options.workerRole ?? 'xht_worker'
  );
  const topicHandlers = new Map<string, OutboxHandler>();
  if (options.telegramGateway?.enabled === true) {
    topicHandlers.set(
      'telegram.main-menu-requested.v1',
      new TelegramMainMenuHandler(
        options.telegramGateway.gateway,
        options.telegramGateway.bindings,
        options.telegramGateway.menu
      )
    );
    if (options.telegramGateway.gateway.sendPrompt !== undefined) {
      const gateway = options.telegramGateway.gateway;
      const promptHandler = async (message: LeasedOutboxMessage): Promise<void> => {
        const payload = message.payload as {
          readonly chatRef?: unknown;
          readonly text?: unknown;
        };
        if (
          typeof payload.chatRef !== 'string' ||
          typeof payload.text !== 'string'
        ) {
          throw Object.assign(new Error('PROMPT_PAYLOAD_INVALID'), {
            workerFailureClassification: 'PERMANENT' as const
          });
        }
        await gateway.sendPrompt!({
          externalUserId: payload.chatRef,
          text: payload.text,
          idempotencyKey: message.eventKey
        });
      };
      topicHandlers.set('telegram.security-prompt.v1', { handle: promptHandler });
    }
  } else if (options.telegramGateway?.enabled === false) {
    // F-06: a disabled external connection must park menu messages in
    // WAITING_CONFIGURATION (not PERMANENT dead letters) until explicit
    // configuration change re-enables the gateway.
    topicHandlers.set('telegram.main-menu-requested.v1', {
      handle: async () => {
        throw new TelegramConnectionDisabledError();
      }
    });
  }
  const outbox = new OutboxWorkerClass(new PostgresOutboxStore(connections), {
    handler:
      options.outboxHandler ?? { handle: async () => undefined },
    clock: options.clock,
    workerId: options.workerId,
    topicHandlers
  });
  const jobs = new DurableJobWorkerClass(
    connections,
    options.jobHandler ?? { handleJob: async () => undefined },
    options.workerId
  );
  return {
    outbox,
    jobs,
    topicHandlers,
    close: async () => {
      await options.pool.end();
    }
  };
}
