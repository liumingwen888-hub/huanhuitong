# Task 9 Telegram Webhook 适配器与默认拒绝边界 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。Task 9 代码状态：`NOT_STARTED`。

当前为第 17/48 步 `IN_PROGRESS`。第 16/48 步与 Task 8 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 18/48 步 `NOT_STARTED`。

## 权威需求来源

- [阶段 1 总计划 Task 9 节](../2026-07-20-stage-1-foundation-identity-implementation-plan.md)（目标、Files、失败场景、Step 1–9 含参考 schema/verifier 代码）。
- 裁决 F-07（合法不支持 Update 一律 200 ignored，畸形 envelope 才 400）、F-08（grammY webhookCallback、BotInfo 注入、不调用 `bot.start()`、grammY 类型不越边界）。
- Task 5 v1.3 独占 canonicalization/HMAC：Task 9 不复制算法，只传参验证。

## 权威阅读顺序

1. 本索引。
2. [范围与状态](01-scope-and-status.md)。
3. [HTTP 门禁与 Update 分类](02-http-gates-and-classification.md)。
4. [grammY 适配与 DI 组装](03-grammy-adapter-and-assembly.md)。
5. [测试矩阵](04-test-matrix.md)。
6. [实施步骤与门禁](05-implementation-and-gates.md)。

## 冻结未来工程矩阵

| 操作 | 路径 |
|---|---|
| Create | `packages/contracts/src/telegram.ts` |
| Modify | `packages/contracts/src/index.ts` |
| Create | `apps/platform/src/modules/telegram/http/telegram-update.schema.ts` |
| Create | `apps/platform/src/modules/telegram/http/grammy-webhook.adapter.ts` |
| Create | `apps/platform/src/modules/telegram/http/telegram-command.mapper.ts` |
| Create | `apps/platform/src/modules/telegram/http/webhook-secret.verifier.ts` |
| Create | `apps/platform/src/modules/telegram/http/webhook-request-policy.ts` |
| Create | `apps/platform/src/modules/telegram/http/telegram-webhook.controller.ts` |
| Create | `apps/platform/src/modules/telegram/telegram.module.ts` |
| Create | `apps/platform/src/bootstrap/create-platform-app.ts` |
| Modify | `apps/platform/src/main.ts` |
| Create | `apps/platform/test/http/telegram-webhook.contract.spec.ts` |
| Create | `apps/platform/test/http/grammy-webhook.adapter.spec.ts` |

合计 Create 11、Modify 2、Delete 0（与总计划一致）。`vitest.config.ts` 已含 `apps/*/test/http/**`，无需修改。

## v1.0 状态说明

合同层先行；canonical fragments 延后至复审通过后的 v1.1。业务 handler 本 Task 用 recording stub；Task 10 注入真实编排。
