# 验证、停止与交付门禁

[返回索引](00-index.md)

## 实施期必跑命令

```powershell
pnpm exec vitest run --project unit apps/platform/test/unit/telegram-update-digest.spec.ts
pnpm exec vitest run --project database apps/platform/test/database/inbox-repository.integration.spec.ts
pnpm exec vitest run --project database apps/platform/test/database/inbox-repository.integration.spec.ts
pnpm test:unit
pnpm test:db
pnpm build
pnpm typecheck
pnpm test:all
```

前两类聚焦命令必须解析 actual Case ID 和 matched count；exit 0 单独不构成通过。`pnpm test:all` 的已知 `.dependency-cruiser.cjs` 缺失属于 Task 12 边界，必须按实际记录失败位置，不得以 `--passWithNoTests`、新建配置或跳过脚本伪造通过。

## GREEN 门禁

1. T5C01–T5C50 连续唯一，unit 24/24、database 26/26。
2. Task 5 database 完整命令连续两次 26/26。
3. 全量 unit 预期 156/156；全量 database 预期 229/229；实际基线不一致先停止裁决。
4. build/typecheck exit 0。
5. fixed HMAC vector、object key-order、unknown fields、array own-property 完整拒绝、root/nested Proxy trap 0、-0、undefined、清零、rotation/missing-key、并发、PostgreSQL 微秒 lease 与数据库内 `<=`、旧时间相等 CAS 0、独立 claimant/generation/inbox CAS、candidate accessor/Proxy 与 claim/mark Date 自有 accessor/method/Date subclass 零触达、普通 Date intrinsic 成功、完整错误 sentinel/allowlist、精确连接故障分类/destroy/normal-release/new-PID、same-UoW rollback 全部有直接断言。
6. canonical 七目标 7/7 BYTE-AND-HASH IDENTICAL；Create 6/Modify 1/Delete 0。
7. package.json、pnpm-lock.yaml、toolchain-lock.json 与实施输入 3/3 IDENTICAL。
8. UTF-8/BOM/fence/title/link/Secret/TEMP/资源门禁通过。

## 必停条件

- 实施输入相对已批准交付有未知漂移。
- 冻结七文件不足，出现 migration、第八工程文件、新依赖或配置需求。
- RED 来自 module/collection/type/fixture/env/empty match，或不是唯一预期断言。
- canonical/manifest 不能 7/7 还原，数组任一 own property 被静默忽略，canonical/command Proxy 在拒绝前触发任何 trap/getter，或 Date 自有 accessor/method、Date subclass 在拒绝前执行输入代码。
- digest 算法/格式/vector、key version、完整 Update 边界或清零不一致。
- conflict 会修改原 digest/version/status/processed/claim 证据。
- 并发产生两行、两个有效 lease、generation 倒退、调用方 receivedAt/processedAt 改变权限、claimed_until 通过 JavaScript Date 精确相等回传、重领 SQL 缺少数据库内 `<=`、或任一错误 claimant/generation/inboxId 成功。
- markProcessed 与业务效果不能在同一 Task 4 UoW，或 rollback 留部分效果。
- context/connection/commit UNKNOWN 被内部吞掉、自动重试或推断成功。
- 任何 raw Update、callback、canonical bytes、key material、digest 进入禁止信号。
- unit/database/build/typecheck 回归失败，锁漂移，Secret 或资源残留非 0。

对应裁决使用具体前缀，例如 `BLOCKED — TASK 5 FROZEN SCOPE CONFLICT`、`BLOCKED — TASK 5 FALSE RED`、`BLOCKED — TASK 5 CONCURRENCY CONTRACT FAILED`，并保留现场，不自行扩范围。

## 完成条件

只有所有 GREEN 门禁基于最终文件新鲜通过且文档同步后，Task 5 代码才能登记 `IMPLEMENTED / VERIFIED`。用户外部复审前不得登记 EXTERNAL REVIEW PASS。第 10/48 步完成后停止；Task 6/第 11 步不自动开始。

## 资源清理

- PostgreSQL/Flyway/Testcontainers 只在本地隔离 fixture 使用锁定镜像。
- fixture/database 的部分初始化与关闭采用当前 Task 3/4 owner 模式；database destroy 在 fixture stop 前。
- 检查 Task 5 owner label、Testcontainers 创建的 containers/networks 和系统 TEMP；all/running 残留均为 0。
- 禁止按模糊名称递归删除；只清理已验证在系统 TEMP 或本 Task owner 下的绝对路径/资源。

## 回滚

Git 未授权时，实施前必须在项目外以 Step 1 验证通过的同一个、用户明确批准且外部复审通过的最新完整 Task 5 计划 ZIP 为唯一恢复来源；不得使用 v16、v17 或其他历史包。报告记录七路径 pre/post hash。失败回滚只允许：删除本 Task 六个精确 Create、从该获批 ZIP 将 `packages/contracts/src/index.ts` 恢复为输入字节；执行前再次验证 ZIP 精确路径、字节数、SHA-256、配套报告原始/规范化 SHA-256、目标集合和原 hash。数据库测试使用 ephemeral container，停止/删除容器与 network 即回滚；不得对共享/生产数据库执行 down migration（本 Task 本来也没有 migration）。

## 文档同步清单

实施成功后至少同步：

- `docs/status/{current,next,active-work,progress-log,verification}.md`
- `docs/plans/active-plan-index.md` 与阶段 1 总计划摘要
- `docs/domains/{telegram-experience,platform-operations}.md`
- `docs/architecture/{integration-model,trust-boundaries}.md`
- `docs/security/{threat-model,security-gates}.md`
- `docs/testing/{strategy,acceptance-gates}.md`

只写真实命令和结果；计划中的 expected 不改写为已执行。

## 本第 9 步静态验证边界

当前只验证计划结构、链接、编码、矩阵、步骤和 Case ID；项目内 build、typecheck、unit、database、Docker、PostgreSQL、Flyway、Testcontainers 全部 `NOT_RERUN`。系统 TEMP 允许机械重构七个未来目标，并将 TypeScript 7.0.2 strict/noEmit、unit 24/24、database 26-title collection、candidate/Proxy 与 claim/mark Date accessor/method 直接探针、普通 Date intrinsic 成功探针和数据库时间静态合同明确记为 `TEMP PLAN EXECUTABILITY EVIDENCE`，不得冒充项目实施或 PostgreSQL GREEN。
