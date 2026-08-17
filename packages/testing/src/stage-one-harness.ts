import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { startPostgresFixture } from './postgres-container.js';
import type { PostgresFixture } from './postgres-container.js';
import { migrateAndValidate } from './flyway-runner.js';

export type StageOneHttpRequestHandler = (
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse
) => void | Promise<void>;

export interface StageOneHarness {
  readonly webhookSecret: string;
  readonly platformLogin: { readonly connectionString: string; readonly username: string };
  readonly workerLogin: { readonly connectionString: string; readonly username: string };
  readonly server: Server;
  readonly port: number;
  postWebhook(
    body: object,
    headers?: Record<string, string>
  ): Promise<{ readonly status: number; readonly body: unknown }>;
  query<T extends object>(sql: string, values?: ReadonlyArray<unknown>): Promise<
    ReadonlyArray<T>
  >;
  count(
    table:
      | 'users'
      | 'memberships'
      | 'channel_bindings'
      | 'registration_idempotency'
      | 'inbox_messages'
      | 'outbox_messages'
  ): Promise<number>;
  countActiveBindings(externalUserId: string): Promise<number>;
  countTopic(topic: string): Promise<number>;
  distinctResolvedUids(): Promise<readonly string[]>;
  inboxRow(externalMessageId: string): Promise<{
    readonly payload_digest: string;
    readonly digest_key_version: string;
    readonly status: string;
  } | null>;
  stop(): Promise<void>;
}

export async function createStageOneHarness(input: {
  readonly projectRoot: string;
  readonly requestHandler: StageOneHttpRequestHandler;
}): Promise<StageOneHarness> {
  const fixture: PostgresFixture = await startPostgresFixture({
    projectRoot: input.projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, {
    projectRoot: input.projectRoot,
    configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  const cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-harness-cleanup'
  });
  const server = createServer((request, response) => {
    void Promise.resolve(input.requestHandler(request, response)).catch(
      (error: unknown) => {
        if (!response.headersSent) response.statusCode = 500;
        response.end();
        void error;
      }
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await cleanupPool.end();
    await fixture.stop();
    throw new Error('HARNESS_BIND_FAILED');
  }
  const port = address.port;
  const webhookSecret = 'harness-webhook-secret';

  async function query<T extends object>(
    sql: string,
    values?: ReadonlyArray<unknown>
  ): Promise<ReadonlyArray<T>> {
    const result = await cleanupPool.query(sql, values as unknown[]);
    return result.rows as T[];
  }

  return {
    webhookSecret,
    platformLogin: {
      connectionString: fixture.platformLogin.connectionString,
      username: fixture.platformLogin.username
    },
    workerLogin: {
      connectionString: fixture.workerLogin.connectionString,
      username: fixture.workerLogin.username
    },
    server,
    port,
    async postWebhook(body, headers) {
      const response = await fetch(
        `http://127.0.0.1:${port}/webhooks/telegram`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-telegram-bot-api-secret-token': webhookSecret,
            'x-forwarded-proto': 'https',
            ...headers
          },
          body: JSON.stringify(body)
        }
      );
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed };
    },
    query,
    async count(table) {
      const rows = await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table}`
      );
      return rows[0]?.n ?? 0;
    },
    async countActiveBindings(externalUserId) {
      const rows = await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM channel_bindings
          WHERE channel_type='TELEGRAM' AND external_user_id=$1 AND status='ACTIVE'`,
        [externalUserId]
      );
      return rows[0]?.n ?? 0;
    },
    async countTopic(topic) {
      const rows = await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM outbox_messages WHERE topic=$1`,
        [topic]
      );
      return rows[0]?.n ?? 0;
    },
    async distinctResolvedUids() {
      const rows = await query<{ uid: string }>(
        `SELECT DISTINCT b.uid AS uid FROM channel_bindings b
           JOIN registration_idempotency r ON r.uid = b.uid`
      );
      return rows.map((row) => row.uid);
    },
    async inboxRow(externalMessageId) {
      const rows = await query<{
        payload_digest: string;
        digest_key_version: string;
        status: string;
      }>(
        `SELECT payload_digest, digest_key_version, status
           FROM inbox_messages WHERE external_message_id=$1`,
        [externalMessageId]
      );
      return rows[0] ?? null;
    },
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await cleanupPool.end();
      await fixture.stop();
    }
  };
}
