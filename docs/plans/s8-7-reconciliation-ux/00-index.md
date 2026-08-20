# S8-7 对账 + Telegram UX 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（只读对账 + UX 编排层）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过）。S8-7 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 8 总体规划 v1.0](../2026-08-19-stage-8-fiat-payout-master-plan.md)（S8-7 任务行）、[S7-6 对账先例](../s7-6-reconciliation/00-index.md)、[S6-7/S7-7 UX 先例](../s7-7-telegram-ux/00-index.md)、[S8-3 证明绑定](../s8-3-request-freeze/00-index.md)（assetSummary=route）。

## Part A：PayoutReconciliationService（只读三层）

1. **订单↔账本链接**（动作前缀计数，S7-6 同型）：
   | 订单状态 | FREEZE | SETTLE | RELEASE | REVERSE | 收口关联 |
   |---|---|---|---|---|---|
   | FUNDS_RESERVED/SUBMITTING/ACCEPTED/UNKNOWN/FAILED | 1 | 0 | 0 | 0 | — |
   | SUCCEEDED | 1 | 1 | 0 | 0 | 非空 |
   | REFUNDED | 1 | 0 | 1 | 0 | 非空 |
   | REVERSED | 1 | 1 | 0 | 1 | 非空 |
2. **供应商报告↔订单一致性**（callback_inbox join 订单）：
   - 报 FAILED + 订单 SUCCEEDED/REVERSED → `REPORT_ORDER_MISMATCH`；
   - 报 SUCCEEDED + 订单 FAILED/REFUNDED → `REPORT_ORDER_MISMATCH`；
   - 报告键无对应订单 → `ORPHAN_REPORT`（inbox 保留审计但浮现）。
3. runAll → 冻结报告；只读红线（行数不变断言）。

## Part B：/payout 命令族（复用既有模式）

- `/payoutcapa`——能力清单（route/费用/限额经 renderNumeric；**新增 route 字符集 `[A-Z]{2}:[A-Z]{3}`**）。
- `/payoutquote <route> <amount>`——费用预估（estimate 标注语义入文案）。
- `/payout <route> <amount> <beneficiary_ref>`——**证明续体模式**（S6-7 同型）：真实绑定值开仓（orderRef 生成、amountSummary=amount、assetSummary=route、operationType='fiat-payout'）→ 共享流程注册表 → 密码数字流 → 续体消费证明 → PayoutRequestService.request → 类别常量。
- `/payoutstatus <order_ref>`——八态常量；他人订单不可见。

通知主题：`telegram.payout-{requested,submitted,succeeded,failed,refunded,reversed}.v1` 六主题（S8-3/4/6 已发）→ worker texts 映射接入（S7-7 泛化注册直接复用）。

## 冻结未来工程矩阵

Create：`fiatpayout/application/payout-reconciliation.service.ts`、`telegram/application/{payout-commands.ts, payout-replies.ts, payout-command.handler.ts}`、`apps/platform/test/database/payout-reconciliation.integration.spec.ts`（S8RC）、`apps/platform/test/unit/payout-commands.spec.ts`（S8PU）。Modify：`numeric-render.ts`（route 种类）。

## 测试矩阵

S8RC（集成）：
- S8RC01 干净全链路（成功+释放+冲正三单）零差异
- S8RC02 重复过账 → 链接差异（settle=2）
- S8RC03 改订单金额类篡改由快照层防——这里测：报 FAILED + 订单 SUCCEEDED → 报告差异
- S8RC04 孤儿报告（inbox 键无订单）→ ORPHAN
- S8RC05 只读性（行数不变）

S8PU（单元 + Fake，S7-7 同型）：
- S8PU01 解析矩阵（route 形状/金额/beneficiary/参数数）
- S8PU02 /payout 开仓真实绑定值（operationType/assetSummary=route）+ 注册表登记
- S8PU03 续体七类结果常量映射 + 服务调用参数
- S8PU04 /payoutquote 预估渲染 + 拒绝类别
- S8PU05 /payoutcapa 能力渲染
- S8PU06 /payoutstatus 八态 + 他人不可见 + renderNumeric route 白名单
- S8PU07 六通知主题静态文案 + 静态保证扫描

## 边界与不做

- 不做对账自动修复；不做真实供应商对账（生产）；不做按钮 UI。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（197 模块、215 依赖）。
- unit 32 文件 253/253 PASS（含 S8PU 7 项：解析矩阵、开仓真实绑定值（assetSummary=US:USD）、续体七类映射 + 事实参数、预估渲染（含"以实际为准"标注）、能力渲染、八态 + route 白名单双向（US:USD 过 / 小写与超长拒）、六通知主题静态文案 + 源码保证扫描）。
- S8RC01–S8RC05 全 PASS：三路径干净账本（成功/释放/冲正）零差异、重复 SETTLE → settle=2 链接差异、报 FAILED + 订单 SUCCEEDED → REPORT_ORDER_MISMATCH、孤儿报告、只读性（六表行数不变）。
- 数据库回归 517/520（M06/M14/M16 已知环境边界项）；integration 107–109（registration-concurrency 已知负载敏感抖动，今日多次全绿后在本轮持续负载下抖动，identity 代码未动——S8-8 验收时聚焦复核）。
- 交付物：`payout-reconciliation.service.ts`（链接矩阵含 REVERSED 三动作 + 报告一致性）、`telegram/application/{payout-commands, payout-replies, payout-command.handler}.ts`、renderNumeric route/payoutOrderRef 种类、S8RC + S8PU 规格。

## 停止条件

对账出现写入、UX 绑定退化为宽松比较。
