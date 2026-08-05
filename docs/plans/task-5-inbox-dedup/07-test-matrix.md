# 测试矩阵

[返回索引](00-index.md)

所有 ID 在两个未来 spec 中连续且全局唯一。unit 使用 T5C01–T5C24；真实 PostgreSQL database 使用 T5C25–T5C50。任何 filter 必须同时核对实际 matched ID/数量；`exit 0 + matched 0` 判失败。

## Unit：T5C01–T5C24

| ID | 合同 |
|---|---|
| T5C01 | 固定 0x02 key / v2 /完整 Update 得到指定 canonical HMAC 向量与格式 |
| T5C02 | 根及嵌套 object key 顺序不同摘要相同 |
| T5C03 | array 顺序变化摘要不同 |
| T5C04 | string 空白、大小写和转义不 trim/不改写 |
| T5C05 | NFC/NFD 字符串不自动归一化 |
| T5C06 | parsed number 最短形式与 -0→0；有限数可摘要 |
| T5C07 | null/boolean 精确保留 |
| T5C08 | object property undefined 稳定拒绝且不省略 |
| T5C09 | array undefined 稳定拒绝且不转 null |
| T5C10 | sparse、命名 own property、`4294967295` 越界属性和 accessor array 全部稳定拒绝；getter 0 次、增强数组无有效 digest |
| T5C11 | NaN/Infinity/bigint/function/symbol value 稳定拒绝 |
| T5C12 | unknown/future field 加入或变化会改变摘要 |
| T5C13 | text/start parameter/callback/from/chat/update 类型逐项变化均改变摘要 |
| T5C14 | root 非普通对象/非 object 稳定拒绝；root、嵌套 object、嵌套 array Proxy 均 UNSUPPORTED_VALUE、trap 0、有效 digest 0、泄漏 0 |
| T5C15 | cycle 稳定拒绝，共享但非循环引用可重复写出 |
| T5C16 | getter/accessor 在未执行 getter 时稳定拒绝 |
| T5C17 | own symbol key 稳定拒绝 |
| T5C18 | current 与 retained 每版本一次，current 为写入候选 |
| T5C19 | `withMaterial` 回调同步完成，不返回 borrowed bytes |
| T5C20 | 每次 borrowed material 在 success 后清零，内部 material 未污染 |
| T5C21 | key callback throw 时 borrowed material 与 canonical chunks/final Buffer 仍清零 |
| T5C22 | digest DTO 不含 raw/canonical/material；结果与 candidate array 冻结 |
| T5C23 | dispose 后 `KEYRING_DISPOSED` 原样安全传播且无 raw 文本 |
| T5C24 | 所有公开错误/result 递归扫描 raw text、callback、digest、key material 命中 0 |

## Database：T5C25–T5C50

| ID | 合同 |
|---|---|
| T5C25 | 新消息 current digest/version 插入一行并 claimed generation 1 |
| T5C26 | 同完整 Update 重放返回 duplicate_same_payload，行数仍 1 |
| T5C27 | 同 ID 异载荷返回 conflict，原 digest/version/status/claim 不变 |
| T5C28 | 原版本 key 缺失返回 digest_key_unavailable，数据库写 0 |
| T5C29 | key rotation 后 retained v1 正确识别旧行 replay |
| T5C30 | rotation 后新 ID 只写 current v2，不写 retained |
| T5C31 | 两并发同 ID/同摘要只有一个 claimed，另一个 duplicate |
| T5C32 | 两并发同 ID/异摘要只有一个 claimed，另一个 conflict |
| T5C33 | 16 并发同 replay 最终一行、一个 claimed、15 duplicate |
| T5C34 | 既有 RECEIVED 同摘要可 claim，generation 0→1 |
| T5C35 | receivedAt 远未来不能偷取 PostgreSQL 当前仍有效 lease，行完全不变 |
| T5C36 | 数据库生成的非整毫秒过期 lease 可重领，receivedAt 远过去不能阻止，generation+1，INBOX_STATE_INVALID 0 |
| T5C37 | query evidence 明确存在数据库原始精度 `claimed_until <= database_time.value` 且旧时间相等 CAS 0；`<=→<` 静态 mutation gate；两方并发仅一个新 generation，不冒充跨事务运行时等值证明 |
| T5C38 | 当前 generation+错误 claimant、当前 claimant+旧 generation、两者旧、错误 inboxId 分别 false；整行与业务效果不变 |
| T5C39 | 伪造过去 processedAt 不能完成过期 lease；当前 lease true 后 status PROCESSED、claim 字段清空，processed_at 位于数据库 before/after 窗口 |
| T5C40 | 重复 markProcessed 返回 false，不改 processed_at/generation |
| T5C41 | PROCESSED 同摘要 replay 为 duplicate，不重开 claim |
| T5C42 | PROCESSED 异摘要 conflict 且 processed 证据不变 |
| T5C43 | 业务合成写与 markProcessed 同一 UoW 成功共同提交 |
| T5C44 | markProcessed 后 callback throw，业务写和 PROCESSED 均回滚 |
| T5C45 | stale mark false 后抛 `APPLICATION_INBOX_CLAIM_LOST`，先前业务写回滚 |
| T5C46 | 在既有 Case 内表驱动 root/digests/candidates/candidate/lease/Date Proxy、candidate index accessor、sparse/extra/symbol candidates，以及 claim receivedAt 与 mark claimedUntil 的自有 getTime accessor/method、Date subclass：getter/method/trap/context 0，合法普通 Date 仍可解析，直接 authentic INBOX_COMMAND_INVALID，每项进入 UoW 后安全包装，递归泄漏 0 |
| T5C47 | callback settle 后 escaped TransactionContext 调 repository 得 `TRANSACTION_CONTEXT_CLOSED` |
| T5C48 | backend 终止保持精确 taxonomy；完整 runtime sentinel 矩阵与稳定公开字符串 allowlist 命中 0；failed PID 恰好一次 destroy release，后续不同健康 PID 可认领并恰好一次 normal release |
| T5C49 | information_schema 禁止 raw/body/text/callback/canonical 列为 0，唯一约束存在 |
| T5C50 | platform role 可执行合同、session/current_user 正确；worker 无新增 Inbox 权限 |

## RED 真实性

RED 不得来自 Cannot find module、fixture 未启动、Flyway 未迁移、TypeScript compile、错误 Vitest project、空 filter 或环境故障。施工先机械写入七个 canonical 文件，使所有 import/fixture/类型可收集，再对两个生产函数施加计划内精确单点 RED delta：

1. digest delta：固定向量的 digest 最后一个字符替换为不同字符，仅 T5C01 失败；恢复 canonical 后 T5C01 通过。
2. repository delta：新插入成功返回的 `reclaimed: false` 临时改为 `reclaimed: true`，类型、SQL、fixture 与 insert 均保持有效，仅 T5C25 行为断言失败；恢复 canonical 后 T5C25 通过。

每个 delta 必须替换命中 1、RED 连续运行两次、唯一失败 ID/断言相同、environment/collection/type error 0；恢复后目标文件 SHA-256 必须回到 canonical manifest。此证据是未来 Task 5 实施 TDD，不是本第 9 步已执行结果。

## 过滤器与数量门禁

- Unit 全集：`T5C(0[1-9]|1[0-9]|2[0-4]):`，matched 24。
- Database 全集：`T5C(2[5-9]|[34][0-9]|50):`，matched 26。
- 总集合：T5C01–T5C50，duplicate 0、missing 0。
- 每条聚焦命令还要 parse 实际 ID；过宽 `T5C` 不能替代精确集合门禁。
