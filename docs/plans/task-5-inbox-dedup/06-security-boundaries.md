# 安全与敏感数据边界

[返回索引](00-index.md)

## 数据分类

| 数据 | 允许位置 | 禁止位置 |
|---|---|---|
| parsed Telegram Update | HTTP→digest 的同步短作用域 | DB、cache、日志、trace、Outbox、audit、error、repository command 之外的对象字段 |
| canonical UTF-8 bytes/chunks | digest 函数局部 Buffer | 返回值、Promise、closure cache、DB、任何信号 |
| Inbox key material | Task 2 `withMaterial` 同步 callback | DTO、string、日志、错误、持久层、异步 continuation |
| payload digest | `InboxDigestSet` 短期 DTO、`inbox_messages.payload_digest` | 日志、trace、Outbox、audit、错误响应 |
| key version | digest DTO、DB、缺 key 的稳定结果 | 不与 key material 混淆；允许作为非秘密运维分类 |
| consumer/update_id/correlation/inbox_id | 按日志 policy 未来白名单扩展后才可记录 | 本 Task 不自行记录 |

## 禁止持久化

Task 3 schema 已无 raw/body/text/callback/canonical 列。Task 5 不修改 schema，不把 JSON 塞进 failure_code、correlation_id 或其他列。database integration 必须查询 `information_schema.columns`，证明 raw_update、payload、body、text、callback_data、canonical_json/bytes 等禁止列为 0。

## 日志、trace、Outbox 与 audit

Task 5 两个生产模块不导入 Pino、OpenTelemetry、Outbox 或 audit API，不创建任何日志/trace/event。错误只含稳定 code。测试对公开 result/error 做递归 own data-property string scan。T5C48 在运行时构造 externalMessageId、claimant/consumer、payload digest、raw Update、callback data、SQL/表名、SQL 参数、platform/bootstrap connection string、session username 以及从 ephemeral URL 解析的 password sentinel；每项命中 0，并以稳定字符串 allowlist 拒绝任何未批准公开值。凭证值不写 Markdown、报告、snapshot 或 console。Task 11 才扩展允许事件与标量字段，本 Task 不绕过现有安全日志 policy。

## 摘要比较与冲突

摘要不是密码，但可能成为载荷关联标识，仍按敏感派生值处理。比较使用固定长度和 `timingSafeEqual`；临时 Buffer 清零。conflict 不返回 current/retained/existing digest，不持久化第二摘要，不把冲突正文写 failure_code，也不修改原证据。

## 默认失败

- undefined/非 JSON/循环/非有限 number/accessor/非普通对象/Proxy：canonicalization 稳定失败；Proxy 必须在任何 trap/getter 触发前拒绝。
- keyring dispose/invalid：原稳定安全错误传播，不降级为未加密 hash。
- 历史 key 缺失：`digest_key_unavailable`，不尝试 current 误判。
- 畸形 command：先按 unknown、Proxy 门禁和 own descriptors 验证；Date 只接受精确 `Date.prototype`、own key 0，并以 `Date.prototype.getTime.call(value)` 读取。在 accessor/method/Proxy trap/context 触达前以真实 `INBOX_COMMAND_INVALID` 稳定失败；进入 UoW 后按 Task 4 safe-cause 白名单安全包装，不公开内部 cause。
- 状态或数据库异常：服从 Task 4 稳定分类，不返回 claimed。
- stale/expired/wrong claimant/wrong generation/wrong inboxId：markProcessed=false，调用方必须抛错回滚；expiry 只由数据库当前时间判断。
- context closed、连接失败、commit UNKNOWN：服从 Task 4，不内部重试或伪成功。

## 权限门禁

真实集成通过 platform LOGIN→`SET ROLE xht_platform` 写 Inbox；不使用 bootstrap/flyway 凭证执行 repository。worker 没有 Inbox grant，本 Task 不扩大权限。测试凭证来自 ephemeral fixture，仅存在进程内，不进入报告或 Markdown。

## 资源与供应链

实施只使用当前锁定 Node 24.18.0、pnpm 11.15.1、TypeScript 7.0.2、Vitest 4.1.10、Kysely 0.29.4、pg 8.22.0、PostgreSQL 18.4、Flyway 12.11.0、Testcontainers 12.0.4。依赖安装/升级 0；三锁必须字节不变。容器、network、TEMP、logs、coverage、dist 残留在最终门禁均为 0。

## 残余风险

- Task 5 只保证数据库内 Inbox 去重与租约；未来 Telegram HTTP 验真、请求大小和 Update schema 仍由 Task 9 完成。
- commit outcome UNKNOWN 不能由本模块判定是否处理成功；未来 orchestrator 必须查询 Inbox/业务状态，禁止盲重试。
- conflict 只返回非变异分类，当前 schema 不保存第二 payload 证据；未来如需合规冲突留痕，必须独立设计最小化审计，不得在本 Task 扩表。
- 固定 30 秒 lease 是阶段 1 初始值；真实处理耗时或续租策略需要后续容量证据和独立计划。
