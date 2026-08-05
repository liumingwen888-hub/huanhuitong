# Task 5 Inbox 与 Telegram Webhook 去重详细计划索引

计划版本：`v1.3`。风险级别：`L3`。计划状态：`READY v1.3 / WAITING_EXTERNAL_REVIEW`。v1.2 外部复审：`NOT APPROVED / REVISION REQUIRED / REPLACED BY v1.3 CANDIDATE`；T5R-01、T5R-02、T5R-04、T5R-05、T5R-06、T5R-07：`ACCEPT / CLOSED`；T5R-03、T5R-08：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`。Task 5 代码状态：`NOT_STARTED`。

当前为第 9/48 步 `WAITING_EXTERNAL_REVIEW`。第 8/48 步与 Task 4 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 10/48 步 `NOT_STARTED`。本计划只描述未来实施，不代表代码、测试、Docker、PostgreSQL、Flyway 或 Testcontainers 已执行。

## 权威阅读顺序

1. 本索引。
2. [范围、状态与排除项](01-scope-status-and-boundaries.md)。
3. [当前磁盘接口基线](02-current-interface-baseline.md)。
4. [Canonical JSON 与 HMAC 合同](03-canonical-json-and-hmac.md)。
5. [Inbox 认领、冲突、租约与 CAS](04-claim-conflict-lease-cas.md)。
6. [并发与事务状态机](05-concurrency-and-transaction-state-machine.md)。
7. [安全与敏感数据边界](06-security-boundaries.md)。
8. [测试矩阵](07-test-matrix.md)。
9. [实施步骤 01–20](08-implementation-steps-01-20.md) 与 [21–40](09-implementation-steps-21-40.md)。
10. [验证、停止与交付门禁](10-verification-stop-and-delivery-gates.md)。
11. [Canonical fragments](fragments/00-index.md)。

## 文件职责

| 文件 | 唯一职责 |
|---|---|
| [01](01-scope-status-and-boundaries.md) | 目标、风险、范围、方案裁决、授权和非目标 |
| [02](02-current-interface-baseline.md) | Task 2/3/4 与测试 fixture 的当前磁盘事实 |
| [03](03-canonical-json-and-hmac.md) | 完整 parsed Update、canonical bytes、HMAC 与轮换合同 |
| [04](04-claim-conflict-lease-cas.md) | 返回联合、数据库状态、租约、重领、冲突与 CAS |
| [05](05-concurrency-and-transaction-state-machine.md) | 并发序列、同一 UoW、回滚与故障传播 |
| [06](06-security-boundaries.md) | 敏感数据、日志/trace/Outbox/audit/error 禁止边界 |
| [07](07-test-matrix.md) | 连续唯一的 T5C01–T5C50 测试合同 |
| [08](08-implementation-steps-01-20.md) | TDD、digest 与仓储前半实施步骤 |
| [09](09-implementation-steps-21-40.md) | 并发、故障、回归、文档与交付步骤 |
| [10](10-verification-stop-and-delivery-gates.md) | READY/BLOCKED、命令、资源清理与回滚 |
| [fragments](fragments/00-index.md) | 七个未来工程目标的唯一 canonical 正文 |

## 冻结未来工程矩阵

| 操作 | 路径 |
|---|---|
| Create | `packages/contracts/src/inbox-digest.ts` |
| Modify | `packages/contracts/src/index.ts` |
| Create | `apps/platform/src/modules/reliability/inbox/inbox.types.ts` |
| Create | `apps/platform/src/modules/reliability/inbox/telegram-update-digest.ts` |
| Create | `apps/platform/src/modules/reliability/inbox/inbox.repository.ts` |
| Create | `apps/platform/test/unit/telegram-update-digest.spec.ts` |
| Create | `apps/platform/test/database/inbox-repository.integration.spec.ts` |

合计：Create 6、Modify 1、Delete 0。不得静默增加第八个工程文件、migration、依赖、配置或锁文件。

## 计划完整性

- 实施 checkbox：Step 1～40，连续、唯一、当前全部未勾选。
- 测试 Case ID：T5C01～T5C50，连续、唯一。
- 七个未来文件只在 [canonical fragments](fragments/00-index.md) 保存完整工程正文；其他计划文件只保存合同、步骤和链接。
- Task 5 实施授权、Git、外部服务、共享/生产数据库和第 10/48 步授权当前均为 0。

## 唯一下一步

等待用户重新外部复审 Task 5 v1.3。用户给出复审结论且另行授权第 10/48 步前，不写入七个未来工程目标，不执行实施命令。
