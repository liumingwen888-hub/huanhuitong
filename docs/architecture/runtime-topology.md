# 运行拓扑

需求状态：APPROVED。交付状态：DESIGNING。

本文件同时区分已建立的工程能力与未来实现。Task 1 已创建 platform、worker、contracts、config、testing 五个 workspace 及可导入 dist；Task 2 已实现配置、结构化日志和可注入 telemetry 基础；Task 3 已实现并用本地 Testcontainers 验证 PostgreSQL/Kysely/Flyway 最小数据库底座；Task 4 已实现并验证单连接 Unit of Work 与 PostgreSQL 事务边界。Task 5 v1.3 仅完成详细计划并等待外部复审，代码尚未开始。Telegram、真实业务进程接线、collector、共享/生产数据库和部署仍未启动。

## Monorepo 结构

- apps/platform：Task 1 工程骨架已存在；未来承载 NestJS 模块化单体、领域用例、HTTP API、Telegram Webhook、管理 API 与事务边界。
- apps/worker：Task 1 工程骨架已存在；未来承载持久任务、Outbox 消费、Inbox 处理、链上扫描、供应商查询和对账。
- apps/signer：NOT_STARTED；未来隔离签名进程，只验证签名策略与请求授权，不处理产品规则。
- apps/admin-web：NOT_STARTED；未来 React + TypeScript + Vite 管理界面，只通过服务端 API 操作。
- packages/contracts：Task 1 可构建骨架已存在；未来承载跨进程版本化命令、事件和数据合同。
- packages/config：已实现已知环境键投影、Zod strict、SecretReference/SecretResolver 分离、file URL 原始路径与 realpath 根门禁、request-scope Inbox digest keyring、运行时日志 policy；Secret 值和 key material 仅在受控短生命周期内存在。
- packages/testing：Task 1 可构建骨架已存在；共享测试构造器、属性测试与容器测试工具尚未实现。

## 进程与权限

platform 可读写业务库但不能访问私钥；worker 按任务最小权限访问业务库与外部只读/写接口；signer 不能访问用户会话或任意业务表；admin-web 不持有服务凭证。Broadcaster 与 Confirmation Worker 逻辑属于 worker 边界但权限和任务类型隔离，未来只有经度量证明需要时才拆进程。

## 数据与消息

PostgreSQL 18.x 安全补丁版本承载交易、账本、Outbox、Inbox 和持久任务。数据库事务同时提交业务状态、账本分录和 Outbox。异步消费者以事件 ID、业务键和处理收件箱去重。RabbitMQ 不是第一阶段默认依赖；若未来引入，只传递通知，不成为资金事实源。Redis 不保存权威余额或不可恢复状态。

## 渐进建设

- 阶段 1：platform 建立 PostgreSQL 事务边界、Unit of Work、配置校验、结构化日志、OpenTelemetry 接口和敏感字段日志过滤；worker 建立 Inbox、Outbox 与持久任务最小框架。这些能力支持 Telegram Update、通知和后续资金任务。
- 第一个资金功能前：platform 提供版本化的费用、风险、限额、服务端管理授权和追加式审计合同；业务订单可关联账本命令；worker 提供可重跑的最小对账任务接口。
- 提现前：管理 API 使用独立管理员身份、Maker-Checker 与高风险重新认证，Signer 只接受具有策略审批和审计证据的请求。
- 阶段 9/10：在既有合同上补齐完整管理 UI、角色和风险/费用运营，以及生产容量、完整告警、备份恢复、灾难演练和发布加固。不得把阶段 9/10 理解为这些横切能力的首次出现。

## 技术约束

Node.js 24 LTS、TypeScript strict、NestJS、pnpm、grammY Webhook、Kysely + pg、Flyway 纯 SQL、Pino、OpenTelemetry、Vitest、fast-check、Testcontainers、dependency-cruiser 和 Linux OCI 容器为固定建议。阶段 1 v1.2.6 计划锁定 Node `24.18.0`、pnpm `11.15.1`、`vitest.config.ts`/`test.projects` 和精确直接依赖矩阵。Task 1 已建立五 workspace 的真实 build/main/types/exports；首次 lockfile-only/ignore-scripts 已审查。Task 3 已锁定并运行 PostgreSQL 18.4 与 Flyway 12.11.0 的精确 linux/amd64 child digest，本地容器在测试后全部清理；共享/生产数据库和部署尚未开始。

## Task 2 已实现边界与 Tasks 3–14 计划边界

数据库 bootstrap 管理员只负责首次初始化。Flyway、platform、worker 分别以独立 LOGIN 取得 `xht_flyway`、`xht_platform`、`xht_worker` NOLOGIN 角色成员资格，并在连接上执行受控 `SET ROLE`；正常运行不得使用超级用户。platform 的 Telegram 边界使用 grammY webhook callback、注入 BotInfo 且不调用 `bot.start()`；grammY 类型不得流入领域。worker 的 Outbox 是 at-least-once，租约所有者、token 和代次必须用于所有 CAS 更新；外部连接禁用时不注册 handler 或进入 WAITING_CONFIGURATION。

Task 2 的 file Secret reference 已在 URL 解析前拒绝 dot/dotdot、空中间片段、反斜杠、百分号编码、query、fragment 和控制字符；POSIX 路径按安全段接受，Windows 只允许第一段精确 `[A-Za-z]:` 且至少有一个后续安全段，随后统一执行 canonical URL 与 realpath 允许根校验。keyring 只保留单一受管理内部 Buffer，每次 `withMaterial` 使用 finally 清零的借用副本；公共 key、retained 数组和 keyring 运行时冻结，两个 status 相关时间字段为 `string | undefined`。经证明不可达的两个稳定错误码未保留，其余 20 个公开可触发错误码均有直接测试。platform/worker 各自拥有 Pino destination 注入与 OpenTelemetry API 适配，不互相导入；disabled 为默认且不调用 factory 或网络，otlp 只调用注入接口。shutdown 开始即关闭新 span，并在 exporter shutdown 真正开始前缓存同一 Promise；普通并发、同步重入及后续调用共享成功或失败结果，exporter shutdown 最多一次。真实 exporter 与 collector 连接仍为 NOT_STARTED。

Task 3 v1.5 已实现该拓扑合同：platform/worker 各自以 `RoleEnforcingPostgresPool.connect()` 在 client 交给 Kysely 前完成固定角色门禁；会抛错的 reserve hook 使用 0。真实 Kysely 实例仅由 factory 闭包持有，对外是独立 QueryCreator runtime facade；本体和安全链均无 `destroy`/`Symbol.asyncDispose`，wrapper/handle 的关闭失败只暴露稳定 `DATABASE_CLOSE_FAILED`。PostgreSQL 与 Flyway 两条容器构建路径都显式使用锁定的 `linux/amd64` 平台。Flyway JDBC 在每条连接建立时强制 `role=xht_flyway`，保留 afterConnect callback 二次验证；one-shot 禁用 Redgate telemetry，以“进程已停止”让 `start()` 返回 handle。raw Dockerode 日志请求由独立 5 秒 request timeout、AbortController 与显式 race 限界，Buffer/stream 返回后再由独立 5 秒 stream timeout 和严格有界 frame parser验证完整性，分别聚合 stdout、stderr、frame-order 后 inspect 真实 ExitCode。fixture/runner/spec 的唯一 owner 与清理位置已经真实 database 65/65 和最终残留 0 证明；这些是本地测试基础，不表示共享或生产数据库已部署。

## 阶段 1 实施事实（2026-08-17，Task 14 同步）

Tasks 1–13 已实施并通过外部复审：工程骨架、配置/日志/OTel、PostgreSQL/Kysely/Flyway、Unit of Work、Inbox 去重（canonical JSON + 版本化 HMAC）、Outbox/持久任务 Worker、身份合同、ResolveOrCreateUid 并发幂等、Telegram Webhook 默认拒绝边界、/start 原子编排与主菜单、日志白名单、架构依赖门禁、23 项集成验收。23 项验收全 PASS；`pnpm test:all` 全链与 `pnpm docs:check` 通过。运行环境：macOS/arm64、官方 Node 24.18.0-darwin-arm64、Docker amd64 模拟锁定镜像；类型包 devDeps 受控漂移（lockfile `59D72A2A…3C73B`）。
