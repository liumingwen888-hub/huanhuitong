# 信任边界

需求状态：APPROVED。交付状态：DESIGNING。

## 边界

- Telegram → platform：所有 Update 不可信；验证 Webhook secret token、请求大小、结构、Update 幂等和业务会话绑定。
- 终端用户/Telegram → 专用凭证组件：支付密码原文在 Telegram 客户端和基础设施中短暂经过；Bot 适配器只把一次性输入动作交给专用凭证组件，组件仅在短期内存中组合、哈希或验证并立即清除。
- 专用凭证组件 → 资金用例：用户身份不等于资金授权；资金用例只接收绑定 UID、订单、操作、金额/资产摘要和期限的短期支付授权证明或引用，不接收密码原文或哈希。
- admin-web → 管理 API：浏览器不可信；服务端执行独立管理员认证、RBAC、数据范围、字段权限、重新认证和 CSRF/会话控制。
- platform/worker → signer：普通业务进程不得接触私钥；签名请求必须最小化、已批准、可追踪且防重放。
- worker → 链节点：单一节点响应不自动等于最终事实；按网络确认、重组与多源策略处理。
- 平台 → 法币供应商：请求和回调均可能超时、重复、伪造或乱序；采用签名验真、Inbox、主动查询和对账。
- 应用 → PostgreSQL：应用只能通过所属模块仓储和账本接口访问；管理界面无数据库凭证。
- 备份 → 恢复环境：备份加密、访问隔离；恢复后先处于外部副作用暂停状态，完成时间点与资金对账后才恢复任务。

## 敏感信息

支付密码原文只允许在输入时短暂存在于 Telegram 客户端、以输入动作通过 Bot 通道，并在专用凭证组件短期内存中组合和验证。原文不得持久保存，不得进入数据库、缓存、日志、追踪、错误信息、普通审计、Outbox/Inbox 正文、客服/管理后台或任何资金领域，也不得在消息中回显。原始 callback_query 不记录；密码相关 Update 只允许字段白名单日志。

私钥、Bot Token、TOTP 密钥、恢复凭证、供应商密钥和数据库凭证不得进入客户端、日志、普通审计或文档。审计只存操作元数据与脱敏摘要。Telegram 通道不是端到端加密的独立安全设备；Telegram 账号或客户端被接管时，支付密码仍提供知识因子，但高风险提现、敏感安全变更和账号恢复需要按现有 P0 决策叠加 TOTP 或未来 App 强认证。密钥轮换、吊销和访问证明是生产门禁。

## 默认失败

验真失败、权限不明、状态未知、幂等冲突、账本不平或恢复时间点不确定时默认拒绝或暂停外部副作用，不返回伪成功。

阶段 1 v1.2.2 计划还要求：合法但暂不支持的 Telegram Update 以 200 ignored 结束，只有畸形最小 envelope 返回 400；反向代理仅允许固定 hop 或受信 CIDR，伪造 `X-Forwarded-Proto` 不能绕过 HTTPS。HTTP 适配器把完整 parsed Update 直接交给 Task 5 `digestTelegramUpdate(update, keyring)`；canonicalization、HMAC 与临时 bytes 生命周期完全封装在 Task 5，同步返回后 raw object、bytes、正文和 callback 不跨越至身份、Outbox、日志、trace 或审计。current/retained Inbox digest key 与 logger HMAC、Bot Token、Webhook Secret、支付密码密钥和数据库凭证分离，旧 key 至少保留 Inbox 保留期加 Telegram 重试窗口。日志只接受允许事件名和标量字段，并做值、长度、控制字符和嵌套对象检查；可关联 Telegram 标识用独立版本化 HMAC 伪名或直接省略。

Task 3 v1.5 已实现并验证数据库边界：真实 client 只有在 `session_user`、固定 `SET ROLE` 与 `current_user` 全部通过后才交给 Kysely；取得 client 后的五类失败均销毁释放一次。真实 Kysely 只在 factory 闭包；公开 runtime facade 及其 plugin/schema 链没有关闭或 connection 逃逸能力。三个测试 LOGIN 只有 CONNECT 与唯一 SET-only 成员资格；Flyway 在 JDBC 连接建立时切换 `xht_flyway` 并保留 callback 二次证明，platform/worker 在 pool wrapper 内切换自己的 NOLOGIN 角色。Flyway telemetry、双阶段 raw 日志限制、严格 parser、三路 Secret 扫描、非零退出 inspect 和唯一 owner 清理均由 scenario 01–24 与真实容器验证；公开错误未携带底层正文或 Secret。该证据只覆盖本地隔离数据库，不授权共享/生产凭据或迁移。

## 阶段 1 实施事实（2026-08-17）

已实证边界：Webhook HTTPS/代理信任/Secret(constant-time)/content-type/256KiB/envelope 五道门禁；Inbox 零 raw Update 持久化（information_schema 实证）；日志白名单零敏感值（SafeLoggingError 零写入）；tgur-v1 独立密钥 HMAC 伪名；架构依赖门禁四规则（depcruise，0 违规）。
