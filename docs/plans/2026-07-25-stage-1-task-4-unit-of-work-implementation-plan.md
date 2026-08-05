# Task 4 Unit of Work 与 PostgreSQL 事务边界 Implementation Plan v1.10

Technical plan: `v1.10`. Document layout: `S1`. Full identifier: `Task 4 READY v1.10 / LAYOUT-S1`.

> Compatibility entry retained for every historical link to this path. This file no longer carries the complete plan body or future engineering code.

## Current status

- Current progress: Step `8/48 COMPLETED / EXTERNAL REVIEW PASS`; Step `9/48 WAITING_EXTERNAL_REVIEW`.
- Technical plan: `READY v1.10 / EXTERNAL REVIEW PASS`.
- Document layout: `LAYOUT-S1 VERIFIED`.
- External review: `PASS`.
- Task 4 code: `IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`; the Step 8 runtime filter compatibility blocker was resolved by the user-authorized `LEX01:` execution-time correction, and all implementation gates passed.
- Task 5 detailed plan: [READY v1.3 / WAITING_EXTERNAL_REVIEW](task-5-inbox-dedup/00-index.md); Task 5 code and Step 10/48: `NOT_STARTED`.
- T4R-16–T4R-27: `ACCEPT / CLOSED`.

## Goal and boundary summary

Task 4 now provides a callback Unit of Work on one PostgreSQL connection, with commit on success, atomic rollback on callback/SQL failure, non-escaping TransactionContext, private framework transaction control, finite callback SQL policy, safe outcomes/errors and real PostgreSQL/Testcontainers evidence.

The v1.10 review repair corrects the LAYOUT-S1 implementation baseline, Step 8–26 LEX filters and self-contained v1.8 RED reconstruction. It does not implement Task 4, create its three future paths, alter the 138-test/SQLPOL57 contract, change the five canonical future target bodies or authorize Step 8/48.

## New directory entry and reading order

Start at [Task 4 LAYOUT-S1 index](task-4-unit-of-work/00-index.md). Follow its authoritative reading order: scope → architecture → SQL policy → relevant Steps → relevant tests → canonical fragments → verification gates → migration manifest.

## Step distribution

- Step 1–20: [implementation steps 01–20](task-4-unit-of-work/04-implementation-steps-01-20.md).
- Step 21–40: [implementation steps 21–40](task-4-unit-of-work/05-implementation-steps-21-40.md).
- Step 41–63: [implementation steps 41–63](task-4-unit-of-work/06-implementation-steps-41-63.md).
- Total state: 63/63 present, ordered, initially unchecked; Step 63 is final and no higher-numbered step exists.

## Review and content entry

- T4R-16–T4R-19: [architecture contracts](task-4-unit-of-work/02-architecture-and-transaction-contracts.md).
- T4R-20–T4R-24 and T4R-27: [callback SQL policy](task-4-unit-of-work/03-callback-sql-policy.md).
- T4R-25: [scope and implementation baseline](task-4-unit-of-work/01-scope-status-and-boundaries.md).
- T4R-26: [Steps 8–26](task-4-unit-of-work/04-implementation-steps-01-20.md) and [Steps 21–26](task-4-unit-of-work/05-implementation-steps-21-40.md).
- Core tests and LEX01–23: [core test matrix](task-4-unit-of-work/07-core-test-matrix.md).
- SQLPOL01–57: [01–20](task-4-unit-of-work/08-sqlpol-01-20.md), [21–40](task-4-unit-of-work/09-sqlpol-21-40.md), [41–57](task-4-unit-of-work/10-sqlpol-41-57.md).
- Five future engineering files: [canonical fragments](task-4-unit-of-work/fragments/00-index.md).
- Split equivalence: [migration manifest](task-4-unit-of-work/12-migration-manifest.md).
