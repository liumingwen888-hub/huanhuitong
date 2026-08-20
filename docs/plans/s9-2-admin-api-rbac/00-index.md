# S9-2 Admin API 基座与 RBAC 中间件 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（运营平面 API 信任边界）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S9-2 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 9 总体规划 v1.0](../2026-08-19-stage-9-admin-master-plan.md)（已裁决决策 4）、[admin-and-audit 领域](../../domains/admin-and-audit.md)（默认拒绝、追加审计）、[S9-1](../s9-1-admin-auth/00-index.md)（认证服务已 VERIFIED）、[既有 HTTP 模式](../../../apps/platform/src/modules/telegram/http/telegram-webhook.controller.ts)（框架无关纯控制器）。

## 目标

Admin API 的路由基座与中间件链：**默认拒绝路由表 → 会话校验 → 角色校验 → 提升级校验 → 审计包裹 → 业务处理**。本任务只带认证端点（登录/登出/提升/会话探测）；业务端点（审批/对账/审计/配置）由 S9-3～S9-6 挂载。

## 设计（框架无关纯路由器，可无服务器测试）

### AdminApiRouter（modules/admin/http）
```
request {method, path, bearerToken?, body?}
  → 404  无匹配路由（默认拒绝：路由表显式注册才存在）
  → 401  会话缺失/无效/过期（PUBLIC 路由除外）
  → 403  角色不足 / 提升级不足（ELEVATION_REQUIRED 附带）
  → 2xx 业务处理
```
- **路由表**：`{method+path → {requiredRole, requiredLevel, handler}}` 显式注册；未注册即 404——权限不是配置出来的允许，是注册出来的少数路径。
- 角色经 AdminAuthorizer（活跃角色 + 未撤销授权）；提升级经 requireSession(ELEVATED)。
- 响应形状与既有控制器一致 `{status, json}`；错误体 `{code}`（contracts AdminApiErrorCode）。

### 审计包裹（每请求一条，含拒绝）
- 拒绝（401/403/404）也记录：`actor_ref = bearer 的 admin_id 或 'anonymous'`、`outcome = DENIED_*`；
- 成功：`outcome = GRANTED`；
- event_type = `ADMIN_API_{METHOD}_{PATH规范化}`；correlation_id 每请求生成；
- 追加式：audit_events 只有 INSERT（V1 既有授权）。

### 认证端点（本任务挂载）
| 路由 | 角色 | 级别 |
|---|---|---|
| POST /admin/auth/session（登录） | PUBLIC | — |
| DELETE /admin/auth/session | 任意管理员 | BASIC |
| POST /admin/auth/elevation | 任意管理员 | BASIC |
| GET /admin/auth/whoami | 任意管理员 | BASIC |

登录为 PUBLIC 但带自审计（失败也记录——暴力尝试可见）。

## 冻结未来工程矩阵

Create：`modules/admin/http/{admin-api.router.ts, admin-routes.ts}`、`apps/platform/test/http/admin-api.spec.ts`（S9RB）。Modify：contracts/admin.ts（AdminApiErrorCode 扩充 + 响应类型）。

## 测试矩阵（S9RB，http 项目单元级 + Fake UOW）

- S9RB01 登录成功 → 200 + 令牌；审计 GRANTED
- S9RB02 未注册路径 404 默认拒绝；注册路径但错方法 404
- S9RB03 无令牌/坏令牌/过期 → 401；审计 DENIED_SESSION
- S9RB04 角色不足 → 403（ADMIN_AUTHORIZED_CODE_DENIED）；审计 DENIED_ROLE
- S9RB05 提升级不足 → 403 ELEVATION_REQUIRED；提升后通过
- S9RB06 登录失败（密码错）→ 401 + 审计 DENIED_LOGIN（暴力可见）
- S9RB07 whoami 返回会话与管理员快照；logout 后再测 401

## 边界与不做

- 不做业务端点（S9-3~6）；不做真实 HTTP 服务器挂载（S9-7 前端联调时接 Nest/Express）；不做速率限制（复用登录锁定，API 级限流阶段 10）。

## 停止条件

任何未注册路径可达、拒绝路径缺审计、审计可被 UPDATE/DELETE。
