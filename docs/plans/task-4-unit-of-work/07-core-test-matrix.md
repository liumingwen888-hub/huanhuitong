# Core test matrix

[← Task 4 LAYOUT-S1 index](00-index.md) · [Canonical fragments](fragments/00-index.md)

> Navigation and tables in this file are LAYOUT-S1 material. Test titles, inputs and contracts remain Task 4 v1.9.

## 7. 测试矩阵与过滤器

最终 future integration spec 含 138 个唯一测试：UOW01～UOW25、REV01、CLEAN01、REL01～REL05、IMM01、TXCTL01～TXCTL25 共 58 条，LEX01～LEX23 共 23 条，SQLPOL01～SQLPOL57 共 57 条；编号、title、正文、过滤器和报告一一对应。LEX 表 `lexicalCaseContract` 保留四个指定 `String.raw` 原字节；`callbackSqlPolicyContract` 为每条新增对抗用例记录编号、名称、原始 SQL、PostgreSQL 含义、允许/拒绝预期、目标 delegate、normal release、后续合法查询要求和公开错误敏感命中，运行时以严格 UTF-8 计算十六进制并可由 `XHT_TASK4_POLICY_EVIDENCE=1` 输出逐条实际证据。SQLPOL52/53 在同一编号测试中另含可选 `ONLY` 的 unqualified/quoted-qualified 精确变体，不增加测试编号。

未来实施的真实 database project 必须在 `XHT_TASK4_SCRIPTED_ONLY` 未设置时运行 138/138；本计划复审的 TEMP scripted 证据只设置该变量并运行不依赖数据库的聚焦 test，不得描述为真实 PostgreSQL 通过。v1.6 的 45 条 scripted 子集必须继续通过；13 条真实 fixture 测试本轮明确 `NOT_RERUN`；LEX01～LEX23 单独 23/23；SQLPOL01～SQLPOL50 回归 50/50；SQLPOL01～SQLPOL57 最终 57/57。

九个既有过滤器：`TXCTL0[1-9]`=9；`REL0[1-5]`=5；`IMM01`=1；`(REL(03|04|05)|TXCTL(16|17))`=5；`CLEAN01`=1；`(IMM01|TXCTL25)`=2；`TXCTL(0[1-9]|1[014-9]|2[0-5])`=23；`LEX(0[1-9]|1[0-9]|2[0-3])`=23；`SQLPOL(0[1-9]|[1-4][0-9]|50)`=50。v1.9 新最终过滤器：`SQLPOL(0[1-9]|[1-4][0-9]|5[0-7])`=57。每个过滤器必须在运行前声明期望，matched 等于期望且不为 0、failed 0、exit 0。

## Non-SQLPOL integration groups

| Group | Count |
|---|---:|
| UOW | 25 |
| REV | 1 |
| CLEAN | 1 |
| REL | 5 |
| IMM | 1 |
| TXCTL | 25 |
| LEX | 23 |

Total non-SQLPOL integration tests: 81. SQLPOL01–SQLPOL57 add 57, producing the frozen future integration total 138.

| ID | Frozen title | Canonical body |
|---|---|---|
| UOW01 | sync callback returns scalar after a successful commit | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW02 | async callback preserves object identity and commits | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW03 | two writes share one backend and commit together | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW04 | sync throw rolls back and preserves safe cause identity | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW05 | async reject rolls back and preserves safe cause identity | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW06 | second write constraint failure rolls back every write | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW07 | caught SQL failure cannot produce a false commit | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW08 | derived QueryCreator stays on the same transaction backend | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW09 | revoked context rejects late use without SQL | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW10 | escaped database facade rejects after callback scope | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW11 | escaped prebuilt builder rejects after revocation | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW12 | plugin, pluginless, and schema derivatives retain the lease | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW13 | nested execute rejects before acquiring another connection | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW14 | independent outer executes remain concurrent and isolated | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW15 | uncommitted row is local then becomes globally visible | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW16 | rolled-back row is not visible on any later connection | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW17 | transaction keeps platform session and current roles | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW18 | acquire and begin failures skip callback and release correctly | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW19 | rollback fault injection preserves primary and recovery evidence | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| REV01 | context is revoked while commit is pending | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW20 | cleanup attempts every owner after a destroy failure | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| CLEAN01 | partial setup owns and closes every acquired resource exactly once | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW21 | commit outcome unknown never rolls back or returns result | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW22 | raw callback errors are sanitized with both rollback outcomes | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW23 | real rollback connection fault is destroyed before recovery | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW24 | real precommit connection fault destroys the client | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| UOW25 | explicit commit rejection rolls back and hides its result | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| REL01 | committed outcome survives normal release failure | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| REL02 | rolled-back callback cause survives normal release failure | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| REL03 | unknown commit survives destroy release failure | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| REL04 | callback and rollback failure survives destroy release failure | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| REL05 | rejected commit outcome survives destroy release failure | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| IMM01 | every identity-safe error is frozen and rejects field pollution | [UOW/REL/IMM/CLEAN canonical body](fragments/05-unit-of-work.integration.spec.part-01.ts.md) |
| TXCTL01 | single ROLLBACK is rejected before send | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL02 | single COMMIT is rejected before send | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL03 | BEGIN START TRANSACTION END and ABORT are rejected | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL04 | SAVEPOINT RELEASE SAVEPOINT and ROLLBACK TO are rejected | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL05 | prepared transaction controls are rejected | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL06 | SET TRANSACTION is rejected | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL07 | SET SESSION CHARACTERISTICS AS TRANSACTION is rejected | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL08 | case BOM whitespace line and nested block comments cannot bypass | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL09 | select rollback select has zero partial execution | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL10 | select commit select has zero partial execution | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL11 | insert followed by commit has zero partial execution | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL12 | legal write followed by ROLLBACK rolls back the write | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL13 | legal write followed by COMMIT rolls back the write | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL14 | rollback success preserves the policy result contract | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL15 | rollback failure preserves recovery evidence | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL16 | release failure does not replace the transaction result | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL17 | policy rejection returns a healthy client normally | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL18 | execute after policy rejection still uses the pool | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL19 | string and dollar literals do not cause false positives | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL20 | comment keywords and semicolons do not cause false positives | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL21 | no-parameter callback query uses extended mode | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL22 | parameterized callback query remains usable in extended mode | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL23 | callback cannot obtain raw client pool or executor | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL24 | reflection prototype and plugin do not expose internal channels | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| TXCTL25 | policy errors expose zero raw SQL parameters or secrets | [TXCTL canonical body](fragments/05-unit-of-work.integration.spec.part-02.ts.md) |
| LEX01 | ordinary backslash before COMMIT rejects before delegate | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX02 | ordinary backslash before ROLLBACK rejects before delegate | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX03 | insert exploit has zero partial delegate side effects | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX04 | commit keyword case variants all reject before delegate | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX05 | legal commit text in an ordinary string is accepted | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX06 | legal rollback text in an ordinary string is accepted | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX07 | doubled ordinary quote is parsed without false positive | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX08 | escaped quote keeps semicolon inside an E string | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX09 | closed E string before COMMIT rejects before delegate | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX10 | lowercase and uppercase E prefixes are equivalent | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX11 | identifier suffix e is not an escape prefix | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX12 | matched dollar quote hides internal controls | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX13 | statement after matched dollar quote is rejected | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX14 | line and nested block comments preserve trailing semicolon | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX15 | BOM CRLF and comments cannot hide ordinary backslash | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX16 | unclosed ordinary string fails closed before delegate | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX17 | unclosed escape string fails closed before delegate | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX18 | unclosed dollar quote fails closed before delegate | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX19 | unclosed nested block comment fails closed before delegate | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX20 | unsupported prefixed forms all fail closed before delegate | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX21 | strategy rejection uses healthy normal release | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX22 | legal execute after rejection reuses the healthy pool | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |
| LEX23 | unsafe error leaks no SQL connection or internal object | [LEX canonical body](fragments/05-unit-of-work.integration.spec.part-03.ts.md) |

## LEX01–LEX23 exact contract

### LEX01

- Variant 1 JSON-visible original: `"select '\\'; commit"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 5C 27 3B 20 63 6F 6D 6D 69 74`
- Character contract: ordinary string: backslash, closing quote, top-level ; commit
- PostgreSQL/scanner meaning: ordinary string is configuration-ambiguous, so strategy A rejects
- expected: `reject`
- delegate calls: `0`

### LEX02

- Variant 1 JSON-visible original: `"select '\\'; rollback"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 5C 27 3B 20 72 6F 6C 6C 62 61 63 6B`
- Character contract: ordinary string: backslash, closing quote, top-level ; rollback
- PostgreSQL/scanner meaning: ordinary string is configuration-ambiguous, so strategy A rejects
- expected: `reject`
- delegate calls: `0`

### LEX03

- Variant 1 JSON-visible original: `"insert into xht_probe(value) values ('\\'); commit"`
- Variant 1 UTF-8 hex: `69 6E 73 65 72 74 20 69 6E 74 6F 20 78 68 74 5F 70 72 6F 62 65 28 76 61 6C 75 65 29 20 76 61 6C 75 65 73 20 28 27 5C 27 29 3B 20 63 6F 6D 6D 69 74`
- Character contract: insert value has ordinary backslash before closing quote
- PostgreSQL/scanner meaning: reject before the insert can reach the delegate
- expected: `reject`
- delegate calls: `0`

### LEX04

- Variant 1 JSON-visible original: `"select '\\'; commit"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 5C 27 3B 20 63 6F 6D 6D 69 74`
- Variant 2 JSON-visible original: `"select '\\'; COMMIT"`
- Variant 2 UTF-8 hex: `73 65 6C 65 63 74 20 27 5C 27 3B 20 43 4F 4D 4D 49 54`
- Variant 3 JSON-visible original: `"select '\\'; CoMmIt"`
- Variant 3 UTF-8 hex: `73 65 6C 65 63 74 20 27 5C 27 3B 20 43 6F 4D 6D 49 74`
- Character contract: three keyword case variants after the same ordinary string
- PostgreSQL/scanner meaning: all are rejected by the string policy before keyword case matters
- expected: `reject`
- delegate calls: `0`

### LEX05

- Variant 1 JSON-visible original: `"select 'commit' as value"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 63 6F 6D 6D 69 74 27 20 61 73 20 76 61 6C 75 65`
- Character contract: commit is inside a closed ordinary string without backslash
- PostgreSQL/scanner meaning: one SELECT statement
- expected: `accept`
- delegate calls: `1`

### LEX06

- Variant 1 JSON-visible original: `"select 'rollback' as value"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 72 6F 6C 6C 62 61 63 6B 27 20 61 73 20 76 61 6C 75 65`
- Character contract: rollback is inside a closed ordinary string without backslash
- PostgreSQL/scanner meaning: one SELECT statement
- expected: `accept`
- delegate calls: `1`

### LEX07

- Variant 1 JSON-visible original: `"select 'it''s commit' as value"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 69 74 27 27 73 20 63 6F 6D 6D 69 74 27 20 61 73 20 76 61 6C 75 65`
- Character contract: ordinary string uses doubled single quote
- PostgreSQL/scanner meaning: doubled quote remains inside one ordinary string
- expected: `accept`
- delegate calls: `1`

### LEX08

- Variant 1 JSON-visible original: `"select E'\\'; commit'"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 45 27 5C 27 3B 20 63 6F 6D 6D 69 74 27`
- Character contract: E string backslash-escapes the first quote; final quote closes
- PostgreSQL/scanner meaning: semicolon and commit remain inside the escape string
- expected: `accept`
- delegate calls: `1`

### LEX09

- Variant 1 JSON-visible original: `"select E'\\\\'; commit"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 45 27 5C 5C 27 3B 20 63 6F 6D 6D 69 74`
- Character contract: E string has escaped backslash, then closes before ; commit
- PostgreSQL/scanner meaning: commit is a second top-level statement
- expected: `reject`
- delegate calls: `0`

### LEX10

- Variant 1 JSON-visible original: `"select e'\\'; commit'"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 65 27 5C 27 3B 20 63 6F 6D 6D 69 74 27`
- Variant 2 JSON-visible original: `"select E'\\'; commit'"`
- Variant 2 UTF-8 hex: `73 65 6C 65 63 74 20 45 27 5C 27 3B 20 63 6F 6D 6D 69 74 27`
- Character contract: lowercase and uppercase escape prefixes with identical bodies
- PostgreSQL/scanner meaning: both semicolons remain inside their escape strings
- expected: `accept`
- delegate calls: `1`

### LEX11

- Variant 1 JSON-visible original: `"select employee'\\'; commit"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 65 6D 70 6C 6F 79 65 65 27 5C 27 3B 20 63 6F 6D 6D 69 74`
- Character contract: identifier ends in e immediately before an ordinary quote
- PostgreSQL/scanner meaning: the identifier suffix is not an E prefix; ordinary backslash policy rejects
- expected: `reject`
- delegate calls: `0`

### LEX12

- Variant 1 JSON-visible original: `"select $tag$; commit rollback$tag$ as value"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 24 74 61 67 24 3B 20 63 6F 6D 6D 69 74 20 72 6F 6C 6C 62 61 63 6B 24 74 61 67 24 20 61 73 20 76 61 6C 75 65`
- Character contract: semicolon and controls are inside a matched dollar tag
- PostgreSQL/scanner meaning: one SELECT statement
- expected: `accept`
- delegate calls: `1`

### LEX13

- Variant 1 JSON-visible original: `"select $tag$safe$tag$; commit"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 24 74 61 67 24 73 61 66 65 24 74 61 67 24 3B 20 63 6F 6D 6D 69 74`
- Character contract: matched dollar string closes before top-level ; commit
- PostgreSQL/scanner meaning: commit is a second statement
- expected: `reject`
- delegate calls: `0`

### LEX14

- Variant 1 JSON-visible original: `"select 1 /* outer ; commit /* nested */ rollback */ -- commit\r\n;"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 31 20 2F 2A 20 6F 75 74 65 72 20 3B 20 63 6F 6D 6D 69 74 20 2F 2A 20 6E 65 73 74 65 64 20 2A 2F 20 72 6F 6C 6C 62 61 63 6B 20 2A 2F 20 2D 2D 20 63 6F 6D 6D 69 74 0D 0A 3B`
- Character contract: nested block comment, line comment, CRLF, one trailing semicolon
- PostgreSQL/scanner meaning: comment text is ignored and the only semicolon is trailing
- expected: `accept`
- delegate calls: `1`

### LEX15

- Variant 1 JSON-visible original: `"﻿ -- commit\r\n/* outer /* rollback */ safe */ select '\\'; commit"`
- Variant 1 UTF-8 hex: `EF BB BF 20 2D 2D 20 63 6F 6D 6D 69 74 0D 0A 2F 2A 20 6F 75 74 65 72 20 2F 2A 20 72 6F 6C 6C 62 61 63 6B 20 2A 2F 20 73 61 66 65 20 2A 2F 20 73 65 6C 65 63 74 20 27 5C 27 3B 20 63 6F 6D 6D 69 74`
- Character contract: BOM, CRLF, comments, then the exact ordinary-string exploit
- PostgreSQL/scanner meaning: prefix trivia cannot bypass strategy A
- expected: `reject`
- delegate calls: `0`

### LEX16

- Variant 1 JSON-visible original: `"select 'unterminated"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 75 6E 74 65 72 6D 69 6E 61 74 65 64`
- Character contract: ordinary quote has no close
- PostgreSQL/scanner meaning: lexically incomplete input fails closed
- expected: `reject`
- delegate calls: `0`

### LEX17

- Variant 1 JSON-visible original: `"select E'unterminated\\q"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 45 27 75 6E 74 65 72 6D 69 6E 61 74 65 64 5C 71`
- Character contract: escape string consumes \q but has no closing quote
- PostgreSQL/scanner meaning: lexically incomplete input fails closed
- expected: `reject`
- delegate calls: `0`

### LEX18

- Variant 1 JSON-visible original: `"select $tag$unterminated"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 24 74 61 67 24 75 6E 74 65 72 6D 69 6E 61 74 65 64`
- Character contract: opening dollar tag has no exact closing tag
- PostgreSQL/scanner meaning: lexically incomplete input fails closed
- expected: `reject`
- delegate calls: `0`

### LEX19

- Variant 1 JSON-visible original: `"select 1 /* outer /* nested */"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 31 20 2F 2A 20 6F 75 74 65 72 20 2F 2A 20 6E 65 73 74 65 64 20 2A 2F`
- Character contract: outer block comment remains open after nested close
- PostgreSQL/scanner meaning: nested comment depth is nonzero and fails closed
- expected: `reject`
- delegate calls: `0`

### LEX20

- Variant 1 JSON-visible original: `"select U&'\\0041'"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 55 26 27 5C 30 30 34 31 27`
- Variant 2 JSON-visible original: `"select U&\"d\\0061t\""`
- Variant 2 UTF-8 hex: `73 65 6C 65 63 74 20 55 26 22 64 5C 30 30 36 31 74 22`
- Variant 3 JSON-visible original: `"select U&'\\0041' UESCAPE '\\'"`
- Variant 3 UTF-8 hex: `73 65 6C 65 63 74 20 55 26 27 5C 30 30 34 31 27 20 55 45 53 43 41 50 45 20 27 5C 27`
- Variant 4 JSON-visible original: `"select B'1010'"`
- Variant 4 UTF-8 hex: `73 65 6C 65 63 74 20 42 27 31 30 31 30 27`
- Variant 5 JSON-visible original: `"select X'CAFE'"`
- Variant 5 UTF-8 hex: `73 65 6C 65 63 74 20 58 27 43 41 46 45 27`
- Variant 6 JSON-visible original: `"select N'national'"`
- Variant 6 UTF-8 hex: `73 65 6C 65 63 74 20 4E 27 6E 61 74 69 6F 6E 61 6C 27`
- Character contract: Unicode, bit, hex, and national prefixed forms
- PostgreSQL/scanner meaning: forms not fully modeled by the five-file scanner fail closed
- expected: `reject`
- delegate calls: `0`

### LEX21

- Variant 1 JSON-visible original: `"select '\\'; commit"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 5C 27 3B 20 63 6F 6D 6D 69 74`
- Character contract: strategy-A rejection on a healthy client
- PostgreSQL/scanner meaning: rollback succeeds and the client is released normally
- expected: `reject`
- delegate calls: `0`

### LEX22

- Variant 1 JSON-visible original: `"select '\\'; rollback"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 5C 27 3B 20 72 6F 6C 6C 62 61 63 6B`
- Character contract: rejected request followed by a legal request
- PostgreSQL/scanner meaning: the same healthy pool client can be reused
- expected: `reject-then-accept`
- delegate calls: `0`

### LEX23

- Variant 1 JSON-visible original: `"select '\\'; commit -- synthetic-raw-password"`
- Variant 1 UTF-8 hex: `73 65 6C 65 63 74 20 27 5C 27 3B 20 63 6F 6D 6D 69 74 20 2D 2D 20 73 79 6E 74 68 65 74 69 63 2D 72 61 77 2D 70 61 73 73 77 6F 72 64`
- Character contract: unsafe SQL contains a secret-shaped sentinel
- PostgreSQL/scanner meaning: fixed public error contains no SQL, connection, or internal object
- expected: `reject`
- delegate calls: `0`


## Future database unit spec

Canonical source: [04-database.spec.ts.md](fragments/04-database.spec.ts.md).

| ID | Frozen title |
|---|---|
| DU01 | U01 checks session_user before returning the client |
| DU02 | U02 executes only the fixed platform SET ROLE statement |
| DU03 | U03 checks current_user before returning the client |
| DU04 | U04 destroys clients when session_user query fails or mismatches |
| DU05 | U05 destroys the client when fixed SET ROLE fails |
| DU06 | U06 destroys the client when current_user query fails |
| DU07 | U07 destroys the client when current_user mismatches |
| DU08 | U08 releases a successful Kysely connection without destroying it |
| DU09 | U09 does not release when pool.connect fails before returning a client |
| DU10 | U10 shares one pending close Promise and calls Pool.end once |
| DU11 | U11 returns the first close Promise during synchronous reentry |
| DU12 | U12 keeps failures sticky and exposes only the safe QueryCreator facade |

Count: 12/12.

## Scripted and real-environment boundary

- Frozen v1.9 scripted subset: 45.
- LEX: 23.
- SQLPOL: 57.
- Future integration total: 138.
- Real PostgreSQL/Testcontainers, project build/typecheck/unit/database and real complete 138/138 remain `NOT_RERUN` for LAYOUT-S1.
