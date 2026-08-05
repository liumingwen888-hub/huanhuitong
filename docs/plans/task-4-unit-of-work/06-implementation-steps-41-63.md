# Implementation Steps 41–63

[← Task 4 LAYOUT-S1 index](00-index.md) · [Canonical fragments](fragments/00-index.md)

> Task 4 v1.10 execution checklist. Step numbers, order and unchecked state are authoritative. Future engineering code is referenced by canonical fragment and SHA-256 instead of duplicated.

- [ ] **Step 41:** 运行 CLEAN01 与 UOW20，确认三个部分初始化点共用 setup/catch，cleanup 首错不跳过后项，同步重入和重复 close 共享 sticky Promise。

- [ ] **Step 42:** 执行 T4R-07 过滤器 `TXCTL0[1-9]`；期望 9 matched、0 failed、exit 0。

- [ ] **Step 43:** 执行 T4R-08 过滤器 `REL0[1-5]`；期望 5 matched、0 failed，并逐项核对 outcome 不倒退。

- [ ] **Step 44:** 执行 T4R-09 过滤器 `IMM01`；期望 1 matched、0 failed，三类品牌伪造全部失败。

- [ ] **Step 45:** 执行 T4R-10 过滤器 `(REL(03|04|05)|TXCTL(16|17))`；期望 5 matched、0 failed，`release(true)` 与健康 normal release 均可观察。

- [ ] **Step 46:** 执行 T4R-12 过滤器 `CLEAN01`；期望 1 matched、0 failed，after-fixture/after-raw-pool/after-database 注入闭合。

- [ ] **Step 47:** 执行 T4R-13 过滤器 `(IMM01|TXCTL25)`；期望 2 matched、0 failed，伪造品牌和敏感字段命中 0。

- [ ] **Step 48:** 执行 T4R-15 过滤器 `CLEAN01` 并逐项核对 raw/database cleanup failure 不跳过 fixture。

- [ ] **Step 49:** 执行 T4R-16 过滤器 `TXCTL(0[1-9]|1[014-9]|2[0-5])`；期望 23 matched、0 failed；TXCTL12/13 留给真实 PostgreSQL 全量。

- [ ] **Step 50:** 执行 T4R-20 过滤器 `LEX(0[1-9]|1[0-9]|2[0-3])`；期望 23 matched、0 failed、exit 0。逐条核对 contract 表的实际字符、词法含义、接受/拒绝结果与 delegate 次数，所有拒绝必须为 0。

- [ ] **Step 51:** 先执行既有 SQLPOL01～50 过滤器 `SQLPOL(0[1-9]|[1-4][0-9]|50)`，要求 50 matched、0 failed、exit 0；再执行 T4R-24 最终过滤器 `SQLPOL(0[1-9]|[1-4][0-9]|5[0-7])`，运行前从 `callbackSqlPolicyContract` 声明期望 57，实际必须 57 matched、0 failed、exit 0。SQLPOL51～55 必须 reject/delegate 0，SQLPOL56～57 必须 allow/delegate 1；每条输出/核对原文、UTF-8 十六进制、PostgreSQL 含义、预期/实际、第一次目标 delegate、公开错误敏感命中 0、normal release 与后续合法查询证据。

- [ ] **Step 52:** 运行未来完整 database project，环境中不得设置 `XHT_TASK4_SCRIPTED_ONLY`；138/138、skipped 0，并取得真实 PostgreSQL/Testcontainers 原子性、pid、release、词法策略和资源清理证据；随后运行 future database unit、完整 unit、项目 typecheck 和 clean build，全部必须是新鲜 exit 0。

- [ ] **Step 53:** 核对实施前 `146 files = 91 Markdown + 55 non-Markdown`，未来实施精确范围 `Create 3 / Modify 2 / Delete 0 / outside 0`，实施后 `149 files = 91 Markdown + 58 non-Markdown`；同时要求三锁不变、Secret 0、未授权网络副作用 0、真实资源残留 0。任一数量或范围不符立即 BLOCKED。

- [ ] **Step 54:** 按文档合同同步 current/next/active-work/progress-log/verification/testing 和计划索引；Task 4 只能进入 READY 等待用户复审，不能自行 VERIFIED。

- [ ] **Step 55:** 删除 future 实施 TEMP、日志和测试临时文件；复核工程差异、五文件字节、资源 owner 和未进入下一步。

- [ ] **Step 56:** 复核 BEGIN/COMMIT/ROLLBACK 及框架未来必要的固定 `SET LOCAL` 不变量只由闭包内私有 connection 发送且不进入 callback scanner；callback executeQuery/streamQuery/executeSql 三路都在委托前扫描，不能取得内部 delegate、伪装内部查询或收到私有对象；pg 8.22.0 无参数与参数化 callback query 均保留 `queryMode: extended` 第二层证据。

- [ ] **Step 57:** 复核 scanner 的 `code/single/escape/double/line/block/dollar` 状态、quoted/unquoted identifier token、括号深度、token-boundary E/e、完整 dollar tag、嵌套 block depth、顶层单末尾分号与所有未闭合状态；`U&`/`UESCAPE`/bit/hex/national prefix 必须 fail closed。

- [ ] **Step 58:** 复核 `standard_conforming_strings` 方案 A 与有限 allowlist：普通字符串反斜杠固定 unsafe，E/e 独立；顶层只允许 SELECT/INSERT/UPDATE/DELETE/MERGE/VALUES 或终止于这些族的 WITH；SET/RESET/角色/会话授权/约束、精确 `set_config` 调用与所有可执行语句作用域中的 `UPDATE [ONLY] pg_settings`/`pg_catalog.pg_settings` 均在第一次 delegate 前拒绝，普通业务数据修改 CTE、只读 pg_settings CTE、合法 DML 和所有旧 `String.raw` 输入无回归。

- [ ] **Step 59:** 复核 callback public surface、Reflect、prototype 和 Kysely plugin 均不能取得 raw client、pool、connection 或 executor。

- [ ] **Step 60:** 复核所有公开错误的 message/cause/stack 和 pg 常见字段，真实 Secret 与强特征 Secret 命中 0。

- [ ] **Step 61:** 记录最终 138 个唯一 test title、九个既有过滤器及新 57 条过滤器的 matched/failed/skipped、Step 8～26 声明/命令 `19/19 STEP-FILTER IDENTICAL`、LEX union 23/23/duplicate 0/empty 0、LEX01～LEX23 与 SQLPOL01～SQLPOL57 的原文/hex/含义/预期/实际/delegate/公开错误敏感命中/release/后续合法查询证据、五文件 hash、三锁 hash 和资源清理结果，准备用户复审。

- [ ] **Step 62:** 按 [verification and delivery gates](11-verification-and-delivery-gates.md#step-62-canonical-fragment-reconstruction) 执行 canonical fragments → manifest reconstruction → frozen v11 expected bytes/SHA-256 → byte comparison；五个未来工程文件必须 5/5 `IDENTICAL`。

- [ ] **Step 63:** 这是整个实施计划最后一个编号步骤。按 [verification and delivery gates](11-verification-and-delivery-gates.md#step-63-typescript-strictnoemit) 从 canonical fragments 重建五文件，在精确 `type=module` TEMP 使用 TypeScript 7.0.2 strict/noEmit；要求 exit 0、diagnostics 0、未消费 `@ts-expect-error` 0，随后删除 strict TEMP。
