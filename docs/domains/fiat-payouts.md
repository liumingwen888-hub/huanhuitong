# 法币代付领域

## 目标

通过真实供应商适配器把已预留用户资金转换为可核验的法币付款，并防止上游重复代付。

## 职责

能力查询、报价、订单、资金预留、提交、回调验真、主动查询、供应商余额、熔断、停止新单、UNKNOWN、冲正和对账。

## 不负责什么

不虚构国家、供应商字段、费率、限额、SLA 或回调格式；不把回调单独视为绝对事实；不直接改余额。

## 用户流程

用户选择已开放国家/路线和收款信息，查看报价费用并完成授权。平台预留后提交真实供应商，展示处理状态。失败、未知或反转按查询和对账推进，不自动重复付款。

## 核心实体

PayoutCapability、PayoutQuote、PayoutOrder、BeneficiarySnapshot、ProviderAttempt、CallbackInbox、ProviderBalanceSnapshot、ReconciliationCase。

## 状态机

CREATED、FUNDS_RESERVED、SUBMITTING、ACCEPTED、PROCESSING、SUCCEEDED、FAILED、UNKNOWN、MANUAL_REVIEW、REVERSED。

## 输入

UID、国家/路线、收款资料、金额、报价、授权、供应商合同映射、回调与主动查询响应。

## 输出

订单状态、资金命令、供应商请求、查询任务、账单、审计和事件。

## 公开接口或事件

GetPayoutCapabilities、QuotePayout、CreatePayout、IngestProviderCallback、QueryPayout、ReconcilePayout；PayoutReserved、PayoutSucceeded、PayoutUnknown、PayoutReversed。

## 依赖方向

依赖 identity、account-security、ledger、fees-and-risk、admin-and-audit、integration 和 platform-operations。

## 资金影响

创建后用户资金冻结；成功结算用户负债、供应商清算、费用收入和上游成本；失败释放；REVERSED 用补偿分录。

## 幂等要求

平台订单、供应商幂等键、回调事件和查询结果唯一去重；同一业务意图不得因超时创建新付款。

## 安全要求

供应商请求与回调双向验真、敏感收款字段最小化与加密、字段权限、限额、熔断和数据驻留评审。

## 审计要求

记录合同/适配器版本、脱敏收款摘要、报价、请求、回调验真、查询、状态映射、账本和人工决定。

## 测试重点

重复回调、乱序状态、提交超时、UNKNOWN、上游重复、熔断、余额不足、逆向状态和对账。

## 需求状态

适配模型与状态 APPROVED；国家、供应商和真实合同 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

阶段 8 前须有签约供应商、国家合规批准、沙箱/契约证据和安全评审；当前开发授权为 0。

## 待确认问题

见 [P0 第 6、9 项](../product/open-decisions.md)。

