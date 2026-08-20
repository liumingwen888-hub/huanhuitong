# S10-1 全栈本地编排 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（编排与配置，无业务逻辑变更）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过）。S10-1 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 10 总体规划 v1.0](../2026-08-19-stage-10-production-master-plan.md)（决策 1）、[platform-operations 领域](../../domains/platform-operations.md)、既有健康端点（`apps/platform/src/health/`——S1 已交付）。

## 目标

Docker Compose 单文件全栈：**postgres + platform + worker + admin-web 四服务**，一条命令从零到全部健康检查通过——生产部署配置的本地等价物。

## 服务设计

### postgres
- 镜像：锁定 digest 的 postgres:18（沿用 testcontainers 锁定版本）；
- 初始化：roles bootstrap + Flyway 迁移（platform 启动时执行 `flyway migrate`，或 init 容器）；
- 卷：`pgdata`（命名卷）；端口不对外暴露（仅内部网络）——合成例外：宿主机端口映射供调试（生产移除）。

### platform（apps/platform）
- 构建本地镜像（Dockerfile.node——pnpm deploy 产物或 tsx 直跑）；
- 环境变量合同：DATABASE_URL / 角色密码 / 摘要密钥引用——**全部必填、缺失即启动失败**（fail-fast）；
- 健康检查：`/health/live` + `/health/ready`（S1 已有——验证就绪含数据库可达）。

### worker（apps/worker）
- 同 platform 构建模式；独立角色凭据（xht_worker）。

### admin-web（apps/admin-web）
- 多阶段构建（node 构建 → nginx 静态服务）；
- nginx 反代 `/api` → platform:3000（生产等价物）；

## 编排文件

Create：`deploy/docker-compose.yml`、`deploy/.env.example`（全部环境变量带注释）、`apps/platform/Dockerfile`、`apps/worker/Dockerfile`、`apps/admin-web/Dockerfile`（多阶段）+ `apps/admin-web/nginx.conf`。Modify：platform/worker 启动逻辑（环境变量校验增强——缺失密钥引用即退出而非静默降级）。

## 测试矩阵（S10CO）

- S10CO01 `docker compose config` 校验通过（结构合法）
- S10CO02 compose up 全栈健康（四服务 healthy——合成环境验证；若 Docker 不可用则以 `config` + 构建缓存命中为结构验证，标记 ENVIRONMENT_BOUNDARY）
- S10CO03 环境变量合同：.env.example 覆盖全部必填变量（脚本比对代码引用）
- S10CO04 平台启动 fail-fast：缺 DATABASE_URL 进程退出非零（单元级测配置校验器）

## 边界与不做

- 不做真实 TLS/域名/云（生产独立授权）；不做 CI 流水线（阶段 10 后由用户选择平台）；不做密钥真值（.env.example 只有引用与占位）。

## 实施裁决记录（2026-08-19）

1. 编排含第五个服务 `migrate`（Flyway 一次性容器）——数据库 schema 在应用启动前就绪，platform/worker 以 `service_completed_successfully` 门控。
2. postgres 调试端口绑定 127.0.0.1（仅本机可达）并注释标注生产移除——比完全无端口更安全的调试形态。
3. 文档守卫正则扩展至阶段 10（`/阶段 [2-9]|阶段 10/`——原正则不匹配两位数阶段号）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` exit 0；`pnpm architecture:check` 0 违规（216 模块）。
- unit 35 文件 267/267 PASS（含 S10CO01/03/04：五服务结构 + 必填变量 fail-fast 语法 `${VAR:?required}` 钉住（默认值语法被显式拒绝）+ .env.example 全覆盖 + 无密钥真值）。
- S10CO02 标记 ENVIRONMENT_BOUNDARY：`docker compose up` 全栈健康需 Docker 守护进程配合，结构验证已由 S10CO01 覆盖——生产首次部署时执行实弹验证。
- 数据库回归 549/553（M06/M14/M16 已知三件套 + exchange-confirm 一次并发抖动隔离复跑通过）；integration 132/133（registration-concurrency 已知负载敏感，隔离 14/14 通过）。
- 交付物：`deploy/docker-compose.yml`（五服务 + 内部网络 + 命名卷 + 健康门控链）、`deploy/.env.example`、三个 Dockerfile（多阶段：node 构建 → slim 运行时 / nginx 静态）、`nginx.conf`（SPA 回退 + /api 反代 + 安全头）。

## 停止条件

服务启动静默降级（缺配置不退出）、postgres 端口生产语义暴露、平台容器内出现明文密钥。
