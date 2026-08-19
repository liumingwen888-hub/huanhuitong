# S6-2 提现申请与冻结服务 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（资金冻结编排）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S6-2 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 6 总体规划 v1.0](../2026-08-17-stage-6-withdrawals-master-plan.md)（S6-2 任务行 + 已裁决决策 1/4/5）、[提现领域](../../domains/withdrawals.md)（含 V8 状态机映射）、[ledger-model](../../architecture/ledger-model.md)、[S6-1 计划](../s6-1-withdrawal-contracts/00-index.md)（已 VERIFIED）。

## 目标

用户提现申请到资金冻结的完整编排：**支付授权证明校验 → 策略与限额 → 冻结过账 → 订单创建 → 双轨路由 → Outbox 通知**。S6-2 只到 FROZEN/PENDING_APPROVAL/APPROVED（自动轨）为止；签名、广播、结算属 S6-4～S6-6。

## 服务流程（WithdrawalRequestService.request）

1. **证明绑定校验**（fail-closed，全部不匹配即拒绝且不开任何写事务）：
   - `proof.type === 'security.payment-authorized.v1'`；
   - `proof.uid === command.uid`；`proof.operationType === 'withdrawal'`；
   - `proof.orderRef === command.orderRef`；
   - `proof.assetSummary === command.assetCode`、`proof.amountSummary === command.amount`（十进制字符串精确相等；这是资金侧定义的绑定合同，S6-7 Telegram 层开仓时必须传相同值）；
   - `proof.expiresAt > now`（过期拒绝，不推断）。
2. **幂等前置**：`findByOrderRef` 命中即返回 `already_requested` + 当前快照（任何状态，含终态）。
3. **策略读取**：按资产网络 `findActive(network)`；无策略 → `WITHDRAWAL_POLICY_NOT_FOUND`（提现关闭，fail-closed）。
4. **金额校验**：`0 < amount <= policy.maxAmount`，否则 `WITHDRAWAL_AMOUNT_ABOVE_MAX`；`fee = policy.feeAmount`（固定费，唯一费用来源，不复用 fee_schedules）。
5. **RiskGate**：`check(uid, 'WITHDRAWAL', amount, orderRef+':risk')`——拒绝即返回，无任何写入。
6. **原子核心**（单 unitOfWork）：
   - `ensureAccount(uid, asset, USER_AVAILABLE)` + `ensureAccount(uid, asset, USER_FROZEN)`（复用 S3 模式）；
   - S3-6 模板 `withdrawalRequested`（幂等键 `WITHDRAWAL:{orderRef}:FREEZE:0`）→ PostMoney 内核（借贷平衡/防负余额/并发行锁全由内核强制）；
   - `createOrder(orderRef, …, freezeLedgerTransactionId = posting.transactionId)`（order_ref UNIQUE 幂等）；
   - **双轨路由**：`amount < policy.minAutoAmount` → `markApproved`（自动轨）；否则 `markPendingApproval`（人工轨）。两者都是 V8 CAS。
7. **Outbox 通知**：用户侧"提现已受理 + 当前状态"；`PENDING_APPROVAL` 时另发管理侧待审事件（S6-3 消费）。
8. 返回订单快照。

**崩溃自愈**：过账后、订单插入前崩溃——重放同 orderRef 时模板幂等键返回同一过账，订单随后创建；无双重冻结。

## 冻结未来工程矩阵

Create：platform `modules/withdrawals/application/withdrawal-request.service.ts`、`apps/platform/test/database/withdrawal-request.integration.spec.ts`（S6WA）。Modify：无（合同、仓储、模板 S6-1/阶段 3 已交付）。

## 测试矩阵（S6WA）

- S6WA01 证明绑定全维度拒绝（type/uid/orderRef/amount/asset/过期 各一）
- S6WA02 幂等：同 orderRef 重放返回 already_requested，账本仅一笔冻结
- S6WA03 无策略 fail-closed；超 max 拒绝且零写入
- S6WA04 冻结过账后可用减少、冻结增加、借贷平衡（余额投影一致）
- S6WA05 双轨路由：低于 minAuto → APPROVED；高于 → PENDING_APPROVAL
- S6WA06 余额不足：内核拒绝负余额，订单不落库
- S6WA07 RiskGate 拒绝路径：限额触发，零账本写入、零订单写入
- S6WA08 Outbox：受理通知 + 待审事件各一条（PENDING_APPROVAL 场景）

## 边界与不做

- 不做签名/广播/结算（S6-4～6）；不做 Telegram UX（S6-7，含开仓摘要合同对接）；不做审批流（S6-3）。
- 手续费在结算时从可用扣（withdrawalSucceeded 模板既有行为）；可用性不足付费的结算期处理属 S6-6 计划。

## 停止条件

证明绑定合同与 S2 实现不兼容、内核拒绝路径不确定（UNKNOWN 未查询即推断）、三锁漂移。
