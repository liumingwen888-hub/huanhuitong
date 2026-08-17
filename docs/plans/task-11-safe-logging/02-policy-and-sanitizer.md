# 白名单与值级防御合同

[返回索引](00-index.md)

## 事件 policy matrix（八事件）

| 事件 | required | optional | route |
|---|---|---|---|
| app_configuration_loaded | — | duration_ms | configuration |
| app_configuration_rejected | error_category | correlation_id | configuration |
| telemetry_disabled | — | — | telemetry |
| telemetry_configured | — | duration_ms | telemetry |
| process_started | — | — | bootstrap |
| process_stopped | — | duration_ms | bootstrap |
| telegram_webhook_processed | correlation_id, update_id, route, outcome | uid, telegram_user_ref, inbox_id, outbox_id, duration_ms | telegram.start |
| telegram_webhook_rejected | correlation_id?, error_category, route, outcome | update_id, inbox_id, retry_count | telegram.start |

（以总计划 Step 3 原文 matrix 为权威，本表为摘要；outcome/route 枚举按 contracts。）

## 值级防御（在事件/键白名单之后）

1. context 必须是 own-property plain object；Proxy/accessor 拒绝。
2. 值类型仅 `string | number`（finite）；其余（对象/数组/Error/undefined/null/symbol）→ `VALUE_TYPE_NOT_ALLOWED`。
3. string 长度 ≤ 200；含 C0/C1 控制字符 → `CONTROL_CHARACTER`。
4. 键不在该事件 policy → `UNKNOWN_FIELD`；required 缺失 → `REQUIRED_FIELD_MISSING`；事件与 route/outcome 组合不符 → `EVENT_POLICY_MISMATCH`。
5. **双层控制**：logging-policy 抛 `SafeLoggingError` 时，Pino 层从未收到调用——destination 零字节；Pino redact 仅作为第二层兜底已知名（redact 失效不放宽第一层）。

## trace attribute

`TelemetryHandle.startSpan` 不新增 attribute API（阶段 1 无 attribute 通道）；本 Task 断言：现有 span 接口没有把日志 context 透传为 attribute 的路径（静态检查），杜绝隐性第二出口。
