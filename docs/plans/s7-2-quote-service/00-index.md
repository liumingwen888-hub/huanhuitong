# S7-2 报价源端口与报价服务 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（换汇价格事实）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过；同日显式授权 V10 迁移写入）。S7-2 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 7 总体规划 v1.0](../2026-08-19-stage-7-exchange-master-plan.md)（已裁决决策 1/3/4/5）、[换汇领域](../../domains/exchange.md)（Quote 实体、"保存报价来源/时间/值、配置版本"、防异常汇率）、[S7-1](../s7-1-market-catalog/00-index.md)（market_configs 已 VERIFIED）。

## 目标

有期限、可追溯报价的完整生产线：**市场校验 → 限额 → 报价源获取 → 防异常汇率 bound → 点差内含 + 向下舍入整数计算 → 报价快照落库（V10）**。

## 关键设计：报价快照必须持久化（V10 迁移，须显式授权）

确认（S7-3）重校验的对象是**同一份报价**（quote_id + 未过期 + 未消费），不是重新询价——否则"有期限可追溯报价"语义落空、用户看到的与成交的脱钩。领域文档"保存报价来源/时间/值、配置版本"即此要求。

## V10 `quotes` 表

- `quote_id uuid PK`；`market_key text` + `config_version int` 复合 FK → market_configs(market_key, config_version)（审计：用了哪版市场配置）；
- `sell_amount bigint CHECK(>0)`；`reference_rate text NOT NULL`（源返回的参考价，十进制串原样存档）；`buy_amount bigint CHECK(>=0)`（点差后、向下舍入的最终所得）；
- `source_id text NOT NULL`（如 `fake-configured-v1`；真实源白名单生产阶段接）；
- `expires_at timestamptz NOT NULL`；`created_at DEFAULT clock_timestamp()`；
- `status text CHECK(IN ('ACTIVE','CONSUMED','EXPIRED')) DEFAULT 'ACTIVE'`——报价有生命周期（区别于 market_configs 只增不改）；
- `ck_quotes_expiry CHECK(expires_at > created_at)`；
- 权限：平台 SELECT+INSERT+UPDATE(status)（仅状态列）；worker 只读。

## 端口与服务

1. **QuoteSourcePort**（exchange/domain）：`getRate({marketKey, sellAssetCode, buyAssetCode}) → {rate: 十进制串, referenceRate: 十进制串, sourceId}`——纯接口；真实源生产阶段独立授权。
2. **FakeQuoteSource**（domain）：按市场配置 `{rate, referenceRate}`、可注入偏差（测防异常汇率）、记录全部询价。
3. **纯函数整数数学**（domain/quote-math.ts，单测覆盖）：
   - `parseDecimalRate(text) → {num, den}`（BigInt 分数，拒绝非法/负值/超 18 位小数）；
   - `computeBuyAmount({sellAmount, rateNum, rateDen, sellDecimals, buyDecimals, spreadBp}) → bigint`——`floor(sell · rate · 10^(buyDec−sellDec) · (10000−spread)/10000)`，全程 BigInt，买方所得**向下舍入**（决策 3）。
4. **QuoteService.createQuote({marketKey, sellAmount})**：
   - 市场 findActive → 无 → `MARKET_NOT_FOUND`；
   - 限额（min/max）→ 越界 `QUOTE_AMOUNT_OUT_OF_RANGE`，零写入；
   - 询价 → **防异常汇率**：`|rate − referenceRate| / referenceRate > toleranceBp` → `QUOTE_DEVIATION_EXCEEDED`（fail-closed，零写入）；
   - 资产精度查 asset_catalog → computeBuyAmount；
   - `expiresAt = now + quote_ttl_seconds`（决策 5）→ INSERT（ACTIVE）→ 返回 `QuoteSnapshot`。
5. contracts：`QuoteSnapshot`（quoteId/marketKey/configVersion/sell/buy 金额/referenceRate/sourceId/expiresAt/status）、`QuoteContractErrorCode`。

## 冻结未来工程矩阵

Create：`database/migrations/V10__stage_7_quotes.sql`、`packages/contracts/src/exchange.ts`（增补）、platform `modules/exchange/domain/{quote-source.port.ts, fake-quote.source.ts, quote-math.ts}`、`modules/exchange/application/quote.service.ts`、`modules/exchange/application/quote.repository.ts` + `infrastructure/postgres-quote.repository.ts`、`apps/platform/test/unit/quote-math.spec.ts`、`apps/platform/test/database/quote-service.integration.spec.ts`（S7QT）。Modify：无（S7-1 仓储直接复用）。

## 测试矩阵（S7QT）

- S7QT01（集成）同资产跨链：卖 1 USDT-TRC20、rate 1.0、点差 50bp → 买得恰 995000（1e6·9950/10000）
- S7QT02（集成）跨精度：卖 1000 satoshi BTC、rate 95000、点差 50bp → 买得 945250（含 10^(6−8) 换位）
- S7QT03（集成）expiresAt = 创建时刻 + 市场 TTL；status ACTIVE；config_version 关联正确
- S7QT04（集成）偏差超容差 → QUOTE_DEVIATION_EXCEEDED，quotes 表零行
- S7QT05（集成）低于 min / 高于 max → 越界拒绝，零行
- S7QT06（集成）未知市场 → MARKET_NOT_FOUND，零行
- S7QT07（单元）数学纯函数：非法率拒绝、rate<1、小数 18 位、向下舍入边界（余 1 不进位）

## 边界与不做

- 不做报价确认/冻结（S7-3）；不做 EXPIRED 状态迁移（S7-3/5 的确认与清扫负责）；不做真实报价源（生产授权）。
- referenceRate 与 rate 均原样存档（text），计算只经 parseDecimalRate 的 BigInt 分数——数据库不存浮点。

## 实施裁决记录（2026-08-19）

1. 买得为 0（尘埃级卖出额）按 `QUOTE_AMOUNT_OUT_OF_RANGE` 拒绝（计算后防御，防零额报价进入确认链）。
2. 非法率/参考率解析失败按 `QUOTE_SOURCE_UNAVAILABLE` 拒绝（源数据质量问题，fail-closed 零写入）。
3. market-catalog 规格版本钉随 V10 改 arrayContaining（与 withdrawal-contracts 同型收敛）。
4. 偏差检查为精确交叉相乘整数比较（|rate−ref|·10000 > tol·rateDen·refNum），无浮点。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（168 模块、187 依赖）。
- unit 30 文件 238/238 PASS（含 quote-math 3 项：非法率矩阵、四种向下舍入/精度换位/尘埃归零、偏差边界）。
- S7QT01–S7QT06 集成全 PASS：同资产跨链恰 995000（reference_rate/source/status/config_version 存档断言）、跨精度恰 945250、TTL 窗口 [before+60s, after+60s]、偏差超容差零行、限额越界零行、未知市场/畸形率/未配置源三类 fail-closed 零行。
- 数据库回归：全绿（M06/M14/M16 已知环境边界；deposit-address/ledger-contracts 两规格在并行容器负载下抖动，隔离重跑 14/14 PASS）；integration 97/97。
- 交付物：`V10__stage_7_quotes.sql`、`exchange/domain/{quote-math, quote-source.port, fake-quote.source}.ts`、`exchange/application/{quote.service, quote.repository}.ts`、`exchange/infrastructure/postgres-quote.repository.ts`、contracts 增补、单测 + 集成测试。

## 停止条件

整数数学与参考实现分歧、V10 与 V1–V9 兼容破坏、容差比较方向不清（必须相对 referenceRate）。
