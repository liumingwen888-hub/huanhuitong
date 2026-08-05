# 提现领域

## 目标

把用户账本资金按批准网络安全转换为一次链上付款，并处理审批、签名、广播、确认和未知状态。

## 职责

地址与能力校验、支付授权、费用和风险、资金预留、审批、签名意图、广播编排、确认、失败释放、冲正和对账。

## 不负责什么

不保存私钥，不直接签名，不自行定义网络，不把广播超时当作失败，不直接改余额。

## 用户流程

用户选择资产/网络、输入地址与金额并确认费用，通过支付密码及可选 TOTP。平台预留资金，按风险审批后请求隔离签名、广播并等待确认。UNKNOWN 显示处理中并主动查询；确定失败才释放。

## 核心实体

WithdrawalOrder、DestinationSnapshot、FeeQuote、ApprovalCase、SigningIntent、BroadcastAttempt、ChainConfirmation、ReconciliationCase。

## 状态机

CREATED、FUNDS_RESERVED、PENDING_APPROVAL、SIGNING、SIGNED、BROADCASTING、UNKNOWN、CONFIRMING、SUCCEEDED、FAILED、MANUAL_REVIEW、REVERSED。UNKNOWN 禁止直接转 FAILED 并重付。

## 输入

UID、资产、网络、地址、金额、客户端命令 ID、支付授权、风险/费用快照、审批和链上结果。

## 输出

提现状态、账本预留/结算/释放命令、最小化签名请求、广播任务、账单与事件。

## 公开接口或事件

PreviewWithdrawal、CreateWithdrawal、ApproveWithdrawal、RecordBroadcastResult、RecordConfirmation；WithdrawalReserved、SigningRequested、WithdrawalSucceeded、WithdrawalUnknown。

## 依赖方向

依赖 identity、account-security、asset-custody、ledger、fees-and-risk、admin-and-audit、signer 合同和 platform-operations。

## 资金影响

创建后用户可用转冻结；成功结算用户负债、托管资产、费用收入和链上成本；确定失败释放；冲正用新分录。

## 幂等要求

客户端命令、审批、签名意图、广播尝试和链上交易引用分别唯一；重试复用同一意图，不生成重复支付。

## 安全要求

地址网络强校验、授权绑定订单摘要、Maker-Checker、签名隔离、广播防替换、限额和大额增强认证。

## 审计要求

记录请求、地址摘要、授权引用、费用、风险、审批、签名意图摘要、广播与确认，不记录私钥或完整凭证。

## 测试重点

重复提交、审批竞态、签名重放、广播超时、UNKNOWN 查询、链重组、失败释放、冲正和对账差异。

## 需求状态

流程与职责分离 APPROVED；链、资产、限额、TOTP 策略 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

阶段 6 前须解决支持网络、支付策略、Signer 边界和每链威胁模型，并已有独立管理员身份、Maker-Checker、高风险重新认证、Signer 策略审批、追加式审计、可靠任务和对账接口；这些最小能力不能等待阶段 9/10。当前开发授权为 0。

## 待确认问题

见 [P0 第 1、3、4、7 项](../product/open-decisions.md)。
