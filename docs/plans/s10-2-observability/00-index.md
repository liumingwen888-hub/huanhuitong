# S10-2 完整观测 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（观测层，无业务逻辑变更）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S10-2 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 10 总体规划 v1.0](../2026-08-19-stage-10-production-master-plan.md)（决策 2）、[platform-operations 领域](../../domains/platform-operations.md)（指标/日志/追踪）、[既有遥测骨架](../../../apps/platform/src/infrastructure/telemetry/create-platform-telemetry.ts)（S1 已交付：span 启停 + OTLP 可选导出 + 关闭协议）。

## 目标

观测三支柱的**指标与日志补全**：资金域计数器/直方图、安全日志事件扩充、告警规则定义——生产排障的"看得见"能力。

## 关键设计

### 1. 指标注册表（MetricsRegistry——纯接口 + 日志导出实现）

```ts
MetricsPort {
  incrementCounter(name: MetricName, attributes?: MetricAttributes): void;
  recordHistogram(name: HistogramName, value: number, attributes?): void;
}
```
- **MetricName（封闭枚举）**：`ledger_posting_total`、`ledger_posting_rejected_total`、`withdrawal_requested_total`、`withdrawal_settled_total`、`exchange_settled_total`、`payout_submitted_total`、`payout_succeeded_total`、`outbox_enqueued_total`、`outbox_delivered_total`、`inbox_duplicate_total`、`admin_auth_failed_total`、`admin_api_denied_total`；
- **HistogramName**：`ledger_posting_duration_ms`、`api_request_duration_ms`；
- 合成实现：**LoggingMetrics**（计数聚合计入结构化日志，每 60 秒或关闭时冲刷——无 OTLP 依赖的可观测下限）；生产实现：OTel Metrics API（同一接口换底）。
- **插桩原则**：只在服务层边界调用（六域服务的成功/拒绝路径），**不渗透域内**——架构巡航守护。

### 2. 安全日志事件扩充（SafeLogEvent 增补）
新增：`ledger_posting_rejected`、`withdrawal_broadcast_unknown`、`payout_provider_unavailable`、`backup_completed`、`backup_failed`、`restore_validated`、`release_gate_passed`、`release_gate_blocked`——运维排障的最低事件面。每项进 logging-policy 白名单（required 字段定义）。

### 3. 告警规则定义（声明式文档——非运行时引擎）
`deploy/alert-rules.yml`：规则名/指标/阈值/严重级/描述——生产接 Prometheus/Grafana 时直接翻译；合成期由 release:gate（S10-6）校验格式完备性。示例：`ledger_posting_rejected_total > 0 for 5m`（P0）、`admin_auth_failed_total > 20 for 10m`（P1）。

## 冻结未来工程矩阵

Create：`packages/contracts/src/observability.ts` 增补（MetricName/HistogramName/MetricsPort）、`apps/platform/src/infrastructure/telemetry/logging-metrics.ts`、`apps/platform/src/infrastructure/telemetry/compose-metrics.ts`（LoggingMetrics 组装器）、`deploy/alert-rules.yml`、`apps/platform/test/unit/logging-metrics.spec.ts`（S10OB）。Modify：六域服务构造函数增可选 metrics 注入（默认 no-op 保持既有测试不动）+ 关键路径插桩、logging-policy 白名单。

## 测试矩阵（S10OB，单元）

- S10OB01 计数器累加与冲刷：increment → flush 输出包含正确名称与计数
- S10OB02 属性传递：attributes 原样出现在日志行
- S10OB03 直方图：record → flush 输出 count/sum/min/max
- S10OB04 插桩覆盖：六域服务的成功与拒绝路径至少各调用一次 metrics（源码静态扫描 `metrics.incrementCounter` 出现于各服务文件）
- S10OB05 告警规则格式：yml 每条含 name/metric/threshold/severity/description 五字段
- S10OB06 日志白名单完备：新 SafeLogEvent 均在 logging-policy 有条目

## 边界与不做

- 不做 OTLP metrics 真实导出（生产实现同接口换底，届时独立授权）；不做仪表盘（Grafana 生产）；不做分布式追踪传播（既有 span 够用）。

## 停止条件

指标名开放集合（绕过封闭枚举）、插桩渗透域内部件、日志事件带敏感字段。
