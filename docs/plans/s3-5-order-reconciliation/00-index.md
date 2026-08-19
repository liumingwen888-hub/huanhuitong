# S3-5 订单关联与对账接口 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S3-5 代码状态：`NOT_STARTED`。

## 权威需求来源

[ledger-model 并发/冲正/对账](../../architecture/ledger-model.md)（"总账平衡、余额投影、业务订单、链上托管资产、供应商余额和银行/支付凭证分别对账"）、[domain-map bills-and-repositories](../../architecture/domain-map.md)、S3-2～4 已交付。

## 目标

1. **订单关联**：`PostMoneyService.post()` 返回的 transactionId 与业务订单绑定——通过 idempotency_key 已天然关联（键格式=业务类型+订单+操作+代次），无需新表；补充**查询接口** `findTransactionByOrder(orderType, orderId)`（从幂等键反查）。
2. **总账平衡对账** `application/reconciliation.service.ts`：
   - `checkGlobalBalance()`：每资产 entries 借贷总和==0（全表级不变量）；
   - `checkProjectionConsistency()`：复用 S3-3 verifyProjection；
   - `checkAccountIntegrity()`：每账户投影 vs SUM（已有）+ 账户状态与分录存在性交叉校验；
   - 返回结构化差异报告（差异类型 + 账户/资产 + 期望/实际值）。
3. **对账任务接口** `worker/reconciliation-task.ts`：durable job 类型 `reconciliation.scheduled`——runOnce 周期调用上述三检查，差异写入 `risk_decisions`（reason_code=`RECONCILIATION_DISCREPANCY`）作为告警通道（阶段 9 完整告警前的过渡方案）。
4. **对账幂等**：任务幂等键=时间窗口；重复运行不重复告警。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/ledger/application/reconciliation.service.ts`、`apps/worker/src/jobs/reconciliation-task.ts`、`apps/platform/test/database/reconciliation.integration.spec.ts`。Modify：0。

## 测试矩阵（S3R）

- checkGlobalBalance：平衡时零差异；手工注入不平衡行→差异报告；
- checkProjectionConsistency：篡改投影→差异捕获→recomputeAll 修复→清零（S3-3 场景的完整链路）；
- checkAccountIntegrity：关闭账户有分录、正常账户零差异；
- reconciliation 任务：运行→发现差异→risk_decisions 落库→重跑（同窗口）不重复；
- 订单反查：过账后按幂等键片段找到 transactionId。

## 停止条件

需要写账本/余额、需要新迁移、三锁漂移。

## 裁决

对账差异告警暂走 risk_decisions（追加式、幂等）——阶段 9 管理后台有完整告警 UI 时迁移到专用通知通道；差异不自动修复（需人工裁决——与"差异进人工复核"红线一致）。
