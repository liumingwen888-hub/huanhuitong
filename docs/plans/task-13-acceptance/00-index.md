# Task 13 集成、真实并发和失败恢复验收 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。Task 13 代码状态：`NOT_STARTED`。

当前为第 25/48 步 `IN_PROGRESS`。第 24/48 步与 Task 12 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 26/48 步 `NOT_STARTED`。

## 权威需求来源

- [阶段 1 总计划 Task 13 节](../2026-07-20-stage-1-foundation-identity-implementation-plan.md)——**23 项具名验收表为唯一权威**（编号 01–23、测试文件、真实驱动、必需断言），本计划不复制该表，仅补充实施裁决。
- 前置：Tasks 1–12 全部 VERIFIED；`pnpm test:all` 全链可用。

## 冻结未来工程矩阵

| 操作 | 路径 |
|---|---|
| Create | `packages/testing/src/async-barrier.ts` |
| Create | `packages/testing/src/recording-telegram-bot.gateway.ts` |
| Create | `packages/testing/src/stage-one-harness.ts` |
| Modify | `packages/testing/src/index.ts` |
| Create | `apps/platform/test/integration/stage-one-webhook.integration.spec.ts`（01–07、10–13、17） |
| Create | `apps/platform/test/integration/registration-concurrency.integration.spec.ts`（08–09） |
| Create | `apps/platform/test/integration/registration-failure.integration.spec.ts`（14–15） |
| Create | `apps/worker/test/integration/outbox-recovery.integration.spec.ts`（16） |
| Create | `packages/testing/test/database/stage-one-schema-boundary.integration.spec.ts`（18–20） |
| Create | `apps/platform/test/integration/platform-process.lifecycle.spec.ts`（23a） |
| Create | `apps/worker/test/integration/worker-process.lifecycle.spec.ts`（23b） |

合计 Create 11、Modify 1、Delete 0（与总计划一致；21/22 由 Task 12 已交付的 `dependency-boundaries.spec.ts` 覆盖，本计划仅核对编号可追溯性，不重复实现）。

## StageOneHarness 合同（总计划 Step 3 原文为权威）

真实 NestJS HTTP server（Task 9 `createPlatformApp`）+ Testcontainers PostgreSQL + 连接 A/B 独立 pool + recording Gateway + `beforeRegistrationAcquire` 注入钩子（仅测试装配，生产零屏障）。计数器：count/countActiveBindings/countTopic/distinctResolvedUids。

## 实施裁决（v1.0 冻结）

1. **验收 07（HMAC 全矩阵）**经 HTTP + Task 2 真实 keyring：同 update_id 键序等价重放、retained 旧版本重放、逐字段变异（text/start 参数/callback/from.id/chat.id/顶层类型/未知字段）、移除原 key——全部经 HandleTelegramStart 结果分类断言。
2. **验收 14/15 失败注入**：Harness 暴露 repository 装配点，注入确定性抛错仓储（仅测试装配）；生产实现零改动。
3. **验收 16 崩溃重投**：recording gateway 成功 → markSucceeded 前模拟 worker 崩溃（放弃租约）→ 新 worker runOnce 重投 → event-ID 幂等 effect=1 + duplicate-risk 审计记录。
4. **验收 17**：Task 11 spec 已覆盖主体；新增 span attribute 禁止与 logger HMAC key 轮换审计关联两断言并入 stage-one-webhook spec 17 号位。
5. **验收 19/20**：复用 Task 3 fixture 驱动真实 migrate/validate（锁定 digest），新 spec 独立运行并断言角色链与 drift。
6. **验收 21/22**：引用既有 dependency-boundaries.spec.ts（21=T12C01、22 增补"测试代码不 exec 根脚本"静态断言——在 22 号位由该文件新增一测实现，属 Task 12 文件范围外扩，登记为裁决：新增断言并入 stage-one-schema-boundary spec 的 22 号位以守冻结矩阵）。
7. **验收 23**：受控子进程启动 `dist/main.js`（platform）与 worker 组装入口、HTTP readiness 轮询 ≤15s、SIGTERM、退出码 0、≤10s 结束、端口/TEMP 清理、网络调用 0（注入禁网 client 计数）。platform main.ts 当前不监听端口——裁决：lifecycle spec 以 createPlatformApp 的 HTTP server 显式 listen 驱动（生产监听属部署阶段），worker 以 runOnce 循环 + SIGTERM 停止驱动。
