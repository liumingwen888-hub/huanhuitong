# 当前工作

## 2026-08-17 第 10/48 步 Task 5 复审通过与 VERIFIED 收敛

- 用户裁决：Task 5 实施结果 EXTERNAL REVIEW PASS；fragment 07 修订 ACCEPT。
- Task 5 代码转 `IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`，第 10/48 步 `COMPLETED / EXTERNAL REVIEW PASS`；Tasks 1–5 全部 VERIFIED，未解决阻断 0。
- 本轮同步状态 Markdown 并提交推送；工程变更仅第 10 步已申报的七个目标与 fragment 07 修订，三锁无漂移。
- 唯一下一步：第 11/48 步 Task 6“Outbox、持久任务与安全 Worker”详细计划 DESIGNING。

## 2026-08-17 第 10/48 步 Task 5 实施完成

- 授权与基线：用户授权第 10/48 步，按 T5R-08 以当前仓库 `82e6380` 生成基线 ZIP（680924 bytes，SHA-256 `2401E364…B6B5`）。
- 实施：Node 24.18.0（TEMP darwin-arm64）、frozen/ignore-scripts install、七目标机械写入 7/7 IDENTICAL（Create 6、Modify 1、Delete 0）、build/typecheck exit 0、unit 156/156、database T5C25–T5C50 26/26 PASS。
- 已执行并如实保留的失败：首轮真实 database 中 Task 5 spec 26/26 RED（platform 角色无 audit_events DELETE 权限，系计划缺陷）；M14 Windows 前置断言在 macOS 失败（平台边界，非缺陷）。
- 最小修复：fragment 07 改用 bootstrap 清理连接；修复后 26/26 GREEN；fragment 07/manifest 更新为 38927 bytes / `CEBAC9F6…0630`，待用户复审确认。
- 当前状态：第 10/48 步 COMPLETED；Task 5 代码 IMPLEMENTED、等待用户外部复审；Tasks 6–14 与第 11/48 步 NOT_STARTED；Git 提交、外部业务服务、依赖/锁修改授权为 0。


## 2026-08-17 第 9/48 步 Task 5 v1.3 外部复审通过

- 用户基于整理的复审包（T5R-03 Date 伪造防御三层方案、T5R-08 实施基线动态对照合同）接受建议，裁决 T5R-03、T5R-08 均 `ACCEPT / CLOSED`。
- Task 5 v1.3 外部复审登记 `APPROVED`；T5R-01～T5R-08 全部 `ACCEPT / CLOSED`；第 9/48 步转 `COMPLETED / EXTERNAL REVIEW PASS`；Task 5 计划转 `READY v1.3 / EXTERNAL REVIEW PASS`；Task 5 代码与第 10/48 步保持 `NOT_STARTED`。
- 本轮只同步权威状态 Markdown（current、next、active-work、progress-log、Task 5 计划 00-index 与 01-scope）；工程代码、测试、依赖、锁文件、Docker、数据库、外部服务和部署变化均为 0。
- 唯一下一步：等待用户授权第 10/48 步实施；授权须按 T5R-08 提供获批 ZIP 路径/bytes/SHA-256 与复审报告 raw/normalized SHA-256。

## 2026-08-05 中文 AI 第一接手提示词

- 用户批准方案 A 及书面规格，并将根入口文件名最终确定为 `AI接手提示词.md`。
- 本轮只增强跨设备/跨 AI 的上下文恢复入口：创建根提示词、设计规格和实施计划，并同步 README、Copilot 指令、总索引、完整交接协议、进展与验证记录。
- 提示词不硬编码第 9/48 步等易变事实；它从 `docs/status/current.md`、`docs/status/next.md` 和活动计划读取实时状态。
- Task 5 计划和代码状态不变：第 9/48 步继续 `WAITING_EXTERNAL_REVIEW`，Task 5 v1.3 继续等待复审，Task 5 代码和第 10/48 步继续 `NOT_STARTED`。
- 工程代码、测试、SQL、依赖、锁文件、Docker、数据库、外部服务和部署变化均为 0。
- 发布前源项目与独立上传目录均为 173 files / 114 Markdown / 59 non-Markdown，达到 173/173 byte-and-hash identical；提示词合同缺失 0，旧英文计划名文件与引用 0。
- 中文根提示词实施提交 `30f60a5beda6e5b98b8ff544819b6ce7bafa3e8b` 已推送私有 GitHub `main`；远端回读确认 `AI接手提示词.md` 存在、173 文件树一致、内容合同字段 6/6 命中。

## 2026-08-05 私有 GitHub 首发与 AI 开发交接

- 用户明确授权把完整当前项目发布到私有 GitHub 仓库 `liumingwen888-hub/huanhuitong`，并指定独立上传目录 `C:\Users\Administrator\Desktop\Codex\huanhuitong`；公开仓库授权为 0。
- 第 9/48 步、Task 5 v1.3 `READY / WAITING_EXTERNAL_REVIEW`、Task 5 代码与第 10/48 步 `NOT_STARTED` 的断点保持不变；本轮没有实施 Task 5 或进入第 10 步。
- 已新增 `.gitignore` 与 `.github/copilot-instructions.md`，重写 README 和 AI 交接入口，并只修正 product scope、runtime topology、threat model 中三个与当前权威状态冲突的摘要；历史记录、工程代码、测试、依赖、migration 和三锁未因本轮文档任务改变。
- 发布前项目为 170 files / 111 Markdown / 59 non-Markdown；UTF-8、BOM、Markdown fence、584 个围栏外相对链接、断链、越界、强特征 Secret、TEMP 和 Task 5 未来工程目标检查均通过。
- Node `v24.18.0`、pnpm `11.15.1`；离线 frozen/ignore-scripts 安装 exit 0、下载 0、lifecycle 0；在同一 ignore-scripts 进程配置下 build、typecheck exit 0，unit 为 9/9 files、132/132 tests PASS。
- Docker、PostgreSQL、Flyway、Testcontainers、Telegram、其他业务外部服务和生产部署均 NOT_RERUN / 0；项目当前唯一业务下一步仍为等待用户外部复审 Task 5 v1.3。
- 独立上传目录已建立并与权威源达到 170/170 byte-and-hash identical；PRIVATE GitHub 仓库已通过官方 Git Credential Manager 推送。发布载荷根提交为 `95f8ed666f86b8209a2c17d2f2d1d1a5a98dd5ba`；认证后重新 fetch 证明 `main == origin/main`、两侧树均 170 文件、diff 0，GitHub 页面回读 `Private`、`main` 和 README 成功。
- GitHub App 连接器尚未安装到这个新私有仓库，因此 connector 文件回读返回 404；这不影响 Git HTTPS push/fetch 或浏览器访问。未来需要由连接器读写时，应先在 GitHub App 安装范围中加入该私有仓库。

## 第 9/48 步 Task 5 v1.3 第三次外部复审聚焦修订

- v17 ZIP/TXT/规范化 SHA-256 与授权值一致；启动项目与 v17 为 `168/168 BYTE-IDENTICAL`，项目 168 files / 110 Markdown / 58 non-Markdown，三锁 3/3 IDENTICAL。
- 外部复审裁决：Task 5 v1.2 `NOT APPROVED / REVISION REQUIRED`；T5R-01/02/04/05/06/07 ACCEPT / CLOSED；T5R-03 REOPENED；T5R-08 OPEN。第 9 步恢复 IN_PROGRESS，计划进入 DESIGNING v1.3，代码与第 10 步保持 NOT_STARTED。
- 独立复现：claim/mark 的 Date 自有 `getTime` accessor 各执行 getter 1 次并触达 context 1；自有 method 各执行 method 1 次并触达 context 1，最终均为普通 `CONTEXT_TOUCHED` Error、authentic=false。活动 Step 1 仍要求对照 v16，而 v17 相对 v16 已有 33 个合法 Markdown 修改。
- 当前授权仅覆盖既有 Markdown、canonical fragments 和直接冲突文档；PostgreSQL、Docker、Flyway、Testcontainers、Task 5 工程与第 10/48 步授权为 0。
- 已修订：Date 只接受精确 `Date.prototype`、own key 0并通过 intrinsic 读取；claim/mark 自有 accessor/method、Date subclass 与 Proxy 全部零调用/零触达 authentic reject。Step 1 与回滚只接受用户第 10 步授权中明确提供且外审通过的最新完整计划 ZIP，不使用历史 v16/v17。
- TEMP PLAN EXECUTABILITY EVIDENCE：离线 frozen/ignore-scripts install 386 reused/downloaded 0；TypeScript 7.0.2；五 workspace build 与七 target strict/noEmit exit 0；future unit 24/24；database list 26 个唯一标题；直接探针全部通过。PostgreSQL/Docker 未运行。
- Task 5 计划转 `READY v1.3 / WAITING_EXTERNAL_REVIEW`；T5R-03/08 只登记 `RESOLVED_IN_PLAN`，不是 ACCEPT/CLOSED。唯一下一步等待用户复审，不实施 Task 5、不进入第 10/48 步。

## 第 9/48 步 Task 5 v1.2 第二次外部复审修订完成

- v16 ZIP/TXT/规范化 SHA-256 与授权值一致；当前项目与 v16 为 `168/168 BYTE-IDENTICAL`，项目为 168 files / 110 Markdown / 58 non-Markdown，三锁 3/3 IDENTICAL。
- 外部复审裁决：Task 5 v1.1 `NOT APPROVED / REVISION REQUIRED`；T5R-01/04/06 ACCEPT / CLOSED；T5R-02/03/05 REOPENED；T5R-07 OPEN。第 9 步恢复 IN_PROGRESS，计划进入 DESIGNING v1.2，代码与第 10 步保持 NOT_STARTED。
- 独立复现：PostgreSQL 文本 `.123456` 经 JavaScript Date 往返为 `.123000`；数组 `.map()` 读取 accessor 使 getter 调用 1；Proxy 的 prototype/descriptor 观察使 trap 调用 1/2，而 `node:util.types.isProxy` 在观察前识别且 trap 0。T5C48 当前公开扫描仅排除单个 externalMessageId。
- 已完成：数据库时间精确相等往返 CAS 与应用 expiry decision 路径 0；重领使用数据库内 `<=` 和同一时间源；命令解析与 canonicalizer 均在观察前拒绝 Proxy；T5C48 扩充完整 runtime sentinel/allowlist。Step 1～40、T5C01～T5C50 和 Create 6/Modify 1/Delete 0 保持。
- TEMP 最终证据：TypeScript 7.0.2、build exit 0、七 target strict/noEmit exit 0、future unit 24/24、database 26 个唯一标题；canonical Proxy trap 0/有效 digest 0，candidate accessor/Proxy getter-trap-context 0且 authentic error。PostgreSQL/Docker 未运行。
- Task 5 计划转 `READY v1.2 / WAITING_EXTERNAL_REVIEW`；T5R-02/03/05/07 只登记 `RESOLVED_IN_PLAN`，不是 ACCEPT/CLOSED。唯一下一步等待用户复审，不实施 Task 5、不进入第 10/48 步。

基线日期：2026-07-20。状态更新时间：2026-08-05。当前总进度：第 9/48 步 WAITING_EXTERNAL_REVIEW。阶段 0：VERIFIED。阶段 1 总计划：READY v1.2.6。阶段 1 代码：BUILDING。Tasks 1–4：VERIFIED。第 8/48 步：COMPLETED / EXTERNAL REVIEW PASS；Task 4 代码：IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS；未解决阻断：0。Task 5 v1.2 外部复审：NOT APPROVED / REPLACED BY v1.3 CANDIDATE；T5R-01/02/04/05/06/07：ACCEPT / CLOSED；T5R-03/08：RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW；Task 5 独立详细计划：READY v1.3 / WAITING_EXTERNAL_REVIEW；Task 5 代码与 Tasks 6–14：NOT_STARTED；第 10/48 步：NOT_STARTED。

## 第 9/48 步 Task 5 v1.1 六项外部复审修订

- v15 ZIP 624162 bytes / `A8B38A7F73195B707177BC96ADE192A70081EB913E88B45D1C26F5482CEAC94B`，报告 9442 bytes / raw `99DF64B09C6CA71C75F7AA1BF66261CDDB7B79ED103EF5EB6F9C0C98AC638386` / normalized `03A60771036A715E43FD6CA126962E6933D7F30FE5E37C139DE5BBDFBB7AA759`；项目启动时 168/168 字节一致，三锁 3/3 IDENTICAL。
- 用户裁决 Task 5 v1.0 `NOT APPROVED / REVISION REQUIRED`；T5R-01～T5R-06 先登记 OPEN，第 9 步恢复 IN_PROGRESS，计划进入 DESIGNING v1.1。代码、测试、SQL、migration、依赖、锁文件和第 10 步授权均为 0。
- v1.0 直接复现：数组 own property `4294967295` 与空数组产生相同有效 HMAC；`consumer=null` 抛普通 TypeError 且 SQL 触达 0。静态裁决还确认应用时间控制 lease、T5C38 合并 CAS 条件、T5C46/48 证据不足及阶段计划旧接口漂移。
- 本轮只修改现有 Markdown；未来工程矩阵保持 Create 6、Modify 1、Delete 0，Step 1～40 与 T5C01～T5C50 数量保持。
- v1.1 已改为 array own-property 完整拒绝、PostgreSQL 权威时钟、unknown 运行时命令解析、四个独立 CAS false 路径、Task 4 精确故障/销毁释放/new-PID 证据，并清除阶段计划 Task 5/9/10 活动接口漂移。
- 系统 TEMP 机械重构七个 future targets：TypeScript 7.0.2 strict/noEmit exit 0，unit 24/24 PASS，database canonical 收集 26 个唯一标题；T5R-01 最终探针 valid collision=false，T5R-03 为 authentic INBOX_COMMAND_INVALID 且 context 触达 0。PostgreSQL/Docker 未运行。
- Task 5 v1.1 已转 `READY / WAITING_EXTERNAL_REVIEW`；六项只标记 `RESOLVED_IN_PLAN`，不是 ACCEPT/CLOSED。唯一下一步等待用户外部复审，不实施 Task 5、不进入第 10/48 步。

## 第 9/48 步 Task 4 最终验收与 Task 5 v1.0 规划

- 用户确认 Task 4 实施结果外部复审 PASS；第 8/48 步转为 `COMPLETED / EXTERNAL REVIEW PASS`，Task 4 代码转为 `IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`，阻断项 0。
- v14 ZIP/TXT/规范化 SHA-256 与授权值一致，启动项目为 `149 files = 91 Markdown + 58 non-Markdown`，与 v14 `149/149 BYTE-IDENTICAL`，哈希差异、缺失与新增均为 0；三锁 3/3 IDENTICAL。
- 第 9/48 步进入 IN_PROGRESS；Task 5 独立详细计划进入 DESIGNING。冻结未来工程范围 Create 6、Modify 1、Delete 0；本轮只允许 Markdown 规划与索引同步，Task 5 工程修改必须为 0。
- 真实接口核对基于 Task 2 `InboxDigestKeyring.withMaterial`、Task 3 `inbox_messages` 状态/唯一约束、Task 4 `TransactionContext`/`UnitOfWork` 与当前 Testcontainers fixture；不得复制阶段总计划旧片段冒充最终方案。
- 本轮 build、typecheck、unit、database、Docker、PostgreSQL、Flyway、Testcontainers 均 NOT_RERUN；Git、worktree、代理、Telegram、其他业务外部连接和部署执行数均为 0。
- Task 5 v1.0 已形成 [唯一计划入口](../plans/task-5-inbox-dedup/00-index.md)：19 份拆分 Markdown、Step 1～40、T5C01～T5C50、七个 canonical fragments，未来工程矩阵保持 Create 6/Modify 1/Delete 0。
- 系统 TEMP 只执行计划可执行性检查：七文件 TypeScript 7.0.2 strict/noEmit exit 0，未来 unit 24/24；database 仅 strict compile，未连接数据库，所有 TEMP 已清理。该证据不冒充 Task 5 实施。
- 计划静态门禁通过后，第 9/48 步转为 WAITING_EXTERNAL_REVIEW，Task 5 计划转为 READY v1.0 / WAITING_EXTERNAL_REVIEW；Task 5 代码和第 10/48 步保持 NOT_STARTED，唯一下一步为等待用户复审。

## 第 8/48 步 Task 4 v1.10 正式实施

- v13 输入 ZIP/TXT 已匹配指定字节数与 SHA-256；实施前项目为 `146 files = 91 Markdown + 55 non-Markdown`，与 v13 `146/146` 字节一致，哈希变化、缺失与新增均为 0。
- 授权工程范围精确完成 Create 3、Modify 2、Delete 0、outside engineering 0；最终项目为 `149 files = 91 Markdown + 58 non-Markdown`，五个目标均由 canonical fragments 机械重构并达到 5/5 BYTE-AND-HASH IDENTICAL。
- T4R-27 v1.8 TEMP 精确 RED 保持；冻结 `^LEX01:` 的 EMPTY MATCH 经用户裁决后只修正运行时过滤器为 `LEX01:`，实际 1/1 PASS、137 skipped、empty 0、unexpected 0。Step 4～51 全部过滤器均按实际 Case ID 与声明数量通过。
- 真实 GREEN：LEX01～23 为 23/23，SQLPOL01～57 为 57/57，SQLPOL51～57 真实项目专项 7/7，Task 4 integration 138/138 且标题唯一；database unit 12/12、完整 unit 132/132、完整 database 203/203、build/typecheck exit 0。
- Docker 29.6.2、PostgreSQL 18.4、Flyway 12.11.0 与 Testcontainers 12.0.4 均由本地隔离真实验证覆盖；最终 Testcontainers 容器、运行容器和网络残留均为 0。Step 62 为 5/5 IDENTICAL；Step 63 TypeScript 7.0.2 strict/noEmit exit 0，TEMP 已删除。
- 第 8/48 步 COMPLETED；Task 4 代码 IMPLEMENTED / VERIFIED。Git、worktree、代理、外部业务服务、生产/共享数据库、生产部署、依赖/锁修改和第 9 步执行均为 0；唯一下一步是等待用户进行 Task 4 实施结果外部复审。

## 第 7/48 步 Task 4 v1.10 第十次外部复审修订

- 启动时当前项目相对 v12 出现 5 个修改与 8 个新增偏差；先将 13 个当前版本按完整相对路径、状态、字节数和 SHA-256 隔离到项目外 ZIP 并验证，再只从哈希正确的 v12 TEMP 副本覆盖 5 个路径、删除 8 个精确新增路径。v1.10 正式修订开始前已恢复 `146/146 BYTE-IDENTICAL TO V12`。
- T4R-25 将实施前基线从过期 `122/67/55` 改为当前 `146/91/55`；未来 Create 3/Modify 2/Delete 0 后精确为 `149/91/58`。历史 `122/67/55` 仅保留在 migration manifest。
- T4R-26 修复 Step 8～14 的 7 处声明/命令错位，并对 Step 8～26 全部 19 个过滤器显式锚定；机械 validator 要求 19/19、LEX union 23/23、duplicate 0、empty 0。
- T4R-27 从当前 canonical 五文件自包含重建 v1.8：两处反向替换命中各 1，`unit-of-work.ts` 精确为 `24624 bytes / 878 lines / 4BE97A751BD02700C37E307AB57F53770261C95A09B152DAA6566DBD0E73ABEC`。直接 scan probe 为 `{ kind: "ok" }`；SQLPOL51 连续两次各 1 failed/137 skipped，唯一失败为 expected delegate 0 / actual 1；批量为 SQLPOL51～55 failed、SQLPOL56～57 passed、其他错误 0。恢复 canonical 后 7/7 GREEN。
- 五个最终 canonical 目标正文保持不变并为 5/5 IDENTICAL；Task 4 三个 Create 路径仍不存在。
- T4R-16～T4R-27 均为 `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，不是外部 ACCEPT。Task 4 技术计划 READY v1.10、布局 LAYOUT-S1 VERIFIED、代码 NOT_STARTED；唯一下一步是等待用户重新外部复审，不得实施 Task 4 或进入第 8/48 步。

## 第 7/48 步 Task 4 v1.9 / LAYOUT-S1 文档结构拆分

- 输入 v11 ZIP、TXT 与报告规范化 SHA-256 已按已知值验证；项目根目录与 122 文件 v11 基线逐文件一致后才开始拆分。
- 原 383793 bytes / 10629 lines 巨型计划保留为兼容入口；新增 `docs/plans/task-4-unit-of-work/` 权威索引、职责文件、canonical fragments 与 migration manifest。
- 技术内容保持 v1.9：63/63 步顺序与未勾选状态、SQLPOL 57/57、LEX 23/23、future integration 138、T4R-16～T4R-24 9/9；五个未来工程文件从 frozen v11 到 canonical reconstruction 为 5/5 IDENTICAL。
- 新建 Markdown 24、修改工程文件 0、删除 0；普通计划目标值与 100000 bytes/2500 lines 硬上限已写入文档治理合同。
- 本轮只做文档结构与治理更新；项目 build/typecheck/unit/database、真实完整 138/138、Docker、PostgreSQL、Flyway 与 Testcontainers 均 `NOT_RERUN`。
- Task 4 技术计划 READY v1.9、布局 LAYOUT-S1 VERIFIED、外部复审 NOT_APPROVED / WAITING_EXTERNAL_REVIEW、代码 NOT_STARTED；唯一下一步是等待用户重新外部复审，不得进入第 8/48 步。

## 第 7/48 步 Task 4 v1.9 第九次外部复审修订

- 新阻断 T4R-24 已在未修改的 v1.8 Step 2/3/30/31/32 五文件机械提取物上独立复现：阻断 SQL 的 `scanCallbackSql()` 实际 `{ kind: "ok" }`，第一次目标 callback delegate 实际 1、合同 0；SQLPOL51 连续两次稳定 RED，SQLPOL51～SQLPOL55 全部以相同 delegate 差异 RED。
- 根因是 v1.8 `findStatement()` 只返回 WITH 最终主要语句，`updatesPgSettings()` 又先要求该主要语句为 UPDATE；最终 SELECT 导致直接返回 false，未检查更深 token depth 的数据修改 CTE。SQLPOL48 只覆盖 WITH 最终主要 UPDATE，未覆盖 CTE 内 UPDATE。
- v1.9 遍历每一个 executable UPDATE token，以同一语句 depth 精确识别可选未引号 ONLY、`pg_settings` 或 `pg_catalog.pg_settings`（含精确小写双引号），不用 substring；字符串、注释、dollar quote 与普通标识符不误报，普通业务数据修改 CTE 和只读 pg_settings CTE继续允许。
- TEMP v1.9 GREEN：SQLPOL51～SQLPOL55 reject/delegate 0，SQLPOL56～SQLPOL57 allow/delegate 1；9 条证据行（含 SQLPOL52/53 的 ONLY 变体）全部 normal release、后续合法查询可用、公开错误敏感命中 0。future database unit 12/12、旧 scripted 45/45、LEX 23/23、SQLPOL01～50 回归 50/50、SQLPOL01～57 最终 57/57。
- 九个既有过滤器 matched/failed/skipped 为 9/0/129、5/0/133、1/0/137、5/0/133、1/0/137、2/0/136、23/0/115、23/0/115、50/0/88；新 57 条过滤器为 57/0/81，全部 exit 0。
- Step 62 五片段/五镜像逐字节 5/5 IDENTICAL；最终 Step 63 为 TypeScript 7.0.2、精确 ESM、strict/noEmit、exit 0、diagnostics 0、未消费 `@ts-expect-error` 0，pg 8.22.0/Kysely 0.29.4 类型兼容。
- 本轮只修改允许的 16 份 Markdown；Task 4 三个 Create 路径仍不存在，工程修改、新建、删除与白名单外修改均为 0。真实项目 build/typecheck/unit/database、真实完整 138/138、Docker、PostgreSQL、Flyway 与 Testcontainers 均 NOT_RERUN。
- T4R-16～T4R-24 的适用修订状态为 `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，不是外部 ACCEPT。Task 4 详细计划为 READY v1.9，代码 NOT_STARTED；唯一下一步是等待用户重新外部复审，不得实施 Task 4 或进入第 8/48 步。

## 第 7/48 步 Task 4 v1.8 第八次外部复审修订

- 新阻断 T4R-22/T4R-23 已在 v1.7 五文件提取物上稳定复现：`SET transaction_read_only = on` 与 `RESET ROLE` 均到达第一次 callback delegate，实际次数 1、合同要求 0；外部复审保持 `NOT_APPROVED`。
- 根因是 v1.7 `isTopLevelControl()` 采用开放式危险语句黑名单，只识别少量 `SET TRANSACTION`/`SET SESSION CHARACTERISTICS` 形态且没有 `RESET` 分支，不能形成有限、可验证的 callback SQL 合同。
- v1.8 改为有限 callback SQL 合同：顶层只允许 SELECT/INSERT/UPDATE/DELETE/MERGE/VALUES 及最终属于这六族的 WITH；其余语句族 fail closed。有效 token 中的精确 `set_config(...)`/`pg_catalog.set_config(...)` 调用和直接 UPDATE `pg_settings`/`pg_catalog.pg_settings` 同样在第一次目标 delegate 前拒绝；字符串、Escape string、dollar quote、注释和包含 `set_config` 的普通标识符不误报。
- 最终五片段与五镜像为 5/5 IDENTICAL；TypeScript 7.0.2 strict/noEmit exit 0、diagnostics 0。future database unit 12/12、v1.6 旧 scripted 子集 45/45、LEX 23/23、SQLPOL 50/50；九个过滤器实际匹配 9/5/1/5/1/2/23/23/50，failed 0、exit 0。29 条策略拒绝全部目标 delegate 0，21 条合法用例全部 delegate 1，全部 normal release 且下一次合法查询可用。
- 本轮只修改允许的 16 份 Markdown；Task 4 三个 Create 路径仍不存在，工程修改、新建、删除与白名单外修改均为 0。真实项目 build/typecheck/unit/database、Docker、PostgreSQL、Flyway 与 Testcontainers 均 NOT_RERUN。
- T4R-16～T4R-23 的适用修订状态为 `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，不是外部 ACCEPT。Task 4 详细计划为 READY v1.8，代码 NOT_STARTED；唯一下一步是等待用户重新外部复审，不得实施 Task 4 或进入第 8/48 步。

## 第 7/48 步 Task 4 v1.7 第七次外部复审修订

- T4R-20 独立复现使用 v1.6 五片段与精确 `String.raw` 输入；UTF-8 十六进制符合外部给定序列。v1.6 scanner 判为 safe，callback delegate 1、SQL 到达底层、UOW 返回 rows 并 commit；根因是 ordinary string 状态错误把反斜杠当作 escape 并吞掉闭合引号，extended mode 仅剩第二层。
- v1.7 采用 PostgreSQL 18 词法状态机和 `standard_conforming_strings` 方案 A：ordinary string 只识别 `''`，任何反斜杠发送前 unsafe；E/e 仅在 token boundary 使用 escape 语义；U&/UESCAPE、bit、hex、national prefix 本范围统一 fail closed。
- 新增 LEX01～LEX23；每条都在 test contract 表记录实际字符、词法含义、预期与 delegate 次数。TEMP 结果为 23/23，所有拒绝路径目标 SQL delegate 0；v1.6 的 45 条 scripted 子集与 future database unit 12/12 保持，13 条真实 fixture 测试 NOT_RERUN。
- T4R-21 读取 v1.6 v8 报告原始字节：声明 `80167B6980C37858982A93D2A7B1C202D63394715D460B96CEA19095839B5FB1`，按其“只替换字段值”规则计算为 `9D214CCEBEAAFB14301F12333C0996E9367B5F4E9EB87FFC7F60F689C1AF283E`。根因是旧生成器替换整行并丢失说明后缀。v1.7 报告改为唯一字段、仅 64 位值归零、原始换行字节不变的算法。
- 本轮只修改批准 Markdown；Task 4 三个 Create 路径仍不存在，工程修改/新增/删除均为 0。build、项目 typecheck、unit、database、Docker、PostgreSQL、Flyway 与 Testcontainers 均 NOT_RERUN。
- 唯一下一步：等待用户重新复审 Task 4 v1.7；未经新授权不得实施 Task 4 或进入第 8/48 步。

## 第 7/48 步 Task 4 v1.6 第六次外部复审修订

- 独立复现 T4R-17：v1.5 Step 62 的五文件与第 10～14 节存在 3/5 差异；旧提取物 strict/noEmit 为 TS2678×2，人工合并散落补丁并在正确 NodeNext 模块解析下为 34 个 diagnostics。T4R-18 的真实错误数以本轮复现为准，不照抄外部“8 个错误”。
- T4R-19 根因是第 14.1 节追加块引用 `readCommittedProbe`、`observeRawQuery`、`lastRawQueryConfig`、全局 unitOfWork 等未定义对象，并错误假设 Kysely QueryCreator 可以充当 QueryExecutorProvider。
- v1.6 删除双重源码、追加补丁和后置覆盖结构；Step 2/3/30/31/32 是五文件唯一输入，第 10～14 节由同一输入生成。Step 62 实跑为 5/5 IDENTICAL，最终 Step 63 原文实跑 TypeScript 7.0.2 strict/noEmit exit 0、diagnostics 0、未消费 `@ts-expect-error` 0。
- TEMP future database unit 为 12/12；不连接数据库的 future integration 聚焦为 45 passed/13 skipped；T4R-07/08/09/10/12/13/15/16 精确过滤器分别为 9、5、1、5、1、2、1、23 passed，全部 failed 0、exit 0。它们不是项目正式测试或真实 PostgreSQL 证据。
- 本轮只修改批准 Markdown；Task 4 三个 Create 路径仍不存在，工程修改/新增/删除均为 0。build、项目 typecheck、unit、database、Docker、PostgreSQL、Flyway 与 Testcontainers 均 NOT_RERUN。
- 唯一下一步：等待用户重新复审 Task 4 v1.6；未经新授权不得实施 Task 4 或进入第 8/48 步。

## 第 7/48 步 Task 3 验收与 Task 4 v1.0～v1.5 历史记录

本节保留形成 v1.5 时的真实记录；当前状态和唯一下一步以最上方 v1.8 记录为准。

- 第 6 步外部复审 `PASS`；T3R-13 `ACCEPT`、修订复审通过并正式关闭；Task 3 详细计划、代码与测试转为 `VERIFIED v1.5`，未解决阻断 0。
- `pnpm test:all` 缺少未来 Task 12 的 `.dependency-cruiser.cjs`，按既有真实证据保留，不属于 Task 3 阻断。本轮只执行计划逐字提取后的 TypeScript 7.0.2 strict/noEmit 静态编译、系统 TEMP 最小 Vitest 过滤器匹配证明与 Markdown 静态验证；build、项目 typecheck、unit、database、Docker、PostgreSQL、Flyway 与 Testcontainers 全部 `NOT_RERUN`。
- Task 4 外部复审原结论为 NOT_APPROVED；T4R-01～T4R-15 中适用编号全部 ACCEPT，新增 T4R-16 形成 callback 单语句发送前扫描、extended query 强制、内部控制 connection 隔离和 TXCTL01–TXCTL25 未来矩阵。修订 [Task 4 独立详细计划 v1.5](../plans/2026-07-25-stage-1-task-4-unit-of-work-implementation-plan.md)，状态 READY v1.5、等待用户重新复审；Task 4 代码 NOT_STARTED。精确未来工程映射保持 Create 3、Modify 2、Delete 0。
- T4R-13：三类合法安全错误由模块私有 WeakSet 品牌验证，固定脱敏 stack，冻结实例/prototype；IMM01 对 set/defineProperty、14 个字段、三类 Object.create 伪造和 rollback 两结果作直接断言，公开 error/cause 递归扫描。
- T4R-14：v1.3 Step 63 逐字复现 exit 1；v1.4 Step 63 在 strictRoot 写 TEMP `{"type":"module"}`，逐字校验 TypeScript 7.0.2、五文件、四个已消费的 `@ts-expect-error` 和 unused 0。
- T4R-15：beforeAll 与 CLEAN01 共用 `setupOwnedResources`；CLEAN01 实际注入 after-fixture、after-raw-pool、after-database 以及 raw/database cleanup failure，fixture 后项继续执行，setup code/cleanup categories 稳定且递归 raw 泄漏 0。
- v1.3 保持 Task 3 真实接口与 context/pre-commit/UNKNOWN 合同，并补齐：九个无错误起始锚点的聚焦过滤器及完整文件 skipped 0；COMMITTED/ROLLED_BACK/UNKNOWN 和双失败不被 release cleanup 覆盖；三类安全 error 运行时冻结；真实 raw pg client 直接观察 `release(true)`；实施前 baseline、exact diff、五文件字节对照与独立 strict compile；同步重入和三类部分初始化 cleanup。Modify 2 不含 factory 或公开 facade 变更。
- 第 6 步临时工程、镜像、Docker 和数据库授权保持已消费并归零；本步没有工程、Git、容器、数据库、外部服务或部署授权。
- 当时唯一下一步是等待用户重新复审 Task 4 v1.5；该动作已由上一节 v1.6 修订替代。未经新授权不得进入第 8/48 步或实施 Task 4。

## 第 6/48 步 T3R-13 当前状态一致性修订

- T3R-13 裁决为 `ACCEPT`：AI 交接、状态模型当前解释和阶段 1 总计划的 Task 3 当前摘要未同步第 6 步实施终态，错误保留了第 5 步/`NOT_STARTED` 表达；历史第 5 步段落仍是当时真实记录，不修改。
- 本轮只修改 7 份白名单 Markdown：三份当前状态根因修复，加 Task 3 独立计划、active-work、progress-log、verification 四份登记。TypeScript、SQL、JSON、YAML、TOML、测试、依赖、锁文件、新建、删除、白名单外修改和工程文件修改均为 0。
- 本轮不重新运行 build、typecheck、unit、Docker、PostgreSQL、Flyway 或 Testcontainers；第 6 步已有 unit 132/132、database unit 24/24、真实 database 65/65 仅作为保留证据，明确标记 `NOT_RERUN`。
- 该修订完成时仍为第 6/48 步；Task 3 详细计划与代码当时为 READY v1.5，等待用户重新复审 T3R-13 修订结果，尚非 VERIFIED。此条保留历史终态；当前第 7 步状态以上方新节为准。

## 第 6/48 步 Task 3 v1.5 实施完成，等待复审

- 本节保留第 6 步实施与验证事实；T3R-13 后的唯一当前动作以上一节为准。未经用户重新复审不标记 VERIFIED、不进入第 7/48 步、不规划或实施 Task 4。
- 工程写集合精确完成 19：Create 16、Modify 3、Delete 0。项目源从 105 增至 121，新增正好是 16 个计划 Create，超范围工程文件与删除为 0；`package.json` 和 `pnpm-lock.yaml` 哈希无漂移，依赖新增/升级 0。
- 已实现：PostgreSQL 18.4 九表 V1、三个 NOLOGIN 角色与隔离测试 LOGIN、Kysely pre-return 固定角色门禁、独立 QueryCreator facade、锁定镜像 Testcontainers fixture、Flyway copy-to-container one-shot、双阶段有界 raw 日志和唯一 owner 清理。Flyway JDBC 在连接建立时强制 `role=xht_flyway` 并保留 afterConnect callback，覆盖真实 12.11.0 的 housekeeping 多连接且不给 LOGIN 直接对象权限。
- 已验证：Node `v24.18.0`、pnpm `11.15.1`；build/typecheck exit 0；unit 132/132；Task 3 database unit 24/24；真实 database 65/65；M01–M17、P01–P23、scenario 01–24 完整；锁定 linux/amd64 child digest 运行；Task 3 容器/network/TEMP 残留 0。
- 已执行失败且未冒充 PASS：首个 `pnpm exec vitest` 因当前进程 PATH/Path 分发问题未启动；首轮真实 Flyway 因 callback 未覆盖 housekeeping 连接返回 `FLYWAY_MIGRATE_FAILED`；扩展矩阵首轮 stream 故障注入时序 37/39；`pnpm test:all` 因未来 Task 12 的 `.dependency-cruiser.cjs` 尚未创建而停在 architecture:check。各根因已分别纠正或按阶段边界保留，Task 3 规定的最终命令全部通过。
- 授权现状：第 6 步临时工程/镜像/本地容器授权已消费并归零；Git、worktree、子代理、并行代理、Telegram、其他业务外部服务、共享/生产数据库、生产部署、真实 Secret、Tasks 4–14 和第 7/48 步均为 0。

## 第 5/48 步 Task 3 v1.5 修订事实

- 本轮唯一目标是接受并闭环 T3R-12：v1.4 只在 raw Docker logs 请求返回 source 后启动 stream timeout，永久 pending 的 `container.logs()` 请求没有 `abortSignal` 或独立 Promise timeout，因而阻止 runner `finally` 与 started owner container 清理。
- 修订前逐字提取的 v1.4 `readLogs()` 已在系统 TEMP、无 Docker/数据库/网络 fake runtime 中稳定复现：400ms 后 `TIMEOUT`、传给 `logs()` 的 `abortSignal` 不存在、`cleanupCalls=0`、`collectDockerLogs()` 未进入且 `LOG_READ_TIMEOUT_MILLIS` 计时器未启动；T3R-12 裁决 `ACCEPT`。
- 本轮只允许修改既有 19 份 Markdown；Task 3 未来工程映射保持 19（Create 16、Modify 3、Delete 0），实际 Task 3 工程文件创建必须为 0。不得修改 strict multiplex parser、QueryCreator facade、关闭/角色门禁或任何工程文件，不运行 Git、Docker、数据库、网络或外部服务。
- 最终 v1.5 platform/worker/Flyway runner 逐字提取为 9036/9030/20356 bytes，以 TypeScript 7.0.2 strict、真实 Kysely 0.29.4、Testcontainers 12.0.4、Dockerode 5.0.1 和 @types/dockerode 4.0.1 类型编译 exit 0；20/20 `@ts-expect-error` 消费，facade/close 回归通过。
- T3R-11 原 24/24 场景、29 个展开失败保持；T3R-12 的同步 throw、异步 reject、Buffer/stream 成功、响应/忽略 abort、late resolve/reject 全部通过。四类 request 失败 remove 均为 1，request timeout+remove 失败保留主 `FLYWAY_LOG_READ_FAILED` 和唯一清理证据；timer/listener/unhandled/Secret 均为 0。唯一下一步是等待用户复审 v1.5；未经授权不得进入第 6/48 步。

## 第 5/48 步 Task 3 v1.4 修订事实

- 本轮唯一目标是接受并闭环 T3R-11：严格验证 Docker multiplex header/payload/EOF，处理 close-before-end 与读取超时，设置 raw/payload/frame 有界限制，并分别聚合 stdout、stderr 和 frame-order 以阻断跨通道穿插的同通道密码漏检。
- 修订前四项独立复现已成立：incomplete header 与 incomplete payload 都返回成功空字符串；close-without-end 在 500ms 后仍 pending；跨通道穿插后的全局串为 `synthetic-noisepassword` 且密码检测为 false。
- 本轮只修改用户白名单内 19 份 Markdown；Task 3 未来工程映射继续为 19（Create 16、Modify 3、Delete 0），实际 Task 3 工程文件创建 0。代码、测试、SQL、migration、容器配置、依赖、锁文件、Git、Docker、数据库和外部服务均禁止。
- 最终计划逐字提取的 platform/worker/Flyway runner 在 TypeScript 7.0.2 strict 与真实 Kysely/Testcontainers 类型下编译 exit 0；日志 24/24 子场景、29 个展开失败、13 个 cleanup 叠加组合及 facade/close 回归通过。该段为 v1.4 历史证据；当前唯一下一步以顶部 v1.5 修订事实和 [next.md](next.md) 为准。

## v1.3 历史目标与范围

- v1.3 当轮只把 Task 3 独立详细计划从 READY v1.2 修订到 READY v1.3，独立裁决并闭环 T3R-08（Kysely 关闭能力逃逸）、T3R-09（logs wrapper 吞 raw rejection）与 T3R-10（ZIP UTF-8 双头标志回退）；不进入第 6/48 步，不实施 Task 3。
- v1.3 保持未来工程写集合 19（Create 16、Modify 3、Delete 0）；本轮实际创建 Task 3 工程文件、测试、SQL、migration 与容器配置均为 0。
- 只允许修改用户白名单内 19 份 Markdown；Task 1/2 源码与测试、Task 2 独立计划、三个锁定文件、database 目录、任何 Task 3 工程文件、Tasks 4–14 工程文件均禁止修改。
- Git、worktree、子代理、并行代理、依赖安装/升级、lifecycle、audit、镜像拉取、容器启动、数据库、Telegram、collector、其他业务外部连接、真实 Secret 和部署均不在范围。
- v1.3 让公开 `db` 成为独立 QueryCreator runtime facade，使用 raw Dockerode logs + multiplex demux 传播请求/stream/超限失败，并要求本轮 ZIP 的 105 个 local 与 105 个 central header 全部设置 UTF-8 `0x0800`。

## 第 5/48 步 Task 3 v1.3 历史修订事实

- T3R-08 ACCEPT：旧 `Omit<Kysely<DB>, 'destroy'>` 只拒绝 direct destroy，九条链式/connection/asyncDispose 路径在 TypeScript 7.0.2 strict 下全部编译；Kysely 0.29.4 公开运行时 29 成员扫描未发现其他 driver 关闭入口。最终精确块用 `new QueryCreator({ executor: database.getExecutor() })`，本体和 plugin/schema 链 runtime 关闭能力 0，两个 app 共 20 个 `@ts-expect-error` 全部被消费，CRUD builder 正向可用。
- T3R-09 ACCEPT：真实 `DockerContainerClient` fake 注入得到 raw reject true，但 wrapper resolve、0 bytes、stream error null。最终计划改用 raw Dockerode logs；fake runner 的正常 stdout/stderr、成功空日志、request reject、stream error、超限、密码和主失败叠加 cleanup 失败七场景全部符合稳定错误、Secret 0 与 remove 一次合同。
- T3R-10 ACCEPT：v1.1 ZIP local/central UTF-8 flag 为 105/105，v1.2 为 0/105，后者共 210 个 flag 字段均为 `0x0000`。v1.3 最终 ZIP 必须同时通过 local/central 105/105、严格 UTF-8、唯一 `换汇通/` 顶层、安全路径、Windows 兼容解压与 105/105 哈希。
- 精确最终计划 platform/worker database 文件和 Flyway runner 代码块在 TypeScript 7.0.2 strict 下 exit 0；wrapper ordinary concurrency、同步重入、同步 throw、异步 reject 与失败粘滞矩阵保持通过。
- v1.3 当时唯一下一步是等待用户复审；该动作先由 v1.4、再由本轮 v1.5 修订替代。当前唯一下一步以本文顶部 v1.5 修订事实和 [next.md](next.md) 为准。

## 第 5/48 步 Task 3 v1.2 历史修订事实

- T3R-01 ACCEPT：本地 Kysely 0.29.4 源码和独立复现确认会抛错的 reserve hook 泄漏 client；v1.1 改为 `RoleEnforcingPostgresPool.connect()`，五类取得 client 后失败均计划 `release(true)` 一次。
- T3R-02 ACCEPT：fixture、runner、permissions spec、migrations spec 的资源 owner 与清理位置唯一；permissions 外层顺序为 worker → platform → fixture。
- T3R-03 ACCEPT：PostgreSQL/Flyway 两条未来构建路径都显式 `.withPlatform(locked.platform)`，计划覆盖 2/2，平台固定 `linux/amd64`。
- T3R-04 ACCEPT：Flyway 环境固定 `REDGATE_DISABLE_TELEMETRY: 'true'`，官方 Redgate 来源已登记；email/token/license/pipeline/collector 均禁止。
- T3R-05 ACCEPT：两个 app 计划声明并直接测试 `DATABASE_CLOSE_FAILED`；close 先缓存 deferred，再关闭底层 pool，覆盖普通并发、同步重入和成功/失败粘滞。
- T3R-06 ACCEPT：修订前 wrapper 的同步/异步 `end()` 虽然调用一次且 Promise 粘滞，但无稳定 code，`synthetic-secret` 在公开错误表面命中 3。v1.2 让 wrapper 自身把两路失败映射为新建的 `DATABASE_CLOSE_FAILED`，公开 `db` 类型收窄为不含 `destroy` 的 `ManagedDatabase`；精确计划块 TEMP 运行后 platform/worker 的 direct/handle 场景均为同 Promise、底层 `end()` 1 次、正文命中 0，`@ts-expect-error handle.db.destroy()` strict typecheck exit 0。
- T3R-07 ACCEPT：修订前 Testcontainers 12.0.4 非零 one-shot 为 `nonZeroStartRejected=true`、`startedHandleAvailable=false`、调用方 finally stop 0。v1.2 使用公开 `StartupCheckStrategy` 在进程停止后返回 handle，再 inspect ExitCode；无 handle 时以每次 UUID owner label 查询 all states 并精确回收。fake runtime 的成功、非零、无 handle、日志、主/清理 inspect、query、stop、remove 和主失败加清理失败矩阵全部通过，跨 owner 清理与 Secret 命中均为 0。
- 两个未来 unit spec 各定义 U01–U12，共 24 项；这是计划测试，当前实际测试文件和运行数仍为 0。
- 历史下一步：当时等待用户复审 Task 3 v1.2 修订包；该等待已由本轮 v1.3 外部复审修订关闭。

## 第 4/48 步历史执行点

- 已完成：R5-01 在旧真实 dist 独立复现，platform/worker 均为 `calls=2`、`samePromise=false`、`laterSame=true`，裁决 ACCEPT；根因是 async IIFE 在赋值前同步进入 exporter shutdown，使同步重入看见未初始化的缓存。
- 已完成：两份 telemetry spec 在旧实现上取得 2 文件 10/14 PASS、4 个预期 RED；最小同构修复只把两个 factory 的 exporter 调用延迟到已缓存 Promise 的 microtask。
- 已完成：offline clean build、telemetry 2/2 文件 14/14、typecheck、完整 unit 7/7 文件 108/108、三包导入、第二次 offline install与 lockfile/package.json 双哈希门禁。
- 已完成：独立同步重入成功/失败用例对 platform/worker 均得到 calls 1、Promise 同一、后续同一和立即关闭；失败三路全部脱敏拒绝。
- 已完成：R4-01 至 R4-03 独立复现并全部 ACCEPT。platform/worker 均出现第二个并发 shutdown 提前成功及失败后后续错误成功；Windows canonical reference 返回 `INVALID_FILE_REFERENCE` 而 POSIX 接受；两处当前状态漂移命中。
- 已完成：Task 2 在修复前从 READY 降为 BUILDING；新增测试在旧实现上得到 3 文件 41/47 通过、6 个预期 RED，最小修复后 47/47 GREEN。
- v1.2.5 历史已完成：最终 offline clean build、typecheck、7 文件 104/104 unit、三包导入、第二次 offline install、lockfile 与范围/安全/文档门禁；Task 2 当时恢复 READY、等待用户再次复审。
- 已完成：指定 21 份权威文件读到 EOF；v1.2.4 计划与真实基线一致性核验；Node `v24.18.0`、pnpm `11.15.1`、frozen/ignore-scripts install exit 0；lockfile 哈希无漂移、lifecycle 0、`allowBuilds: {}`。
- 已完成：Subtask 2.1 创建 `packages/contracts/src/observability.ts` 并修改 contracts index；五目录 clean 后 `pnpm build` exit 0，生成观测合同 JS 和类型声明，lockfile 无漂移。
- 已完成：Subtask 2.2 测试已创建；首次测试启动因当前进程双 `PATH`/`Path` 使 pnpm exec 未注入 workspace `.bin` 而失败，未冒充 RED。systematic-debugging 以进程内前置既有 `.bin` 验证根因后重跑，clean/build 均 exit 0，聚焦测试 exit 1，1 文件 31/31 因生产实现和导出不存在而正确 RED。
- 已完成：Subtask 2.2 按权威代码块创建三个生产文件并更新 config index；clean/build、相同聚焦测试和 typecheck 均 exit 0，1 文件 31/31 GREEN。
- 已完成：Subtask 2.3 测试已创建；从无 dist 状态 clean/build exit 0，keyring 聚焦 Vitest exit 1，1 文件 34/34 因 keyring 实现/导出不存在而正确 RED。
- 已完成：Subtask 2.3 创建 keyring 生产实现并更新 config index；clean/build、两个 config 聚焦文件和 typecheck 均 exit 0，2 文件 65/65 GREEN。
- 已完成：Subtask 2.4 两个 logger 测试已创建；clean/build exit 0，logger 聚焦 Vitest exit 1，2 suites 因各自 factory 模块不存在而正确 RED，测试执行数 0。
- 已完成：Subtask 2.4 创建 logging policy 和两个 logger factory，并更新 config index；clean/build、两个 logger 聚焦文件和 typecheck 均 exit 0，2 文件 22/22 GREEN。
- 已完成：Subtask 2.5 两个 telemetry 测试已创建；clean/build exit 0，telemetry 聚焦 Vitest exit 1，2 suites 因各自 factory 模块不存在而正确 RED，测试执行数 0。
- 已完成：Subtask 2.5 创建两个 telemetry factory；clean/build、两个 telemetry 聚焦文件和 typecheck 均 exit 0，2 文件 8/8 GREEN，真实 exporter/collector 0。
- 已完成：Subtask 2.6 从无 dist 状态的 build、六文件 95/95、typecheck、完整 unit 96/96、三个 package export、最终 frozen install 与 29 项安全范围检查；18 个工程文件与权威代码块逐文件一致。
- 历史下一步：当时等待用户审查 Task 2 v1.2.6 同步重入修复包和验证证据；该等待现已由用户最终 PASS 结论关闭。

## v1.2.3 历史基线与 v1.2.4 修订

- v1.2.3 的 Node 语法检查只能证明语法可解析，不能证明 TypeScript 类型、Vitest 名称解析和运行时安全测试可执行；v1.2.4 使用完整 TEMP 工程构建和测试补齐该门禁。
- E3-01 至 E3-04 全部 ACCEPT：补齐 Vitest 导入与 exact optional 合同；file reference 在 URL 解析前检查原始路径；删除两个不可达错误码，增加 activation 直接测试和策略最小/最大合法边界。
- R2-01 至 R2-07 均经实际代码块和主计划调用方核验为 ACCEPT。Task 2 计划现在只有一个受管理解码 Buffer，不以第二个 Buffer 做 canonical 检查；每次 `withMaterial` 使用 finally 清零借用副本，内部 material 永不直出。
- keyring 的 public 时间改为不可变 RFC3339 字符串或显式 `undefined`；key、retained 数组和 keyring 运行时冻结。剩余 20 个可触发稳定错误码的声明、抛出与直接测试集合相等。
- raw Secret 同步/异步 consumer 失败、UTF-8/JSON/schema、canonical/短/长/重复 material、后项失败清前项、borrowed/internal dispose 和错误/JSON/inspect/snapshot 零泄露形成完整计划矩阵。
- SafeLogger 六事件具有精确 required/optional、route、outcome、error_category policy；非法日志统一抛 `SafeLoggingError`，整条 destination 写入 0。platform/worker telemetry 将 register/shutdown 原始异常映射为稳定错误并证明不泄露合成敏感正文。
- 阶段主计划 Task 5 已改为 `withMaterial` 并清零 canonical bytes；Task 11 已改为 `withResolvedSecret`，把 `packages/contracts/src/observability.ts` 加入唯一写集合，定义 Telegram event/context，并统一非法日志测试语义。

## 文件与授权边界

- Task 2 首轮实施工程映射为 18：Create 16、Modify 2，且已全部真实存在。v1.2.5 历史修复只修改其中 6 个既有文件；v1.2.6 当前授权只修改其中 4 个既有 telemetry 文件，计划新增和删除工程文件均为 0。
- Task 1 源码、测试、package manifests、根 `package.json`、`pnpm-lock.yaml` 和依赖版本未修改。
- 项目中既有 `node_modules` 与 Task 1 生成 `dist` 不属于本轮新增。历史“两次模拟”明确属于 v1.2.4 计划可执行性验证；v1.2.5 外部复审修复产生的辅助脚本、兼容性尝试和验证目录也只存在于系统 TEMP，以上 TEMP 产物均已清理。v1.2.6 的同步重入验证使用内联运行内容，没有创建项目内辅助脚本；项目内临时脚本、TEMP、缓存和日志残留为 0，交付物完整性检查若使用系统 TEMP 也必须在完成前清理。
- Git、worktree、子代理、容器、数据库、Flyway、Testcontainers 运行、Telegram、collector、其他业务外部连接、部署和真实 Secret 使用数均为 0。

## 第 3 步历史验证事实

- Node `v24.18.0`、pnpm `11.15.1`；frozen/ignore-scripts install exit 0，下载 0、lifecycle 执行 0。
- clean build exit 0；六个聚焦文件 6/6、95/95 PASS；typecheck exit 0；完整 unit 7/7、96/96 PASS；failed/skipped/only/retry 均为 0。
- lockfile SHA-256 为 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`，漂移 0；不可达错误码 0，未被直接测试的可触发 keyring 错误码 0。
- 上述 TEMP 结果仅为第 3 步历史计划可执行性证据；第 4 步真实项目 RED/GREEN 与最终结果以本轮追加的 [verification.md](verification.md) 记录为准。

## 第 4 步真实项目结果

- 工程变更：Create 16、Modify 2、Delete 0；超范围工程文件 0；17 份授权 Markdown 已同步。
- 最终运行：build exit 0；聚焦 6/6、95/95；typecheck exit 0；unit 7/7、96/96；package exports 3/3；failed/skipped/only/retry 均为 0。
- 安全范围：keyring 声明/实现/直接测试 20/20/20，缺失与未测 0；生产网络调用、Secret 泄露路径、强 Secret 形态、新依赖、依赖升级、lockfile 漂移、Git/worktree/子代理、容器/数据库/Telegram/collector/部署和 Task 3–14 实现均为 0。
