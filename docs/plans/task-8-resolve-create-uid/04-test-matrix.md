# 测试矩阵

[返回索引](00-index.md)

编号 T8C01 起连续唯一，全部为真实数据库测试（`resolve-or-create-uid.integration.spec.ts`）。

| ID | 合同 |
|---|---|
| T8C01 | 首次执行 created=true，五类行各 1（users/memberships/bindings/registration COMPLETED/outbox uid-created） |
| T8C02 | 重复执行 created=false、同 UID；`identity.uid-created.v1` 恰 1 条、`telegram-user-seen` 恰 1 条 |
| T8C03 | username 变化：UID 不变、快照更新为新值 |
| T8C04 | 空 username（null）合法解析、快照列为 NULL |
| T8C05 | 强制 Outbox enqueue 失败（同 event_key 预占）：整个事务回滚，四表行数全 0 |
| T8C06 | PROCESSING 占位（预插未完成幂等行）：execute 零写入返回稳定 in-progress 结果 |
| T8C07 | 占位行清除后重入：成为拥有者，created=true，全链路一致 |
| T8C08 | 受控并发冒烟：两个独立连接同时 execute 同主体，结果恰一个 created=true，两者 UID 相同，uid-created 恰 1 条 |
| T8C09 | 编排纯度静态断言：源码无 bot API 调用、无 audit/资金表引用、无自开事务（BEGIN 字面量 0） |
| T8C10 | 不同 externalUserId 并发注册互不影响（无跨主体串扰） |
