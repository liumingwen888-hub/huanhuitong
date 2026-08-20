# S9-7 admin-web 前端 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（纯展示层，零资金逻辑）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S9-7 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 9 总体规划 v1.0](../2026-08-19-stage-9-admin-master-plan.md)（决策 1/3：React 18 + Vite + TS；四核心页）、[S9-2~S9-6 六组 Admin API 端点](../s9-2-admin-api-rbac/00-index.md)（已全部 VERIFIED）。

## 目标

workspace 内新 app `apps/admin-web`：React 18 + Vite + TypeScript SPA，零运行时 UI 框架依赖（原生 fetch + 最小 CSS），对接六组已验证 Admin API 端点。

## 关键裁决

1. **零 UI 框架依赖**：不引 antd/MUI——原生 HTML + 一份 CSS 文件。理由：最小供应链面（后台是高价值目标）、页面仅四张、团队后续可自行换装。
2. **零客户端状态库**：React 内置 state + Context（令牌与会话提升态）。理由同上。
3. **测试策略**：不引 React 测试框架——**API 客户端模块的纯函数测试**（请求构造/响应解析/错误映射）在 node 环境单测；组件渲染正确性由 E2E 验收（阶段 10 生产硬化接 Playwright，此记录在案）。构建产物 typecheck + build 为硬关卡。

## 页面设计

| 页面 | 端点 | 要素 |
|---|---|---|
| 登录 | POST /admin/auth/session | 用户名+密码+TOTP；令牌存 sessionStorage（XSS 面最小化——不 localStorage）；401/LOCKED 错误文案 |
| 审批台 | GET /admin/approvals/pending + POST decide/resolve | 待审列表（kind 徽标）+ 逐单 APPROVE/REJECT（REJECT 必填 reason）+ 代付 RESOLVE 按钮 |
| 对账视图 | GET /admin/ops/reconciliation + /admin/ops/watchlist | 三域差异卡片（零差异绿/有差异红）+ 观察清单表格 |
| 审计查询 | GET /admin/audit/events | 过滤表单（时间/actor/类别下拉）+ keyset 下一页 |
| 配置发布 | GET/POST /admin/config/drafts + publish/reject | 草稿表单（目标表下拉 + JSON payload 编辑）+ 待审清单 + 发布/拒绝 |

- 顶部导航栏：当前管理员 + 会话剩余时间 + 登出；ELEVATED 操作前弹重认证对话框（POST /admin/auth/elevation）。

## 工程结构

```
apps/admin-web/
  package.json (react, react-dom, vite, @vitejs/plugin-react, typescript)
  vite.config.ts (build → dist/)
  src/main.tsx, App.tsx, api/client.ts, api/endpoints.ts
  src/pages/{LoginPage, ApprovalsPage, OpsPage, AuditPage, ConfigPage}.tsx
  src/styles.css
  test/api-client.spec.ts (S9FE)
```

## 测试矩阵（S9FE，单元——纯函数）

- S9FE01 请求构造：Bearer 头、JSON 体、query 串序列化
- S9FE02 响应解析：2xx JSON / 204 / 错误体 code 映射
- S9FE03 会话过期自动登出（401 拦截）
- S9FE04 分页游标拼接（nextCursor → cursor 参数）

## 边界与不做

- 不做 SSR/路由库（五页 tab 切换）；不做国际化（中文固定）；不做主题（一份 CSS）；不做 Playwright E2E（阶段 10）。

## 停止条件

供应链超出 react/react-dom/vite/plugin-react 四依赖、令牌进 localStorage、组件内出现资金逻辑。
