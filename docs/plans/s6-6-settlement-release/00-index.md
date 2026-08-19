# S6-6 提现完成/失败结算 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（资金终态结算 + 释放）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过并授权实施）。S6-6 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 6 总体规划 v1.0](../2026-08-17-stage-6-withdrawals-master-plan.md)（S6-6 任务行）、[ledger-model](../../architecture/ledger-model.md)、[S3-6 模板](../../../apps/platform/src/modules/ledger/templates/posting-templates.ts)（withdrawalSucceeded/withdrawalFailed 已 VERIFIED）、[S6-5](../s6-5-broadcast-confirmation/00-index.md)（readyForSettlement 语义）。

## 目标

提现资金终态的两条收口路径：**成功结算**（BROADCAST + 链上 CONFIRMED → withdrawalSucceeded 过账 → CONFIRMED）与**失败释放**（REJECTED/FAILED/EXPIRED → withdrawalFailed 过账 → REFUNDED），外加**过期扫描**（FROZEN/PENDING_APPROVAL 超时 → EXPIRED → 释放）。

## 模板事实（S3-6 已冻结，本计划零模板改动）

- 成功 `WITHDRAWAL:{orderRef}:SETTLE:0`：DR 冻结 amount / CR 托管 amount；费用行 DR 可用 fee / CR 费用收入 fee。**链上打款金额 = amount 全额，费用另从可用扣**。
- 释放 `WITHDRAWAL:{orderRef}:RELEASE:0`：DR 冻结 amount / CR 可用 amount（资金回到可用）。
- 两个幂等键动作互斥（SETTLE vs RELEASE），叠加 V8 状态 CAS，双收口在数据库层不可能并存。

## 服务设计（WithdrawalSettlementService）

### settleConfirmed(withdrawalId)
1. 状态门：仅 `BROADCAST`；其他 → `WITHDRAWAL_INVALID_TRANSITION`。
2. **链上权威复查**：`broadcasterPort.getStatus(network, broadcast_txid)` 必须 `CONFIRMED`（不信任调用方传入的 readyForSettlement——服务自查，防陈旧）。非 CONFIRMED → `{outcome:'NOT_READY', chainStatus}`，零写入。
3. 单过账事务（经 PostMoney 内核）：ensure 四账户（USER_FROZEN / PLATFORM_CUSTODY / USER_AVAILABLE / FEE_INCOME）→ withdrawalSucceeded 模板（amount=订单金额、fee=订单 feeAmount）→ 过账。
4. **费用可扣性**：可用不足以支付费用时内核拒绝负余额 → `{outcome:'SETTLE_REJECTED', reasonCode:'WITHDRAWAL_INSUFFICIENT_FUNDS'}`，**订单停留 BROADCAST**（链上已付款，不能回滚；结算待运营处理）——fail-closed，绝不部分收费、绝不推断成功。测试造数：冻结全部余额后结算（available=0）。
5. `markConfirmed` CAS（落 settlement_ledger_transaction_id）→ Outbox `telegram.withdrawal-succeeded.v1` → 返回快照。CAS 失败 → 重读快照幂等返回（并发恰好一次）。

### release(withdrawalId)
1. 状态门：`REJECTED` / `FAILED` / `EXPIRED`；其他 → `WITHDRAWAL_INVALID_TRANSITION`。
2. ensure 冻结/可用账户 → withdrawalFailed 模板 → 过账 → `markRefunded` CAS（释放过账也存 settlement_ledger_transaction_id——收口过账统一列）→ Outbox `telegram.withdrawal-refunded.v1`。
3. 幂等：RELEASE 模板键 + markRefunded CAS + REFUNDED 终态门三层。

### expireStalePending(limit)
1. TTL 来源：ConfigStore `withdrawal.approval` payload 增 `pendingTtlSeconds`（正整数）；缺失/非法 → **不过期任何订单**（fail-closed 反向：宁可挂起等待人工，不可误杀进行中的审批——过期是资金动作，无配置不执行）。
2. 扫描 `FROZEN`/`PENDING_APPROVAL` 且 `created_at < now - ttl` 的订单（仓储新增 `findExpirable`）→ 逐个 `markExpired` CAS → 返回处理清单（释放由调用方接着走 release 路径，或 S6-8 的 worker 编排统一驱动）。

## 实施裁决记录（2026-08-19）

1. **发现并修复 NULL-owner 账户 ensure 缺陷**：`owner_uid IS NULL` 时普通 UNIQUE 索引不判重（NULL≠NULL），`INSERT … ON CONFLICT DO NOTHING` 每次插入新行——结算曾因此把 CR 落到新建的空 custody 账户而被内核以负余额拒绝。修复为「先 SELECT、miss 才 INSERT（冲突子句仅作竞态兜底）、再 SELECT 回读」。S5 transfer 的 `#ensureFeeIncome` 同型逻辑因费用恒 0 从未暴露（其 SELECT-first 顺序在串行路径下正确）；并发双建残余竞态两处共有，接受并记录（首次创建均为单线程路径）。
2. **清除 `apps/platform/src` 内 21 个陈旧编译产物**（.js/.js.map/.d.ts，未跟踪）：import 说明符以 .js 结尾时它们遮蔽同名 .ts 源，曾使调试探针失效。packages/testing/fixtures 下 2 个为架构测试故意 fixture，保留。
3. 托管方向澄清：PLATFORM_CUSTODY 为借方正常，链上出金使其**减少**（CREDIT −amount）；测试断言据此修正。
4. 结算 CAS 失败但快照已 CONFIRMED → 幂等返回 CONFIRMED（并发恰好一次）；通知仅首次迁移发出。

## 冻结未来工程矩阵

Create：`modules/withdrawals/application/withdrawal-settlement.service.ts`、`apps/platform/test/database/withdrawal-settlement.integration.spec.ts`（S6WF）。Modify：`withdrawal.repository.ts` + Postgres 实现（增 `findExpirable(context, threshold, limit)`）。

## 测试矩阵（S6WF）

- S6WF01 全链路成功：申请→批准→签名→广播→链 CONFIRMED→结算 → CONFIRMED + 结算过账关联 + 余额四账户方向断言（可用 -fee、冻结清零、托管 +amount、费用收入 +fee）
- S6WF02 结算幂等：CONFIRMED 后再结算 → 状态门拒绝，账本仅一笔 SETTLE
- S6WF03 链上未确认即结算 → NOT_READY 零写入
- S6WF04 费用从可用扣（冻结只含 amount——与 S6WA04 衔接断言）
- S6WF05 拒绝→释放：REFUNDED + 冻结回可用 + RELEASE 过账关联 + 通知
- S6WF06 链上失败（S6-5 FAILED 路径）→释放 → REFUNDED
- S6WF07 过期：配置 TTL + 回填 created_at → expireStale 仅命中超时单 → EXPIRED → 释放 REFUNDED；新单不受影响；无配置时零过期
- S6WF08 费用不可扣：冻结全部余额 → 结算 SETTLE_REJECTED、订单停留 BROADCAST、零 SETTLE 过账

## 边界与不做

- 不做定时 worker 编排（S6-8 统一验收含 worker 驱动模式）；不做 Telegram UX（S6-7）；不做热钱包托管账户的链上资金对账（阶段 10）。
- 过期与释放分离两步（markExpired → release），S6-8 worker 可在两步之间插入通知/审计。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（154 模块、181 依赖；清除陈旧产物后巡航图更准确）。
- unit 28 文件 228/228 PASS。
- S6WF01–S6WF08 全 PASS：全链路成功（可用 −7,999,000/冻结 0/托管 −2,000,000/费用收入 −1,000 四账户方向）、CONFIRMED 后重结算拒绝且单笔 SETTLE、链未确认 NOT_READY 零写入、费用入费用收入、拒绝释放回全额、链失败释放不收费全额、过期精确命中（含无配置零过期）、费用不可扣停留 BROADCAST 零 SETTLE。
- 数据库回归 440/443（M06/M14/M16 已知环境边界项）。
- 交付物：`modules/withdrawals/application/withdrawal-settlement.service.ts`、集成测试、仓储 `findExpirable`（接口 + Postgres 实现）。

## 停止条件

模板与 V8 状态机不匹配、CAS 语义不清、TTL 无配置时的默认方向与用户预期冲突（须裁决后实施）。
