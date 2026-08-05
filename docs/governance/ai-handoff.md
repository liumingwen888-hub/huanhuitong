# AI 开发交接协议

状态：APPROVED。交付状态：READY。更新时间：2026-08-05。

本文件是新 AI 或新开发者的交接入口，不复制各领域完整规格。发现内容与权威文档冲突时，按 [权威映射](authority-map.md) 裁决；仍不能裁决时登记到 [P0 开放决策](../product/open-decisions.md)，不得自行猜测。

## 1. 项目要做什么

换汇通是托管账户与资金服务平台。第一阶段以 Telegram Bot 为入口，目标覆盖自动注册、用户账户、余额、充值、提现、内部转账、领取、红包、换汇、法币代付、账单、账户安全、客服、费用、风控、管理后台、审批、审计、对账、监控、备份与恢复。未来 Android/iOS App 只增加访问渠道，仍使用同一内部 UID、资产账户、权威余额、复式账本和风险策略。

成功效果不是“页面能操作”，而是：任何支持渠道看到一致资金事实；重复、并发、重试、宕机恢复和外部 `UNKNOWN` 不产生重复入账、重复付款、负余额或不可审计改账；运营人员不能绕过身份、账本、审批和权限底线。

产品范围以 [vision](../product/vision.md)、[scope](../product/scope.md)、[feature catalog](../product/feature-catalog.md) 和 [domain index](../domains/README.md) 为准。

## 2. 每次会话的强制读取顺序

1. 根目录 [`AGENTS.md`](../../AGENTS.md)。
2. [文档总索引](../00-index.md)。
3. [当前权威状态](../status/current.md)。
4. [唯一下一步](../status/next.md)。
5. [当前工作与最近断点](../status/active-work.md)。
6. [P0 开放决策](../product/open-decisions.md)。
7. [活动计划索引](../plans/active-plan-index.md)。
8. 当前 Task 的 `00-index.md` 及其指定阅读顺序。
9. 与任务直接相关的领域、架构、安全、测试和运维权威文档。
10. Git 启用时读取 `git status --short`、当前分支、远程和最近提交。

不要无差别读取工作区外目录，不把聊天记忆、Skill 文本、历史报告或项目外 ZIP 当作项目事实。项目事实必须已经写入本仓库权威文档。

## 3. 当前精确断点

| 项目 | 状态 |
|---|---|
| 当前总进度 | 第 9/48 步 `WAITING_EXTERNAL_REVIEW` |
| 阶段 0 | `VERIFIED` |
| 阶段 1 总计划 | `READY v1.2.6` |
| 阶段 1 代码 | `BUILDING` |
| Tasks 1–4 | `VERIFIED` |
| 第 8/48 步 / Task 4 | `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS` |
| Task 5 v1.2 | `NOT APPROVED / REPLACED BY v1.3 CANDIDATE` |
| Task 5 v1.3 计划 | `READY v1.3 / WAITING_EXTERNAL_REVIEW` |
| T5R-01/02/04/05/06/07 | `ACCEPT / CLOSED` |
| T5R-03/08 | `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW` |
| Task 5 代码 | `NOT_STARTED` |
| 第 10/48 步 | `NOT_STARTED` |
| Tasks 6–14 | `NOT_STARTED` |
| Telegram/其他业务外部服务/生产部署 | `NOT_STARTED` |

唯一下一步：等待用户外部复审 [Task 5 v1.3](../plans/task-5-inbox-dedup/00-index.md)。没有新的复审结论和第 10/48 步明确授权时，停止在规划状态，不创建或修改七个 Task 5 工程目标。

## 4. 已完成工程与可依赖接口

### Task 1 — 工程骨架

- pnpm Monorepo；`apps/platform`、`apps/worker`、`packages/contracts`、`packages/config`、`packages/testing` 五个 workspace。
- Node.js `24.18.0`、pnpm `11.15.1`、严格 TypeScript、ESM 和可导入构建产物。

### Task 2 — 配置、日志、Telemetry

- `packages/config` 已实现严格键投影、SecretReference/SecretResolver、文件 URL 与 realpath 根门禁、Inbox digest keyring、日志字段策略。
- platform/worker 各自拥有 Pino destination 注入和可注入 OpenTelemetry 生命周期；disabled 默认不联网；shutdown 支持并发、同步重入和失败粘滞。
- 真实 Secret manager、exporter 与 collector 尚未接入。

### Task 3 — 数据库基础

- PostgreSQL 18、Kysely、`pg`、Flyway 纯 SQL 和 Testcontainers fixture 已建立。
- `RoleEnforcingPostgresPool` 在 client 交给 Kysely 前完成固定 `SET ROLE` 门禁。
- 外部只暴露 QueryCreator facade，不暴露 Kysely 的销毁能力；连接关闭失败使用稳定错误边界。
- Flyway 12.11.0 通过 JDBC `role=xht_flyway` 保证所有 housekeeping 连接角色正确。

### Task 4 — Unit of Work

- `apps/platform/src/infrastructure/database/transaction-context.ts`
- `apps/platform/src/infrastructure/database/unit-of-work.ts`
- `apps/platform/test/database/unit-of-work.integration.spec.ts`
- `apps/platform/src/infrastructure/database/database.ts` 和 `apps/platform/test/unit/database.spec.ts` 已按 Task 4 修改。
- 单 callback/单连接/单 PostgreSQL 事务；同步 throw、异步 reject、返回值、回滚、错误传播和连接清理均有合同。
- TransactionContext 禁止逃逸、隐式第二连接、嵌套事务绕过和事务内外部网络副作用。

实施与真实验证的权威证据只取 [verification](../status/verification.md)，不要把计划中的 future tests、TEMP 可执行性实验或代码块当成已运行结果。

## 5. 下一步 Task 5 的施工入口与目标效果

施工唯一入口为 [Task 5 计划索引](../plans/task-5-inbox-dedup/00-index.md)。该索引规定 19 份计划 Markdown、Step 1–40、T5C01–T5C50 和七个 canonical fragments。

冻结未来工程范围：Create 6、Modify 1、Delete 0。

```text
Create packages/contracts/src/inbox-digest.ts
Modify packages/contracts/src/index.ts
Create apps/platform/src/modules/reliability/inbox/inbox.types.ts
Create apps/platform/src/modules/reliability/inbox/telegram-update-digest.ts
Create apps/platform/src/modules/reliability/inbox/inbox.repository.ts
Create apps/platform/test/unit/telegram-update-digest.spec.ts
Create apps/platform/test/database/inbox-repository.integration.spec.ts
```

外部复审通过并获得明确实施授权后，必须按计划的 TDD RED→GREEN 顺序机械写入 canonical fragments，最终实现：

1. `(consumer, external_message_id)` 唯一业务收件键。
2. 完整 parsed Telegram Update 的确定性 canonical JSON 与版本化 HMAC。
3. `claimed`、`duplicate_same_payload`、`conflict`、`digest_key_unavailable` 精确联合。
4. PostgreSQL `clock_timestamp()` 权威租约、`claim_generation`、claimant、inboxId 与 CAS。
5. 过期租约安全重领，旧 claimant 和伪造应用时间不能完成处理。
6. `markProcessed` 与未来身份/Outbox 效果共用调用方已经打开的 Task 4 `TransactionContext`。
7. raw Update、callback data、canonical bytes、key material 和 payload digest 不跨越安全边界。
8. 真实 PostgreSQL/Testcontainers 并发、回滚、故障、权限和资源清理门禁通过。

范围漂移、canonical 哈希漂移、锁文件漂移、缺少实施授权、数据库角色不符、空测试匹配或资源清理失败都应立即停止，而不是自行扩大范围。

## 6. 后续 Stage 1 路线

Task 5 之后依次为：

1. Task 6：Outbox、持久任务与安全 Worker。
2. Task 7：身份领域实体、接口和数据库约束。
3. Task 8：`ResolveOrCreateUid` 并发幂等。
4. Task 9：Telegram Webhook 适配器与默认拒绝边界。
5. Task 10：`/start` 自动注册、原子编排和主菜单任务。
6. Task 11：日志字段白名单与敏感数据泄露测试。
7. Task 12：dependency-cruiser 架构依赖门禁。
8. Task 13：集成、真实并发和失败恢复验收。
9. Task 14：文档、索引、状态与最终验证同步。

完整顺序、依赖和验收以 [阶段 1 总计划](../plans/2026-07-20-stage-1-foundation-identity-implementation-plan.md) 为准。后续资金、链上、换汇、代付、管理后台和生产运维阶段以 [roadmap](../plans/roadmap.md) 为准，不得提前推定供应商、资产网络、法律主体或合规参数。

## 7. 技术、资金与安全不可变约束

- PostgreSQL 是业务与资金事实源；复式账本是资金变化的唯一写入口。
- 业务模块不得直接改余额或账本表；分录不可变，纠错使用冲正或补偿。
- 金额跨边界使用十进制字符串；JavaScript `number` 不承载金额。
- `UNKNOWN`、超时或网络异常不等于失败，必须查询权威状态和对账后再决定。
- 内部 UID 是资产主体；Telegram user ID 是可替换渠道绑定，username 仅是展示属性。
- 管理侧默认拒绝，使用独立管理员身份、RBAC、数据范围、字段权限、Maker-Checker、重新认证和追加式审计；发起人不得自审。
- 私钥、Bot Token、支付密码原文/哈希、验证码、TOTP key、恢复凭证和真实 Secret 不进入日志、trace、普通审计、Outbox/Inbox 正文或文档。
- 支付密码原文仅可在专用凭证组件短期内存中组合和验证，并立即清除；资金领域只接收短期授权证明或引用。

## 8. 验证基线与命令

锁定工具：Node.js `24.18.0` x64、pnpm `11.15.1`。镜像精确版本和 digest 见根目录 `toolchain-lock.json`。

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm typecheck
pnpm test:unit
pnpm test:db
```

- `pnpm test:db` 需要本地 Docker/PostgreSQL/Testcontainers 授权和执行后的资源清理核验。
- `pnpm test:all` 当前会因未来 Task 12 才创建的 `.dependency-cruiser.cjs` 缺失而在 architecture check 停止；不得提前创建该文件或把这个事实写成 Tasks 1–4 阻断。
- 最新 Task 4 实施证据包括 build/typecheck exit 0、unit 132/132、database 203/203、Task 4 integration 138/138，以及 Docker/Testcontainers 容器和网络残留 0。
- Task 5 v1.3 的 TEMP 计划可执行性结果只证明计划可构建/可测试，不证明 Task 5 已实施。

完成声明前必须重新运行与本轮改动相匹配的检查，并在 [verification](../status/verification.md) 记录命令、结果、未运行项和理由。

## 9. GitHub 与仓库卫生

- GitHub 目标：`liumingwen888-hub/huanhuitong`，可见性必须为 `PRIVATE`。
- 默认分支：`main`。
- `.gitignore` 排除 `node_modules`、dist、coverage、缓存、TEMP、日志、环境变量、密钥文件和项目外交付包。
- 项目外 ZIP、报告和交付物保存在当前机器的 `C:\Users\Administrator\Desktop\Codex`，不进入仓库。
- 推送前检查 `git status`、完整 staged diff、Secret 扫描、UTF-8、Markdown fence、相对链接和锁文件。
- 本次私有仓库首发授权消费后，未来 commit、push、PR、release、部署和外部写入仍需用户明确授权。

## 10. 每次交接必须留下的内容

1. 当前步骤与 Task 状态。
2. 实际新增、修改、删除的文件。
3. 已执行命令、字面结果和退出状态。
4. 未执行或失败的检查及原因。
5. 锁文件、依赖、数据库、容器、Git 和外部服务是否发生变化。
6. 未解决阻断和 P0 决策。
7. 唯一下一步及其前置授权。
8. Secret/TEMP/资源残留检查。

状态摘要不得替代权威文档，历史记录不得被改写成当前事实。
