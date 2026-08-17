# Task 14 文档、索引、状态与最终验证同步 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。Task 14 代码状态：`NOT_STARTED`。

当前为第 27/48 步 `IN_PROGRESS`。第 26/48 步与 Task 13 实施结果均为 `COMPLETED / IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`；第 28/48 步 `NOT_STARTED`。

## 权威需求来源

- [阶段 1 总计划 Task 14 节](../2026-07-20-stage-1-foundation-identity-implementation-plan.md)（目标、Files 清单 27 Modify + 2 Create、Step 1–N、check-docs 参考实现）。
- 前置：Tasks 1–13 全部 VERIFIED、23 项验收全 PASS、`pnpm test:all` 全链通过（database 仅 M14 平台边界与 M06/M16 负载抖动，均如实登记）。

## 目标

1. 实现事实同步到全部权威文档（架构四文件、领域三文件、观测、威胁模型、安全门禁、测试策略与验收门禁、来源登记、状态五文件、活动计划索引、路线图、总计划头部、AGENTS、根索引）。
2. `scripts/check-docs.mjs`（真实链接检查 + 工作区逃逸拦截）+ `package.json` docs:check 脚本。
3. `packages/testing/test/documentation/stage-one-documentation.spec.ts` 文档契约测试（含总计划 Step 1 原文断言：current 含"阶段 1 代码 | READY"与"当前生产部署授权：0"、next 含"用户验收阶段 1 实现"且不含"自动获得部署授权"）。
4. **阶段 1 代码收敛为 `READY`（等待用户验收），不自动 VERIFIED、不获得任何部署授权**。

## 冻结未来工程矩阵

Create 2（scripts/check-docs.mjs、documentation spec）；Modify 27（按总计划清单，含 package.json）。删除 0。

## 实施裁决（v1.0）

1. 本会话期间各 Task 的 status/verification/progress-log 已滚动同步——Task 14 聚焦**未同步的架构/领域/安全/测试权威文档与总计划头部**，状态文件仅做终态收敛（阶段 1 代码 BUILDING→READY 等待用户验收）。
2. 环境事实如实写入：macOS/arm64 + 官方 Node 24.18.0-darwin-arm64（TEMP）、Docker amd64 模拟、方案 A 类型包 devDeps 锁漂移（`59D72A2A…3C73B`）、M14 平台边界、M06/M16 负载抖动隔离 PASS。
3. check-docs 按总计划参考实现（链接存在性 + root 逃逸 + 相对路径解码）；文档 spec 纳入 unit 项目 documentation glob（已存在）。
4. 停止条件：发现任何文档需陈述无证据的事实、或需要修改业务实现/迁移/锁——停止。

## 实施步骤（第 28/48 步获授权后）

- [ ] Step 1：基线核对 + documentation spec 红灯。
- [ ] Step 2：check-docs.mjs + package.json docs:check。
- [ ] Step 3：27 份权威文档按各自唯一职责同步实现事实。
- [ ] Step 4：docs:check 零断链零逃逸；documentation spec 绿灯。
- [ ] Step 5：test:all 全链复跑确认。
- [ ] Step 6：交付报告；等待用户验收阶段 1 实现（READY→VERIFIED 由用户裁决）。
