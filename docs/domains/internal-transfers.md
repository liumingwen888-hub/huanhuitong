# 内部转账领域

## 目标

在平台内部两个 UID 之间以复式账本完成即时、可审计且不触发链上交易的资金转移。

## 职责

解析并确认收款 UID、校验付款资格与授权、计算费用和风险、创建订单、调用账本、生成双方结果与通知。

## 不负责什么

不联系未启动 Bot 的用户，不处理领取凭证，不直接改余额，不以 username 完成不可逆转账。

## 用户流程

付款人选择已绑定收款人，查看明确确认信息，输入金额并通过支付密码。系统检查状态、限额、资产、费用、风险和余额，原子过账并生成双方账单，通知异步发送。

## 核心实体

TransferOrder、RecipientSnapshot、TransferQuote、PaymentAuthorizationRef、RiskDecisionRef、LedgerReference。

## 状态机

CREATED、AWAITING_AUTHORIZATION、READY、POSTED、REJECTED、CANCELLED。POSTED 是内部最终状态；通知失败不改变它。

## 输入

付款 UID、收款 UID、资产、金额、客户端命令 ID、费用/风险快照和支付授权证明。

## 输出

转账结果、账本交易、双方账单与 TransferPosted 通知事件。

## 公开接口或事件

PreviewTransfer、ConfirmTransfer、GetTransfer；TransferPosted、TransferRejected。

## 依赖方向

依赖 identity、account-security、fees-and-risk、ledger；Telegram 只调用公开用例。claims 处理未注册收款人，不被本领域隐式调用。

## 资金影响

付款可用负债减少，收款可用负债增加；手续费独立入账。全流程无链上交易。

## 幂等要求

付款 UID 与客户端命令 ID 唯一；确认重试返回同一订单和账本结果；并发扣款由账本防负余额。

## 安全要求

确认页面不能只显示 username；授权绑定订单摘要；禁止自己绕过限额、受限用户或冻结账户。

## 审计要求

记录双方 UID、确认快照摘要、费用、风险、授权引用和账本引用；不记录支付密码。

## 测试重点

重复确认、并发余额竞争、收款人变更、受限状态、费用边界、通知失败和自转账策略。

## 需求状态

核心流程 APPROVED；具体限额、费率与自转账策略 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

账本、支付密码和收款人确认必须先 READY；最小费用/风险/限额合同、追加式审计、配置版本、服务端管理授权、订单到账本关联、对账接口以及 Inbox/Outbox/持久任务必须已可验证，不能等待阶段 9/10。当前开发授权为 0。

## 待确认问题

支付策略受 [P0 第 7 项](../product/open-decisions.md) 影响；没有新增 P0。
