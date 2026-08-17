# Outbox 租约、CAS 与投递语义

[返回索引](00-index.md)

## enqueue（platform 侧）

```ts
enqueue(tx: TransactionContext, envelope: OutboxEnvelopeV1): Promise<string>
```

- 与业务效果共用同一 `TransactionContext`，业务回滚则 Outbox 行不存在（原子）。
- 重复 `(topic, event_key)` 由 `uq_outbox_topic_event_key` 拒绝；调用方传入已有 event_key 的重复入队得到稳定 `OUTBOX_DUPLICATE_EVENT_KEY`（违反唯一约束映射，不裸抛 DB 错误）。
- `version` 恒为 1；`payload` 为 JSON 安全对象；入队前经 payload 边界检查（见 05）。

## claimBatch（worker 侧）

单条短事务 SQL（Kysely 或受控 CTE）：

1. `SELECT ... FROM outbox_messages WHERE status='READY' AND available_at <= clock_timestamp() ORDER BY created_at, outbox_id LIMIT :n FOR UPDATE SKIP LOCKED`。
2. 对选中行原子 `UPDATE` 置 `LEASED`、`locked_by=:workerId`、`lease_token=gen_random_uuid()`、`lock_generation=lock_generation+1`、`locked_until=clock_timestamp()+:lease`、`attempt_count=attempt_count+1`。
3. 提交后处理器执行期间不持有任何数据库锁。
4. 租约到期重领：`status='LEASED' AND locked_until <= clock_timestamp()` 同样进入领取集，走同一 UPDATE（代次递增使旧 worker 凭证失效）。

时间源：领取与过期判断全部使用 PostgreSQL `clock_timestamp()`，与 Task 5 T5R-02 裁决一致（不把 `locked_until` 往返 JS Date 后做相等 CAS）。

## 确认/失败/续租 CAS

`markSucceeded`、`applyFailure`、`extendLease` 的 UPDATE 必须同时满足：

```
outbox_id = :id AND locked_by = :workerId AND lease_token = :leaseToken
AND lock_generation = :lockGeneration AND status = 'LEASED'
```

受影响行数 = 1 才算成功；0 行返回稳定 `OUTBOX_STALE_LEASE`，调用方不得重试确认（消息可能已被新 worker 领取并处理）。`markSucceeded` 置 `SUCCEEDED + succeeded_at=clock_timestamp()` 并清空租约三字段（满足 ck_outbox_lease/succeeded CHECK）。

## at-least-once 语义与重复风险运营说明

- 本地 SUCCEEDED 不再领取（领取查询排除）。
- 外部副作用成功、本地 `markSucceeded` 提交前崩溃：重启后租约到期重领、重投——这是设计行为，不是缺陷。
- 接收方幂等键 = `eventKey`/`outbox_id`（未来 Telegram 发送走 `correlation_id` 关联）；不支持幂等的外部能力必须在其批准的补偿流程中处理重复，并记录关联 ID 进入运营审计。
- 禁止在文档或代码注释中宣称 Exactly Once。

## 领取互斥与可观测性

- `SKIP LOCKED` + 唯一约束保证并发 worker 互斥；并发同批领取测试必须用独立连接真实并发（不顺序循环替代）。
- `OutboxRunResult { claimed, succeeded, retrying }` 是 runOnce 唯一汇总输出；日志只允许白名单汇总字段，禁止逐条输出 payload。
