# 可观测性

需求状态：APPROVED。交付状态：DESIGNING。

使用 Pino 结构化日志和 OpenTelemetry 指标、追踪。所有信号关联 request_id、trace_id、UID 的不可逆摘要、业务订单 ID、资金命令 ID、任务 ID 和外部关联 ID；不得记录密码、验证码、令牌、私钥、Secret、完整收款信息或原始领取凭证。

## 核心指标

- Webhook 验真失败、重复 Update、会话过期和回调重放。
- 账本拒绝、借贷不平（应为零）、负余额尝试、余额投影滞后。
- Outbox/Inbox 延迟、任务重试、死信、租约过期。
- 链扫描高度、确认滞后、节点分歧、重组和 UNKNOWN 提现。
- 供应商提交/回调/查询延迟、UNKNOWN、重复与余额阈值。
- 对账差异、备份年龄、恢复演练结果和发布门禁。

## 告警原则

告警必须可行动、分级、去重并链接运行手册。高风险告警可以暂停新订单或外部副作用，不能自动改账本。具体阈值和轮值为 DRAFT，在容量和供应商 SLA 有证据后确定。

追踪跨 platform、worker 和 signer 传播但只传最小上下文。审计与日志分离：日志可轮转删除，追加式审计按政策保留。

## 阶段 1 v1.2.6 Task 2 已实现基础

配置先选择八个已知应用键，再对投影执行 Zod strict；普通配置只保存 SecretReference，SecretResolver 单独解析。六事件 policy 为：`app_configuration_loaded`=configuration/success，`app_configuration_rejected`=configuration/rejected，`telemetry_disabled`=telemetry/disabled，`telemetry_configured`=telemetry/configured，`process_started`=bootstrap/success，`process_stopped`=bootstrap/stopped。每项的 route/outcome 必填；rejected 还必填 error_category；correlation_id 和部分 duration_ms 仅按事件可选。

允许字段只有 `correlation_id`、`route`、`outcome`、`error_category`、`duration_ms`。correlation_id 必须匹配 `corr_` 加 1–59 个安全字符；字符串最长 128 且无 C0/C1 控制字符；duration_ms 为 0–600000 的有限整数；route、outcome 和 error_category 只接受合同字面值。unknown、缺失、错配、getter、symbol、nested、数组、Error、bytes、boolean、null、undefined、超长和非法数字在进入 Pino 前抛稳定 `SafeLoggingError`，整条 destination 写入 0。platform/worker destination 均由调用方注入；Task 11 未来才扩展 Telegram 事件和字段。

OpenTelemetry disabled 模式不调用 exporter factory 或网络 API；otlp 只允许注入 factory。register/shutdown 的任意原始异常正文、endpoint、header 或 Secret 不得越过边界，只返回稳定 `TelemetryConfigurationError` code。shutdown 第一次调用即关闭 `startSpan`，并在 exporter shutdown 真正开始前缓存每个 handle 唯一的 Promise；普通并发、同步重入和后续调用共享 pending/fulfilled/rejected 结果，registration shutdown 最多一次，失败持续为 `EXPORTER_SHUTDOWN_FAILED` 且不携带原始正文。Task 2 不实现真实 exporter，不连接 collector。

v1.2.6 聚焦的 platform/worker telemetry 已通过 2/2 文件、14/14；完整 unit 已通过 7/7、108/108。failed/skipped/only/retry 均为 0。disabled 模式 factory、registration 和五类网络 API 调用均保持 0；普通并发与同步重入都共享同一 Promise，成功/失败粘滞、shutdown 最多一次、关闭后 span 拒绝和原始异常正文零泄露均有直接测试及独立运行时证据。Task 2 不包含真实 exporter，collector 仍为 NOT_STARTED。

## 阶段 1 实施事实（2026-08-17）

已实施：八事件日志白名单（值级防御失败关闭、Pino redact 第二层）、tgur-v1 伪名、OTel 接口（disabled 默认零网络）。真实 collector/告警连接 NOT_STARTED（阶段 10）。
