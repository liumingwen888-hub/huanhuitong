# 测试矩阵

[返回索引](00-index.md)

编号 T11C01 起连续唯一；双 spec 属 unit 项目 security glob。

## platform（sensitive-logging.spec.ts）

| ID | 合同 |
|---|---|
| T11C01 | telegram_webhook_processed 只输出批准字段、单行 JSON（总计划 Step 1 原文） |
| T11C02 | 未知事件/未知字段/Secret 值 → SafeLoggingError，destination 零新增字节 |
| T11C03 | 完整合成 Update/canonical bytes/正文/callback 值 → 拒绝且零出现 |
| T11C04 | 嵌套对象/数组/Error 对象 → VALUE_TYPE_NOT_ALLOWED / NESTED_VALUE |
| T11C05 | 事件名超长/控制字符；字符串值超长/控制字符 → 拒绝 |
| T11C06 | 事件-route/outcome 组合不符 → EVENT_POLICY_MISMATCH，零写入 |

## worker（sensitive-logging.spec.ts）

| ID | 合同 |
|---|---|
| T11C11 | telegram_webhook_rejected 合法记录输出（Step 1 原文） |
| T11C12 | required 缺失/错误对象作 error_category → SafeLoggingError，output 与已接受部分完全一致 |
| T11C13 | 'synthetic-secret' 等哨兵在全部输出 0 命中 |

## 双侧共同（任一 spec）

| ID | 合同 |
|---|---|
| T11C14 | toTelegramUserReference 确定伪名 tgur-v1 格式；不同 id 不同伪名 |
| T11C15 | logger HMAC 密钥与 Inbox digest keyring 材料分离（字节不等、无共享引用） |
| T11C16 | 全源码路径搜索：bot_token/secret_token/raw update/canonical bytes 无日志语句引用（静态断言） |
