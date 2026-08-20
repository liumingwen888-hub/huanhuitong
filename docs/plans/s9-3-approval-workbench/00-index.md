# S9-3 统一审批工作台 API 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（编排层，决定逻辑全部下沉已验证服务）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过）。S9-3 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 9 总体规划 v1.0](../2026-08-19-stage-9-admin-master-plan.md)（决策 5：approval_requests 编排层不动已验证双审服务）、[S6-3 WithdrawalApprovalService](../../../apps/platform/src/modules/withdrawals/application/withdrawal-approval.service.ts)、[S8-5 PayoutQueryService](../../../apps/platform/src/modules/fiatpayout/application/payout-query.service.ts)、[S9-2 AdminApiRouter](../s9-2-admin-api-rbac/00-index.md)。

## 关键裁决：无表编排层（不建 approval_requests 表）

决定事实已有权威审计源：提现决定在 `withdrawal_approvals`（S6-1 UNIQUE 锚 + S6-3 CAS）、代付供应商裁决在 `callback_inbox` + 订单状态机。再造一张 approval_requests 表会产生**第二决定源**，与"每个主题一个完整权威来源"的文档合同冲突。统一层是**聚合读模型 + 路由决定**：决定仍由已验证服务落各自事实表，统一层只做清单聚合与端点路由（审计由 S9-2 基座逐请求记录）。

## 待审清单的两类来源

| 类别 | 来源域 | 态 | 决定动作 |
|---|---|---|---|
| WITHDRAWAL_APPROVAL | 提现 | PENDING_APPROVAL | WithdrawalApprovalService.decide（APPROVE/REJECT+reason） |
| PAYOUT_UNKNOWN | 代付 | UNKNOWN/SUBMITTING（供应商不确定） | PayoutQueryService.queryFirst（查询优先裁决，非人工拍板） |

统一清单项 `ApprovalItem {itemId: 'WDL:{id}'|'PO:{id}', kind, uid, asset/route, amount, status, createdAt, requiredVotes?}`——金额/资产经 renderNumeric 同款白名单字符集（API 层数字字符串本身即安全）。

## 端点设计（挂载 AdminApiRouter）

| 路由 | 角色 | 级别 | 说明 |
|---|---|---|---|
| GET /admin/approvals/pending | AUDITOR（只读）或 FINANCE_OFFICER | BASIC | 统一清单（两类合并、时间序、限额 100） |
| POST /admin/approvals/withdrawal/{id}/decide | FINANCE_OFFICER | **ELEVATED** | body {decision, reason?} → decide |
| POST /admin/approvals/payout/{id}/resolve | FINANCE_OFFICER | ELEVATED | → queryFirst（触发查询裁决） |

- AUDITOR 只读清单、不能决定（角色矩阵：清单 requiredRole 放宽为 AUDITOR**或**FINANCE——实现为双注册校验：任一通过即可，仍默认拒绝其它角色）；简化裁决：清单要求 `AUDITOR` 级即可读（五角色中最低权限语义），决定端点 FINANCE_OFFICER + ELEVATED。
- 提现决定端点返回统一 `{outcome, orderStatus}`；代付 resolve 返回 `{outcome, reportedStatus}`。
- 发起人≠审批人：withdrawal 域无"发起管理员"概念（用户发起），天然满足；代付同理——裁决记录于 S9-8 威胁模型。

## 冻结未来工程矩阵

Create：`modules/admin/http/admin-approval.routes.ts`、`modules/admin/application/approval-workbench.service.ts`、`apps/platform/test/database/approval-workbench.integration.spec.ts`（S9AP）。Modify：contracts/admin.ts（ApprovalItem/结果类型）；withdrawal 仓储增 `findPendingApprovals(context, limit)`（SELECT，无状态迁移）；payout 仓储增 `findUncertain(context, limit)`。

## 测试矩阵（S9AP，集成——真库真服务）

- S9AP01 清单聚合：提现 PENDING_APPROVAL + 代付 UNKNOWN 混合并按时间序；FROZEN/已决提现不在列
- S9AP02 提现决定：APPROVE → 双审之一（状态仍 PENDING 或 APPROVED 视票数）；REJECT+reason → REJECTED
- S9AP03 决定端点 RBAC：AUDITOR 403；FINANCE 未提升 403 ELEVATION_REQUIRED；提升后 200
- S9AP04 代付 resolve：UNKNOWN 单触发查询（FakeProvider 状态驱动结果）
- S9AP05 未知 id → 404 语义（业务 NOT_FOUND 响应体）
- S9AP06 每请求审计 GRANTED/DENIED（S9-2 基座逐请求已记——本任务断言审批事件的 subjectRef 含 itemId）
- S9AP07 幂等：同一提现重复决定同票（DUPLICATE 拒绝路径返回 409 语义）

## 边界与不做

- 不做前端（S9-7）；不做 exchange 域审批（限额内无人工门）；不做批量决定（逐单可审计）。

## 实施裁决记录（2026-08-19）

1. 清单可见性落地为"任何已认证管理员可读"（计划文本 AUDITOR 的放宽）：五角色均为内部受信角色，AUDITOR-only 反而使 FINANCE 无法在工作台看到待审；决定权仍 FINANCE_OFFICER+ELEVATED 不变。
2. AdminApiRouter 增单段 `:param` 路径匹配（精确匹配优先，参数段提取后传处理器）——路由能力最小扩展，默认拒绝语义不变。
3. AuditRecorder 补 occurred_at（audit_events 无默认值——实现期发现）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（209 模块、221 依赖）。
- unit 33 文件 260/260 PASS（S9RB 基座回归全过）。
- S9AP01–S9AP07 全 PASS：清单双域聚合并按时间序（WDL:×/PO:× 编号 + kind 标注）、提现决定全链（APPROVE→AWAITING_SECOND→第二人 REJECT→REJECTED）、角色门（plain-token 403 ROLE_DENIED + 非法决定体 400）、代付 resolve 触发供应商查询（SUCCEEDED_REPORTED）、未知 id 404、审计落档（event_type/outcome/actor_ref 断言）、同管理员重复投票 409 WITHDRAWAL_DUPLICATE_APPROVAL。
- 数据库回归 531/534（M06/M14/M16 已知环境边界项）；integration 121/121。
- 交付物：`approval-workbench.service.ts`、`admin-approval.routes.ts`（三端点）、router :param 匹配、withdrawal/payout 仓储只读查询（findPendingApprovals/findUncertain）、contracts ApprovalItem、S9AP 集成规格。

## 停止条件

编排层写入任何决定事实（越权）、清单泄露他人订单细节超出审批所需字段。
