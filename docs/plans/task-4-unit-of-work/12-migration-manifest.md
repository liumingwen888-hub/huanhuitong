# v11 → LAYOUT-S1 migration manifest

[← Task 4 LAYOUT-S1 index](00-index.md)

## Frozen v11 source

- Original path: `docs/plans/2026-07-25-stage-1-task-4-unit-of-work-implementation-plan.md`
- Original title: `# Task 4 Unit of Work 与 PostgreSQL 事务边界 Implementation Plan v1.9`
- Bytes: 383793
- Lines: 10629
- SHA-256: `D49EC553475FEB75EF0BE83B290BA4C80ADF73DB40FD0D4B44BE5A51DF0257E1`
- v11 project baseline: 122 files = 67 Markdown + 55 non-Markdown.

## Original section migration

| Original heading | LAYOUT-S1 destination |
|---|---|
| ## Global Constraints | 01-scope-status-and-boundaries.md |
| ## 0. 第九次外部复审修订裁决 | 02-architecture-and-transaction-contracts.md; 03-callback-sql-policy.md |
| ## 1. 目标、范围与排除项 | 01-scope-status-and-boundaries.md |
| ## 2. Task 3 真实接口基线 | 02-architecture-and-transaction-contracts.md |
| ## 3. 锁定 API 调查与可行性 | 02-architecture-and-transaction-contracts.md |
| ## 4. 生命周期与禁止逃逸合同 | 02-architecture-and-transaction-contracts.md |
| ## 5. 事务、SQL 防护与连接结果合同 | 03-callback-sql-policy.md |
| ## 6. 安全错误合同 | 02-architecture-and-transaction-contracts.md |
| ## 7. 测试矩阵与过滤器 | 07-core-test-matrix.md; 08-sqlpol-01-20.md; 09-sqlpol-21-40.md; 10-sqlpol-41-57.md |
| ## 8. TDD、完成条件与停止条件 | 11-verification-and-delivery-gates.md |
| ## 9. 本轮与未来验证边界 | 01-scope-status-and-boundaries.md; 11-verification-and-delivery-gates.md |
| ## 10. 未来修改一：RoleEnforcing PostgreSQL pool 与 extended query | fragments/06-database.ts.md |
| ## 11. 未来修改二：database unit spec | fragments/04-database.spec.ts.md |
| ## 12. 未来创建一：TransactionContext | fragments/07-transaction-context.ts.md |
| ## 13. 未来创建二：UnitOfWork | fragments/01-unit-of-work.ts.md; fragments/02-callback-connection.ts.md |
| ## 14. 未来创建三：PostgreSQL integration spec | fragments/03-unit-of-work.spec.ts.md; fragments/05-unit-of-work.integration.spec.part-01.ts.md … part-04 |
| ## 15. 未来执行清单（全部初始未勾选） | 04-implementation-steps-01-20.md; 05-implementation-steps-21-40.md; 06-implementation-steps-41-63.md |
| ## 16. v1.9 当前状态（非施工内容） | 01-scope-status-and-boundaries.md |

No technical section was silently discarded. Sections 10–14 were duplicate code mirrors; their single canonical bytes now live only under `fragments/`.

## Step migration

| Frozen Steps | New authoritative file |
|---|---|
| 1–20 | [04-implementation-steps-01-20.md](04-implementation-steps-01-20.md) |
| 21–40 | [05-implementation-steps-21-40.md](05-implementation-steps-21-40.md) |
| 41–63 | [06-implementation-steps-41-63.md](06-implementation-steps-41-63.md) |

All 63 IDs remain ordered and unchecked. Code-bearing Steps 2/3/30/31/32 now reference canonical fragments and frozen full-target SHA-256 instead of duplicating source. Step 62 uses manifest reconstruction; Step 63 remains final.

## Test migration

- UOW01–25, REV01, CLEAN01, REL01–05, IMM01 and TXCTL01–25: [07-core-test-matrix.md](07-core-test-matrix.md) and integration canonical parts 01–02.
- LEX01–23: [07-core-test-matrix.md](07-core-test-matrix.md) and integration canonical part 03.
- SQLPOL01–20: [08](08-sqlpol-01-20.md); SQLPOL21–40: [09](09-sqlpol-21-40.md); SQLPOL41–57: [10](10-sqlpol-41-57.md); canonical executable contract in integration part 04.
- Future database unit 12: [07](07-core-test-matrix.md) and [database spec fragment](fragments/04-database.spec.ts.md).
- Frozen future integration total remains 138 = 81 core/LEX + 57 SQLPOL.

## T4R migration

- T4R-16–T4R-19: [architecture and transaction contracts](02-architecture-and-transaction-contracts.md).
- T4R-20–T4R-24: [callback SQL policy](03-callback-sql-policy.md).
- All nine remain `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`, not external ACCEPT.

## Future five-file migration

| Future target | Canonical fragments, in reconstruction order | Bytes | Lines | Frozen v11 SHA-256 |
|---|---|---:|---:|---|
| `apps/platform/src/infrastructure/database/database.ts` | [06-database.ts.md](fragments/06-database.ts.md) | 14767 | 474 | `455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C` |
| `apps/platform/test/unit/database.spec.ts` | [04-database.spec.ts.md](fragments/04-database.spec.ts.md) | 12062 | 366 | `07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC` |
| `apps/platform/src/infrastructure/database/transaction-context.ts` | [07-transaction-context.ts.md](fragments/07-transaction-context.ts.md) | 5511 | 220 | `CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C` |
| `apps/platform/src/infrastructure/database/unit-of-work.ts` | [01-unit-of-work.ts.md](fragments/01-unit-of-work.ts.md) → [02-callback-connection.ts.md](fragments/02-callback-connection.ts.md) | 25165 | 904 | `A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A` |
| `apps/platform/test/database/unit-of-work.integration.spec.ts` | [03-unit-of-work.spec.ts.md](fragments/03-unit-of-work.spec.ts.md) → [05-unit-of-work.integration.spec.part-01.ts.md](fragments/05-unit-of-work.integration.spec.part-01.ts.md) → [05-unit-of-work.integration.spec.part-02.ts.md](fragments/05-unit-of-work.integration.spec.part-02.ts.md) → [05-unit-of-work.integration.spec.part-03.ts.md](fragments/05-unit-of-work.integration.spec.part-03.ts.md) → [05-unit-of-work.integration.spec.part-04.ts.md](fragments/05-unit-of-work.integration.spec.part-04.ts.md) | 113197 | 3091 | `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789` |

The authoritative reconstruction table with segment byte/line/hash details is [fragments/00-index.md](fragments/00-index.md).

## Equivalence verification method

1. Freeze the unmodified v11 giant plan and extract each single `XHT-FRAGMENT` body as UTF-8 + final LF.
2. Record bytes, lines and SHA-256 before any layout write.
3. Extract each new `XHT-CANONICAL` body, restore the delimiter LF and concatenate in manifest order.
4. Compare reconstructed bytes directly with the five frozen v11 byte arrays.
5. Require bytes, line count, SHA-256 and byte array equality for every target; final gate is 5/5 `IDENTICAL`.

## New files

- `docs/plans/task-4-unit-of-work/00-index.md`
- `docs/plans/task-4-unit-of-work/01-scope-status-and-boundaries.md`
- `docs/plans/task-4-unit-of-work/02-architecture-and-transaction-contracts.md`
- `docs/plans/task-4-unit-of-work/03-callback-sql-policy.md`
- `docs/plans/task-4-unit-of-work/04-implementation-steps-01-20.md`
- `docs/plans/task-4-unit-of-work/05-implementation-steps-21-40.md`
- `docs/plans/task-4-unit-of-work/06-implementation-steps-41-63.md`
- `docs/plans/task-4-unit-of-work/07-core-test-matrix.md`
- `docs/plans/task-4-unit-of-work/08-sqlpol-01-20.md`
- `docs/plans/task-4-unit-of-work/09-sqlpol-21-40.md`
- `docs/plans/task-4-unit-of-work/10-sqlpol-41-57.md`
- `docs/plans/task-4-unit-of-work/11-verification-and-delivery-gates.md`
- `docs/plans/task-4-unit-of-work/12-migration-manifest.md`
- `docs/plans/task-4-unit-of-work/fragments/00-index.md`
- `docs/plans/task-4-unit-of-work/fragments/01-unit-of-work.ts.md`
- `docs/plans/task-4-unit-of-work/fragments/02-callback-connection.ts.md`
- `docs/plans/task-4-unit-of-work/fragments/03-unit-of-work.spec.ts.md`
- `docs/plans/task-4-unit-of-work/fragments/04-database.spec.ts.md`
- `docs/plans/task-4-unit-of-work/fragments/05-unit-of-work.integration.spec.part-01.ts.md`
- `docs/plans/task-4-unit-of-work/fragments/05-unit-of-work.integration.spec.part-02.ts.md`
- `docs/plans/task-4-unit-of-work/fragments/05-unit-of-work.integration.spec.part-03.ts.md`
- `docs/plans/task-4-unit-of-work/fragments/05-unit-of-work.integration.spec.part-04.ts.md`
- `docs/plans/task-4-unit-of-work/fragments/06-database.ts.md`
- `docs/plans/task-4-unit-of-work/fragments/07-transaction-context.ts.md`

The historical giant path is modified in place as the compatibility entry; it is not deleted. Existing governance/index/status/testing Markdown is modified only where layout version, links, counts or document-size policy require synchronization. New project files outside `docs/plans/task-4-unit-of-work/**`: 0.

## File-count formula

- Baseline: 122 files = 67 Markdown + 55 non-Markdown.
- New LAYOUT-S1 Markdown: 24.
- Deleted: 0.
- Expected final: 146 files = 91 Markdown + 55 non-Markdown.

## v12 → Task 4 v1.10 review repair

This section is additive. It does not rewrite the v11 → LAYOUT-S1 history above.

- v12 current project baseline before Task 4 implementation: `146 files = 91 Markdown + 55 non-Markdown`.
- Historical `122/67/55` remains the v11 pre-split source count only; it is not a current implementation baseline.
- Future Task 4 implementation remains `Create 3 / Modify 2 / Delete 0 / outside 0`; all three Create targets are non-Markdown, so the exact post-implementation count is `149 files = 91 Markdown + 58 non-Markdown`.
- T4R-26 aligns the 19 Step 8–26 declarations and command filters and adds a canonical-title validator requiring `19/19 STEP-FILTER IDENTICAL`, LEX union `23/23`, duplicate 0 and empty 0.
- T4R-27 freezes v1.8 `unit-of-work.ts` at `24624 bytes / 878 lines / 4BE97A751BD02700C37E307AB57F53770261C95A09B152DAA6566DBD0E73ABEC`, embeds the two-place reverse delta and makes the future RED procedure depend only on v1.10 canonical fragments.
- The five canonical future target bodies remain byte-identical to the frozen v11 targets. No canonical fragment body changed.
- v13 itself creates and deletes no project file and modifies no non-Markdown file; the project remains `146/91/55`.
- T4R-25～T4R-27 are `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`; T4R-16～T4R-24 retain the same status and none is external ACCEPT.
