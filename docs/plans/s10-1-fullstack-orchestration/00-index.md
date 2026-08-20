# S10-1 全栈本地编排 详细计划索引

计划版本：`v1.0`。风险级别：`L2`（编排与配置，无业务逻辑变更）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S10-1 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 10 总体规划 v1.0](../2026-08-19-stage-10-production-master-plan.md)（决策 1）、[platform-operations 领域](../../domains/platform-operations.md)、[既有健康端点](../../../apps/platform/src/health/)（S1 已交付）。

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

## 停止条件

服务启动静默降级（缺配置不退出）、postgres 端口生产语义暴露、平台容器内出现明文密钥。
