# 换汇领域

## 目标

以有期限、可追溯报价完成资产间换汇，并在失败、超时和外部未知时保护资金。

## 职责

市场能力、报价快照、买卖方向、精度与舍入、费用、限额、资金预留、执行、结算、失败释放、冲正和对账。

## 不负责什么

不自动把展示币种变成托管资产，不虚构流动性或上游，不直接改余额，不用浮点 number 计算金额。

## 用户流程

用户选择交易对和方向，输入卖出或目标所得，查看有效期、预计所得、汇率、费用和舍入。确认时重新校验报价并预留；成交确定后结算，过期/失败释放，UNKNOWN 保持冻结并查询。

## 核心实体

Market、Quote、ExchangeOrder、ExecutionAttempt、SettlementInstruction、RoundingRecord、LiquidityProviderRef、ReconciliationCase。

## 状态机

QUOTED、EXPIRED、FUNDS_RESERVED、EXECUTING、FILLED、SETTLING、SUCCEEDED、FAILED、UNKNOWN、MANUAL_REVIEW、REVERSED。

## 输入

交易对、方向、输入金额或目标金额、报价来源、市场配置版本、用户确认、执行与结算结果。

## 输出

报价、预计所得、订单状态、账本命令、账单和市场/执行事件。

## 公开接口或事件

GetMarkets、CreateQuote、ConfirmExchange、RecordExecutionResult、ReconcileExchange；QuoteCreated、ExchangeReserved、ExchangeSucceeded、ExchangeUnknown。

## 依赖方向

依赖 asset-custody、ledger、fees-and-risk、account-security 和供应商适配器；产品目录与 Telegram 只消费公开接口。

## 资金影响

卖出资产先冻结；成交时两种资产分别在资产内平衡结算；手续费、点差、上游成本和舍入余数分账户记录。

## 幂等要求

报价 ID、确认命令和执行尝试唯一；过期报价不能重用；外部重试复用同一上游幂等键。

## 安全要求

报价来源白名单、时钟与有效期、防异常汇率、精度上限、限额、滑点规则和 UNKNOWN 禁止重付。

## 审计要求

保存报价来源/时间/值、配置版本、用户确认、费用、舍入、执行响应摘要、账本和对账引用。

## 测试重点

双向计算、精度/舍入、报价过期、并发确认、异常汇率、部分/未知执行、结算失败与冲正。

## 需求状态

交易对目录和通用流程 APPROVED；每对报价、执行、结算与托管含义 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

阶段 7 前须逐市场解决资产角色和真实执行模式，批准记账与对账设计；当前开发授权为 0。

## 待确认问题

见 [P0 第 4、5 项](../product/open-decisions.md)。

