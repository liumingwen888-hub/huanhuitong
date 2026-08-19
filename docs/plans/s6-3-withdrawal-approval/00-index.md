# S6-3 Maker-Checker 审批流 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（资金出站审批权）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过并授权实施）。S6-3 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 6 总体规划 v1.0](../2026-08-17-stage-6-withdrawals-master-plan.md)（S6-3 任务行 + 决策 1 双轨）、[提现领域](../../domains/withdrawals.md)、[S6-1](../s6-1-withdrawal-contracts/00-index.md)（withdrawal_approvals UNIQUE 已落地）、[S6-2](../s6-2-withdrawal-request-freeze/00-index.md)（PENDING_APPROVAL 路由已落地，admin 待审事件已发出）。

## 目标

人工轨订单的完整审批闭环：**角色校验 → 审批记录 → 分级阈值判定 → 批准/拒绝 CAS 迁移 → 通知**。审批人必须是持有效角色授权的独立管理员；同一管理员对同一订单只能投一次票；高额订单需要两名不同管理员批准。

## 分级规则（金额阈值）

| 金额区间 | 审批要求 |
|---|---|
| `amount < minAutoAmount` | 自动批准（S6-2 已完成，不进本流程） |
| `minAutoAmount <= amount < dualApprovalThreshold` | 1 名 FINANCE_OFFICER 批准 |
| `dualApprovalThreshold <= amount <= maxAmount` | 2 名**不同** FINANCE_OFFICER 批准 |

- `dualApprovalThreshold` 来源：ConfigStore 键 `withdrawal.approval`，payload `{ "dualApprovalThreshold": "<decimal-string>" }`（版本化，S3-4 既有机制）。
- **fail-closed 默认**：配置缺失或非法时，所有人工轨订单一律按双审批处理（最保守）。
- 必需角色：`FINANCE_OFFICER`（AdminAuthorizer 既有五角色之一；SUPER_ADMIN 通过授予角色获得权限，不直接审批——职责分离）。

## 服务流程（WithdrawalApprovalService.decide）

输入：`{ withdrawalId, adminId, decision: 'APPROVE' | 'REJECT', reason? }`。

1. **角色校验**：`AdminAuthorizer.isAuthorized(adminId, 'FINANCE_OFFICER')`——false 即 `WITHDRAWAL_UNAUTHORIZED`，零写入。
2. **订单前置**：按 withdrawalId 加载；不存在 → `WITHDRAWAL_ORDER_NOT_FOUND`；状态非 `PENDING_APPROVAL` → `WITHDRAWAL_NOT_PENDING_APPROVAL`（终态/已批准订单不可再审）。
3. **审批记录**：`approvals.record(...)`——同管理员重复投票由 UNIQUE(withdrawal_id, admin_id) 拒绝 → `WITHDRAWAL_DUPLICATE_APPROVAL`。
4. **REJECT 分支**：`markRejected`（CAS PENDING_APPROVAL→REJECTED，记录 approver_admin_id + rejection_reason，两者由 V8 CHECK 强制非空）→ Outbox 用户通知（拒绝 + 原因类别）。CAS 失败（并发已被另一管理员处置）→ 幂等返回当前状态。
5. **APPROVE 分支**：`countApproved(withdrawalId)` 对比所需票数：
   - 已够票 → `markApproved`（CAS PENDING_APPROVAL→APPROVED）→ Outbox 用户通知（已批准，待签名）。CAS 失败 → 幂等返回（并发双批由 CAS 保证恰好一次迁移）。
   - 未够票（高额等待第二人）→ 状态保持 PENDING_APPROVAL → Outbox 管理侧事件（`admin.withdrawal-approval-recorded.v1`，等待下一审批人）。
6. 审计事实即 `withdrawal_approvals` 行（追加式、不可改，S6-1 只授予 INSERT）。

## 实施裁决记录（2026-08-19）

1. 重复投票采用预检（findByWithdrawal 查 adminId）+ UNIQUE 兜底；兜底触发时内核 UOW 包装错误保守映射 DUPLICATE_APPROVAL（S6-2 同型裁决）。
2. CAS 失败（并发已被处置）返回 `SUPERSEDED` + 当前快照，不视为错误（幂等收敛）。
3. REJECT 无 reason 时拒绝（`WITHDRAWAL_COMMAND_INVALID`），与 V8 CHECK 的 rejection_reason 非空一致。
4. RecordApprovalInput.reason 放宽为 `string | null`（exactOptionalPropertyTypes 严格性）。

## 冻结未来工程矩阵

Create：platform `modules/withdrawals/application/withdrawal-approval.service.ts`、`apps/platform/test/database/withdrawal-approval.integration.spec.ts`（S6WB）。Modify：`packages/contracts/src/withdrawals.ts`（错误码增补 `WITHDRAWAL_UNAUTHORIZED`、`WITHDRAWAL_NOT_PENDING_APPROVAL`）。

## 测试矩阵（S6WB）

- S6WB01 无角色/错误角色/非 ACTIVE 管理员 → UNAUTHORIZED，零审批行
- S6WB02 单审批阈值内：1 票 → APPROVED，用户通知一条
- S6WB03 高额双审批：第 1 票后仍 PENDING_APPROVAL + 管理侧事件；第 2 票（不同管理员）→ APPROVED
- S6WB04 同管理员第二票 → DUPLICATE_APPROVAL，票数不变
- S6WB05 REJECT → REJECTED（approver + reason 落库，V8 CHECK），用户通知
- S6WB06 非法对象：REJECTED 后再 APPROVE / FROZEN 直接审批 → NOT_PENDING_APPROVAL
- S6WB07 配置缺失 fail-closed：全按双审批处理
- S6WB08 并发双批：两名管理员并发 APPROVE，恰好一次 APPROVED 迁移、两行审批记录

## 边界与不做

- 不做管理员增强认证 UI/会话（阶段 9 管理后台范围）；服务层以 adminId + AdminAuthorizer 为信任边界，调用方负责认证。
- 不做 EXPIRED 过期扫描（S6-6 结算计划的定时任务统一处理）；不做签名/广播（S6-4/5）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（152 模块、181 依赖）。
- unit 27 文件 226/226 PASS。
- S6WB01–S6WB08 全 PASS：角色拒绝（SUPPORT/非 ACTIVE）零审批行、单审批阈值内一票 APPROVED + 用户通知、双审批两票两管理员（首票后仍 PENDING + 管理事件）、同管理员重复投票拒绝、REJECT 落库 approver/reason + 通知、已结算订单再审拒绝、配置缺失 fail-closed 全双审、并发双批恰好一次迁移 + 两行审批记录。
- 数据库回归 422/425（M06/M14/M16 已知环境边界项）。
- 交付物：`apps/platform/src/modules/withdrawals/application/withdrawal-approval.service.ts`、`apps/platform/test/database/withdrawal-approval.integration.spec.ts`、contracts 错误码增补（WITHDRAWAL_UNAUTHORIZED / WITHDRAWAL_NOT_PENDING_APPROVAL）。

## 停止条件

审批权限模型与 authority-map 冲突、CAS 语义不清、ConfigStore 键与既有配置冲突。
