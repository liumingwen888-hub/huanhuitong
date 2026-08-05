# Scope, status and boundaries

[← Task 4 LAYOUT-S1 index](00-index.md)

> LAYOUT-S1 remains the document layout. Task 4 v1.10 changes only the implementation baseline, LEX step filters and self-contained RED procedure; it does not authorize or implement Task 4.

## Original plan identity and global constraints

Original title: `# Task 4 Unit of Work 与 PostgreSQL 事务边界 Implementation Plan v1.9`


> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task after the user explicitly authorizes Step 8/48. Steps use checkbox (`- [ ]`) syntax for tracking. This plan does not authorize implementation, subagents, worktrees, Git, database access, or external writes.

**Goal:** 在单一 PostgreSQL 连接上提供 callback 形式的 Unit of Work，保证成功提交、失败整体回滚、事务控制与不安全 SQL 在第一次 delegate 调用前拒绝。

**Architecture:** Task 3 的 `RoleEnforcingPostgresPool` 仍是连接与角色边界；Task 4 在同一 Kysely connection 上构造可撤销 `TransactionContext`，并由 `CallbackConnection` 对所有 callback SQL 执行状态机扫描、有限顶层业务语句族 allowlist 和 token 级配置/角色变更拒绝。内部 BEGIN/COMMIT/ROLLBACK 及框架固定不变量通道与 callback 通道隔离，extended query mode 只保留为第二层防护。

**Tech Stack:** Node.js `24.18.0`、pnpm `11.15.1`、TypeScript `7.0.2` strict、PostgreSQL `18.4`、Kysely `0.29.4`、pg `8.22.0`、Vitest `4.1.10`、Testcontainers `12.0.4`。

## Global Constraints

- 未来工程写集合固定为 Create 3、Modify 2、Delete 0；不得增加第六个工程文件。
- 不新增、删除或升级依赖；`package.json`、`pnpm-lock.yaml`、`toolchain-lock.json` 不得修改。
- Task 4 代码当前为 `IMPLEMENTED / VERIFIED`；第 8/48 步已完成，未经用户新授权不得进入第 9/48 步。
- 所有 callback SQL 必须在第一次底层 delegate 调用前完成发送前检查；顶层只允许 SELECT/INSERT/UPDATE/DELETE/MERGE/VALUES 与终止于这些族的 WITH，其他语句 fail closed；不得只依赖 PostgreSQL extended protocol。
- 计划内未来命令、代码和测试均是未执行清单，不得写成真实项目已经通过。

---

计划版本：`v1.10`。计划状态：`READY v1.10 / EXTERNAL REVIEW PASS`。外部复审：`PASS`。Task 4 代码：`IMPLEMENTED / VERIFIED`。当前步骤：`8/48 COMPLETED`（Step 8 过滤器兼容阻断已 RESOLVED）。第 `9/48` 步：`NOT_STARTED`。

## v1.10 implementation count boundary

- v1.10 计划实施前基线：`146 files = 91 Markdown + 55 non-Markdown`。
- 未来获权实施范围保持 `Create 3 / Modify 2 / Delete 0 / outside 0`；三个 Create 均为非 Markdown 工程文件。
- 实施完成后的精确数量：`149 files = 91 Markdown + 58 non-Markdown`。
- v11 的 `122/67/55` 只属于 [migration manifest](12-migration-manifest.md) 的历史拆分事实，不是当前实施基线。
- 第 8 步相对 v13 精确实施 Create 3、Modify 2、Delete 0，项目完成态为 `149/91/58`，Task 4 三个 Create 路径实际存在数为 3。

## 1. 目标、范围与排除项

目标是在单一 PostgreSQL 连接上提供 callback 形式的 Unit of Work：成功提交，callback 同步 throw/异步 reject/任一步 SQL 失败时整体回滚，并在连接或提交结果不确定时返回固定、脱敏、不可伪造的安全错误。

未来工程写集合固定为 Create 3、Modify 2、Delete 0：

- Create `apps/platform/src/infrastructure/database/transaction-context.ts`
- Create `apps/platform/src/infrastructure/database/unit-of-work.ts`
- Create `apps/platform/test/database/unit-of-work.integration.spec.ts`
- Modify `apps/platform/src/infrastructure/database/database.ts`
- Modify `apps/platform/test/unit/database.spec.ts`

明确排除：生产装配、第二连接、嵌套事务绕过、事务内 Telegram/HTTP/队列等网络副作用、新依赖、第六个工程文件、package/lock 修改、Git、部署与第 8 步自动进入。

## 9. 本轮与未来验证边界

第 7 步仅允许 TEMP 计划证据的历史边界保持不变。第 8 步已重新执行项目 build/typecheck/unit/database、真实完整 138/138、Docker、PostgreSQL、Flyway、Testcontainers、Step 62/63 与资源清理门禁；不得把第 7 步 TEMP 结果冒充本轮真实项目证据。

## 16. v1.10 当前状态（非施工内容）

- 当前第 `8/48` 步已 `COMPLETED`。
- Task 3：`VERIFIED v1.5`。
- Task 4 详细计划：`READY v1.10 / EXTERNAL REVIEW PASS`。
- T4R-16～T4R-27：`ACCEPT / CLOSED`。
- Task 4 代码：`IMPLEMENTED / VERIFIED`。
- Tasks 5～14：`NOT_STARTED`。
- 第 `9/48` 步：`NOT_STARTED`。
- 唯一下一步：等待用户进行 Task 4 实施结果外部复审；未经新授权不得进入第 9/48 步。

## LAYOUT-S1 current boundary

- Technical plan: `READY v1.10 / EXTERNAL REVIEW PASS`.
- Document layout: `LAYOUT-S1 VERIFIED` only after the gates in [11-verification-and-delivery-gates.md](11-verification-and-delivery-gates.md) pass.
- External review: `PASS`.
- Task 4 code: `IMPLEMENTED / VERIFIED`.
- Tasks 5–14: `NOT_STARTED`.
- Step 8/48: `COMPLETED`; Step 9/48: `NOT_STARTED`.
- Git, worktree, subagent, pnpm install, external services and production deployment: authorization 0. Step 8 local Docker/PostgreSQL/Flyway/Testcontainers authorization is consumed and closed.
