# Unit of Work integration spec part 04 canonical fragment

[← Canonical fragments index](00-index.md) · [← Task 4 LAYOUT-S1 index](../00-index.md)

> LAYOUT-S1 navigation metadata. The fenced bytes below are canonical future engineering content frozen from Task 4 v1.9/v11. This fragment is not an implemented project source file.

- Reconstructed target: `apps/platform/test/database/unit-of-work.integration.spec.ts`
- Assembly sequence: 5 of 5
- Responsibility: SQLPOL01–SQLPOL57 contract table, evidence output and generated test loop.
- Segment bytes: 21282
- Segment lines: 154
- Segment SHA-256: `BDD8442A2F91ECFB7363C38AE46060279417B7E3ED9A1907B7F47C0B2ECC64C7`
- Full target bytes: 113197
- Full target SHA-256: `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789`

<!-- XHT-CANONICAL-BEGIN target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="5" -->
```ts
type CallbackSqlPolicyExpectation = 'reject' | 'allow';
interface CallbackSqlPolicyCase {
  readonly id: `SQLPOL${string}`;
  readonly title: string;
  readonly sql: string;
  readonly companionSql?: readonly string[];
  readonly meaning: string;
  readonly expected: CallbackSqlPolicyExpectation;
  readonly expectedDelegateCalls: 0 | 1;
  readonly expectedRelease: 'normal';
  readonly expectNextLegalQuery: true;
}

const callbackSqlPolicyContract = [
  { id: 'SQLPOL01', title: 'SET transaction_read_only is rejected', sql: 'SET transaction_read_only = on', meaning: 'transaction_read_only changes the current transaction mode', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL02', title: 'mixed-case SET is rejected', sql: 'SeT transaction_read_only = on', meaning: 'unquoted keywords are case-insensitive', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL03', title: 'comment-separated SET is rejected', sql: 'SET/*x*/transaction_read_only=on', meaning: 'comments do not break the top-level SET token sequence', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL04', title: 'SET LOCAL transaction_read_only is rejected', sql: 'SET LOCAL transaction_read_only = on', meaning: 'SET LOCAL changes a transaction-scoped run-time parameter', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL05', title: 'SET SESSION transaction_read_only is rejected', sql: 'SET SESSION transaction_read_only = on', meaning: 'SET SESSION changes a session-scoped run-time parameter', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL06', title: 'SET transaction_isolation is rejected', sql: "SET transaction_isolation = 'serializable'", meaning: 'transaction_isolation is equivalent to SET TRANSACTION isolation', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL07', title: 'SET transaction_deferrable is rejected', sql: 'SET transaction_deferrable = on', meaning: 'transaction_deferrable is equivalent to SET TRANSACTION deferrability', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL08', title: 'RESET transaction_read_only is rejected', sql: 'RESET transaction_read_only', meaning: 'RESET changes the active run-time parameter value', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL09', title: 'SET ROLE is rejected', sql: 'SET ROLE application_admin', meaning: 'SET ROLE changes current_user and the privilege set', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL10', title: 'SET LOCAL ROLE is rejected', sql: 'SET LOCAL ROLE application_admin', meaning: 'LOCAL does not make role mutation safe for the callback channel', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL11', title: 'RESET ROLE is rejected', sql: 'RESET ROLE', meaning: 'RESET ROLE changes current_user to its connection-time state', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL12', title: 'SET SESSION AUTHORIZATION is rejected', sql: 'SET SESSION AUTHORIZATION DEFAULT', meaning: 'session authorization is a framework-owned identity boundary', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL13', title: 'set_config local transaction mode is rejected', sql: "SELECT set_config('transaction_read_only', 'on', true)", meaning: 'set_config with true is equivalent to transaction-local SET', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL14', title: 'set_config session transaction mode is rejected', sql: "SELECT set_config('transaction_read_only', 'on', false)", meaning: 'set_config with false is equivalent to session SET', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL15', title: 'qualified set_config is rejected', sql: "SELECT pg_catalog.set_config('standard_conforming_strings', 'off', false)", meaning: 'pg_catalog qualification still calls the run-time configuration function', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL16', title: 'qualified pg_settings update is rejected', sql: "UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only'", meaning: 'updating pg_settings.setting is equivalent to SET', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL17', title: 'repeatable-read transaction isolation is rejected', sql: "SET transaction_isolation = 'repeatable read'", meaning: 'all transaction_isolation mutations are framework-owned', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL18', title: 'qualified set_config transaction isolation is rejected', sql: "SELECT pg_catalog.set_config('transaction_isolation', 'serializable', true)", meaning: 'qualified set_config can mutate a transaction characteristic', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL19', title: 'unqualified pg_settings update is rejected', sql: "UPDATE pg_settings SET setting='on' WHERE name='transaction_read_only'", meaning: 'unqualified pg_settings resolves through the system catalog path', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL20', title: 'lowercase RESET ROLE is rejected', sql: 'reset role', meaning: 'unquoted RESET ROLE is case-insensitive', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL21', title: 'uppercase transaction SET is rejected', sql: 'SET TRANSACTION_READ_ONLY = ON', meaning: 'uppercase run-time parameter spelling is equivalent', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL22', title: 'BOM CRLF and comments cannot hide SET ROLE', sql: '\uFEFF\r\n/* guard */ SET/*x*/ROLE application_admin', meaning: 'ignorable lexical material cannot change the top-level statement family', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL23', title: 'DISCARD is rejected by the finite allowlist', sql: 'DISCARD ALL', meaning: 'DISCARD mutates session state and is not a business statement family', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL24', title: 'SET CONSTRAINTS is rejected by the finite allowlist', sql: 'SET CONSTRAINTS ALL DEFERRED', meaning: 'constraint timing is owned by the transaction framework', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL25', title: 'WITH cannot terminate in RESET ROLE', sql: 'WITH x AS (SELECT 1) RESET ROLE', meaning: 'WITH must terminate in an allowed business statement family', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL26', title: 'set_config text in an ordinary string is allowed', sql: "SELECT 'set_config('", meaning: 'ordinary string contents are not executable tokens', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL27', title: 'RESET ROLE text in an ordinary string is allowed', sql: "SELECT 'RESET ROLE'", meaning: 'role keywords inside a string are data', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL28', title: 'transaction SET text in a dollar quote is allowed', sql: 'SELECT $$SET transaction_read_only = on$$', meaning: 'matched dollar-quoted contents are data', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL29', title: 'SET ROLE text in a block comment is allowed', sql: 'SELECT 1 /* SET ROLE admin */', meaning: 'comment contents are not executable tokens', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL30', title: 'SET ROLE text in an escape string is allowed', sql: "SELECT E'SET ROLE application_admin'", meaning: 'closed escape-string contents are data', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL31', title: 'current_setting remains allowed', sql: "SELECT current_setting('transaction_read_only')", meaning: 'current_setting is a read-only inspection function', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL32', title: 'identifier containing set_config remains allowed', sql: 'SELECT my_set_config_value FROM configuration_snapshot', meaning: 'substring matches in ordinary identifiers are not function calls', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL33', title: 'SELECT family remains allowed', sql: 'SELECT 1 AS value', meaning: 'SELECT is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL34', title: 'INSERT family remains allowed', sql: 'INSERT INTO xht_policy_target(id) VALUES (1)', meaning: 'INSERT is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL35', title: 'UPDATE family remains allowed', sql: 'UPDATE xht_policy_target SET id = 2 WHERE id = 1', meaning: 'ordinary business UPDATE is allowed', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL36', title: 'DELETE family remains allowed', sql: 'DELETE FROM xht_policy_target WHERE id = 1', meaning: 'DELETE is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL37', title: 'MERGE family remains allowed', sql: 'MERGE INTO xht_policy_target AS t USING (VALUES (1)) AS s(id) ON t.id = s.id WHEN MATCHED THEN UPDATE SET id = s.id WHEN NOT MATCHED THEN INSERT (id) VALUES (s.id)', meaning: 'MERGE is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL38', title: 'VALUES family remains allowed', sql: 'VALUES (1)', meaning: 'VALUES is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL39', title: 'WITH terminating in SELECT is allowed', sql: 'WITH x AS (SELECT 1 AS id) SELECT id FROM x', meaning: 'WITH is allowed when its final top-level family is SELECT', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL40', title: 'WITH terminating in INSERT is allowed', sql: 'WITH x AS (SELECT 1 AS id) INSERT INTO xht_policy_target(id) SELECT id FROM x', meaning: 'WITH may terminate in INSERT', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL41', title: 'WITH terminating in UPDATE is allowed', sql: 'WITH x AS (SELECT 1 AS id) UPDATE xht_policy_target SET id = x.id FROM x WHERE xht_policy_target.id = 1', meaning: 'WITH may terminate in an ordinary business UPDATE', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL42', title: 'WITH terminating in DELETE is allowed', sql: 'WITH x AS (SELECT 1 AS id) DELETE FROM xht_policy_target USING x WHERE xht_policy_target.id = x.id', meaning: 'WITH may terminate in DELETE', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL43', title: 'WITH terminating in MERGE is allowed', sql: 'WITH x AS (SELECT 1 AS id) MERGE INTO xht_policy_target AS t USING x ON t.id = x.id WHEN MATCHED THEN UPDATE SET id = x.id', meaning: 'WITH may terminate in MERGE', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL44', title: 'WITH terminating in VALUES is allowed', sql: 'WITH x AS (SELECT 1 AS id) VALUES (1)', meaning: 'WITH may terminate in VALUES', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL45', title: 'quoted pg_catalog pg_settings update is rejected', sql: "UPDATE \"pg_catalog\".\"pg_settings\" SET setting = 'on' WHERE name = 'transaction_read_only'", meaning: 'exact lower-case quoted system identifiers still name pg_catalog.pg_settings', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL46', title: 'quoted set_config call is rejected', sql: "SELECT \"set_config\"('transaction_read_only', 'on', true)", meaning: 'the exact quoted lower-case built-in name remains a function call token', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL47', title: 'WITH SELECT set_config call is rejected', sql: "WITH x AS (SELECT 1) SELECT set_config('transaction_read_only', 'on', true) FROM x", meaning: 'allowed outer family does not permit a nested configuration call', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL48', title: 'WITH UPDATE pg_settings is rejected', sql: "WITH x AS (SELECT 'on' AS setting) UPDATE pg_catalog.pg_settings SET setting = x.setting FROM x WHERE name = 'transaction_read_only'", meaning: 'WITH does not hide the final pg_settings update target', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL49', title: 'qualified identifier containing set_config is allowed', sql: 'SELECT configuration_snapshot.my_set_config_value FROM configuration_snapshot', meaning: 'qualified ordinary identifiers do not become set_config calls', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL50', title: 'different function containing set_config is allowed', sql: 'SELECT my_set_config_value(1)', meaning: 'only the exact set_config function identifier is denied', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL51', title: 'qualified pg_settings data-modifying CTE is rejected', sql: "WITH changed AS (UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1", meaning: 'a data-modifying CTE updates the qualified run-time settings view even when the primary statement is SELECT', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL52', title: 'unqualified pg_settings data-modifying CTE is rejected', sql: "WITH changed AS (UPDATE pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1", companionSql: ["WITH changed AS (UPDATE ONLY pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1"], meaning: 'an unqualified data-modifying CTE, including optional ONLY, can update the run-time settings view', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL53', title: 'quoted qualified pg_settings data-modifying CTE is rejected', sql: "WITH changed AS (UPDATE \"pg_catalog\".\"pg_settings\" SET setting='on' WHERE name='transaction_read_only') SELECT 1", companionSql: ["WITH changed AS (UPDATE ONLY \"pg_catalog\".\"pg_settings\" SET setting='on' WHERE name='transaction_read_only') SELECT 1"], meaning: 'exact lower-case quoted system identifiers, including optional ONLY, still target pg_catalog.pg_settings inside a CTE', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL54', title: 'pg_settings UPDATE in the second CTE is rejected', sql: "WITH safe AS (SELECT 1), changed AS (UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1", meaning: 'every executable CTE scope must be inspected rather than only the first CTE or primary statement', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL55', title: 'pg_settings UPDATE CTE with RETURNING is rejected', sql: "WITH changed AS (UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only' RETURNING name) SELECT name FROM changed", meaning: 'RETURNING makes CTE output visible but does not make the run-time setting update safe', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL56', title: 'ordinary business data-modifying CTE remains allowed', sql: 'WITH changed AS (UPDATE xht_policy_target SET id=2 WHERE id=1 RETURNING id) SELECT id FROM changed', meaning: 'a business-table UPDATE CTE remains in the finite allowed contract', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL57', title: 'read-only pg_settings CTE remains allowed', sql: "WITH settings AS (SELECT setting FROM pg_catalog.pg_settings WHERE name='transaction_read_only') SELECT setting FROM settings", meaning: 'reading pg_settings through a SELECT CTE does not mutate run-time configuration', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true }
] as const satisfies readonly CallbackSqlPolicyCase[];

const policyFollowupSql = 'SELECT 1 AS xht_policy_followup';
function utf8Hex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex').toUpperCase().match(/../gu)?.join(' ') ?? '';
}

for (const policyCase of callbackSqlPolicyContract) {
  it(`${policyCase.id}: ${policyCase.title}`, async () => {
    for (const [variantIndex, sql] of [
      policyCase.sql,
      ...('companionSql' in policyCase ? policyCase.companionSql : [])
    ].entries()) {
      const state = createScriptedState();
      const scripted = createScriptedDatabase(state);
      let actual: CallbackSqlPolicyExpectation = 'allow';
      let error: unknown;
      try {
        const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
        try {
          await local.execute((context) =>
            executeInjectedSql(context, sql)
          );
        } catch (failure: unknown) {
          actual = 'reject';
          error = failure;
        }
        const delegateCalls = state.queryEvidence.filter(
          (entry) => entry.text === sql
        ).length;
        const sensitiveHits = error === undefined ? 0 : rawLeakHitCount(error);
        expect(utf8Hex(sql)).not.toBe('');
        expect(delegateCalls).toBe(policyCase.expectedDelegateCalls);
        expect(actual).toBe(policyCase.expected);
        if (policyCase.expected === 'reject') {
          expect(error).toMatchObject({
            code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
            outcome: 'ROLLED_BACK'
          });
          expectNoRawLeak(error);
        } else {
          expect(error).toBeUndefined();
        }
        expect(sensitiveHits).toBe(0);
        await local.execute((context) =>
          executeInjectedSql(context, policyFollowupSql)
        );
        expect(
          state.queryEvidence.filter(
            (entry) => entry.text === policyFollowupSql
          )
        ).toHaveLength(1);
        expect(state.normalReleaseIds).toEqual([1, 1]);
        expect(state.destroyReleaseIds).toEqual([]);
        expect(state.acquiredClientIds).toEqual([1, 1]);
        if (process.env['XHT_TASK4_POLICY_EVIDENCE'] === '1') {
          console.log('SQLPOL_EVIDENCE', JSON.stringify({
            id:
              variantIndex === 0
                ? policyCase.id
                : `${policyCase.id}.VARIANT${variantIndex}`,
            title: policyCase.title,
            sql,
            utf8Hex: utf8Hex(sql),
            meaning: policyCase.meaning,
            expected: policyCase.expected,
            actual,
            delegateCalls,
            sensitiveHits,
            release: 'normal',
            nextLegalQuery: true
          }));
        }
      } finally {
        await scripted.destroy();
      }
    }
  });
}

});

void assertContextTypeSurface;
```
<!-- XHT-CANONICAL-END target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="5" -->
