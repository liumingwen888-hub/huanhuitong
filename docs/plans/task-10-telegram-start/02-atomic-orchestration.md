# 原子编排与结果语义

[返回索引](00-index.md)

## HandleTelegramStart 单 UoW 流程

```
unitOfWork.execute(transaction => {
  claim = inbox.claim(transaction, { consumer:'telegram-webhook-v1', externalMessageId: updateId,
                                     digestSet: command.inboxDigests, claimant })
  if claim.kind != 'claimed' → return claim（duplicate/conflict/digest_key_unavailable 原样上浮，零后续写入）
  identity = resolveOrCreateUid.execute(transaction, toIdentityCommand(command))
  menuEvent = TelegramMainMenuRequestedV1{ eventId: ids.nextEventId(), uid, bindingId,
                                           menuVersion:'main-menu-v1', occurredAt: receivedAt,
                                           correlationId }
  outbox.enqueue(transaction, { id: eventId, topic:'telegram.main-menu-requested.v1',
                                eventKey:`telegram:menu:${updateId}`, payload: menuEvent })
  completed = inbox.markProcessed(transaction, claim.lease)
  if !completed → throw APPLICATION_INBOX_CLAIM_LOST（整事务回滚，重入后走 claim 分支收敛）
  return { kind:'processed', uid, created }
})
```

## 结果语义

| 结果 | Inbox | 身份 | Outbox |
|---|---|---|---|
| processed | RECEIVED→CLAIMED→PROCESSED（同事务） | 创建或复用 | uid-created/seen + menu 各恰 1 条 |
| duplicate_same_payload | 不变 | 零写入 | 零写入（安全成功，200） |
| conflict | 不变 | 零写入 | 零写入（安全成功，200；审计可查 digest 不同事实） |
| digest_key_unavailable | 不变 | 零写入 | 零写入（controller 映射 503，不标 PROCESSED） |

- 重复 Update 的主菜单不重发：eventKey `telegram:menu:<updateId>` 唯一 + duplicate 短路双保险。
- `markProcessed` 失败（租约被抢）抛 `APPLICATION_INBOX_CLAIM_LOST` 回滚——绝不出现"Inbox 未完成却提交身份"。
- command 结构禁入项：raw Update、canonical bytes、消息正文、摘要 key material（mapper 层解析防御延续 Task 5/7 模式）。

## controller 映射（Task 9 文件 Modify）

`startHandler` 实现改为调用 `HandleTelegramStart`：processed/duplicate/conflict → 200（不泄露内部细节）；digest_key_unavailable → 503 稳定码（复用 Task 9 errorSink 路径）。
