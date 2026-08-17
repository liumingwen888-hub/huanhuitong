# 当前接口与 schema 基线

[返回索引](00-index.md)

## 数据库（V1 已存在，不改）

- `users`：`uid uuid PK DEFAULT gen_random_uuid()`；status CHECK `ACTIVE/RESTRICTED/SUSPENDED/CLOSED`。
- `memberships`：`UNIQUE (uid)`；FK → users ON DELETE RESTRICT；status CHECK。
- `identity_profiles`：`uid uuid PK`；username/display_name 快照可空；FK → users。
- `channel_bindings`：`channel_type` CHECK 固定 `'TELEGRAM'`；`external_user_id` CHECK 1–255；status CHECK `PENDING/ACTIVE/REVOKED/CONFLICTED`；revocation CHECK（REVOKED 必有 revoked_at）；**部分唯一索引 `uq_channel_bindings_active_external (channel_type, external_user_id) WHERE status='ACTIVE'`**——双有效绑定的最终防线。
- `registration_idempotency`：`registration_key uuid PK`；status CHECK 含 FAILED/CONFLICT 的严格 NULL/时间组合；`ix_registration_uid` 部分索引。
- 权限：`xht_platform` 对 users/memberships/identity_profiles/channel_bindings SELECT+INSERT+UPDATE，registration_idempotency SELECT+INSERT+UPDATE（以 V1 GRANT 为准）；worker 只读绑定。

## 工程接口（已验证）

- Task 4 `TransactionContext`/`UnitOfWork`：所有写方法显式接收 context；错误经 UoW 包装（`TRANSACTION_CALLBACK_FAILED`，无 cause——Task 6 已裁决断言模式为包装码+DB 不变量）。
- Task 6 `OutboxEnvelopeV1` 与 `PostgresOutboxRepository.enqueue`：identity 事件（UidCreatedV1）将在 Task 8/10 编排时经同一事务写入 Outbox；本计划只定义事件类型。
- Task 5 输入解析模式：Proxy 前置拒绝、精确 prototype、own data-property、服务端派生键——identity DTO 解析沿用同一套防御。

## 命名裁决

- `channel_type` 在数据库为大写 `'TELEGRAM'`，合同层 `ChannelType` 为小写 `'telegram'`——repository 层负责映射，合同层不见大写形式。
- `externalUserId` 十进制字符串（Telegram user.id 上限 2^52-1，字符串承载）；`username` 可空且仅作快照，绝不参与身份解析。
