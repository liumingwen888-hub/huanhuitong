# Telegram 可行性核验

状态：7/7 指定官方 URL 已于 2026-07-19T11:59:15-07:00 实际访问；RECHECK_REQUIRED：0。具体交互细节 DRAFT。交付状态：DESIGNING。

## 证据状态

完整 URL、页面标题/章节、访问时间、直接支持程度和解释限制记录在 [source-register.md](source-register.md)。外部事实核验只证明 Telegram 能力边界，不证明本项目已实现相应功能。

## 已核验能力与限制

1. [Bots 官方介绍](https://core.telegram.org/bots/) 直接说明 Bot 不能主动发起与用户的对话。因此未注册收款不能依赖 Bot 主动通知，必须由付款人分享领取深链，收款人主动启动 Bot。
2. [Bot Features / Deep Linking](https://core.telegram.org/bots/features#deep-linking) 直接给出允许字符与 64 字符上限；[Deep links / Bot links](https://core.telegram.org/api/links#bot-links) 直接给出最多 64 个 base64url 字符及用户触发语义。领取令牌的高熵、一次性和隐私要求是本项目控制，不是 Telegram 自动保证。
3. [KeyboardButtonRequestUsers](https://core.telegram.org/bots/api#keyboardbuttonrequestusers) 直接说明 request_users 仅适用于私聊并通过 users_shared 返回候选；[SharedUser](https://core.telegram.org/bots/api#shareduser) 直接说明 Bot 未必能访问该 user_id。因此该能力只能帮助选择候选，不能证明收款人已绑定、可联系或拥有平台 UID。
4. [Bot Features / Inline Requests](https://core.telegram.org/bots/features#deep-linking) 直接说明 inline mode 让用户从任意聊天输入 Bot username、选择结果并主动发送。结合 Bot 不能主动发起会话的官方限制，本项目推论：inline mode 只改变分享入口，不改变陌生用户联系限制。
5. [Bot API](https://core.telegram.org/bots/api) 与 [setWebhook](https://core.telegram.org/bots/api#setwebhook) 直接说明非 2xx 会重试、secret_token 通过 X-Telegram-Bot-Api-Secret-Token 请求头传递。因此入口必须验证请求头并以 Update ID/业务键幂等；官方没有承诺固定重试次数。
6. Telegram username 是可选展示字段且可能变化；平台必须以稳定 user.id 做渠道绑定，再解析为内部 UID。

## 产品采用

- APPROVED：/start 幂等自动注册；不显示注册/登录双入口；未注册收款使用领取链接；Webhook 使用 secret token 与 Inbox 去重。
- DRAFT：收款候选优先级建议为已绑定平台搜索、平台 UID、原生用户选择、内联/普通分享领取链接。任何候选在付款前都必须解析为平台 UID 或转为领取流程，并展示明确确认信息。
- 禁止：仅凭 SharedUser 或 username 完成不可逆内部转账；在 start 参数放可枚举或敏感数据；假设消息发送等于资金成功。

## 后续实现验证

阶段 1 需在 Telegram 测试 Bot 中验证 grammY 对 Update、UsersShared、callback_query 和 start 参数的实际解析，并覆盖重复 Webhook、陈旧按钮、并发会话和通知限流。该验证需要用户批准外部连接后才能执行。

官方来源访问证据见 [source-register.md](source-register.md)。本次 7 项全部成功，无 RECHECK_REQUIRED；未来官方页面或 Bot API 版本变化时仍需重新核验。
