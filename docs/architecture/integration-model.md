# 集成模型

需求状态：APPROVED。交付状态：DESIGNING。

## 通用适配合同

每个外部集成由领域无关的传输适配器和领域内的防腐层组成。合同必须版本化，区分请求 ID、业务幂等键、上游 ID、状态、原始时间、接收时间和可安全记录的摘要。原始载荷按隐私和审计政策受控保存，不直接驱动资金写入。

## Telegram

grammY Webhook 负责 Update 解析、会话路由和消息适配。Update ID/业务键进入 Inbox 去重；回复与通知走 Outbox。领取使用不透明 start 参数；用户选择能力只能提供候选身份，付款前仍需平台绑定校验和收款人确认。官方能力边界见 [telegram-feasibility.md](../research/telegram-feasibility.md)。

## 区块链

链适配器定义地址校验、交易观察、确认策略、签名请求、广播、交易查询和重组事件。资产与网络显式配对，不以币种名称猜网络。Scanner、Signer、Broadcaster、Confirmation Worker 权限分离；广播返回不确定时只查询，不自动构造替代支付。

## 法币代付

供应商适配器提供能力查询、报价、建单、查单、回调验真、余额、健康、熔断和对账。统一状态至少包含 CREATED、FUNDS_RESERVED、SUBMITTING、ACCEPTED、PROCESSING、SUCCEEDED、FAILED、UNKNOWN、MANUAL_REVIEW、REVERSED。只有经合同映射和可证明的最终状态才能释放或结算资金。

## 可靠性

外部入站使用 Inbox，出站使用 Outbox 和持久任务；重试采用退避、上限、可观测错误类别和同一幂等键。熔断只停止新请求，不改写在途结果。没有真实合同前不定义国家、字段、费率、限额、SLA 或回调格式。

