# 范围与状态

[返回索引](00-index.md)

## 目标

1. `ResolveOrCreateUid.execute(transaction, command)`：在调用方提供的单一 `TransactionContext` 内完成"查找有效绑定 → 未命中则幂等竞争创建 → 发身份 Outbox 事件"全链路。
2. 并发同一 Telegram 主体只产生一个 UID、Membership、有效绑定、注册幂等行和一条 `UidCreatedV1`；输家读取 COMPLETED 记录返回同一 UID（created=false）。
3. `IdentityIdFactory`（eventId UUID）注入；`deriveRegistrationKey` 复用 Task 7 服务端实现，编排层私有，公共 DTO 无 key。
4. 冲突默认拒绝、绝不自动合并两个有资金 UID（总计划红线）。

## 当前状态

- 第 14/48 步 `COMPLETED / EXTERNAL REVIEW PASS`；Tasks 1–7 VERIFIED。
- 第 15/48 步 `IN_PROGRESS`；本计划 `READY v1.0 / WAITING_EXTERNAL_REVIEW`；Task 8 代码 `NOT_STARTED`；第 16/48 步 `NOT_STARTED`。

## 明确排除

- Telegram HTTP/Webhook（Task 9）；`/start` 编排与主菜单 Outbox payload（Task 10）。
- 强并发屏障测试（Task 13）；audit_events 写入（本 Task 不写）。
- migration、资金/账本对象、worker、依赖/锁修改、Git、外部服务。

## 失败场景（必须测试）

先查后插竞态；不同可信主体共享 key；调用者覆盖 key；冲突绑定被自动合并；失败留下半注册或重复 UidCreated；赢家回滚后输家重复执行；在已失败 PostgreSQL 事务中捕获 23505 后继续写。
