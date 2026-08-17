# 测试矩阵

[返回索引](00-index.md)

编号 T9C01 起连续唯一；两个 spec 均属 unit 项目（`apps/platform/test/http/`，vitest 已含该 glob），零网络。

## telegram-webhook.contract.spec.ts（supertest 全链路）

| ID | 合同 |
|---|---|
| T9C01 | 缺失/错误/多值/非法字符/超长 Secret → 401，handler 零调用 |
| T9C02 | 非 JSON content-type → 415 |
| T9C03 | >256 KiB body → 413 |
| T9C04 | 畸形 envelope（非对象/非法 update_id）→ 400，零副作用 |
| T9C05 | 照片/贴纸/服务消息/callback query → 200 ignored，handler 零调用 |
| T9C06 | 非私聊或无 from → 200 ignored |
| T9C07 | 私聊非 `/start` 文本 → 200 ignored: not-start |
| T9C08 | `/start` 与 `/start param` → 200，stub 收到 DTO（含 startParameter）且不收到 raw Update 字段（无 message 对象） |
| T9C09 | digest 调用收到的是 JSON parser 的同一对象引用（identity 断言）；keyring 解析失败 → 503 零副作用 |
| T9C10 | 伪造 X-Forwarded-Proto 直连 → 400 HTTPS_REQUIRED；受信代理配置下合法放行 |
| T9C11 | 错误响应不含 header/body 回显与 Secret 材料 |

## grammy-webhook.adapter.spec.ts

| ID | 合同 |
|---|---|
| T9C12 | BotInfo 为注入值；任何 getMe/网络调用使测试失败（禁网 client 断言调用 0） |
| T9C13 | `bot.start` 字面量在 adapter 源码中出现 0 次（静态断言） |
| T9C14 | mapper 输出 `ParsedTelegramStartUpdate`/`IgnoredTelegramUpdate`；identity 与 reliability 源码 grammY import 为 0 |
| T9C15 | adapter 处理后释放资源；app.close() 后无残留监听 |
