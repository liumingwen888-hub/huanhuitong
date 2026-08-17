# 范围与状态

[返回索引](00-index.md)

## 目标

1. NestJS + grammY 的 `POST /webhooks/telegram` 入口，默认拒绝边界：HTTPS/代理信任 → Secret（constant-time）→ content-type → 256 KiB body → 最小 envelope。
2. Update 分类：畸形 envelope 400；合法但不支持（照片/贴纸/服务消息/callback/非私聊/无 from/非 start）一律 200 `ignored` 且零副作用；有效私聊 `/start` → 最小 DTO + Task 5 digest 集合交业务。
3. 完整 parsed Update（JSON parser 原对象）直接传 Task 5 `digestTelegramUpdate(update, keyring)`；raw Update 不进 command/日志/trace/Outbox。
4. grammY 只存在于 adapter：BotInfo 注入、`webhookCallback` 接线、永不 `bot.start()`/`getMe`；测试禁网。
5. keyring 不可解析或 Task 5 返回 `digest_key_unavailable` → 503，零身份/Outbox 效果，Inbox 不标 PROCESSED。

## 当前状态

- 第 16/48 步 `COMPLETED / EXTERNAL REVIEW PASS`；Tasks 1–8 VERIFIED。
- 第 17/48 步 `IN_PROGRESS`；本计划 `READY v1.0 / WAITING_EXTERNAL_REVIEW`；Task 9 代码 `NOT_STARTED`；第 18/48 步 `NOT_STARTED`。

## 明确排除

- `/start` 业务编排、身份事务与主菜单 Outbox（Task 10 注入；本 Task recording stub）。
- Inbox 认领/事务写入（Task 10 串联；本 Task controller 只做分类与 digest 调用边界证明）。
- 真实 Bot Token、真实 Telegram 网络、生产部署；migration、依赖/锁修改（grammY/NestJS/supertest 已在锁内）。
- canonicalizer/canonical bytes API 的任何复制（Task 5 唯一拥有）。

## 失败场景（必须测试）

合法非文本 400（误判）；伪造代理头绕过 HTTPS；Secret 多值/非法字符/超长；body 超限；未把完整 Update 交 Task 5 digest；raw Update 入 command/日志/Outbox；缺 digest key 仍执行业务；grammY `bot.start()`/`getMe`；grammY 类型泄漏领域；端口/资源未关。
