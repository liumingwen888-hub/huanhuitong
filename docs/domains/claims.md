# 领取领域

## 目标

让未注册或 Bot 不可主动联系的收款人通过安全深链领取已预留资金。

## 职责

创建领取、预留资金、生成不透明凭证、绑定领取者约束、验证消费、到期、撤回、退款与完整审计。

## 不负责什么

不主动联系陌生用户，不把深链当身份本身，不暴露金额/订单/隐私，不实现红包份额算法。

## 用户流程

付款人创建定向领取并分享 Bot 深链。收款人点击启动 Bot，系统幂等创建或解析 UID，校验令牌摘要、期限、状态和领取者约束，成功后过账。未领取可按规则撤回或到期退回。

## 核心实体

Claim、ClaimTokenDigest、ClaimantConstraint、ReservationRef、ClaimAttempt、ExpiryJob、RefundReference。

## 状态机

CREATED、FUNDS_RESERVED、CLAIMABLE、CLAIMED、REVOKED、EXPIRED、REFUNDED。CLAIMED 与退款终态互斥；过期检测和领取并发只能一方成功。

## 输入

付款 UID、资产、金额、领取者约束、过期策略、随机令牌、start 参数和领取 UID。

## 输出

深链、领取状态、账本命令、退款任务、账单和事件。

## 公开接口或事件

CreateClaim、ResolveClaimToken、ConsumeClaim、RevokeClaim、ExpireClaim；ClaimReserved、Claimed、ClaimRefunded。

## 依赖方向

依赖 identity、ledger、account-security、fees-and-risk、Telegram 深链能力和持久任务；red-packets 可复用其凭证消费能力但保留份额所有权。

## 资金影响

创建时付款可用转领取冻结负债；成功转领取人可用；撤回/过期转回付款人。所有转换使用账本。

## 幂等要求

令牌高熵且只保存安全摘要；消费使用唯一约束/条件更新；重复 start、并发领取、任务重试都只产生一个终态。

## 安全要求

令牌最多适配 Telegram start 长度，不含连续主键、明文金额、内部订单号或隐私；防猜测、防重放、常量时间比较和速率限制。

## 审计要求

记录创建、分享渠道类型、尝试摘要、领取 UID、约束判定、过期/撤回和账本引用；不记录原始令牌。

## 测试重点

令牌猜测、重复消费、领取/过期竞态、错误领取者、注册并发、撤回、退款重试和深链长度。

## 需求状态

领取安全模型 APPROVED；过期时长与领取密码门槛 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

账本预留、Telegram 深链、身份幂等和持久任务必须 READY；当前开发授权为 0。

## 待确认问题

是否领取前强制支付密码见 [P0 第 10 项](../product/open-decisions.md)。

