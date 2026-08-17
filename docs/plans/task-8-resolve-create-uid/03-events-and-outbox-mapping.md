# 事件工厂与 Outbox 映射

[返回索引](00-index.md)

## identity-event-factory.ts

```ts
interface IdentityIdFactory {
  newEventId(): string;   // randomUUID 注入
}
createUidCreatedV1(ids, { uid, bindingId }, command): UidCreatedV1
createTelegramUserSeenV1(ids, binding, command): TelegramUserSeenV1
```

- 事件对象 `Object.freeze`；字段严格按 contracts 类型；不含 username/displayName（快照留在 identity_profiles，不进事件流）。
- `occurredAt` 取 `command.occurredAt`；`correlationId` 取命令值（未来来自 Inbox claim）。

## Outbox 映射

| 事件 | topic | event_key |
|---|---|---|
| UidCreatedV1 | `identity.uid-created.v1` | `uid-created:<uid>` |
| TelegramUserSeenV1 | `identity.telegram-user-seen.v1` | `telegram-seen:<sourceMessageId>` |

- envelope：`id = eventId`、`payload = 事件对象本身`（通过 Task 6 敏感键扫描——事件字段天然合规）、`correlationId = command.correlationId`、`occurredAt = command.occurredAt`。
- Webhook 路径把 `update_id` 作为 `sourceMessageId`（Task 9 对接前提，本计划固定该约定）。
- payload 不含完整 Update、消息正文、Bot Token（Task 6 扫描兜底 + 事件工厂结构保证）。

## username 语义

username 仅进 `identity_profiles.username_snapshot`；变化时更新快照、UID 不变、`telegram-user-seen` 事件照发（记录一次可见性）。空 username 合法（null 快照）。
