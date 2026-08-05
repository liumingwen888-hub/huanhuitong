# Task 4 Unit of Work plan index

Technical plan: `v1.10`. Document layout: `S1`. Full identifier: `Task 4 READY v1.10 / LAYOUT-S1`.

Current state:

- Technical plan: `READY v1.10 / EXTERNAL REVIEW PASS`.
- Layout: `LAYOUT-S1 VERIFIED` after the recorded split gates pass.
- External review: `PASS`.
- Code: `IMPLEMENTED / VERIFIED`.
- Step 8/48: `COMPLETED / EXTERNAL REVIEW PASS`; the runtime filter compatibility blocker is `RESOLVED`. Step 9/48: `WAITING_EXTERNAL_REVIEW`; Task 5 plan: `READY v1.3 / WAITING_EXTERNAL_REVIEW`; Task 5 code and Step 10/48: `NOT_STARTED`.
- T4R-16–T4R-27: `ACCEPT / CLOSED`.

## Authoritative reading order

1. This index.
2. [Scope, status and boundaries](01-scope-status-and-boundaries.md).
3. [Architecture and transaction contracts](02-architecture-and-transaction-contracts.md).
4. [Callback SQL policy](03-callback-sql-policy.md).
5. The implementation step file containing the step under review.
6. The relevant test matrix/SQLPOL file.
7. [Canonical fragments index](fragments/00-index.md).
8. [Verification and delivery gates](11-verification-and-delivery-gates.md).
9. [Migration manifest](12-migration-manifest.md).

## File navigation

| File | Sole responsibility |
|---|---|
| [01-scope-status-and-boundaries.md](01-scope-status-and-boundaries.md) | Status, goal, scope, non-goals, authorization and environment boundary |
| [02-architecture-and-transaction-contracts.md](02-architecture-and-transaction-contracts.md) | Unit of Work architecture, lifecycle, outcomes, release and safe errors |
| [03-callback-sql-policy.md](03-callback-sql-policy.md) | Finite callback SQL policy, T4R-20–T4R-24 and self-contained T4R-27 RED |
| [04-implementation-steps-01-20.md](04-implementation-steps-01-20.md) | Steps 01–20 |
| [05-implementation-steps-21-40.md](05-implementation-steps-21-40.md) | Steps 21–40 |
| [06-implementation-steps-41-63.md](06-implementation-steps-41-63.md) | Steps 41–63 |
| [07-core-test-matrix.md](07-core-test-matrix.md) | UOW/REV/CLEAN/REL/IMM/TXCTL/LEX and unit tests |
| [08-sqlpol-01-20.md](08-sqlpol-01-20.md) | SQLPOL01–20 evidence |
| [09-sqlpol-21-40.md](09-sqlpol-21-40.md) | SQLPOL21–40 evidence |
| [10-sqlpol-41-57.md](10-sqlpol-41-57.md) | SQLPOL41–57 evidence |
| [11-verification-and-delivery-gates.md](11-verification-and-delivery-gates.md) | Step 62/63, READY/BLOCKED, filters and delivery gates |
| [12-migration-manifest.md](12-migration-manifest.md) | v11→S1 mapping and equivalence evidence |
| [fragments/00-index.md](fragments/00-index.md) | Only canonical future engineering content |

## Distribution

- Steps 1–20: [04](04-implementation-steps-01-20.md).
- Steps 21–40: [05](05-implementation-steps-21-40.md).
- Steps 41–63: [06](06-implementation-steps-41-63.md). The 63 review-plan checkboxes remain the frozen pre-execution checklist; actual Step 1～63 completion evidence is recorded in [verification](../../status/verification.md). Step 63 is final.
- Core tests and LEX01–23: [07](07-core-test-matrix.md).
- SQLPOL01–20: [08](08-sqlpol-01-20.md); SQLPOL21–40: [09](09-sqlpol-21-40.md); SQLPOL41–57: [10](10-sqlpol-41-57.md).
- T4R-16–T4R-19: [architecture contracts](02-architecture-and-transaction-contracts.md).
- T4R-20–T4R-24 and T4R-27: [callback SQL policy](03-callback-sql-policy.md).
- T4R-25: [scope/status and exact before/after counts](01-scope-status-and-boundaries.md).
- T4R-26: [Steps 8–20](04-implementation-steps-01-20.md), [Steps 21–26](05-implementation-steps-21-40.md) and [mechanical gate](11-verification-and-delivery-gates.md).
- Five future engineering files: [canonical fragment index](fragments/00-index.md).

## External review entry

Reviewers start here, then read only the architecture/policy/step/test/fragment files relevant to the finding. The [migration manifest](12-migration-manifest.md) proves where every v11 section, Step, test group, T4R and future file moved.

## Breakpoint handoff

Task 4 Step 1～63 and its implementation external review are complete; read the final evidence in [verification](../../status/verification.md). The current plan is [Task 5 v1.3](../task-5-inbox-dedup/00-index.md); the only next action is user review of that plan, not Task 5 implementation or Step 10/48.
