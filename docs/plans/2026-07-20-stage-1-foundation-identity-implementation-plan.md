# 阶段 1 工程基础、可靠性底座、身份、自动注册和 Telegram 绑定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 只有用户另行授权代码实施并明确选择执行方式后，才使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development` 逐任务执行；本计划不替用户选择执行方式。所有步骤使用复选框跟踪。

计划版本：`v1.2.6`。Task 1 外部复审修订日期：`2026-07-21`；Task 2 外部复审修订日期：`2026-07-23`。

计划状态：`READY`。阶段 1 代码为 `READY`（2026-08-17：Tasks 1–13 VERIFIED、23 项验收全 PASS、Task 14 文档同步完成；等待用户验收实现）。历史执行期间阶段 1 代码为 `BUILDING`；Task 1、[Task 2 v1.2.6](2026-07-21-stage-1-task-2-config-observability-implementation-plan.md)、[Task 3 v1.5](2026-07-23-stage-1-task-3-database-foundation-implementation-plan.md) 与 [Task 4 v1.10 / LAYOUT-S1](task-4-unit-of-work/00-index.md) 均为 `VERIFIED`。第 8/48 步与 Task 4 实施结果已 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`。Task 5 [独立详细计划 v1.3](task-5-inbox-dedup/00-index.md) 为 `READY v1.3 / WAITING_EXTERNAL_REVIEW`，代码 NOT_STARTED；第 9/48 步 WAITING_EXTERNAL_REVIEW，第 10/48 步与 Tasks 6–14 NOT_STARTED。

**Goal:** 在不引入资金能力和真实外部连接的前提下，建立可验证的 pnpm Monorepo、platform/worker 进程、PostgreSQL 可靠性底座，以及并发安全的 Telegram `/start` 自动注册、UID 解析、绑定和主菜单任务链路。

**Architecture:** 采用 TypeScript strict 的模块化单体：Telegram 只在 platform 适配层出现，identity 保持渠道无关；platform 在一个 PostgreSQL 事务中写入 Inbox、身份状态和 Outbox，worker 通过租约和幂等键处理 Outbox/持久任务。数据库唯一约束是并发注册与绑定唯一性的最终防线，外部发送在提交后由 Outbox 驱动，失败不回滚已提交的 UID。

**Tech Stack:** Node.js 24 LTS、pnpm Monorepo、TypeScript strict、NestJS、grammY Webhook、PostgreSQL 18.x 安全补丁版本、Kysely + `pg`、Flyway 纯 SQL、Zod 4、Pino、OpenTelemetry、Vitest、Testcontainers PostgreSQL、dependency-cruiser；Linux OCI 仅作为未来运行目标，本阶段不创建生产部署。

## Global Constraints

- 阶段 0 产品、架构、治理与索引基线已经由用户验收，交付状态为 `VERIFIED`。
- Task 1 已建立五工作区真实 build、main/types/exports 和 package-name smoke 验收；Task 2–14 不因 Task 1 完成自动获得实现授权。
- 本计划是 L3 身份、并发、数据库和外部回调边界计划；默认拒绝缺失、无效、畸形、重复和冲突输入。
- TypeScript 全部启用 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 和 `useUnknownInCatchVariables`。
- `Telegram user.id` 在完成 Zod 边界解析后立即以十进制字符串进入 TypeScript；数据库使用 `text`，禁止 32 位整数，禁止以 username 作为唯一身份。
- 内部 UID 使用 PostgreSQL `uuid` 和 `gen_random_uuid()`，不编码时间、渠道、地区或业务含义。
- `channel_bindings` 的有效 `(channel_type, external_user_id)` 必须唯一，一个有效 Telegram 绑定只能解析到一个 UID。
- 并发首次注册必须由数据库唯一约束、`INSERT ... ON CONFLICT` 和事务保证，不允许以“先查后插”作为唯一控制。
- 自动注册事务只创建 UID、Membership、Telegram 绑定、最小资料、注册幂等记录和身份 Outbox 事件；不得创建资产、账本、余额、钱包、地址、网络或交易对记录。
- `UidCreatedV1` 没有资金效果；重复 Update、重复 Outbox 或重复消费不能再次发布该事件或产生不可逆副作用。
- Inbox 仅保存消息标识、版本化 HMAC 摘要、摘要密钥版本和处理状态；完整 Telegram Update、canonical bytes、消息正文、callback 原始载荷或任何原始字段均不持久化。
- 业务事务与 Outbox 原子提交；外部主菜单发送发生在提交后，失败通过 Outbox 重试且不得重复创建用户。
- structured logging 只接受字段白名单；Bot Token、`secret_token`、完整 Update、消息正文、原始 callback、原始 start 领取令牌、手机号、支付密码、TOTP、供应商密钥和数据库凭证不得进入日志。
- 测试数据只使用合成 Telegram 标识、假 Secret 和本地 Testcontainers；不得使用真实 Bot Token 或访问 Telegram 网络。
- 数据库集成测试必须使用 Testcontainers PostgreSQL 18.x；并发测试使用独立连接和屏障真正并发，不得以顺序循环替代。
- 每项生产代码变更遵循红灯 → 最小实现 → 绿灯 → 重构检查；任务结束前运行聚焦测试和相关回归检查。
- 所有版本锁定、依赖下载、容器拉取和命令执行只能发生在用户分别授权后；计划中的命令不是本轮已执行事实。

## Authorization Gates

Task 1、Task 2、第 6/48 步 Task 3 与第 8/48 步 Task 4 实施授权均已消费并闭环。Task 4 已在冻结 Create 3/Modify 2 范围完成，并使用本地隔离 Docker/PostgreSQL/Flyway/Testcontainers 验证。依赖/锁文件、Git、worktree、子代理、外部业务连接、生产/共享数据库、部署与第 9 步授权仍为 0。

Git 提交命令只是未来检查点。当前 Git、worktree、子代理、本地容器再运行、共享/生产数据库、Telegram/其他外部业务连接和部署授权均为 0。

## Explicit Exclusions

本计划不实现支付密码、TOTP、账号恢复、UID 合并、资产账户、余额、复式账本、充值、提现、转账、领取、红包、换汇、法币代付、管理后台 UI、Signer、链上地址、真实 Bot Token、真实 Telegram 外部连接或生产部署。不得创建 `apps/admin-web`、`apps/signer`、Android/iOS 或未来供应商目录。

## Definition of Done

- 目标 Monorepo 只包含 `apps/platform`、`apps/worker`、`packages/contracts`、`packages/config`、`packages/testing` 及阶段 1 所需数据库/架构配置。
- TypeScript strict、dependency-cruiser、单元测试、数据库集成测试和进程集成测试全部通过。
- 23 项指定测试均有可定位测试名称；迁移可从空库应用，重复校验无漂移。
- Webhook 对 HTTPS 终止假设、Secret、内容类型、大小和 Update 结构默认拒绝；非私聊或无 `user.id` 安全忽略。
- 同一 Telegram user.id 在重复、并发和 username 变化下只解析到一个 UID 与一个有效绑定。
- Inbox、注册、身份事件和主菜单 Outbox 具有清楚的单事务边界；worker 重复消费不重复不可逆副作用。
- 日志白名单测试证明 Secret、Token、完整 Update 和正文未进入日志。
- 身份注册数据库断言证明不存在资产、账本、余额、钱包、地址、网络或交易对对象。
- 阶段 1 实现完成后的文档、索引、状态和验证记录与真实结果一致；未经用户验收不得把代码标为 `VERIFIED`。

## v1.2 与 v1.2.1 聚焦修订裁决（2026-07-21）

以下裁决是本计划所有任务、示例、验收和未来执行命令的强制约束；若后文表达不够完整，以本节和对应 Task 的完成标准共同解释，不得降低门禁。

| 编号 | 结论 | 项目证据 | 官方依据 | 修改决定与位置 |
|---|---|---|---|---|
| F-01 | ACCEPT | 原验收 23 位于 Vitest 集成测试中并再次调用根测试脚本，可能递归包含自身。 | Vitest Projects 由顶层 CLI 选择 project；测试文件不应成为套件编排器。 | Task 1 把完整编排放到进程外顶层命令；Task 13 的 23 改为真实 platform/worker 进程启动、就绪、信号停止与清理验收。 |
| F-02 | PARTIAL_ACCEPT | 原计划使用已弃用配置名、参数和浮动镜像标签。 | Vitest 官方说明 `workspace` 自 3.2 起弃用并由 `projects` 取代；Node、PostgreSQL、Testcontainers、Flyway 官方资料支持精确版本/镜像输入。 | Task 1 使用 `vitest.config.ts` 的 `test.projects`、精确依赖与 lockfile；Task 3 使用精确镜像标签。完整 manifest digest 无法由本轮只读资料可靠确认，按审查要求登记为实施前验证门禁，不编造。 |
| F-03 | ACCEPT | 原测试 fixture 只有单一高权限 LOGIN，角色脚本和 Flyway 配置没有形成真实执行链。 | PostgreSQL 角色成员资格、`SET ROLE` 与最小权限是可执行权限路径。 | Task 3 明确 bootstrap 管理员、三个 NOLOGIN 角色、四个测试 LOGIN、成员资格、Flyway `SET ROLE`、启动顺序和正反权限验收。 |
| F-04 | ACCEPT | 原 Inbox 只区分首次/重复，未校验同 ID 不同 digest，也未在 UoW 内完成 PROCESSED。 | 项目 Inbox 幂等与审计边界要求重复输入不得产生冲突业务效果。 | Task 3/5 增加 RECEIVED、CLAIMED、PROCESSED、CONFLICT、FAILED，稳定 digest、三类 claim 结果、CAS 重领和同事务完成语义。 |
| F-05 | ACCEPT | 原文把 recording effect 当作外部绝对不重复证据，租约代次未贯穿确认接口。 | Outbox 只能保证本地事务原子与至少一次投递；外部系统确认前崩溃仍可能重复。 | Task 6 改为 at-least-once；所有确认/失败/续租使用 workerId + leaseToken + lockGeneration CAS；Task 13 覆盖外部成功后本地确认前崩溃。 |
| F-06 | ACCEPT | 原禁用 Gateway 抛错会进入通用重试，可能无限 RETRY_WAIT。 | 配置禁用不是瞬时网络故障。 | Task 6/10 将禁用 handler 不注册或消息置 PAUSED/WAITING_CONFIGURATION；瞬时错误才按有界指数退避重试，永久错误死信。 |
| F-07 | ACCEPT | 原消息 schema 强制 `text`，合法照片、贴纸、服务消息可能被当成 400。 | Telegram Bot API Update 可包含多种合法 update 类型；Webhook 对非 2xx 会重试。 | Task 9 先验证最小 envelope，再由 grammY 适配；合法不支持 Update 一律 200 ignored，畸形 envelope 才 400，并固定可信代理 hop/CIDR。 |
| F-08 | ACCEPT | 技术栈声明 grammY，但原适配器完全手写解析。 | grammY 官方提供 `webhookCallback`，webhook 部署不调用 `bot.start()`，并允许注入 BotInfo 避免 `getMe`。 | Task 9 新增 grammY webhook adapter、BotInfo 测试注入、内部 DTO 映射和 NestJS DI/bootstrap 闭环；grammY 类型不得越过 Telegram 边界。 |
| F-09 | ACCEPT | 原配置对完整 `process.env` strict；日志只按键过滤；Telegram ID 使用无盐截断 SHA-256。 | 项目 Secret 与日志边界要求引用解析分离、值级防泄漏和不可枚举伪名。 | Task 2 先选择已知键再 strict；区分 SecretReference/SecretResolver；Task 11 增加事件/值/长度/控制字符/嵌套检测与版本化独立密钥 HMAC。 |
| F-10 | ACCEPT | 原 registrationKey 由调用者传入；SQL `CHECK` 依赖三值逻辑；部分 Files 清单遗漏实际产物。 | 项目身份主体和数据库约束要求可信派生、失败关闭、可执行文件闭环。 | Task 7/8 由服务端从可信渠道、事件类型、主体生成幂等键；Task 3 用显式 TRUE/FALSE 与 NULL 组合约束；所有 Task 的 Files 列表是唯一写集合。 |

裁决计数：ACCEPT 9，PARTIAL_ACCEPT 1，REJECT 0。F-02 的“部分接受”只表示 digest 数值延迟到获得镜像拉取授权后的实施前核验；精确标签、无浮动标签、锁文件和失败关闭要求已经全部接受。

## v1.2.2 外部复审裁决（2026-07-21）

| 编号 | 结论 | 磁盘证据 | v1.2.2 处理 |
|---|---|---|---|
| R-01 | ACCEPT | 旧相对源码 smoke PASS，但无 `dist` 时 `import('@xht/contracts')` 真实 `ERR_MODULE_NOT_FOUND` 并指向 `packages/contracts/dist/index.js`。 | 五个 workspace 增加 build；五个 manifest 显式 main/types/exports；smoke 改为 package-name import；clean build、真实 consumer 和 dist runtime import 全部纳入 Task 1 完成门禁。 |
| R-02 | ACCEPT | README、handoff、state-model、roadmap、活动计划头部与 active-work 存在阶段/文件基线漂移。 | 当前权威状态统一为阶段 0 VERIFIED、阶段 1 计划 READY v1.2.2、阶段 1 代码 BUILDING、Task 1 VERIFIED、Task 2 计划 READY/代码 NOT_STARTED；历史 progress-log 不改写。 |
| R-03 | PARTIAL_ACCEPT | 旧 ZIP 89 项中 87 文件、2 目录，89 项全部使用反斜杠；但中央目录 89/89 项均设置 `0x0800` 且原始名称字节严格 UTF-8 解码失败 0。 | 接受路径分隔符和文件/目录分报缺口，拒绝“无可靠 UTF-8 标记”子结论；新 ZIP 强制 `/`、UTF-8、顶层 `换汇通/`、路径安全和独立解压哈希复核。 |
| R-04 | ACCEPT（非阻断） | `glob@10.5.0` deprecated；`protobufjs@7.6.5`、`ssh2@1.17.0`、`cpu-features@0.0.10` 保持 pending builds；`allowBuilds: {}`。 | 不升级、不改 lockfile、不执行 lifecycle、不运行 audit；Task 3 启动容器前重新审查依赖和镜像 digest。 |

裁决计数：ACCEPT 3（其中非阻断 1）、PARTIAL_ACCEPT 1、REJECT 0。

## v1.2.3 Task 2 计划复审同步（2026-07-23）

R2-01 至 R2-07 经磁盘接口和调用方核验全部 ACCEPT：Task 2 改为单一受管理 key Buffer、finally 清零借用副本、运行时冻结 keyring、完整时间/策略验证、失败路径清零矩阵、六事件 policy matrix 和 telemetry 稳定错误边界；本主计划 Task 5 改用 `withMaterial` 并清零 canonical bytes，Task 11 改用 `withResolvedSecret`、扩展 `packages/contracts/src/observability.ts` 的 Telegram 日志合同并统一非法日志为 `SafeLoggingError` + destination 零写入。详细裁决、接口与测试以 Task 2 独立计划 v1.2.3 为权威。

在 v1.2.3 修订当时，本修订只更新 Markdown 计划与状态记录；Task 2 的 16 个计划新建工程文件实际创建数为 0，Task 2 代码当时为 NOT_STARTED。Tasks 3–14 的业务范围未实施，Git、容器、数据库、Telegram、collector、其他外部服务和部署授权为 0。

## v1.2.4 Task 2 最终可执行性修订（2026-07-23）

E3-01 至 E3-04 经完整 TEMP 工程真实复现全部 ACCEPT：补齐 keyring Vitest 的 `afterEach`/`vi` 导入；把 `InboxDigestKey` 的两个时间字段统一为 `string | undefined` 以满足 `exactOptionalPropertyTypes`；在 URL 解析前检查 file reference 原始路径片段，拒绝 dot/dotdot、空中间片段、反斜杠、百分号编码、query、fragment 和控制字符；删除经边界与不变量证明不可达的 `POLICY_WINDOW_OVERFLOW`、`RETAINED_NOT_ACTIVE`，并补充 `INVALID_ACTIVATION_ORDER` 直接负向测试及策略最小/最大正向边界测试。

边界证明：`inboxRetentionSeconds + telegramRetryWindowSeconds` 的最大值为 `7776000 + 604800 = 8380800` 秒，乘以 `1000` 为 `8380800000`，远小于 `Number.MAX_SAFE_INTEGER = 9007199254740991`。current 已生效、current version 最高且 version 越高 `activatedAt` 严格越晚，所以任何低版本 retained key 必然早于 current 生效，`RETAINED_NOT_ACTIVE` 在这些前置不变量后不可达。

v1.2.3 的 Node 语法检查只能证明语法可解析，不能证明 TypeScript 类型、Vitest 名称解析和运行时安全测试可执行；v1.2.4 使用完整 TEMP 工程构建和测试补齐该门禁。在该计划修订当时，Task 2 代码为 NOT_STARTED，18 个计划工程文件只在一次性 TEMP 验证副本中生成，真实项目中的 16 个计划 Create 文件实际创建数为 0。

## 第 4/48 步 Task 2 真实实施结果（2026-07-23）

上述 v1.2.4 TEMP 段落是历史计划可执行性证据。第 4/48 步已在真实项目按 [Task 2 独立计划](2026-07-21-stage-1-task-2-config-observability-implementation-plan.md) 完成 Create 16、Modify 2，18 个最终文件与权威代码块逐文件一致。clean build、六文件 95/95、typecheck、完整 unit 96/96、三个内部 package export、frozen lockfile 和 29 项安全范围检查通过；新依赖、lockfile 漂移、外部连接和超范围工程文件均为 0。Task 2 代码状态为 READY、等待用户复审，未经复审不得标记 VERIFIED；Tasks 3–14 仍为 NOT_STARTED。

## v1.2.5 Task 2 外部复审修复（2026-07-23）

R4-01 至 R4-03 已在真实项目独立复现并全部 `ACCEPT`。两个 telemetry factory 当前用 `closed` 提前返回，导致第二个并发 shutdown 在 exporter pending 时伪成功，shutdown 失败也不向并发与后续调用保持；Windows canonical `file:///C:/...` 被普通 segment 规则拒绝；Task 2 当前状态摘要有两处漂移。v1.2.5 只修改六个既有工程路径及授权的同步文档，不改变合同、依赖或 lockfile，不创建 Task 3 文件。

修复合同以 [Task 2 v1.2.5 独立详细计划](2026-07-21-stage-1-task-2-config-observability-implementation-plan.md) 为权威：platform/worker shutdown 缓存同一 Promise、开始即关闭 span、exporter 最多一次、成功/失败结果粘滞且错误脱敏；file reference 只对第一段精确 `[A-Za-z]:` 放行并要求至少一个后续安全段，既有全部负向门禁保持。RED 为 3 文件 41/47 通过、6 个预期失败；最小修复后最终 clean/offline 门禁为 3/3 文件 47/47、typecheck、7/7 文件 104/104、三包导入 3/3、lockfile 漂移 0。Task 2 已恢复 READY 等待复审，绝不因本轮自动标记 VERIFIED。

## v1.2.6 Task 2 同步重入修复（2026-07-23）

R5-01 已在真实 platform/worker dist 上独立复现并 `ACCEPT`：旧 v1.2.5 均为 `calls=2`、`samePromise=false`、`laterSame=true`。根因是 async IIFE 在赋值表达式完成前同步进入 exporter shutdown，使 exporter 同步重入时仍看到未初始化的 `shutdownPromise`。

v1.2.6 只修改两个 telemetry factory 与两个 telemetry unit spec。测试先在旧实现上取得 2 个文件、14 项中 10 PASS / 4 个预期 FAIL，稳定失败为 `reentrantPromise !== first`；最小实现改为先缓存 `Promise.resolve().then(...)`，再在 microtask 内调用 exporter。最终 clean build、2/2 文件 14/14、typecheck、7/7 文件 108/108 unit、三包导入、第二次 offline install和 lockfile/package.json 双哈希门禁全部通过。

独立运行时成功与失败场景对 platform/worker 均得到 `calls=1`、`samePromise=true`、`laterSame=true`、`closedCode=TELEMETRY_CLOSED`；失败的首次、重入、后续三路全部 rejected 且错误码为 `EXPORTER_SHUTDOWN_FAILED`，`synthetic-secret` 泄露 0。Task 2 恢复 READY 等待用户最终复审，绝不因本轮自动标记 VERIFIED。

## 第 5/48 步 Task 2 最终验收与 Task 3 计划（2026-07-23）

用户最终复审 Task 2 v1.2.6 为 `PASS`，R5-01 为 `ACCEPT`。第 5 步又完成 Node/pnpm、既有交付哈希、clean build、telemetry 14/14、typecheck、unit 108/108、三包导入和文档状态的新鲜复核，未发现新缺陷；Task 2 代码与测试因此正式 `VERIFIED`。这不扩大任何代码、Git、外部连接或部署授权。

Task 3 当前完整实施权威为 [Task 3 PostgreSQL、Kysely、Flyway 和 Testcontainers 基础 Implementation Plan v1.5](2026-07-23-stage-1-task-3-database-foundation-implementation-plan.md)。该独立计划固定的 19 个工程路径已经全部实施并完成本地验证；精确镜像 child digest、`RoleEnforcingPostgresPool`、资源唯一 owner、Flyway telemetry 关闭、权限矩阵和正反测试矩阵均按计划落位。第 6 步外部复审 PASS，T3R-13 ACCEPT、修订复审通过并关闭，Task 3 详细计划、代码与测试现为 `VERIFIED v1.5`，未解决阻断 0；第 6 步临时工程、镜像、Docker 和数据库授权保持已消费并归零。下方 Task 3 原阶段级展开仅为 v1.2.6 形成时的历史草案，不再是执行来源；凡有差异，以独立计划 v1.5 为准。

## Version、镜像与可复现性门禁

- 基线运行时固定为 Node.js `24.18.0` LTS，根 manifest 的 `packageManager` 固定为 `pnpm@11.15.1`。所有直接/开发依赖在未来 `package.json` 中禁止 `^`、`~`、`latest`、通配符和 Git 漂移引用；唯一允许的版本和所有权如下。每个有直接 import 的 workspace 必须自己声明对应直接依赖，不能借用 transitive dependency。

| 包与精确版本 | 分类 | 直接声明的 workspace | 使用 Task | 官方来源 | Node 24 兼容性 | ESM/CommonJS 边界 | 选择理由 | 生命周期脚本 | 允许生产运行时 |
|---|---|---|---|---|---|---|---|---|---|
| `pnpm@11.15.1` | 工具 | 根 `packageManager` | 1 | [registry](https://registry.npmjs.org/pnpm/11.15.1) | engine 最低 Node 22.13，Node 24 通过 | ESM CLI，由 Corepack 调用 | 当前官方 pnpm 11；支持 lockfile-only/frozen 流程 | 无 preinstall/install/postinstall | 否 |
| `typescript@7.0.2` | dev | 根 | 1 | [registry](https://registry.npmjs.org/typescript/7.0.2) | engine 最低 Node 16.20，Node 24 通过 | ESM 包；项目以 NodeNext 编译 | strict TypeScript 编译器 | 无 preinstall/install/postinstall | 否 |
| `dependency-cruiser@18.1.0` | dev | 根 | 12、13 | [registry](https://registry.npmjs.org/dependency-cruiser/18.1.0) | engine 明列 Node 24 | CommonJS；唯一配置文件为 `.cjs` | 依赖方向门禁 | 无 preinstall/install/postinstall | 否 |
| `@types/node@24.13.3` | dev | 根 | 1–13 | [registry](https://registry.npmjs.org/%40types%2Fnode/24.13.3) | 与 Node 24 基线对应 | 类型包，无运行时模块 | Node API 类型 | 无 preinstall/install/postinstall | 否 |
| `@xht/contracts@0.1.0` | runtime | config；platform；worker | 1–13 | [pnpm workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace) | 与项目 Node 24 编译/测试 | ESM；importer 固定 `workspace:0.1.0` | 跨包合同，拒绝 registry 回退 | 无 lifecycle script | 是 |
| `@xht/config@0.1.0` | runtime | platform；worker | 2、3、5、9、11 | [pnpm workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace) | 与项目 Node 24 编译/测试 | ESM；importer 固定 `workspace:0.1.0` | 受控配置与 Secret reference | 无 lifecycle script | 是 |
| `@xht/testing@0.1.0` | dev | platform test；worker test | 3、13 | [pnpm workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace) | 与项目 Node 24 测试 | ESM；importer 固定 `workspace:0.1.0` | 共享 fixture/harness | 无 lifecycle script | 否 |
| `vitest@4.1.10` | dev | 根及所有含测试的 workspace | 1–13 | [registry](https://registry.npmjs.org/vitest/4.1.10) | engine 明列 Node 24 | ESM；仅根 CLI 编排 `test.projects` | 计划唯一测试框架 | 无 preinstall/install/postinstall | 否 |
| `zod@4.4.3` | runtime | `packages/config` | 2、9 | [registry](https://registry.npmjs.org/zod/4.4.3) | 无 engine 限制；Task 1 在 Node 24 typecheck | ESM；只在 config/Webhook boundary import | strict 环境与 Update schema | 无 preinstall/install/postinstall | 是 |
| `@nestjs/common@11.1.28` | runtime | `apps/platform` | 1、9、13 | [registry](https://registry.npmjs.org/%40nestjs%2Fcommon/11.1.28) | suite core 要求 Node 20 以上，Node 24 通过 | NodeNext ESM consumer；不跨越领域边界 | Nest 公共模块 API | 无 preinstall/install/postinstall | 是 |
| `@nestjs/core@11.1.28` | runtime | `apps/platform` | 1、9、13 | [registry](https://registry.npmjs.org/%40nestjs%2Fcore/11.1.28) | engine 最低 Node 20，Node 24 通过 | NodeNext ESM consumer | Nest application runtime | 无 preinstall/install/postinstall | 是 |
| `@nestjs/platform-express@11.1.28` | runtime | `apps/platform` | 1、9、13 | [registry](https://registry.npmjs.org/%40nestjs%2Fplatform-express/11.1.28) | suite core 要求 Node 20 以上，Node 24 通过 | NodeNext ESM consumer；实际 HTTP adapter | 计划选定的 Nest HTTP adapter | 无 preinstall/install/postinstall | 是 |
| `@nestjs/testing@11.1.28` | dev | `apps/platform` | 9、13 | [registry](https://registry.npmjs.org/%40nestjs%2Ftesting/11.1.28) | suite core 要求 Node 20 以上，Node 24 通过 | NodeNext ESM test consumer | Nest HTTP integration harness | 无 preinstall/install/postinstall | 否 |
| `reflect-metadata@0.2.2` | runtime | `apps/platform` | 1、9 | [registry](https://registry.npmjs.org/reflect-metadata/0.2.2) | 无 engine 限制；Task 1 Node 24 smoke gate | CommonJS; 在 ESM main 最先 side-effect import | Nest decorator metadata | 无 preinstall/install/postinstall | 是 |
| `rxjs@7.8.2` | runtime | `apps/platform` | 1、9 | [registry](https://registry.npmjs.org/rxjs/7.8.2) | 无 engine 限制；Task 1 Node 24 smoke gate | NodeNext ESM consumer | Nest runtime peer/API | 无 preinstall/install/postinstall | 是 |
| `grammy@1.45.1` | runtime | `apps/platform` | 9 | [registry](https://registry.npmjs.org/grammy/1.45.1) | engine Node 14.13.1 以上，Node 24 通过 | NodeNext ESM adapter only | 官方 webhookCallback adapter | 无 preinstall/install/postinstall | 是，连接默认禁用 |
| `kysely@0.29.4` | runtime | platform；worker | 3–8、13 | [registry](https://registry.npmjs.org/kysely/0.29.4) | engine 最低 Node 22，Node 24 通过 | ESM；仓储基础设施边界 | 类型安全 SQL builder | 无 preinstall/install/postinstall | 是 |
| `pg@8.22.0` | runtime；dev testing | platform；worker；testing | 3–8、13 | [registry](https://registry.npmjs.org/pg/8.22.0) | engine 最低 Node 16，Node 24 通过 | NodeNext ESM consumer | PostgreSQL driver | 无 preinstall/install/postinstall | 是（testing owner 否） |
| `@types/pg@8.20.0` | dev | `packages/testing` | 3、13 | [registry](https://registry.npmjs.org/%40types%2Fpg/8.20.0) | 无 engine 限制；Task 1 Node 24 typecheck | 类型包，无运行时模块 | pg test fixture 类型 | 无 preinstall/install/postinstall | 否 |
| `pino@10.3.1` | runtime | platform；worker | 2、11 | [registry](https://registry.npmjs.org/pino/10.3.1) | 无 engine 限制；Task 1 Node 24 smoke gate | CommonJS; 只经 ESM logger factory import | 结构化安全日志 | 无 preinstall/install/postinstall | 是 |
| `@opentelemetry/api@1.9.1` | runtime | platform；worker | 2、11 | [registry](https://registry.npmjs.org/%40opentelemetry%2Fapi/1.9.1) | engine 最低 Node 8，Node 24 通过 | NodeNext ESM consumer | 实际 no-op tracer API，不含 exporter | 无 preinstall/install/postinstall | 是 |
| `testcontainers@12.0.4` | dev | `packages/testing` | 3、13 | [registry](https://registry.npmjs.org/testcontainers/12.0.4) | 无 engine 限制；Task 3/13 Node 24 integration gate | NodeNext ESM test consumer | 网络隔离、生命周期测试容器 | 无 preinstall/install/postinstall | 否 |
| `@testcontainers/postgresql@12.0.4` | dev | `packages/testing` | 3、13 | [registry](https://registry.npmjs.org/%40testcontainers%2Fpostgresql/12.0.4) | 无 engine 限制；Task 3/13 Node 24 integration gate | NodeNext ESM test consumer | 官方 PostgreSQL test module | 无 preinstall/install/postinstall | 否 |
| `supertest@7.2.2` | dev | `apps/platform` | 9、13 | [registry](https://registry.npmjs.org/supertest/7.2.2) | engine 最低 Node 14.18，Node 24 通过 | NodeNext ESM test consumer | HTTP contract 驱动 | 无 preinstall/install/postinstall | 否 |
| `@types/supertest@7.2.1` | dev | `apps/platform` | 9、13 | [registry](https://registry.npmjs.org/%40types%2Fsupertest/7.2.1) | 无 engine 限制；Task 1 Node 24 typecheck | 类型包，无运行时模块 | Supertest TypeScript 类型 | 无 preinstall/install/postinstall | 否 |

- **Phase A — 首次生成 lockfile：** 只有在完整 manifest 已按上表写入精确版本、依赖安装/网络下载授权大于 0 且没有可审查 lockfile 时，执行 `pnpm install --lockfile-only --ignore-scripts`。这是首次解析并只更新 manifest/`pnpm-lock.yaml` 的允许路径；首次不得使用 `--frozen-lockfile`，因为 pnpm 在 lockfile 缺失或需要更新时会失败。随后审查 `lockfileVersion`、每个 importer、direct specifier、resolved transitive dependency、integrity、registry 来源与 workspace 链接，搜索 Git/URL 依赖和全部 lifecycle scripts，并记录 `pnpm-lock.yaml` SHA-256；确认没有漂移版本、浮动 tag、未列包或未批准构建。审核不通过立即停止，不能 materialize `node_modules`。
- **脚本默认拒绝与白名单：** 本矩阵中每个精确直接 registry package 的 `preinstall`、`install`、`postinstall` 元数据均为无；仍必须假定 transitive dependency 可能有 build script。未来 `pnpm-workspace.yaml` 固定 `strictDepBuilds: true`、`dangerouslyAllowAllBuilds: false`、`allowBuilds: {}`、`blockExoticSubdeps: true`、`nodeVersion: 24.18.0`、`engineStrict: true`。Phase A 的 `--ignore-scripts` 是额外总拒绝。若审查发现必要构建，必须停止，单独记录精确 package/version、完整 script、transitive parent、integrity、Node/平台影响与理由，获得用户明确授权后才可把该 **精确版本** 加入 `allowBuilds` 为 true；未登记或版本改变的 script 一律失败。不得启用 `dangerouslyAllowAllBuilds`。
- **Phase B — 后续安装和复现：** Phase A 审核、lockfile SHA 与上述 build policy 通过后，才执行 `pnpm install --frozen-lockfile --ignore-scripts`；以后每次安装、CI 和复现也只允许这一 frozen 命令。manifest 变更必须先经单独版本审批，再重复 Phase A、审查 lockfile diff 和全套验证；`--force`、`--fix-lockfile`、`pnpm update`、隐式 lockfile 重写和以 transitive package 补直接 import 都不允许绕过此流程。
- 多项目测试只创建根 `vitest.config.ts`，通过 `test.projects` 定义 `unit`、`database`、`integration`；选择单一项目只用 `--project`。根 `test:all` 是唯一完整套件编排器，且只能从 Vitest 进程外运行；任何测试文件、fixture、hook 和测试进程都不得调用 `test`、`test:all` 或包含自身的 suite 脚本。
- Task 1 首次安装已经按 Phase A/Phase B 完成并记录 lockfile SHA-256；以后只运行 frozen/ignore-scripts。升级必须单独提交版本依据、漏洞/兼容性影响、lockfile diff 和全套验证证据，不得顺手升级。
- PostgreSQL 测试镜像精确标签为 `postgres:18.4-alpine3.23`；Flyway Open Source 精确标签为 `flyway/flyway:12.11.0-alpine`，它是既有 v1.2 已核验计划基线。不得在本次只修 C-01/C-02 的范围内临时跨 Flyway 主版本；更高主版本必须先有独立兼容性、SQL 行为、镜像 digest 和全量迁移验证审批。Flyway 是容器工具，不加入 npm 直接依赖矩阵。不得使用 major、minor、`latest` 或仅 `alpine` 标签。
- 本轮没有镜像拉取授权，未能可靠核验完整 registry manifest digest。未来 Task 3 开始前必须在获得网络、依赖与容器授权后解析每个目标平台的完整 `sha256:` digest，记录到受版本控制的 `toolchain-lock.json`，以 `name:exact-tag@sha256:full-digest` 启动；缺失、短 digest、平台不匹配或 tag/digest 漂移均立即停止。

## 全任务共同执行合同

- Task 1 命令已经按 v1.2.2 复审门禁真实执行并记录；Tasks 2–14 的命令仍是未来步骤，只有获得对应代码、依赖、容器、网络及必要 Git 权限后才能执行。
- 每个 Task 的 `Files 创建/修改清单` 是该 Task 唯一允许写入的项目文件集合；正文出现的其他路径只用于读取、引用或验证。实施中若需新增写路径，必须先修订计划和状态文档，不得静默写入。
- 每个 Task 都按红灯测试 → 观察预期失败 → 最小实现 → 绿灯 → 重构 → 聚焦验证 → 文档同步执行；失败、超时、资源残留、权限越界、意外网络请求或未列出的文件变化都会阻止完成。
- 未来代码开发的 Skill 顺序：每个任务先 `using-superpowers`、`project-governance`；实现前 `test-driven-development`；用户在 `executing-plans` 与 `subagent-driven-development` 中明确选择一种，未授权子代理时禁止后者；真实失败用 `systematic-debugging`；完成后 `requesting-code-review`；收到意见用 `receiving-code-review`；存在 Git 差异后才按范围用 `security-diff-scan`；任何完成声明前用 `verification-before-completion`。任何 Skill 都不授予 Git、外部连接或部署权限。

## Planned File Map

| 所有者 | 计划路径 | 单一职责 |
|---|---|---|
| 根配置 | `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`vitest.config.ts`、`toolchain-lock.json` | 工作区、严格类型、多项目测试与精确版本/digest 证据 |
| platform | `apps/platform/src/bootstrap/` | NestJS 启动、HTTP 限制与依赖组装 |
| identity | `apps/platform/src/modules/identity/` | UID、会员、绑定、注册幂等和领域事件 |
| telegram | `apps/platform/src/modules/telegram/` | Webhook、Update 映射、`/start` 编排和主菜单合同 |
| reliability | `apps/platform/src/modules/reliability/` | Inbox、Outbox、持久任务应用接口 |
| platform infrastructure | `apps/platform/src/infrastructure/` | Kysely、事务、Pino 和 OpenTelemetry 适配 |
| worker | `apps/worker/src/` | Outbox 租约、处理器、重试与安全停用的 Telegram Gateway |
| contracts | `packages/contracts/src/` | 跨进程命令、事件、错误和观测字段合同 |
| config | `packages/config/src/` | Zod 环境校验、Secret 引用和安全日志策略 |
| testing | `packages/testing/src/` | Testcontainers、Flyway、并发屏障、假时钟和测试替身 |
| database | `database/bootstrap/`、`database/migrations/`、`database/flyway.toml` | NOLOGIN 数据库角色、纯 SQL 迁移与 Flyway 配置 |

## Canonical Names and Contracts

- 值对象：`Uid`、`ChannelType`；Telegram external user ID 与 correlation ID 在跨包合同中保持 `string`，不转换为 `number`。
- 命令：`ResolveOrCreateUidCommand`、`HandleTelegramStartCommand`。
- 结果：`ResolveOrCreateUidResult`、`HandleTelegramStartResult`、`InboxClaimResult`。
- 事件：`UidCreatedV1`、`TelegramUserSeenV1`、`TelegramMainMenuRequestedV1`。
- 服务：`UnitOfWork`、`ResolveOrCreateUid`、`HandleTelegramStart`、`OutboxWorker`。
- 仓储：`InboxRepository`、`OutboxRepository`、`IdentityRepository`、`RegistrationIdempotencyRepository`。
- 数据表：`users`、`memberships`、`identity_profiles`、`channel_bindings`、`registration_idempotency`、`inbox_messages`、`outbox_messages`、`durable_jobs`、`audit_events`。
- Outbox topic：`identity.uid-created.v1`、`identity.telegram-user-seen.v1`、`telegram.main-menu-requested.v1`。
- Webhook consumer：`telegram-webhook-v1`；Outbox worker consumer：`stage1-outbox-worker-v1`。

---

### Task 1: Monorepo 与严格 TypeScript 工程骨架

**交付状态：** `VERIFIED`（2026-07-21 外部复审修复后）。

**准确目标：** 建立只含 platform、worker、contracts、config、testing 的可编译工作区，从无 `dist` 状态产生真实 build 输出，并用 package-name smoke test 固化 package export 和严格类型选项。

**Files 创建/修改清单：**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `toolchain-lock.json`
- Create: `.npmrc`
- Create: `pnpm-lock.yaml`（由未来获准的精确依赖安装生成并审查，不手写）
- Create: `apps/platform/package.json`
- Create: `apps/platform/tsconfig.json`
- Create: `apps/platform/src/main.ts`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/main.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/workspace-smoke.spec.ts`
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/src/index.ts`
- Create: `packages/testing/package.json`
- Create: `packages/testing/tsconfig.json`
- Create: `packages/testing/src/index.ts`

**输入接口：** Node.js 24 LTS；用户对工程骨架、依赖安装和代码实施的独立授权。

**输出接口：** `@xht/contracts`、`@xht/config`、`@xht/testing` 的 `main`/`types`/`exports`；`@xht/platform`、`@xht/worker` 的运行入口；`platformProcessName` 与 `workerProcessName` 常量；根命令 `build`、`typecheck`、`test`、`test:all`、`test:unit`、`test:db`、`test:integration`、`architecture:check`；上节精确依赖矩阵与 Phase A/Phase B lockfile 证据。

**前置依赖：** Authorization Gates 1–5 已分别确认；依赖安装授权涵盖精确版本解析和 lockfile 生成；若 Git 未授权，只执行已授权的文件与测试步骤，跳过提交检查点。

**不应修改的工程文件：** `database/**` 与 Task 2–14 专属业务/测试文件。实施和复审后只允许按文档合同同步计划、索引和状态权威文件。

**失败场景：** Node/pnpm 版本不符、无 `dist` 时 package-name 导入无法解析、manifest 的 main/types/exports 不一致、任一直接 import 缺少本 workspace 直接声明、依赖不是矩阵精确版本、lockfile 与 manifest 不一致、测试 project 漏项、测试内递归调用根套件、进程意外联网或未列文件变化。

**测试先行顺序：** 在无 `dist` 状态把 smoke 改为 `@xht/contracts` package-name import 并观察真实解析 RED；再为五个 workspace 增加 build，为五个 manifest 增加 main/types/exports；执行 build 后观察 package-name GREEN；最后验证真实 consumer 和 platform/worker dist 运行时导入。

**验证命令：** 删除五个生成 `dist` 后依次运行 `pnpm build`、`pnpm exec vitest run --project unit packages/contracts/test/workspace-smoke.spec.ts`、`pnpm typecheck`；从 `packages/contracts` 真正 import `@xht/contracts`，从 `apps/platform` 真正 import 三个内部包，从根目录 import platform/worker dist；最后运行 `pnpm install --frozen-lockfile --ignore-scripts` 并核对 lockfile SHA-256。Phase A 只保留为首次生成历史，不得重跑。

**完成标准：** 无 `dist` 时 RED 精确落在缺失 package export 目标；clean build 后 package-name smoke PASS；三个内部包可由真实 workspace consumer 导入；platform/worker dist 返回批准常量；五个 workspace build/typecheck exit 0；lockfile hash 不漂移；lifecycle 执行数 0；无网络型测试副作用。

**文档同步要求：** 把真实 Node、pnpm、依赖版本、lockfile hash 和执行结果写入 `docs/status/verification.md`；版本变更另经审批。

- [x] **Step 1: 创建仅用于运行测试的工作区配置，不创建业务实现**

`package.json` 的关键内容必须为：

```json
{
  "name": "xht",
  "private": true,
    "packageManager": "pnpm@11.15.1",
    "engines": { "node": "24.18.0" },
  "scripts": {
    "build": "pnpm -r --sort run build",
    "typecheck": "pnpm build && pnpm -r --sort run typecheck",
    "test": "pnpm test:all",
    "test:all": "pnpm build && pnpm -r --sort run typecheck && pnpm architecture:check && vitest run --project unit && vitest run --project database && vitest run --project integration",
    "test:unit": "pnpm build && vitest run --project unit",
    "test:db": "pnpm build && vitest run --project database",
    "test:integration": "pnpm build && vitest run --project integration",
    "architecture:check": "depcruise apps packages --config .dependency-cruiser.cjs"
  }
}
```

`.npmrc` 只固定公开 `registry=https://registry.npmjs.org/`，不保存 auth 或其他 pnpm 运行设置；pnpm 11 的项目设置写入 `pnpm-workspace.yaml`。后者固定 `savePrefix: ''`、`nodeVersion: 24.18.0`、`engineStrict: true`、`strictDepBuilds: true`、`dangerouslyAllowAllBuilds: false`、`allowBuilds: {}` 与 `blockExoticSubdeps: true`。所有内部 workspace manifest 的版本固定为 `0.1.0`，其 importer 只能使用精确 `workspace:0.1.0`。每个 manifest 必须严格采用上节矩阵的依赖分类、workspace 所有权和精确版本，`@opentelemetry/api` 必须由两个进程实际 import 来建立 no-op tracer，不能只列名。`vitest.config.ts` 通过 `defineConfig({ test: { projects: [...] } })` 以显式 include/exclude 划分 `unit`、`database`、`integration`，三个 project 的 glob 互斥。`test:all` 不是 Vitest project，也不得从任何测试代码调用。`toolchain-lock.json` 记录 Node、pnpm、容器精确 tag、目标平台和完整 digest；digest 缺失时 Task 3 不得启动。

在创建这些 manifest 后，依赖安装授权范围内的唯一初始解析命令是 `pnpm install --lockfile-only --ignore-scripts`。审查 importer、direct specifier、resolved version、integrity 和 workspace links 后，唯一 materialize/复现命令是 `pnpm install --frozen-lockfile --ignore-scripts`。两条命令的顺序和用途不可互换。

`tsconfig.base.json` 必须包含：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": false
  }
}
```

- [x] **Step 2: 写红灯 workspace smoke test**

```ts
// packages/contracts/test/workspace-smoke.spec.ts
import { describe, expect, it } from 'vitest';
import { contractPackageName } from '@xht/contracts';

describe('workspace contract package', () => {
  it('exports the stable package identity', () => {
    expect(contractPackageName).toBe('@xht/contracts');
  });
});
```

- [x] **Step 3: 运行红灯**

Run: `pnpm exec vitest run --project unit packages/contracts/test/workspace-smoke.spec.ts`

Expected: 在无 `dist` 状态 FAIL，错误为 `@xht/contracts` 的 dist 入口不存在或无法解析；不得是 Node、pnpm 或 Vitest 配置错误。

- [x] **Step 4: 写最小实现并保持进程无外部副作用**

```ts
// packages/contracts/src/index.ts
export const contractPackageName = '@xht/contracts' as const;

// apps/platform/src/main.ts
export const platformProcessName = 'xht-platform' as const;

// apps/worker/src/main.ts
export const workerProcessName = 'xht-worker' as const;
```

所有子项目 `tsconfig.json` 必须 `extends` 根配置并显式设置 `rootDir`、`outDir`；五个 workspace manifest 必须有 `"build": "tsc -p tsconfig.json"`。三个内部 package 的 main/types/exports 指向 `dist/index.js`/`.d.ts`，platform/worker 指向 `dist/main.js`/`.d.ts`；exports 同时包含 types、import、default，正式入口不得指向 src，也不得隐式跨包相对导入。

- [x] **Step 5: 运行绿灯和严格类型检查**

Run: 删除五个生成 `dist`，然后依次执行 `pnpm build`、`pnpm exec vitest run --project unit packages/contracts/test/workspace-smoke.spec.ts`、`pnpm typecheck` 和真实 Node import 命令。

Expected: smoke test PASS；五个 workspace build/typecheck exit 0；`@xht/contracts` 输出稳定包名；apps/platform 能导入 contracts/config/testing；platform/worker dist 分别输出 `xht-platform`/`xht-worker`。

- [x] **Step 6: 重构检查**

确认根配置没有 admin、signer、移动端或供应商目录；确认 `apps/*` 只通过 package export 依赖 `packages/*`，没有 `../../packages` 导入。

- [x] **Step 7: 文档同步**

执行阶段在 `docs/status/active-work.md` 记录实际创建的骨架和授权编号；此时阶段 1 仍为 `BUILDING`。

- [x] **Step 8: 精确验收**

只存在五个批准工作区单元；strict 选项逐项启用；smoke test 和 typecheck 有真实结果；没有网络、数据库或 Telegram 连接副作用。

- [ ] **Step 9: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts toolchain-lock.json .npmrc apps/platform apps/worker packages/contracts packages/config packages/testing
git commit -m "build: establish strict stage one workspace"
```

---

### Task 2: 配置、结构化日志和 OpenTelemetry 基础

**交付状态：** 独立计划版本 `v1.2.6`；代码与测试 `VERIFIED`（用户最终复审 PASS、R5-01 ACCEPT，本轮新鲜复核通过）。第 4/48 步四文件修复与第 5/48 步验收授权均已消费并归零，Task 3 与其他实现授权为 0。

**完整实施权威：** [Task 2 配置、结构化日志和 OpenTelemetry 基础 Implementation Plan v1.2.6](2026-07-21-stage-1-task-2-config-observability-implementation-plan.md)。本节只保存阶段级摘要，所有精确文件、接口、完整代码、TDD 步骤、错误分类、测试和文档同步范围均以该独立计划为准。

**准确目标：** 在不增加依赖、不读取真实 Secret、不连接 collector 的前提下，为 platform 与 worker 建立运行时严格配置、短期 Secret 解析、Inbox digest keyring、安全结构化日志和可注入 OpenTelemetry 边界。

**边界摘要：**

- `SecretReference` 只在 `secret-reference.ts` 定义并经运行时验证；`SecretResolver` 只在 `secret-resolver.ts` 定义，负责 env/file 解析、realpath 允许根、1–65536 bytes、生命周期、错误分类和清零。
- file reference 在 URL 解析前拒绝 dot/dotdot、空中间片段、反斜杠、百分号编码、query、fragment 和控制字符，再执行 canonical URL、realpath 与允许根校验；URL 规范化不得掩盖原始路径穿越。
- `parseEnvironment` 先白名单投影再 Zod strict；忽略操作系统无关变量，拒绝缺失键、字面 Secret、非法/越界数字和不安全 OTLP endpoint；`AppEnvironment` 的 Secret 字段保持品牌类型。
- Inbox digest keyring strict JSON 必须恰有一个 current，retained 具有不可变 RFC3339 `activatedAt`、`retainedAt`、`retireNotBefore`；canonical base64url key 为 32–64 bytes；保留期至少为 Inbox retention + Telegram retry。单一受管理解码 Buffer 和每次调用的受控借用 Buffer 分别在失败/返回后清零，内部 material 永不直出；raw JSON/material 禁止序列化、日志、trace、错误和快照。
- SafeLogger 具有六事件精确 policy matrix、必填/可选字段和值域白名单，运行时拒绝 unknown key、缺失必填字段、route/outcome/error_category 错配、嵌套值、数组、Error、过长字符串、控制字符和非法数字；platform/worker 的 Pino destination 均可注入并各自有正反测试。
- disabled telemetry 不注册 exporter、不调用 exporter factory，不触发 fetch/http/https/net/dns；otlp 只调用注入 factory，registration/shutdown 原始错误正文不得越过稳定 `TelemetryConfigurationError` 边界；Task 2 不提供真实 exporter 或 collector 连接。
- telemetry shutdown 开始即关闭新 span，并缓存同一 Promise；并发与后续调用共享成功或失败结果，exporter shutdown 最多一次，失败持续为脱敏 `EXPORTER_SHUTDOWN_FAILED`。
- canonical file Secret reference 同时支持 POSIX 绝对路径和第一段精确为 `[A-Za-z]:`、且至少含一个后续安全段的 Windows drive 路径；其余原始路径与 URL 安全门禁不放宽。
- `InboxDigestKey` 的 `retainedAt`、`retireNotBefore` 显式为 `string | undefined`；删除两个不可达错误码，仍保留且可从公共入口触发的稳定错误码必须逐个具有直接测试。策略最小/最大组合均有正向测试，最大毫秒窗口 `8380800000` 保持安全整数。
- 每次跨 workspace 测试前删除五个生成 dist，再执行 `pnpm build`；所有 import 通过真实 package export；新增依赖 0、版本修改 0、lockfile 漂移 0。

**实施后允许同步的 docs：** `docs/architecture/runtime-topology.md`、`docs/operations/observability.md`、`docs/security/threat-model.md`、`docs/status/current.md`、`docs/status/next.md`、`docs/status/active-work.md`、`docs/status/verification.md`、`docs/status/progress-log.md`、`docs/00-index.md`。除独立计划精确 Files 表外，不写其他工程或文档路径。

**完成命令摘要：** Node/pnpm 精确版本 → `pnpm install --frozen-lockfile --ignore-scripts` → clean dist → `pnpm build` → environment/keyring/platform logger/platform telemetry/worker logger/worker telemetry 六个文件聚焦测试 → `pnpm typecheck` → `pnpm test:unit`。Task 2 不运行 architecture/database/integration/test:all；静态检查不冒充运行测试。

**Git 检查点：** `NOT_AUTHORIZED`。不得执行。

---
### Task 3: PostgreSQL、Kysely、Flyway 和 Testcontainers 基础

**当前执行权威与状态：** 本节是 v1.2.6 阶段计划中的历史高层草案，不得据此继续施工。完整且唯一的计划/实施来源是 [Task 3 独立详细计划 v1.5](2026-07-23-stage-1-task-3-database-foundation-implementation-plan.md)；Task 3 已完成实施、验证和用户最终复审，详细计划、代码与测试为 `VERIFIED v1.5`。独立计划的 19 路径写集合、接口、精确镜像值、runtime facade、raw request/stream 双阶段有限日志、关闭/清理合同、权限矩阵与测试门禁覆盖本节任何不一致表达。

**准确目标：** 设计并实现空库可应用、重复校验无漂移的身份与可靠性最小架构，建立最小权限 NOLOGIN 角色，并由 Testcontainers 证明表、约束、Inbox 版本化 HMAC 摘要列和 Flyway 历史权限。

**Files 创建/修改清单：**
- Create: `database/bootstrap/roles.sql`
- Create: `database/bootstrap/database.sql`
- Create: `database/flyway.toml`
- Create: `database/migrations/V1__stage_1_identity_reliability.sql`
- Create: `apps/platform/src/infrastructure/database/database.ts`
- Create: `apps/platform/src/infrastructure/database/database-types.ts`
- Create: `packages/testing/src/postgres-container.ts`
- Create: `packages/testing/src/flyway-runner.ts`
- Modify: `packages/testing/src/index.ts`
- Create: `packages/testing/test/database/migrations.integration.spec.ts`
- Create: `packages/testing/test/database/permissions.integration.spec.ts`
- Modify: `toolchain-lock.json`

**输入接口：** Testcontainers 提供的临时 PostgreSQL 18.x URL；Flyway 读取 `database/migrations`；应用仅接收连接 URL 的测试 Secret 引用解析结果。

**输出接口：** `createDatabase(connectionString): Kysely<Database>`；`startPostgresFixture(): Promise<PostgresFixture>`；`migrateAndValidate(fixture): Promise<MigrationEvidence>`。

**前置依赖：** Task 1 workspace；Task 2 配置合同；容器启动和镜像拉取已获单独授权。

**不应修改的文件：** 领域应用服务、Telegram adapter、资金/账本任何文件及 docs；只写本 Task Files。

**失败场景：** digest 未锁定、bootstrap 顺序错误、Flyway 未实际读取 TOML、迁移借用超级用户、LOGIN 未继承正确 NOLOGIN 角色、Inbox 含 raw Update 列或缺少摘要版本、越权访问成功、迁移漂移或资源未清理。

**测试先行顺序：** 先写空库迁移与正反权限红灯；再实现 bootstrap、角色成员资格、Flyway SET ROLE 和 schema；逐项绿灯后重构权限授予。

**验证命令：** 第 6/48 步已使用锁定本地 Vitest 入口运行等价命令 `vitest run --project database packages/testing/test/database/migrations.integration.spec.ts packages/testing/test/database/permissions.integration.spec.ts`；最终 2 文件 65/65，并在最终工程状态连续通过。命令分发差异和完整证据见 [verification.md](../status/verification.md)。

**完成标准：** bootstrap 管理员只用于首次初始化；正常迁移/平台/worker 均使用独立 LOGIN + 对应 NOLOGIN 角色；Inbox 只具有摘要/版本而没有原始载荷列；允许与拒绝矩阵、SET ROLE、空库/重复迁移全部通过。

**文档同步要求：** 实施后同步运行拓扑、信任边界、数据库变更证据和 `docs/status/verification.md`；不记录密码或连接串。

- [ ] **Step 1: 写红灯迁移测试**

```ts
// packages/testing/test/database/migrations.integration.spec.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateAndValidate, startPostgresFixture, type PostgresFixture } from '../../src/index.js';

describe('stage one migrations', () => {
  let fixture: PostgresFixture;
  beforeAll(async () => { fixture = await startPostgresFixture(); });
  afterAll(async () => { await fixture.stop(); });

  it('applies from empty and validates twice without drift', async () => {
    const first = await migrateAndValidate(fixture);
    const second = await migrateAndValidate(fixture);
    expect(first.appliedVersions).toEqual(['1']);
    expect(second.appliedVersions).toEqual([]);
    expect(second.validationSuccessful).toBe(true);
    expect(await fixture.tableNames()).toEqual(expect.arrayContaining([
      'users', 'memberships', 'identity_profiles', 'channel_bindings',
      'registration_idempotency', 'inbox_messages', 'outbox_messages',
      'durable_jobs', 'audit_events', 'flyway_schema_history'
    ]));
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run packages/testing/test/database/migrations.integration.spec.ts`

Expected: FAIL because `startPostgresFixture` is not exported or migration `V1__stage_1_identity_reliability.sql` is absent。

- [ ] **Step 3: 写角色与表的最小纯 SQL 实现**

`database/bootstrap/database.sql` 由容器 bootstrap 管理员且仅在首次初始化时创建测试数据库；`roles.sql` 创建 `xht_flyway`、`xht_platform`、`xht_worker` 三个 `NOLOGIN` 权限角色。隔离测试 fixture 再创建 `xht_flyway_test_login`、`xht_platform_test_login`、`xht_worker_test_login` 三个 LOGIN，并分别只授予对应角色成员资格；bootstrap LOGIN 不进入任何正常迁移或运行连接池。Flyway 以 `xht_flyway_test_login` 登录，TOML 只声明 callback location，实际由 `database/flyway-callbacks/afterConnect.sql` 执行 `SET ROLE xht_flyway`；platform/worker 由独立计划 v1.5 的 `RoleEnforcingPostgresPool.connect()` 在交付 client 前固定 SET ROLE。生产 LOGIN 名称和 Secret 由未来环境审批，不在本阶段硬编码。

唯一顺序为：启动锁定 digest 且显式 `linux/amd64` 平台的 PostgreSQL → bootstrap 管理员创建数据库 → 执行 `roles.sql` → fixture 创建测试 LOGIN 并 GRANT 成员资格 → Flyway LOGIN 读取 `database/flyway.toml`、由 afterConnect callback SET ROLE 后 migrate/validate → platform/worker wrapper 各自 SET ROLE 后启动 → 运行正反权限测试 → 各唯一 owner 按独立计划 v1.5 的顺序清理。Flyway runner 必须以停止 wait 取得 handle；raw Dockerode logs request 先由 5 秒 timeout、AbortController 与显式 race 限界，成功返回后再由独立 5 秒 stream timeout 和严格有界 frame parser 验证完整 multiplex 数据，分别聚合 stdout、stderr、frame-order，再 inspect ExitCode；若 `start()` 在返回 handle 前失败，则按本次唯一 label 查询 created/running/exited/stopped 容器并精确回收。历史短语“逆序关闭 pool、Flyway、容器与网络”不表示 fixture 拥有 app handle 或 Flyway one-shot container。任何一步失败都停止后续步骤。

`V1__stage_1_identity_reliability.sql` 必须包含以下关键约束：

```sql
CREATE TABLE users (
  uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('ACTIVE','RESTRICTED','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE memberships (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid uuid NOT NULL REFERENCES users(uid),
  status text NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (uid)
);

CREATE TABLE identity_profiles (
  uid uuid PRIMARY KEY REFERENCES users(uid),
  username_snapshot text NULL,
  display_name_snapshot text NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE channel_bindings (
  binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type text NOT NULL,
  external_user_id text NOT NULL,
  uid uuid NOT NULL REFERENCES users(uid),
  status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','REVOKED','CONFLICTED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz NULL,
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_channel_bindings_active_external
  ON channel_bindings(channel_type, external_user_id)
  WHERE status = 'ACTIVE';

CREATE TABLE registration_idempotency (
  registration_key text PRIMARY KEY,
  channel_type text NOT NULL,
  external_user_id text NOT NULL,
  uid uuid NULL REFERENCES users(uid),
  status text NOT NULL CHECK (status IN ('PROCESSING','COMPLETED','FAILED','CONFLICT')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz NULL,
  failure_code text NULL,
  failed_at timestamptz NULL,
  conflicted_at timestamptz NULL,
  UNIQUE (channel_type, external_user_id),
  CHECK (
    (status = 'PROCESSING' AND uid IS NULL AND completed_at IS NULL AND failure_code IS NULL AND failed_at IS NULL AND conflicted_at IS NULL) OR
    (status = 'COMPLETED' AND uid IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL AND failed_at IS NULL AND conflicted_at IS NULL) OR
    (status = 'FAILED' AND uid IS NULL AND completed_at IS NULL AND failure_code IS NOT NULL AND failed_at IS NOT NULL AND conflicted_at IS NULL) OR
    (status = 'CONFLICT' AND uid IS NULL AND completed_at IS NULL AND failure_code IS NOT NULL AND failed_at IS NULL AND conflicted_at IS NOT NULL)
  )
);

CREATE TABLE inbox_messages (
  inbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer text NOT NULL,
  external_message_id text NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^hmac-sha256:[A-Za-z0-9_-]{43}$'),
  digest_key_version text NOT NULL CHECK (digest_key_version ~ '^v[1-9][0-9]*$'),
  correlation_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('RECEIVED','CLAIMED','PROCESSED','CONFLICT','FAILED')),
  received_at timestamptz NOT NULL,
  claimed_by text NULL,
  claim_generation integer NOT NULL DEFAULT 0 CHECK (claim_generation >= 0),
  claimed_until timestamptz NULL,
  processed_at timestamptz NULL,
  failure_code text NULL,
  CHECK (
    (status = 'RECEIVED' AND claimed_by IS NULL AND claimed_until IS NULL AND processed_at IS NULL AND failure_code IS NULL) OR
    (status = 'CLAIMED' AND claimed_by IS NOT NULL AND claimed_until IS NOT NULL AND processed_at IS NULL AND failure_code IS NULL) OR
    (status = 'PROCESSED' AND processed_at IS NOT NULL AND failure_code IS NULL) OR
    (status = 'CONFLICT' AND processed_at IS NULL AND failure_code IS NOT NULL) OR
    (status = 'FAILED' AND processed_at IS NULL AND failure_code IS NOT NULL)
  ),
  UNIQUE (consumer, external_message_id)
);

CREATE TABLE outbox_messages (
  outbox_id uuid PRIMARY KEY,
  topic text NOT NULL,
  event_key text NOT NULL,
  version smallint NOT NULL CHECK (version = 1),
  payload jsonb NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('READY','LEASED','SUCCEEDED','RETRY_WAIT','DEAD_LETTER','PAUSED','WAITING_CONFIGURATION')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL,
  locked_by text NULL,
  lock_generation integer NOT NULL DEFAULT 0 CHECK (lock_generation >= 0),
  lease_token uuid NULL,
  locked_until timestamptz NULL,
  created_at timestamptz NOT NULL,
  succeeded_at timestamptz NULL,
  UNIQUE (topic, event_key)
);

CREATE TABLE durable_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  business_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('READY','LEASED','SUCCEEDED','RETRY_WAIT','DEAD_LETTER','PAUSED','WAITING_CONFIGURATION')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL,
  locked_by text NULL,
  lock_generation integer NOT NULL DEFAULT 0 CHECK (lock_generation >= 0),
  lease_token uuid NULL,
  locked_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (job_type, business_key)
);

CREATE TABLE audit_events (
  audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_ref text NOT NULL,
  subject_ref text NOT NULL,
  outcome text NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);
```

`inbox_messages` 的持久字段只允许上列 `payload_digest` 与 `digest_key_version` 表示内容；不得出现 `payload_hash`、`payload`、`body`、`raw_update`、`update_json`、`message_text`、`callback_data`、`start_parameter`、`payment_password` 或任何能承载完整 Telegram Update/正文的 JSON、text、bytea 列。迁移和 `information_schema` 测试必须同时肯定两个摘要列、否定整组禁止列；摘要密钥材料本身不入库。

迁移必须对 `audit_events` 撤销 platform/worker 的 UPDATE/DELETE，只授予受控 INSERT/SELECT；普通应用角色不得拥有 schema CREATE、ALTER 或 `flyway_schema_history` 写权限。任何表都不得包含 `asset_id`、`ledger_account_id`、`balance`、`wallet_id`、`address`、`network_id` 或 `market_id` 列。

- [ ] **Step 4: 实现 Testcontainers 与 Flyway runner**

```ts
// packages/testing/src/postgres-container.ts
import { Pool } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Network, type StartedNetwork } from 'testcontainers';

export interface PostgresFixture {
  readonly bootstrapConnectionString: string;
  readonly platformConnectionString: string;
  readonly workerConnectionString: string;
  readonly network: StartedNetwork;
  readonly databaseName: 'xht_test';
  readonly flywayUsername: 'xht_flyway_test_login';
  readonly flywayPassword: string;
  readonly stop: () => Promise<void>;
  readonly tableNames: () => Promise<readonly string[]>;
  readonly appliedVersions: () => Promise<readonly string[]>;
}

export async function startPostgresFixture(): Promise<PostgresFixture> {
  const network = await new Network().start();
  const bootstrapPassword = randomEphemeralSecret();
  const container = await new PostgreSqlContainer(readDigestLockedImage('postgres:18.4-alpine3.23'))
    .withNetwork(network)
    .withNetworkAliases('postgres')
    .withDatabase('xht_test')
    .withUsername('xht_bootstrap_test')
    .withPassword(bootstrapPassword)
    .start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const roleLogins = await bootstrapDatabaseRoles(pool);
  const tableNames = async (): Promise<readonly string[]> => {
    const result = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`
    );
    return result.rows.map(row => row.table_name);
  };
  const appliedVersions = async (): Promise<readonly string[]> => {
    const presence = await pool.query<{ relation: string | null }>(
      `select to_regclass('public.flyway_schema_history')::text as relation`
    );
    if (presence.rows[0]?.relation === null) return [];
    const result = await pool.query<{ version: string }>(
      `select version from flyway_schema_history
       where success = true order by installed_rank`
    );
    return result.rows.map(row => row.version);
  };
  return {
    bootstrapConnectionString: container.getConnectionUri(),
    platformConnectionString: roleLogins.platformConnectionString,
    workerConnectionString: roleLogins.workerConnectionString,
    network,
    databaseName: 'xht_test',
    flywayUsername: 'xht_flyway_test_login',
    flywayPassword: roleLogins.flywayPassword,
    tableNames,
    appliedVersions,
    stop: async () => { await pool.end(); await container.stop(); await network.stop(); }
  };
}
```

本节旧 Flyway runner 代码草图已撤回，避免把 `Wait.forOneShotStartup()` 的非零退出 FAIL 语义、“只靠 started handle 清理”、会吞 raw rejection 的公共 logs wrapper、无 request timeout 的永久 Promise 或只监听 data 的 modem demux 误当成可执行合同。未来实现只能逐字采用 [Task 3 独立详细计划 v1.5 的 Flyway runner 合同](2026-07-23-stage-1-task-3-database-foundation-implementation-plan.md#56-flyway-runner-合同)：基于 Testcontainers 12.0.4 公开 `StartupCheckStrategy` 在进程停止后返回 handle，以 5 秒 request timeout、AbortController 与显式 race 获取 raw Dockerode logs，再由独立 stream timeout 和严格有界 parser 验证 header/payload/EOF/close/timeout，分别聚合 stdout、stderr、frame-order，随后 inspect 真实 ExitCode；任何 request timeout 都必须进入 `finally`，任何未取得 handle 的 create/start/wait 失败都由本次唯一 owner label 查询并清理，Ryuk 或进程退出不计为 runner 的 `finally` 证据。

容器和 Flyway 输出必须是真实执行结果，禁止用内存假表替代数据库集成验证。示例中的 fixture 接口必须补齐 `flywayUsername`/`flywayPassword`、platform/worker LOGIN URI 和 bootstrap URI；密码由 fixture 每次随机生成，只短暂存在测试内存。`readDigestLockedImage` 只接受 `toolchain-lock.json` 中完整 tag + digest；`flyway.toml` 必须配置 callback location，runner 必须真实复制并执行 `afterConnect.sql` 的固定 `SET ROLE xht_flyway`。

- [ ] **Step 5: 运行绿灯与权限断言**

Run: `pnpm exec vitest run --project database packages/testing/test/database/migrations.integration.spec.ts packages/testing/test/database/permissions.integration.spec.ts`

Expected: 第一次迁移应用版本 `1`；第二次不应用新版本；Flyway validate 成功；SET ROLE 有效；platform 不能执行 DDL/写迁移历史，worker 不能写 Inbox/身份表，各角色对非授权对象访问得到 permission denied，允许路径分别成功，bootstrap LOGIN 未出现在正常连接证据中。

- [ ] **Step 6: 重构检查**

检查 SQL 只有阶段 1 对象；检查所有时间列使用 `timestamptz`；检查 Telegram external user ID 为 `text`；检查唯一索引与外键命名稳定。

- [ ] **Step 7: 文档同步**

执行阶段同步 `docs/architecture/runtime-topology.md` 的真实角色和迁移证据，但不得写入真实连接字符串。

- [ ] **Step 8: 精确验收**

空库应用、重复校验、表集合、无资金列、角色权限和迁移历史保护全部有真实 Testcontainers 证据。

- [ ] **Step 9: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add database apps/platform/src/infrastructure/database packages/testing
git commit -m "feat: add stage one database and migration foundation"
```

---

### Task 4: Unit of Work 与 PostgreSQL 事务边界

**当前执行权威与状态：** 完整且唯一的实施计划入口是 [Task 4 Unit of Work 与 PostgreSQL 事务边界独立详细计划 v1.10 / LAYOUT-S1](task-4-unit-of-work/00-index.md)。第 7 步外部复审 PASS，T4R-16～T4R-27 ACCEPT / CLOSED；技术计划为 `READY v1.10 / EXTERNAL REVIEW PASS`、文档布局 `LAYOUT-S1 VERIFIED`。第 8 步实施前 `146/91/55` 与 v13 146/146 门禁通过；运行时过滤器阻断经用户裁决后解除，Task 4 按 canonical 完成 Create 3/Modify 2、真实 RED→GREEN、138/138 集成、完整 database/unit、build/typecheck、5/5 canonical 与资源清理。第 8/48 步 COMPLETED，Task 4 代码 IMPLEMENTED / VERIFIED；当前第 9/48 步等待 Task 5 v1.3 外部复审。

**准确目标：** 提供唯一应用事务入口，使 Inbox、身份状态和 Outbox 能共享同一 Kysely transaction，并证明任一写入失败时整体回滚。

**Files 创建/修改清单：**
- Create: `apps/platform/src/infrastructure/database/transaction-context.ts`
- Create: `apps/platform/src/infrastructure/database/unit-of-work.ts`
- Create: `apps/platform/test/database/unit-of-work.integration.spec.ts`

**输入接口：** `Kysely<Database>`；回调 `(transaction: TransactionContext) => Promise<T>`。

**输出接口：** `UnitOfWork.execute<T>(work): Promise<T>`；`TransactionContext.database` 只在回调生命周期内有效。

**前置依赖：** Task 3 Kysely database 和 Testcontainers fixture。

**不应修改的文件：** migration、Telegram adapter、worker、资金/账本与 docs；只写本 Task Files。

**失败场景：** callback 任一步失败却部分提交、嵌套事务绕开统一入口、错误连接角色、异常被吞掉或 pool 泄漏。

**测试先行顺序：** 先写提交/回滚/抛错红灯；实现最小 TransactionContext 与 UnitOfWork；绿灯后收紧唯一事务入口。

**验证命令：** 未来获准后运行 `pnpm exec vitest run --project database apps/platform/test/database/unit-of-work.integration.spec.ts` 与 `pnpm typecheck`。

**完成标准：** Inbox/身份/Outbox 可共享同一真实事务；任一步失败全部回滚；无隐式第二连接。

**文档同步要求：** 实施后同步 `docs/architecture/data-and-money-flow.md` 与验证记录。

- [ ] **Step 1: 写红灯事务回滚测试**

```ts
// apps/platform/test/database/unit-of-work.integration.spec.ts
import { describe, expect, it } from 'vitest';
import { KyselyUnitOfWork } from '../../src/infrastructure/database/unit-of-work.js';

describe('KyselyUnitOfWork', () => {
  it('rolls back every write when the work throws', async () => {
    await expect(unitOfWork.execute(async ({ database }) => {
      await database.insertInto('users').values({ status: 'ACTIVE' }).execute();
      throw new Error('forced-test-failure');
    })).rejects.toThrow('forced-test-failure');

    expect(await database.selectFrom('users').selectAll().execute()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts`

Expected: FAIL with `Cannot find module .../unit-of-work.js`。

- [ ] **Step 3: 写最小事务实现**

```ts
// apps/platform/src/infrastructure/database/transaction-context.ts
import type { Transaction } from 'kysely';
import type { Database } from './database-types.js';
export interface TransactionContext { readonly database: Transaction<Database>; }

// apps/platform/src/infrastructure/database/unit-of-work.ts
import type { Kysely } from 'kysely';
import type { Database } from './database-types.js';
import type { TransactionContext } from './transaction-context.js';

export interface UnitOfWork {
  execute<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

export class KyselyUnitOfWork implements UnitOfWork {
  public constructor(private readonly database: Kysely<Database>) {}
  public execute<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return this.database.transaction().execute(database => work({ database }));
  }
}
```

不得在事务回调内调用 Telegram、OpenTelemetry exporter 或其他网络；提交后副作用一律转为 Outbox。

- [ ] **Step 4: 运行绿灯**

Run: `pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts`

Expected: 成功事务提交，强制失败事务回滚，两个断言 PASS。

- [ ] **Step 5: 重构检查**

确认没有嵌套自动事务、没有将 `TransactionContext` 保存到对象字段、没有 catch 后返回伪成功。

- [ ] **Step 6: 文档同步**

执行阶段在 `docs/architecture/data-and-money-flow.md` 记录实际事务入口名称和已验证原子边界。

- [ ] **Step 7: 精确验收**

事务成功与回滚均由真实 PostgreSQL 证明；接口不暴露网络副作用；后续三个仓储可接受同一 `TransactionContext`。

- [ ] **Step 8: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add apps/platform/src/infrastructure/database apps/platform/test/database/unit-of-work.integration.spec.ts
git commit -m "feat: add explicit unit of work boundary"
```

---

### Task 5: Inbox 与 Telegram Webhook 去重

> **REPLACED：** 本节在早期阶段计划中保存的可执行示例已由 Task 5 独立详细计划取代，不得作为实施输入。Task 5 当前唯一工程正文来源是 [Task 5 v1.3 详细计划索引](task-5-inbox-dedup/00-index.md) 及其索引列出的七份 canonical fragments；接口、文件字节和测试数量均以该来源为准。

**当前状态：** 第 9/48 步；Task 5 v1.2 外部复审未通过，已由 v1.3 candidate 取代；T5R-01/02/04/05/06/07 ACCEPT / CLOSED，T5R-03/08 RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW；详细计划 `READY v1.3 / WAITING_EXTERNAL_REVIEW`；Task 5 代码 `NOT_STARTED`；第 10/48 步 `NOT_STARTED`。

**准确目标：** 以 `(consumer, external_message_id)` 唯一键、完整 parsed Telegram Update 的确定性 canonicalization、版本化 HMAC、PostgreSQL 权威时钟租约和 claimant/generation/inbox CAS，区分首次认领、同载荷重放、异载荷冲突、历史 key 不可用与过期重领。

**冻结工程矩阵：** Create 6 / Modify 1 / Delete 0；不增加 migration、依赖、配置、第二连接或第八个工程文件。精确路径见 [范围与边界](task-5-inbox-dedup/01-scope-status-and-boundaries.md) 与 [canonical fragment manifest](task-5-inbox-dedup/fragments/00-index.md)。

**冻结接口摘要：**

- `digestTelegramUpdate(update, keyring)` 接收完整 parsed Update；canonicalization 完全封装在 Task 5 内部，调用方不创建、不持有、不传递 canonical UTF-8 bytes。
- `InboxClaimCommand` 包含 `consumer`、`externalMessageId`、`digests`、`correlationId`、`claimant` 和仅作元数据的 `receivedAt`。
- 新 lease、行锁等待后的过期判断及 `processed_at` 均使用同一 PostgreSQL transaction/connection 的 `clock_timestamp()`；调用方时间不得授予或延长权限。
- `markProcessed(context, { lease })` 仅在数据库当前时间仍早于 expiry 且 inboxId/claimant/generation/status 全部匹配时返回 `true`。
- CAS `false` 的业务编排必须抛 `PublicUnitOfWorkError('APPLICATION_INBOX_CLAIM_LOST')`，使同一 UoW 中此前业务写回滚。
- raw Update、canonical bytes、key material、digest、正文和 callback data 不进入持久层、日志、trace、Outbox、audit 或公开错误。

**测试与门禁摘要：** Task 5 v1.3 维护 Step 1～40、T5C01～T5C50；future unit 24、future database 26。数组 own-property 完整性、canonical/command Proxy 观察前拒绝、candidate descriptor 解析、claim/mark Date 自有 accessor/method 与 Date subclass 零触达、普通 Date intrinsic 成功、PostgreSQL 微秒时间与数据库内 `<=`、旧时间相等 CAS 0、独立 claimant/generation/inbox CAS、完整 T5C48 runtime sentinel/allowlist、精确 Task 4 双失败分类及 destroy/normal-release/new-PID 证据均由独立计划 canonical tests 定义。第 10/48 步实施与回滚只接受用户授权中明确提供且外部复审通过的最新完整计划 ZIP，不使用 v16/v17 历史包。计划代码不得视为已执行；只有 v1.3 外部复审通过并获得第 10/48 步实施授权后才可机械写入。

---
### Task 6: Outbox、持久任务与安全 Worker

**准确目标：** 在业务事务内原子写 Outbox，由 worker 使用 `FOR UPDATE SKIP LOCKED`、workerId、lease token、lock generation 和有界重试执行 at-least-once delivery；不把本地记录宣称为外部 Exactly Once。

**Files 创建/修改清单：**
- Create: `packages/contracts/src/reliability.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/platform/src/modules/reliability/outbox/outbox.repository.ts`
- Create: `apps/platform/src/modules/reliability/jobs/durable-job.repository.ts`
- Create: `apps/worker/src/outbox/outbox-store.ts`
- Create: `apps/worker/src/outbox/outbox-worker.ts`
- Create: `apps/worker/src/jobs/durable-job-worker.ts`
- Create: `apps/worker/src/bootstrap/create-worker.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `apps/worker/test/database/outbox-worker.integration.spec.ts`

**输入接口：** `OutboxEnvelopeV1`；`OutboxHandler.handle(message)`；worker ID、批量大小、租约时长和时钟。

**输出接口：** `OutboxRepository.enqueue(tx, envelope): Promise<string>`；`OutboxWorker.runOnce(): Promise<OutboxRunResult>`；`DurableJobRepository.enqueue`。

**前置依赖：** Tasks 3–4 的表与事务；Task 2 安全日志接口。

**不应修改的文件：** 身份/Telegram HTTP 适配、migration 以外数据库文件、真实外部 Gateway 及 docs；只写本 Task Files。

**失败场景：** 旧 worker 确认新租约、外部成功但本地确认前崩溃、配置禁用进入忙循环、永久错误反复重试、退避无上限、续租未 CAS、重启丢失可投递消息。

**测试先行顺序：** 先写租约竞争/CAS/崩溃重投/禁用暂停/永久死信/瞬时有界退避红灯；实现 store 和 worker 最小状态机；绿灯后重构时钟与错误分类。

**验证命令：** 未来获准后运行 `pnpm exec vitest run --project database apps/worker/test/database/outbox-worker.integration.spec.ts`。

**完成标准：** at-least-once 明示；所有 mark/extend 以 outboxId + workerId + leaseToken + lockGeneration CAS；旧租约更新 0 行；禁用不轮询写库/刷日志；重复风险有审计/补偿说明。

**文档同步要求：** 实施后同步可靠性拓扑、观测、故障恢复和验证证据。

- [ ] **Step 1: 写红灯重复消费测试**

```ts
// apps/worker/test/database/outbox-worker.integration.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { OutboxWorker } from '../../src/outbox/outbox-worker.js';

describe('OutboxWorker', () => {
  it('does not reclaim a locally succeeded message', async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    await seedOutbox({
      id: '00000000-0000-4000-8000-000000000061',
      topic: 'telegram.main-menu-requested.v1',
      eventKey: 'telegram:menu:9001'
    });
    const worker = new OutboxWorker(store, { handle }, clock, 'worker-test-1');
    expect(await worker.runOnce()).toEqual({ claimed: 1, succeeded: 1, retrying: 0 });
    expect(await worker.runOnce()).toEqual({ claimed: 0, succeeded: 0, retrying: 0 });
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run apps/worker/test/database/outbox-worker.integration.spec.ts`

Expected: FAIL because `OutboxWorker` does not exist。

- [ ] **Step 3: 写稳定合同和最小 worker**

```ts
// packages/contracts/src/reliability.ts
export interface OutboxEnvelopeV1<TPayload extends object = object> {
  readonly id: string;
  readonly topic: string;
  readonly eventKey: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly payload: TPayload;
}
export interface LeasedOutboxMessage<TPayload extends object = object>
  extends OutboxEnvelopeV1<TPayload> {
  readonly workerId: string;
  readonly leaseToken: string;
  readonly lockGeneration: number;
  readonly lockedUntil: string;
}
export interface OutboxHandler {
  handle(message: LeasedOutboxMessage): Promise<void>;
}
```

```ts
// apps/worker/src/outbox/outbox-worker.ts
export interface OutboxRunResult { readonly claimed: number; readonly succeeded: number; readonly retrying: number; }

export class OutboxWorker {
  public constructor(
    private readonly store: OutboxStore,
    private readonly handler: OutboxHandler,
    private readonly clock: Clock,
    private readonly workerId: string
  ) {}

  public async runOnce(): Promise<OutboxRunResult> {
    const messages = await this.store.claimBatch({
      workerId: this.workerId,
      now: this.clock.now(),
      limit: 25,
      leaseMilliseconds: 30_000
    });
    let succeeded = 0;
    let retrying = 0;
    for (const message of messages) {
      try {
        await this.handler.handle(message);
        await this.store.markSucceeded({
          id: message.id, workerId: message.workerId, leaseToken: message.leaseToken,
          lockGeneration: message.lockGeneration, now: this.clock.now()
        });
        succeeded += 1;
      } catch (error: unknown) {
        await this.store.applyFailure({
          id: message.id, workerId: message.workerId, leaseToken: message.leaseToken,
          lockGeneration: message.lockGeneration,
          classification: classifyWorkerError(error), now: this.clock.now()
        });
        retrying += 1;
      }
    }
    return { claimed: messages.length, succeeded, retrying };
  }
}
```

`claimBatch` 的 SQL 必须在短事务内使用 `FOR UPDATE SKIP LOCKED`，原子更新 `locked_by`、随机 `lease_token`、递增 `lock_generation`、`locked_until` 和 `attempt_count` 后提交；处理器执行不持有数据库锁。`markSucceeded`、`applyFailure` 和 `extendLease` 都必须以 `id + workerId + leaseToken + lockGeneration + status=LEASED` CAS，受影响行数不是 1 就返回 `stale_lease`，过期 worker 不得覆盖新租约结果。

投递语义是 at-least-once：Outbox 行与业务变化同事务，但外部副作用成功、本地成功确认前崩溃时，重启会重新投递。接收方支持幂等键时使用 event ID；不支持时明确保留重复副作用风险，记录关联 ID、进入运营审计并按该外部能力的批准补偿流程处理，绝不宣称端到端 Exactly Once。

- [ ] **Step 4: 实现持久任务最小框架**

`DurableJobRepository.enqueue(jobType, businessKey, payload)` 以 `(job_type, business_key)` 唯一；状态仅为 `READY`、`LEASED`、`SUCCEEDED`、`RETRY_WAIT`、`DEAD_LETTER`、`PAUSED`、`WAITING_CONFIGURATION`。只有瞬时错误进入指数退避（base 1 秒、cap 15 分钟、全抖动、最多 8 次）；无效参数/目标或业务拒绝进入 DEAD_LETTER；外部连接禁用进入 WAITING_CONFIGURATION 且从可领取查询排除，直到显式配置变更事件恢复。Task 6 不连接外部系统。

- [ ] **Step 5: 运行绿灯和崩溃恢复测试**

Run: `pnpm exec vitest run apps/worker/test/database/outbox-worker.integration.spec.ts`

Expected: 本地 SUCCEEDED 不再领取；瞬时错误有界 RETRY_WAIT；永久错误 DEAD_LETTER；配置禁用 WAITING_CONFIGURATION 且连续 runOnce 不写库、不刷日志；租约过期后另一 worker 可领取；旧 worker 的迟到确认/失败/续租均被拒绝；模拟外部成功后确认前崩溃会重新投递并记录重复风险。

- [ ] **Step 6: 重构检查**

确认 worker 不依赖 NestJS controller 或 identity 私有实现；确认 Outbox payload 不含完整 Update、Secret 或消息正文；确认错误分类不序列化原始错误对象。

- [ ] **Step 7: 文档同步**

执行阶段同步 `docs/domains/platform-operations.md` 的实际租约和重试状态；生产容量与死信运营仍留在阶段 10。

- [ ] **Step 8: 精确验收**

Outbox 写入原子、worker 领取互斥、租约 token/代次防迟到写、at-least-once 重投和错误分类均有证据；没有真实 Telegram Gateway，不作外部绝对不重复承诺。

- [ ] **Step 9: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add packages/contracts apps/platform/src/modules/reliability apps/worker
git commit -m "feat: add durable outbox and worker foundation"
```

---

### Task 7: 身份领域实体、接口和数据库约束

**准确目标：** 建立渠道无关的 UID、会员、资料、绑定与注册幂等合同，确保 identity 不导入 Telegram 类型，并通过数据库约束保证一个有效外部绑定只对应一个 UID。

**Files 创建/修改清单：**
- Create: `packages/contracts/src/identity.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/platform/src/modules/identity/domain/identity.types.ts`
- Create: `apps/platform/src/modules/identity/domain/identity.errors.ts`
- Create: `apps/platform/src/modules/identity/application/identity.repository.ts`
- Create: `apps/platform/src/modules/identity/infrastructure/postgres-identity.repository.ts`
- Create: `apps/platform/src/modules/identity/infrastructure/postgres-registration-idempotency.repository.ts`
- Create: `apps/platform/test/unit/identity-contract.spec.ts`
- Create: `apps/platform/test/database/identity-constraints.integration.spec.ts`

**输入接口：** 渠道无关的 `ChannelIdentity { channelType; externalUserId }` 和资料快照；`TransactionContext`。

**输出接口：** `Uid`、`ChannelBinding`、`IdentityRepository`、`RegistrationIdempotencyRepository`、版本化事件合同。

**前置依赖：** Task 3 schema；Task 4 transaction；Task 6 Outbox envelope。

**不应修改的文件：** Telegram adapter、worker、资金/账本、数据库 migration 与 docs；只写本 Task Files。

**失败场景：** 调用者注入 registrationKey、命名空间/主体不一致、SQL 非法 NULL 状态通过、identity 导入 grammY/Telegram 类型、一个有效绑定映射多个 UID。

**测试先行顺序：** 先写可信幂等键派生、状态组合与唯一绑定红灯；实现渠道无关类型和 repository；绿灯后收紧输入 DTO。

**验证命令：** 未来获准后运行 `pnpm exec vitest run --project unit apps/platform/test/unit/identity-contract.spec.ts` 与 `pnpm exec vitest run --project database apps/platform/test/database/identity-constraints.integration.spec.ts`。

**完成标准：** registrationKey 仅由服务端 `registration:v1:telegram:start:<externalUserId>` 确定生成并设长度上限；成功/失败/冲突 NULL 组合及唯一绑定由数据库拒绝非法值。

**文档同步要求：** 实施后同步 `docs/domains/identity-and-membership.md`、数据流、安全边界和验证证据。

- [ ] **Step 1: 写红灯合同与唯一绑定测试**

```ts
// apps/platform/test/unit/identity-contract.spec.ts
import { describe, expect, it } from 'vitest';
import type { ResolveOrCreateUidCommand } from '@xht/contracts';

describe('identity contract', () => {
  it('accepts a string external id and keeps username optional', () => {
    const command: ResolveOrCreateUidCommand = {
      channelType: 'telegram',
      externalUserId: '9007199254740991',
      sourceMessageId: 'identity-contract-1',
      username: null,
      displayName: 'Synthetic User',
      correlationId: 'corr-identity-1',
      occurredAt: '2026-07-20T00:00:00.000Z'
    };
    expect(typeof command.externalUserId).toBe('string');
    expect(command.username).toBeNull();
  });
});
```

```ts
// apps/platform/test/database/identity-constraints.integration.spec.ts
it('rejects two active bindings for the same channel identity', async () => {
  await insertActiveBinding({ uid: uidA, channelType: 'telegram', externalUserId: '7001' });
  await expect(insertActiveBinding({
    uid: uidB,
    channelType: 'telegram',
    externalUserId: '7001'
  })).rejects.toMatchObject({ code: '23505' });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run apps/platform/test/unit/identity-contract.spec.ts apps/platform/test/database/identity-constraints.integration.spec.ts`

Expected: FAIL because `ResolveOrCreateUidCommand` and identity repositories are absent。

- [ ] **Step 3: 写最小合同**

```ts
// packages/contracts/src/identity.ts
declare const uidBrand: unique symbol;
export type Uid = string & { readonly [uidBrand]: 'Uid' };
export type ChannelType = 'telegram';

export interface ResolveOrCreateUidCommand {
  readonly channelType: ChannelType;
  readonly externalUserId: string;
  readonly sourceMessageId: string;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly correlationId: string;
  readonly occurredAt: string;
}
export interface ResolveOrCreateUidResult {
  readonly uid: Uid;
  readonly bindingId: string;
  readonly created: boolean;
  readonly identityEvent: UidCreatedV1 | TelegramUserSeenV1;
}
export interface UidCreatedV1 {
  readonly type: 'identity.uid-created.v1';
  readonly eventId: string;
  readonly uid: Uid;
  readonly bindingId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
}
export interface TelegramUserSeenV1 {
  readonly type: 'identity.telegram-user-seen.v1';
  readonly eventId: string;
  readonly uid: Uid;
  readonly bindingId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
}
```

`IdentityRepository` 必须提供 `findActiveBinding`、`createUser`、`createMembership`、`upsertProfileSnapshot`、`createActiveBinding`；注册幂等仓储必须提供 `tryAcquire`、`complete`、`findCompleted`。所有写方法都显式接收 `TransactionContext`。

- [ ] **Step 4: 运行绿灯**

Run: `pnpm exec vitest run apps/platform/test/unit/identity-contract.spec.ts apps/platform/test/database/identity-constraints.integration.spec.ts && pnpm typecheck`

Expected: string ID 与空 username 测试 PASS；第二个有效绑定得到 PostgreSQL `23505`；typecheck exit 0。

- [ ] **Step 5: 重构检查**

对 `apps/platform/src/modules/identity` 搜索 `grammy|Update|Chat|Message` 必须为 0；对 identity 表类型搜索资金列名必须为 0。

- [ ] **Step 6: 文档同步**

执行阶段同步 `docs/domains/identity-and-membership.md` 的实际类型名、表约束和事件版本。

- [ ] **Step 7: 精确验收**

identity 合同渠道无关；external ID 是字符串；username 可空且非身份依据；数据库唯一索引拒绝双有效绑定。

- [ ] **Step 8: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add packages/contracts/src/identity.ts apps/platform/src/modules/identity apps/platform/test/unit/identity-contract.spec.ts apps/platform/test/database/identity-constraints.integration.spec.ts
git commit -m "feat: define channel independent identity contracts"
```

---

### Task 8: ResolveOrCreateUid 并发幂等

**准确目标：** 使用注册幂等行的 `ON CONFLICT DO NOTHING` 竞争和唯一绑定约束，在同一事务中创建或读取 UID；并发请求只产生一个 UID、会员、绑定、注册记录和 `UidCreatedV1`。

**Files 创建/修改清单：**
- Create: `apps/platform/src/modules/identity/application/resolve-or-create-uid.ts`
- Create: `apps/platform/src/modules/identity/application/identity-event-factory.ts`
- Create: `apps/platform/test/database/resolve-or-create-uid.integration.spec.ts`

**输入接口：** `TransactionContext`、`ResolveOrCreateUidCommand`、身份/注册幂等/Outbox 仓储、UUID factory。

**输出接口：** `ResolveOrCreateUid.execute(transaction, command): Promise<ResolveOrCreateUidResult>`。

**前置依赖：** Tasks 4、6、7。

**不应修改的文件：** Telegram HTTP、worker、migration、资金/账本与 docs；只写本 Task Files。

**失败场景：** 先查后插竞态、不同可信主体共享 key、调用者覆盖 key、冲突绑定被自动合并、失败留下半注册或重复 UidCreated。

**测试先行顺序：** 先写两个独立连接的并发红灯及失败/冲突红灯；实现服务端 key 派生、ON CONFLICT 与唯一约束读取；绿灯后重构冲突错误。

**验证命令：** 未来获准后运行 `pnpm exec vitest run --project database apps/platform/test/database/resolve-or-create-uid.integration.spec.ts`。

**完成标准：** 同 Telegram 主体并发只得到一个 UID/会员/绑定/注册/UidCreated；冲突默认拒绝且不合并；所有变化同事务。

**文档同步要求：** 实施后同步身份领域、Telegram 体验、数据流与验证记录。

- [ ] **Step 1: 写红灯首次、重复与 username 变化测试**

```ts
// apps/platform/test/database/resolve-or-create-uid.integration.spec.ts
import { describe, expect, it } from 'vitest';

describe('ResolveOrCreateUid', () => {
  it('creates once, returns the same uid, and treats username as a snapshot', async () => {
    const first = await executeInTransaction(command({
      externalUserId: '8001', username: 'old_name'
    }));
    const second = await executeInTransaction(command({
      externalUserId: '8001', username: 'new_name'
    }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.uid).toBe(first.uid);
    expect(await profileUsername(first.uid)).toBe('new_name');
    expect(await countTopic('identity.uid-created.v1')).toBe(1);
    expect(await countTopic('identity.telegram-user-seen.v1')).toBe(1);
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run apps/platform/test/database/resolve-or-create-uid.integration.spec.ts`

Expected: FAIL because `ResolveOrCreateUid` is absent。

- [ ] **Step 3: 写最小并发安全实现**

```ts
// apps/platform/src/modules/identity/application/resolve-or-create-uid.ts
export class ResolveOrCreateUid {
  public constructor(
    private readonly identities: IdentityRepository,
    private readonly registrations: RegistrationIdempotencyRepository,
    private readonly outbox: OutboxRepository,
    private readonly ids: IdentityIdFactory
  ) {}

  public async execute(
    transaction: TransactionContext,
    command: ResolveOrCreateUidCommand
  ): Promise<ResolveOrCreateUidResult> {
    const existing = await this.identities.findActiveBinding(transaction, command);
    if (existing !== null) {
      await this.identities.upsertProfileSnapshot(transaction, existing.uid, command);
      const identityEvent = createTelegramUserSeenV1(this.ids, existing, command);
      await this.outbox.enqueue(transaction, toOutboxEnvelope(identityEvent));
      return { ...existing, created: false, identityEvent };
    }

    const registrationKey = deriveRegistrationKey(command);
    const acquired = await this.registrations.tryAcquire(transaction, {
      registrationKey, channelType: command.channelType,
      externalUserId: command.externalUserId
    });
    if (!acquired) {
      const completed = await this.registrations.findCompleted(transaction, registrationKey);
      const identityEvent = createTelegramUserSeenV1(this.ids, completed, command);
      await this.outbox.enqueue(transaction, toOutboxEnvelope(identityEvent));
      return { ...completed, created: false, identityEvent };
    }

    const uid = await this.identities.createUser(transaction);
    await this.identities.createMembership(transaction, uid);
    await this.identities.upsertProfileSnapshot(transaction, uid, command);
    const bindingId = await this.identities.createActiveBinding(transaction, uid, command);
    await this.registrations.complete(transaction, registrationKey, uid);
    const identityEvent = createUidCreatedV1(this.ids, { uid, bindingId }, command);
    await this.outbox.enqueue(transaction, toOutboxEnvelope(identityEvent));
    return { uid, bindingId, created: true, identityEvent };
  }
}
```

`deriveRegistrationKey` 是服务端私有纯函数，只接受已经过 adapter 验证的 `channelType`、固定事件命名空间 `start` 和 `externalUserId`，输出 `registration:v1:<channel>:start:<subject>`，总长不超过 160 字符；公共 DTO 不含 registrationKey。仓储仍需校验 key 格式、命名空间及其 channel/subject 与独立列完全一致，任一不一致进入 CONFLICT，不创建或合并 UID。

`tryAcquire` 必须执行 `INSERT ... ON CONFLICT DO NOTHING RETURNING registration_key`。并发输家在唯一冲突等待赢家提交后读取 `COMPLETED` 记录；若赢家回滚，输家重新执行整个 UoW 并可成为拥有者。不得在同一已失败 PostgreSQL transaction 中捕获 `23505` 后继续写。

- [ ] **Step 4: 运行绿灯和事务失败测试**

Run: `pnpm exec vitest run apps/platform/test/database/resolve-or-create-uid.integration.spec.ts`

Expected: 首次 created true；重复 created false 且 UID 相同；username 更新不改变 UID；空 username 可解析；`UidCreatedV1` 只有一条；强制 Outbox 失败时 users/memberships/bindings/registration 全部为 0。

- [ ] **Step 5: 重构检查**

确认 `ResolveOrCreateUid` 不自行开启事务、不发送 Telegram、不创建 audit_events、不引用资产或账本；事件键分别为 `uid-created:<uid>` 与 `telegram-seen:<sourceMessageId>`，其中 Webhook 路径把 update_id 作为 sourceMessageId。

- [ ] **Step 6: 文档同步**

执行阶段同步 `docs/architecture/data-and-money-flow.md` 的实际竞争算法和回滚证据。

- [ ] **Step 7: 精确验收**

首次、重复、空 username、username 变化、Outbox 失败回滚均有数据库证据；并发强度测试留在 Task 13，用独立连接和屏障验证。

- [ ] **Step 8: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add apps/platform/src/modules/identity/application apps/platform/test/database/resolve-or-create-uid.integration.spec.ts
git commit -m "feat: resolve telegram identities idempotently"
```

---

### Task 9: Telegram Webhook 适配器与默认拒绝边界

**准确目标：** 建立 NestJS + grammY Webhook 入口，先验证可信 HTTPS 终止、Secret header、内容类型、256 KiB 和最小 Update envelope；对进入 Inbox 的合法 `/start` 将完整 parsed Update 直接交给 Task 5 `digestTelegramUpdate(update, keyring)`，再把最小业务 DTO 与摘要集合交给业务编排；不支持的合法 Update 返回 200 ignored，畸形/伪造请求不得进入业务事务。

**Files 创建/修改清单：**
- Create: `packages/contracts/src/telegram.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/platform/src/modules/telegram/http/telegram-update.schema.ts`
- Create: `apps/platform/src/modules/telegram/http/grammy-webhook.adapter.ts`
- Create: `apps/platform/src/modules/telegram/http/telegram-command.mapper.ts`
- Create: `apps/platform/src/modules/telegram/http/webhook-secret.verifier.ts`
- Create: `apps/platform/src/modules/telegram/http/webhook-request-policy.ts`
- Create: `apps/platform/src/modules/telegram/http/telegram-webhook.controller.ts`
- Create: `apps/platform/src/modules/telegram/telegram.module.ts`
- Create: `apps/platform/src/bootstrap/create-platform-app.ts`
- Modify: `apps/platform/src/main.ts`
- Create: `apps/platform/test/http/telegram-webhook.contract.spec.ts`
- Create: `apps/platform/test/http/grammy-webhook.adapter.spec.ts`

**输入接口：** HTTP POST `/webhooks/telegram`；可信代理注入的 HTTPS 状态；Secret resolver；未知 JSON body。

**输出接口：** `ParsedTelegramStartUpdate | IgnoredTelegramUpdate`；仅 `/start` command 携带 `InboxDigestSet` 而非 raw Update；HTTP 200/400/401/413/415/503；`TelegramWebhookController.receive`。

**前置依赖：** Tasks 1–2；业务 handler 在 Task 10 注入，Task 9 使用 recording stub 证明拒绝路径。

**不应修改的文件：** identity/reliability/worker、database、资金/账本与 docs；只写本 Task Files。

**失败场景：** 合法非文本返回 400、伪造代理头绕过 HTTPS、Secret header 类型/字符/长度非法、body 超限、未把完整 parsed Update 直接交给 Task 5 digest API、raw Update 传入业务 command/日志/trace/Outbox、旧 digest key 缺失仍执行业务、grammY 调用 `bot.start()`/`getMe`、grammY 类型泄漏到领域、资源或监听端口未关闭。

**测试先行顺序：** 先写文本/照片/贴纸/服务消息/callback/非 start/畸形/伪造头，以及 controller 将完整 parsed Update 原样传给 Task 5 `digestTelegramUpdate(update, keyring)` 的边界红灯；再实现请求策略、最小 envelope、Task 5 digest 调用、grammY webhookCallback、BotInfo 注入、DTO mapper 和 NestJS DI；绿灯后重构 adapter。

**验证命令：** 未来获准后运行 `pnpm exec vitest run --project unit apps/platform/test/http/telegram-webhook.contract.spec.ts apps/platform/test/http/grammy-webhook.adapter.spec.ts` 与 `pnpm typecheck`；Task 5 canonicalization/HMAC 回归继续由 Task 5 自己的 unit spec 拥有。

**完成标准：** 合法不支持 Update 均 200 ignored 且无身份/资金效果；进入 Inbox 的 `/start` 使用完整 parsed Update 的 HMAC 摘要；缺摘要 key 503 且无身份/Outbox 效果；只有 envelope 畸形 400；Secret/HTTPS/代理/body 门禁可证；测试全程零网络，grammY 只在 adapter。

**文档同步要求：** 实施后同步 Telegram 体验、信任边界、安全门禁、运行拓扑和验证证据。

- [ ] **Step 1: 写红灯 HTTP 契约测试**

```ts
// apps/platform/test/http/telegram-webhook.contract.spec.ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';

describe('POST /webhooks/telegram', () => {
  it.each([
    [{}, 401],
    [{ 'x-telegram-bot-api-secret-token': 'wrong' }, 401]
  ])('rejects missing or invalid secret', async (headers, status) => {
    const response = await request(app.getHttpServer())
      .post('/webhooks/telegram').set(headers).send(validPrivateStartUpdate);
    expect(response.status).toBe(status);
    expect(startHandler.calls()).toHaveLength(0);
  });

  it('rejects malformed update before the handler', async () => {
    const response = await request(app.getHttpServer())
      .post('/webhooks/telegram')
      .set('content-type', 'application/json')
      .set('x-telegram-bot-api-secret-token', fakeSecret)
      .send({ update_id: 'not-digits', message: {} });
    expect(response.status).toBe(400);
    expect(startHandler.calls()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run apps/platform/test/http/telegram-webhook.contract.spec.ts`

Expected: FAIL because `createPlatformApp` and controller are absent。

- [ ] **Step 3: 写最小 Zod Update 边界**

```ts
// packages/contracts/src/telegram.ts
export interface ParsedTelegramStartUpdate {
  readonly kind: 'private-start';
  readonly updateId: string;
  readonly messageId: string;
  readonly externalUserId: string;
  readonly chatId: string;
  readonly username: string | null;
  readonly displayName: string;
  readonly startParameter: string | null;
}
export interface IgnoredTelegramUpdate {
  readonly kind: 'ignored';
  readonly reason: 'unsupported-update' | 'unsupported-chat-or-user' | 'not-start';
}
```

```ts
// apps/platform/src/modules/telegram/http/telegram-update.schema.ts
import { z } from 'zod';

const telegramDecimalId = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
]).transform(value => String(value));

const updateEnvelopeSchema = z.object({
  update_id: telegramDecimalId,
  message: z.unknown().optional()
}).passthrough();

const privateMessageSchema = z.object({
    message_id: telegramDecimalId,
    text: z.string().max(4096).optional(),
    chat: z.object({ id: telegramDecimalId, type: z.string() }).passthrough(),
    from: z.object({
      id: telegramDecimalId,
      username: z.string().min(1).max(64).optional(),
      first_name: z.string().min(1).max(256),
      last_name: z.string().min(1).max(256).optional()
    }).passthrough().optional()
}).passthrough();

export class TelegramUpdateValidationError extends Error {}

export function parseTelegramUpdate(input: unknown): ParsedTelegramStartUpdate | IgnoredTelegramUpdate {
  const envelope = updateEnvelopeSchema.safeParse(input);
  if (!envelope.success) throw new TelegramUpdateValidationError('MALFORMED_UPDATE');
  if (envelope.data.message === undefined) return { kind: 'ignored', reason: 'unsupported-update' };
  const message = privateMessageSchema.safeParse(envelope.data.message);
  if (!message.success) throw new TelegramUpdateValidationError('MALFORMED_MESSAGE');
  if (message.data.chat.type !== 'private' || message.data.from === undefined) {
    return { kind: 'ignored', reason: 'unsupported-chat-or-user' };
  }
  if (message.data.text === undefined) {
    return { kind: 'ignored', reason: 'unsupported-update' };
  }
  const text = message.data.text.trim();
  if (text !== '/start' && !text.startsWith('/start ')) return { kind: 'ignored', reason: 'not-start' };
  return {
    kind: 'private-start',
    updateId: envelope.data.update_id,
    messageId: message.data.message_id,
    externalUserId: message.data.from.id,
    chatId: message.data.chat.id,
    username: message.data.from.username ?? null,
    displayName: [message.data.from.first_name, message.data.from.last_name]
      .filter((part): part is string => part !== undefined).join(' '),
    startParameter: text.length > 6 ? text.slice(7) : null
  };
}
```

Task 9 不创建 canonicalizer 文件或 canonical bytes API。JSON parser 产生的完整 Update 值必须直接交给 Task 5 `digestTelegramUpdate(update, keyring)`；完整字段参与、object key-order 等价、array own-property 失败关闭、Proxy 观察前拒绝、HMAC、临时 bytes 生命周期与固定向量均由 Task 5 v1.3 唯一拥有。Task 9 只测试参数对象身份/完整性和最小 DTO 输出，不复制 Task 5 算法测试。

Task 9 只以最小 envelope（对象、合法 `update_id`、至多一个受支持顶层 update 分支）判断 400；通过最小结构的照片、贴纸、服务消息、callback query、非私聊、无 `from`、非 `/start` 统一返回 HTTP 200 `ignored`，且不得创建身份或资金效果。字段超限若属于 adapter 安全上限则安全 ignored/413，不把 Telegram 合法 update 类型误判为畸形 envelope。对于有效私聊 `/start`，controller 在同一短作用域把完整 parsed Update 直接传给 Task 5 `digestTelegramUpdate(update, keyring)`，仅把映射后的 start DTO 与 `InboxDigestSet` 传给 Task 10；canonicalization 与临时 bytes 的创建、使用和清零均由 Task 5 封装，controller 不创建、不持有也不传递这些 bytes。Task 2 keyring 无法解析时 controller 立即记录稳定错误类别并返回 503；Task 5 在读取既有 Inbox 后返回 `digest_key_unavailable` 时，Task 10 不执行身份/Outbox 效果，controller 将该结果映射为 503。两种路径均不标记 Inbox PROCESSED。

`grammy-webhook.adapter.ts` 构造 `new Bot<TestContext>(fakeToken, { botInfo: injectedBotInfo })`，以官方 `webhookCallback` 接入 NestJS HTTP adapter；测试注入固定 BotInfo 和禁止网络的 Bot API client，任何 `getMe` 都使测试失败。进程生命周期只注册 webhook callback，永不调用 `bot.start()`；mapper 把 grammY Context 转成项目自有 `ParsedTelegramStartUpdate`/`IgnoredTelegramUpdate`，identity 和 reliability 不导入 grammY 类型。

- [ ] **Step 4: 写 constant-time Secret 校验与 HTTP 策略**

```ts
// apps/platform/src/modules/telegram/http/webhook-secret.verifier.ts
import { timingSafeEqual } from 'node:crypto';

export function verifyWebhookSecret(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(actual)) return false;
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}
```

`createPlatformApp` 必须把 JSON body limit 固定为 `256kb`。Secret header 必须恰好一个字符串且符合 Telegram 允许字符集 `[A-Za-z0-9_-]` 和 1–256 长度；多值、数组、控制字符或超长值均 401。生产配置必须二选一固定 `trust proxy = 1`（唯一受控反向代理）或列出精确受信 CIDR，不能接受请求自报 hop；只有远端来源匹配受信配置时才解释其 `X-Forwarded-Proto`，直连/非受信来源的伪造头不能把 `request.secure` 变为 true。错误响应仅含稳定码，不回显 header/body。

- [ ] **Step 5: 运行绿灯和拒绝矩阵**

Run: `pnpm exec vitest run apps/platform/test/http/telegram-webhook.contract.spec.ts`

Expected: 缺失/无效/多值/非法字符/超长 Secret 401；错误 content-type 415；超过 256 KiB 413；畸形 envelope 400；照片、贴纸、服务消息、callback query、非 `/start`、非私聊或无 user.id 均 200 ignored；伪造代理头 400 HTTPS_REQUIRED；有效私聊 `/start` 只把 DTO 与 HMAC digest candidates 交给 handler，缺 key 503 无副作用，grammY 无网络调用。

- [ ] **Step 6: 重构检查**

确认 Secret/keyring 解析发生在 Zod 和 UoW 前；确认 controller 不记录 header/body/canonical bytes/digest；确认 `telegramDecimalId` 的输出总是 string；确认 grammY 类型和 raw Update 没有进入 identity、reliability command、Outbox 或 trace。

- [ ] **Step 7: 文档同步**

执行阶段同步 `docs/architecture/trust-boundaries.md` 的实际 HTTP 状态、body limit 和代理假设。

- [ ] **Step 8: 精确验收**

三类拒绝测试、两类安全忽略测试和一条有效路由测试通过；没有真实 Token、Bot 或网络调用。

- [ ] **Step 9: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add packages/contracts/src/telegram.ts apps/platform/src/modules/telegram apps/platform/src/bootstrap apps/platform/src/main.ts apps/platform/test/http/telegram-webhook.contract.spec.ts
git commit -m "feat: validate telegram webhook input"
```

---

### Task 10: `/start` 自动注册、原子编排和主菜单任务

**准确目标：** 把携带 Task 5 `InboxDigestSet` 的有效 `/start` Inbox 认领、UID 解析/创建、身份事件和主菜单 Outbox 写入一个 UoW；重复 Update 返回安全成功，不重复身份或主菜单副作用；缺旧摘要 key 失败关闭；worker 只通过注入 Gateway 发送最小菜单。

**Files 创建/修改清单：**
- Modify: `packages/contracts/src/telegram.ts`
- Create: `apps/platform/src/modules/telegram/application/handle-telegram-start.ts`
- Create: `apps/platform/src/modules/telegram/application/main-menu.ts`
- Create: `apps/platform/src/modules/telegram/application/telegram-start.mapper.ts`
- Modify: `apps/platform/src/modules/telegram/http/telegram-webhook.controller.ts`
- Create: `apps/worker/src/outbox/telegram-main-menu.handler.ts`
- Create: `apps/worker/src/infrastructure/telegram/telegram-bot.gateway.ts`
- Create: `apps/worker/src/infrastructure/telegram/external-connection-disabled.gateway.ts`
- Modify: `apps/worker/src/bootstrap/create-worker.ts`
- Modify: `apps/worker/src/outbox/outbox-worker.ts`
- Create: `apps/platform/test/database/handle-telegram-start.integration.spec.ts`
- Create: `apps/worker/test/unit/telegram-main-menu.handler.spec.ts`

**输入接口：** `HandleTelegramStartCommand { updateId; externalUserId; chatId; username; displayName; inboxDigests; correlationId; receivedAt }`；Gateway 注入。command 不接收 raw Update、canonical bytes、正文或摘要 key material。

**输出接口：** `HandleTelegramStartResult = processed | duplicate_same_payload | conflict | digest_key_unavailable`；`TelegramMainMenuRequestedV1`。

**前置依赖：** Tasks 4–9。

**不应修改的文件：** identity 领域合同、database migration、真实网络 Gateway、资金/账本与 docs；只写本 Task Files。

**失败场景：** Inbox 未完成却提交身份、duplicate/conflict/digest_key_unavailable 继续产生效果、Gateway 在 UoW 内调用、配置禁用重试风暴、菜单事件保存外部 ID/正文/Secret、NestJS provider 未注册或关闭钩子未释放。

**测试先行顺序：** 先写原子成功/重复/冲突/旧摘要 key 不可用/回滚/禁用暂停红灯；再实现 mapper、handler、菜单、DI 与 worker 配置路由；绿灯后重构事件工厂。

**验证命令：** 未来获准后运行 `pnpm exec vitest run --project database apps/platform/test/database/handle-telegram-start.integration.spec.ts` 与 `pnpm exec vitest run --project unit apps/worker/test/unit/telegram-main-menu.handler.spec.ts`。

**完成标准：** Inbox PROCESSED、身份、领域事件、菜单 Outbox 同事务；duplicate_same_payload 安全成功，conflict 与 digest_key_unavailable 无身份/Outbox 效果且 controller 以稳定 503 映射后者；禁用连接不注册 handler 或置 WAITING_CONFIGURATION；无真实网络。

**文档同步要求：** 实施后同步 Telegram 体验、身份、可靠性、运行拓扑和验证证据。

- [ ] **Step 1: 写红灯原子流程测试**

```ts
// apps/platform/test/database/handle-telegram-start.integration.spec.ts
import { describe, expect, it } from 'vitest';

describe('HandleTelegramStart', () => {
  it('creates identity and menu request once for a duplicated update', async () => {
    const first = await handler.execute(startCommand({ updateId: '9100', externalUserId: '8100' }));
    const duplicate = await handler.execute(startCommand({ updateId: '9100', externalUserId: '8100' }));
    expect(first).toMatchObject({ kind: 'processed', created: true, uid: expect.any(String) });
    expect(duplicate).toMatchObject({ kind: 'duplicate_same_payload', inboxId: expect.any(String) });
    expect(await countRows('users')).toBe(1);
    expect(await countRows('memberships')).toBe(1);
    expect(await countRows('channel_bindings')).toBe(1);
    expect(await countTopic('identity.uid-created.v1')).toBe(1);
    expect(await countTopic('telegram.main-menu-requested.v1')).toBe(1);
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run apps/platform/test/database/handle-telegram-start.integration.spec.ts`

Expected: FAIL because `HandleTelegramStart` is absent。

- [ ] **Step 3: 写最小原子编排**

```ts
// packages/contracts/src/telegram.ts
import type { Uid } from './identity.js';
import type { InboxDigestSet, InboxDigestKeyVersion } from './inbox-digest.js';
export interface HandleTelegramStartCommand {
  readonly updateId: string;
  readonly externalUserId: string;
  readonly chatId: string;
  readonly username: string | null;
  readonly displayName: string;
  readonly inboxDigests: InboxDigestSet;
  readonly correlationId: string;
  readonly receivedAt: Date;
  readonly claimant: string;
}
export type HandleTelegramStartResult =
  | { readonly kind: 'processed'; readonly uid: Uid; readonly created: boolean }
  | { readonly kind: 'duplicate_same_payload'; readonly inboxId: string }
  | { readonly kind: 'conflict'; readonly inboxId: string }
  | { readonly kind: 'digest_key_unavailable'; readonly inboxId: string; readonly requiredKeyVersion: InboxDigestKeyVersion };
export interface TelegramMainMenuRequestedV1 {
  readonly type: 'telegram.main-menu-requested.v1';
  readonly eventId: string;
  readonly uid: Uid;
  readonly bindingId: string;
  readonly menuVersion: 'main-menu-v1';
  readonly occurredAt: string;
  readonly correlationId: string;
}
```

```ts
// apps/platform/src/modules/telegram/application/handle-telegram-start.ts
export class HandleTelegramStart {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly inbox: InboxRepository,
    private readonly identities: ResolveOrCreateUid,
    private readonly outbox: OutboxRepository,
    private readonly ids: TelegramEventIdFactory
  ) {}

  public execute(command: HandleTelegramStartCommand): Promise<HandleTelegramStartResult> {
    return this.unitOfWork.execute(async transaction => {
      const claim = await this.inbox.claim(transaction, toInboxClaim(command));
      if (claim.kind !== 'claimed') return claim;
      const identity = await this.identities.execute(transaction, toIdentityCommand(command));
      const eventId = this.ids.nextEventId();
      const menuEvent: TelegramMainMenuRequestedV1 = {
        type: 'telegram.main-menu-requested.v1',
        eventId,
        uid: identity.uid,
        bindingId: identity.bindingId,
        menuVersion: 'main-menu-v1',
        occurredAt: command.receivedAt.toISOString(),
        correlationId: command.correlationId
      };
      await this.outbox.enqueue(transaction, {
        id: eventId,
        topic: menuEvent.type,
        eventKey: `telegram:menu:${command.updateId}`,
        occurredAt: menuEvent.occurredAt,
        correlationId: command.correlationId,
        payload: menuEvent
      });
      const completed = await this.inbox.markProcessed(transaction, { lease: claim.lease });
      if (!completed) throw new PublicUnitOfWorkError('APPLICATION_INBOX_CLAIM_LOST');
      return { kind: 'processed', uid: identity.uid, created: identity.created };
    });
  }
}
```

```ts
// apps/platform/src/modules/telegram/application/main-menu.ts
export const mainMenuV1 = {
  version: 'main-menu-v1',
  text: '请选择操作',
  buttons: [
    { id: 'account', label: '我的账户' },
    { id: 'help', label: '帮助' }
  ]
} as const;
```

菜单不展示余额、资产、网络或市场，不创建任何资金对象。`TelegramMainMenuRequestedV1` 只保存 bindingId，不保存完整 Update、消息原文或 start 原始参数。

- [ ] **Step 4: 写安全 Gateway 和 handler**

```ts
// apps/worker/src/infrastructure/telegram/telegram-bot.gateway.ts
export interface TelegramBotGateway {
  sendMainMenu(input: {
    readonly externalUserId: string;
    readonly text: string;
    readonly buttons: readonly { readonly id: string; readonly label: string }[];
    readonly idempotencyKey: string;
  }): Promise<void>;
}

// apps/worker/src/infrastructure/telegram/external-connection-disabled.gateway.ts
export const telegramExternalConnectionState = {
  enabled: false,
  disabledDisposition: 'WAITING_CONFIGURATION'
} as const;
```

测试用 `RecordingTelegramBotGateway`。默认运行组装发现 `enabled: false` 时不注册 Telegram handler；若队列已有该 topic，store 一次性 CAS 到 `WAITING_CONFIGURATION` 并从后续 claim 查询排除，只在显式配置变更后恢复。该路径不抛瞬时错误、不进入 RETRY_WAIT、不轮询写库、不重复刷日志。未来真实 Gateway 需要独立计划与外部连接授权。

- [ ] **Step 5: 运行绿灯和失败不回滚测试**

Run: `pnpm exec vitest run apps/platform/test/database/handle-telegram-start.integration.spec.ts apps/worker/test/unit/telegram-main-menu.handler.spec.ts`

Expected: 首次处理创建一组身份记录和两个 Outbox topic并在同事务写 PROCESSED；同 payload 重复不再写入；异完整 payload 冲突无业务效果；原 Inbox 所需 retained key 不可用时稳定 503、身份/Outbox 不写入；连接禁用使消息稳定 WAITING_CONFIGURATION 且连续 worker tick 无数据库写入和重复日志；Recording Gateway 成功时菜单内容等于 `mainMenuV1`。

- [ ] **Step 6: 重构检查**

确认 UoW 内没有 Gateway 调用；确认默认 Gateway 永远不连接网络；确认 menu eventKey 基于 updateId；确认 `inboxDigests` 只含版本化 digest、raw Update 不在 command/Outbox；确认重复或 key-unavailable Update 不发布 `TelegramUserSeenV1` 或第二个菜单任务。

- [ ] **Step 7: 文档同步**

执行阶段同步 `docs/domains/telegram-experience.md` 的实际主菜单版本、事务边界和禁用外部连接状态。

- [ ] **Step 8: 精确验收**

`/start` 的数据库原子性、重复安全、提交后发送、发送失败重试和无资金对象均有测试证据。

- [ ] **Step 9: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add apps/platform/src/modules/telegram apps/worker/src/outbox/telegram-main-menu.handler.ts apps/worker/src/infrastructure/telegram apps/platform/test/database/handle-telegram-start.integration.spec.ts apps/worker/test/unit/telegram-main-menu.handler.spec.ts
git commit -m "feat: register telegram users through transactional start flow"
```

---

### Task 11: 日志字段白名单与敏感数据泄露测试

**准确目标：** 让应用只能通过 `SafeLogger` 记录批准字段，并以双层控制丢弃未知字段、Pino redact 已知敏感键；证明 Secret、Token、完整 Update、canonical bytes、正文、callback 原始载荷和 Inbox 摘要 key material 不进入日志或 trace 输出。

**Files 创建/修改清单：**
- Modify: `packages/contracts/src/observability.ts`
- Modify: `packages/config/src/logging-policy.ts`
- Create: `packages/config/src/telegram-user-reference.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `apps/platform/src/infrastructure/logging/create-platform-logger.ts`
- Modify: `apps/worker/src/infrastructure/logging/create-worker-logger.ts`
- Create: `apps/platform/test/security/sensitive-logging.spec.ts`
- Create: `apps/worker/test/security/sensitive-logging.spec.ts`

**输入接口：** Task 2 六事件合同扩展后的 Telegram event 名称和 `SafeLogContext`；Telegram user.id 只进入受控摘要函数。

**输出接口：** 单行 JSON 日志；`toTelegramUserReference(id): Promise<string>`；除白名单外的事件、字段和值在进入 Pino 前统一抛出 `SafeLoggingError`，整条日志写入 0。

**前置依赖：** Task 2 logger；Tasks 9–10 的 Update 和 worker 路径。

**不应修改的文件：** SecretResolver 实现、业务身份/资金模块、migration 与 docs；只写本 Task Files。

**失败场景：** 允许字段名装入 Secret 仍被记录、事件名含控制字符或超长、嵌套对象/数组/错误对象穿透、完整 Update/canonical bytes/正文/callback 进入日志或 span attribute、Bot Token/DB 凭证/logger HMAC/Inbox digest key 相同、旧伪名无法审计关联、无盐哈希被引入。

**测试先行顺序：** 先写允许键+敏感值、嵌套/数组、完整合成 Update/canonical bytes、非法事件名、长度/控制字符、logger HMAC 与 Inbox digest key 分离/轮换红灯；再实现值级 sanitizer、Pino redact、trace attribute allowlist 和 HMAC pseudonymizer；绿灯后搜索全路径。

**验证命令：** 未来获准后运行 `pnpm exec vitest run --project unit apps/platform/test/security/sensitive-logging.spec.ts apps/worker/test/security/sensitive-logging.spec.ts`。

**完成标准：** 事件、字段、值、长度、控制字符和嵌套均失败关闭；标识要么省略要么以版本化独立 HMAC 伪名出现；任何 Secret、raw Update、canonical bytes 或 Inbox digest key material 不可进入日志/trace。

**文档同步要求：** 实施后同步观测、威胁模型、安全门禁、密钥轮换和验证证据。

- [ ] **Step 1: 写红灯敏感泄露测试**

```ts
// apps/platform/test/security/sensitive-logging.spec.ts
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createPlatformLogger } from '../../src/infrastructure/logging/create-platform-logger.js';

describe('safe structured logging', () => {
  it('emits only approved fields and never emits sensitive values', () => {
    let output = '';
    const destination = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } });
    const logger = createPlatformLogger(destination);
    logger.info('telegram_webhook_processed', {
      correlation_id: 'corr_log_1', update_id: '9300', route: 'telegram.start', outcome: 'processed'
    });
    const unsafe = logger as unknown as { info(event: string, context: Record<string, unknown>): void };
    expect(() => unsafe.info('injection_attempt', {
      secret_token: 'fake-secret-value', bot_token: 'fake-bot-token',
      update: { message: { text: 'private-message-body' } }, callback_query: 'raw-callback'
    })).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    expect(output).toContain('corr_log_1');
    for (const forbidden of ['fake-secret-value', 'fake-bot-token', 'private-message-body', 'raw-callback']) {
      expect(output).not.toContain(forbidden);
    }
    expect(output.trim().split('\n')).toHaveLength(1);
  });
});
```

```ts
// apps/worker/test/security/sensitive-logging.spec.ts
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createWorkerLogger } from '../../src/infrastructure/logging/create-worker-logger.js';

describe('worker safe structured logging', () => {
  it('throws for a mismatched event policy and writes no partial record', () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, done) { output += String(chunk); done(); }
    });
    const logger = createWorkerLogger(destination) as unknown as {
      warn(event: unknown, context: unknown): void;
    };
    logger.warn('telegram_webhook_rejected', {
      correlation_id: 'corr_worker_reject_1',
      update_id: '9301',
      route: 'telegram.start',
      outcome: 'rejected',
      error_category: 'telegram_update_invalid'
    });
    const accepted = output;
    expect(() => logger.warn('telegram_webhook_rejected', {
      route: 'telegram.start',
      outcome: 'processed',
      error_category: 'telegram_update_invalid'
    })).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    expect(() => logger.warn('injection_attempt', {
      route: 'telegram.start',
      outcome: 'rejected',
      error_category: new Error('synthetic-secret')
    })).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    expect(output).toBe(accepted);
    expect(output).not.toContain('synthetic-secret');
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run apps/platform/test/security/sensitive-logging.spec.ts apps/worker/test/security/sensitive-logging.spec.ts`

Expected: FAIL because current logger does not enforce the runtime allowlist。

- [ ] **Step 3: 写最小白名单实现**

```ts
// packages/contracts/src/observability.ts after Task 11
export type ApplicationServiceName = 'xht-platform' | 'xht-worker';

export type SafeLogEvent =
  | 'app_configuration_loaded'
  | 'app_configuration_rejected'
  | 'telemetry_disabled'
  | 'telemetry_configured'
  | 'process_started'
  | 'process_stopped'
  | 'telegram_webhook_processed'
  | 'telegram_webhook_rejected';

export type SafeLogErrorCategory =
  | 'configuration_invalid'
  | 'secret_reference_invalid'
  | 'secret_resolution_failed'
  | 'telemetry_initialization_failed'
  | 'telegram_update_invalid'
  | 'invalid_log_entry';

export interface SafeLogContext {
  readonly correlation_id?: string;
  readonly update_id?: string;
  readonly uid?: string;
  readonly telegram_user_ref?: string;
  readonly inbox_id?: string;
  readonly outbox_id?: string;
  readonly route?: 'bootstrap' | 'configuration' | 'telemetry' | 'telegram.start';
  readonly outcome?: 'success' | 'rejected' | 'disabled' | 'configured' | 'stopped' | 'processed';
  readonly error_category?: SafeLogErrorCategory;
  readonly duration_ms?: number;
  readonly retry_count?: number;
}

export interface SafeLogger {
  info(event: SafeLogEvent, context?: SafeLogContext): void;
  warn(event: SafeLogEvent, context?: SafeLogContext): void;
  error(event: SafeLogEvent, context?: SafeLogContext): void;
}

export type TelemetryConfig =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'otlp'; readonly endpoint: string };

export type TelemetrySpanName =
  | 'process.bootstrap'
  | 'configuration.parse'
  | 'telemetry.initialize';

export interface TelemetrySpanHandle { end(): void; }
export interface TelemetryHandle {
  readonly enabled: boolean;
  readonly serviceName: ApplicationServiceName;
  startSpan(name: TelemetrySpanName): TelemetrySpanHandle;
  shutdown(): Promise<void>;
}
export interface OtlpExporterRegistration { shutdown(): Promise<void>; }
export interface OtlpExporterFactory {
  register(input: {
    readonly serviceName: ApplicationServiceName;
    readonly endpoint: string;
  }): Promise<OtlpExporterRegistration>;
}
export type TelemetryConfigurationErrorCode =
  | 'EXPORTER_FACTORY_REQUIRED'
  | 'EXPORTER_REGISTRATION_FAILED'
  | 'EXPORTER_SHUTDOWN_FAILED'
  | 'TELEMETRY_CLOSED';
export class TelemetryConfigurationError extends Error {
  public constructor(public readonly code: TelemetryConfigurationErrorCode) {
    super(code);
    this.name = 'TelemetryConfigurationError';
  }
}
```

```ts
// packages/config/src/logging-policy.ts
import type { SafeLogContext, SafeLogEvent } from '@xht/contracts';

export type SafeLoggingErrorCode =
  | 'EVENT_NOT_ALLOWED'
  | 'CONTEXT_NOT_OBJECT'
  | 'UNKNOWN_FIELD'
  | 'REQUIRED_FIELD_MISSING'
  | 'EVENT_POLICY_MISMATCH'
  | 'NESTED_VALUE'
  | 'VALUE_TYPE_NOT_ALLOWED'
  | 'STRING_TOO_LONG'
  | 'CONTROL_CHARACTER'
  | 'VALUE_NOT_ALLOWED';

export class SafeLoggingError extends Error {
  public constructor(public readonly code: SafeLoggingErrorCode) {
    super(code);
    this.name = 'SafeLoggingError';
  }
}

export interface SafeLogEntry {
  readonly event: SafeLogEvent;
  readonly context: Readonly<Record<string, string | number>>;
}

type ContextKey = keyof SafeLogContext;
interface EventPolicy {
  readonly required: readonly ContextKey[];
  readonly optional: readonly ContextKey[];
  readonly route: NonNullable<SafeLogContext['route']>;
  readonly outcome: NonNullable<SafeLogContext['outcome']>;
}

const eventPolicies = {
  app_configuration_loaded: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'configuration', outcome: 'success'
  },
  app_configuration_rejected: {
    required: ['route', 'outcome', 'error_category'], optional: ['correlation_id'],
    route: 'configuration', outcome: 'rejected'
  },
  telemetry_disabled: {
    required: ['route', 'outcome'], optional: ['correlation_id'],
    route: 'telemetry', outcome: 'disabled'
  },
  telemetry_configured: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'telemetry', outcome: 'configured'
  },
  process_started: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'bootstrap', outcome: 'success'
  },
  process_stopped: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'bootstrap', outcome: 'stopped'
  },
  telegram_webhook_processed: {
    required: ['route', 'outcome', 'update_id'],
    optional: ['correlation_id', 'uid', 'telegram_user_ref', 'inbox_id', 'outbox_id', 'duration_ms'],
    route: 'telegram.start', outcome: 'processed'
  },
  telegram_webhook_rejected: {
    required: ['route', 'outcome', 'error_category'],
    optional: ['correlation_id', 'update_id', 'inbox_id', 'duration_ms', 'retry_count'],
    route: 'telegram.start', outcome: 'rejected'
  }
} as const satisfies Record<SafeLogEvent, EventPolicy>;

const routes = new Set(['bootstrap', 'configuration', 'telemetry', 'telegram.start']);
const outcomes = new Set(['success', 'rejected', 'disabled', 'configured', 'stopped', 'processed']);
const errorCategories = new Set([
  'configuration_invalid', 'secret_reference_invalid', 'secret_resolution_failed',
  'telemetry_initialization_failed', 'telegram_update_invalid', 'invalid_log_entry'
]);
const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/;
const sensitiveFreeText = /(?:synthetic-secret|bot[_-]?token|password|authorization|jdbc:|postgres(?:ql)?:\/\/)/i;

function validateString(key: string, value: string): void {
  if (value.length > 128) throw new SafeLoggingError('STRING_TOO_LONG');
  if (controlCharacters.test(value)) throw new SafeLoggingError('CONTROL_CHARACTER');
  if (key === 'correlation_id' &&
    (!/^corr_[A-Za-z0-9_-]{1,59}$/.test(value) || sensitiveFreeText.test(value))) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (key === 'update_id' && !/^(0|[1-9][0-9]{0,19})$/.test(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (key === 'uid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (key === 'telegram_user_ref' && !/^tg_v[1-9][0-9]{0,8}_[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if ((key === 'inbox_id' || key === 'outbox_id') &&
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (key === 'route' && !routes.has(value)) throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  if (key === 'outcome' && !outcomes.has(value)) throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  if (key === 'error_category' && !errorCategories.has(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
}

function validateNumber(key: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
  }
  if (key === 'duration_ms' && (value < 0 || value > 600_000)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (key === 'retry_count' && (value < 0 || value > 100)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
}

export function validateSafeLogEntry(event: unknown, context: unknown = {}): SafeLogEntry {
  if (typeof event !== 'string' || !Object.hasOwn(eventPolicies, event)) {
    throw new SafeLoggingError('EVENT_NOT_ALLOWED');
  }
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new SafeLoggingError('CONTEXT_NOT_OBJECT');
  }
  const prototype = Object.getPrototypeOf(context);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SafeLoggingError('CONTEXT_NOT_OBJECT');
  }
  const typedEvent = event as SafeLogEvent;
  const policy = eventPolicies[typedEvent];
  const allowed = new Set<string>([...policy.required, ...policy.optional]);
  const selected: Record<string, string | number> = {};
  for (const key of Reflect.ownKeys(context)) {
    if (typeof key !== 'string' || !allowed.has(key)) throw new SafeLoggingError('UNKNOWN_FIELD');
    const descriptor = Object.getOwnPropertyDescriptor(context, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
    }
    const value = descriptor.value as unknown;
    if (typeof value === 'object' && value !== null) throw new SafeLoggingError('NESTED_VALUE');
    if (typeof value === 'string') validateString(key, value);
    else if (typeof value === 'number') validateNumber(key, value);
    else throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
    selected[key] = value;
  }
  for (const key of policy.required) {
    if (!Object.hasOwn(selected, key)) throw new SafeLoggingError('REQUIRED_FIELD_MISSING');
  }
  if (selected.route !== policy.route || selected.outcome !== policy.outcome) {
    throw new SafeLoggingError('EVENT_POLICY_MISMATCH');
  }
  return { event: typedEvent, context: Object.freeze(selected) };
}

export const pinoRedactPaths = [
  '*.bot_token', '*.secret_token', '*.password', '*.totp', '*.database_url',
  '*.message.text', '*.callback_query', '*.start_parameter', '*.update', '*.raw_update',
  '*.canonical_update', '*.canonical_bytes', '*.inbox_digest_key', '*.keyring'
] as const;
```

```ts
// apps/platform/src/infrastructure/logging/create-platform-logger.ts
import pino, { type DestinationStream } from 'pino';
import type { SafeLogContext, SafeLogEvent, SafeLogger } from '@xht/contracts';
import { pinoRedactPaths, validateSafeLogEntry } from '@xht/config';

export function createPlatformLogger(destination: DestinationStream): SafeLogger {
  const backend = pino({
    base: { service: 'xht-platform' },
    timestamp: false,
    redact: { paths: [...pinoRedactPaths], censor: '[REDACTED]' }
  }, destination);
  const write = (level: 'info' | 'warn' | 'error', event: SafeLogEvent, context?: SafeLogContext): void => {
    const safe = validateSafeLogEntry(event, context ?? {});
    backend[level]({ event: safe.event, ...safe.context });
  };
  return {
    info: (event, context) => write('info', event, context),
    warn: (event, context) => write('warn', event, context),
    error: (event, context) => write('error', event, context)
  };
}
```

```ts
// apps/worker/src/infrastructure/logging/create-worker-logger.ts
import pino, { type DestinationStream } from 'pino';
import type { SafeLogContext, SafeLogEvent, SafeLogger } from '@xht/contracts';
import { pinoRedactPaths, validateSafeLogEntry } from '@xht/config';

export function createWorkerLogger(destination: DestinationStream): SafeLogger {
  const backend = pino({
    base: { service: 'xht-worker' },
    timestamp: false,
    redact: { paths: [...pinoRedactPaths], censor: '[REDACTED]' }
  }, destination);
  const write = (level: 'info' | 'warn' | 'error', event: SafeLogEvent, context?: SafeLogContext): void => {
    const safe = validateSafeLogEntry(event, context ?? {});
    backend[level]({ event: safe.event, ...safe.context });
  };
  return {
    info: (event, context) => write('info', event, context),
    warn: (event, context) => write('warn', event, context),
    error: (event, context) => write('error', event, context)
  };
}
```

```ts
// packages/config/src/telegram-user-reference.ts
import { createHmac } from 'node:crypto';
import type { SecretReference } from './secret-reference.js';
import { type SecretResolver, withResolvedSecret } from './secret-resolver.js';

export interface TelegramUserReferenceKey {
  readonly version: `v${number}`;
  readonly reference: SecretReference;
}

export async function toTelegramUserReference(
  externalUserId: string,
  key: TelegramUserReferenceKey,
  resolver: SecretResolver
): Promise<string> {
  return withResolvedSecret(resolver, key.reference, material => {
    const digest = createHmac('sha256', material)
      .update(`telegram:${externalUserId}`, 'utf8').digest('base64url');
    return `tg_${key.version}_${digest}`;
  });
}
```

```ts
// packages/config/src/index.ts after Task 11
export * from './environment.js';
export * from './inbox-digest-keyring.js';
export * from './logging-policy.js';
export * from './secret-reference.js';
export * from './secret-resolver.js';
export * from './telegram-user-reference.js';
```

platform/worker logger 方法必须先调用 `validateSafeLogEntry`，再把已冻结的平面 context 交给配置 `redact: { paths: [...pinoRedactPaths], censor: '[REDACTED]' }` 的 Pino；任何非法 event、unknown/missing/mismatched 字段、object、array、Error、`Uint8Array` 或不安全标量统一抛 `SafeLoggingError`，整条日志写入 0，不得静默丢字段。Task 2 `TelemetryHandle.startSpan` 只接收封闭 `TelemetrySpanName` 且不接受 attributes，因此 Task 11 不修改任一 telemetry 实现或测试；全阶段搜索任意 span attribute 写入并要求 0。禁止接受或序列化 Error 原对象；只记录 `error_category`。logger HMAC key 仅由独立 `SecretResolver` 获取，必须与 Bot Token、Webhook Secret、支付密码密钥、数据库凭证和 **Inbox digest keyring** 分离；两类 HMAC 不能复用 reference、version namespace 或 material。轮换时新日志只用新 version，审计查询按 version 用受控双读窗口关联，窗口结束后销毁旧 key；不需要用户关联的事件直接省略该字段。

- [ ] **Step 4: 运行绿灯和全路径敏感测试**

Run: `pnpm exec vitest run apps/platform/test/security/sensitive-logging.spec.ts apps/worker/test/security/sensitive-logging.spec.ts`

Expected: 白名单字段存在；即使 `correlation_id` 等允许键承载 Secret 值也以稳定 `SafeLoggingError` 拒绝，整条 destination 写入为 0；完整合成 Update、canonical bytes、消息正文、callback、keyring/key material、嵌套对象、数组、控制字符、超长值、缺失必填字段、event/route/outcome 错配和非法事件名均不进入 platform/worker 日志；`TelemetryHandle` 没有任意 attribute 输入；platform 和 worker 测试均 PASS。

- [ ] **Step 5: 重构检查**

搜索 `logger.(info|warn|error)` 调用点，每个调用必须使用已声明 `SafeLogEvent` 与 event policy 允许的 `SafeLogContext`；非法日志均捕获或断言 `SafeLoggingError`，禁止静默丢弃。搜索任意 span attribute 写入、`console.`、完整 Update、canonicalizer output、`JSON.stringify(update` 和 keyring 序列化进入日志/trace/Outbox/audit 必须为 0。

- [ ] **Step 6: 文档同步**

执行阶段把实际白名单和测试命令同步到 `docs/operations/observability.md` 与 `docs/security/threat-model.md`。

- [ ] **Step 7: 精确验收**

批准字段可观测；未知、缺失和错配字段在运行时统一抛错且整条日志零写入；已知敏感路径有 Pino 二次 redact；外部 ID 只显示版本化 HMAC 伪名；Inbox HMAC 与日志 HMAC 隔离；两个进程均有正反日志测试，telemetry API 不接受任意 attributes。

- [ ] **Step 8: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add packages/contracts/src/observability.ts packages/config apps/platform/src/infrastructure/logging apps/worker/src/infrastructure/logging apps/platform/test/security apps/worker/test/security
git commit -m "test: enforce sensitive logging boundary"
```

---

### Task 12: dependency-cruiser 架构依赖门禁

**准确目标：** 机器化禁止 identity/reliability 依赖 Telegram、packages 依赖 apps、worker 依赖 platform 私有实现，以及跨模块基础设施反向导入；用故意违规 fixture 证明门禁会失败。

**Files 创建/修改清单：**
- Create: `.dependency-cruiser.cjs`
- Create: `packages/testing/fixtures/architecture/invalid-domain-to-telegram/apps/platform/src/modules/identity/identity.ts`
- Create: `packages/testing/fixtures/architecture/invalid-domain-to-telegram/apps/platform/src/modules/telegram/telegram.ts`
- Create: `packages/testing/test/architecture/dependency-boundaries.spec.ts`
- Modify: `package.json`

**输入接口：** `apps/**/*.ts`、`packages/**/*.ts` 的 import 图；fixture 图。

**输出接口：** `pnpm architecture:check`；违规规则名与非零 exit code。

**前置依赖：** Tasks 1、7、9 的实际模块路径。

**不应修改的文件：** 运行时代码、database、领域文档与任何 Task 1–11 文件；只写本 Task Files。

**失败场景：** 规则未扫描新路径、fixture 未实际触发、identity 导入 grammY、package 导入 app、worker 越过合同依赖 platform 私有模块。

**测试先行顺序：** 先以故意违规 fixture 写红灯；实现最小依赖规则；验证违规失败和真实图通过；再收紧忽略项。

**验证命令：** 未来获准后运行 `pnpm architecture:check` 与 `pnpm exec vitest run --project unit packages/testing/test/architecture/dependency-boundaries.spec.ts`。

**完成标准：** 规则覆盖 platform/worker/packages；所有命名反向依赖失败；fixture 确有非零退出；无宽泛忽略。

**文档同步要求：** 实施后同步领域地图、架构门禁与验证记录。

- [ ] **Step 1: 写红灯门禁测试**

```ts
// packages/testing/test/architecture/dependency-boundaries.spec.ts
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
const execFileAsync = promisify(execFile);

describe('dependency boundaries', () => {
  it('rejects a domain import of a telegram adapter', async () => {
    const fixtureRoot = path.resolve(
      'packages/testing/fixtures/architecture/invalid-domain-to-telegram'
    );
    const configPath = path.resolve('.dependency-cruiser.cjs');
    await expect(execFileAsync('pnpm', [
      'exec', 'depcruise', 'apps', '--config', configPath
    ], { cwd: fixtureRoot })).rejects.toMatchObject({
      stderr: expect.stringContaining('no-domain-to-telegram')
    });
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run packages/testing/test/architecture/dependency-boundaries.spec.ts`

Expected: FAIL because `.dependency-cruiser.cjs` is absent or the invalid fixture exits 0。

- [ ] **Step 3: 写最小门禁配置**

```js
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    {
      name: 'no-domain-to-telegram',
      severity: 'error',
      from: { path: '^apps/platform/src/modules/(identity|reliability)/' },
      to: { path: '^apps/platform/src/modules/telegram/' }
    },
    {
      name: 'no-packages-to-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' }
    },
    {
      name: 'no-worker-to-platform-internals',
      severity: 'error',
      from: { path: '^apps/worker/' },
      to: { path: '^apps/platform/' }
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true }
    }
  ],
  options: { tsPreCompilationDeps: true, doNotFollow: { path: 'node_modules' } }
};
```

fixture 中的 `apps/platform/src/modules/identity/identity.ts` 必须显式 import `../telegram/telegram.js`。测试把 cwd 切到 fixture 根并扫描其中的 `apps`，因此相对路径与生产规则完全相同，不修改或放宽规则。

- [ ] **Step 4: 运行红灯 fixture 与绿灯真实图**

Run: `pnpm exec vitest run packages/testing/test/architecture/dependency-boundaries.spec.ts && pnpm architecture:check`

Expected: fixture 测试因预期非零而 PASS；真实 `apps packages` 图 exit 0；报告没有循环和反向依赖。

- [ ] **Step 5: 重构检查**

确认规则只编码批准边界，不禁止合法的 Telegram → identity 调用；确认 contracts/config/testing 没有应用层导入。

- [ ] **Step 6: 文档同步**

执行阶段同步 `docs/architecture/domain-map.md` 的门禁命令和规则名。

- [ ] **Step 7: 精确验收**

故意反向依赖稳定失败，真实图稳定通过；规则名可在 CI/报告中定位；没有通过路径别名绕过。

- [ ] **Step 8: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add .dependency-cruiser.cjs package.json packages/testing/fixtures/architecture packages/testing/test/architecture
git commit -m "build: enforce stage one dependency boundaries"
```

---

### Task 13: 集成、真实并发和失败恢复验收

**准确目标：** 以真实 NestJS 进程、两个独立 PostgreSQL 连接、Testcontainers 和 recording Gateway 覆盖 23 项阶段 1 验收，尤其证明完整 Update 的 Inbox HMAC/rotation/no-raw-storage 边界、不同 update_id 并发首次注册仍只有一个 UID、失败回滚且 worker 重试不重复副作用。

**Files 创建/修改清单：**
- Create: `packages/testing/src/async-barrier.ts`
- Create: `packages/testing/src/recording-telegram-bot.gateway.ts`
- Create: `packages/testing/src/stage-one-harness.ts`
- Modify: `packages/testing/src/index.ts`
- Create: `apps/platform/test/integration/stage-one-webhook.integration.spec.ts`
- Create: `apps/platform/test/integration/registration-concurrency.integration.spec.ts`
- Create: `apps/platform/test/integration/registration-failure.integration.spec.ts`
- Create: `apps/worker/test/integration/outbox-recovery.integration.spec.ts`
- Create: `packages/testing/test/database/stage-one-schema-boundary.integration.spec.ts`
- Create: `apps/platform/test/integration/platform-process.lifecycle.spec.ts`
- Create: `apps/worker/test/integration/worker-process.lifecycle.spec.ts`

**输入接口：** `StageOneHarness` 提供真实 HTTP server、Kysely 连接 A/B、UoW、worker、可控 clock 和 recording Gateway；全部使用合成数据。

**输出接口：** 23 项具名测试、测试计数、数据库行计数和 worker effect 记录。

**前置依赖：** Tasks 1–12 全部通过聚焦测试。

**不应修改的文件：** 生产实现、migration、配置 manifest、权威 docs 与不在本 Task Files 的测试；只写本 Task Files。

**失败场景：** 测试递归启动自身、进程未在超时内就绪/停止、退出码/信号异常、端口/容器/临时目录残留、任何外部连接、全 Update 摘要退化为字段白名单、key rotation 失去旧重放、raw Update 列/日志/trace 未被检查、并发屏障不是真并发、外部成功后确认前崩溃被误称不重复。

**测试先行顺序：** 先写 01–23 标题与真实驱动的红灯；先令 process lifecycle 失败，再实现 readiness/stop 清理；逐项绿灯；最后由终端外部顶层命令编排全套。

**验证命令：** 未来获准后运行聚焦 `pnpm exec vitest run --project integration <明确单个文件>`；只在 Vitest 进程外运行 `pnpm test:all`，任何测试文件不得 exec 根测试脚本。

**完成标准：** 23 项编号连续、全有真实断言；process 验收使用子进程/HTTP readiness、SIGTERM、退出码和资源清理；所有流程零真实外部连接。

**文档同步要求：** 实施后将每项 PASS/FAIL、镜像 digest、超时、清理证据和未执行项写入 `docs/status/verification.md`。

- [ ] **Step 1: 写并发屏障和红灯测试**

```ts
// packages/testing/src/async-barrier.ts
export class AsyncBarrier {
  private arrived = 0;
  private readonly waiting: Array<() => void> = [];
  public constructor(private readonly parties: number) {}
  public async wait(): Promise<void> {
    this.arrived += 1;
    if (this.arrived === this.parties) {
      for (const release of this.waiting.splice(0)) release();
      return;
    }
    await new Promise<void>(resolve => this.waiting.push(resolve));
  }
}
```

```ts
// apps/platform/test/integration/registration-concurrency.integration.spec.ts
import { describe, expect, it } from 'vitest';
import { AsyncBarrier } from '@xht/testing';

describe('concurrent first registration', () => {
  it('creates one uid for different updates from one telegram user', async () => {
    const barrier = new AsyncBarrier(2);
    harness.beforeRegistrationAcquire(async () => barrier.wait());
    const [left, right] = await Promise.all([
      harness.postStart({ updateId: '9401', externalUserId: '8401', connection: 'A' }),
      harness.postStart({ updateId: '9402', externalUserId: '8401', connection: 'B' })
    ]);
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(await harness.count('users')).toBe(1);
    expect(await harness.count('memberships')).toBe(1);
    expect(await harness.countActiveBindings('telegram', '8401')).toBe(1);
    expect(await harness.countTopic('identity.uid-created.v1')).toBe(1);
    expect(await harness.distinctResolvedUids()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run apps/platform/test/integration/registration-concurrency.integration.spec.ts`

Expected: FAIL because `StageOneHarness` and concurrency hook are absent；测试必须在至少两个数据库连接上同时到达屏障。

- [ ] **Step 3: 写最小 StageOneHarness**

```ts
// packages/testing/src/stage-one-harness.ts
export interface StageOneHarness {
  postStart(input: {
    readonly updateId: string;
    readonly externalUserId: string;
    readonly username?: string | null;
    readonly connection?: 'A' | 'B';
  }): Promise<{ readonly status: number; readonly body: unknown }>;
  beforeRegistrationAcquire(hook: () => Promise<void>): void;
  count(table: 'users' | 'memberships' | 'channel_bindings' | 'registration_idempotency' | 'inbox_messages' | 'outbox_messages'): Promise<number>;
  countActiveBindings(channelType: 'telegram', externalUserId: string): Promise<number>;
  countTopic(topic: string): Promise<number>;
  distinctResolvedUids(): Promise<readonly string[]>;
  stop(): Promise<void>;
}
```

Harness 必须启动真实 NestJS HTTP server 和一个 PostgreSQL container；connection A/B 是同一数据库的独立 pool。并发 hook 只在测试依赖注入中实现，生产代码不得包含屏障。Recording Gateway 以 Outbox event ID 为 effect key，对重复 effect key 返回已有结果。

- [ ] **Step 4: 写完整 23 项具名验收测试**

每项测试必须使用下表给出的真实驱动与断言；标题中的两位编号是验收追踪键：

| # | 精确测试文件和标题 | 真实驱动 | 必需断言 |
|---|---|---|---|
| 01 | `stage-one-webhook.integration.spec.ts` — `rejects an invalid webhook secret_token` | HTTP POST 有错误 Secret | 401；Inbox/users 均 0 |
| 02 | 同文件 — `rejects a missing webhook secret_token` | HTTP POST 无 Secret header | 401；handler 调用 0 |
| 03 | 同文件 — `rejects only a malformed update envelope` | 有效假 Secret + 缺少/非法 `update_id` 或非对象 envelope | 400；Inbox/users 0 |
| 04 | 同文件 — `returns 200 ignored for legal unsupported updates` | 照片、贴纸、服务消息、callback query、群聊、无 from、非 `/start` | 每种 200 ignored；users/Outbox 0 |
| 05 | 同文件 — `creates one uid for the first start` | 合成私聊 `/start` | users/membership/binding/registration 各 1 |
| 06 | 同文件 — `returns the same uid for a repeated start` | 同 user、不同 update_id 的第二次 `/start` | 两次解析 UID 相同；users 仍 1 |
| 07 | 同文件 — `distinguishes full-update replay, rotation and update-id conflict` | 同 update_id 的完整 Update 重放（含仅 object key order 不同）、轮换后的 retained old key 重放，以及分别改动 text、start parameter、callback data、from.id、chat.id、顶层 update 类型/未知字段；再移除原 key | 键序等价为 duplicate_same_payload；retained original version 仍为 duplicate；每个字段改变均为 conflict；移除原 key 时稳定 503/digest_key_unavailable；Inbox 原 `payload_digest`/`digest_key_version` 不覆盖、无新 Outbox |
| 08 | `registration-concurrency.integration.spec.ts` — `creates one uid under true concurrent first registration` | connection A/B 在屏障后 `Promise.all` | users/membership/active binding/UidCreated 各 1 |
| 09 | 同文件 — `allows only one active binding for one telegram user` | 两个事务竞争同 external user | active binding 1；两个结果 UID 相同 |
| 10 | `stage-one-webhook.integration.spec.ts` — `keeps uid stable when username changes` | `old_name` 后 `new_name` | UID 不变；快照为 `new_name` |
| 11 | 同文件 — `resolves a binding when username is absent` | `from.username` 缺失 | 200；同一 UID；快照 null |
| 12 | 同文件 — `publishes UidCreatedV1 once` | 首次、重复、并发组合 | topic `identity.uid-created.v1` 数量 1 |
| 13 | 同文件 — `publishes TelegramUserSeenV1 without another registration` | 已绑定用户新 update_id | seen topic 1；users/registration 不增加 |
| 14 | `registration-failure.integration.spec.ts` — `rolls back the whole transaction when uid creation fails` | 在 createUser 前注入确定性数据库错误 | users/memberships/bindings/registration/Outbox 全 0 |
| 15 | 同文件 — `leaves no half-registration when outbox insertion fails` | Outbox repository 注入确定性失败 | 所有身份表与 Inbox 回滚为 0 |
| 16 | `outbox-recovery.integration.spec.ts` — `redelivers after external success before local acknowledgement` | recording gateway 成功后注入确认前崩溃并重启 worker | 消息 at-least-once 重投；使用 event ID 幂等的 gateway effect 为 1；不支持幂等的 fixture 记录 duplicate-risk 审计 |
| 17 | `sensitive-logging.spec.ts` — `rejects sensitive values even under allowed field names` | 允许字段中注入 Secret、完整合成 Update、canonical bytes、keyring material、嵌套对象、控制字符、超长值；轮换 logger HMAC key | Pino 与 span attributes 均无 raw/sensitive 值；非法 event/对象丢弃；logger HMAC 与 Inbox digest HMAC reference/material 独立，伪名有版本且新旧审计关联受控 |
| 18 | `stage-one-schema-boundary.integration.spec.ts` — `creates no asset, ledger, balance, wallet or raw Update record during registration` | 完成一次注册后查询 information_schema | 资产禁止表/列名集合交集为空；`inbox_messages` 有 `payload_digest`/`digest_key_version`，且无 `payload_hash`、`payload`、`body`、`raw_update`、`update_json`、`message_text`、`callback_data`、`start_parameter`、`payment_password` 等 raw 列 |
| 19 | 同文件 — `applies migrations through the role chain from an empty database` | 锁定 digest 的 PostgreSQL + Flyway LOGIN + afterConnect callback `SET ROLE` | applied versions `['1']`；Flyway 角色成功；platform/worker 迁移越权被拒绝 |
| 20 | 同文件 — `validates repeated migrations without drift` | 同库第二次 migrate + validate | 新版本 `[]`；validate true；非授权对象访问 permission denied |
| 21 | `dependency-boundaries.spec.ts` — `rejects a reverse dependency from identity to telegram` | 对隔离违规 fixture 运行 depcruise | 非零 exit；stderr 含规则名 |
| 22 | `dependency-boundaries.spec.ts` — `keeps full suite orchestration outside Vitest` | 静态读取测试文件与 scripts | 测试代码不启动根测试脚本；根 `test:all` 只作外部编排 |
| 23 | `platform-process.lifecycle.spec.ts` 与 `worker-process.lifecycle.spec.ts` — `starts, becomes ready, and stops without external connections` | 从 Vitest 启动受控子进程，轮询本地 ready，发 SIGTERM | 启动超时≤15秒、就绪 200、SIGTERM 后退出码 0、10秒内结束、端口/临时资源清理、网络客户端调用 0 |

测试文件必须直接调用 StageOneHarness、Testcontainers、受控子进程或静态测试脚本检查并执行表中断言，不允许空测试、固定成功、仅检查名称，且不得调用根完整套件命令或包含自身的测试脚本。

- [ ] **Step 5: 运行聚焦并发绿灯**

Run: `pnpm exec vitest run --project integration apps/platform/test/integration/registration-concurrency.integration.spec.ts --pool=forks --maxWorkers=1`

Expected: 两个请求都返回 200；users/memberships/active bindings/UidCreated 均为 1；测试输出记录两个独立连接在释放屏障前同时到达。

- [ ] **Step 6: 运行完整阶段 1 绿灯**

Run: `pnpm test:all`

Expected: 所有命令 exit 0；23 项具名验收均 PASS；无 skipped、only 或 retry 掩盖失败。

- [ ] **Step 7: 重构检查**

检查测试没有顺序循环冒充并发、没有真实 Telegram、没有固定成功替身替代数据库、没有泄露容器连接串；检查失败注入只存在测试装配。

- [ ] **Step 8: 文档同步**

把实际 Node、pnpm、PostgreSQL/Flyway 镜像版本、命令、通过/失败数和未执行项记录到 `docs/status/verification.md`；不得把计划命令写成已运行。

- [ ] **Step 9: 精确验收**

23 项逐项可追溯到真实测试；完整 Update canonical/HMAC、object key-order 等价、字段变化冲突、key rotation retained replay、缺 key 失败关闭、raw storage/log/trace 禁止均落入 07/17/18；并发测试有同步屏障和两个连接证据；所有失败注入后数据库没有半注册；外部成功后本地确认崩溃时遵循 at-least-once；进程验收验证 readiness、SIGTERM、退出码、超时和清理。

- [ ] **Step 10: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add packages/testing apps/platform/test apps/worker/test
git commit -m "test: verify stage one concurrency and recovery"
```

---

### Task 14: 文档、索引、状态与最终验证同步

**准确目标：** 仅在 Tasks 1–13 的真实证据完成后，把实现事实同步到权威文档和索引；阶段 1 代码先进入等待用户验收的 `READY`，不得因测试通过自动标为 `VERIFIED` 或获得部署授权。

**Files 创建/修改清单：**
- Modify: `package.json`
- Create: `scripts/check-docs.mjs`
- Modify: `AGENTS.md`
- Modify: `docs/00-index.md`
- Modify: `docs/governance/documentation-contract.md`
- Modify: `docs/governance/ai-handoff.md`
- Modify: `docs/architecture/runtime-topology.md`
- Modify: `docs/architecture/data-and-money-flow.md`
- Modify: `docs/architecture/trust-boundaries.md`
- Modify: `docs/architecture/domain-map.md`
- Modify: `docs/domains/identity-and-membership.md`
- Modify: `docs/domains/telegram-experience.md`
- Modify: `docs/domains/platform-operations.md`
- Modify: `docs/operations/observability.md`
- Modify: `docs/security/threat-model.md`
- Modify: `docs/security/security-gates.md`
- Modify: `docs/testing/strategy.md`
- Modify: `docs/testing/acceptance-gates.md`
- Modify: `docs/research/source-register.md`
- Modify: `docs/status/current.md`
- Modify: `docs/status/next.md`
- Modify: `docs/status/active-work.md`
- Modify: `docs/status/progress-log.md`
- Modify: `docs/status/verification.md`
- Modify: `docs/plans/active-plan-index.md`
- Modify: `docs/plans/roadmap.md`
- Modify: `docs/plans/2026-07-20-stage-1-foundation-identity-implementation-plan.md`
- Create: `packages/testing/test/documentation/stage-one-documentation.spec.ts`

**输入接口：** Tasks 1–13 的最终文件清单、命令输出、失败记录、授权记录和残余风险。

**输出接口：** 无断链的文档树；阶段 1 实现状态 `READY` 或真实失败对应的 `BLOCKED/BUILDING`；唯一下一步是用户验收实现或处理明确失败。

**前置依赖：** Tasks 1–13 全部完成且最终变更已重新验证；任何失败未解决时不得使用成功路径状态。

**不应修改的文件：** 不在本 Task Files 的业务实现、数据库 migration、依赖锁和任何项目外文件；项目外交付由本次规划任务另行在指定输出目录生成。

**失败场景：** 文档先于实现宣布完成、链接逃逸/断裂、状态或授权漂移、阶段 0 改变、验收编号不连续、脚本在测试内部递归、声明运行了未授权命令。

**测试先行顺序：** 先写文档契约与链接/状态/编号红灯；实现 check-docs；对照实现证据填充状态；绿灯后复核无未列文件。

**验证命令：** 未来获准代码/依赖后运行 `pnpm docs:check`；本轮只执行不依赖工程产物的 Markdown 静态检查。

**完成标准：** 权威文档只陈述有证据的事实；阶段 1 代码需用户验收才可 VERIFIED；四项授权不因计划/测试改变。

**文档同步要求：** 完整同步本计划列出的索引、领域、架构、安全、测试和状态权威文件，并在进度日志保留 BUILDING→READY 记录。

- [ ] **Step 1: 写红灯文档状态测试**

```ts
// packages/testing/test/documentation/stage-one-documentation.spec.ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('stage one documentation handoff', () => {
  it('links the plan and separates implementation readiness from authorization', async () => {
    const [index, current, next, activePlans] = await Promise.all([
      readFile('docs/00-index.md', 'utf8'),
      readFile('docs/status/current.md', 'utf8'),
      readFile('docs/status/next.md', 'utf8'),
      readFile('docs/plans/active-plan-index.md', 'utf8')
    ]);
    expect(index).toContain('2026-07-20-stage-1-foundation-identity-implementation-plan.md');
    expect(activePlans).toContain('阶段 1');
    expect(current).toContain('阶段 1 代码 | READY');
    expect(current).toContain('当前生产部署授权：0');
    expect(next).toContain('用户验收阶段 1 实现');
    expect(next).not.toContain('自动获得部署授权');
  });
});
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm exec vitest run packages/testing/test/documentation/stage-one-documentation.spec.ts`

Expected: FAIL because current/next still描述阶段 1 为 `BUILDING` 或没有实现证据。

- [ ] **Step 3: 写最小文档实现**

每份文件只记录其权威主题：架构文档记录实际边界；领域文档记录实际接口/状态；测试文档记录真实命令；`verification.md` 区分 executed/pass、executed/fail、not executed、static review 和 inference；`progress-log.md` 记录授权与范围；索引只增加准确相对链接。

根 `package.json` 增加 `"docs:check": "node scripts/check-docs.mjs"`，脚本必须真实检查链接并限制目标仍在工作区：

```js
// scripts/check-docs.mjs
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(absolute);
  }
}
await walk(path.join(root, 'docs'));
files.push(path.join(root, 'AGENTS.md'), path.join(root, 'README.md'));

const failures = [];
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of files) {
  const markdown = await readFile(file, 'utf8');
  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const relative = decodeURIComponent(target.split('#', 1)[0]);
    if (relative.length === 0) continue;
    const resolved = path.resolve(path.dirname(file), relative);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      failures.push(`${path.relative(root, file)} escapes root: ${target}`);
      continue;
    }
    await stat(resolved).catch(() => failures.push(
      `${path.relative(root, file)} missing: ${target}`
    ));
  }
}
const index = await readFile(path.join(root, 'docs/00-index.md'), 'utf8');
if (!index.includes('2026-07-20-stage-1-foundation-identity-implementation-plan.md')) {
  failures.push('docs/00-index.md does not link the stage one plan');
}
if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
}
```

若所有实现检查通过，最终状态必须为：阶段 0 `VERIFIED`；阶段 1 计划 `READY`；阶段 1 代码 `READY（等待用户验收）`；数据库框架 `READY（仅本地测试）`；真实 Telegram 连接 `NOT_STARTED`；生产部署 `NOT_STARTED`。业务代码开发授权记录执行结束时的真实值，不能由实现完成自动改为 0 或 1。若任一必需检查失败，按真实情况保留 `BUILDING` 或标记 `BLOCKED` 并把唯一修复动作写入 next。

- [ ] **Step 4: 运行绿灯、链接和禁止项检查**

Run: `pnpm exec vitest run packages/testing/test/documentation/stage-one-documentation.spec.ts && pnpm docs:check`

Expected: 文档状态测试 PASS；Markdown 相对链接 0 断链；总索引包含实施计划；文档不含 Secret 或虚构命令结果。

- [ ] **Step 5: 重构检查**

比较每个文档变更与真实代码/测试；删除重复完整规则并改为相对链接；检查 `current`、`next`、`active-work`、roadmap 和计划状态完全一致。

- [ ] **Step 6: 最终回归**

Run: `pnpm typecheck && pnpm architecture:check && pnpm test:unit && pnpm test:db && pnpm test:integration && pnpm docs:check`

Expected: 所有命令基于最终文档和代码 exit 0；如果任何命令失败，不得提交成功状态文档。

- [ ] **Step 7: 文档同步**

本任务本身即文档同步；`verification.md` 必须记录本任务所有实际通过、失败和未执行命令，`progress-log.md` 必须记录没有扩大到资金或生产范围。

- [ ] **Step 8: 精确验收**

索引、状态、领域、架构、安全、测试和计划全部可追溯；阶段 1 实现是否完成与用户授权是两个独立事实；真实外部连接和部署仍为 0。

- [ ] **Step 9: 提交检查点**

只有用户另行授权 Git 和代码实施后才能执行，本轮禁止执行。

```bash
git add docs packages/testing/test/documentation/stage-one-documentation.spec.ts
git commit -m "docs: record stage one implementation evidence"
```

---

## Requirement-to-Task Traceability

| 阶段 1 要求 | 任务 |
|---|---|
| Monorepo、strict、精确依赖矩阵、首次/后续 pnpm lockfile 流程、platform、worker、contracts/config/testing | Task 1 |
| Zod 配置、Secret 引用、Inbox keyring 轮换/保留、结构化日志、实际使用的 OpenTelemetry API | Tasks 2、5、9、11 |
| PostgreSQL、Flyway、Kysely、Testcontainers、角色权限、最小表 | Task 3 |
| Unit of Work 与事务边界 | Task 4 |
| Inbox 与 update_id 去重、完整 Update canonical JSON、版本化 HMAC、raw Update 零持久化 | Tasks 3、5、9、10、11、13 |
| Outbox、持久任务、worker、租约和重复消费 | Task 6 |
| UID、会员、绑定、资料、注册幂等、UidCreated 合同 | Tasks 7、8 |
| 并发 ResolveOrCreateUid | Tasks 8、13 |
| HTTPS/Secret/content-type/大小/Zod Webhook、canonical digest/key-unavailable 失败关闭边界 | Task 9 |
| `/start`、主菜单、提交后发送和失败重试 | Task 10 |
| 日志字段白名单与敏感测试 | Task 11 |
| dependency-cruiser 反向依赖门禁 | Task 12 |
| 23 项单元/数据库/进程/并发/恢复验收 | Task 13 |
| 文档、索引、状态和最终验证 | Task 14 |

## Database Atomicity and Permission Summary

1. Webhook Secret、HTTPS、类型、大小和 Zod 校验发生在事务外；无效请求不写 Inbox。
2. 有效 `/start` 在一个 `UnitOfWork` 中依次认领 Inbox、执行 `ResolveOrCreateUid`、写身份事件 Outbox 和主菜单 Outbox。
3. 任一数据库写失败导致整个事务回滚；不存在只有 users 而没有 membership/binding，或只有身份而没有身份 Outbox 的半注册。
4. 重复 update_id 在 Inbox 使用原记录的 `digest_key_version` 比对完整 Update HMAC；相同摘要返回 duplicate，不同摘要冲突，缺少原版本 key 失败关闭；三种非 claimed 结果均不发布用户 seen 或菜单事件。
5. 不同 update_id 的并发首次注册通过 registration reservation 唯一键串行化；输家读取赢家已提交 UID。
6. platform 角色写身份、Inbox 和 Outbox 所需列；worker 角色只领取/更新 Outbox、durable_jobs 并读取发送所需绑定；Flyway 角色管理 schema/history；普通应用不能改迁移历史。
7. `audit_events` 在阶段 1 只建立最小追加式表和权限边界，自动注册事务不写该表，因此严格遵守注册只创建指定身份记录与 Outbox 的范围。

## Sensitive Data Summary

- HTTP body 与完整 parsed Update 仅在请求解析/canonical HMAC 的短作用域内短暂存在；Inbox 只保存 `payload_digest` 与 `digest_key_version`，不保存 body、raw Update、canonical bytes、正文、callback 或 start 参数。
- 日志只保存 correlation_id、update_id、uid、Telegram user.id 受控摘要、route、outcome、Inbox/Outbox ID、错误类别、延迟和重试次数。
- Outbox 身份事件只保存 UID、bindingId、事件/关联 ID 和时间；主菜单事件只保存 UID、bindingId、menuVersion。
- Secret resolver 返回的值只用于 constant-time 比较、短期 HMAC 或受控配置，不进入 Pino context、错误响应、trace attribute、Inbox、Outbox 或 audit；Inbox digest keyring 与 Telegram user-reference logger HMAC key 分离。旧 Inbox digest key 至少保留 Inbox 保留期加 Telegram 重试窗口，缺失时失败关闭。
- 测试中的 Secret、Token 和 Telegram 标识全部是合成值；recording Gateway 不发网络请求。

## Rollback and Recovery

- Task 1–12 每个提交检查点都可在另行授权 Git 后独立回退；数据库迁移一旦在共享环境应用不得假设自动可逆，阶段 1 只允许临时 Testcontainers 空库。
- 注册事务失败依靠 PostgreSQL 回滚，无补偿性删除；已提交 UID 不因菜单发送失败删除。
- Outbox handler 失败进入 retry；租约过期可由新 worker 接管；已完成 event ID 不再产生 effect。
- 无真实外部连接，因此阶段 1 不存在生产消息撤回、真实用户清理或生产数据回滚动作。

## Execution Handoff

当前阶段 1 总计划 READY v1.2.6、代码 BUILDING；Tasks 1–4 VERIFIED。第 8/48 步与 Task 4 实施结果为 COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS。Task 5 独立详细计划 READY v1.3 / WAITING_EXTERNAL_REVIEW，代码 NOT_STARTED；第 9/48 步 WAITING_EXTERNAL_REVIEW，第 10/48 步与 Tasks 6–14 NOT_STARTED。唯一下一步是等待用户外部复审 Task 5 v1.3。Git、worktree、代理、Telegram、其他业务外部连接、共享/生产数据库和部署仍未授权。
