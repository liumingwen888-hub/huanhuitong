# S5-6 威胁模型与阶段 5 验收 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S5-6 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 5 总体规划 S5-6](../2026-08-17-stage-5-transfers-redpackets-master-plan.md)、S2-7/S3-7/S4-8 验收模式复用。

## 目标

1. **阶段 5 具名验收 12 项**（S5A01–S5A12，全真实断言）：
   - 转账（01–04）：正常执行+余额+通知；幂等重放零新行；余额不足失败+零变化；并发双花恰一。
   - 领取链接（05–07）：创建冻结+领取释放；重复领取拒绝；过期退款。
   - 红包（08–10）：创建冻结+多人领取；重复领取拒绝；过期退剩余。
   - UX（11）：命令分类矩阵+零动态插值（静态）。
   - 架构（12）：depcruise 0 违规 + transfers 模块零 grammY/telegram 依赖。

2. **威胁模型增补**：转账重复、余额超支、并发双花、链接重放、红包抢夺、过期退款遗漏——每项控制链接到 S5A 编号。

3. **状态收敛**：阶段 5 代码 READY 等待用户验收。

## 冻结未来工程矩阵

Create：`apps/platform/test/integration/stage-five-acceptance.integration.spec.ts`。Modify：`docs/security/threat-model.md`、`docs/status/*`。

## 停止条件

任何验收项无法以真实驱动满足；需新迁移/依赖；三锁漂移。
