# HTTP 门禁与 Update 分类

[返回索引](00-index.md)

## 门禁顺序（先于一切解析与业务）

1. **HTTPS/代理信任**：`trust proxy` 固定 `1`（单一受控反向代理）或精确 CIDR 列表；仅受信来源的 `X-Forwarded-Proto` 被解释；直连/非受信来源伪造头不得令 `request.secure=true`，违者 400 `HTTPS_REQUIRED`。
2. **Secret header**（`x-telegram-bot-api-secret-token`）：恰好一个字符串、字符集 `[A-Za-z0-9_-]`、1–256 长度；缺失/多值/数组/控制字符/超长 → 401。比较用 `timingSafeEqual` 且长度先比对；错误响应只含稳定码，不回显任何 header/body。
3. **Content-Type**：非 `application/json` → 415。
4. **Body 上限**：`createPlatformApp` 固定 JSON body limit `256kb`；超限 413。
5. **最小 envelope**：对象、合法十进制 `update_id`、至多一个受支持顶层分支；畸形才 400。字段超限属 adapter 安全上限时 ignored/413，不得把合法 update 类型误判为畸形（F-07）。

## Update 分类（Zod 最小 envelope，passthrough 保完整字段）

| 输入 | 结果 |
|---|---|
| 无 `message` 分支（callback/service 等） | 200 ignored: unsupported-update |
| 非私聊 chat 或无 `from` | 200 ignored: unsupported-chat-or-user |
| 私聊但无 text（照片/贴纸） | 200 ignored: unsupported-update |
| text 非 `/start` 前缀 | 200 ignored: not-start |
| 私聊 `/start [param]` | `ParsedTelegramStartUpdate` DTO |

- `telegramDecimalId`：数字或字符串十进制，**输出恒为 string**（禁 32 位整数承载）。
- DTO 字段按总计划 Step 3 原文（kind/updateId/messageId/externalUserId/chatId/username/displayName/startParameter）；displayName 为 first+last join。
- 完整 parsed Update 原对象在 controller 短作用域直接传 `digestTelegramUpdate(update, keyring)`——测试以对象身份（`toBe`/同引用）断言，不复制 Task 5 算法。

## keyring 失败路径

- Task 2 keyring 解析失败 → 稳定错误类别日志 + 503，零副作用。
- Task 5 digest 返回 `digest_key_unavailable` → 503（Task 10 层面不执行身份/Outbox；controller 映射）。两路径均不标 Inbox PROCESSED。
