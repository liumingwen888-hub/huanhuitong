# S7-1 市场目录与 V9 迁移 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（换汇 schema 基础）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S7-1 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 7 总体规划 v1.0](../2026-08-19-stage-7-exchange-master-plan.md)（已裁决决策 2/4/5）、[换汇领域](../../domains/exchange.md)（Market 实体、市场配置版本）、[S6-1 先例](../s6-1-withdrawal-contracts/00-index.md)（版本化只增不改模式）。

## 目标

1. **V9 增量迁移**（须显式授权）——`market_configs` 表（沿用 signer_policies 的版本化只增不改模式）：
   - 主键 `(market_key, config_version)`；
   - `market_key text`——方向市场键，格式 `SELL:BUY`（如 `USDT-TRC20:USDT-ERC20`）；
   - `sell_asset_code` / `buy_asset_code`——FK asset_catalog；
   - `quote_scale integer`——报价换算精度（买方所得计算的有效位数上限）；
   - `spread_bp integer` CHECK(0..10000)——点差（万分之一）；
   - `min_sell_amount` / `max_sell_amount` bigint CHECK(>0, max>=min)；
   - `quote_ttl_seconds integer CHECK(1..3600)`——报价有效期；
   - `deviation_tolerance_bp integer CHECK(>0)`——防异常汇率容差（S7-2 消费）；
   - `activated_at timestamptz DEFAULT clock_timestamp()`；
   - **种子四方向市场**：USDT-TRC20:USDT-ERC20、USDT-ERC20:USDT-TRC20、BTC:USDT-TRC20、USDT-TRC20:BTC（合成参数：TTL 60s、quote_scale 8、点差 50bp、容差 1000bp）；
   - 权限：平台 SELECT+INSERT（无 UPDATE——版本化只增不改）；worker 只读。
2. **contracts**：`MarketDirectionSnapshot`（marketKey、sell/buy 资产、精度、点差、限额、TTL、容差、版本）、`MarketContractErrorCode`。
3. **仓储接口 + Postgres 实现**：`findActive(marketKey)`（max config_version）、`listActive()`。

## 冻结未来工程矩阵

Create：`database/migrations/V9__stage_7_markets.sql`、`packages/contracts/src/exchange.ts`（index 导出）、platform `modules/exchange/{application/market.repository.ts, infrastructure/postgres-market.repository.ts}`、`apps/platform/test/database/market-catalog.integration.spec.ts`（S7MK）。Modify：contracts index。

## 测试矩阵（S7MK）

- S7MK01 迁移正反：V1–V8 兼容、四市场种子就位、角色矩阵（平台只读+插、worker 只读、平台 UPDATE 被拒）
- S7MK02 findActive 返回最高版本；插入新版本后活跃配置切换、旧版本仍在
- S7MK03 listActive 返回全部四方向
- S7MK04 CHECK 拒绝：spread 越界、TTL 越界、min>max、非法资产 FK

## 停止条件

V1–V8 兼容破坏、种子参数与已裁决决策冲突、三锁漂移。
