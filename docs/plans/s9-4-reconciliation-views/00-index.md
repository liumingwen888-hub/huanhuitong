# S9-4 对账与运营视图 API 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（只读视图层）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S9-4 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 9 总体规划 v1.0](../2026-08-19-stage-9-admin-master-plan.md)（S9-4 任务行）、[三域对账已验证服务](../../../apps/platform/src/modules/ledger/application/reconciliation.service.ts)（ledger/exchange/fiatpayout）、[S9-2 AdminApiRouter](../s9-2-admin-api-rbac/00-index.md)。

## 目标

三个对账域的只读报告端点 + 运营观察清单——全部挂载 AdminApiRouter，零新表、零写入（对账服务本身只读）。

## 端点设计

| 路由 | 角色 | 级别 | 说明 |
|---|---|---|---|
| GET /admin/ops/reconciliation | AUDITOR 或已认证 | BASIC | 三域报告合并 `{ledger, exchange, payout}`（各含 discrepancies + 域特定事实） |
| GET /admin/ops/watchlist | 已认证 | BASIC | 观察清单：待结算（提现 BROADCAST + 换汇 FUNDS_RESERVED/EXECUTING + 代付 settlement-pending 队列）+ 待释放（FAILED/EXPIRED 订单）+ UNKNOWN（代付/提现） |

- 观察清单项 `WatchItem {itemId, kind: SETTLE_PENDING|RELEASE_PENDING|UNKNOWN, domain, uid, amount, assetOrRoute, status, ageMinutes}`——与 ApprovalItem 同型风格，金额为数字字符串。
- 对账报告在 API 层不做任何修复（只读红线延续）；discrepancies 数组原样透传。
- 全部端点无写入、无状态迁移、无 CAS——仅 SELECT + 服务调用。

## 冻结未来工程矩阵

Create：`modules/admin/http/admin-ops.routes.ts`、`modules/admin/application/ops-view.service.ts`、`apps/platform/test/database/ops-views.integration.spec.ts`（S9OV）。Modify：contracts/admin.ts（WatchItem 类型）；exchange/payout 仓储若需补充查询方法（预计 findSettlePending 等 3 个只读 SELECT）。

## 测试矩阵（S9OV，集成）

- S9OV01 对账合并：三域零差异时合并报告返回；人为篡改后对应域差异浮现
- S9OV02 观察清单三类齐全（待结算/待释放/UNKNOWN）且字段正确
- S9OV03 已终态订单不在任何清单
- S9OV04 RBAC：无角色 403（对账端点 AUDITOR-only 或已认证——计划裁决）
- S9OV05 审计落档（每请求 GRANTED）
- S9OV06 只读性：全部表行数不变

## 边界与不做

- 不做对账修复动作；不做跨域汇总报表（计值等域内逻辑已由各域报告携带）；不做分页（limit 100 固定）。

## 停止条件

任何端点引入写入、观察清单泄露超出运营所需字段。
