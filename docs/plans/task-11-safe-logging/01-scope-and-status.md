# 范围与状态

[返回索引](00-index.md)

## 目标

1. `SafeLogEvent` 扩展 `telegram_webhook_processed` / `telegram_webhook_rejected`；`SafeLogContext` 扩展 `update_id`/`uid`/`telegram_user_ref`/`inbox_id`/`outbox_id` 与 route/outcome 枚举值（contracts Modify）。
2. logging-policy 六事件 matrix 扩至八事件；值级防御（类型白名单 string|number、长度上限、控制字符拒绝、嵌套对象/数组/错误对象拒绝）；任何违规 → `SafeLoggingError`，destination 零写入（含部分写入禁止）。
3. `telegram-user-reference.ts`：`toTelegramUserReference(id): Promise<string>`——版本化独立密钥 HMAC 伪名（`tgur-v1:<43-char-base64url>`），密钥与 Inbox digest keyring 分离、独立轮换；无盐哈希禁止。
4. platform/worker logger Modify：接入扩展 policy；Pino redact 已知敏感键作第二层；trace attribute 同一 allowlist。
5. 双 security spec 证明：批准字段单行 JSON 输出；Secret/Token/完整 Update/canonical bytes/正文/callback/摘要 key material 零出现；伪名可审计关联且不可逆。

## 当前状态

- 第 20/48 步 `COMPLETED / EXTERNAL REVIEW PASS`；Tasks 1–10 VERIFIED。
- 第 21/48 步 `IN_PROGRESS`；本计划 `READY v1.0 / WAITING_EXTERNAL_REVIEW`；Task 11 代码 `NOT_STARTED`；第 22/48 步 `NOT_STARTED`。

## 明确排除

- SecretResolver/keyring 实现修改；业务身份/资金模块；migration；真实外部服务。
- Pino 依赖升级、trace exporter 连接（阶段 10）。

## 失败场景（必须测试）

允许字段名装入 Secret 仍被记录；事件名含控制字符/超长；嵌套对象/数组/错误对象穿透；完整 Update/canonical bytes/正文/callback 入日志或 span attribute；Bot Token/DB 凭证/logger HMAC key/Inbox digest key 相同；旧伪名无法审计关联；无盐哈希被引入。
