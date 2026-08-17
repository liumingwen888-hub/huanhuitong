# 持久任务状态机与错误分类

[返回索引](00-index.md)

## DurableJobRepository

```ts
enqueue(jobType: string, businessKey: string, payload: object): Promise<string>
```

- `(job_type, business_key)` 唯一；重复入队返回稳定 `JOB_DUPLICATE_BUSINESS_KEY`。
- 与 Outbox 不同，durable job 由 worker 侧编排长期任务；`job_id` 由数据库默认生成。

## 状态机

```
READY ─claim→ LEASED ─成功→ SUCCEEDED（终态）
 │              │瞬时错误→ RETRY_WAIT ─available_at 到期→ READY
 │              │永久错误→ DEAD_LETTER（终态，运营处理）
 │              │配置禁用→ WAITING_CONFIGURATION ─配置变更事件→ READY
 └─运维→ PAUSED（本 Task 只定义状态，不建运维入口）
```

合法转换表（其余组合非法，UPDATE 的 WHERE 必须含当前状态条件）：

| 从 | 到 | 触发 |
|---|---|---|
| READY | LEASED | claim（代次+1、attempt+1） |
| LEASED | SUCCEEDED | markSucceeded CAS |
| LEASED | RETRY_WAIT | applyFailure(TRANSIENT) CAS + 退避 available_at |
| LEASED | DEAD_LETTER | applyFailure(PERMANENT) 或退避次数耗尽 CAS |
| LEASED | WAITING_CONFIGURATION | applyFailure(DISABLED) CAS |
| RETRY_WAIT | READY | available_at <= clock_timestamp() 时可领取 |
| WAITING_CONFIGURATION | READY | 显式配置变更事件（不是轮询） |
| LEASED（过期） | LEASED（新代次） | 到期重领，旧凭证失效 |

## 错误分类

`classifyWorkerError(error)` 只产生三类：`TRANSIENT`、`PERMANENT`、`DISABLED`。

- 分类依据稳定错误码/哨兵接口，不 `String(error)` 匹配，不序列化原始错误对象。
- 未知错误默认 `TRANSIENT`（失败关闭方向为重试而非丢失），由有界退避兜底。

## 退避参数（F-06 裁决）

- base 1 秒、cap 15 分钟、全抖动（`delay = random(0, min(cap, base*2^attempt))`）、最多 8 次瞬时重试；第 9 次瞬时失败进入 DEAD_LETTER。
- 抖动随机源由注入 PRNG 提供（测试可确定性控制）。
- 配置禁用（DISABLED）不是瞬时故障：进入 `WAITING_CONFIGURATION` 后 worker 的领取查询排除该状态，且**不轮询写库、不刷日志**；恢复只走显式配置变更事件。

## Worker 生命周期

`create-worker.ts` 组装：配置 → logger/telemetry（Task 2 生命周期）→ OutboxWorker + DurableJobWorker（时钟、workerId、PRNG 注入）→ 受控 shutdown（停止领取、等待在途 handler、释放连接）。`main.ts` 只做启动接线。外部 Gateway 禁用时 handler 不注册（F-06），worker 空转不产生副作用。
