import { createRequire } from 'node:module';
import {
  Kysely,
  PostgresDialect,
  sql,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow
} from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { StageOneDatabase } from '@xht/contracts';
import {
  DatabaseRoleError,
  RoleEnforcingPostgresPool,
  createPlatformDatabase
} from '../../src/infrastructure/database/database.js';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as {
  readonly Pool: {
    readonly prototype: {
      end: () => Promise<void>;
    };
  };
};
const expectedSession = 'xht_platform_test_login';
const expectedRole = 'xht_platform';

interface FakeClient {
  readonly query: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
}

function clientWith(...steps: readonly unknown[]): FakeClient {
  let index = 0;
  return {
    query: vi.fn(async () => {
      const step = steps[index++];
      if (step instanceof Error) throw step;
      return step;
    }),
    release: vi.fn()
  };
}

function successfulClient(...extra: readonly unknown[]): FakeClient {
  return clientWith(
    { rows: [{ session_user: expectedSession }] },
    { rows: [] },
    { rows: [{ current_user: expectedRole }] },
    ...extra
  );
}

function poolWith(
  connect: () => Promise<FakeClient>,
  end: () => Promise<void> = async () => {}
) {
  return {
    Client: class {},
    options: {},
    connect: vi.fn(connect),
    end: vi.fn(end)
  };
}

async function expectCode(
  promise: Promise<unknown>,
  code: DatabaseRoleError['code']
): Promise<void> {
  await expect(promise).rejects.toEqual(
    expect.objectContaining({ code, message: code })
  );
}

async function withPoolEnd(
  replacement: () => Promise<void>,
  run: () => Promise<void>
): Promise<void> {
  const original = Pool.prototype.end;
  Pool.prototype.end = replacement;
  try {
    await run();
  } finally {
    Pool.prototype.end = original;
  }
}

const plugin: KyselyPlugin = {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  },
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
};

describe('platform role-bound database', () => {
  it('U01 checks session_user before returning the client', async () => {
    const client = successfulClient();
    const wrapper = new RoleEnforcingPostgresPool(
      poolWith(async () => client) as never,
      expectedSession
    );
    await wrapper.connect();
    expect(client.query.mock.calls[0]).toEqual(['select session_user', []]);
  });

  it('U02 executes only the fixed platform SET ROLE statement', async () => {
    const client = successfulClient();
    const wrapper = new RoleEnforcingPostgresPool(
      poolWith(async () => client) as never,
      expectedSession
    );
    await wrapper.connect();
    expect(client.query.mock.calls.map((call) => call[0])).toEqual([
      'select session_user',
      'SET ROLE xht_platform',
      'select current_user'
    ]);
    expect(JSON.stringify(client.query.mock.calls)).not.toContain('xht_worker');
  });

  it('U03 checks current_user before returning the client', async () => {
    const client = successfulClient();
    const wrapper = new RoleEnforcingPostgresPool(
      poolWith(async () => client) as never,
      expectedSession
    );
    expect(await wrapper.connect()).not.toBe(client);
    expect(client.query.mock.calls[2]).toEqual(['select current_user', []]);
  });

  it('U04 destroys clients when session_user query fails or mismatches', async () => {
    for (const [client, code] of [
      [
        clientWith(new Error('synthetic-secret')),
        'DATABASE_CONNECTION_FAILED'
      ],
      [
        clientWith({ rows: [{ session_user: 'other_login' }] }),
        'DATABASE_SESSION_USER_MISMATCH'
      ]
    ] as const) {
      const wrapper = new RoleEnforcingPostgresPool(
        poolWith(async () => client) as never,
        expectedSession
      );
      await expectCode(wrapper.connect(), code);
      expect(client.release).toHaveBeenCalledTimes(1);
      expect(client.release).toHaveBeenCalledWith(true);
    }
  });

  it('U05 destroys the client when fixed SET ROLE fails', async () => {
    const client = clientWith(
      { rows: [{ session_user: expectedSession }] },
      new Error('synthetic-secret')
    );
    const wrapper = new RoleEnforcingPostgresPool(
      poolWith(async () => client) as never,
      expectedSession
    );
    await expectCode(wrapper.connect(), 'DATABASE_CONNECTION_FAILED');
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('U06 destroys the client when current_user query fails', async () => {
    const client = clientWith(
      { rows: [{ session_user: expectedSession }] },
      { rows: [] },
      new Error('synthetic-secret')
    );
    const wrapper = new RoleEnforcingPostgresPool(
      poolWith(async () => client) as never,
      expectedSession
    );
    await expectCode(wrapper.connect(), 'DATABASE_CONNECTION_FAILED');
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('U07 destroys the client when current_user mismatches', async () => {
    const client = clientWith(
      { rows: [{ session_user: expectedSession }] },
      { rows: [] },
      { rows: [{ current_user: 'xht_worker' }] }
    );
    const wrapper = new RoleEnforcingPostgresPool(
      poolWith(async () => client) as never,
      expectedSession
    );
    await expectCode(wrapper.connect(), 'DATABASE_ROLE_MISMATCH');
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('U08 releases a successful Kysely connection without destroying it', async () => {
    const client = successfulClient({ rows: [{ value: 1 }] });
    const wrapper = new RoleEnforcingPostgresPool(
      poolWith(async () => client) as never,
      expectedSession
    );
    const database = new Kysely<StageOneDatabase>({
      dialect: new PostgresDialect({ pool: wrapper })
    });
    await sql<{ readonly value: number }>`select 1 as value`.execute(database);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
    await database.destroy();
  });

  it('U09 does not release when pool.connect fails before returning a client', async () => {
    const wrapper = new RoleEnforcingPostgresPool(
      poolWith(async () => {
        throw new Error('synthetic-secret');
      }) as never,
      expectedSession
    );
    await expectCode(wrapper.connect(), 'DATABASE_CONNECTION_FAILED');
  });

  it('U10 shares one pending close Promise and calls Pool.end once', async () => {
    let releaseEnd!: () => void;
    const end = vi.fn(
      () =>
        new Promise<void>((resolvePromise) => {
          releaseEnd = resolvePromise;
        })
    );
    await withPoolEnd(end, async () => {
      const handle = createPlatformDatabase({
        connectionString: 'postgresql://synthetic.invalid/xht',
        expectedSessionUser: expectedSession,
        maxConnections: 2,
        connectionTimeoutMillis: 1000,
        idleTimeoutMillis: 1000,
        applicationName: 'xht-platform-test'
      });
      const first = handle.close();
      const second = handle.close();
      expect(second).toBe(first);
      await vi.waitFor(() => expect(end).toHaveBeenCalledTimes(1));
      releaseEnd();
      await first;
      expect(handle.close()).toBe(first);
    });
  });

  it('U11 returns the first close Promise during synchronous reentry', async () => {
    let handle: ReturnType<typeof createPlatformDatabase>;
    let reentrant: Promise<void> | undefined;
    const end = vi.fn(() => {
      reentrant = handle.close();
      return Promise.resolve();
    });
    await withPoolEnd(end, async () => {
      handle = createPlatformDatabase({
        connectionString: 'postgresql://synthetic.invalid/xht',
        expectedSessionUser: expectedSession,
        maxConnections: 2,
        connectionTimeoutMillis: 1000,
        idleTimeoutMillis: 1000,
        applicationName: 'xht-platform-test'
      });
      const first = handle.close();
      await first;
      expect(reentrant).toBe(first);
      expect(end).toHaveBeenCalledTimes(1);
    });
  });

  it('U12 keeps failures sticky and exposes only the safe QueryCreator facade', async () => {
    for (const end of [
      () => {
        throw new Error('synthetic-secret');
      },
      () => Promise.reject(new Error('synthetic-secret'))
    ]) {
      const wrapper = new RoleEnforcingPostgresPool(
        poolWith(async () => successfulClient(), end) as never,
        expectedSession
      );
      const first = wrapper.end();
      await expectCode(first, 'DATABASE_CLOSE_FAILED');
      expect(wrapper.end()).toBe(first);
      expect(JSON.stringify(await first.catch((error) => error))).not.toContain(
        'synthetic-secret'
      );
    }

    let handle: ReturnType<typeof createPlatformDatabase>;
    let reentrant: Promise<void> | undefined;
    const end = vi.fn(() => {
      reentrant = handle.close();
      return Promise.reject(new Error('synthetic-secret'));
    });
    await withPoolEnd(end, async () => {
      handle = createPlatformDatabase({
        connectionString: 'postgresql://synthetic.invalid/xht',
        expectedSessionUser: expectedSession,
        maxConnections: 2,
        connectionTimeoutMillis: 1000,
        idleTimeoutMillis: 1000,
        applicationName: 'xht-platform-test'
      });
      const first = handle.close();
      const concurrent = handle.close();
      expect(concurrent).toBe(first);
      await expectCode(first, 'DATABASE_CLOSE_FAILED');
      expect(reentrant).toBe(first);
      expect(handle.close()).toBe(first);
      expect(end).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(await first.catch((error) => error))).not.toContain(
        'synthetic-secret'
      );
    });

    const open = createPlatformDatabase({
      connectionString: 'postgresql://synthetic.invalid/xht',
      expectedSessionUser: expectedSession,
      maxConnections: 2,
      connectionTimeoutMillis: 1000,
      idleTimeoutMillis: 1000,
      applicationName: 'xht-platform-test'
    });
    const safeSurfaces = [
      open.db,
      open.db.withPlugin(plugin),
      open.db.withoutPlugins(),
      open.db.withSchema('public')
    ];
    for (const surface of safeSurfaces) {
      expect(Reflect.has(surface, 'destroy')).toBe(false);
      expect(Symbol.asyncDispose in surface).toBe(false);
    }
    expect(open.db.selectFrom('users').selectAll()).toBeDefined();
    expect(open.db.insertInto('users')).toBeDefined();
    expect(open.db.updateTable('users')).toBeDefined();
    expect(open.db.deleteFrom('users')).toBeDefined();
    if (false) {
      // @ts-expect-error direct destroy is unavailable.
      void open.db.destroy();
      // @ts-expect-error plugin chain destroy is unavailable.
      void open.db.withPlugin(plugin).destroy();
      // @ts-expect-error plugin reset chain destroy is unavailable.
      void open.db.withoutPlugins().destroy();
      // @ts-expect-error schema chain destroy is unavailable.
      void open.db.withSchema('public').destroy();
      // @ts-expect-error tables cannot be extended through the facade.
      void open.db.$extendTables<{}>().destroy();
      // @ts-expect-error tables cannot be omitted through the facade.
      void open.db.$omitTables<never>().destroy();
      // @ts-expect-error tables cannot be picked through the facade.
      void open.db.$pickTables<never>().destroy();
      // @ts-expect-error table types cannot be replaced through the facade.
      void open.db.withTables<{}>().destroy();
      // @ts-expect-error connection escape is unavailable.
      void open.db.connection().execute(async (connection) => connection.destroy());
      // @ts-expect-error async dispose is unavailable.
      void open.db[Symbol.asyncDispose]();
    }
    await open.close();
  });
});
