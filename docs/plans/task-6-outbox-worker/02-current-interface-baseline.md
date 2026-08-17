# 当前磁盘接口基线

[返回索引](00-index.md)

## 数据库 schema（Task 3 V1，本计划不改）

`outbox_messages`（`database/migrations/V1__stage_1_identity_reliability.sql:187`）：

- 主键 `outbox_id uuid`；`UNIQUE (topic, event_key)`；`version` 固定 `=1` CHECK。
- 状态 CHECK 与 durable_jobs 相同七态：`READY/LEASED/SUCCEEDED/RETRY_WAIT/DEAD_LETTER/PAUSED/WAITING_CONFIGURATION`。
- 租约一致性 CHECK：`LEASED` 必须同时有 `locked_by/lease_token/locked_until`，非 `LEASED` 三者必须全 NULL——租约字段与状态不允许半更新。
- `SUCCEEDED` 必须有 `succeeded_at`，其他状态必须 NULL。
- 领取索引 `ix_outbox_claimable (status, available_at, locked_until, created_at, outbox_id)`。

`durable_jobs`（同文件 :238）：结构同构，`UNIQUE (job_type, business_key)`，`job_id` 默认 `gen_random_uuid()`。

权限矩阵（同文件 :301-306）：

| 表 | xht_platform | xht_worker |
|---|---|---|
| outbox_messages | SELECT, INSERT | SELECT, UPDATE |
| durable_jobs | — | SELECT, INSERT, UPDATE |

推论：**platform 只写不消费（enqueue 在业务事务内）；worker 只消费不生产（对 outbox 无 INSERT）**。任何实现不得让 worker 写 outbox INSERT 或 platform 写 UPDATE。

## 工程接口（已验证实现）

- Task 4 `UnitOfWork`/`TransactionContext`：单连接事务、callback SQL 策略扫描、COMMITTED/ROLLED_BACK/UNKNOWN 分类；Outbox enqueue 必须复用调用方 `TransactionContext.database`（同 Task 5 `markProcessed` 模式）。
- Task 3 `RoleEnforcingPostgresPool`、Kysely `QueryCreator` facade、Testcontainers fixture（`startPostgresFixture` 返回 `bootstrapLogin/flywayLogin/platformLogin/workerLogin`）与 `migrateAndValidate`。
- Task 2 日志白名单/脱敏合同（`SafeLoggingError`、destination 零写入）适用于 worker 日志。
- Task 5 `packages/contracts/src/inbox-digest.ts` 与 contracts index 现有 export：`database.js`、`inbox-digest.js`、`observability.js`——Task 6 Modify 追加 `reliability.js`。
- `apps/worker/src/main.ts` 当前为 Task 1 骨架（logger/telemetry 生命周期），Task 6 Modify 注入 worker 组装。

## 测试基线

- fixture/清理模式沿用 Task 5 spec：`bootstrapLogin` 专用 cleanupPool 清表（platform/worker 角色无 DELETE 权限，Task 5 已裁决）。
- 时间断言沿用 Task 5 数据库权威时间模式：租约比较不经过 JS Date 往返精确相等 CAS；expiry 决策优先数据库内谓词。
