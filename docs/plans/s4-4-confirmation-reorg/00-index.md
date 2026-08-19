# S4-4 确认等待与重组处理 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（涉及资金安全）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S4-4 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 4 总体规划](../2026-08-17-stage-4-deposits-master-plan.md)（确认数策略 + 重组处理 + UNKNOWN 不推断）、[ledger-model 冲正](../../architecture/ledger-model.md)、S4-1 确认策略/检测表、S4-3 检测 Worker。

## 目标

**确认编排服务** `DepositConfirmationService`——把 S4-3 检测到的 DETECTED 交易推进到 CONFIRMED（或检测到重组→REORG_DETECTED）：

1. **确认推进** `processConfirmations(network)`：
   - 查询 status='DETECTED' 且 confirmations ≥ 策略阈值的检测；
   - 逐条 CAS 转换 DETECTED→CONFIRMED（幂等——已 CONFIRMED 跳过）；
   - 返回确认列表（含 uid/asset/amount/txid——S4-5 入账编排的输入）。

2. **重组检测** `processReorg(network, orphanedTxids)`：
   - 输入：因链重组被孤立的交易 ID 列表（由 ChainScannerPort 新方法 `getTransactionStatus(network, txid)` 提供——返回 confirmed/orphaned/unknown）；
   - 对已 POSTED 的检测：生成**冲正**（S3-2 ReverseTransactionService）→ 状态 CAS POSTED→REORG_DETECTED；
   - 对已 CONFIRMED 未 POSTED 的：状态 CAS CONFIRMED→REORG_DETECTED（阻止入账）；
   - **UNKNOWN 不推断**：交易状态未知时不自动冲正也不自动重付——标记为 REORG_DETECTED 并等待人工裁决（AGENTS 红线）。

3. **确认跟踪补充**（S4-3 遗留）：`refreshConfirmations(network)`——对已有 DETECTED/CONFIRMED 检测批量调用 scanner 获取最新确认数（不依赖 checkpoint 范围）。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/deposits/application/deposit-confirmation.service.ts`、`test/database/deposit-confirmation.integration.spec.ts`。Modify：S4-1 检测仓储（如需批量确认数更新方法——按先例登记）。

## 测试矩阵（S4CF）

- 确认推进：DETECTED + 达标 confirmations → CONFIRMED；未达标保持 DETECTED；
- 幂等：重复 processConfirmations 不重复转换；
- 重组已 POSTED：冲正新交易生成 + 原 POSTED→REORG_DETECTED；
- 重组已 CONFIRMED 未 POSTED：直接 REORG_DETECTED；
- UNKNOWN：不冲正不重付，标记等待；
- 确认跟踪：已有检测的 confirmations 被刷新。

## 停止条件

需要真实链连接、需要新迁移、三锁漂移。

## 裁决

- 重组后重新出现在链上的交易走**新检测**（新 txid）而非复活旧检测——旧检测保持 REORG_DETECTED 作为审计痕迹。
- 冲正仅在原交易已 POSTED（已入账）时触发；CONFIRMED 未入账的只需阻止。
