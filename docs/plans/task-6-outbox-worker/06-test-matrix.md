# 测试矩阵

[返回索引](00-index.md)

测试合同编号 T6C01 起连续唯一。unit（无数据库）与 database（真实 Testcontainers）分层；并发测试必须独立连接真实并发。

## Unit（fake store/clock/PRNG）

| ID | 合同 |
|---|---|
| T6C01 | runOnce 汇总 {claimed,succeeded,retrying} 与 store 调用序列一致 |
| T6C02 | handler 抛 TRANSIENT → applyFailure(TRANSIENT)，计数 retrying |
| T6C03 | handler 抛 PERMANENT → applyFailure(PERMANENT) |
| T6C04 | handler 抛 DISABLED → applyFailure(DISABLED)，不进入退避 |
| T6C05 | markSucceeded 返回 stale_lease 时不抛错、不重试、计为 retrying 结束 |
| T6C06 | classifyWorkerError：稳定错误码三类映射；未知错误默认 TRANSIENT |
| T6C07 | 退避公式：base 1s/cap 15min/全抖动，注入 PRNG 确定性验证 |
| T6C08 | 第 8 次瞬时后第 9 次 → DEAD_LETTER 分类传递 |
| T6C09 | OutboxEnvelope payload 哨兵扫描：Proxy/accessor/敏感键拒绝，观察前零触达 |
| T6C10 | 错误对象不进入日志；白名单外字段触发 SafeLoggingError 零写入 |

## Database（真实 PostgreSQL）

| ID | 合同 |
|---|---|
| T6C11 | enqueue 与业务效果同事务：回滚后 outbox 行不存在 |
| T6C12 | 重复 (topic,event_key) → 稳定 OUTBOX_DUPLICATE_EVENT_KEY，原行不变 |
| T6C13 | claimBatch 只取 READY 且 available_at 到期；SUCCEEDED/RETRY_WAIT 未到期/WAITING_CONFIGURATION 不被领取 |
| T6C14 | 领取后行满足 ck_outbox_lease：LEASED 三字段齐、generation+1、attempt+1 |
| T6C15 | 并发两 worker 各 25 条共 50 条：总领取 50、无重叠（真实并发） |
| T6C16 | 本地 SUCCEEDED 后 runOnce claimed=0 |
| T6C17 | 错误 workerId / 旧 leaseToken / 旧 generation / 错误 outbox_id 四路 CAS 各自 0 行 → OUTBOX_STALE_LEASE，整行不变 |
| T6C18 | 租约过期后另一 worker 重领成功，代次递增，旧凭证确认被拒 |
| T6C19 | 外部成功（fake handler 记录）+ markSucceeded 前模拟崩溃 → 重启重投，handler 收到 2 次（at-least-once 证据） |
| T6C20 | 瞬时失败 → RETRY_WAIT + available_at 按抖动设置；到期后可领取 |
| T6C21 | 永久失败 → DEAD_LETTER 终态，不再领取 |
| T6C22 | DISABLED → WAITING_CONFIGURATION；连续 runOnce 数据库写入 0、日志 0（F-06） |
| T6C23 | 配置变更事件将 WAITING_CONFIGURATION → READY 后可领取 |
| T6C24 | durable_jobs (job_type,business_key) 唯一 → JOB_DUPLICATE_BUSINESS_KEY |
| T6C25 | worker LOGIN 无 outbox INSERT 权限、platform LOGIN 无 outbox UPDATE 权限（正反权限矩阵） |
| T6C26 | 非法状态转换（如 SUCCEEDED→LEASED 直接 UPDATE）被 SQL WHERE 状态条件拒绝，0 行 |
| T6C27 | enqueue payload 含敏感哨兵 → 入队前拒绝，数据库触达 0 |
| T6C28 | UNKNOWN 提交结果不触发自动重试确认（审计事件存在） |
