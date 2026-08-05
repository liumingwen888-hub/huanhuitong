# Unit of Work integration spec part 03 canonical fragment

[← Canonical fragments index](00-index.md) · [← Task 4 LAYOUT-S1 index](../00-index.md)

> LAYOUT-S1 navigation metadata. The fenced bytes below are canonical future engineering content frozen from Task 4 v1.9/v11. This fragment is not an implemented project source file.

- Reconstructed target: `apps/platform/test/database/unit-of-work.integration.spec.ts`
- Assembly sequence: 4 of 5
- Responsibility: LEX01–LEX23 contract table and test bodies.
- Segment bytes: 13232
- Segment lines: 388
- Segment SHA-256: `9ECB0FD8AFB38213F58889C7045C5276B0D8DE62FA125C1E476D6D74E3B08414`
- Full target bytes: 113197
- Full target SHA-256: `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789`

<!-- XHT-CANONICAL-BEGIN target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="4" -->
```ts
const lexicalCaseContract = {
  LEX01: {
    sql: String.raw`select '\'; commit`,
    characters: String.raw`ordinary string: backslash, closing quote, top-level ; commit`,
    meaning: 'ordinary string is configuration-ambiguous, so strategy A rejects',
    expected: 'reject',
    delegates: 0
  },
  LEX02: {
    sql: String.raw`select '\'; rollback`,
    characters: String.raw`ordinary string: backslash, closing quote, top-level ; rollback`,
    meaning: 'ordinary string is configuration-ambiguous, so strategy A rejects',
    expected: 'reject',
    delegates: 0
  },
  LEX03: {
    sql: String.raw`insert into xht_probe(value) values ('\'); commit`,
    characters: String.raw`insert value has ordinary backslash before closing quote`,
    meaning: 'reject before the insert can reach the delegate',
    expected: 'reject',
    delegates: 0
  },
  LEX04: {
    sql: [
      String.raw`select '\'; commit`,
      String.raw`select '\'; COMMIT`,
      String.raw`select '\'; CoMmIt`
    ],
    characters: 'three keyword case variants after the same ordinary string',
    meaning: 'all are rejected by the string policy before keyword case matters',
    expected: 'reject',
    delegates: 0
  },
  LEX05: {
    sql: "select 'commit' as value",
    characters: 'commit is inside a closed ordinary string without backslash',
    meaning: 'one SELECT statement',
    expected: 'accept',
    delegates: 1
  },
  LEX06: {
    sql: "select 'rollback' as value",
    characters: 'rollback is inside a closed ordinary string without backslash',
    meaning: 'one SELECT statement',
    expected: 'accept',
    delegates: 1
  },
  LEX07: {
    sql: "select 'it''s commit' as value",
    characters: 'ordinary string uses doubled single quote',
    meaning: 'doubled quote remains inside one ordinary string',
    expected: 'accept',
    delegates: 1
  },
  LEX08: {
    sql: String.raw`select E'\'; commit'`,
    characters: String.raw`E string backslash-escapes the first quote; final quote closes`,
    meaning: 'semicolon and commit remain inside the escape string',
    expected: 'accept',
    delegates: 1
  },
  LEX09: {
    sql: String.raw`select E'\\'; commit`,
    characters: String.raw`E string has escaped backslash, then closes before ; commit`,
    meaning: 'commit is a second top-level statement',
    expected: 'reject',
    delegates: 0
  },
  LEX10: {
    sql: [
      String.raw`select e'\'; commit'`,
      String.raw`select E'\'; commit'`
    ],
    characters: 'lowercase and uppercase escape prefixes with identical bodies',
    meaning: 'both semicolons remain inside their escape strings',
    expected: 'accept',
    delegates: 1
  },
  LEX11: {
    sql: String.raw`select employee'\'; commit`,
    characters: String.raw`identifier ends in e immediately before an ordinary quote`,
    meaning: 'the identifier suffix is not an E prefix; ordinary backslash policy rejects',
    expected: 'reject',
    delegates: 0
  },
  LEX12: {
    sql: 'select $tag$; commit rollback$tag$ as value',
    characters: 'semicolon and controls are inside a matched dollar tag',
    meaning: 'one SELECT statement',
    expected: 'accept',
    delegates: 1
  },
  LEX13: {
    sql: 'select $tag$safe$tag$; commit',
    characters: 'matched dollar string closes before top-level ; commit',
    meaning: 'commit is a second statement',
    expected: 'reject',
    delegates: 0
  },
  LEX14: {
    sql: 'select 1 /* outer ; commit /* nested */ rollback */ -- commit\r\n;',
    characters: 'nested block comment, line comment, CRLF, one trailing semicolon',
    meaning: 'comment text is ignored and the only semicolon is trailing',
    expected: 'accept',
    delegates: 1
  },
  LEX15: {
    sql:
      '\uFEFF -- commit\r\n/* outer /* rollback */ safe */ ' +
      String.raw`select '\'; commit`,
    characters: 'BOM, CRLF, comments, then the exact ordinary-string exploit',
    meaning: 'prefix trivia cannot bypass strategy A',
    expected: 'reject',
    delegates: 0
  },
  LEX16: {
    sql: "select 'unterminated",
    characters: 'ordinary quote has no close',
    meaning: 'lexically incomplete input fails closed',
    expected: 'reject',
    delegates: 0
  },
  LEX17: {
    sql: String.raw`select E'unterminated\q`,
    characters: String.raw`escape string consumes \q but has no closing quote`,
    meaning: 'lexically incomplete input fails closed',
    expected: 'reject',
    delegates: 0
  },
  LEX18: {
    sql: 'select $tag$unterminated',
    characters: 'opening dollar tag has no exact closing tag',
    meaning: 'lexically incomplete input fails closed',
    expected: 'reject',
    delegates: 0
  },
  LEX19: {
    sql: 'select 1 /* outer /* nested */',
    characters: 'outer block comment remains open after nested close',
    meaning: 'nested comment depth is nonzero and fails closed',
    expected: 'reject',
    delegates: 0
  },
  LEX20: {
    sql: [
      String.raw`select U&'\0041'`,
      String.raw`select U&"d\0061t"`,
      String.raw`select U&'\0041' UESCAPE '\'`,
      "select B'1010'",
      "select X'CAFE'",
      "select N'national'"
    ],
    characters: 'Unicode, bit, hex, and national prefixed forms',
    meaning: 'forms not fully modeled by the five-file scanner fail closed',
    expected: 'reject',
    delegates: 0
  },
  LEX21: {
    sql: String.raw`select '\'; commit`,
    characters: 'strategy-A rejection on a healthy client',
    meaning: 'rollback succeeds and the client is released normally',
    expected: 'reject',
    delegates: 0
  },
  LEX22: {
    sql: String.raw`select '\'; rollback`,
    characters: 'rejected request followed by a legal request',
    meaning: 'the same healthy pool client can be reused',
    expected: 'reject-then-accept',
    delegates: 0
  },
  LEX23: {
    sql: String.raw`select '\'; commit -- synthetic-raw-password`,
    characters: 'unsafe SQL contains a secret-shaped sentinel',
    meaning: 'fixed public error contains no SQL, connection, or internal object',
    expected: 'reject',
    delegates: 0
  }
} as const;

async function acceptScriptedSql(
  sqlText: string
): Promise<ScriptedState> {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await local.execute((context) => executeInjectedSql(context, sqlText));
    expect(
      state.queryEvidence.filter((entry) => entry.text === sqlText)
    ).toHaveLength(1);
    return state;
  } finally {
    await scripted.destroy();
  }
}

it('LEX01: ordinary backslash before COMMIT rejects before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX01.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX02: ordinary backslash before ROLLBACK rejects before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX02.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX03: insert exploit has zero partial delegate side effects', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX03.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX04: commit keyword case variants all reject before delegate', async () => {
  for (const sqlText of lexicalCaseContract.LEX04.sql) {
    const evidence = await rejectScriptedSql(
      sqlText,
      'TRANSACTION_QUERY_UNSAFE'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('LEX05: legal commit text in an ordinary string is accepted', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX05.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX06: legal rollback text in an ordinary string is accepted', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX06.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX07: doubled ordinary quote is parsed without false positive', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX07.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX08: escaped quote keeps semicolon inside an E string', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX08.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX09: closed E string before COMMIT rejects before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX09.sql,
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX10: lowercase and uppercase E prefixes are equivalent', async () => {
  for (const sqlText of lexicalCaseContract.LEX10.sql) {
    const state = await acceptScriptedSql(sqlText);
    expect(state.normalReleaseIds).toEqual([1]);
  }
});

it('LEX11: identifier suffix e is not an escape prefix', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX11.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX12: matched dollar quote hides internal controls', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX12.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX13: statement after matched dollar quote is rejected', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX13.sql,
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX14: line and nested block comments preserve trailing semicolon', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX14.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX15: BOM CRLF and comments cannot hide ordinary backslash', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX15.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX16: unclosed ordinary string fails closed before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX16.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX17: unclosed escape string fails closed before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX17.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX18: unclosed dollar quote fails closed before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX18.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX19: unclosed nested block comment fails closed before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX19.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX20: unsupported prefixed forms all fail closed before delegate', async () => {
  for (const sqlText of lexicalCaseContract.LEX20.sql) {
    const evidence = await rejectScriptedSql(
      sqlText,
      'TRANSACTION_QUERY_UNSAFE'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('LEX21: strategy rejection uses healthy normal release', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX21.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.normalReleaseIds).toEqual([1]);
  expect(evidence.state.destroyReleaseIds).toEqual([]);
});

it('LEX22: legal execute after rejection reuses the healthy pool', async () => {
  const rejectedSql = lexicalCaseContract.LEX22.sql;
  const legalSql = 'select 1 as value';
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    const error = await local
      .execute((context) => executeInjectedSql(context, rejectedSql))
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'TRANSACTION_QUERY_UNSAFE' });
    expect(
      state.queryEvidence.filter((entry) => entry.text === rejectedSql)
    ).toHaveLength(0);
    await local.execute((context) => executeInjectedSql(context, legalSql));
    expect(
      state.queryEvidence.filter((entry) => entry.text === legalSql)
    ).toHaveLength(1);
    expect(state.acquiredClientIds).toEqual([1, 1]);
    expect(state.normalReleaseIds).toEqual([1, 1]);
  } finally {
    await scripted.destroy();
  }
});

it('LEX23: unsafe error leaks no SQL connection or internal object', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX23.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expectUnitErrorContract(evidence.error, {
    code: 'TRANSACTION_QUERY_UNSAFE',
    outcome: 'ROLLED_BACK'
  });
  expectNoRawLeak(evidence.error);
});

```
<!-- XHT-CANONICAL-END target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="4" -->
