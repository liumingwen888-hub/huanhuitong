# S6-1 提现领域合同与 V8 迁移 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（资金出站 schema）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过；同日显式授权 V8 迁移写入）。S6-1 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

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

- V8 增 `withdrawal_approvals`、`signer_policies` 表与 `ix_withdrawal_orders_open` 部分索引；`signer_policies` 主键为 (policy_version, network)。

## 测试矩阵（S6WC）

- V8 迁移正反（V1-V7 兼容、角色矩阵、CHECK 拒绝）；
- 订单幂等创建；
- 状态机 CAS（非法跳转拒绝）；
- 审批 UNIQUE 约束（同 admin 重复拒绝）；
- 策略版本化（新版本不覆盖旧）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（150 模块、175 依赖）。
- unit 27 文件 226/226 PASS。
- database 33 文件：S6WC01–S6WC06 全 PASS（幂等创建、10 态 CAS、审批 UNIQUE、策略版本化、worker 只读、CHECK 拒绝）；M03/M04/M07/M08 更新至 V8（38 表）后 PASS；六个阶段规格的 appliedVersions 钉住修复为 arrayContaining（此前 V5–V7 已将其破坏，属既有欠账）。已知环境边界项 M06/M14/M16 仍不适用（Windows 路径断言 / Flyway 容器清理超时），与 V8 无关。
- 交付物：`database/migrations/V8__stage_6_withdrawals.sql`、`packages/contracts/src/withdrawals.ts`（index 导出）、`apps/platform/src/modules/withdrawals/{domain,application,infrastructure}` 三文件、`apps/platform/test/database/withdrawal-contracts.integration.spec.ts`。

## 实施裁决记录（2026-08-19，相对 v1.0 冻结面的两处收敛）

1. **状态机恰为 10 态，无 REQUESTED**：申请与冻结过账原子同事务（S6-2），可观测的"已申请未冻结"中间态违反资金命令原子底线；初始提交态为 FROZEN。
2. **新增 `settlement_ledger_transaction_id` 列**：冻结过账（withdrawalRequested）与收口过账（withdrawalSucceeded / 退款释放）是两笔不同账本交易，收口关联由该列承载；`ledger_transaction_id` 固定为冻结关联。
3. 补充 `failure_reason` 列（FAILED 态必填，与 REJECTED 的 rejection_reason 分离）。
4. signer_policies 不做种子：无策略 = 提现关闭（fail-closed），由 S6-2 服务层强制。

## 停止条件

V1-V7 兼容破坏、三锁漂移、V8 未获授权。
