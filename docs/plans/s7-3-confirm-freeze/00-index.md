# S7-3 换汇确认与冻结 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（换汇冻结编排）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过；同日显式授权 V11 迁移写入；报价匿名与支付密码门后置两项裁决默认接受）。S7-3 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 7 总体规划 v1.0](../2026-08-19-stage-7-exchange-master-plan.md)（S7-3 任务行）、[换汇领域](../../domains/exchange.md)（确认时重新校验报价、并发确认唯一）、[S3-6 exchangeFrozen 模板](../../../apps/platform/src/modules/ledger/templates/posting-templates.ts)（幂等键 `EXCHANGE:{orderId}:FREEZE:0`）、[S6-2 先例](../s6-2-withdrawal-request-freeze/00-index.md)（顺序事务 + 崩溃自愈模式）。

## 目标

用户确认报价到资金冻结的编排：**报价重校验（同 quote_id + ACTIVE + 未过期）→ 报价消费 CAS + 订单创建（原子）→ exchangeFrozen 过账 → FUNDS_RESERVED**；并发确认恰好一单。

## 关键设计

### 崩溃自愈：确定性 orderRef
`orderRef = XCHG:{quote_id}`（从报价派生）——重放时模板幂等键 `EXCHANGE:{orderRef}:FREEZE:0` 返回同一笔过账，无需任何预订单状态。

### 编排顺序（崩溃窗口分析）
1. 按 quote_id 查既有订单 → 命中 → `ALREADY_CONFIRMED`（幂等）。
2. 余额预检（UX 快路径；内核仍是权威）。
3. exchangeFrozen 过账（确定性幂等；崩溃后重放同笔）。
4. **单 UOW 原子**：报价消费 CAS（`UPDATE quotes SET status='CONSUMED' WHERE quote_id AND status='ACTIVE' AND expires_at > now()`）+ 订单 INSERT（FUNDS_RESERVED + ledger_transaction_id + quote_id UNIQUE）。
   - 过账后、UOW 前崩溃：重放 → 同笔过账 → UOW 建单 ✓（自愈）。
   - 并发双确认：消费 CAS 恰好一个赢；输家 UOW 回滚后按 quote_id 查到赢家订单 → `ALREADY_CONFIRMED`。
   - UOW 失败（消费 CAS 未中且无订单）→ `QUOTE_NOT_CONSUMABLE`。

### 报价匿名性裁决
S7-2 报价不绑定 uid（公共价格板语义）；确认时绑定用户。任何用户可按同一报价条款确认——条款一致性由快照保证，使用者身份由订单承载。

## V11 `exchange_orders` 表（须显式授权）

- `exchange_order_id uuid PK`；`order_ref text UNIQUE`（= `XCHG:{quote_id}`）；`uid uuid FK users`；
- `quote_id uuid NOT NULL UNIQUE FK quotes`——**一报价一订单**（并发唯一的数据库锚）；
- `market_key text + config_version int` 复合 FK market_configs（审计锚）；
- `sell_asset_code/buy_asset_code text FK asset_catalog`；`sell_amount/buy_amount bigint CHECK(>0)`（确认时点事实快照）；
- `status text CHECK(IN ('FUNDS_RESERVED','EXECUTING','SETTLED','FAILED','EXPIRED','REFUNDED'))`——FUNDS_RESERVED 为初始提交态（申请与冻结原子同事务，领域 QUOTED 不单独存在）；
- `ledger_transaction_id uuid NOT NULL FK`（冻结过账）；`settlement_ledger_transaction_id uuid NULL FK`（S7-4 收口）；
- `failure_reason text NULL`；`created_at/updated_at`；
- CHECK：SETTLED ⇒ settlement 非空；FAILED ⇒ failure_reason 非空；
- 权限：平台 SELECT+INSERT+UPDATE(status, settlement_ledger_transaction_id, failure_reason, updated_at)；worker 只读。

## 服务（ExchangeConfirmService.confirm）

输入 `{quoteId, uid}`。输出 `CONFIRMED(order) | ALREADY_CONFIRMED(order) | REJECTED(reasonCode)`。错误码增补：`QUOTE_NOT_CONSUMABLE`、`EXCHANGE_INSUFFICIENT_FUNDS`、`EXCHANGE_COMMAND_INVALID`。Outbox：`telegram.exchange-reserved.v1`。

## 冻结未来工程矩阵

Create：`database/migrations/V11__stage_7_exchange_orders.sql`、`modules/exchange/application/exchange-confirm.service.ts`、`exchange/application/exchange-order.repository.ts` + `infrastructure/postgres-exchange-order.repository.ts`、quote 仓储增 `consumeActive(context, quoteId)`（CAS）、`apps/platform/test/database/exchange-confirm.integration.spec.ts`（S7XF）。Modify：contracts/exchange.ts（错误码 + ExchangeOrderSnapshot）、quote.repository.ts。

## 测试矩阵（S7XF）

- S7XF01 确认成功：订单 FUNDS_RESERVED、报价 CONSUMED、卖可用减少/卖冻结增加（符号断言）、冻结过账关联
- S7XF02 幂等重放：同 quote 再确认 → ALREADY_CONFIRMED 同单、冻结恰一笔
- S7XF03 过期报价拒绝（回填 expires_at）：零订单零过账、报价保持 ACTIVE（惰性过期，清扫属 S7-5）
- S7XF04 并发确认：两路并发 → 恰一单 FUNDS_RESERVED、报价单次消费、输家 ALREADY_CONFIRMED
- S7XF05 余额不足：预检拒绝、报价仍 ACTIVE、零过账零订单
- S7XF06 未知报价/已消费无订单（模拟）：NOT_FOUND / NOT_CONSUMABLE
- S7XF07 买得与卖额快照一致（订单金额 = 报价金额）

## 边界与不做

- 不做执行/结算（S7-4）、失败/过期释放（S7-5）、EXPIRED 状态迁移与清扫（S7-5）；不做支付密码门（换汇确认是否需要支付授权证明——**留 S7-4 前裁决**：金额阈值制 vs 全量制，计划将补充）。

## 实施裁决记录（2026-08-19）

1. 卖/买资产码由 market_key 按冒号拆分派生（资产码不含冒号，V3 字符集保证）；不重复查市场配置。
2. UOW 内消费失败/建单唯一冲突的包装错误 → 事后按 quote_id 复查赢家订单收敛 ALREADY_CONFIRMED（S6 保守映射同型）。
3. 错误码统一并入 QuoteContractErrorCode（撤销独立 ExchangeContractErrorCode，避免双词表漂移）。
4. V10 形状 CHECK（expires_at > created_at）要求过期测试同时回填 created_at——约束按预期工作。
5. quote-service 规格版本钉随 V11 改 arrayContaining（第三次同型收敛；此后新规格一律 arrayContaining）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（171 模块、191 依赖）。
- unit 30 文件 238/238 PASS。
- S7XF01–S7XF07 全 PASS：冻结与消费原子（可用 −8,000,000/冻结 −2,000,000、报价 CONSUMED、XCHG:{quoteId} 关联）、幂等重放单笔冻结、过期报价拒绝且保持 ACTIVE（惰性过期）、并发恰一单（两路 CONFIRMED+ALREADY_CONFIRMED、单订单单过账）、余额不足报价可再消费、未知/预消费报价 fail-closed、订单金额与报价快照精确一致。
- 数据库回归 457/460（M06/M14/M16 已知环境边界项）；integration 97/97。
- 交付物：`V11__stage_7_exchange_orders.sql`、`exchange/application/{exchange-confirm.service.ts, exchange-order.repository.ts}`、`exchange/infrastructure/postgres-exchange-order.repository.ts`、quote 仓储 consumeActive CAS、contracts 统一错误码、S7XF 集成规格。

## 停止条件

消费 CAS 与订单插入无法单 UOW 原子、模板幂等键与确定性 orderRef 冲突、V11 与 V1–V10 兼容破坏。
