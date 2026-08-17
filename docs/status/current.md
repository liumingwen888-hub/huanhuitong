# 当前状态

基线日期：2026-07-20。状态更新时间：2026-08-17。

第 9/48 步为 `COMPLETED / EXTERNAL REVIEW PASS`（2026-08-17 用户复审 Task 5 v1.3 通过）；Task 5 详细计划为 `READY v1.3 / EXTERNAL REVIEW PASS`，T5R-01～T5R-08 全部 `ACCEPT / CLOSED`，Task 5 代码保持 `NOT_STARTED`，第 10/48 步保持 `NOT_STARTED`。第 8/48 步为 `COMPLETED / EXTERNAL REVIEW PASS`，Task 4 代码为 `IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`，未解决阻断 0。第 7/48 步为 `COMPLETED / EXTERNAL REVIEW PASS`；Task 4 技术计划保持 `READY v1.10 / EXTERNAL REVIEW PASS`，文档布局 `LAYOUT-S1 VERIFIED`，T4R-16～T4R-27 全部 `ACCEPT / CLOSED`。阶段 0 已由用户验收并整体 VERIFIED；阶段 1 总计划 READY v1.2.6、代码保持 BUILDING；Tasks 1–4 的代码和测试均为 VERIFIED。

E3-01 至 E3-04 全部保持。v1.2.4 TEMP 验证是历史计划可执行性证据；第 4 步真实项目证据为 clean build exit 0、6/6 文件 95/95 聚焦测试、typecheck exit 0、7/7 文件 96/96 unit、三个 package export 导入成功、18/18 权威代码块一致和 29 项安全范围检查通过。新依赖、lockfile 漂移、超范围工程文件和真实网络调用均为 0。

Task 2 验收历史证据不变。第 6 步外部复审结论为 PASS；T3R-13 ACCEPT、状态一致性修订复审通过并正式关闭；Task 3 未解决阻断 0。Task 3 v1.5 的工程写集合精确完成 19（Create 16、Modify 3、Delete 0），超范围工程文件和删除均为 0；项目源由 105 增至 121，增量正好是 16 个计划 Create。锁定 PostgreSQL/Flyway 镜像已按 linux/amd64 child digest 拉取并运行；V1 创建九张身份/可靠性业务表，Flyway history 与全部业务表 owner 均为 `xht_flyway`。platform/worker 的 pre-return `SET ROLE`、QueryCreator facade、粘滞关闭和失败 destroy-release 已实现。Flyway 12.11.0 实测证明 SQL afterConnect callback 不覆盖其全部 housekeeping 连接；实现因此在 JDBC URL 建连时强制 `role=xht_flyway`，同时保留 callback 二次验证，未给测试 LOGIN 增加任何直接 schema/table 权限。

第 6 步最终证据：`pnpm build` 与 `pnpm typecheck` exit 0；全量 unit 9 文件 132/132；两个新增 database unit spec 24/24；两个真实 database spec 65/65，并在最终工程状态连续运行通过；M01–M17、P01–P23 和 M15/M16 的 scenario 01–24 均可定位。空库 migrate、第二次 migrate、validate、checksum 漂移、九表/约束/索引/timestamptz/禁止列、权限正反矩阵、双阶段日志限制和唯一 owner 清理通过。最终 Task 3 PostgreSQL/Flyway/诊断容器与 Testcontainers network 残留均为 0。`pnpm test:all` 曾按实执行并在未来 Task 12 才创建的 `.dependency-cruiser.cjs` 缺失处失败，不属于 Task 3 阻断。本第 7 步未重新运行 build、typecheck、unit、database、Docker、PostgreSQL、Flyway 或 Testcontainers，统一为 NOT_RERUN。

Task 1 工程和供应链事实未改变：Node.js x64 `v24.18.0`、pnpm `11.15.1`；五 workspace 真实 build/main/types/exports 和 package-name smoke 已验证；lockfile SHA-256 仍为 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`。本轮没有修改 Task 1 源码、测试、manifest、依赖或 lockfile。

| 工作流 | 交付状态 |
|---|---|
| 阶段 0 整体 | VERIFIED（用户验收通过） |
| 阶段 1 总计划 | READY（v1.2.6） |
| 阶段 1 代码 | BUILDING |
| Task 1 工程骨架 | VERIFIED |
| Task 2 详细计划 | VERIFIED（v1.2.6，已实施并通过最终复审） |
| Task 2 代码与测试 | VERIFIED（v1.2.6 最终复审 PASS；R5-01 ACCEPT；新鲜复核通过） |
| Task 3 详细计划、代码与测试 | VERIFIED（v1.5，第 6 步最终复审 PASS；T3R-13 关闭） |
| Task 4 详细计划 | READY（v1.10 / EXTERNAL REVIEW PASS；LAYOUT-S1 VERIFIED） |
| Task 4 代码 | IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS（第 8/48 步 COMPLETED） |
| Task 5 详细计划 | READY v1.3 / EXTERNAL REVIEW PASS（2026-08-17；T5R-01～T5R-08 全部 ACCEPT / CLOSED） |
| Task 5 代码与 Tasks 6–14 | NOT_STARTED |
| 本地 Task 3 PostgreSQL/Flyway/Testcontainers 验证 | VERIFIED（第 6 步已执行，资源已清理；本轮 NOT_RERUN） |
| 共享/生产数据库、Telegram、collector、其他业务外部连接 | NOT_STARTED |
| 部署 | NOT_STARTED |

第 6/48 步临时授权保持已消费并归零。第 8 步 Task 4 的 Create 3、Modify 2 与本地隔离 Docker/PostgreSQL/Flyway/Testcontainers 授权已经消费并闭环。第 9/48 步 Task 5 v1.3 外部复审已于 2026-08-17 通过并关闭；Task 5 工程实现、第 10/48 步、Git 写入、worktree、代理、Telegram、其他业务外部服务、生产/共享数据库、生产部署、真实 Secret、依赖与锁文件修改授权均为 0。唯一当前动作是等待用户授权第 10/48 步 Task 5 实施（授权时须按 T5R-08 合同提供获批计划 ZIP 的路径/bytes/SHA-256 及复审报告 raw/normalized SHA-256）。

验证证据见 [verification.md](verification.md)；唯一下一步见 [next.md](next.md)。
