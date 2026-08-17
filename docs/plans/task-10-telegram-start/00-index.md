# Task 10 /start 自动注册、原子编排和主菜单任务 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。Task 10 代码状态：`NOT_STARTED`。

当前为第 19/48 步 `IN_PROGRESS`。第 18/48 步与 Task 9 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 20/48 步 `NOT_STARTED`。

## 权威需求来源

- [阶段 1 总计划 Task 10 节](../2026-07-20-stage-1-foundation-identity-implementation-plan.md)（目标、Files、失败场景、Step 1–9 含参考编排骨架）。
- 已交付组件：Task 5 `InboxRepository.claim/markProcessed`、Task 6 `OutboxRepository.enqueue` 与 Outbox worker、Task 8 `ResolveOrCreateUid`、Task 9 controller digest 边界。
- 总计划 Global Constraints：业务事务与 Outbox 原子提交；外部主菜单发送发生在提交后，失败经 Outbox 重试且不得重复创建用户；自动注册不创建任何资金对象。

## 权威阅读顺序

1. 本索引。
2. [范围与状态](01-scope-and-status.md)。
3. [原子编排与结果语义](02-atomic-orchestration.md)。
4. [菜单事件与 Worker 网关](03-menu-and-gateway.md)。
5. [测试矩阵](04-test-matrix.md)。
6. [实施步骤与门禁](05-implementation-and-gates.md)。

## 冻结未来工程矩阵

| 操作 | 路径 |
|---|---|
| Modify | `packages/contracts/src/telegram.ts` |
| Create | `apps/platform/src/modules/telegram/application/handle-telegram-start.ts` |
| Create | `apps/platform/src/modules/telegram/application/main-menu.ts` |
| Create | `apps/platform/src/modules/telegram/application/telegram-start.mapper.ts` |
| Modify | `apps/platform/src/modules/telegram/http/telegram-webhook.controller.ts` |
| Create | `apps/worker/src/outbox/telegram-main-menu.handler.ts` |
| Create | `apps/worker/src/infrastructure/telegram/telegram-bot.gateway.ts` |
| Create | `apps/worker/src/infrastructure/telegram/external-connection-disabled.gateway.ts` |
| Modify | `apps/worker/src/bootstrap/create-worker.ts` |
| Modify | `apps/worker/src/outbox/outbox-worker.ts` |
| Create | `apps/platform/test/database/handle-telegram-start.integration.spec.ts` |
| Create | `apps/worker/test/unit/telegram-main-menu.handler.spec.ts` |

合计 Create 8、Modify 4、Delete 0（与总计划一致）。

## v1.0 状态说明

合同层先行；canonical fragments 延后至复审通过后的 v1.1。本 Task 完成后阶段 1 业务链路（Inbox → 身份 → Outbox → worker 发送）端到端打通。
