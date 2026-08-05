# 实施步骤 21–40

[返回索引](00-index.md) · [前序步骤](08-implementation-steps-01-20.md)

- [ ] **Step 21：运行首次认领并发组 T5C31–T5C33**

  过滤器 `T5C3[1-3]:`；matched 3、passed 3、failed 0、skipped 23。使用独立 UoW 并发 Promise，不用进程锁；精确证明结果多重集、单行、generation 和摘要不变。

- [ ] **Step 22：运行 RECEIVED/活动 lease/过期重领组 T5C34–T5C36**

  过滤器 `T5C3[4-6]:`；matched 3、passed 3、failed 0、skipped 23。receivedAt 只作元数据；活动 lease 不被远未来时间偷取。T5C36 必须由 PostgreSQL seed 一个可验证为非整毫秒（微秒余数 456）的过期 lease，重领成功、generation+1且 `INBOX_STATE_INVALID` 0。

- [ ] **Step 23：运行重领竞争与旧 claimant 组 T5C37–T5C38**

  过滤器 `T5C3[7-8]:`；matched 2、passed 2、failed 0、skipped 24。T5C37 从实际 query evidence 证明重领 SQL 含精确 `claimed_until <= database_time.value`、不含独立 `<` 或 `claimed_until = $...`，并发只产生一个新 generation；把 `<=` 改为 `<` 时该静态 SQL 合同断言必须失败，不再宣称跨事务运行时等值。T5C38 分别执行当前 generation+错误 claimant、当前 claimant+旧 generation、两者旧、错误 inboxId 四个 false 路径，每次断言 status/claimed_by/generation/claimed_until/processed_at 与业务效果完全不变。

- [ ] **Step 24：运行 markProcessed 状态组 T5C39–T5C42**

  过滤器 `T5C(39|4[0-2]):`；matched 4、passed 4、failed 0、skipped 22。T5C39 先证明伪造过去 processedAt 额外字段不能完成数据库已过期 lease，再证明完整当前 lease true；随后 status=PROCESSED、claimed_by/claimed_until=null，processed_at 必须位于独立数据库 before/after 时间窗口。重复完成和 processed replay 不修改原证据。

- [ ] **Step 25：运行同 UoW 业务效果/回滚组 T5C43–T5C45**

  过滤器 `T5C4[3-5]:`；matched 3、passed 3、failed 0、skipped 23。合成业务效果使用既有可清理表和 synthetic 值；成功共同 commit，callback throw 与 stale CAS error 共同 rollback，部分业务效果 0。

- [ ] **Step 26：运行查询/context/连接故障组 T5C46–T5C48**

  过滤器 `T5C4[6-8]:`；matched 3、passed 3、failed 0、skipped 23。T5C46 对 root command、digests、candidates、candidate、lease、Date Proxy，candidate index accessor，sparse/extra/symbol array，以及 claim receivedAt/mark claimedUntil 的自有 `getTime` accessor、method 与 Date subclass 逐项断言 getter/method/trap/context touches 0、authentic INBOX_COMMAND_INVALID；普通合法 Date 的直接探针仍成功解析。每个畸形输入进入 UoW 后得到 Task 4 安全包装且泄漏 0；closed context 精确 `TRANSACTION_CONTEXT_CLOSED`。T5C48 保留精确双失败 taxonomy，并对 externalMessageId、claimant/consumer、digest、raw Update、callback data、SQL/表名、SQL 参数、fixture 两条连接串、用户名及运行时解析 password 的完整 sentinel 矩阵命中 0；公开字符串全部属于固定 allowlist，failed PID 恰好一次 destroy release，后续不同 PID 完成认领并恰好一次 normal release。数据库 constraint/query failure 分类由 Task 4 已有回归拥有。

- [ ] **Step 27：运行 schema 与权限组 T5C49–T5C50**

  过滤器 `T5C(49|50):`；matched 2、passed 2、failed 0、skipped 24。确认唯一约束、check、禁止列、platform session/current role；worker Inbox 新 grant 数 0。

- [ ] **Step 28：运行完整 Task 5 database 文件**

  ```powershell
  pnpm exec vitest run --project database apps/platform/test/database/inbox-repository.integration.spec.ts
  ```

  1 file、26/26、T5C25–T5C50 unique、failed/skipped/only/retry 0。实际启动/停止 fixture 各一次，Flyway migrate/validate 成功，密码泄漏 0。

- [ ] **Step 29：重复完整 database 文件证明稳定性**

  与 Step 28 完全相同命令连续第二次；26/26，结果 ID/数量一致。两个独立运行之间容器、network、table 数据或 TEMP 交叉污染 0。

- [ ] **Step 30：运行全量 unit 回归**

  ```powershell
  pnpm test:unit
  ```

  预期现有 132 + Task 5 24 = 156/156，10 files；以实际输出为准记录 passed/failed/skipped/only/retry。若现有基线在实施前合法变化，先由用户批准更新期望，不静默吸收。

- [ ] **Step 31：运行全量 database 回归**

  ```powershell
  pnpm test:db
  ```

  预期现有 203 + Task 5 26 = 229/229，4 files；Task 3、Task 4 与 Task 5 均真实 PostgreSQL。任何现有回归失败均阻断 Task 5 完成。

- [ ] **Step 32：运行 build**

  ```powershell
  pnpm build
  ```

  五 workspace 全部 exit 0；新 contracts export 与 platform ESM `.js` import 可解析；不得以 TEMP compiler 替代。

- [ ] **Step 33：运行 typecheck**

  ```powershell
  pnpm typecheck
  ```

  exit 0；strict、exactOptionalPropertyTypes、noUncheckedIndexedAccess 等当前 tsconfig 门禁保持。无 `@ts-ignore`、未消费 `@ts-expect-error` 或扩大类型断言。

- [ ] **Step 34：登记 test:all 的现有 Task 12 边界**

  运行 `pnpm test:all` 并完整记录。若仍在 `architecture:check` 因未来 Task 12 的 `.dependency-cruiser.cjs` 缺失停止，必须写 `EXECUTED_FAILED_KNOWN_TASK12_GAP`，不把后续未运行项写 PASS，也不在 Task 5 新建该文件；Task 5 自身以 Steps 28–33 的新鲜命令判定。若失败位置改变，按真实新失败阻断并调试。

- [ ] **Step 35：canonical 七文件最终一致性**

  依 manifest 重新计算项目目标与 fragments：7/7 BYTE-AND-HASH IDENTICAL。RED delta、额外 import、格式化漂移、测试标题或断言差异均为 0；工程范围仍 Create 6/Modify 1/Delete 0。

- [ ] **Step 36：安全与静态扫描**

  扫描七目标及全项目：raw Update/body/text/callback/canonical/key material/digest 日志路径 0；强特征 Secret 0；真实凭证 0；Task 5 生产代码 logger/trace/outbox/audit/network import 0；三锁 3/3 IDENTICAL。

- [ ] **Step 37：资源清理门禁**

  确认 Task 5 owner 与 Testcontainers 相关 running/all containers、networks、volumes、TEMP test roots、logs、coverage、dist 增量残留均为 0。只清理由本 Task 精确拥有并验证绝对路径/owner 的资源，不递归删除不确定目录。

- [ ] **Step 38：文档同步**

  按实际结果同步 current、next、active-work、progress-log、verification、active-plan-index、阶段总计划、Telegram/operations/integration/trust/security/testing 文档。保留 v1.0→v1.1、v1.1 外审未通过并由 v1.2 candidate 取代、v1.2 外审未通过并由 v1.3 candidate 取代的历史；未运行项明确 NOT_RERUN/NOT_RUN。

- [ ] **Step 39：最终完成/停止裁决**

  READY_FOR_EXTERNAL_REVIEW 要求：七文件范围精确、T5C01–50、unit/database/build/typecheck、双 database、canonical、三锁、安全、链接与资源全部通过，Task 5 代码 `IMPLEMENTED / VERIFIED`，第 10/48 步 `COMPLETED` 但不进入第 11 步。任一 stop condition 命中即 BLOCKED，禁止打包成完成。

- [ ] **Step 40：生成新交付并停止**

  生成不覆盖旧文件的完整项目 ZIP 与验证 TXT，排除 node_modules/dist/coverage/.git/TEMP/cache/log/Secret/旧交付物；验证解压、文件 manifest、字节数、SHA-256 与报告规范化自校验。Git/Telegram/外部业务/生产部署执行数 0。停止等待用户外部复审，不进入第 11/48 步。
