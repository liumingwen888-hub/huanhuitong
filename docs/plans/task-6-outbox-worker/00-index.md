# Task 6 Outbox、持久任务与安全 Worker 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。Task 6 代码状态：`NOT_STARTED`。

当前为第 11/48 步 `IN_PROGRESS`。第 10/48 步与 Task 5 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 12/48 步 `NOT_STARTED`。本计划只描述未来实施，不代表代码、测试或容器已执行。

## 权威需求来源

- [阶段 1 总计划 Task 6 节](../2026-07-20-stage-1-foundation-identity-implementation-plan.md)（目标、Files 清单、失败场景、完成标准）。
- 总计划裁决 F-05（at-least-once 与租约代次 CAS）、F-06（配置禁用不进入通用重试）。
- [runtime-topology](../../architecture/runtime-topology.md) Task 2 已实现边界与 Tasks 3–14 计划边界：Outbox at-least-once、租约所有者/token/代次贯穿全部 CAS、禁用时不注册 handler 或进入 WAITING_CONFIGURATION。

## 权威阅读顺序

1. 本索引。
2. [范围、状态与排除项](01-scope-status-and-boundaries.md)。
3. [当前磁盘接口基线](02-current-interface-baseline.md)。
4. [Outbox 租约、CAS 与投递语义](03-outbox-lease-cas-delivery.md)。
5. [持久任务状态机与错误分类](04-durable-jobs-and-error-classification.md)。
6. [安全与敏感数据边界](05-security-boundaries.md)。
7. [测试矩阵](06-test-matrix.md)。
8. [实施步骤](07-implementation-steps.md)。
9. [验证、停止与交付门禁](08-verification-and-gates.md)。

## 文件职责

| 文件 | 唯一职责 |
|---|---|
| [01](01-scope-status-and-boundaries.md) | 目标、风险、范围、方案裁决、授权和非目标 |
| [02](02-current-interface-baseline.md) | Tasks 2–5 与数据库 schema 的当前磁盘事实 |
| [03](03-outbox-lease-cas-delivery.md) | claimBatch SQL、CAS 合同、at-least-once 语义与重复风险运营说明 |
| [04](04-durable-jobs-and-error-classification.md) | 持久任务状态机、退避参数、死信与 WAITING_CONFIGURATION |
| [05](05-security-boundaries.md) | 敏感数据、日志/trace/审计边界与错误脱敏 |
| [06](06-test-matrix.md) | 连续唯一的 T6C01 起测试合同 |
| [07](07-implementation-steps.md) | TDD 实施步骤（红灯→最小实现→绿灯→重构） |
| [08](08-verification-and-gates.md) | 验证命令、资源清理、停止条件与回滚 |

## 冻结未来工程矩阵

| 操作 | 路径 |
|---|---|
| Create | `packages/contracts/src/reliability.ts` |
| Modify | `packages/contracts/src/index.ts` |
| Create | `apps/platform/src/modules/reliability/outbox/outbox.repository.ts` |
| Create | `apps/platform/src/modules/reliability/jobs/durable-job.repository.ts` |
| Create | `apps/worker/src/outbox/outbox-store.ts` |
| Create | `apps/worker/src/outbox/outbox-worker.ts` |
| Create | `apps/worker/src/jobs/durable-job-worker.ts` |
| Create | `apps/worker/src/bootstrap/create-worker.ts` |
| Modify | `apps/worker/src/main.ts` |
| Create | `apps/worker/test/database/outbox-worker.integration.spec.ts` |

合计 Create 8、Modify 2、Delete 0（与阶段 1 总计划 Task 6 Files 清单一致）。Target 集合外内容写入即停止。

## v1.0 状态说明

v1.0 给出完整合同、状态机、测试矩阵与实施步骤；canonical fragments（未来工程目标逐字节正文）将在用户对 v1.0 合同层复审通过后的 v1.1 中冻结，避免在合同未获复审前固化代码。此为与 Task 5 流程的差异点，已在 [01](01-scope-status-and-boundaries.md) 登记。
