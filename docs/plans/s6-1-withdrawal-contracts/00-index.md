# S6-1 提现领域合同与 V8 迁移 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（资金出站 schema）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S6-1 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 6 总体规划 v1.0](../2026-08-17-stage-6-withdrawals-master-plan.md)（双轨审批+固定费+全热钱包）、[ledger-model 提现模板](../../architecture/ledger-model.md)、[withdrawals 领域](../../domains/withdrawals.md)。

## 目标

1. **V8 增量迁移**（须显式授权）：
   - `withdrawal_orders`：withdrawal_id PK、order_ref UNIQUE（幂等键）、uid FK、asset_code FK、amount BIGINT CHECK(>0)、fee BIGINT DEFAULT 0、destination_address text（链上目标地址）、status（REQUESTED→FROZEN→PENDING_APPROVAL→APPROVED→SIGNING→BROADCAST→CONFIRMED / REJECTED / FAILED / EXPIRED / REFUNDED）、ledger_transaction_id FK（冻结过账关联）、broadcast_txid text NULL（链上交易 ID）、approver_admin_id FK NULL（审批人）、rejection_reason、created_at、updated_at。
   - `withdrawal_approvals`：approval_id PK、withdrawal_id FK、admin_id FK、level（1/2）、decision（APPROVE/REJECT）、reason、created_at；UNIQUE(withdrawal_id, admin_id)——同一管理员不能重复审批。
   - `signer_policies`：policy_version PK、network、hot_wallet_address、fee_amount BIGINT、min_auto_amount BIGINT（低于此自动审批）、max_amount BIGINT（高于此拒绝）、activated_at。
   - 权限：platform 读写；worker 只读。

2. **contracts**：WithdrawalOrderStatus（10 态）、WithdrawalCommand/Result、SignerPolicySnapshot。

3. **仓储接口**：订单（create/findByIdempotencyKey/每个状态转换 CAS）；审批（insert/find/countApproved）；策略（activePolicy）。

## 冻结未来工程矩阵

Create：`database/migrations/V8__stage_6_withdrawals.sql`、`packages/contracts/src/withdrawals.ts`、platform `modules/withdrawals/{domain,application,infrastructure}` 五文件、database spec。Modify：contracts index。

## 测试矩阵（S6WC）

- V8 迁移正反（V1-V7 兼容、角色矩阵、CHECK 拒绝）；
- 订单幂等创建；
- 状态机 CAS（非法跳转拒绝）；
- 审批 UNIQUE 约束（同 admin 重复拒绝）；
- 策略版本化（新版本不覆盖旧）。

## 停止条件

V1-V7 兼容破坏、三锁漂移、V8 未获授权。
