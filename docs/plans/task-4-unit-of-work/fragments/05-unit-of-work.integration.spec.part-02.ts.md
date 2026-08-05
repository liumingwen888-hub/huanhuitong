# Unit of Work integration spec part 02 canonical fragment

[← Canonical fragments index](00-index.md) · [← Task 4 LAYOUT-S1 index](../00-index.md)

> LAYOUT-S1 navigation metadata. The fenced bytes below are canonical future engineering content frozen from Task 4 v1.9/v11. This fragment is not an implemented project source file.

- Reconstructed target: `apps/platform/test/database/unit-of-work.integration.spec.ts`
- Assembly sequence: 3 of 5
- Responsibility: TXCTL01–TXCTL25 test bodies.
- Segment bytes: 10782
- Segment lines: 329
- Segment SHA-256: `89FF2BB30704047D8231A1A752464C3EFD7DDBBAC38822E8D04B61D1DD81ECF1`
- Full target bytes: 113197
- Full target SHA-256: `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789`

<!-- XHT-CANONICAL-BEGIN target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="3" -->
```ts
it('TXCTL01: single ROLLBACK is rejected before send', async () => {
  const evidence = await rejectScriptedSql(
    'ROLLBACK',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL02: single COMMIT is rejected before send', async () => {
  const evidence = await rejectScriptedSql(
    'COMMIT',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL03: BEGIN START TRANSACTION END and ABORT are rejected', async () => {
  for (const statement of transactionControlCases.slice(0, 4)) {
    const evidence = await rejectScriptedSql(
      statement,
      'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('TXCTL04: SAVEPOINT RELEASE SAVEPOINT and ROLLBACK TO are rejected', async () => {
  for (const statement of transactionControlCases.slice(4, 7)) {
    const evidence = await rejectScriptedSql(
      statement,
      'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('TXCTL05: prepared transaction controls are rejected', async () => {
  for (const statement of transactionControlCases.slice(7, 10)) {
    const evidence = await rejectScriptedSql(
      statement,
      'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('TXCTL06: SET TRANSACTION is rejected', async () => {
  const evidence = await rejectScriptedSql(
    transactionControlCases[10],
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL07: SET SESSION CHARACTERISTICS AS TRANSACTION is rejected', async () => {
  const evidence = await rejectScriptedSql(
    transactionControlCases[11],
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL08: case BOM whitespace line and nested block comments cannot bypass', async () => {
  for (const statement of [
    '\uFEFF  rOlLbAcK ;',
    '-- guard\nCoMmIt',
    '/* outer /* nested */ still */ BEGIN'
  ]) {
    const evidence = await rejectScriptedSql(
      statement,
      'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('TXCTL09: select rollback select has zero partial execution', async () => {
  const evidence = await rejectScriptedSql(
    'select 1; rollback; select 1',
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL10: select commit select has zero partial execution', async () => {
  const evidence = await rejectScriptedSql(
    'select 1; commit; select 1',
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL11: insert followed by commit has zero partial execution', async () => {
  const evidence = await rejectScriptedSql(
    "insert into users (uid, status) values ('x', 'ACTIVE'); commit",
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL12: legal write followed by ROLLBACK rolls back the write', async () => {
  const local = await createRealUnitOfWork();
  const uid = randomUUID();
  const error = await local
    .execute(async (context) => {
      await insertUser(context.database, uid);
      await executeInjectedSql(context, 'ROLLBACK');
    })
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({
    code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    outcome: 'ROLLED_BACK'
  });
  await expect(countUser(uid)).resolves.toBe(0);
});

it('TXCTL13: legal write followed by COMMIT rolls back the write', async () => {
  const local = await createRealUnitOfWork();
  const uid = randomUUID();
  const error = await local
    .execute(async (context) => {
      await insertUser(context.database, uid);
      await executeInjectedSql(context, 'COMMIT');
    })
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({
    code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    outcome: 'ROLLED_BACK'
  });
  await expect(countUser(uid)).resolves.toBe(0);
});

it('TXCTL14: rollback success preserves the policy result contract', async () => {
  const evidence = await rejectScriptedSql(
    'ROLLBACK',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expectUnitErrorContract(evidence.error, {
    code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    outcome: 'ROLLED_BACK'
  });
});

it('TXCTL15: rollback failure preserves recovery evidence', async () => {
  const evidence = await rejectScriptedSql(
    'COMMIT',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    { rollbackFailures: 1 }
  );
  expect(evidence.error).toMatchObject({
    code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
    outcome: 'NOT_COMMITTED',
    cause: { code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED' }
  });
  expectNoRawLeak(evidence.error);
});

it('TXCTL16: release failure does not replace the transaction result', async () => {
  const evidence = await rejectScriptedSql(
    'ROLLBACK',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    { normalReleaseFailures: 1 }
  );
  expect(evidence.error).toMatchObject({
    code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    outcome: 'ROLLED_BACK'
  });
  expect(evidence.state.destroyReleaseIds).toEqual([1]);
});

it('TXCTL17: policy rejection returns a healthy client normally', async () => {
  const evidence = await rejectScriptedSql(
    'COMMIT',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.normalReleaseIds).toEqual([1]);
  expect(evidence.state.destroyReleaseIds).toEqual([]);
});

it('TXCTL18: execute after policy rejection still uses the pool', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await local
      .execute((context) => executeInjectedSql(context, 'COMMIT'))
      .catch(() => undefined);
    await expect(local.execute(() => 42)).resolves.toBe(42);
    expect(state.acquiredClientIds).toEqual([1, 1]);
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL19: string and dollar literals do not cause false positives', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await expect(
      local.execute((context) =>
        executeInjectedSql(
          context,
          "select 'commit; rollback' as a, $$begin; end$$ as b"
        )
      )
    ).resolves.toMatchObject({ rows: [] });
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL20: comment keywords and semicolons do not cause false positives', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await expect(
      local.execute((context) =>
        executeInjectedSql(
          context,
          '-- commit; rollback\nselect /* begin; /* abort */ */ 1'
        )
      )
    ).resolves.toMatchObject({ rows: [] });
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL21: no-parameter callback query uses extended mode', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await local.execute((context) =>
      context.database.selectNoFrom(sql.lit(1).as('value')).execute()
    );
    expect(state.queryEvidence).toContainEqual({
      text: expect.stringContaining('select 1'),
      values: [],
      queryMode: 'extended'
    });
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL22: parameterized callback query remains usable in extended mode', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await local.execute((context) =>
      context.database.selectNoFrom(sql.val(41).as('value')).execute()
    );
    expect(state.queryEvidence).toContainEqual({
      text: expect.stringContaining('select $1'),
      values: [41],
      queryMode: 'extended'
    });
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL23: callback cannot obtain raw client pool or executor', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await expect(
      local.execute((context) => {
        const surface = collectPublicSurface(context.database);
        expect(surface.fieldNames).not.toEqual(
          expect.arrayContaining([
            'rawClient',
            'pool',
            'driver',
            'connection',
            'getExecutor',
            'provideConnection'
          ])
        );
        expect(Reflect.get(context.database, 'getExecutor')).toBeUndefined();
        return 1;
      })
    ).resolves.toBe(1);
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL24: reflection prototype and plugin do not expose internal channels', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await expect(
      local.execute(async (context) => {
        const derived = context.database.withPlugin(identityPlugin);
        const surfaces = [context.database, derived, Object.getPrototypeOf(context.database)];
        for (const surface of surfaces) {
          const observed = collectPublicSurface(surface);
          expect(observed.fieldNames).not.toEqual(
            expect.arrayContaining(['rawClient', 'pool', 'connection', 'getExecutor'])
          );
        }
        await derived.selectNoFrom(sql.lit(1).as('value')).execute();
        return 1;
      })
    ).resolves.toBe(1);
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL25: policy errors expose zero raw SQL parameters or secrets', async () => {
  const evidence = await rejectScriptedSql(
    'select 1; commit; select 1 -- synthetic-raw-password',
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expectUnitErrorContract(evidence.error, {
    code: 'TRANSACTION_QUERY_MULTISTATEMENT',
    outcome: 'ROLLED_BACK'
  });
  expectNoRawLeak(evidence.error);
});

```
<!-- XHT-CANONICAL-END target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="3" -->
