# 产品范围

需求状态：APPROVED。交付状态：DESIGNING。

## 第一阶段范围

第一阶段规划包含 Telegram 自动注册、用户账户、资产余额、充值、提现、内部转账、非会员领取、单人红包、多人等额红包、多人随机红包、换汇/闪兑、法币代付、账单、个人中心、支付密码、账户安全、Language、客服入口、费用、风控、管理后台、审批与审计、对账、监控、备份与恢复。各能力的权威归属见 [功能目录](feature-catalog.md) 和 [领域索引](../domains/README.md)。

当前不使用 Telegram Mini App。Telegram Bot、未来 App 和管理后台是适配层，不承载领域规则或直接修改余额。

## 当前交付范围

阶段 0 的规则、产品基线、架构、领域边界、威胁与门禁、测试运维策略、路线图和 AI 交接索引已经 VERIFIED。阶段 1 当前处于 BUILDING：Tasks 1–4 的工程骨架、配置/日志/Telemetry 基础、PostgreSQL/Kysely/Flyway/Testcontainers 数据库底座，以及 Unit of Work/PostgreSQL 事务边界已经 IMPLEMENTED / VERIFIED；Task 5 详细计划为 READY v1.3 / WAITING_EXTERNAL_REVIEW，代码 NOT_STARTED，第 10/48 步 NOT_STARTED。

Telegram 业务接线、身份与注册、Outbox worker、资金领域、真实供应商、共享/生产数据库和部署尚未实施。当前准确状态和唯一下一步分别以 [current](../status/current.md) 与 [next](../status/next.md) 为准。

## 未来范围

Android 与 iOS 原生 App、手机充值供应商、商户能力和理财产品为 LATER。当前只定义边界，不创建菜单、API、数据库表、依赖或空实现。App 必须复用平台 UID、账本与策略；手机充值和商户能力通过未来适配接口评审。理财在收益来源、赎回规则、风险承担和法律边界确认前不得进入实施。

## 明确非目标

- 不把 Telegram user.id 或 username 作为账本账户主键或资产所有权凭证。
- 不自动合并已有 UID 或余额。
- 不让客服或后台直接修改余额、账本或绕过恢复流程。
- 不因交易对出现在产品目录就推定托管、充提网络、流动性或结算方式已确定。
- 不在未取得真实契约时虚构国家、供应商字段、费率、限额、SLA 或回调。
- 不提前拆分大量微服务，也不把 Redis 或消息队列当作资金事实来源。

生产上线还必须满足法律主体、运营国家、牌照、KYC、AML、制裁筛查和交易监控门禁；这些可以延后选型，不能被删除。
