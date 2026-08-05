# 账单与对账领域

## 目标

为用户提供可理解账单，并持续证明业务订单、账本、托管资产和外部供应商之间一致。

## 职责

账单投影、状态展示、总账平衡、余额投影重建、订单到账本、链上托管、供应商余额与付款结果对账、差异案件。

## 不负责什么

不改历史账本，不直接调余额，不将差异自动掩盖，不单独决定外部 UNKNOWN 的最终状态。

## 用户流程

用户查看按 UID 隔离的账单与状态；财务和运营查看经权限过滤的对账批次和差异，按 Maker-Checker 发起合法纠正命令。

## 核心实体

BillEntry、StatementCursor、ReconciliationRun、ReconciliationLine、DifferenceCase、EvidenceReference、CorrectionProposal。

## 状态机

Run：CREATED、COLLECTING、MATCHING、COMPLETED、PARTIAL、FAILED。Difference：OPEN、INVESTIGATING、RESOLVED、ACCEPTED_RISK、REOPENED。

## 输入

业务订单、账本交易、余额投影、链上观察、托管余额、供应商订单/余额和银行或支付凭证。

## 输出

用户账单、对账报告、差异案件、纠正建议和告警事件。

## 公开接口或事件

ListBills、RunReconciliation、OpenDifferenceCase、ProposeCorrection；BillProjected、DifferenceDetected、ReconciliationCompleted。

## 依赖方向

只读依赖所有资金订单、ledger、asset-custody 和集成快照；纠正通过原业务领域或账本受控接口，禁止反向直接写表。

## 资金影响

常规查询和匹配不动资金；确认差异后的纠正必须生成新业务命令和冲正/补偿分录，保留完整引用。

## 幂等要求

账单事件按账本交易/分录唯一；对账批次按范围与版本可重跑；同一差异证据不重复建案。

## 安全要求

用户只能查看自己的账单；管理员按数据范围访问；导出脱敏、限时、审计；外部文件视为不可信输入。

## 审计要求

记录批次参数、数据截止点、匹配规则、差异证据、处理人、审批和纠正引用。

## 测试重点

投影重建、分页一致、跨资产隔离、重复事件、截止点、部分数据、差异复开和纠正追踪。

## 需求状态

对账层次与禁止调余额 APPROVED；外部报表格式 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

第一个资金功能开始前必须先有资金订单到账本的最小对账接口；每个后续资金产品在开始相应外部集成前扩展链上或供应商对账合同，并在上线前完成失败演练。完整差异运营可在后续阶段成熟化。当前开发授权为 0。

## 待确认问题

具体链、市场和供应商由 [P0 清单](../product/open-decisions.md) 解决；本领域不新增 P0。
