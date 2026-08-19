# S3-7 威胁模型与阶段 3 验收 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S3-7 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 3 总体规划 S3-7](../2026-08-17-stage-3-ledger-master-plan.md)（威胁模型与验收）、[ledger-model 全文](../../architecture/ledger-model.md)、S2-7 验收模式复用。

## 目标

1. **阶段 3 具名验收 12 项**（S3A01–S3A12，全真实断言）：
   - 账本不变量（01–04）：全资产借贷平衡（空账本+交易后）；幂等键重放零新行；负余额拒绝零写入；历史不可变（entries 零 UPDATE/DELETE 权限实证）。
   - 并发与冲正（05–07）：并发双花恰一成功；冲正全链（反向+标记+二次拒绝）；冲正后余额精确归零。
   - 投影与对账（08–09）：投影与条目实时一致；篡改→校验→重建→清零闭环。
   - 模板（10）：七大场景各一笔经模板过账→投影正确。
   - 横切（11）：费率计算 + 风险限额拒绝 + 管理员授权/撤销。
   - 架构（12）：depcruise 0 违规 + ledger 模块零 grammY/telegram 依赖（静态）。
2. **威胁模型增补**：ledger 资产/威胁/控制映射（账本不可变/幂等重放/负余额/并发双花/冲正误用/投影竞态/对账遗漏），每项控制链接到 S3A 编号证据。
3. **状态收敛**：阶段 3 代码 READY 等待用户验收（S2-7 模式）；文档同步（领域/架构/安全/测试/current/next/verification/progress-log）。

## 冻结未来工程矩阵

Create：`apps/platform/test/integration/stage-three-acceptance.integration.spec.ts`。Modify：`docs/security/threat-model.md`、`docs/status/*`（终态收敛）。

## 实施步骤

验收 spec 骨架（红灯）→ 逐项绿灯（复用 S3-1～6 已验证能力，验收层聚合）→ test:all/docs:check → 威胁模型增补 → 文档同步 → 交付报告 → 用户验收。

## 停止条件

任何验收项无法以真实驱动满足；需新迁移/依赖；三锁漂移。
