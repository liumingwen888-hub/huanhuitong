# S7-4 执行与结算 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（换汇资金终态 + 模板修正）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过，含模板修正授权）。S7-4 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 7 总体规划 v1.0](../2026-08-19-stage-7-exchange-master-plan.md)（S7-4 任务行）、[换汇领域](../../domains/exchange.md)（"两种资产分别在资产内平衡结算"）、[S3-6 模板](../../../apps/platform/src/modules/ledger/templates/posting-templates.ts)、[S7-3](../s7-3-confirm-freeze/00-index.md)（FUNDS_RESERVED 已 VERIFIED）。

## 关键设计修正：exchangeSettled 模板拆分双腿清算（Modify 阶段 3 已验证代码）

**问题**：现行模板只有一个 `clearingDiffAccountId`，四行中卖腿（CR 清算 S）与买腿（DR 清算 B）落在同一账户——同资产跨链市场（阶段 3 测试场景，等额）恰好成立，**跨资产市场会把两种资产的量混入一个 per-asset 账户**，记账语义错误。

**修正**：`clearingDiffAccountId` → `sellClearingAccountId` + `buyClearingAccountId`（各自资产的清算差账户）：
- 卖资产腿：DR 卖冻结 S / CR 卖清算 S（资产内平衡）
- 买资产腿：DR 买清算 B / CR 买可用 B（资产内平衡）
- 整笔交易仍借贷平衡；同资产场景两参数传同一账户即退化回原语义（阶段 3 测试兼容）。
- **舍入/点差价值事实**：卖清算 +S、买清算 −B（各自资产单位），价值差由 S7-6 对账层换算监控——即 RoundingRecord 的账本表达。

## 支付密码门裁决（S7-3 遗留，本计划决定）

**换汇确认不设支付密码门**（合成期）。依据：安全底线的高风险清单为"高风险提现、敏感安全变更、账号恢复"——站内换汇不在列；确认时点资金不出平台、无外部流出；提现已覆盖最高风险出站路径。真实执行模式（P0-4 生产裁决）时一并重审。S7-8 威胁模型记录。

## 服务（ExchangeSettlementService.settle）

1. 状态门：`FUNDS_RESERVED` → CAS `EXECUTING`；`EXECUTING` → 幂等重入（崩溃恢复）；其他 → `EXCHANGE_COMMAND_INVALID`。
2. 账户 ensure：卖冻结（用户）+ 买可用（用户）+ 卖清算 + 买清算（平台级，SELECT-first 三步——S6-6 NULL-owner 教训）。
3. exchangeSettled（orderId = orderRef，幂等键 `EXCHANGE:{orderRef}:SETTLE:0`）→ PostMoney 内核（买资产贷方入账，贷方正常约束天然满足）。
4. `markSettled` CAS（EXECUTING→SETTLED + settlement_ledger_transaction_id）→ Outbox `telegram.exchange-settled.v1`。CAS 失败但快照 SETTLED → 幂等返回。

仓储增补：`markExecuting`、`markSettled`（CAS）；模板 Modify + 阶段 3 模板测试更新（同资产两参数同账户）。

## 冻结未来工程矩阵

Create：`modules/exchange/application/exchange-settlement.service.ts`、`apps/platform/test/database/exchange-settlement.integration.spec.ts`（S7XS）。Modify：`posting-templates.ts`（exchangeSettled 拆双腿）、`posting-templates.integration.spec.ts`（适配）、`exchange-order.repository.ts` + Postgres（markExecuting/markSettled）。

## 测试矩阵（S7XS）

- S7XS01 同资产跨链结算：四账户终态（卖可用不变、卖冻结清零、买可用 +B、卖清算 +S=买清算 −B 当同资产等额时净零）
- S7XS02 跨资产结算（BTC→USDT）：买资产可用增加、两清算账户各自资产内平衡、借贷总平衡
- S7XS03 幂等：SETTLED 后重结算拒绝；EXECUTING 重入收敛单笔 SETTLE
- S7XS04 通知一条；订单 SETTLED + settlement 关联
- S7XS05 非法状态（FUNDS_RESERVED 之外的 REFUNDED 等）拒绝
- S7XS06 模板回归：阶段 3 既有模板测试适配后全过（同资产退化语义）

## 边界与不做

- 不做失败/过期释放（S7-5）；不做清算差价值对账（S7-6）；不做真实上游执行（生产）。

## 实施裁决记录（2026-08-19）

1. **发现并修复内核缺陷（第二个真实缺陷）**：`violatesNormalBalance` 缺少"不受限"集合——阶段 3 文档记录的"CLEARING_DIFF 不受限"修复从未落到内核；当年模板测试等额对倒（净额恒 0）从未暴露。双腿清算使买清算出现正余额（+buyAmount）即被误拒。修复：新增 `UNRESTRICTED_PURPOSES = {CLEARING_DIFF}`。全量回归确认无既有规格依赖旧的受限语义。
2. 支付密码门裁决按计划落档：换汇确认不设（S7-8 威胁模型记录）。
3. settle 的 FUNDS_RESERVED→EXECUTING CAS 失败后按快照分流（EXECUTING/SETTLED 重入，其余拒绝）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（172 模块、193 依赖）。
- unit 30 文件 238/238 PASS。
- S7XS01–S7XS05 全 PASS：同资产四账户终态（可用 −8M/冻结 0/买得 −1.99M/卖清算 −2M/买清算 +1.99M）、跨资产 BTC→USDT 各腿资产内平衡 + 借贷总平衡、EXECUTING 崩溃重入幂等 + 单笔 SETTLE、通知恰一条、非法状态与未知订单拒绝。
- 阶段 3 模板测试适配后通过（同资产双清算参数传同账户的退化语义）；**内核修复后全量回归绿**：unit 238、database 462/465（M06/M14/M16 已知环境边界）、integration 97/97（一次负载抖动重跑通过）。
- 交付物：模板拆双腿 + 适配、内核 UNRESTRICTED_PURPOSES 修复、订单仓储 markExecuting/markSettled CAS、ExchangeSettlementService、S7XS 集成规格。

## 停止条件

模板修正破坏既有模板测试语义、买资产入账被内核误拒、CAS 链不闭合。
