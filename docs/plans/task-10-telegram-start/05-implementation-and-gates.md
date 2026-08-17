# 实施步骤与门禁

[返回索引](00-index.md)

## 实施步骤（第 20/48 步获授权后执行）

- [ ] Step 1：基线核对——8 个 Create 目标不存在、4 个 Modify 输入一致、三锁无漂移；记录基线 ZIP SHA-256。
- [ ] Step 2：写双 spec 红灯。
- [ ] Step 3：contracts telegram.ts Modify（command/result/menu 事件类型）。
- [ ] Step 4：mapper（解析防御）+ handle-telegram-start（单 UoW 编排）+ main-menu 常量。
- [ ] Step 5：worker 侧 handler、双 Gateway、create-worker/outbox-worker Modify。
- [ ] Step 6：controller Modify（真实 HandleTelegramStart 接线 + 503 映射）。
- [ ] Step 7：spec 逐项绿灯。
- [ ] Step 8：全量回归 build/typecheck/unit/db。
- [ ] Step 9：重构检查（UoW 内零 Gateway 调用；默认 Gateway 零网络；menu eventKey 基于 updateId；raw Update 不入 command/Outbox；重复/key-unavailable 不产生第二个身份事件）。
- [ ] Step 10：文档同步（telegram-experience、identity、runtime-topology、status、verification、progress-log）。
- [ ] Step 11：交付与验收报告；等待用户外部复审。

## 验证命令

```
pnpm build && pnpm typecheck
pnpm exec vitest run --project database apps/platform/test/database/handle-telegram-start.integration.spec.ts
pnpm exec vitest run --project unit apps/worker/test/unit/telegram-main-menu.handler.spec.ts
pnpm test:unit && pnpm test:db
```

## 停止条件

- 需要 migration、identity 合同变更、真实网络 Gateway 或新依赖：停止。
- 原子性测试出现非确定性失败：停止登记。
- 三锁漂移（含 Task 9 方案 A 后的新基线 `59D72A2A…3C73B`）或目标外写入：停止。

## 完成标准（总计划原文收敛）

Inbox PROCESSED、身份、领域事件、菜单 Outbox 同事务；duplicate_same_payload 安全成功，conflict 与 digest_key_unavailable 无身份/Outbox 效果且 controller 以稳定 503 映射后者；禁用连接不注册 handler 或置 WAITING_CONFIGURATION；无真实网络。
