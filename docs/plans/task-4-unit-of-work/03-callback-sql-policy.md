# Callback SQL policy

[← Task 4 LAYOUT-S1 index](00-index.md) · [SQLPOL01–20](08-sqlpol-01-20.md) · [SQLPOL21–40](09-sqlpol-21-40.md) · [SQLPOL41–57](10-sqlpol-41-57.md)

> The finite callback SQL policy body remains frozen from v1.9. Task 4 v1.10 adds only the self-contained T4R-27 RED reconstruction and does not alter canonical future code.

## T4R-27 self-contained RED ruling

- T4R-27：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`。
- v1.8 冻结 `unit-of-work.ts` 为 `24624 bytes / 878 lines / 4BE97A751BD02700C37E307AB57F53770261C95A09B152DAA6566DBD0E73ABEC`。
- v1.10 从当前 canonical fragments 重构五文件，只在系统 TEMP 对 `unit-of-work.ts` 精确反向替换 `updateTargetsPgSettings()` 函数组与 `updatesPgSettings(tokens)` 调用；两处命中数必须各为 1，替换后必须得到上述 v1.8 冻结值。
- RED 不再依赖 v10 或其他外部历史包；单条和批量 RED 必须同时核对精确匹配数、失败 ID、delegate 期望 0/实际 1、`scanCallbackSql()` 的 `{ kind: "ok" }` 以及 module/collection/beforeAll/fixture/TypeScript/其他失败均为 0。
- 恢复 canonical v1.10 后，SQLPOL51～55 必须 reject/delegate 0，SQLPOL56～57 必须 allow/delegate 1，合计 7/7 GREEN。权威命令见 [verification and delivery gates](11-verification-and-delivery-gates.md#t4r-27-self-contained-v18-red-reconstruction)。

## T4R-20～T4R-24 冻结裁决与复现记录

- T4R-20：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，ordinary/E-string 分离、方案 A 与 LEX01～LEX23 不倒退。
- T4R-21：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，报告规范化唯一字段 64 位归零算法不倒退。
- T4R-22：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，事务特征 GUC、`set_config` 与 `pg_settings` 等价路径已纳入发送前拒绝。
- T4R-23：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，开放式危险词黑名单已替换为有限顶层业务语句族 allowlist。
- T4R-24：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`，所有可执行语句作用域中的 `UPDATE [ONLY] pg_settings` 与 `UPDATE [ONLY] pg_catalog.pg_settings` 均纳入发送前拒绝，普通业务数据修改 CTE 保持允许。
- 上述状态只表示计划内闭环并等待外部复审；T4R-16～T4R-27 均不得自行写成外部 `ACCEPT`。

T4R-24 修订前独立 TEMP 复现机械提取 v1.8 Step 2/3/30/31/32 的未来五文件，并只替换测试观察层。单行原始 SQL 为 `WITH changed AS (UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1`；UTF-8 十六进制为 `57 49 54 48 20 63 68 61 6E 67 65 64 20 41 53 20 28 55 50 44 41 54 45 20 70 67 5F 63 61 74 61 6C 6F 67 2E 70 67 5F 73 65 74 74 69 6E 67 73 20 53 45 54 20 73 65 74 74 69 6E 67 3D 27 6F 6E 27 20 57 48 45 52 45 20 6E 61 6D 65 3D 27 74 72 61 6E 73 61 63 74 69 6F 6E 5F 72 65 61 64 5F 6F 6E 6C 79 27 29 20 53 45 4C 45 43 54 20 31`。v1.8 `scanCallbackSql()` 实际返回 `{ kind: "ok" }`，`CallbackConnection` 到达第一次目标 delegate，实际 1、合同 0；SQLPOL51 连续两次均以同一差异 RED，SQLPOL51～SQLPOL55 均为 expected delegate 0、actual delegate 1。

T4R-24 的根因不是少一个关键词：`findStatement()` 只返回最终主要语句；v1.8 `updatesPgSettings()` 先要求该主要语句为 `UPDATE`，最终主要语句为 `SELECT` 时直接返回 false；数据修改 CTE 的 `UPDATE` token 位于更深 depth，旧逻辑从不检查其目标关系。SQLPOL48 仅覆盖 WITH 最终主要语句本身为 `UPDATE pg_settings`，没有覆盖 CTE 内部的可执行 UPDATE。PostgreSQL 允许 WITH 中的数据修改语句；即使没有 `RETURNING` 也会执行，而更新 `pg_settings.setting` 等价于 `SET`，故必须在 delegate 前闭合该路径。

T4R-22 修订前独立 TEMP 复现直接使用 v1.7 Step 2/3/30/31/32 五片段：原始 SQL `SET transaction_read_only = on`，UTF-8 十六进制 `53 45 54 20 74 72 61 6E 73 61 63 74 69 6F 6E 5F 72 65 61 64 5F 6F 6E 6C 79 20 3D 20 6F 6E`。scanner 在 code 状态生成顶层 `SET`、`TRANSACTION_READ_ONLY`、`ON` token；旧 `isTopLevelControl()` 只拒绝 `SET TRANSACTION` 和 `SET SESSION CHARACTERISTICS AS TRANSACTION`，因此返回 `ok`。目标 callback delegate 实际 1，query 顺序为 BEGIN/目标 SQL/precommit probe/COMMIT，UOW 返回 `{ rows: [] }`，normal release `[1]`、destroy `[]`；合同要求 delegate 0。

T4R-23 修订前独立 TEMP 复现使用同一 v1.7 提取物：原始 SQL `RESET ROLE`，UTF-8 十六进制 `52 45 53 45 54 20 52 4F 4C 45`。scanner 在 code 状态生成顶层 `RESET`、`ROLE` token；旧 `isTopLevelControl()` 没有任何 `RESET` 分支，因此返回 `ok`。目标 callback delegate 实际 1，query 顺序为 BEGIN/目标 SQL/precommit probe/COMMIT，UOW 返回 `{ rows: [] }`，normal release `[1]`、destroy `[]`；合同要求 delegate 0。

PostgreSQL 18 的 `transaction_isolation`、`transaction_read_only`、`transaction_deferrable` 修改分别等价于相应 `SET TRANSACTION` 选项；`set_config` 和更新 `pg_settings.setting` 等价于 `SET`；`RESET ROLE` 会改变 `current_user`。因此根因不是漏掉两个孤立关键词，而是 v1.7 采用无法闭合的开放式危险语句黑名单。

T4R-20 的独立 TEMP 复现使用 v1.6 五片段机械提取物与 `String.raw` 精确输入 `select '\'; commit`。UTF-8 十六进制为 `73 65 6C 65 63 74 20 27 5C 27 3B 20 63 6F 6D 6D 69 74`；v1.6 扫描器把普通字符串内反斜杠误作 escape，吞掉真正闭合引号，使顶层 `; commit` 被误判为字符串内容。结果为 scanner `ok`、callback delegate 1、SQL 到达底层、`UnitOfWork.execute` 返回 `{ rows: [] }` 并提交；`queryMode: extended` 只是第二层，违反第一次 delegate 前拒绝合同。

T4R-21 的独立原始字节复现读取 v1.6 v8 报告：声明规范化值为 `80167B6980C37858982A93D2A7B1C202D63394715D460B96CEA19095839B5FB1`，按报告文字规定仅替换三个字段值、保留同行其余字节并使用实际 LF/UTF-8 无 BOM计算，得到 `9D214CCEBEAAFB14301F12333C0996E9367B5F4E9EB87FFC7F60F689C1AF283E`，两者不相等。旧生成器错误地替换了整条“报告完整文件”行并删除说明后缀，而报告声明的是只替换字段值。

[Canonical fragments](fragments/00-index.md) 是五个未来工程文件的唯一施工输入；原 v11 Step 2/3/30/31/32 与第 10～14 节的重复代码正文已由 [migration manifest](12-migration-manifest.md) 映射到该单一权威。Step 62 必须按 manifest 重构并验证 5/5 `IDENTICAL`，Step 63 必须保持为最后一个编号实施步骤。

## 5. 事务、SQL 防护与连接结果合同

- BEGIN、pre-commit probe、COMMIT、ROLLBACK 只走 UnitOfWork 闭包持有的内部 connection；callback 不能取得该通道。
- `scanCallbackSql` 是有限发送前词法状态机，区分普通单引号、`E/e` escape 单引号、双引号标识符、普通标识符、完整匹配且大小写敏感的 dollar tag、行注释、支持深度的块注释、括号深度、普通代码、首位 BOM 与前导空白。
- 普通字符串只把 `''` 视为引号转义，不把反斜杠当作 escape。采用 `standard_conforming_strings` 方案 A：普通字符串出现反斜杠即固定 `TRANSACTION_QUERY_UNSAFE`，在 delegate 前保守拒绝；不依赖服务器默认值，也不给 callback 改写会话设置的机会。
- 只有满足 token 边界的 `E'…'` 或 `e'…'` 才进入 escape 状态；反斜杠在该状态消费下一个字符。普通标识符末尾 `e` 不得被误判为 prefix。
- `U&'…'`、`U&"…"`（含后续 `UESCAPE`）、`B'…'`、`X'…'`、`N'…'` 本五文件范围不做半支持，统一在发送前 fail closed。该裁决依据锁定 PostgreSQL 18 的[词法结构](https://www.postgresql.org/docs/18/sql-syntax-lexical.html)；未来若要支持，必须新增完整状态与对应测试，不能默认安全。
- 未闭合 ordinary/escape/double/dollar/block 状态、括号/方括号不平衡、空输入及不完整 dollar tag 统一 fail closed。只有顶层分号参与语句终止；仅允许一个末尾分号且其后只能是空白或注释，任何第二个有效 token 都返回 multi。
- callback 顶层只允许 `SELECT`、`INSERT`、`UPDATE`、`DELETE`、`MERGE`、`VALUES`；`WITH` 必须按有限 CTE 结构解析，最终顶层语句仍属于上述六族。其他顶层族一律返回 control，不再逐个维护 BEGIN/SET/RESET/DISCARD 等开放式黑名单。
- 即使顶层族被允许，有效 SQL token 中的精确 `set_config(...)`、精确双引号 `"set_config"(...)`、任意限定的精确 `set_config` 调用，以及每一个可执行语句作用域中的 `UPDATE [ONLY] pg_settings`/`UPDATE [ONLY] pg_catalog.pg_settings`（含精确小写双引号系统标识符）仍返回 control。目标检测遍历 executable token，不只检查 WITH 最终主要语句；`UPDATE`、可选未引号 `ONLY`、关系 identifier 与点号必须处于该 UPDATE 的同一 depth，使用 token 类型、精确 identifier 与 depth，不使用 substring。字符串、Escape 字符串、dollar quote、注释、`current_setting`、只读 pg_settings CTE、普通业务数据修改 CTE 与名称中只包含敏感文本的普通标识符不得误报。
- v1.9 的安全声明严格限定为：callback SQL 只允许已列出的业务语句族，并对直接出现在 callback SQL 文本中任意可执行语句作用域的事务控制、角色控制和运行参数修改能力执行发送前拒绝。该 scanner 不声称理解任意 PostgreSQL SQL 的全部语义；无法确认的顶层/词法结构 fail closed。
- callback 无参数和参数化查询都由 pool wrapper 发送 `{ text, values, queryMode: "extended" }`；callback 无法传入 config 覆盖 queryMode。extended protocol 只作为第二层，scanner 必须先拒绝。
- COMMITTED、ROLLED_BACK、UNKNOWN 和 callback/rollback、commit/rollback 组合结果不被 normal/destroy release failure 覆盖；健康 policy reject 使用 normal release。

## Canonical implementation and test locations

- Scanner, tokenizer, finite allowlist, set_config and pg_settings checks: [unit-of-work source prefix](fragments/01-unit-of-work.ts.md).
- CallbackConnection delegate boundary: [callback connection source suffix](fragments/02-callback-connection.ts.md).
- TXCTL: [integration part 02](fragments/05-unit-of-work.integration.spec.part-02.ts.md).
- LEX: [integration part 03](fragments/05-unit-of-work.integration.spec.part-03.ts.md).
- SQLPOL: [integration part 04](fragments/05-unit-of-work.integration.spec.part-04.ts.md).
