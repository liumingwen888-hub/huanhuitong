# 菜单事件与 Worker 网关

[返回索引](00-index.md)

## main-menu.ts

`mainMenuV1` 冻结：version `main-menu-v1`、text `请选择操作`、buttons `account=我的账户` / `help=帮助`。不含余额、资产、网络、市场；不触发任何资金对象。

## TelegramMainMenuRequestedV1（contracts Modify 追加）

字段：type/eventId/uid/bindingId/menuVersion/occurredAt/correlationId。**只存 bindingId**，不存完整 Update、消息原文、start 参数、chatId 以外的外部标识或任何 Secret。

## worker Gateway

```ts
interface TelegramBotGateway {
  sendMainMenu(input: {
    externalUserId; text; buttons; idempotencyKey
  }): Promise<void>
}
```

- `telegram-main-menu.handler.ts`：OutboxHandler 实现——收到 `telegram.main-menu-requested.v1` 载荷后查绑定取 externalUserId（worker 对 channel_bindings 只读），经注入 Gateway 发送 `mainMenuV1` 内容；幂等键 = eventKey。
- `external-connection-disabled.gateway.ts`：导出 `telegramExternalConnectionState = { enabled: false, disabledDisposition: 'WAITING_CONFIGURATION' }`；默认永不连接网络。
- `create-worker.ts`（Modify）：`enabled:false` 时不注册 Telegram handler；若 Outbox 已有该 topic 残留，一次性 CAS 置 `WAITING_CONFIGURATION`（复用 Task 6 applyFailure 的 DISABLED 分类路径），后续 claim 查询天然排除，恢复仅经显式配置变更。
- `outbox-worker.ts`（Modify）：暴露 handler 按 topic 路由的最小注册点（禁用时消息按 PERMANENT/DISABLED 分类交 store）。

## Gateway 调用边界

Gateway 只在 worker 事务外调用（runOnce 已保证：处理器执行不持锁）；发送失败按 Task 6 错误分类进入退避/死信，绝不回滚已提交 UID——重复风险由接收方幂等键 + 运营审计覆盖（at-least-once 明示）。
