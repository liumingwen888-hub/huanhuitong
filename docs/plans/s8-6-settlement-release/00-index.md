# S8-6 结算/释放/冲正 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（法币出站资金终态）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过）。S8-6 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 8 总体规划 v1.0](../2026-08-19-stage-8-fiat-payout-master-plan.md)（S8-6 任务行）、[法币代付领域](../../domains/fiat-payouts.md)（成功结算用户负债→供应商清算→费用；失败释放；REVERSED 补偿分录）、[S3-6 三模板](../../../apps/platform/src/modules/ledger/templates/posting-templates.ts)、[S6-6 先例](../s6-6-settlement-release/00-index.md)。

## 目标

代付资金的三条收口路径：**成功结算**（ACCEPTED → fiatPayoutSucceeded 四行过账 → SUCCEEDED）、**失败释放**（FAILED → fiatPayoutFailed → REFUNDED）、**成功后冲正**（SUCCEEDED → 新增补偿模板 → REVERSED）。S8-5 的 settlement-pending/reversal-pending 队列事件由本服务消费。

## 模板事实（两存一增）

- 成功 `FIAT_PAYOUT:{ref}:SETTLE:0`（S3-6）：DR 冻结 amount / CR 上游成本 amount + 费用行 DR 可用 fee / CR 费用收入 fee——链上源资产转入上游、费用从可用扣。
- 释放 `FIAT_PAYOUT:{ref}:RELEASE:0`（S3-6）：DR 冻结 / CR 可用（全额释放，失败不收费）。
- **新增** `fiatPayoutReversed`：DR 上游成本 amount / CR 可用 amount + 费用冲回 DR 费用收入 fee / CR 可用 fee——补偿分录镜像成功过账，幂等键 `FIAT_PAYOUT:{ref}:REVERSE:0`（与 SETTLE/RELEASE 动作互斥）。

## 服务设计（PayoutSettlementService）

### settle(payoutOrderId)
1. 状态门：仅 `ACCEPTED`（供应商 SUCCEEDED 已由 S8-5 排队；其他 → INVALID_TRANSITION）。
2. ensure 四账户：USER_FROZEN / UPSTREAM_COST（平台级 SELECT-first）/ USER_AVAILABLE / FEE_INCOME。
3. 过账 → `markSucceeded` CAS（ACCEPTED→SUCCEEDED + settlement tx；V12 CHECK 收口非空满足）→ Outbox `telegram.payout-succeeded.v1`。
4. **费用可扣性 fail-closed**（S6-6 同型）：可用不足以付费 → 停留 ACCEPTED 待运营，绝不部分收费。

### release(payoutOrderId)
FAILED 门 → fiatPayoutFailed → `markRefunded` CAS → 通知 `telegram.payout-refunded.v1`。

### reverse(payoutOrderId)
SUCCEEDED 门 → fiatPayoutReversed → `markReversed` CAS（SUCCEEDED→REVERSED）→ 通知 `telegram.payout-reversed.v1`。冲正前提：上游补偿分录收回资产（合成语义；真实供应商回款对账生产阶段）。

仓储增补 CAS：markSucceeded / markRefunded / markReversed（均带 settlement tx）。

## 冻结未来工程矩阵

Create：`fiatpayout/application/payout-settlement.service.ts`、`apps/platform/test/database/payout-settlement.integration.spec.ts`（S8ST）。Modify：`posting-templates.ts`（增 fiatPayoutReversed + 导出，Create 型新增）、`payout.repository.ts` + Postgres（三 CAS）。

## 测试矩阵（S8ST）

- S8ST01 结算成功：五账户终态（冻结 0/上游 −amount(自种子)/费用收入 −fee/可用 −fee）+ 收口关联 + 通知
- S8ST02 结算幂等门：SUCCEEDED 后重结算拒绝；账本单笔 SETTLE
- S8ST03 释放：FAILED→REFUNDED 全额回可用
- S8ST04 冲正：SUCCEEDED→REVERSED 补偿镜像（可用 +amount+fee、上游复原、费用收入冲回）
- S8ST05 非法前态矩阵（FUNDS_RESERVED 结算/ACCEPTED 释放/REFUNDED 冲正均拒）
- S8ST06 费用不可扣 fail-closed：停留 ACCEPTED 零 SETTLE
- S8ST07 三路径通知各一；三动作账本各恰一笔

## 边界与不做

- 不做队列 worker 编排（S8-8 验收统一）；不做真实上游回款对账（生产）；不做 UPSTREAM_COST 的充值补足流程（运营动作，合成期测试直接播种）。

## 实施裁决记录（2026-08-19）

1. 测试种子教训：直接 SQL 播种账本必须（a）借贷平衡（内核 DEFERRABLE 触发器拦单边）且（b）同步 account_balances 投影（内核只维护自己过账的增量）——两处测试修正均暴露既有防线的正确性。
2. fiatPayoutReversed 按 Create 型新增落地（镜像结算 + 费用冲回），四模板动作键 SETTLE/RELEASE/REVERSE/FREEZE 互斥。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（193 模块、212 依赖）。
- unit 31 文件 246/246 PASS。
- S8ST01–S8ST07 全 PASS：五账户终态（冻结 0/可用 −4,998,000/上游 95,000,000/费用收入 −2,000）+ 收口关联 + 通知、SUCCEEDED 重结算拒单笔、释放全额回可用、冲正镜像（可用复原 +10M、上游复原 100M、费用收入清零）、非法前态矩阵四路拒、费用不可扣 fail-closed 停留 ACCEPTED 零 SETTLE、三路径通知各一且三动作账本各恰一笔。
- 数据库回归 512/515（M06/M14/M16 已知环境边界项）；integration 109/109。
- 交付物：fiatPayoutReversed 模板、仓储三 CAS（markSucceeded/markRefunded/markReversed）、PayoutSettlementService 三路径、S8ST 集成规格。

## 停止条件

三动作幂等键冲突、冲正与结算并存（V12 状态机 + 动作互斥须实证）、费用边界行为与 S6-6 分歧。
