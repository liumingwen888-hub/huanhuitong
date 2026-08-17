# 测试矩阵

[返回索引](00-index.md)

编号 T7C01 起连续唯一。

## Unit（identity-contract.spec.ts）

| ID | 合同 |
|---|---|
| T7C01 | 合同类型接受字符串 externalUserId 与 null username（总计划 Step 1 原文） |
| T7C02 | createRegistrationKey 确定性：同输入同 UUID；不同 externalUserId 不同 UUID |
| T7C03 | registrationKey 派生含完整命名空间前缀；命令对象无 key 注入字段（结构断言） |
| T7C04 | DTO 解析：Proxy/自有 accessor/非字符串 ID/超长 username → IDENTITY_COMMAND_INVALID，触达 0 |
| T7C05 | externalUserId 非零开头十进制、≤19 位；非法值拒绝 |
| T7C06 | 事件 type 字面量与字段冻结 |

## Database（identity-constraints.integration.spec.ts）

| ID | 合同 |
|---|---|
| T7C11 | 双有效绑定同 (channel_type, external_user_id) → 23505（总计划 Step 1 原文） |
| T7C12 | 同一 UID 多个绑定行允许（历史换绑），但每 (channel, external) 只一条 ACTIVE |
| T7C13 | REVOKED 无 revoked_at 被表 CHECK 拒绝；非 REVOKED 带 revoked_at 拒绝 |
| T7C14 | memberships 第二行同 uid → 唯一约束拒绝 |
| T7C15 | FK：绑定指向不存在 uid 拒绝 |
| T7C16 | registration_idempotency FAILED 带 uid → CHECK 拒绝；COMPLETED 带 failure_code 拒绝（按表约束逐组合） |
| T7C17 | tryAcquire 首次 acquired、二次 in_progress、complete 后 completed |
| T7C18 | findCompleted 回读 uid 与写入一致 |
| T7C19 | upsertProfileSnapshot 二次调用更新快照列不产生第二行 |
| T7C20 | identity 模块源码 grammy/Update/Chat/Message 引用 0（静态断言，读取 dist 或 src） |
| T7C21 | platform LOGIN 无 DROP/DELETE；worker LOGIN 对 channel_bindings 只读（正反权限） |
