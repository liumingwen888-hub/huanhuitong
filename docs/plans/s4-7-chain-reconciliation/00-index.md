# S4-7 链上对账 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S4-7 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 4 总体规划](../2026-08-17-stage-4-deposits-master-plan.md)、[ledger-model 对账](../../architecture/ledger-model.md)、S3-5 ReconciliationService 模式复用、S4-3 ChainScannerPort。

## 目标

**`ChainReconciliationService`**——链上余额 vs 账本余额的定期对比：

1. **单地址对账** `reconcileAddress(addressId, network)`：
   - 链上余额：ChainScannerPort 新方法 `getAddressBalance(network, addressText)` → string；
   - 账本余额：该地址关联的所有 POSTED 检测金额累计 - 已归集金额；
   - 差异 = 链上余额 - 应有余额 → 结构化差异报告。

2. **批量对账** `reconcileAll(network)`：
   - 对该网络所有 ACTIVE 充值地址执行单地址对账；
   - 返回差异汇总（差异地址数/总差额/差异明细）。

3. **差异告警**：复用 S3-5 的 `recordDiscrepancyAlerts` 模式——差异写入 risk_decisions（reason_code=`CHAIN_RECONCILIATION_DISCREPANCY`，幂等键=窗口+地址）。

4. **ChainScannerPort 扩展**：新增 `getAddressBalance(network, addressText): Promise<string>`——Fake 实现（可注入预期余额）。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/deposits/application/chain-reconciliation.service.ts`、`test/database/chain-reconciliation.integration.spec.ts`。Modify：chain-scanner.port.ts（补 getAddressBalance 方法）+ fake-chain-scanner.ts（补 fake 实现）。

## 测试矩阵（S4CR）

- 链上=账本 → 零差异；
- 链上>账本（有未检测到的入账）→ 差异报告+告警；
- 链上<账本（已归集但链上延迟）→ 差异报告+告警；
- 幂等告警：同窗口重复对账不重复告警；
- 批量多地址对账。

## 停止条件

需要真实链连接、需要新迁移、三锁漂移。

## 裁决

- 差异不自动修复（与 S3-5 对账红线一致——人工裁决）；
- 对账频率：由外部调度器触发（阶段 9 管理后台 / 阶段 10 定时任务）；
- 差异容忍度：零容忍（任何差异都告警——比传统金融更严格，因链上数据公开可查）。
