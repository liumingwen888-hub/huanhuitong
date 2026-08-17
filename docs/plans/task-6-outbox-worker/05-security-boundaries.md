# 安全与敏感数据边界

[返回索引](00-index.md)

## payload 边界

`OutboxEnvelopeV1.payload` 入队前经白名单检查，禁止包含：

- 完整 Telegram Update、canonical bytes、payload digest（Task 5 边界延续）。
- Bot Token、`secret_token`、任何 SecretReference 值、数据库凭证。
- 消息正文、callback 原始载荷、手机号、支付密码、TOTP。
- 检查方式与 Task 2/5 一致：own data-property 递归扫描 + 固定字符串哨兵 allowlist；Proxy/ accessor 在观察前拒绝。

## 日志与可观测性

- worker 日志只允许白名单汇总字段（workerId、runOnce 计数、topic 名、稳定错误码）。
- 逐条消息内容、payload、leaseToken 不入日志；leaseToken 泄露会让其他主体伪造确认。
- 错误对象不序列化进日志/trace/审计；只记录分类与稳定错误码。
- 违反白名单 → `SafeLoggingError`，destination 零写入（Task 2 合同）。

## SQL 与事务边界

- 全部 SQL 经 Task 4 `TransactionContext` callback 通道（单语句扫描、extended 模式、无多语句）。
- worker 不获取 platform 角色凭证；platform 不获取 worker UPDATE 能力（角色矩阵见 02）。
- 确认/续租 SQL 的 CAS 谓词不得拼接字符串值，一律参数化。

## 崩溃与 UNKNOWN

- `markSucceeded` 提交返回 UNKNOWN（Task 4 UNKNOWN 分类）时，不得自动重试确认或重投判定；按 at-least-once 语义等待租约到期路径自然收敛，并记录 UNKNOWN 事件供审计。
