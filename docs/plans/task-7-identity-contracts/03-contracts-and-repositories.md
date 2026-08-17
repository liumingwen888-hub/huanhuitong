# 合同与仓储设计

[返回索引](00-index.md)

## packages/contracts/src/identity.ts

按总计划 Step 3 原文：`Uid` 品牌 string、`ChannelType='telegram'`、`ResolveOrCreateUidCommand`（channelType/externalUserId/sourceMessageId/username/displayName/correlationId/occurredAt）、`ResolveOrCreateUidResult`（uid/bindingId/created/identityEvent）、`UidCreatedV1` 与 `TelegramUserSeenV1`（type/eventId/uid/bindingId/occurredAt/correlationId）。

补充裁决：

- `externalUserId` 校验 `^[1-9][0-9]{0,18}$`（非零开头十进制、≤19 位）。
- `username` 若非 null：1–64 字符；仅快照语义，字段名带 `_snapshot` 的表列作证。
- 事件 `type` 字面量固定 `'identity.uid-created.v1'` / `'identity.telegram-user-seen.v1'`。

## domain/identity.types.ts + identity.errors.ts

- DTO 解析沿用 Task 5 防御（isProxy 前置拒绝、精确 prototype、own data-property、accessor 拒绝）。
- `IdentityError` 稳定码：`IDENTITY_COMMAND_INVALID`、`IDENTITY_BINDING_CONFLICT`、`IDENTITY_USER_STATUS_INVALID`、`IDENTITY_REGISTRATION_KEY_INVALID`。
- registrationKey 派生：`createRegistrationKey(channelType, externalUserId): UUID`——`UUIDv5(namespace=固定项目命名空间 UUID, name='registration:v1:telegram:start:<externalUserId>')`；命名空间常量在实现内固定；调用者传入的任何 key 一律拒绝（命令对象不含 key 字段，从结构上杜绝注入）。

## application/identity.repository.ts（接口）

```ts
interface IdentityRepository {
  findActiveBinding(context, query: { channelType; externalUserId }):
    Promise<ChannelBindingRow | null>;
  createUser(context, status: 'ACTIVE'): Promise<Uid>;
  createMembership(context, uid: Uid): Promise<string>;
  upsertProfileSnapshot(context, uid, snapshot): Promise<void>;
  createActiveBinding(context, uid, query): Promise<string>;
}
interface RegistrationIdempotencyRepository {
  tryAcquire(context, key: RegistrationKey): Promise<'acquired'|'in_progress'|'completed'>;
  complete(context, key, uid): Promise<void>;
  findCompleted(context, key): Promise<{ uid } | null>;
}
```

所有方法单语句参数化 SQL 经 `context.executeSql`；读方法同样走 context（同事务快照一致性）。

## infrastructure/postgres-*.repository.ts

- `createActiveBinding` 直接 INSERT；并发双写由 `uq_channel_bindings_active_external` 拒绝（23505 → `IDENTITY_BINDING_CONFLICT`）。
- `upsertProfileSnapshot` 用 INSERT ... ON CONFLICT (uid) DO UPDATE 仅更新快照列与 updated_at。
- `tryAcquire`：INSERT ... ON CONFLICT (registration_key) DO NOTHING；0 行时回读 status 判定 in_progress/completed。
- channel_type 大小写映射仅在此层发生。
