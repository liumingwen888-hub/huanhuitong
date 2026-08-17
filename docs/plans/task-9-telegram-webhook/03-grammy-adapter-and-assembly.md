# grammY 适配与 DI 组装

[返回索引](00-index.md)

## grammy-webhook.adapter.ts

- `new Bot<TestContext>(fakeToken, { botInfo: injectedBotInfo })`——BotInfo 注入，杜绝 `getMe` 网络调用。
- 以官方 `webhookCallback` 转 Node 中间件接入 Nest/Express；进程生命周期只注册 callback，**永不 `bot.start()`**。
- 测试注入固定 BotInfo 与禁网 client：任何 `getMe`/网络调用使测试直接失败。

## telegram-command.mapper.ts

- grammY `Context` → `ParsedTelegramStartUpdate | IgnoredTelegramUpdate`（项目自有类型）。
- identity/reliability 模块零 grammY import（dependency-cruiser 将在 Task 12 固化，本计划以静态断言先行）。

## telegram-webhook.controller.ts

```
receive(request):
  policy.check(request)            // 02 五道门禁，稳定码错误
  parsed = parseTelegramUpdate(body)
  if ignored → 200 {kind:'ignored'}
  digestSet = digestTelegramUpdate(rawUpdateObject, keyring)   // 同引用直传
  if digest 不可用 → 503 稳定码
  startHandler({ start: DTO, digestSet })    // Task 10 注入；本 Task stub
  → 200
```

- Secret/keyring 解析先于 Zod 与 UoW；controller 不记录 header/body/canonical bytes/digest 值。
- DI：`TelegramModule` 提供 verifier/policy/mapper/adapter/controller；handler 用 injection token，Task 9 绑 recording stub。

## create-platform-app.ts + main.ts

- `createPlatformApp(deps)`：Nest Factory + Express adapter、`trust proxy` 配置、body limit 256kb、挂 TelegramModule；返回 `{ app, close }`。
- `main.ts` 保持可测试组装入口，不启动真实监听（监听生命周期由部署阶段处理；测试用 `app.getHttpServer()` + 完成后 close）。
