# 实施步骤与门禁

[返回索引](00-index.md)

## 实施步骤（第 18/48 步获授权后执行）

- [ ] Step 1：基线核对——11 个 Create 目标不存在、2 个 Modify 输入一致、三锁无漂移；记录基线 ZIP SHA-256。
- [ ] Step 2：写两个 http spec 红灯。
- [ ] Step 3：contracts telegram.ts + index export。
- [ ] Step 4：schema（Zod 最小 envelope + 分类）、secret verifier（constant-time）、request policy（五道门禁）。
- [ ] Step 5：grammY adapter + mapper + controller + module。
- [ ] Step 6：create-platform-app（trust proxy、256kb body limit）+ main.ts Modify。
- [ ] Step 7：spec 逐项绿灯（T9C01–T9C15）。
- [ ] Step 8：全量回归 build/typecheck/unit/db。
- [ ] Step 9：重构检查（Secret 先于 Zod/UoW；controller 不记 header/body/digest；decimal id 恒 string；grammY 类型零泄漏）。
- [ ] Step 10：文档同步（trust-boundaries、telegram-experience、runtime-topology、status、verification、progress-log）。
- [ ] Step 11：交付与验收报告；等待用户外部复审。

## 验证命令

```
pnpm build && pnpm typecheck
pnpm exec vitest run --project unit apps/platform/test/http/telegram-webhook.contract.spec.ts apps/platform/test/http/grammy-webhook.adapter.spec.ts
pnpm test:unit && pnpm test:db
```

## 停止条件

- 需要 Nest/grammY 版本或新依赖：停止（均在锁内，出现即漂移）。
- grammY webhookCallback 行为与注入 BotInfo 假设冲突：停止登记。
- 三锁漂移或目标外写入：停止。

## 完成标准（总计划原文收敛）

合法不支持 Update 均 200 ignored 且无身份/资金效果；进入 Inbox 的 `/start` 使用完整 parsed Update 的 HMAC 摘要（对象同引用直传 Task 5）；缺摘要 key 503 且无身份/Outbox 效果；只有 envelope 畸形 400；Secret/HTTPS/代理/body 门禁可证；测试全程零网络，grammY 只在 adapter。
