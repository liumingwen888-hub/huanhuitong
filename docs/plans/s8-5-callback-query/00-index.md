# S8-5 回调接收与 UNKNOWN 查询 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（外部输入信任边界）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S8-5 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 8 总体规划 v1.0](../2026-08-19-stage-8-fiat-payout-master-plan.md)（S8-5 任务行 + 决策 4/5）、[法币代付领域](../../domains/fiat-payouts.md)（回调验真、"回调不单独视为绝对事实"、CallbackInbox 实体、查询优先）。

## 目标

供应商回调的可信接收与 UNKNOWN 的查询裁决：**HMAC 验真端口（验真失败永久拒绝、零写入）→ 载荷解析 → CallbackInbox 去重 → 状态映射（SUCCEEDED 排入结算队列 / FAILED 入释放）**；**QueryPayout 查询优先**（回调缺失/不确定时主动查询，绝不推断）。

## 关键设计

### 1. HMAC 验真端口（决策 4）
```ts
CallbackSignaturePort { verify({providerId, secretRef, payload, signature}): Promise<boolean> }
```
- secretRef 来自 provider_configs（`vault:` 引用）；**密钥本体永不出现在请求处理路径**——生产实现经 VaultPort 解析，端口输入只有引用。
- **FakeHmacVerifier 做真实 HMAC-SHA256 运算**（node:crypto，按 secretRef 配置测试密钥）——测试自行签名，验真契约真实可测，非"总是通过"的假 Fake。

### 2. V13 `callback_inbox`（须显式授权）
- `callback_id uuid PK`；`(provider_id, provider_event_id) UNIQUE`——**回调事件去重的数据库锚**；
- `provider_idempotency_key text`（关联订单）、`reported_status CHECK(IN ('SUCCEEDED','FAILED','REVERSED'))`、`received_at`；
- 只增不改（平台 SELECT+INSERT；worker 只读）——回调是外部事实流，审计不可篡改。

### 3. 状态映射（回调不单独视为绝对事实）
| 回调/查询结果 | 动作 |
|---|---|
| SUCCEEDED | **不改订单终态**（SUCCEEDED 需结算过账，V12 CHECK）→ Outbox `payout.settlement-pending.v1`（内部队列，S8-6 消费结算） |
| FAILED | markFailed CAS（前态 SUBMITTING/ACCEPTED/UNKNOWN）→ S8-6 释放 |
| REVERSED | `payout.reversal-pending.v1`（S8-6 冲正） |
| 验真失败/载荷畸形/未知供应商 | 永久拒绝（错误返回），零写入 |
| 事件重放（同 eventId） | `PAYOUT_CALLBACK_REPLAY`，零副作用 |

### 4. QueryPayout（查询优先，决策 5）
- 前态门：SUBMITTING/ACCEPTED/UNKNOWN；
- `provider.query(providerIdempotencyKey)` → SUCCEEDED/FAILED/REVERSED 同回调映射；**UNKNOWN → `PAYOUT_UNKNOWN_PENDING_QUERY` 零写入**——绝不推断失败、绝不自动重付。

## 冻结未来工程矩阵

Create：`fiatpayout/domain/{callback-signature.port.ts, fake-hmac.verifier.ts}`、`fiatpayout/application/{payout-callback.service.ts, payout-query.service.ts}`、`fiatpayout/application/callback-inbox.repository.ts` + `infrastructure/postgres-callback-inbox.repository.ts`、`database/migrations/V13__stage_8_callback_inbox.sql`、`apps/platform/test/database/payout-callback.integration.spec.ts`（S8CB）。Modify：contracts/fiat-payouts.ts（回调输入/结果类型）、payout 仓储（无需新 CAS——复用 markFailed）。

## 测试矩阵（S8CB）

- S8CB01 合法签名 SUCCEEDED 回调：inbox 落档 + settlement-pending 事件 + 订单保持 ACCEPTED
- S8CB02 错误签名：永久拒绝零写入（inbox/订单/outbox 三零断言）
- S8CB03 同 eventId 重放：REPLAY 拒绝零副作用
- S8CB04 FAILED 回调：订单 FAILED + 原因
- S8CB05 畸形载荷/未知供应商：拒绝零写入
- S8CB06 查询优先：query SUCCEEDED → settlement-pending；query UNKNOWN → 零写入 PENDING_QUERY；非法前态拒绝
- S8CB07 HMAC Fake 真实性：同载荷不同密钥签名互不通过

## 边界与不做

- 不做结算/释放/冲正过账（S8-6 消费队列）；不做真实回调 HTTP 端点（生产 HTTP 层）；不做 REVERSED 的具体冲正（S8-6）。

## 停止条件

验真失败出现任何状态写入、密钥本体进入服务路径、回调被单独当作终态事实。
