import {
  isWorkerFailureMarker,
  type LeasedOutboxMessage,
  type OutboxHandler,
  type OutboxRunResult,
  type WorkerErrorClassification
} from '@xht/contracts';
import type { OutboxStore } from './outbox-store.js';

export interface WorkerClock {
  now(): Date;
}

export interface OutboxWorkerOptions {
  readonly handler: OutboxHandler;
  readonly clock: WorkerClock;
  readonly workerId: string;
  readonly limit?: number;
  readonly leaseMilliseconds?: number;
  readonly jitter?: () => number;
}

export function classifyWorkerError(error: unknown): WorkerErrorClassification {
  if (isWorkerFailureMarker(error)) {
    return error.workerFailureClassification;
  }
  return 'TRANSIENT';
}

export class OutboxWorker {
  readonly #store: OutboxStore;
  readonly #options: Required<OutboxWorkerOptions>;

  public constructor(store: OutboxStore, options: OutboxWorkerOptions) {
    this.#store = store;
    this.#options = {
      limit: 25,
      leaseMilliseconds: 30_000,
      jitter: Math.random,
      ...options
    };
  }

  public async runOnce(): Promise<OutboxRunResult> {
    const messages = await this.#store.claimBatch({
      workerId: this.#options.workerId,
      limit: this.#options.limit,
      leaseMilliseconds: this.#options.leaseMilliseconds
    });
    let succeeded = 0;
    let retrying = 0;
    for (const message of messages) {
      const succeededLease = await this.#deliver(message);
      if (succeededLease) {
        succeeded += 1;
      } else {
        retrying += 1;
      }
    }
    return {
      claimed: messages.length,
      succeeded,
      retrying
    };
  }

  async #deliver(message: LeasedOutboxMessage): Promise<boolean> {
    const attemptCount = (message as { attemptCount?: number }).attemptCount;
    try {
      await this.#options.handler.handle(message);
    } catch (error: unknown) {
      await this.#store.applyFailure({
        id: message.id,
        workerId: message.workerId,
        leaseToken: message.leaseToken,
        lockGeneration: message.lockGeneration,
        classification: classifyWorkerError(error),
        attemptCount: attemptCount ?? 1,
        jitter: this.#options.jitter
      });
      return false;
    }
    const outcome = await this.#store.markSucceeded({
      id: message.id,
      workerId: message.workerId,
      leaseToken: message.leaseToken,
      lockGeneration: message.lockGeneration
    });
    return outcome === 'confirmed';
  }
}
