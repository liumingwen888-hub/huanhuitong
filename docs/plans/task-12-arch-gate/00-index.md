# Task 12 dependency-cruiser 架构依赖门禁 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。Task 12 代码状态：`NOT_STARTED`。

当前为第 23/48 步 `IN_PROGRESS`。第 22/48 步与 Task 11 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 24/48 步 `NOT_STARTED`。

## 权威需求来源

- [阶段 1 总计划 Task 12 节](../2026-07-20-stage-1-foundation-identity-implementation-plan.md)（目标、Files、Step 1–8 含参考 .dependency-cruiser.cjs 配置）。
- [domain-map](../../architecture/domain-map.md) 依赖方向；Task 9/10 的 grammY 隔离与 worker/platform 边界。
- 前置事实：`dependency-cruiser@18.1.0` 已在锁内、根 `package.json` 已有 `architecture:check` 脚本（Task 1 预置）；`.dependency-cruiser.cjs` 从未创建——这是 `pnpm test:all` 停在 architecture:check 的已知边界。

## 冻结未来工程矩阵

| 操作 | 路径 |
|---|---|
| Create | `.dependency-cruiser.cjs` |
| Create | `packages/testing/fixtures/architecture/invalid-domain-to-telegram/apps/platform/src/modules/identity/identity.ts` |
| Create | `packages/testing/fixtures/architecture/invalid-domain-to-telegram/apps/platform/src/modules/telegram/telegram.ts` |
| Create | `packages/testing/test/architecture/dependency-boundaries.spec.ts` |
| Modify | `package.json` |

合计 Create 4、Modify 1、Delete 0（与总计划一致；package.json Modify 仅为必要脚本微调，若现有脚本已够则仅校验不改——以实际差异最小为准）。

## 规则集（按总计划 Step 3 原文）

1. `no-domain-to-telegram`：identity/reliability → telegram 禁止。
2. `no-packages-to-apps`：packages → apps 禁止。
3. `no-worker-to-platform-internals`：worker → platform 私有实现禁止（经 @xht/contracts 的合法依赖不受影响）。
4. `no-circular`：全图循环禁止。

options：`tsPreCompilationDeps: true`、`doNotFollow node_modules`、无宽泛忽略。

## v1.0 状态说明

合同层先行（规则、fixture、测试合同、步骤）；canonical fragments 延后至复审通过后的 v1.1。已知需在实施期核验：platform 内 application 层对 infrastructure 的合法方向（telegram/application → infrastructure/database）是否与 worker 规则冲突（worker 测试曾相对导入 platform 源——测试文件不在 src 扫描范围，需确认 depcruise 扫描根不含 test）。
