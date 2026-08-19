# S7-5 失败/过期/UNKNOWN 处理 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（资金释放路径）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过）。S7-5 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 7 总体规划 v1.0](../2026-08-19-stage-7-exchange-master-plan.md)（S7-5 任务行）、[换汇领域](../../domains/exchange.md)（过期/失败释放、UNKNOWN 保持冻结并查询）、[S6-6 先例](../s6-6-settlement-release/00-index.md)（两步释放：决策态→REFUNDED）。

## 目标

换汇生命周期的收尾路径：**报价惰性过期清扫**、**订单失败/过期两步释放**、**挂单超时扫描**；UNKNOWN 原则在合成期的落地形态明确。

## 关键设计

### 1. 新增 `exchangeReleased` 模板（Create，非 Modify）
- `DR 卖冻结 sellAmount / CR 卖可用 sellAmount`——冻结释放（与 withdrawalFailed 同型）；
- 幂等键 `EXCHANGE:{orderRef}:RELEASE:0`——与 FREEZE/SETTLE 动作互斥。

### 2. 两步释放（决策与资金分离，S6-6 同型）
- `markFailed`（FUNDS_RESERVED|EXECUTING → FAILED + failure_reason 必填）——运营/风控决策入口；
- `markExpired`（FUNDS_RESERVED|EXECUTING → EXPIRED）——超时扫描入口；
- `release`（FAILED|EXPIRED → REFUNDED + settlement_ledger_transaction_id = 释放过账）——资金动作，通知 `telegram.exchange-refunded.v1`。

### 3. 挂单超时（fail-closed 反向）
- TTL 来源：ConfigStore `exchange.execution` payload `settleTtlSeconds`（正整数）；**无配置不扫描不过期**（误杀进行中换汇比挂起更危险——过期是资金动作，与提现审批 TTL 同型裁决）。
- `findExpirable`：FUNDS_RESERVED/EXECUTING 且 created_at < now−TTL。

### 4. 报价惰性过期清扫
- `expireElapsedQuotes(limit)`：`UPDATE quotes SET status='EXPIRED' WHERE status='ACTIVE' AND expires_at <= now()`——无需配置（expires_at 是每报价事实）；S7-3 的消费 CAS 已挡过期确认，清扫只为可观测性与统计。

### 5. UNKNOWN 原则（合成期形态）
- 合成执行是内部确定性过账：结算失败即抛错、订单停留 EXECUTING 可重试（S7-4 已落地）——**绝不自动失败、绝不自动释放**；
- 真实上游执行（生产）的 UNKNOWN 查询义务届时落地；本任务的 `fail` 是唯一人工失败入口（带 reason）。

## 冻结未来工程矩阵

Create：`modules/exchange/application/exchange-lifecycle.service.ts`、`apps/platform/test/database/exchange-lifecycle.integration.spec.ts`（S7XR）。Modify：`posting-templates.ts`（增 exchangeReleased + 导出）、`exchange-order.repository.ts` + Postgres（markFailed/markExpired/markRefunded/findExpirable）、`quote.repository.ts` + Postgres（expireElapsed）。

## 测试矩阵（S7XR）

- S7XR01 fail→release：FAILED 带 reason → REFUNDED，卖冻结全额回可用，RELEASE 单笔，通知一条
- S7XR02 EXECUTING（崩溃卡单）可释放；释放后结算被拒
- S7XR03 SETTLED 不可释放不可失败
- S7XR04 超时扫描：配置 TTL + 回填 created_at → 仅超时单 EXPIRED；无配置 SKIPPED 零动作
- S7XR05 报价清扫：已过 ACTIVE → EXPIRED；未过期/已消费不动
- S7XR06 释放幂等：REFUNDED 再释放/再失败 → 拒绝（INVALID），账本仍单笔

## 边界与不做

- 不做自动失败判定（仅人工 reason 入口与超时扫描）；不做真实上游 UNKNOWN 查询（生产）；不做对账（S7-6）。

## 实施裁决记录（2026-08-19）

1. 报价清扫用 `FOR UPDATE SKIP LOCKED` 子查询限批量——多实例并发清扫安全。
2. release 幂等语义与提现不同：REFUNDED 后再调用返回 DENIED（非法状态）而非幂等成功——释放的唯一性由 RELEASE 模板键 + CAS + 状态门三层保证，重复调用属调用方错误。

## 实施验证（2026-08-19，macOS/arm64 本本）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（173 模块、195 依赖）。
- unit 30 文件 238/238 PASS。
- S7XR01–S7XR06 全 PASS：fail→release 全额回可用 + 单笔 RELEASE + 通知一条；EXECUTING 卡单可释放且释放后结算被拒；SETTLED 不可失败不可释放零过账；超时扫描仅命中配置 TTL 内超时单（无配置 SKIPPED 零动作）；报价清扫仅过期 ACTIVE（未过期/已消费不动）；空 reason 拒绝 + REFUNDED 后重复释放/失败均拒 + 账本仍单笔。
- 数据库回归 468/471（M06/M14/M16 已知环境边界项）；integration 97/97。
- 交付物：exchangeReleased 模板、订单仓储四 CAS + findExpirable、报价仓储 expireElapsed（SKIP LOCKED）、ExchangeLifecycleService、S7XR 集成规格。

## 停止条件

释放与结算可并存（动作互斥被破坏）、TTL 无配置时出现任何过期写入。
