# S7-6 换汇对账 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（只读对账，无资金动作）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S7-6 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 7 总体规划 v1.0](../2026-08-19-stage-7-exchange-master-plan.md)（S7-6 任务行）、[换汇领域](../../domains/exchange.md)（对账、舍入分账户记录）、[S3-5 ReconciliationService 先例](../../../apps/platform/src/modules/ledger/application/reconciliation.service.ts)（只读报告 + 类型化差异 + 绝不自动修复）、[S4-7 链上对账先例](../s4-7-chain-reconciliation/00-index.md)。

## 目标

换汇三层只读对账：**订单 ↔ 账本链接**、**报价快照 ↔ 订单事实**、**CLEARING_DIFF 累计 vs 权威重算**——外加以报价参考价计值的点差/舍入汇总（运营可观测）。

## 对账设计（ExchangeReconciliationService）

### 1. checkOrderLedgerLinkage（状态 ↔ 过账形状）
| 订单状态 | FREEZE | SETTLE | RELEASE | settlement 关联 |
|---|---|---|---|---|
| FUNDS_RESERVED / EXECUTING / FAILED / EXPIRED | 1 | 0 | 0 | — |
| SETTLED | 1 | 1 | 0 | 非空 |
| REFUNDED | 1 | 0 | 1 | 非空 |
违例 → `ORDER_LEDGER_LINKAGE {orderRef, detail}`。

### 2. checkQuoteSnapshotConsistency
每订单（全部状态）sell/buy 金额 === 所消费报价的快照金额 → `QUOTE_SNAPSHOT_MISMATCH {orderRef, field}`。

### 3. checkClearingAccumulation
每资产 CLEARING_DIFF 账户余额 vs "全部 EXCHANGE SETTLE 过账中该账户分录净额"重算 → `CLEARING_ACCUMULATION {assetCode, expected, actual}`。

### 4. 点差/舍入计值汇总（报告非差异）
对每笔 SETTLED 订单，用其报价 referenceRate 对卖/买两腿计值（纯 BigInt 复用 S7-2 数学），按市场聚合买卖腿价值差——即点差+舍入的运营视图。

### runAll → ExchangeReconciliationReport
`{discrepancies, clearingBalances[{assetCode, signed}], marketValueSummary[{marketKey, legValueDifference}], checkedAt}`——全部 Object.freeze。

## 冻结未来工程矩阵

Create：`modules/exchange/application/exchange-reconciliation.service.ts`、`apps/platform/test/database/exchange-reconciliation.integration.spec.ts`（S7RC）。Modify：无。

## 测试矩阵（S7RC）

- S7RC01 干净账本（结算后）→ 零差异 + 清算余额/计值汇总正确
- S7RC02 篡改：删一笔 SETTLE 过账 → 链接差异
- S7RC03 篡改：改订单 buy_amount → 快照差异
- S7RC04 篡改：删清算分录 → 累计差异
- S7RC05 只读性：对账前后全表行数不变
- S7RC06 释放链（FREEZE+RELEASE）对账干净；计值汇总含跨资产市场

## 边界与不做

- 不做自动修复（差异仅浮现，人工处置）；不做跨资产实时计价（用报价时点参考价）；不做真实上游对账（生产）。

## 停止条件

对账出现任何写入、差异类型无法定位到具体订单/资产。
