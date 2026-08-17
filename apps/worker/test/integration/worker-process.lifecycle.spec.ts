import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const entry = resolve(projectRoot, 'apps/worker/dist/src/outbox/outbox-worker.js');
// dist layout: apps/worker/dist/outbox/outbox-worker.js (rootDir=src)
const distEntry = resolve(
  projectRoot,
  'apps/worker/dist/outbox/outbox-worker.js'
);

const childScript = `
import { OutboxWorker } from ${JSON.stringify(distEntry)};
class FailingPool {
  async connect() { throw new Error('NO_DATABASE_IN_LIFECYCLE_TEST'); }
  async end() {}
}
const worker = new OutboxWorker(
  {
    claimBatch: async () => [],
    markSucceeded: async () => 'confirmed',
    applyFailure: async () => 'confirmed'
  },
  {
    handler: { handle: async () => undefined },
    clock: { now: () => new Date() },
    workerId: 'worker-lifecycle'
  }
);
let ticks = 0;
let running = true;
process.stdout.write('READY\\n');
const loop = async () => {
  while (running) {
    await worker.runOnce();
    ticks += 1;
    await new Promise((r) => setTimeout(r, 10));
  }
};
void loop();
process.on('SIGTERM', () => {
  running = false;
  setTimeout(() => process.stdout.write('TICKS ' + ticks + '\\n'), 30);
  setTimeout(() => process.exit(0), 80);
});
`;

describe('worker process lifecycle', () => {
  it(
    '23: starts, runs its loop, and stops cleanly on SIGTERM',
    { timeout: 30_000 },
    async () => {
      void entry;
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', childScript],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let ticks = 0;
      await new Promise<void>((resolveReady, rejectReady) => {
        child.stdout!.on('data', (chunk: Buffer) => {
          if (chunk.toString('utf8').includes('READY')) resolveReady();
        });
        child.on('error', rejectReady);
        setTimeout(() => rejectReady(new Error('START_TIMEOUT')), 15_000).unref();
      });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const exit = new Promise<{ code: number | null }>((resolveExit) => {
        child.on('exit', (code) => resolveExit({ code }));
        child.stdout!.on('data', (chunk: Buffer) => {
          const match = /TICKS (\d+)/.exec(chunk.toString('utf8'));
          if (match !== null) ticks = Number(match[1]);
        });
      });
      child.kill('SIGTERM');
      const result = await exit;
      expect(result.code).toBe(0);
      expect(ticks).toBeGreaterThan(0);
    }
  );
});
