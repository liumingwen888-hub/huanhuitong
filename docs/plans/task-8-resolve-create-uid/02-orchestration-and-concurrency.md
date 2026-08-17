# 编排算法与并发语义

[返回索引](00-index.md)

## execute 流程（单一 TransactionContext）

```
1. findActiveBinding(channel, externalUserId)
   ├─ 命中 → upsertProfileSnapshot(快照更新) → TelegramUserSeenV1 → outbox.enqueue → {created:false}
   └─ 未命中 ↓
2. registrationKey = createRegistrationKey(channel, externalUserId)   // Task 7 服务端派生
3. tryAcquire (INSERT ... ON CONFLICT DO NOTHING RETURNING)
   ├─ acquired → createUser → createMembership → upsertProfileSnapshot
   │             → createActiveBinding → registrations.complete(key, uid)
   │             → UidCreatedV1 → outbox.enqueue → {created:true}
   └─ 未获得（已有行）→ findCompleted
       ├─ COMPLETED（赢家已提交）→ TelegramUserSeenV1 → outbox.enqueue → {created:false, 同 UID}
       └─ PROCESSING（赢家在途）→ 本事务提交零写入，返回 IN_PROGRESS 稳定结果（调用方重入整个 UoW）
```

裁决：总计划骨架中"未获得即查 COMPLETED"细化为三分支——`completed` 直接复用；`in_progress` 本事务零写入返回稳定 `IDENTITY_REGISTRATION_IN_PROGRESS`（retryable=true 语义由上层 UoW 重入实现）；不允许在别人 PROCESSING 时等待或抢行。

## 并发正确性论证

- 竞争入口是 `registration_key uuid PRIMARY KEY` 的 `ON CONFLICT DO NOTHING`：两个并发事务同 key 只有一个 INSERT 成功，由数据库唯一性裁决，无先查后插窗口。
- 输家在 `tryAcquire` 0 行后读同 key 行：READ COMMITTED 下 SELECT 看到的是已提交版本；赢家未提交时输家读到 PROCESSING（零写入退出），赢家回滚后输家重入可成为拥有者——不需要捕获 23505 续写（禁止）。
- 第二防线：`uq_channel_bindings_active_external` 部分唯一索引保证即使幂等行缺失也不会出现双有效绑定。
- 事件唯一性：`uq_outbox_topic_event_key`（topic,event_key）唯一——`uid-created:<uid>` 与 `telegram-seen:<sourceMessageId>` 各自天然幂等，重复入队被拒（UoW 回滚，调用方重入后走命中分支）。

## 事务边界

- 编排不自开事务、不发 Telegram、不写 audit_events、不触碰资产/账本（Step 重构检查项）。
- Outbox 失败（如唯一冲突）→ 整个事务回滚 → users/memberships/bindings/registration 行数全 0（测试断言）。
- 所有时间戳来自数据库 `clock_timestamp()`；事件 `occurredAt` 取命令输入（adapter 已验证的原始时间）。

## 仓储层补充校验（Task 7 已有，本计划重申）

`tryAcquire` 前校验 key 的命名空间、channel、subject 与独立列一致；不一致返回 CONFLICT 语义错误，不创建不合并。
