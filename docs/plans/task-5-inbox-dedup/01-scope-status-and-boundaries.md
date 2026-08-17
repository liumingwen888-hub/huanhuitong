# 范围、状态与排除项

[返回索引](00-index.md)

## 目标

在现有 PostgreSQL `inbox_messages`、Task 2 版本化 Inbox HMAC keyring 和 Task 4 单连接 Unit of Work 上，建立 Telegram Webhook 入站幂等边界：

1. `(consumer, external_message_id)` 是唯一业务收件键。
2. 对完整 parsed Telegram Update 进行确定性 canonicalization，并以 current key 写入版本化 HMAC。
3. 精确区分 `claimed`、`duplicate_same_payload`、`conflict`、`digest_key_unavailable`。
4. 以 PostgreSQL `clock_timestamp()` 权威租约、`claim_generation`、claimant 与 inboxId CAS 支持崩溃后过期重领，并阻断调用方伪造时间或旧 claimant 完成。
5. `markProcessed` 与未来身份/Outbox 等业务效果共用调用方已打开的 Task 4 `TransactionContext`。
6. raw Update、正文、callback data、canonical bytes、key material 和 payload digest 不跨越规定边界。

## 当前状态

- 第 8/48 步：`COMPLETED / EXTERNAL REVIEW PASS`。
- Task 4：`IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`，阻断 0。
- Task 5 v1.3 外部复审（2026-08-17）：`APPROVED`。
- T5R-01、T5R-02、T5R-04、T5R-05、T5R-06、T5R-07：`ACCEPT / CLOSED`。
- T5R-03、T5R-08：`ACCEPT / CLOSED`（2026-08-17 用户复审通过）。
- 第 9/48 步：`COMPLETED / EXTERNAL REVIEW PASS`。
- Task 5 计划：`READY v1.3 / EXTERNAL REVIEW PASS`。
- Task 5 代码：`NOT_STARTED`。
- 第 10/48 步：`NOT_STARTED`，等待用户实施授权（须按 T5R-08 提供获批 ZIP 路径/bytes/SHA-256 与复审报告 raw/normalized SHA-256）。

## 方案比较与裁决

### 方案 A：唯一插入 + 行锁读取 + 显式 CAS（采用）

先 `INSERT ... ON CONFLICT DO NOTHING`；冲突时在同一 `TransactionContext.database` 上 `SELECT ... FOR UPDATE`，按原行 `digest_key_version` 比对，随后仅在 RECEIVED 或租约过期 CLAIMED 时做带状态/代次/claimant 条件的更新。优点是每条状态转换可审计、没有第二连接、并发等待语义由 PostgreSQL 唯一约束和行锁保证；缺点是冲突路径多一次查询。

### 方案 B：单条复杂 UPSERT（不采用）

`ON CONFLICT DO UPDATE CASE` 可减少往返，但会把摘要比较、缺 key、状态分类、租约和代次塞进一个难以审计的表达式，并容易在 conflict 路径误写原摘要/版本。

### 方案 C：advisory lock 或进程内缓存（不采用）

会引入额外锁命名合同或进程局部事实，无法替代现有唯一约束，且扩大冻结范围和恢复风险。

## 明确范围

- 完整 parsed Update 的 JSON 数据模型 canonicalization。
- current/retained keyring 的同步 `withMaterial` 借用。
- 固定 `hmac-sha256:<43-char-base64url>` 摘要格式。
- 新消息、同载荷重放、异载荷冲突、历史 key 缺失。
- RECEIVED、CLAIMED、PROCESSED 的合法读写；CONFLICT/FAILED 的终态兼容读取。
- 30 秒固定 claim lease；lease 起点、expiry 判断、重领和 processed_at 只取同一 PostgreSQL transaction/connection 的数据库原始精度时间；禁止将 claimed_until 往返 JavaScript Date 后作相等 CAS，receivedAt 仅作元数据；未来如需配置化必须另行规划。
- 真实 PostgreSQL/Testcontainers 并发、回滚、连接故障和权限测试。

## 明确排除

- Telegram HTTP/Webhook secret/HTTPS/body-size/Zod/grammY adapter（未来 Task 9）。
- `/start` 路由、UID 注册、身份仓储与业务 Outbox（未来 Tasks 7–10）。
- Outbox worker、持久任务与外部 Telegram 发送（Task 6 及以后）。
- migration、表结构、索引、角色 grant、Task 4 实现、日志 policy、依赖和锁文件修改。
- raw Update 存档、审计正文、冲突 payload 保存、死信 UI、生产保留清理作业。
- Git、共享/生产数据库、真实 Secret、Telegram 或其他业务外部服务。

## 冻结范围可行性裁决

当前磁盘接口足以在 Create 6、Modify 1、Delete 0 内完成：contracts 承载 digest DTO；platform 三文件承载类型、digest、repository；两个 spec 复用现有 fixture；contracts index 只增加 export。无需第八个工程文件、migration、新依赖或配置修改，因此 `TASK 5 FROZEN SCOPE CONFLICT = 0`。

## 实施授权边界

本计划的代码块与 canonical fragments 是未来施工输入，不是已执行代码。只有用户外部复审通过并明确授权第 10/48 步后，才可机械写入七个目标并运行 TDD/容器验证。任何范围、接口或锁漂移先停止，不以“计划 READY”推定开发授权。
