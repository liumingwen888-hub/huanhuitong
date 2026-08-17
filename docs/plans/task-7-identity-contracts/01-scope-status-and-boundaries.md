# 范围与状态

[返回索引](00-index.md)

## 目标

1. 渠道无关的身份合同：`Uid`（品牌字符串）、`ChannelType`（本阶段仅 `'telegram'`）、`ResolveOrCreateUidCommand/Result`、`UidCreatedV1`/`TelegramUserSeenV1` 版本化事件。
2. identity 领域类型与仓储：`IdentityRepository`（findActiveBinding/createUser/createMembership/upsertProfileSnapshot/createActiveBinding，全部显式接收 `TransactionContext`）与 `RegistrationIdempotencyRepository`（tryAcquire/complete/findCompleted）。
3. 服务端派生 registrationKey：`registration:v1:telegram:start:<externalUserId>` 的确定性 UUID（v5），调用者不可注入（F-10）；长度与来源校验失败关闭。
4. 数据库约束即最终防线：有效绑定唯一由部分唯一索引 `uq_channel_bindings_active_external` 保证；registration_idempotency 的 NULL 组合 CHECK 由表约束拒绝。
5. identity 模块零 Telegram 依赖：`apps/platform/src/modules/identity` 内 `grammy|Update|Chat|Message` 引用为 0（Step 5 重构检查）。

## 当前状态

- 第 12/48 步：`COMPLETED / EXTERNAL REVIEW PASS`；Tasks 1–6 VERIFIED。
- 第 13/48 步：`IN_PROGRESS`；本计划 `READY v1.0 / WAITING_EXTERNAL_REVIEW`；Task 7 代码 `NOT_STARTED`；第 14/48 步 `NOT_STARTED`。

## 明确排除

- ResolveOrCreateUid 并发编排与 `/start` 用例（Task 8/10）。
- Telegram adapter 与 HTTP（Task 9）。
- migration/schema 修改（V1 已含全部身份表；如发现缺口停止并申请）。
- 资金、账本、资产对象：identity 注册不创建任何资金对象（总计划 Global Constraints）。
- Git、外部服务、依赖/锁修改。

## 失败场景（必须测试）

调用者注入 registrationKey；命名空间/主体不一致；SQL 非法 NULL 状态组合通过；identity 导入 Telegram 类型；一个有效绑定映射多个 UID。
