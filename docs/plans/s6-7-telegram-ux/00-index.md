# S6-7 Telegram UX 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（UX 编排层，资金逻辑全部下沉已验证服务）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S6-7 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 6 总体规划 v1.0](../2026-08-17-stage-6-withdrawals-master-plan.md)（S6-7 任务行）、[S6-2 证明绑定合同](../s6-2-withdrawal-request-freeze/00-index.md)（amountSummary=金额十进制串、assetSummary=资产码——本任务是合同的首个调用方）、[安全底线](../../../AGENTS.md)（零插值回复常量、凭证不回显）。

## 目标

提现的完整用户旅程：**/withdraw 命令 → 支付密码会话（真实绑定值开仓）→ S6-2 申请服务 → 结果回复**；**/withdrawstatus 状态查询**；**通知消费者**（outbox 提现主题 → Telegram 常量文案）。

## 命令面（沿用 S5 纯解析器模式）

- `/withdraw <asset> <amount> <address>`——asset 为 `[A-Z0-9-]{3,16}`、amount 为非零十进制串（≤18 位）、address 为 `[A-Za-z0-9]{20,64}`（字符集/长度防线；真实逐链地址校验属签名/链层，未知资产由服务层 fail-closed）。
- `/withdrawstatus <orderRef>`——查询本人订单当前状态。
- 解析器 `classifyWithdrawalUpdate`：纯函数、私聊门、非法形状返回 null（S5 classifyTransferUpdate 同型）。

## 处理器流程（withdrawal-command.handler）

1. 解析 → `resolveUid(externalUserId)`（身份绑定查询，未绑定回复常量）。
2. 生成 orderRef（`WD-` + UUID 前缀）；**以真实绑定值开支付授权会话**：`beginAuthorization({ uid, operationType: 'withdrawal', orderRef, amountSummary: command.amount, assetSummary: command.asset })`——S6-2 绑定合同的调用侧落地；注册流程态（externalUserId → sessionId + 挂起命令上下文）。
3. 密码数字流复用既有安全流程注册表（security flow registry）；`authorizePayment` 成功 → 组装 `WithdrawalCommand + proof` → `WithdrawalRequestService.request`。
4. 结果映射为**零插值常量**（按类别，不按值）：
   - ACCEPTED(APPROVED 轨) → `withdrawAcceptedAuto`；ACCEPTED(PENDING_APPROVAL) → `withdrawAcceptedPendingApproval`
   - ALREADY_REQUESTED → `withdrawDuplicate`
   - REJECTED × {POLICY_NOT_FOUND→withdrawDeniedUnavailable、AMOUNT_ABOVE_MAX→withdrawDeniedTooLarge、INSUFFICIENT_FUNDS→withdrawDeniedInsufficient、RISK_DENIED→withdrawDeniedRisk、COMMAND_INVALID→withdrawDeniedInvalid}
   - 证明拒绝/过期 → `authorizeRejected`（复用安全层既有常量族）
5. `/withdrawstatus`：仅本人订单（uid 匹配）→ 十态各一常量；他人订单/不存在 → `withdrawStatusUnknown`。

## 通知消费者（worker）

`telegram.withdrawal-{requested,approved,rejected,broadcast,succeeded,failed,refunded}.v1` 七主题 → 单处理器按主题映射常量文案 → 经 Bot 网关按 uid 绑定投递；payload 含状态但**文案不插值**（类别化）。注册进 `create-worker` 的 topicHandlers。

## 冻结未来工程矩阵

Create：`telegram/application/{withdrawal-commands.ts, withdrawal-replies.ts, withdrawal-command.handler.ts}`、`apps/worker/src/outbox/withdrawal-notification.handler.ts`、`apps/platform/test/unit/withdrawal-commands.spec.ts`（S6WU）。Modify：`telegram/application/security-command.handler.ts`（begin-authorize 的 DEMO 占位路由到真实绑定值或由新处理器旁路）、`apps/worker/src/bootstrap/create-worker.ts`（注册主题处理器）。

## 测试矩阵（S6WU，单元级 + 内存 Fake）

- S6WU01 解析器：合法/非法形状（资产码、金额零/非数字、地址长度、参数数、非私聊）
- S6WU02 全链路（Fake 会话 + Fake 申请服务）：/withdraw → 密码授权 → ACCEPTED 自动轨回复常量 + 命令携带真实绑定值（orderRef/amount/asset 断言）
- S6WU03 高额 → PENDING_APPROVAL 回复；ALREADY_REQUESTED → 重复回复
- S6WU04 五类拒绝 → 各自常量；证明过期 → 授权拒绝常量；零服务调用断言
- S6WU05 /withdrawstatus：本人十态常量 + 他人订单 unknown + 不存在 unknown
- S6WU06 通知处理器：七主题 → 七常量、uid 绑定查找、无插值（文案静态断言）

## 边界与不做

- 不做新资金逻辑（全部调用 S6-2 已验证服务）；不做按钮/向导 UI（文本命令即可，阶段 9 管理后台另议）；不做审批人通知的 UI（管理侧事件 S6-3 已发，管理后台阶段 9 消费）。
- 密码输入仍走既有安全流程（不回显、短期内存、超时清理——阶段 2 已验证，本任务只接证明消费）。

## 停止条件

绑定值在任一路径退化为占位/宽松比较、回复出现动态插值、凭证或地址全文进日志。
