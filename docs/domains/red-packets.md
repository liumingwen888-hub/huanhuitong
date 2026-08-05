# 红包领域

## 目标

支持单人、多人等额和多人随机红包，并保证总额守恒、并发领取安全和到期退款。

## 职责

创建红包、计算/固化份额策略、预留总额、发放领取凭证、限制领取次数、结算份额、到期关闭与退款。

## 不负责什么

不直接修改余额，不提供通用身份恢复，不让客户端决定随机结果，不主动联系陌生用户。

## 用户流程

发送者选择红包类型、资产、总额、份数和期限，完成支付授权后预留资金并取得分享链接。领取人启动 Bot 后验证资格并原子领取一份；全部领完关闭，超时后剩余退回。

## 核心实体

RedPacket、AllocationPolicy、RedPacketShare、ParticipantConstraint、ClaimReference、ExpiryReference、RefundReference。

## 状态机

CREATED、FUNDS_RESERVED、OPEN、EXHAUSTED、EXPIRED、REVOKED、REFUNDED。Share：AVAILABLE、RESERVED、CLAIMED、RELEASED。终态转换必须与账本一致。

## 输入

发送 UID、类型、资产、总额、份数、期限、领取约束、费用和支付授权。

## 输出

分享链接、份额结果、剩余数量、账本交易、账单和事件。

## 公开接口或事件

CreateRedPacket、OpenRedPacket、ClaimShare、ExpireRedPacket；RedPacketOpened、ShareClaimed、RedPacketClosed、RemainderRefunded。

## 依赖方向

依赖 identity、account-security、claims 的安全凭证机制、ledger、fees-and-risk 和持久任务。随机算法不依赖 Telegram 客户端。

## 资金影响

总额先转冻结负债；每份领取转接收人可用；手续费、已领和剩余严格分离；剩余退款使用新账本交易。

## 幂等要求

每 UID/红包按规则最多成功一次；同一份额唯一领取；并发最后一份、到期与领取竞态原子解决。总份额最小单位之和必须等于可分配总额。

## 安全要求

服务端安全随机源；禁止客户端预测或指定随机序列；领取凭证高熵、限速、防重放，展示信息最小化。

## 审计要求

记录策略版本、随机分配结果承诺/摘要、领取顺序、份额、退款和账本引用，不记录原始令牌。

## 测试重点

金额守恒、随机边界、最小单位、并发领取、重复 UID、到期竞态、退款和大份数性能。

## 需求状态

三类红包 APPROVED；份数、期限、费率和随机分布细则 DRAFT。

## 交付状态

NOT_STARTED。

## 开发门禁

领取、账本、支付密码和属性测试策略必须 READY；当前开发授权为 0。

## 待确认问题

低风险领取是否要求支付密码由 [P0 第 10 项](../product/open-decisions.md) 决定；没有新增 P0。

