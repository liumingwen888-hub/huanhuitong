# 决策：技术基础

日期：2026-07-20。需求状态：APPROVED（技术栈基线）；具体部署参数 DRAFT。

## 采用方案

采用 pnpm Monorepo 与 TypeScript strict 的模块化单体。未来结构由 platform、worker、隔离 signer、admin-web 以及 contracts、config、testing 包组成；本轮不创建目录。PostgreSQL 是业务和资金事实来源，复式账本是资金唯一写入口，Outbox、Inbox 与持久任务提供可靠异步。

技术基线为 Node.js 24 LTS、NestJS、grammY Webhook、React + TypeScript + Vite、PostgreSQL 18.x 安全补丁版本、Kysely + pg、Flyway 纯 SQL、Zod 4、Pino、OpenTelemetry、Vitest、fast-check、Testcontainers、dependency-cruiser 与 Linux OCI 容器。

## 方案取舍

推荐模块化单体，因为第一阶段领域多但团队与真实流量尚未证明微服务成本合理；清晰模块接口可在未来按证据拆分。早期微服务方案被拒绝，因为会放大分布式事务、资金一致性、部署和对账复杂度。单一业务进程方案也被拒绝，因为 signer 必须隔离，持久任务与交互请求具有不同可靠性和权限边界。

RabbitMQ 不作为第一阶段默认依赖；Redis 即使采用也不是资金事实源。Signer、Broadcaster 和 Confirmation Worker 职责分离，私钥不进入普通业务进程。运行结构见 [runtime-topology.md](../architecture/runtime-topology.md)。

