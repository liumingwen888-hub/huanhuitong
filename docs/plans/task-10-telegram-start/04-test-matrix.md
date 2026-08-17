# 测试矩阵

[返回索引](00-index.md)

编号 T10C01 起连续唯一。

## platform database（handle-telegram-start.integration.spec.ts）

| ID | 合同 |
|---|---|
| T10C01 | 首次 processed：Inbox PROCESSED、users/memberships/bindings 各 1、uid-created 1 条、menu-requested 1 条，全部同事务 |
| T10C02 | 同 payload 重复 → duplicate_same_payload，四表零新增 |
| T10C03 | 异 payload 冲突 → conflict，身份/Outbox 零效果，原 Inbox 行不变 |
| T10C04 | retained key 缺失 → digest_key_unavailable，身份/Outbox 零写入，Inbox 不标 PROCESSED |
| T10C05 | markProcessed 强制失败（预占租约）→ 整事务回滚：users/memberships/bindings/outbox 全 0 |
| T10C06 | 回滚后重入 → 收敛为 processed（新租约代次） |
| T10C07 | 已注册用户再发 /start → processed created=false，仅 telegram-user-seen + 菜单，无第二个 UID |
| T10C08 | command 含敏感键/Proxy → 解析拒绝，数据库触达 0 |

## worker unit（telegram-main-menu.handler.spec.ts）

| ID | 合同 |
|---|---|
| T10C11 | Recording Gateway 收到 mainMenuV1 精确内容，幂等键=eventKey |
| T10C12 | Gateway 抛 TRANSIENT → applyFailure(TRANSIENT)；抛 PERMANENT → 死信分类 |
| T10C13 | 禁用状态：handler 不注册；残留 topic 一次 CAS 到 WAITING_CONFIGURATION；连续 runOnce 数据库写入 0、日志 0 |
| T10C14 | menu payload 不含 chatId/updateId/正文/Secret 哨兵（allowlist 断言） |
| T10C15 | close() 释放 Gateway/连接，无残留 |
