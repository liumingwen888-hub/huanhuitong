# S2-3 设置与验证会话 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S2-3 代码状态：`NOT_STARTED`。

## 权威需求来源

[领域文档](../../domains/account-security-and-recovery.md)（用户流程/状态机/幂等/审计）、[阶段 2 总体规划](../2026-08-17-stage-2-account-security-master-plan.md)、S2-1/2 已交付底座。

## 目标

1. **会话应用服务** `credential-session.service.ts`：
   - `beginSetup(uid)` → OPEN 会话（purpose=credential-setup，policy 时限过期）；
   - `appendDigit(sessionId, actionNonce, digit, phase)` → 仅 OPEN、nonce 首用（`credential_sessions.action_nonce` 唯一 + 内存已用集合）、逐位进入 S2-2 的 `CredentialEntryBuffer`（primary/confirmation 两段）；
   - `confirmSetup(sessionId)` → 两段一致 + 位数在策略区间 → `hashCredentialDigits` → `upsertActiveCredential` → 会话 CONFIRMED；
   - `beginAuthorization(uid, operation, orderRef, amount, asset)` + `authorize(sessionId, …)` → 验证通过签发冻结对象 `AuthorizePaymentProofV1`（sessionId 绑定 + expiresAt）；
   - `cancel(sessionId)` → CANCELLED 并清零缓冲。
2. **内存会话注册表** `credential-session.registry.ts`：sessionId → { primary, confirmation, usedNonces }；进程内唯一；过期/终态即移除并清零；重启后 DB 行为权威（OPEN 行仅可取消/过期，不可续输——防跨重启拼装）。
3. **过期清理**：读取 DB `expires_at`，过期转 EXPIRED；禁止用过期会话继续资金动作。
4. **审计元数据**（audit_events 白名单内）：设置/确认/锁定/拒绝类别，零原文零哈希零 nonce 值。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/security/application/credential-session.service.ts`、`application/credential-session.registry.ts`、`test/unit/credential-session.service.spec.ts`、`test/database/credential-session.integration.spec.ts`。Modify：0。

## 测试矩阵（S3Cx）

unit：注册表借出清零/终态移除/nonce 防重；appendDigit 状态与输入防御（复用 S2-2 错误码）；confirm 不一致拒绝；位数区间执行。
database：setup 全流程（begin→append×n→confirm→ACTIVE + CONFIRMED 会话行 + nonce 唯一拒绝重复 append）；authorize 成功签发 proof 字段完整/过期；cancel 后续 append 拒绝；过期会话 EXPIRED 且 authorize 拒绝；并发 append 同 nonce 恰一成功。

## 红线复述

回调 digit 不入 Inbox/Outbox/日志；nonce 值不入审计（仅类别）；会话内存缓冲复活即清零；Telegram 消息不回显位数或已输长度。

## 停止条件

需要 V3 迁移或新依赖、需要把 digit 落任何持久层、三锁漂移。
