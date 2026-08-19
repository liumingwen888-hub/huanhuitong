# S4-8 威胁模型与阶段 4 验收 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S4-8 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 4 总体规划 S4-8](../2026-08-17-stage-4-deposits-master-plan.md)、S2-7/S3-7 验收模式复用。

## 目标

1. **阶段 4 具名验收 14 项**（S4A01–S4A14，全真实断言）：
   - 地址（01–03）：地址生成确定性+唯一性；幂等分配；RETIRED 后新地址索引递增。
   - 检测（04–05）：注入交易检测记录+确认数更新；RETIRED 地址跳过。
   - 确认与重组（06–08）：DETECTED→CONFIRMED CAS；重组 CONFIRMED→REORG_DETECTED；幂等确认。
   - 入账（09–11）：CONFIRMED→POSTED+余额+通知；幂等重放零新行；用户账户自动开通。
   - 归集（12）：阈值候选+广播+归集过账。
   - 对账（13）：链上 vs 账本差异检测+告警。
   - 架构（14）：depcruise 0 违规 + deposits 模块零 grammY/telegram 依赖（静态）。
2. **威胁模型增补**：地址私钥安全、检测遗漏、确认不充分、重组攻击、入账重复、归集失败、对账遗漏——每项控制链接到 S4A 编号。
3. **状态收敛**：阶段 4 代码 READY 等待用户验收。

## 冻结未来工程矩阵

Create：`apps/platform/test/integration/stage-four-acceptance.integration.spec.ts`。Modify：`docs/security/threat-model.md`、`docs/status/*`。

## 停止条件

任何验收项无法以真实驱动满足；需新迁移/依赖；三锁漂移。
