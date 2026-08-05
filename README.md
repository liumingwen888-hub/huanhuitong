# 换汇通（HuanHuiTong）

换汇通是一个以资金安全和可证明正确性为优先级的托管账户与资金服务平台。第一阶段以 Telegram Bot 为用户入口，规划提供账户、资产余额、充值、提现、内部转账、领取、红包、数字资产换汇、法币代付、账单、账户安全、客服、风控、审批、审计和对账能力；未来 Android/iOS App 复用同一内部 UID、复式账本和风控体系。

> 本仓库必须保持 **PRIVATE**。禁止提交真实 Secret、Bot Token、私钥、验证码、支付密码、生产凭据、生产数据、用户数据或项目外交付物。

## 当前进度（2026-08-05）

| 项目 | 当前状态 |
|---|---|
| 总进度 | 第 9/48 步 `WAITING_EXTERNAL_REVIEW` |
| 阶段 0 | `VERIFIED` |
| 阶段 1 总计划 | `READY v1.2.6` |
| 阶段 1 代码 | `BUILDING` |
| Tasks 1–4 | `VERIFIED` |
| Task 4 | `IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS` |
| Task 5 详细计划 | `READY v1.3 / WAITING_EXTERNAL_REVIEW` |
| Task 5 代码 | `NOT_STARTED` |
| 第 10/48 步 | `NOT_STARTED` |
| Tasks 6–14 | `NOT_STARTED` |
| 生产部署 | `NOT_STARTED` |

当前唯一下一步是：**等待用户外部复审 Task 5 v1.3**。在收到新的复审结论和第 10/48 步明确实施授权前，不实施 Task 5，不写入计划中的七个未来工程目标，不运行真实 Telegram 或其他业务外部服务。

准确状态以 [`docs/status/current.md`](docs/status/current.md) 和 [`docs/status/next.md`](docs/status/next.md) 为准；本 README 只提供入口摘要。

## 已完成的工程基础

1. **Task 1 — Monorepo 与严格 TypeScript 工程骨架**：建立 `platform`、`worker`、`contracts`、`config`、`testing` 五个 workspace 及可导入构建产物。
2. **Task 2 — 配置、结构化日志与 OpenTelemetry 基础**：实现 strict 配置、SecretReference/Resolver 边界、日志白名单/脱敏、Inbox digest keyring，以及 platform/worker 可注入 telemetry 生命周期。
3. **Task 3 — PostgreSQL/Kysely/Flyway/Testcontainers 基础**：实现角色强制连接池、受限 Database facade、锁定镜像、本地真实数据库 fixture、Flyway migration 与资源清理。
4. **Task 4 — Unit of Work 与 PostgreSQL 事务边界**：实现单连接事务上下文、禁止逃逸、同步/异步故障回滚、SQL 策略与真实 PostgreSQL 集成验证。

这些基础能力不等于产品功能已经上线。Telegram 注册、用户身份、Inbox 业务持久化、Outbox worker、账本、充值、提现、转账、红包、换汇、代付、管理后台和生产部署仍按路线图逐步实施。

## 下一目标及应达到的效果

Task 5 的权威入口是 [`docs/plans/task-5-inbox-dedup/00-index.md`](docs/plans/task-5-inbox-dedup/00-index.md)。外部复审通过并获得第 10/48 步授权后，实施应达到：

- Telegram Update 以 `(consumer, external_message_id)` 唯一去重；
- 完整 parsed Update 使用确定性 canonical JSON 和版本化 HMAC；
- 精确区分首次认领、同载荷重复、异载荷冲突和历史 key 不可用；
- PostgreSQL 权威时间、租约、claim generation、claimant 与 CAS 保证崩溃后安全重领；
- `markProcessed` 与未来身份/Outbox 业务效果共享同一 Task 4 `TransactionContext`；
- raw Update、canonical bytes、key material、digest 与敏感内容不进入日志、trace、普通审计或 Outbox 正文；
- 真实 PostgreSQL/Testcontainers 并发、回滚、连接清理和权限矩阵全部通过。

## 技术方向

- Node.js `24.18.0`、pnpm `11.15.1`、TypeScript strict/ESM；
- 模块化单体 `apps/platform` + 后台任务 `apps/worker`；
- PostgreSQL 18.x 是业务与资金事实源；
- Kysely + `pg` 负责类型安全数据库访问，Flyway 纯 SQL 负责迁移；
- Vitest、fast-check、Testcontainers、dependency-cruiser 形成测试与架构门禁；
- Pino 与 OpenTelemetry 提供受控日志和遥测接口；
- grammY 仅存在于未来 Telegram 适配层，不进入领域核心；
- 所有资金变化只能经复式账本，JavaScript `number` 禁止承载金额；
- 外部状态为 `UNKNOWN` 时保持不确定并查询/对账，禁止猜测失败后自动重付。

完整技术事实见 [`docs/architecture/runtime-topology.md`](docs/architecture/runtime-topology.md)、[`docs/architecture/domain-map.md`](docs/architecture/domain-map.md)、[`docs/architecture/data-and-money-flow.md`](docs/architecture/data-and-money-flow.md) 和 [`docs/architecture/ledger-model.md`](docs/architecture/ledger-model.md)。

## 仓库结构

```text
apps/
  platform/                 平台应用与数据库事务边界
  worker/                   后台任务进程基础
database/
  migrations/               Flyway SQL migrations
docs/
  00-index.md               唯一文档导航入口
  product/                  产品范围与功能
  architecture/             系统、领域、数据与资金架构
  domains/                  17 个领域的权威规则
  security/                 威胁、风险与安全门禁
  testing/                  测试策略与验收门禁
  plans/                    阶段计划和 Task 详细计划
  status/                   当前状态、下一步与验证证据
  governance/               权威映射、状态模型与 AI 交接
packages/
  config/                    配置、Secret 边界、日志策略
  contracts/                 跨边界版本化合同
  testing/                   共享测试包骨架
AGENTS.md                    项目级 AI/开发协作规则
```

## 新开发者或 AI 如何接手

不要从聊天记录猜测状态。进入仓库后严格依次读取：

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/00-index.md`](docs/00-index.md)
3. [`docs/status/current.md`](docs/status/current.md)
4. [`docs/status/next.md`](docs/status/next.md)
5. [`docs/status/active-work.md`](docs/status/active-work.md)
6. [`docs/product/open-decisions.md`](docs/product/open-decisions.md)
7. [`docs/plans/active-plan-index.md`](docs/plans/active-plan-index.md)
8. 当前计划 [`docs/plans/task-5-inbox-dedup/00-index.md`](docs/plans/task-5-inbox-dedup/00-index.md)
9. [`docs/governance/ai-handoff.md`](docs/governance/ai-handoff.md)

完整接手检查表、已完成证据、下一步停止条件和目标效果统一维护在 [`docs/governance/ai-handoff.md`](docs/governance/ai-handoff.md)。

## 本地工具与命令

要求使用锁定版本：

```text
Node.js 24.18.0 x64
pnpm 11.15.1
```

新克隆环境安装依赖时保持 lockfile 不变：

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm typecheck
pnpm test:unit
```

真实数据库测试需要本地 Docker，并会使用 `toolchain-lock.json` 锁定的 PostgreSQL/Flyway linux/amd64 镜像：

```powershell
pnpm test:db
```

`pnpm test:all` 当前会在架构门禁处因 `.dependency-cruiser.cjs` 尚未由未来 Task 12 建立而停止；这是已知未来门禁，不表示 Tasks 1–4 的既有验证失效。不得为了让总命令变绿而提前创建 Task 12 配置。

## 安全与开发底线

- PostgreSQL 是业务与资金事实源，复式账本是资金变化的唯一入口。
- 禁止业务模块直接修改余额或账本表；历史分录不可变，纠错使用冲正/补偿。
- 内部 UID 是账户主体；Telegram `user.id` 是可替换绑定渠道，`username` 不是所有权证明。
- 私钥、Bot Token、验证码、支付密码原文、恢复凭证和真实 Secret 不进入仓库、日志、trace、错误或普通审计。
- 管理能力服务端默认拒绝，使用独立管理员身份、RBAC、Maker-Checker、重新认证和追加式审计。
- 未获明确授权，不新增范围外代码、依赖、迁移、外部连接、共享/生产数据库或部署。

## 文档入口

- [完整文档索引](docs/00-index.md)
- [当前权威状态](docs/status/current.md)
- [唯一下一步](docs/status/next.md)
- [最新验证证据](docs/status/verification.md)
- [阶段路线图](docs/plans/roadmap.md)
- [P0 开放决策](docs/product/open-decisions.md)
- [AI 交接协议](docs/governance/ai-handoff.md)
