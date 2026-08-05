# Unit of Work integration spec part 01 canonical fragment

[← Canonical fragments index](00-index.md) · [← Task 4 LAYOUT-S1 index](../00-index.md)

> LAYOUT-S1 navigation metadata. The fenced bytes below are canonical future engineering content frozen from Task 4 v1.9/v11. This fragment is not an implemented project source file.

- Reconstructed target: `apps/platform/test/database/unit-of-work.integration.spec.ts`
- Assembly sequence: 2 of 5
- Responsibility: UOW01–UOW25, REV01, CLEAN01, REL01–REL05 and IMM01 test bodies.
- Segment bytes: 36441
- Segment lines: 1081
- Segment SHA-256: `C60B0499D4D4E35B51FCC95966A6554DADFEFC5E1EFEDC9E131EAFE068EC8226`
- Full target bytes: 113197
- Full target SHA-256: `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789`

<!-- XHT-CANONICAL-BEGIN target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="2" -->
```ts
  it('UOW01: sync callback returns scalar after a successful commit', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      await expect(local.execute(() => 41)).resolves.toBe(41);
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit'
      ]);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW02: async callback preserves object identity and commits', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const expected = Object.freeze({ uid });
    const observed = await unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      return expected;
    });
    expect(observed).toBe(expected);
    expect(await countUser(uid)).toBe(1);
  });

  it('UOW03: two writes share one backend and commit together', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const observed = await unitOfWork.execute(async (context) => {
      const before = await backendPid(context.database);
      await insertUser(context.database, uid);
      await context.database
        .insertInto('memberships')
        .values({ uid, status: 'ACTIVE' })
        .execute();
      return { before, after: await backendPid(context.database) };
    });
    expect(observed.after).toBe(observed.before);
    expect(await countUser(uid)).toBe(1);
    expect(
      await database
        .selectFrom('memberships')
        .select('uid')
        .where('uid', '=', uid)
        .execute()
    ).toHaveLength(1);
  });

  it('UOW04: sync throw rolls back and preserves safe cause identity', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const module = await loadUnitOfWorkModule();
    const local = module.createUnitOfWork(scripted);
    const expected = new module.PublicUnitOfWorkError(
      'APPLICATION_SYNTHETIC_CALLBACK'
    );
    try {
      const observed = local.execute(() => {
        throw expected;
      });
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_CALLBACK_FAILED',
          outcome: 'ROLLED_BACK',
          cause: expected
        }
      );
      expect(state.queries).toEqual(['begin', 'rollback']);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW05: async reject rolls back and preserves safe cause identity', async () => {
    const module = await loadUnitOfWorkModule();
    const unitOfWork = module.createUnitOfWork(database);
    const uid = randomUUID();
    const expected = new module.PublicUnitOfWorkError(
      'DOMAIN_SYNTHETIC_ASYNC_REJECTION'
    );
    const observed = unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      await Promise.resolve();
      throw expected;
    });
    expectUnitErrorContract(
      await observed.catch((failure: unknown) => failure),
      {
        code: 'TRANSACTION_CALLBACK_FAILED',
        outcome: 'ROLLED_BACK',
        cause: expected
      }
    );
    expect(await countUser(uid)).toBe(0);
  });

  it('UOW06: second write constraint failure rolls back every write', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const observed = unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      await context.database
        .insertInto('memberships')
        .values({ uid, status: 'ACTIVE' })
        .execute();
      await context.database
        .insertInto('memberships')
        .values({ uid, status: 'ACTIVE' })
        .execute();
    });
    const error = await observed.catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'TRANSACTION_CALLBACK_FAILED',
      message: 'TRANSACTION_CALLBACK_FAILED'
    });
    expectNoRawLeak(error);
    expect(await countUser(uid)).toBe(0);
  });

  it('UOW07: caught SQL failure cannot produce a false commit', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const observed = unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      await context.database
        .insertInto('memberships')
        .values({ uid, status: 'ACTIVE' })
        .execute();
      try {
        await context.database
          .insertInto('memberships')
          .values({ uid, status: 'ACTIVE' })
          .execute();
      } catch {
        return 'not-committed';
      }
      return 'unreachable';
    });
    await expect(observed).rejects.toEqual(
      expect.objectContaining({
        code: 'TRANSACTION_ABORTED_BEFORE_COMMIT',
        message: 'TRANSACTION_ABORTED_BEFORE_COMMIT'
      })
    );
    expect(await countUser(uid)).toBe(0);
  });

  it('UOW08: derived QueryCreator stays on the same transaction backend', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const observed = await unitOfWork.execute(async (context) => {
      const derived = context.database.withSchema('public');
      const before = await backendPid(context.database);
      await insertUser(derived, uid);
      return { before, after: await backendPid(derived) };
    });
    expect(observed.after).toBe(observed.before);
    expect(await countUser(uid)).toBe(1);
  });

  it('UOW09: revoked context rejects late use without SQL', async () => {
    const unitLoadsBefore = unitOfWorkModuleLoadCount;
    await withManualContext(async (lease) => {
      lease.revoke();
      const before = queryExecutionCount;
      await expect(
        lease.context.database.selectFrom('users').select('uid').execute()
      ).rejects.toEqual(
        expect.objectContaining({
          code: 'TRANSACTION_CONTEXT_CLOSED',
          message: 'TRANSACTION_CONTEXT_CLOSED'
        })
      );
      expect(queryExecutionCount).toBe(before);
    });
    expect(unitOfWorkModuleLoadCount).toBe(unitLoadsBefore);
  });

  it('UOW10: escaped database facade rejects after callback scope', async () => {
    const unitLoadsBefore = unitOfWorkModuleLoadCount;
    let escaped!: QueryCreator<StageOneDatabase>;
    await withManualContext((lease) => {
      escaped = lease.context.database;
    });
    const before = queryExecutionCount;
    await expect(
      escaped.selectFrom('users').select('uid').execute()
    ).rejects.toMatchObject({ code: 'TRANSACTION_CONTEXT_CLOSED' });
    expect(queryExecutionCount).toBe(before);
    expect(unitOfWorkModuleLoadCount).toBe(unitLoadsBefore);
  });

  it('UOW11: escaped prebuilt builder rejects after revocation', async () => {
    const unitLoadsBefore = unitOfWorkModuleLoadCount;
    let builder!: SelectQueryBuilder<
      StageOneDatabase,
      'users',
      Record<string, never>
    >;
    await withManualContext((lease) => {
      builder = lease.context.database.selectFrom('users');
    });
    const before = queryExecutionCount;
    await expect(builder.select('uid').execute()).rejects.toMatchObject({
      code: 'TRANSACTION_CONTEXT_CLOSED'
    });
    expect(queryExecutionCount).toBe(before);
    expect(unitOfWorkModuleLoadCount).toBe(unitLoadsBefore);
  });

  it('UOW12: plugin, pluginless, and schema derivatives retain the lease', async () => {
    const unitLoadsBefore = unitOfWorkModuleLoadCount;
    let derivatives!: ReadonlyArray<QueryCreator<StageOneDatabase>>;
    await withManualContext((lease) => {
      derivatives = [
        lease.context.database.withPlugin(identityPlugin),
        lease.context.database.withoutPlugins(),
        lease.context.database.withSchema('public')
      ];
    });
    const before = queryExecutionCount;
    for (const derivative of derivatives) {
      await expect(
        derivative.selectFrom('users').select('uid').execute()
      ).rejects.toMatchObject({ code: 'TRANSACTION_CONTEXT_CLOSED' });
    }
    expect(queryExecutionCount).toBe(before);
    expect(unitOfWorkModuleLoadCount).toBe(unitLoadsBefore);
  });

  it('UOW13: nested execute rejects before acquiring another connection', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      let nestedError: unknown;
      const observed = local.execute(() =>
        local.execute(() => 'nested').catch((error: unknown) => {
          nestedError = error;
          throw error;
        })
      );
      const error = await observed.catch((failure: unknown) => failure);
      expectUnitErrorContract(error, {
        code: 'TRANSACTION_CALLBACK_FAILED',
        outcome: 'ROLLED_BACK',
        cause: nestedError
      });
      expectUnitErrorContract(nestedError, {
        code: 'NESTED_UNIT_OF_WORK',
        outcome: 'NOT_COMMITTED'
      });
      expect(state.connectCount).toBe(1);
      expect(state.queries).toEqual(['begin', 'rollback']);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW14: independent outer executes remain concurrent and isolated', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      await expect(
        Promise.all([
          local.execute(async () => {
            await Promise.resolve();
            return 'first';
          }),
          local.execute(async () => {
            await Promise.resolve();
            return 'second';
          })
        ])
      ).resolves.toEqual(['first', 'second']);
      expect(state.connectCount).toBe(2);
      expect(state.normalReleaseIds).toHaveLength(2);
      expect(state.destroyReleaseIds).toEqual([]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW15: uncommitted row is local then becomes globally visible', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    await unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      expect(
        await context.database
          .selectFrom('users')
          .select('uid')
          .where('uid', '=', uid)
          .execute()
      ).toHaveLength(1);
      expect(await countUser(uid)).toBe(0);
    });
    expect(await countUser(uid)).toBe(1);
  });

  it('UOW16: rolled-back row is not visible on any later connection', async () => {
    const module = await loadUnitOfWorkModule();
    const unitOfWork = module.createUnitOfWork(database);
    const expected = new module.PublicUnitOfWorkError(
      'DOMAIN_SYNTHETIC_ROLLBACK'
    );
    const uid = randomUUID();
    const observed = unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      expect(
        await context.database
          .selectFrom('users')
          .select('uid')
          .where('uid', '=', uid)
          .execute()
      ).toHaveLength(1);
      throw expected;
    });
    expectUnitErrorContract(
      await observed.catch((failure: unknown) => failure),
      {
        code: 'TRANSACTION_CALLBACK_FAILED',
        outcome: 'ROLLED_BACK',
        cause: expected
      }
    );
    expect(await countUser(uid)).toBe(0);
  });

  it('UOW17: transaction keeps platform session and current roles', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const evidence = await unitOfWork.execute(async (context) => {
      return context.database
        .selectFrom(
          sql<{
            readonly session_user: string;
            readonly current_user: string;
          }>`(
            select session_user, current_user
          )`.as('roles')
        )
        .select(['roles.session_user', 'roles.current_user'])
        .executeTakeFirstOrThrow();
    });
    expect(evidence).toEqual({
      session_user: fixture.platformLogin.username,
      current_user: 'xht_platform'
    });
  });

  it('UOW18: acquire and begin failures skip callback and release correctly', async () => {
    const state = createScriptedState({
      acquireFailures: 1,
      beginFailures: 1
    });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    let callbackCount = 0;
    try {
      await expect(
        local.execute(() => {
          callbackCount += 1;
        })
      ).rejects.toMatchObject({ code: 'TRANSACTION_ACQUIRE_FAILED' });
      await expect(
        local.execute(() => {
          callbackCount += 1;
        })
      ).rejects.toMatchObject({ code: 'TRANSACTION_BEGIN_FAILED' });
      await expect(local.execute(() => 'recovered')).resolves.toBe(
        'recovered'
      );
      expect(callbackCount).toBe(0);
      expect(state.acquiredClientIds).toEqual([1, 2]);
      expect(state.destroyReleaseIds).toEqual([1]);
      expect(state.normalReleaseIds).toEqual([2]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW19: rollback fault injection preserves primary and recovery evidence', async () => {
    const state = createScriptedState({ rollbackFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const module = await loadUnitOfWorkModule();
    const local = module.createUnitOfWork(scripted);
    const callbackError = new module.PublicUnitOfWorkError(
      'APPLICATION_SYNTHETIC_PRIMARY'
    );
    try {
      const callbackRollbackFailure = local.execute(() => {
        throw callbackError;
      });
      await expect(callbackRollbackFailure).rejects.toMatchObject({
        code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        message: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        primaryCategory: 'CALLBACK',
        cleanupCategory: 'ROLLBACK',
        cause: callbackError
      });
      expectNoRawLeak(
        await callbackRollbackFailure.catch(
          (error: unknown) => error
        )
      );

      state.commitRejectedFailures = 1;
      state.rollbackFailures = 1;
      const commitRollbackFailure = local.execute(() => 'hidden-result');
      await expect(commitRollbackFailure).rejects.toMatchObject({
        code: 'TRANSACTION_COMMIT_AND_ROLLBACK_FAILED',
        message: 'TRANSACTION_COMMIT_AND_ROLLBACK_FAILED',
        primaryCategory: 'COMMIT',
        cleanupCategory: 'ROLLBACK'
      });
      await expect(local.execute(() => 'recovered')).resolves.toBe(
        'recovered'
      );
      expect(state.acquiredClientIds).toEqual([1, 2, 3]);
      expect(state.destroyReleaseIds).toEqual([1, 2]);
      expect(state.normalReleaseIds).toEqual([3]);
      expectNoRawLeak(
        await commitRollbackFailure.catch(
          (error: unknown) => error
        )
      );
    } finally {
      await scripted.destroy();
    }
  });

  it('REV01: context is revoked while commit is pending', async () => {
    const commitStarted = createDeferred<void>();
    const allowCommit = createDeferred<void>();
    const state = createScriptedState({ commitStarted, allowCommit });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    let escaped!: FutureTransactionContext;
    let settled = false;
    try {
      const execution = local
        .execute((context) => {
          escaped = context;
          return 'committed';
        })
        .finally(() => {
          settled = true;
        });
      await commitStarted.promise;
      expect(settled).toBe(false);
      const before = state.queries.length;
      await expect(
        escaped.database.selectFrom('users').select('uid').execute()
      ).rejects.toMatchObject({ code: 'TRANSACTION_CONTEXT_CLOSED' });
      expect(state.queries).toHaveLength(before);
      allowCommit.resolve();
      await expect(execution).resolves.toBe('committed');
    } finally {
      allowCommit.resolve();
      await scripted.destroy();
    }
  });

  it('UOW20: cleanup attempts every owner after a destroy failure', async () => {
    const calls: string[] = [];
    const owner = new TestResourceOwner();
    let reentrant: Promise<void> | undefined;
    owner.ownDatabase({
      destroy(): Promise<void> {
        calls.push('database');
        reentrant = owner.close();
        return Promise.reject(syntheticPgError('ECONNRESET'));
      }
    });
    owner.ownFixture({
      async stop(): Promise<void> {
        calls.push('fixture');
      }
    });
    const first = owner.close();
    const second = owner.close();
    expect(second).toBe(first);
    expect(reentrant).toBe(first);
    const error = await first.catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'TEST_RESOURCE_CLEANUP_FAILED',
      message: 'TEST_RESOURCE_CLEANUP_FAILED',
      categories: ['DATABASE_DESTROY_FAILED']
    });
    expectNoRawLeak(error);
    expect(calls).toEqual(['database', 'fixture']);
    expect(owner.databaseDestroyCount).toBe(1);
    expect(owner.fixtureStopCount).toBe(1);
    expect(owner.close()).toBe(first);
  });

  it('CLEAN01: partial setup owns and closes every acquired resource exactly once', async () => {
    const cases = [
      {
        point: 'AFTER_FIXTURE',
        cleanupFailure: 'NONE',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 0,
          databaseDestroyCount: 0,
          categories: []
        }
      },
      {
        point: 'AFTER_RAW_POOL',
        cleanupFailure: 'NONE',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 1,
          databaseDestroyCount: 0,
          categories: []
        }
      },
      {
        point: 'AFTER_DATABASE',
        cleanupFailure: 'NONE',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 0,
          databaseDestroyCount: 1,
          categories: []
        }
      },
      {
        point: 'AFTER_RAW_POOL',
        cleanupFailure: 'RAW_POOL',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 1,
          databaseDestroyCount: 0,
          categories: ['RAW_POOL_END_FAILED']
        }
      },
      {
        point: 'AFTER_DATABASE',
        cleanupFailure: 'DATABASE',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 0,
          databaseDestroyCount: 1,
          categories: ['DATABASE_DESTROY_FAILED']
        }
      }
    ] as const;

    for (const scenario of cases) {
      const owner = new TestResourceOwner();
      const evidence: InjectedSetupEvidence = {
        fixtureStopCount: 0,
        rawPoolEndCount: 0,
        databaseDestroyCount: 0,
        calls: []
      };
      const error = await setupOwnedResources(
        owner,
        createInjectedSetupOperations(
          scenario.point,
          scenario.cleanupFailure,
          evidence
        )
      ).catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        code: 'TEST_RESOURCE_SETUP_FAILED',
        message: 'TEST_RESOURCE_SETUP_FAILED',
        categories: scenario.expected.categories
      });
      expect(evidence).toMatchObject({
        fixtureStopCount:
          scenario.expected.fixtureStopCount,
        rawPoolEndCount: scenario.expected.rawPoolEndCount,
        databaseDestroyCount:
          scenario.expected.databaseDestroyCount
      });
      expect(owner.fixtureStopCount).toBe(
        scenario.expected.fixtureStopCount
      );
      expect(owner.rawPoolEndCount).toBe(
        scenario.expected.rawPoolEndCount
      );
      expect(owner.databaseDestroyCount).toBe(
        scenario.expected.databaseDestroyCount
      );
      const fixtureStopIndex =
        evidence.calls.indexOf('fixture:stop');
      const databaseDestroyIndex =
        evidence.calls.indexOf('database:destroy');
      const rawPoolEndIndex = evidence.calls.indexOf('raw:end');
      if (databaseDestroyIndex >= 0) {
        expect(fixtureStopIndex).toBeGreaterThan(
          databaseDestroyIndex
        );
      }
      if (rawPoolEndIndex >= 0) {
        expect(fixtureStopIndex).toBeGreaterThan(rawPoolEndIndex);
      }
      expectNoRawLeak(error);
    }
  });

  it('UOW21: commit outcome unknown never rolls back or returns result', async () => {
    const state = createScriptedState({ commitUnknownFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'hidden-result');
      const error = await observed.catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        code: 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN',
        message: 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
      });
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit'
      ]);
      expect(state.queries).not.toContain('rollback');
      expect(state.destroyReleaseIds).toEqual([1]);
      expectNoRawLeak(error);
      await expect(local.execute(() => 'recovered')).resolves.toBe(
        'recovered'
      );
      expect(state.acquiredClientIds).toEqual([1, 2]);
      expect(state.normalReleaseIds).toEqual([2]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW22: raw callback errors are sanitized with both rollback outcomes', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const rollbackSuccess = local.execute(() => {
        throw syntheticPgError('23505');
      });
      const first = await rollbackSuccess.catch(
        (failure: unknown) => failure
      );
      expect(first).toMatchObject({
        code: 'TRANSACTION_CALLBACK_FAILED',
        message: 'TRANSACTION_CALLBACK_FAILED'
      });
      expect(first).not.toHaveProperty('cause');
      expectNoRawLeak(first);

      state.rollbackFailures = 1;
      const rollbackFailure = local.execute(() => {
        throw syntheticPgError('23505');
      });
      const second = await rollbackFailure.catch(
        (failure: unknown) => failure
      );
      expect(second).toMatchObject({
        code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        message: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        primaryCategory: 'CALLBACK',
        cleanupCategory: 'ROLLBACK'
      });
      expect(second).not.toHaveProperty('cause');
      expectNoRawLeak(second);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW23: real rollback connection fault is destroyed before recovery', async () => {
    const module = await loadUnitOfWorkModule();
    const unitOfWork = module.createUnitOfWork(database);
    const expected = new module.PublicUnitOfWorkError(
      'DOMAIN_REAL_ROLLBACK_FAULT'
    );
    let failedPid = 0;
    const evidenceStart = realReleaseEvidence.length;
    const observed = unitOfWork.execute(async (context) => {
      failedPid = await backendPid(context.database);
      await terminateBackend(failedPid);
      throw expected;
    });
    const error = await observed.catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
      cleanupCategory: 'ROLLBACK',
      cause: expected
    });
    expectNoRawLeak(error);
    const failedEvidence = realReleaseEvidence
      .slice(evidenceStart)
      .filter((item) => item.pid === failedPid);
    expect(failedEvidence).toContainEqual({
      pid: failedPid,
      destroy: true
    });
    expect(failedEvidence).not.toContainEqual({
      pid: failedPid,
      destroy: false
    });
    const recoveredPid = await unitOfWork.execute((context) =>
      backendPid(context.database)
    );
    expect(recoveredPid).not.toBe(failedPid);
  });

  it('UOW24: real precommit connection fault destroys the client', async () => {
    const unitOfWork = await createRealUnitOfWork();
    let failedPid = 0;
    const evidenceStart = realReleaseEvidence.length;
    const observed = unitOfWork.execute(async (context) => {
      failedPid = await backendPid(context.database);
      await terminateBackend(failedPid);
      return 'hidden-result';
    });
    const error = await observed.catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'TRANSACTION_PRECOMMIT_CONNECTION_FAILED',
      message: 'TRANSACTION_PRECOMMIT_CONNECTION_FAILED'
    });
    expectNoRawLeak(error);
    const failedEvidence = realReleaseEvidence
      .slice(evidenceStart)
      .filter((item) => item.pid === failedPid);
    expect(failedEvidence).toContainEqual({
      pid: failedPid,
      destroy: true
    });
    expect(failedEvidence).not.toContainEqual({
      pid: failedPid,
      destroy: false
    });
    const recoveredPid = await unitOfWork.execute((context) =>
      backendPid(context.database)
    );
    expect(recoveredPid).not.toBe(failedPid);
  });

  it('UOW25: explicit commit rejection rolls back and hides its result', async () => {
    const state = createScriptedState({ commitRejectedFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'hidden-result');
      const error = await observed.catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        code: 'TRANSACTION_COMMIT_FAILED',
        message: 'TRANSACTION_COMMIT_FAILED',
        primaryCategory: 'COMMIT'
      });
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit',
        'rollback'
      ]);
      expect(state.destroyReleaseIds).toEqual([1]);
      expectNoRawLeak(error);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL01: committed outcome survives normal release failure', async () => {
    const state = createScriptedState({ normalReleaseFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'committed-result');
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_COMMITTED_WITH_RELEASE_FAILURE',
          outcome: 'COMMITTED'
        }
      );
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit'
      ]);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL02: rolled-back callback cause survives normal release failure', async () => {
    const state = createScriptedState({ normalReleaseFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const module = await loadUnitOfWorkModule();
    const local = module.createUnitOfWork(scripted);
    const primary = new module.PublicUnitOfWorkError(
      'APPLICATION_RELEASE_ROLLBACK'
    );
    try {
      const observed = local.execute(() => {
        throw primary;
      });
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_CALLBACK_FAILED',
          outcome: 'ROLLED_BACK',
          cause: primary
        }
      );
      expect(state.queries).toEqual(['begin', 'rollback']);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL03: unknown commit survives destroy release failure', async () => {
    const state = createScriptedState({
      commitUnknownFailures: 1,
      destroyReleaseFailures: 1
    });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'hidden-result');
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN',
          outcome: 'UNKNOWN'
        }
      );
      expect(state.queries).not.toContain('rollback');
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL04: callback and rollback failure survives destroy release failure', async () => {
    const state = createScriptedState({
      rollbackFailures: 1,
      destroyReleaseFailures: 1
    });
    const scripted = createScriptedDatabase(state);
    const module = await loadUnitOfWorkModule();
    const local = module.createUnitOfWork(scripted);
    const primary = new module.PublicUnitOfWorkError(
      'DOMAIN_RELEASE_ROLLBACK_FAILURE'
    );
    try {
      const observed = local.execute(() => {
        throw primary;
      });
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
          outcome: 'NOT_COMMITTED',
          cause: primary
        }
      );
      expect(state.queries).toEqual(['begin', 'rollback']);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL05: rejected commit outcome survives destroy release failure', async () => {
    const state = createScriptedState({
      commitRejectedFailures: 1,
      destroyReleaseFailures: 1
    });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'hidden-result');
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_COMMIT_FAILED',
          outcome: 'ROLLED_BACK'
        }
      );
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit',
        'rollback'
      ]);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('IMM01: every identity-safe error is frozen and rejects field pollution', async () => {
    const module = await loadUnitOfWorkModule();
    const contextModule = await loadContextModule();
    const publicError = new module.PublicUnitOfWorkError(
      'APPLICATION_IMMUTABLE_ERROR'
    );
    const contextError = new contextModule.TransactionContextError();
    const unitError = new module.UnitOfWorkError(
      'TRANSACTION_CALLBACK_FAILED',
      publicError
    );
    const authenticErrors = [
      publicError,
      contextError,
      unitError
    ] as const;
    for (const error of authenticErrors) {
      expect(Object.isFrozen(error)).toBe(true);
      expect(Object.isFrozen(Object.getPrototypeOf(error))).toBe(true);
      expectErrorPollutionRejected(error);
      expectNoRawLeak(error);
    }
    expect(publicError.message).toBe('APPLICATION_IMMUTABLE_ERROR');
    expect(contextError.message).toBe('TRANSACTION_CONTEXT_CLOSED');
    expect(unitError.message).toBe('TRANSACTION_CALLBACK_FAILED');
    expect(unitError.cause).toBe(publicError);

    for (const authenticError of authenticErrors) {
      for (const rollbackFailures of [0, 1]) {
        const state = createScriptedState({ rollbackFailures });
        const scripted = createScriptedDatabase(state);
        const local = module.createUnitOfWork(scripted);
        try {
          const observed = local.execute(() => {
            throw authenticError;
          });
          expectUnitErrorContract(
            await observed.catch((failure: unknown) => failure),
            {
              code:
                rollbackFailures === 0
                  ? 'TRANSACTION_CALLBACK_FAILED'
                  : 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
              outcome:
                rollbackFailures === 0
                  ? 'ROLLED_BACK'
                  : 'NOT_COMMITTED',
              cause: authenticError
            }
          );
        } finally {
          await scripted.destroy();
        }
      }
    }

    const forgedErrors = [
      {
        ErrorClass: module.PublicUnitOfWorkError,
        error: forgeIdentitySafeError(
          module.PublicUnitOfWorkError.prototype
        )
      },
      {
        ErrorClass: contextModule.TransactionContextError,
        error: forgeIdentitySafeError(
          contextModule.TransactionContextError.prototype
        )
      },
      {
        ErrorClass: module.UnitOfWorkError,
        error: forgeIdentitySafeError(
          module.UnitOfWorkError.prototype
        )
      }
    ] as const;
    for (const forged of forgedErrors) {
      expect(Object.isFrozen(forged.error)).toBe(true);
      expect(forged.error).toBeInstanceOf(forged.ErrorClass);
      expect(Object.getPrototypeOf(forged.error)).toBe(
        forged.ErrorClass.prototype
      );
      expect(() => {
        new module.UnitOfWorkError(
          'TRANSACTION_CALLBACK_FAILED',
          forged.error as never
        );
      }).toThrowError('UNIT_OF_WORK_SAFE_CAUSE_INVALID');

      for (const rollbackFailures of [0, 1]) {
        const state = createScriptedState({ rollbackFailures });
        const scripted = createScriptedDatabase(state);
        const local = module.createUnitOfWork(scripted);
        try {
          const observed = local.execute(() => {
            throw forged.error;
          });
          const error = await observed.catch(
            (failure: unknown) => failure
          );
          expectUnitErrorContract(error, {
            code:
              rollbackFailures === 0
                ? 'TRANSACTION_CALLBACK_FAILED'
                : 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
            outcome:
              rollbackFailures === 0
                ? 'ROLLED_BACK'
                : 'NOT_COMMITTED'
          });
          expect(error).not.toHaveProperty('cause');
          expectNoRawLeak(error);
        } finally {
          await scripted.destroy();
        }
      }
    }
  });
const transactionControlCases = [
  'BEGIN',
  'START TRANSACTION',
  'END',
  'ABORT',
  'SAVEPOINT xht_guard',
  'RELEASE SAVEPOINT xht_guard',
  'ROLLBACK TO xht_guard',
  'PREPARE TRANSACTION xht_guard',
  'COMMIT PREPARED xht_guard',
  'ROLLBACK PREPARED xht_guard',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
  'SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE'
] as const;

function executeInjectedSql(
  target: FutureTransactionContext,
  sqlText: string,
  parameters: ReadonlyArray<unknown> = []
): Promise<QueryResult<UnknownRow>> {
  return target.executeSql<UnknownRow>(sqlText, parameters);
}

async function rejectScriptedSql(
  sqlText: string,
  expectedCode:
    | 'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    | 'TRANSACTION_QUERY_MULTISTATEMENT'
    | 'TRANSACTION_QUERY_UNSAFE',
  overrides: Partial<ScriptedState> = {}
): Promise<{ readonly error: unknown; readonly state: ScriptedState }> {
  const state = createScriptedState(overrides);
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    const error = await local
      .execute((context) => executeInjectedSql(context, sqlText))
      .catch((failure: unknown) => failure);
    const expectedFinalCode =
      overrides.rollbackFailures !== undefined && overrides.rollbackFailures > 0
        ? 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED'
        : expectedCode;
    expect(error).toMatchObject({ code: expectedFinalCode });
    expect(
      state.queryEvidence.filter((entry) => entry.text === sqlText)
    ).toHaveLength(0);
    expectNoRawLeak(error);
    return { error, state };
  } finally {
    await scripted.destroy();
  }
}

```
<!-- XHT-CANONICAL-END target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="2" -->
