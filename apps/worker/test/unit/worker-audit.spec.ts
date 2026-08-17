import { describe, expect, it } from 'vitest';
import type { LeasedOutboxMessage, OutboxHandler } from '@xht/contracts';
import { createWorker } from '../../src/bootstrap/create-worker.js';
import { OutboxWorker } from '../../src/outbox/outbox-worker.js';
import type { OutboxStore } from '../../src/outbox/outbox-store.js';

class CapturingPool {
  readonly statements: string[] = [];
  readonly released: number[] = [];
  async connect(): Promise<{
    query(text: string): Promise<{ rows: unknown[] }>;
    release(): void;
  }> {
    return {
      query: async (text: string) => {
        this.statements.push(text);
        return { rows: [] };
      },
      release: () => {
        this.released.push(1);
      }
    };
  }
  async end(): Promise<void> {}
}

function leasedMessage(
  attemptCount: number
): LeasedOutboxMessage & { readonly attemptCount: number } {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    topic: 't',
    eventKey: 'k',
    occurredAt: '',
    correlationId: '00000000-0000-4000-8000-000000000002',
    payload: {},
    workerId: 'w',
    leaseToken: '00000000-0000-4000-8000-000000000003',
    lockGeneration: 1,
    attemptCount,
    lockedUntil: ''
  };
}

describe('production audit regressions', () => {
  it('AUDIT-1: transient failure passes the claimed attempt count to the store', async () => {
    const failures: Array<{ classification: string; attemptCount: number }> =
      [];
    const store: OutboxStore = {
      claimBatch: async () => [leasedMessage(9)],
      markSucceeded: async () => 'confirmed',
      applyFailure: async (command) => {
        failures.push({
          classification: command.classification,
          attemptCount: command.attemptCount
        });
        return 'confirmed';
      }
    };
    const worker = new OutboxWorker(store, {
      handler: {
        handle: async () => {
          throw new Error('transient');
        }
      },
      clock: { now: () => new Date() },
      workerId: 'w'
    });
    const result = await worker.runOnce();
    expect(result.retrying).toBe(1);
    expect(failures).toEqual([
      { classification: 'TRANSIENT', attemptCount: 9 }
    ]);
  });

  it('AUDIT-2: worker connections set the worker role before any operation', async () => {
    const pool = new CapturingPool();
    const runtime = createWorker({
      pool: pool as never,
      outboxHandler: undefined,
      jobHandler: undefined,
      workerId: 'audit-worker',
      clock: { now: () => new Date() }
    });
    await runtime.outbox.runOnce();
    expect(pool.statements[0]).toBe('SET ROLE xht_worker');
    await runtime.close();
  });

  it('AUDIT-3: an explicitly disabled gateway parks menu messages in WAITING_CONFIGURATION', async () => {
    const captured: Array<OutboxHandler | undefined> = [];
    const pool = new CapturingPool();
    const runtime = createWorker({
      pool: pool as never,
      outboxHandler: undefined,
      jobHandler: undefined,
      workerId: 'audit-worker',
      clock: { now: () => new Date() },
      telegramGateway: {
        enabled: false,
        gateway: { sendMainMenu: async () => undefined },
        bindings: { findExternalUserIdByBindingId: async () => '1' },
        menu: { text: 'x', buttons: [{ id: 'a', label: 'A' }] }
      }
    });
    // Probe by claiming a menu message: the disabled handler must throw the
    // DISABLED classification marker (not PERMANENT), which the store maps
    // to WAITING_CONFIGURATION.
    const store: OutboxStore = {
      claimBatch: async () => [
        Object.assign(leasedMessage(1), {
          topic: 'telegram.main-menu-requested.v1'
        })
      ],
      markSucceeded: async () => 'confirmed',
      applyFailure: async (command) => {
        captured.push(undefined);
        expect(command.classification).toBe('DISABLED');
        return 'confirmed';
      }
    };
    const probingWorker = new OutboxWorker(store, {
      handler: { handle: async () => undefined },
      clock: { now: () => new Date() },
      workerId: 'audit-worker',
      topicHandlers: runtime.topicHandlers
    });
    const result = await probingWorker.runOnce();
    expect(result.retrying).toBe(1);
    expect(captured).toHaveLength(1);
    await runtime.close();
  });
});
