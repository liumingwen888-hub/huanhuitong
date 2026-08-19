# S8-2 能力与报价 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（只读能力层，无资金动作）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过）。S8-2 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 8 总体规划 v1.0](../2026-08-19-stage-8-fiat-payout-master-plan.md)（S8-2 任务行）、[法币代付领域](../../domains/fiat-payouts.md)（PayoutCapability/PayoutQuote 实体、"不虚构费率"红线）、[S8-1](../s8-1-payout-contracts/00-index.md)（provider_configs 已 VERIFIED）。

## 目标

路线能力查询与代付费用预估——**只读层，零资金动作、零新表**。

## 关键设计：不虚构红线的落地

- **能力（capability）= 配置事实**：route、供应商、源资产、固定费、限额——全部来自 provider_configs 最新版本，零推导。
- **报价（quote）= 费用预估**：`estimatedFiat = sourceAmount − fee`，其 1:1 USDT:USD 折算**仅为合成 FakeProvider 的既定语义**（文档声明，非 schema 承诺）；真实供应商费率/汇率生产阶段接入。预估标注 `estimate: true`。
- **报价不持久化**：代付费用在订单创建（S8-3）时从当时配置快照进订单列——与换汇的“有期限可追溯报价”不同，代付报价是展示层预估，幂等锚是 order_ref + 供应商幂等键（已在 V12）。此差异记录为裁决。

## 服务设计（PayoutCapabilityService）

1. `getCapabilities(): Promise<PayoutCapabilitySnapshot[]>`——每 (provider_id, route) 取最新版本（DISTINCT ON），输出配置事实。
2. `quotePayout({route, sourceAmount}): Promise<QuotePayoutResult>`——
   - findLatestByRoute → 无 → `PAYOUT_PROVIDER_CONFIG_NOT_FOUND`；
   - 金额格式/限额校验 → `PAYOUT_AMOUNT_OUT_OF_RANGE`；
   - `fee = fixed_fee`；`estimatedFiat = sourceAmount − fee`（BigInt，负数或零 → AMOUNT_OUT_OF_RANGE）；
   - 返回 `{sourceAmount, fee, estimatedFiat, providerId, configVersion, estimate: true}`。

contracts 增补：`PayoutCapabilitySnapshot`、`PayoutQuoteSnapshot`（含 estimate 标志）。仓储增补：`listCapabilities`（DISTINCT ON (provider_id, route)）。

## 冻结未来工程矩阵

Create：`modules/fiatpayout/application/payout-capability.service.ts`、`apps/platform/test/database/payout-capability.integration.spec.ts`（S8PC）。Modify：`payout.repository.ts` + Postgres（listCapabilities）、contracts/fiat-payouts.ts（两快照）。

## 测试矩阵（S8PC）

- S8PC01 能力清单：种子路线就位；新配置版本后能力跟随最新
- S8PC02 报价：限额内 → 费与预估精确（BigInt）；estimate 标志为真
- S8PC03 限额越界（低于 min / 高于 max / 不足付费）→ 拒绝零副作用
- S8PC04 未知路线 → CONFIG_NOT_FOUND
- S8PC05 多供应商同路线：最新版本者胜（按 config_version 最大）

## 边界与不做

- 不做订单创建/冻结（S8-3）；不做真实汇率（生产）；不做报价 TTL/持久化（裁决见上）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（182 模块、199 依赖）。
- unit 31 文件 246/246 PASS。
- S8PC01–S8PC05 全 PASS：能力=配置事实且跟随版本（v2 后能力更新）、费用预估精确（500 万 − 2000 = 4,998,000，estimate 标注）、限额/低于费/畸形拒绝、未知路线 fail-closed、多供应商同路线最新版本胜（config_version 3 覆盖）。
- 数据库回归 484/487（M06/M14/M16 已知环境边界项）；integration 109/109。
- 交付物：`payout-capability.service.ts`、仓储 listCapabilities（DISTINCT ON provider+route）、contracts 两快照、S8PC 集成规格。

## 停止条件

能力层出现任何非配置事实的推导值、预估未标注。
