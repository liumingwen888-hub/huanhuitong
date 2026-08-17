import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const entry = resolve(
  projectRoot,
  'apps/platform/dist/bootstrap/create-platform-app.js'
);

const childScript = `
import { createPlatformApp } from ${JSON.stringify(entry)};
const handle = await createPlatformApp({
  webhookSecret: 'lifecycle-secret',
  trustedProxyEnabled: true,
  injectedBotInfo: {
    id: 1, is_bot: true, first_name: 'L', username: 'lifecycle_bot',
    can_join_groups: false, can_read_all_group_messages: false,
    supports_inline_queries: false, can_connect_to_business: false,
    has_main_web_app: false
  },
  digestProvider: { digest: () => ({ unavailable: true }) },
  startHandler: { handle: async () => undefined }
});
const server = handle.app.getHttpServer();
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
process.stdout.write('READY ' + port + '\\n');
const shutdown = async () => {
  try { await handle.close(); } finally { process.exit(0); }
};
process.on('SIGTERM', () => { void shutdown(); });
`;

describe('platform process lifecycle', () => {
  it(
    '23: starts, becomes ready, and stops without external connections',
    { timeout: 30_000 },
    async () => {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', childScript],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let port = 0;
      const startedAt = Date.now();
      await new Promise<void>((resolveReady, rejectReady) => {
        child.stdout!.on('data', (chunk: Buffer) => {
          const match = /READY (\d+)/.exec(chunk.toString('utf8'));
          if (match !== null) {
            port = Number(match[1]);
            resolveReady();
          }
        });
        child.on('error', rejectReady);
        setTimeout(() => rejectReady(new Error('START_TIMEOUT')), 15_000).unref();
      });
      expect(port).toBeGreaterThan(0);
      expect(Date.now() - startedAt).toBeLessThanOrEqual(15_000);

      const probe = await fetch(`http://127.0.0.1:${port}/webhooks/telegram`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update_id: 1 })
      });
      expect([401, 400]).toContain(probe.status);

      const exit = new Promise<{ code: number | null; signal: string | null }>(
        (resolveExit) => {
          child.on('exit', (code, signal) => resolveExit({ code, signal }));
        }
      );
      child.kill('SIGTERM');
      const stoppedAt = Date.now();
      const result = await exit;
      expect(result.code).toBe(0);
      expect(Date.now() - stoppedAt).toBeLessThanOrEqual(10_000);
      await expect(
        fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
      ).rejects.toThrow();
    }
  );
});
