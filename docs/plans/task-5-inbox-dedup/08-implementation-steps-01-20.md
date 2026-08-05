# 实施步骤 01–20

[返回索引](00-index.md) · [后续步骤](09-implementation-steps-21-40.md)

以下 checkbox 是未来第 10/48 步施工跟踪，当前全部未执行。每步只在命令、输入、实际输出、exit 和 Case ID 数量有证据后勾选。

- [ ] **Step 1：锁定实施输入与工作区基线**

  读取第 10/48 步实施授权中由用户明确重复提供的、已经外部复审通过的最新完整 Task 5 计划 ZIP；授权必须同时给出精确 ZIP 路径、字节数、SHA-256，以及配套报告的原始与规范化 SHA-256。若本 v1.3 候选最终以 v18 交付并获批，则路径必须精确为 `C:\Users\Administrator\Desktop\Codex\换汇通-第9步-Task5计划-v1.3三次外部复审聚焦修订包-2026-08-01-v18.zip`，但不得从当前计划自行推定其获批状态或哈希。先验证全部五项，再从该 ZIP 读取 168 文件 manifest，把当前完整项目逐文件对照获批 ZIP；同时确认 6 个 Create 不存在、`packages/contracts/src/index.ts` 与获批 ZIP 输入哈希一致、三锁 3/3 一致、全部 Markdown 无漂移。不得以 v16、v17 或其他历史包作为实施基线或恢复来源。任一缺项或偏差即 `BLOCKED — TASK 5 IMPLEMENTATION BASELINE DRIFT`，不得恢复或吸收。

- [ ] **Step 2：登记 BUILDING 与精确写范围**

  只把第 10/48 步记为 IN_PROGRESS、Task 5 代码记为 BUILDING；在 active-work 登记 Create 6/Modify 1/Delete 0、数据库/容器临时授权和禁止 Git/外部服务。状态更新不先写 READY/VERIFIED。

- [ ] **Step 3：验证 canonical fragment manifest**

  按 [fragment index](fragments/00-index.md) 在系统 TEMP 重构七个目标；核对每个 BEGIN/END target/sequence 唯一、路径集合精确、UTF-8/BOM、字节数和 SHA-256。TEMP 仅是施工输入验证，不能记为项目 build/test。

- [ ] **Step 4：机械写入七个目标并核对范围**

  从唯一 canonical fragments 写入 6 Create 与 1 Modify，不手抄、不格式化其他文件。写后立即证明 Create 6、Modify 1、Delete 0、outside engineering 0；三锁仍 3/3 IDENTICAL。

- [ ] **Step 5：先证明测试可收集且不是假 RED**

  运行两个 spec 的 Vitest `list` 和 TypeScript `--noEmit` 收集门禁；必须解析 T5C01–T5C50 唯一连续、unit 24、database 26、module/fixture/config/type error 0。此步不把 canonical GREEN 当成实施结果。

- [ ] **Step 6：施加 unit 单点功能 RED delta**

  对 canonical `telegram-update-digest.ts` 的固定向量输出路径施加 manifest 指定的单字符 digest delta，精确替换命中 1；其他六文件 hash 不变。delta 文件 hash 必须不同于 canonical。

- [ ] **Step 7：连续两次运行 T5C01 RED**

  ```powershell
  node node_modules/vitest/vitest.mjs run apps/platform/test/unit/telegram-update-digest.spec.ts --config vitest.config.ts --root . --project unit -t 'T5C01:' --reporter verbose
  ```

  两次都必须 matched 1、failed 1、skipped 23、唯一 ID T5C01、唯一原因为固定摘要 expected/actual 不同；exit 必须非 0。Cannot find module、collection、TypeScript、环境或空匹配均判错误 RED。

- [ ] **Step 8：恢复 digest canonical 并核对 SHA-256**

  只从 fragment 重写 `telegram-update-digest.ts`；字节数/SHA-256 与 manifest 相同，替换 delta 残留 0，其他目标 hash 不变。

- [ ] **Step 9：运行 T5C01 GREEN 与 fixed vector 证据**

  使用 Step 7 同命令；必须 matched 1、1/1 PASS、skipped 23、exit 0，实际 digest 精确为 `_ok7DE_TalvbxgzGFS2aBYH0tIc4dWOhViegvxH8Ekg`，empty/unexpected 0。

- [ ] **Step 10：运行 canonical JSON 基础组 T5C02–T5C07**

  过滤器 `T5C0[2-7]:`；matched 6、passed 6、failed 0、skipped 18。直接覆盖 key sort、array、string、Unicode、number/-0、null/boolean。

- [ ] **Step 11：运行拒绝组 T5C08–T5C17**

  过滤器 `T5C(0[8-9]|1[0-7]):`；matched 10、passed 10、failed 0、skipped 14。T5C10/T5C16 必须证明 getter 调用次数 0；T5C10 还直接覆盖命名属性、越界数字属性和 `4294967295`，增强数组不得得到有效 digest；T5C14 对 root、嵌套 object、嵌套 array Proxy 各断言 `UNSUPPORTED_VALUE`、trap 0、有效 digest 0与公开泄漏 0。

- [ ] **Step 12：运行 keyring/清零/泄漏组 T5C18–T5C24**

  过滤器 `T5C(1[8-9]|2[0-4]):`；matched 7、passed 7、failed 0、skipped 17。每个 current/retained `withMaterial` 恰好一次；borrowed/chunk/final Buffer 清零，公开递归泄漏命中 0。

- [ ] **Step 13：运行完整 Task 5 unit 文件**

  ```powershell
  pnpm exec vitest run --project unit apps/platform/test/unit/telegram-update-digest.spec.ts
  ```

  1 file、24/24、failed/skipped/only/retry 0。实际 ID 集合与 T5C01–T5C24 精确一致。

- [ ] **Step 14：施加 repository 单点功能 RED delta**

  在 canonical `inbox.repository.ts` 新 insert 的返回对象中只把 `reclaimed: false` 临时替换为 `reclaimed: true`，以 manifest 的三行上下文保证精确命中 1；SQL insert、result union、模块/fixture/类型保持有效。

- [ ] **Step 15：启动一次真实 fixture 并验证 RED 环境基线**

  T5C25 运行前由 spec 使用锁定镜像启动 PostgreSQL、执行 `migrateAndValidate`、建立 platform role Kysely/Task 4 UoW；必须证明九表、唯一约束和 role 可用。fixture/environment 失败不计为 RED。

- [ ] **Step 16：连续两次运行 T5C25 RED**

  ```powershell
  node node_modules/vitest/vitest.mjs run apps/platform/test/database/inbox-repository.integration.spec.ts --config vitest.config.ts --root . --project database -t 'T5C25:' --reporter verbose
  ```

  两次都必须 matched 1、failed 1、skipped 25、唯一 ID T5C25、唯一差异为 reclaimed expected false/actual true；数据库 insert 已发生，environment/collection/type/fixture error 0。每次 fixture 均清理。

- [ ] **Step 17：恢复 repository canonical 并核对 SHA-256**

  只从 fragment 重写 `inbox.repository.ts`；manifest hash 恢复，RED delta 命中 0，其他六目标不变。

- [ ] **Step 18：运行 T5C25 GREEN**

  使用 Step 16 命令；matched 1、1/1 PASS、skipped 25、exit 0。数据库行必须 current version/digest、CLAIMED、generation 1、claimant/expiry 有值、禁止字段不存在。

- [ ] **Step 19：运行基本 duplicate/conflict/key rotation 组 T5C26–T5C30**

  过滤器 `T5C(2[6-9]|30):`；matched 5、passed 5、failed 0、skipped 21。每个 case 查询原行 before/after；conflict 和 missing-key 写 0。

- [ ] **Step 20：重构检查点一**

  只消除重复 helper，不改变公开联合、SQL lock/CAS 或 canonical rules；运行 T5C01–T5C30 精确 union。再次核对无 root Kysely/pool/client/logger/telemetry/outbox/audit import，无第二 connection，无摘要普通等号比较。
