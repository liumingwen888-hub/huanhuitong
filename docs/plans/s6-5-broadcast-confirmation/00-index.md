# S6-5 广播与确认监控 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（资金出站广播 + 双付窗口）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S6-5 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 6 总体规划 v1.0](../2026-08-17-stage-6-withdrawals-master-plan.md)（S6-5 任务行）、[提现领域](../../domains/withdrawals.md)（BroadcastAttempt 实体、UNKNOWN 禁止推断失败并重付）、[S4-6 广播端口](../../../apps/platform/src/modules/deposits/domain/transaction-broadcaster.port.ts)、[S6-4 签名](../s6-4-signer-isolation/00-index.md)（确定性 canonical request）。

## 目标

已签名提现的**广播编排**（SIGNING→BROADCAST + broadcast_txid 落库）与**确认监控**（BROADCAST 期的链上状态查询、确定失败迁移）。核心红线：广播结果 UNKNOWN 时**绝不推断失败、绝不自动重付**。

## 双付窗口分析（本计划的核心安全论证）

崩溃窗口：`broadcaster.broadcast()` 已在链上成功 → 进程崩溃 → `markBroadcast` 未执行 → 订单停留 SIGNING → 重试再广播。若两次广播产生**不同**交易，即双付。

**安全论证（三层）**：
1. S6-4 确定性签名：同订单重签产生**相同的** canonical request 与签名 → 相同的已签名交易；
2. 链上幂等：同一已签名交易的 txid 相同，重复提交被链拒绝/去重（真实链语义；合成栈由确定性 Fake 保证——`wd-{digest 前缀}` 派生 txid）；
3. CAS 收敛：`markBroadcast`（SIGNING→BROADCAST + txid）只可能成功一次。

推论：重试重放的是**同一笔**链上交易，双付不可能。S4 归集以 `SWEEP:{network}:{txid}` 作幂等键容忍先广播后记账；提现不接受该宽松度，改为上述确定性论证。

## 服务设计（WithdrawalBroadcastService）

### broadcast(withdrawalId)
1. 状态门：`SIGNING` 或 `APPROVED`（后者先经 S6-4 签名服务完成 CAS 迁移）；其他状态 → `WITHDRAWAL_INVALID_TRANSITION`，零调用。
2. 活跃策略 → 热钱包；`signingService.signForBroadcast`（幂等重签）。
3. `broadcasterPort.broadcast({ network, fromAddress: 热钱包, toAddress: 订单目标, amount: 订单金额, feeRate: 订单 feeAmount })`。
4. **成功** → `markBroadcast` CAS（落 broadcast_txid）→ Outbox `telegram.withdrawal-broadcast.v1`（受理，非成功承诺）→ 返回 `{outcome:'BROADCAST', txid}`。CAS 失败（并发）→ 重读快照幂等返回。
5. **抛错/超时（UNKNOWN）** → 返回 `{outcome:'UNKNOWN'}`：**不改状态、不 markFailed、不通知失败**；订单停留 SIGNING；重试安全（上述论证）。仅记录安全日志事件（无敏感字段）。

### checkOnChainStatus(withdrawalId)
1. 状态门：仅 `BROADCAST`；其他 → `WITHDRAWAL_INVALID_TRANSITION`。
2. `broadcasterPort.getStatus(network, broadcast_txid)`：
   - `PENDING`（确认数累积中）→ 返回 `{chainStatus:'PENDING'}`，状态不动；
   - `CONFIRMED`（端口语义 = 已满足该网络 confirmation_policies 确认数，策略由 S4 扫描器层执行）→ 返回 `{chainStatus:'CONFIRMED', readyForSettlement:true}`——结算动作属 S6-6；
   - `FAILED`（端口权威确定失败，如重组出局）→ `markFailed` CAS（BROADCAST→FAILED，reason `CHAIN_REPORTED_FAILED`）→ Outbox `telegram.withdrawal-failed.v1`——退款释放编排属 S6-6。

## 冻结未来工程矩阵

Create：`modules/withdrawals/application/withdrawal-broadcast.service.ts`、`modules/withdrawals/infrastructure/deterministic-broadcaster.fake.ts`（implements S4-6 TransactionBroadcasterPort；txid = canonicalDigest 派生；可配置 PENDING/CONFIRMED/FAILED 与抛错）、`apps/platform/test/database/withdrawal-broadcast.integration.spec.ts`（S6WR）。Modify：无（contracts/迁移均不动；复用 S4-6 端口与 S6-4 服务）。

## 测试矩阵（S6WR）

- S6WR01 APPROVED 全链路 → BROADCAST，broadcast_txid 落库，用户受理通知一条
- S6WR02 崩溃窗口重放：两次 broadcast → 同一 txid（确定性）、状态仍 BROADCAST 单条、无重复通知
- S6WR03 非法状态（PENDING_APPROVAL/CONFIRMED/REJECTED）拒绝，零广播调用
- S6WR04 广播抛错 → UNKNOWN：状态停留 SIGNING、无 markFailed、无失败通知；恢复后重试成功
- S6WR05 确认监控：PENDING 停留 BROADCAST；CONFIRMED 返回 readyForSettlement 且状态不动（等 S6-6）
- S6WR06 端口 FAILED → markFailed 落 reason + 用户通知；此后 broadcast/checkOnChainStatus 均拒绝

## 边界与不做

- 不做结算过账/退款释放（S6-6）；不做定时轮询 worker 编排（S6-6/S6-8 统一）；不做真实链广播器（生产独立授权）。
- 确认数策略不在本服务重复执行——端口 CONFIRMED 语义已含（S4 扫描器消费 confirmation_policies）；避免双层确认判定漂移。

## 停止条件

确定性假设破坏（Fake 或真实实现产生非确定 txid）、端口状态语义与 V8 状态机不兼容、UNKNOWN 路径出现任何状态写入。
