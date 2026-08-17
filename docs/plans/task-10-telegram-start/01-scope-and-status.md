# 范围与状态

[返回索引](00-index.md)

## 目标

1. `HandleTelegramStart.execute(command)`：单一 UoW 内完成 Inbox 认领 → `ResolveOrCreateUid` → `TelegramMainMenuRequestedV1` 入 Outbox → `markProcessed`——四者同事务原子。
2. 四种结果显式分类：`processed` / `duplicate_same_payload` / `conflict` / `digest_key_unavailable`；后三者零身份/Outbox 效果。
3. worker 侧：注入 Gateway 的主菜单 handler；外部连接禁用时不注册 handler，队列残留该 topic 一次性 CAS 到 `WAITING_CONFIGURATION`（F-06 语义），零重试风暴零轮询写库。
4. controller（Task 9 Modify）把 Task 10 结果映射 HTTP：`digest_key_unavailable` → 503，其余安全成功。

## 当前状态

- 第 18/48 步 `COMPLETED / EXTERNAL REVIEW PASS`；Tasks 1–9 VERIFIED。
- 第 19/48 步 `IN_PROGRESS`；本计划 `READY v1.0 / WAITING_EXTERNAL_REVIEW`；Task 10 代码 `NOT_STARTED`；第 20/48 步 `NOT_STARTED`。

## 明确排除

- 真实 Telegram 网络 Gateway（未来独立计划与授权；本 Task 仅 Recording/Disabled 实现）。
- 菜单按钮的业务动作（账户/帮助仅展示，无资金查询——菜单不含余额/资产/网络/市场）。
- identity 领域合同修改、migration、资金/账本对象、依赖/锁修改。

## 失败场景（必须测试）

Inbox 未 PROCESSED 却提交身份；duplicate/conflict/key-unavailable 继续产生效果；Gateway 在 UoW 内调用；配置禁用重试风暴；菜单事件保存外部 ID/正文/Secret；provider 未注册或关闭钩子未释放。
