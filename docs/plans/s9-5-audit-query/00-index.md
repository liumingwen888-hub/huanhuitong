# S9-5 审计查询 API 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（只读检索层）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过）。S9-5 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 9 总体规划 v1.0](../2026-08-19-stage-9-admin-master-plan.md)（S9-5 任务行）、[admin-and-audit 领域](../../domains/admin-and-audit.md)（"审计员只读检索授权范围内记录"、"不可删除审计"）、[V1 audit_events](../../../database/migrations/V1__stage_1_identity_reliability.sql)（追加式，平台仅 INSERT+SELECT）。

## 目标

追加式审计事件的只读检索端点：**时间/主体/类别过滤 + 分页 + 字段最小化**——零新表、零写入（检索不改审计流）。

## 端点设计

| 路由 | 角色 | 级别 | 说明 |
|---|---|---|---|
| GET /admin/audit/events?from=&to=&actor=&category=&cursor=&limit= | AUDITOR（审计员专职——其他角色 403） | BASIC | 检索审计事件，按时间倒序，keyset 分页 |

- **过滤维度**：`from`/`to`（ISO 时间窗）、`actor`（actor_ref 精确或 'anonymous'）、`category`（event_type 前缀匹配，如 `ADMIN_API_`、`WITHDRAWAL_`——白名单前缀集防任意 LIKE 注入面）；
- **分页**：keyset（`cursor = occurred_at + audit_event_id` 复合游标，避免 OFFSET 深翻页）；limit 默认 50、上限 200；
- **响应**：`{items: [{auditEventId, eventType, actorType, actorRef, subjectRef, outcome, correlationId, occurredAt}], nextCursor}`——**字段即表列原样**，audit_events 本身无敏感载荷（阶段 1 设计即如此：event_type/outcome 均为类别码而非自由文本），无需运行时脱敏——此为"字段最小化已由 schema 层完成"的裁决记录；
- **角色**：AUDITOR 专职（AUDIT 查询权与资金操作权分离——FINANCE/SUPPORT 不可查审计，防止操作者审查自己的痕迹）。

## 冻结未来工程矩阵

Create：`modules/admin/application/audit-query.service.ts`、`modules/admin/http/admin-audit.routes.ts`、`apps/platform/test/database/audit-query.integration.spec.ts`（S9AQ）。Modify：contracts/admin.ts（AuditEventItem 类型 + 查询参数类型）。

## 测试矩阵（S9AQ，集成）

- S9AQ01 时间窗过滤精确（from/to 边界含/不含）
- S9AQ02 actor 过滤（admin id / anonymous）
- S9AQ03 category 前缀过滤（ADMIN_API_ 前缀匹配 + 非白名单前缀 400）
- S9AQ04 keyset 分页：第二页不重叠不遗漏；limit 上限 200 强制
- S9AQ05 角色矩阵：无 AUDITOR 角色 403；AUDITOR 200
- S9AQ06 审计检索自身也被审计（元审计：检索请求落 audit_events）

## 边界与不做

- 不做审计导出/流式下载（数据量大时属阶段 10 运维工具）；不做自由文本搜索（event_type 为枚举类别码）；不做删除/修改（表结构即不允许）。

## 实施裁决记录（2026-08-19）

1. AdminApiRouter 增 query 参数传递（GET 端点的查询串直达处理器）——路由能力最小扩展。
2. Keyset 复合游标实现为 (occurred_at, audit_event_id) 元组比较——row-wise comparison 语义精确，避免 OFFSET。
3. 元审计的测试隔离：检索请求自身的审计事件在同测试内污染后续断言——断言改用类别过滤隔离。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（213 模块、221 依赖）。
- unit 33 文件 260/260 PASS。
- S9AQ01–S9AQ06 全 PASS：时间窗过滤精确（含非法日期 400）、actor 精确匹配（含注入尝试 400）、类别白名单前缀（含注入尝试 400）、keyset 分页零重叠零遗漏（60+ 行两页验证 + limit 200 强制）、AUDITOR 专职（无角色 403/有角色 200）、检索自身落审计（元审计）。
- 数据库回归 543/546（M06/M14/M16 已知环境边界项）；integration 121/121。
- 交付物：`audit-query.service.ts`（三过滤 + keyset 分页 + 白名单）、`admin-audit.routes.ts`（AUDITOR 专职端点）、router query 传递、contracts AuditEventItem/QueryParams/Result、S9AQ 集成规格。

## 停止条件

检索端点引入任何写入（除基座逐请求审计）、LIKE 注入面、深翻页 OFFSET。
