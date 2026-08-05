# 外部来源登记

状态：7 个指定官方 URL 全部访问成功；RECHECK_REQUIRED：0。外部事实不自动成为产品决定。

实际访问/复核记录时间：2026-07-19T11:59:15-07:00（Mountain Standard Time；批量访问和章节定位完成时记录）。本轮只使用 Telegram 官方公开资料。

| 完整 URL | 页面标题或章节 | 实际访问时间 | 本项目使用的事实 | 直接支持 | 解释限制 |
|---|---|---|---|---|---|
| [https://core.telegram.org/bots/](https://core.telegram.org/bots/) | Bots: An introduction for developers / How Are Bots Different from Users? | 2026-07-19T11:59:15-07:00 | Bot 不能主动发起与用户的会话；用户必须先发消息、添加 Bot 或打开 Bot 链接 | 是 | 说明一般 Bot 会话边界；不证明某个 user_id 已可被本 Bot 联系 |
| [https://core.telegram.org/bots/features#deep-linking](https://core.telegram.org/bots/features#deep-linking) | Telegram Bot Features / Deep Linking；同时复核 Chat and User Selection、Inline Requests | 2026-07-19T11:59:15-07:00 | start 参数允许 A-Z、a-z、0-9、下划线和连字符，最多 64 字符，建议 base64url；inline mode 由用户在任意聊天输入 Bot username 并选择结果发送 | 是 | inline mode 支持用户主动分享内容，但单页不声明 Bot 因此获得与接收者私聊的权限 |
| [https://core.telegram.org/api/links#bot-links](https://core.telegram.org/api/links#bot-links) | Deep links / Bot links | 2026-07-19T11:59:15-07:00 | t.me Bot 链接支持 start parameter，最多 64 个 base64url 字符，并由用户点击 Start 触发 | 是 | 描述客户端链接语义，不定义领取令牌的熵、一次性、过期或业务授权 |
| [https://core.telegram.org/bots/api](https://core.telegram.org/bots/api) | Telegram Bot API / setWebhook、KeyboardButton、SharedUser | 2026-07-19T11:59:15-07:00 | Webhook 收到非 2xx 响应会重试；API 定义用户选择与共享用户对象 | 是 | “合理次数”没有固定重试次数或时长，应用仍必须自行幂等 |
| [https://core.telegram.org/bots/api#setwebhook](https://core.telegram.org/bots/api#setwebhook) | Telegram Bot API / setWebhook | 2026-07-19T11:59:15-07:00 | secret_token 会通过 X-Telegram-Bot-Api-Secret-Token 请求头出现在每个 Webhook 请求中；非 2xx 会重试 | 是 | 请求头是来源校验的一层，不替代 HTTPS、请求限制、Update 去重和业务授权 |
| [https://core.telegram.org/bots/api#keyboardbuttonrequestusers](https://core.telegram.org/bots/api#keyboardbuttonrequestusers) | Telegram Bot API / KeyboardButton.request_users、KeyboardButtonRequestUsers | 2026-07-19T11:59:15-07:00 | request_users 打开候选用户选择并通过 users_shared 返回标识；该按钮仅适用于私聊 | 是 | 选择结果是候选输入，不证明平台绑定、资产所有权或 Bot 可联系该用户 |
| [https://core.telegram.org/bots/api#shareduser](https://core.telegram.org/bots/api#shareduser) | Telegram Bot API / SharedUser | 2026-07-19T11:59:15-07:00 | user_id 不保证 Bot 已能访问或使用该标识，除非用户已通过其他方式为 Bot 所知 | 是 | “可能不可用”要求本项目运行时验证绑定/可达性，不能从文档推断具体用户状态 |

所有 7 项均有直接官方页面访问证据，无失败项。跨页面结论“inline mode 只改变用户主动分享入口，不改变 Bot 不能主动联系陌生用户的限制”是把 Bots 会话限制与 Features inline 行为合并后的项目推论，两个基础事实分别由官方页面直接支持。

来源只证明 Telegram 平台能力，不证明换汇通已经实现、配置或获准使用任何功能。采用结论见 [telegram-feasibility.md](telegram-feasibility.md)。

## 2026-07-21 阶段 1 v1.2 只读技术核验

本节为实施计划的只读技术核验，不表示已经安装依赖、拉取镜像、启动容器或连接 Telegram。

| 完整 URL | 访问日期 | 结论 | 计划适用范围与限制 |
|---|---|---|---|
| [Vitest Projects](https://vitest.dev/guide/projects) | 2026-07-21 | `workspace` 和 `--workspace` 已弃用；多项目配置使用 `vitest.config.ts` 的 `test.projects`。 | Task 1 使用 `test.projects`，完整编排只在 Vitest 进程外运行。 |
| [Node.js downloads](https://nodejs.org/en/download/) | 2026-07-21 | Node 24 LTS 有官方发布渠道。 | 计划基线锁定 Node `24.18.0`；实施时须重新核验可用补丁及安全公告。 |
| [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/) | 2026-07-21 | 主要版本持续接收修复，补丁版本应跟随维护发布。 | Task 3 使用精确 PostgreSQL 18.4 标签；安全更新需审批、lockfile/digest 变更和全量验证。 |
| [Testcontainers Node PostgreSQL module](https://node.testcontainers.org/modules/postgresql/) | 2026-07-21 | 提供 PostgreSqlContainer 作为 PostgreSQL 测试容器入口。 | 仅作为未来 Task 3/13 隔离测试计划；本轮未启动。 |
| [Docker Official Image PostgreSQL tags](https://github.com/docker-library/docs/blob/master/postgres/README.md) | 2026-07-21 | 官方标签表列出 `postgres:18.4-alpine3.23`。 | 禁止 `postgres:18-alpine` 等浮动标签；完整 digest 待未来获准拉取时验证。 |
| [Flyway Docker](https://documentation.red-gate.com/flyway/reference/usage/flyway-docker) | 2026-07-21 | Flyway 提供官方 Docker 镜像；Dockerfile公开。 | Task 3 使用精确 `flyway/flyway:12.11.0-alpine` 标签，运行时真实使用 `flyway.toml`。 |
| [Flyway Open Source Docker](https://documentation.red-gate.com/flyway/reference/usage/flyway-open-source) | 2026-07-21 | Open Source Docker image 的版本化拉取示例使用精确版本。 | 版本/digest 由 `toolchain-lock.json` 记录；不能从本轮只读资料编造完整 digest。 |
| [grammY webhookCallback](https://grammy.dev/ref/core/webhookcallback) | 2026-07-21 | grammY 提供 webhook callback adapter。 | Task 9 只在 Telegram adapter 边界使用；不调用 `bot.start()`。 |
| [grammY deployment types](https://grammy.dev/guide/deployment-types) | 2026-07-21 | Webhook 部署与 long polling 生命周期不同。 | 测试注入 BotInfo，禁用真实网络与 `getMe`。 |
| [Telegram setWebhook](https://core.telegram.org/bots/api#setwebhook) | 2026-07-21 | Webhook 支持 secret token header，非 2xx 可能重试。 | Secret、200 ignored、Inbox 冲突和幂等约束由 Task 5/9/10 实现；本轮未调用 API。 |

## 2026-07-21 阶段 1 v1.2.1 施工前依赖与 lockfile 只读核验

本节只记录 npm 官方注册表和 pnpm 官方文档的只读结果，不表示已经创建 manifest、安装依赖、生成 lockfile、拉取镜像或执行工程命令。所有版本被固定到主计划的直接依赖矩阵；每个 package 的 owner/workspace 与实际 import 见[阶段 1 实施计划](../plans/2026-07-20-stage-1-foundation-identity-implementation-plan.md#version镜像与可复现性门禁)。

| 官方来源 | 读取版本 | 计划中的直接 owner |
|---|---:|---|
| [pnpm registry](https://registry.npmjs.org/pnpm/latest) | `pnpm@11.15.1` | 根 `packageManager` |
| [TypeScript registry](https://registry.npmjs.org/typescript/latest) | `typescript@7.0.2` | 根 dev |
| [dependency-cruiser registry](https://registry.npmjs.org/dependency-cruiser/latest) | `dependency-cruiser@18.1.0` | 根 dev |
| [@types/node registry](https://registry.npmjs.org/%40types%2Fnode/24.13.3) | `@types/node@24.13.3` | 根 dev；与 Node 24 基线对应 |
| [Vitest registry](https://registry.npmjs.org/vitest/latest) | `vitest@4.1.10` | 根及测试 workspace dev |
| [Zod registry](https://registry.npmjs.org/zod/latest) | `zod@4.4.3` | `packages/config` runtime |
| [Nest common registry](https://registry.npmjs.org/%40nestjs%2Fcommon/latest) | `@nestjs/common@11.1.28` | `apps/platform` runtime |
| [Nest core registry](https://registry.npmjs.org/%40nestjs%2Fcore/latest) | `@nestjs/core@11.1.28` | `apps/platform` runtime |
| [Nest Express registry](https://registry.npmjs.org/%40nestjs%2Fplatform-express/latest) | `@nestjs/platform-express@11.1.28` | `apps/platform` runtime |
| [Nest testing registry](https://registry.npmjs.org/%40nestjs%2Ftesting/latest) | `@nestjs/testing@11.1.28` | `apps/platform` dev |
| [grammY registry](https://registry.npmjs.org/grammy/latest) | `grammy@1.45.1` | `apps/platform` runtime |
| [Kysely registry](https://registry.npmjs.org/kysely/latest) | `kysely@0.29.4` | `apps/platform`、`apps/worker` runtime |
| [pg registry](https://registry.npmjs.org/pg/latest) | `pg@8.22.0` | platform/worker runtime；`packages/testing` dev |
| [@types/pg registry](https://registry.npmjs.org/%40types%2Fpg/latest) | `@types/pg@8.20.0` | `packages/testing` dev |
| [Pino registry](https://registry.npmjs.org/pino/latest) | `pino@10.3.1` | `apps/platform`、`apps/worker` runtime |
| [reflect-metadata registry](https://registry.npmjs.org/reflect-metadata/latest) | `reflect-metadata@0.2.2` | `apps/platform` runtime |
| [RxJS registry](https://registry.npmjs.org/rxjs/latest) | `rxjs@7.8.2` | `apps/platform` runtime |
| [OpenTelemetry API registry](https://registry.npmjs.org/%40opentelemetry%2Fapi/latest) | `@opentelemetry/api@1.9.1` | `apps/platform`、`apps/worker` runtime |
| [Testcontainers registry](https://registry.npmjs.org/testcontainers/latest) | `testcontainers@12.0.4` | `packages/testing` dev |
| [Testcontainers PostgreSQL registry](https://registry.npmjs.org/%40testcontainers%2Fpostgresql/latest) | `@testcontainers/postgresql@12.0.4` | `packages/testing` dev |
| [Supertest registry](https://registry.npmjs.org/supertest/latest) | `supertest@7.2.2` | `apps/platform` dev |
| [@types/supertest registry](https://registry.npmjs.org/%40types%2Fsupertest/latest) | `@types/supertest@7.2.1` | `apps/platform` dev |

[pnpm install 官方文档](https://pnpm.io/cli/install)明确：`--lockfile-only` 只更新 manifest/lockfile 而不写入 `node_modules`，`--frozen-lockfile` 在 lockfile 缺失或与 manifest 不同步时失败，`--ignore-scripts` 禁止执行项目及依赖脚本。[pnpm workspace protocol 文档](https://pnpm.io/workspaces#workspace-protocol-workspace)明确 `workspace:1.0.0` 只解析本地匹配版本而不会回退 registry。[pnpm settings 文档](https://pnpm.io/settings)说明 `nodeVersion`/`engineStrict`、`strictDepBuilds`、`allowBuilds` 与 `dangerouslyAllowAllBuilds` 的门禁语义；pnpm 11 的已移除旧构建白名单设置不得重引入。因此主计划把首次精确解析限定为 `pnpm install --lockfile-only --ignore-scripts`，经 lockfile SHA、完整 transitive/registry/integrity/script 审查后才以 `pnpm install --frozen-lockfile --ignore-scripts` materialize；后续安装只允许 frozen 流程，内部合同固定 `0.1.0` 且 importer 使用 `workspace:0.1.0`。

## 2026-07-21 Task 1 工具链恢复来源检查点

固定路径 `C:\Program Files\nodejs\node.exe` 的本机只读检查得到 Node `v24.18.0`、x64、文件/产品版本 `24.18.0`、公司名 `Node.js`、Authenticode `Valid`、签名主体 OpenJS Foundation；同目录 npm 实测 `11.16.0`，Corepack 实测 `0.35.0`。npm 官方 registry `https://registry.npmjs.org/` 返回：`corepack@0.35.0` integrity `sha512-9BuIGHDFE7Zieor1CeRsvt7X7AJFEuJ6OnbSbsVprq83ChDFoBh1wP98NeUS9FT3ZwlzFllPElXcz/OiDf0YGw==`、shasum `558fd9245bb53f9cec2b5a5a37dc25ae4505c13d`；`pnpm@11.15.1` integrity `sha512-gTULB+U8lTigLx8jA7QpD6LXvgTlbiqXDEzEtBfcdh3hlu2r1J1Vx9yVgNuBAHxEFD5OPX5GKzAA0jwlUSLQZQ==`、shasum `b4742275b224555be527ba8a784f26829c397154`。两者 scripts 均不含 `preinstall`、`install` 或 `postinstall`。该来源核验只授权本轮用户级工具链与 Task 1，不扩大到其他 registry、Task 2 或外部业务服务。

Task 1 的 21 个直接 registry 包随后均以精确版本从同一官方 registry 复核，version 21/21 匹配，integrity/shasum 21/21 存在，直接包 `preinstall/install/postinstall` 0。frozen/ignore-scripts materialize 后识别出三项传递 lifecycle：`protobufjs@7.6.5` postinstall `node scripts/postinstall`，integrity `sha512-/FPD0nUc9jH6rfFjji9IBqOz4pcSE3CsT1m7Ep6Mdb0LxSUMj8hgl6GomOvZzpNpAqqGaXA0P3VSrZLFzIhQrw==`；`ssh2@1.17.0` install `node install.js`，integrity `sha512-wPldCk3asibAjQ/kziWQQt1Wh3PgDFpC0XpwclzKcdT1vql6KeYxf5LIt4nlFkUeR8WuphYMKqUA56X4rjbfgQ==`；可选 `cpu-features@0.0.10` install `node buildcheck.js > buildcheck.gypi && node-gyp rebuild`，integrity `sha512-9IkYqtX3YHPCzoVg1Py+o9057a3i0fp7S530UWokCSaFVTc7CwXPRiOjRjBQQ18ZCNafx78YfnG+HALxtVmOGA==`。三者均因 `--ignore-scripts` 保持 pending，执行 0，未进入 `allowBuilds`。

最终复核未引入新外部来源；仍只使用 npm 官方 registry 与已登记的项目权威资料。Task 1 完成不授权 Task 2、容器、Telegram、Git 或部署。

## 2026-07-23 Task 3 详细计划只读技术核验

本节只登记 Task 3 计划实际采用的官方资料与官方 registry 元数据。访问成功 23/23，失败 0，`RECHECK_REQUIRED` 0。本轮没有拉取镜像、启动容器、连接数据库或修改 `toolchain-lock.json`。Docker Hub tag API 与 Docker Registry V2 manifest 响应交叉核验了 tag 的 manifest-list digest 和唯一 `linux/amd64` child digest；两类 digest 不可互换。

| # | 官方来源 | 访问日期 | 计划采用的事实与限制 |
|---:|---|---|---|
| 1 | [PostgreSQL 18 CREATE ROLE](https://www.postgresql.org/docs/18/sql-createrole.html) | 2026-07-23 | `LOGIN/NOLOGIN`、`SUPERUSER`、`CREATEDB`、`CREATEROLE`、`INHERIT`、`REPLICATION`、`BYPASSRLS` 是明确角色属性；计划中的 app/Flyway 组角色均为最小权限 `NOLOGIN`。 |
| 2 | [PostgreSQL 18 GRANT](https://www.postgresql.org/docs/18/sql-grant.html) | 2026-07-23 | 角色成员资格支持 `WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`；每个测试 LOGIN 只可切换到一个组角色。 |
| 3 | [PostgreSQL 18 SET ROLE](https://www.postgresql.org/docs/18/sql-set-role.html) | 2026-07-23 | `SET ROLE` 以成员资格切换当前角色；每次 Flyway/Kysely 实际连接都必须切换并核验 `current_user`。 |
| 4 | [PostgreSQL 18 Privileges](https://www.postgresql.org/docs/18/ddl-priv.html) | 2026-07-23 | 表、schema、database 权限相互独立；计划显式撤销 PUBLIC 默认能力并分别授予 CONNECT、USAGE 与表权限。 |
| 5 | [PostgreSQL 18 Date/Time Types](https://www.postgresql.org/docs/18/datatype-datetime.html) | 2026-07-23 | `timestamp with time zone` 对应 `timestamptz`；阶段 1 所有时间点列统一采用该类型。 |
| 6 | [Docker Official Image: postgres](https://hub.docker.com/_/postgres) | 2026-07-23 | `postgres` 是 Docker Official Image；计划只锁定精确 tag 与平台 child digest，不使用主要版浮动 tag。 |
| 7 | [Docker Library postgres tags](https://github.com/docker-library/docs/blob/master/postgres/README.md) | 2026-07-23 | 官方标签集合包含 `18.4-alpine3.23`；仅作为 tag 真实性证据，不替代 manifest digest 核验。 |
| 8 | [Docker Hub postgres tag metadata](https://hub.docker.com/v2/repositories/library/postgres/tags/18.4-alpine3.23) | 2026-07-23 | tag manifest-list digest 为 `sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e`。 |
| 9 | [Docker Registry postgres manifest](https://registry-1.docker.io/v2/library/postgres/manifests/18.4-alpine3.23) | 2026-07-23 | 唯一 `linux/amd64` child digest 为 `sha256:2342268e5cf8851c327dcf10fc124283448428059f9b756692b7e3302940d769`；实际执行引用必须使用 child digest。 |
| 10 | [Kysely PostgresDialectConfig API](https://kysely-org.github.io/kysely-apidoc/interfaces/PostgresDialectConfig.html) | 2026-07-23；2026-07-24 本地 0.29.4 源码复核 | 历史资料证明 hook 存在，不证明抛错时 client 会自动释放。Kysely 0.29.4 本地 `PostgresDriver` 显示先 `pool.connect()`、后 `onReserveConnection`，hook 抛错不会进入正常 release；Task 3 v1.2 因而禁止用会抛错的 hook 作角色门禁，改为 `RoleEnforcingPostgresPool.connect()`。 |
| 11 | [Kysely API](https://kysely-org.github.io/kysely-apidoc/classes/Kysely.html) | 2026-07-23；2026-07-24 本地 0.29.4 源码复核 | `destroy()` 释放已初始化 dialect；历史简写不能覆盖未初始化 driver 的 pool 生命周期。Task 3 v1.2 的 `close()` 先缓存 deferred，再组合私有 `database.destroy()` 与 wrapper 粘滞 `end()`，确保真实 `pg.Pool.end()` 最多一次；公开 `db` 类型不含 `destroy`。 |
| 12 | [Testcontainers PostgreSQL module](https://node.testcontainers.org/modules/postgresql/) | 2026-07-23 | 当前 API 提供 `PostgreSqlContainer` 与启动后连接信息；只用于未来获批的真实 PostgreSQL integration test。 |
| 13 | [Testcontainers networking](https://node.testcontainers.org/features/networking/) | 2026-07-23 | 当前 API 支持独立 `Network` 与 network alias；Flyway 通过 `postgres` alias 访问同一测试网络。 |
| 14 | [Testcontainers copying files](https://node.testcontainers.org/features/containers/#copying-files-to-a-container) | 2026-07-23 | 当前 API 提供 `withCopyFilesToContainer` 和 `withCopyDirectoriesToContainer`；计划选择复制，避免 Windows/远程 daemon 的宿主 bind 路径依赖。 |
| 15 | [Testcontainers wait strategies](https://node.testcontainers.org/features/wait-strategies/) | 2026-07-23 | 当前 API 提供 wait strategy、one-shot startup 与 startup timeout；计划禁止固定 sleep。 |
| 16 | [Testcontainers container lifecycle](https://node.testcontainers.org/features/containers/) | 2026-07-23 | 容器可配置环境、命令、网络、超时并显式停止；计划要求失败时按 LIFO 逆序清理。 |
| 17 | [Flyway Docker](https://documentation.red-gate.com/flyway/reference/usage/flyway-docker) | 2026-07-23 | 官方 Docker 用法支持配置、SQL 目录与 `migrate/validate` 命令；密码只通过环境进入容器。 |
| 18 | [Flyway Open Source](https://documentation.red-gate.com/flyway/reference/usage/flyway-open-source) | 2026-07-23 | 本 Task 只需 Open Source 的纯 SQL migrate/validate，因此选用官方 `flyway/flyway` 仓库，不选 Redgate editions 仓库。 |
| 19 | [Flyway TOML configuration](https://documentation.red-gate.com/flyway/reference/configuration/flyway-namespace/flyway-toml) | 2026-07-23 | `flyway.toml` 是当前配置格式；计划将 locations/callbackLocations 固定在该文件。 |
| 20 | [Flyway configFiles parameter](https://documentation.red-gate.com/fd/config-files-224002599.html) | 2026-07-23 | `configFiles` 指向显式配置文件；容器内只使用固定 POSIX 路径。 |
| 21 | [Flyway locations setting](https://documentation.red-gate.com/fd/flyway-locations-setting-277579008.html) | 2026-07-23 | SQL migration locations 使用 `filesystem:` 位置；计划固定为容器内只读复制目录。 |
| 22 | [Flyway callbacks concept](https://documentation.red-gate.com/flyway/reference/callbacks) | 2026-07-23 | SQL callback 可在 lifecycle 事件执行；当前 `initSql` 已弃用，计划使用 `afterConnect.sql` 执行固定 `SET ROLE xht_flyway`。 |
| 23 | [Docker Hub flyway tag metadata](https://hub.docker.com/v2/repositories/flyway/flyway/tags/12.11.0-alpine) 与 [Docker Registry flyway manifest](https://registry-1.docker.io/v2/flyway/flyway/manifests/12.11.0-alpine) | 2026-07-23 | manifest-list digest 为 `sha256:6bf3a713f52c4d803a88501f8409dda2191e9ccba1454358a6de2c4cc65f71b0`，唯一 `linux/amd64` child digest 为 `sha256:bd93084ddaf1448d2598feaac75a1c2e7087c529566746724f65b05b481f9704`。 |

采用结果已落入 [Task 3 独立详细计划](../plans/2026-07-23-stage-1-task-3-database-foundation-implementation-plan.md)。这些资料只支持计划中的技术边界与待实施锁定值，不证明数据库、镜像、容器、迁移或权限测试已经执行。

## 2026-07-24 Task 3 v1.2 Flyway telemetry 只读复核

本节只登记 T3R-04 使用的官方资料。访问成功 1/1、失败 0；没有设置 email/token/license、连接 collector、拉取镜像或运行 Flyway。

| 官方来源 | 访问日期 | 计划采用的事实与限制 |
|---|---|---|
| [Redgate Disable Telemetry Environment Variable](https://documentation.red-gate.com/fd/redgate-disable-telemetry-environment-variable-277579301.html) | 2026-07-24 | 官方文档说明 `REDGATE_DISABLE_TELEMETRY` 的任一非空值会阻止 Flyway telemetry client 发送 usage data，并给出环境变量值 `true`；Task 3 v1.2 因而在每个 Flyway one-shot container 固定 `REDGATE_DISABLE_TELEMETRY: 'true'`。该资料不授权或要求 telemetry email、token、license、pipeline publish 或生产 collector。 |

## 2026-07-24 Task 3 v1.2 本地包源码复核

本节只记录已安装依赖的只读源码事实，不是外部网络访问，也不表示启动 Docker、数据库或容器。Kysely `0.29.4` 的 `RuntimeDriver.destroy()` 在未初始化时直接返回，`PostgresDriver.destroy()` 在已初始化时调用 pool `end()`；因此 factory 必须私有持有真实 Kysely，并由统一 `close()` 组合 `database.destroy()` 与粘滞 wrapper `end()`。Testcontainers `12.0.4` 的 `GenericContainer.start()` 在 create/start/copy/wait 完成后才构造 `StartedGenericContainer`，内置 one-shot 对非零退出返回 FAIL；根包公开导出 `StartupCheckStrategy`、`StartupStatus`、`getContainerRuntimeClient` 与 `ContainerRuntimeClient`，runtime client 公开 `dockerode.listContainers({ all: true, filters })`、inspect、stop 和 remove。Task 3 v1.2 仅据这些公开类型设计“进程停止即返回 handle、随后 inspect ExitCode”和无 handle 时的精确 label 回收；未引用私有或占位 API。

## 2026-07-24 Task 3 v1.3 本地能力与交付兼容性复核

本节不增加外部网络来源，只登记精确已安装源码和既有交付物的本地事实。Kysely `0.29.4` 的 `Kysely` 公开运行时表面共扫描 29 个成员；`Omit<Kysely<DB>, 'destroy'>` 仍可经 `withPlugin`、`withoutPlugins`、`withSchema`、四条 table/type 方法、`connection()` 和 `Symbol.asyncDispose` 取得关闭能力。`QueryCreator` 是根包公开的独立运行时类，保留 Task 3 CRUD/CTE/plugin/schema 查询 builder，且本体与安全链不含关闭、connection 或完整 Kysely 重建能力。Testcontainers `12.0.4` 的真实 `DockerContainerClient.logs()` 在 raw dockerode request reject 时 catch 后只结束代理流；无 Docker fake 注入运行得到 raw reject、公开流 resolve、0 bytes、stream error null，因此 v1.3 改用 runtime client 上能够传播失败的 raw Dockerode logs 与 modem demux。

既有 v1.1/v1.2 ZIP 的原始 local/central header 二进制检查分别得到 UTF-8 `0x0800` 为 105/105 与 0/105；v1.2 共 210 个 General Purpose Flag 均为 `0x0000`，虽然名称原始字节严格 UTF-8 解码失败 0，但不具备跨工具编码声明。v1.3 交付门禁因此同时检查 local/central flag、严格 UTF-8、唯一中文顶层目录、正斜杠、安全路径、兼容解压和 105/105 逐文件哈希。

## 2026-07-25 Task 3 v1.4 docker-modem 本地源码复核

本节不增加外部网络来源，只登记已安装精确版本源码与无 Docker TEMP 复现。`docker-modem@5.0.7` 的 `lib/modem.js` 中，`demuxStream()` 只注册 input `data` listener；内部 `pendingStreamType`、`pendingDataLength` 与 residual `buffer` 没有 end/close 校验或调用方可见出口。它允许 stream type 0，不检查 header reserved bytes，非法 type 时退回 raw stdout。`dockerode@5.0.1` 的 `Container.prototype.logs()` 在 `follow: false` 时通过 Promise 返回完整响应数据；Testcontainers `12.0.4` 的 `DockerContainerClient.logs()` 仍会把底层 request rejection catch 后 `proxyStream.end()`。

v1.3 精确收集器的四项无 Docker 复现为：4-byte incomplete header 返回 `""`；声明 payload 5 bytes/实际 `xy` 返回 `""`；只触发 close 的 readable 在 500ms 后仍为 `TIMEOUT`；stdout `synthetic-`、stderr `noise`、stdout `password` 被合并为 `synthetic-noisepassword`，对 `synthetic-password` 的检测为 false。T3R-11 因而 `ACCEPT`。v1.4 采用独立 strict bounded multiplex parser 作为完整性唯一依据；本地源码核验不表示 Docker、容器、数据库或 Task 3 已运行。

## 2026-07-25 Task 3 v1.5 raw Docker request timeout 本地源码复核

本节不增加外部网络来源，只登记已安装精确版本源码与无 Docker TEMP 复现。Dockerode `5.0.1` 的 `Container.prototype.logs()` 把 `args.opts.abortSignal` 写入交给 modem 的 options；docker-modem `5.0.7` 的 `dial()` 把该值赋给底层 Node request 的 `signal`，并为非 stream response 添加 abort signal。`@types/dockerode@4.0.1` 的 `ContainerLogsOptions` 明确公开 `abortSignal?: AbortSignal`。Testcontainers `12.0.4` 的 `DockerContainerClient.logs()` 仍固定 `follow: true` 且 catch raw rejection 后结束代理流；因此 Task 3 runner 继续绕过该 wrapper，直接使用 raw Dockerode。

逐字提取的 v1.4 最终 `readLogs()` 在 fake `container.logs()` 返回永久 pending Promise 时，400ms 后仍为 `TIMEOUT`；options 不含 `abortSignal`；模拟外层 `finally` 的 `cleanupCalls=0`；`collectDockerLogs()` 未进入且 `LOG_READ_TIMEOUT_MILLIS` 计时器未启动。T3R-12 因而 `ACCEPT`。v1.5 在调用 raw `logs()` 前创建独立 `LOG_REQUEST_TIMEOUT_MILLIS=5_000` 计时器与 AbortController，把 signal 传入并用显式 Promise race 保证即使请求忽略 abort 也会 settle reject；request 成功后才进入 v1.4 parser/stream timeout。以上只证明未来计划代码块的本地可执行性，不表示 Docker、容器、数据库或 Task 3 已运行。
