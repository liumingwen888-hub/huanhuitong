# Inbox 认领、冲突、租约与 CAS 合同

[返回索引](00-index.md)

## 命令合同

`InboxClaimCommand` 必须包含：consumer（1–100）、externalMessageId（1–255）、完整 `InboxDigestSet`、真实 UUID correlationId、claimant（1–128）、receivedAt（有限 Date，仅接收元数据）。固定租约 `INBOX_CLAIM_LEASE_MILLISECONDS = 30_000`。repository 在读取任何 context 成员前按 unknown 做完整运行时解析：null/undefined/wrong type/缺字段/畸形 digests/candidate/array/Date 均抛真实 `InboxRepositoryError('INBOX_COMMAND_INVALID')`，错误不包含原值；UoW 依 Task 4 safe-cause 合同包装而不公开此内部 cause。所有 object 在 prototype/descriptor/array/Date 观察前先用 `isProxy` 拒绝；`comparisonCandidates` 只按 own descriptors 接受精确 dense data array，拒绝 sparse、accessor、extra、symbol、非枚举 index 和 Proxy，getter/trap/context touches 全为 0。

## 精确返回联合

```ts
export type InboxClaimResult =
  | {
      readonly kind: 'claimed';
      readonly inboxId: string;
      readonly lease: InboxClaimLease;
      readonly reclaimed: boolean;
    }
  | {
      readonly kind: 'duplicate_same_payload';
      readonly inboxId: string;
      readonly status: InboxTerminalOrOwnedStatus;
    }
  | {
      readonly kind: 'conflict';
      readonly inboxId: string;
    }
  | {
      readonly kind: 'digest_key_unavailable';
      readonly inboxId: string;
      readonly requiredKeyVersion: InboxDigestKeyVersion;
    };
```

- `claimed` 是唯一允许调用未来业务用例的结果；包含 inboxId、claimant、generation、claimedUntil。
- `duplicate_same_payload` 表示没有获得新 lease，不执行业务效果；status 告知 RECEIVED/CLAIMED/PROCESSED/CONFLICT/FAILED 的当前安全类别，不返回摘要。
- `conflict` 表示同 key 不同完整 Update；不返回或记录任一 digest。
- `digest_key_unavailable` 只返回所需非秘密版本号；不尝试其他 key、不产生效果。

## 新行

在调用方已有 Task 4 UoW 内执行 `INSERT ... ON CONFLICT DO NOTHING`。新行只用 current candidate，直接写合法 CLAIMED 状态：claim_generation=1、claimed_by=command.claimant、`claimed_until=clock_timestamp()+interval '30 seconds'`、failure_code/processed_at null。receivedAt 只写 received_at 元数据，不参与权限。直接 CLAIMED 避免暴露一个无所有者的已提交 RECEIVED 窗口；repository 仍支持既有 RECEIVED 行。

## 已有行与行锁

插入未返回时，在同一 `TransactionContext.database`、同一 connection/transaction 上按唯一键 `SELECT ... FOR UPDATE`。PostgreSQL unique conflict 会等待竞争事务裁决；读取不到行属于稳定 `INBOX_ROW_DISAPPEARED`，不得循环、换连接或推断 duplicate。

1. 先按原行 `digest_key_version` 找唯一 candidate；缺失立即 `digest_key_unavailable`。
2. 将两个固定格式 digest 转为等长 Buffer，使用 `timingSafeEqual`，随后清零比较 Buffer。
3. 不相等返回 `conflict`，数据库写 0。
4. 相等且 RECEIVED：在同一 connection 的参数化 CTE 中取得一次 `clock_timestamp()`，以 inboxId/status/generation/null-owner 条件更新到 CLAIMED；generation+1，expiry=`database_time.value+30s`，返回数据库生成的 generation/claimed_until，`reclaimed=false`。
5. 相等且 CLAIMED：在 `FOR UPDATE` 后用同一 connection 的参数化 CTE 取得一次 `clock_timestamp()`；WHERE 保留 inboxId/status/generation/原 claimant，并以数据库原始精度执行 `claimed_until <= database_time.value`；同一 `database_time.value+30s` 写新 expiry并返回 generation/claimed_until，`reclaimed=true`。禁止应用 `getTime()` 决定过期，禁止 `claimed_until = oldClaimedUntil` 时间往返 CAS；更新 0 行表示活动 lease，返回 duplicate。
6. 相等且 CLAIMED 未过期：`duplicate_same_payload`，不偷租约。
7. 相等且 PROCESSED/CONFLICT/FAILED：`duplicate_same_payload`，不重开终态。

## Conflict 不变异裁决

现有单行 schema 无法同时保留“原已处理状态”和“另一个冲突载荷”的正文/摘要。把原行改为 CONFLICT 会撤销或阻断合法原消息证据；覆盖摘要/版本更严重。因此 Task 5 的 `conflict` 是非变异分类：原 `payload_digest`、`digest_key_version`、status、correlation_id、claim、generation、processed_at、failure_code 全部保持。表内 CONFLICT/FAILED 状态保留给未来明确拥有失败写入语义的流程，本 Task 不制造它们。

## markProcessed

`markProcessed(context, { lease }): Promise<boolean>` 先在任何 context 触达前验证 lease。随后通过同一 `TransactionContext.executeSql` 执行一条参数化 CTE/UPDATE：CTE 取得 `clock_timestamp()`，WHERE 同时要求 `inbox_id`、`status=CLAIMED`、`claimed_by`、`claim_generation` 匹配且 `claimed_until > database_time.value`；SET 以同一个 `database_time.value` 写 `processed_at` 并清空 claim 字段。调用方无 processedAt 输入，伪造过去时间不能绕过 expiry。

更新 1 行返回 true；0 行返回 false。调用方必须在同一 UoW callback 内将 false 转为稳定 `PublicUnitOfWorkError('APPLICATION_INBOX_CLAIM_LOST')`，从而回滚此前业务写；不得忽略 false 后提交。T5C38 独立证明错误 claimant、旧 generation、两者同时错误及错误 inboxId 均 false 且完整行/业务效果不变；T5C39 证明完整当前 lease 仅在数据库时间仍有效时为 true。

## 状态兼容表

| 原状态 | 同摘要且 key 可用 | 异摘要 | 写入 |
|---|---|---|---|
| 无行 | claimed generation 1 | 不适用 | current digest/version + CLAIMED |
| RECEIVED | claimed generation+1 | conflict | 同摘要仅更新 claim 字段 |
| CLAIMED 未过期 | duplicate_same_payload | conflict | 0 |
| CLAIMED 已过期 | claimed generation+1 | conflict | 同摘要仅更新 claim 字段 |
| PROCESSED | duplicate_same_payload | conflict | 0 |
| CONFLICT/FAILED | duplicate_same_payload | conflict | 0 |
| 任意已有行且历史 key 缺失 | digest_key_unavailable | digest_key_unavailable | 0 |

所有路径保持 Task 3 `ck_inbox_state`；无 migration 修改。

## 微秒精度与 `<=` 合同门禁

PostgreSQL timestamptz 保留微秒，而锁定 `pg@8.22.0/postgres-date@1.0.7` 的 JavaScript Date 只保留毫秒。故 `.123456 → .123000` 的回传值不得参与 claimed_until 精确相等。T5C36 用数据库 `date_trunc('milliseconds', clock_timestamp()) - interval '1 second' + interval '456 microseconds'` seed，证明过期重领不产生 `INBOX_STATE_INVALID`；T5C37 从实际 query evidence 读取重领 SQL，要求存在精确 `claimed_until <= database_time.value`、不存在独立 `<` 与旧 claimedUntil 参数 CAS。将 `<=` 误改为 `<` 必须由该静态 SQL 合同门禁发现；本计划不再冒充跨事务运行时“精确等值”证明。
