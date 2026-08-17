# S2-4 锁定、计数与速率限制 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S2-4 代码状态：`NOT_STARTED`。

## 范围重估（诚实基线）

已随 S2-2/S2-3 落地：失败计数、锁定窗口短路、×2 阶梯锁定、成功清零、会话 nonce 幂等。S2-4 增量聚焦三件事：

1. **security_locks 审计行**：验证编排触发锁定时同事务写入 `security_locks`（reason=credential-failed-attempts，含 escalation 元数据引用）；释放路径（recordSuccessfulVerification 解锁时）写 released_at。
2. **会话创建速率限制**：同 uid 并发 OPEN 会话上限 1（先取消旧会话才可开新）+ 每分钟创建上限（内存令牌桶，进程级；跨进程由 DB 唯一约束兜底部分场景）。防会话洪水。
3. **scrypt 参数升级路径**：`hash_param_version` 检测旧版本 → 验证成功后以当前参数**重哈希**并更新（透明升级）；版本常量与策略表联动。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/security/application/lock-audit.service.ts`、`application/session-rate-limiter.ts`、`application/credential-rehash.ts`、`test/unit/session-rate-limiter.spec.ts`、`test/database/lock-and-rate.integration.spec.ts`。Modify：`application/verify-payment-credential.ts`（锁定时调用审计行写入 + 重哈希钩子）、`application/credential-session.service.ts`（创建前限流）、infrastructure 仓储（security_locks 两方法 + findCredential 返回 paramVersion）。

## 测试矩阵（S4Cx）

unit：令牌桶窗口/上限/重置；单 OPEN 会话约束拒绝。
database：锁定触发 security_locks 行 + 解锁 released_at；并发第二 OPEN 会话拒绝；旧 param_version（手工降版本）验证成功后哈希升级为当前版本且仍可验证。

## 停止条件

需要 V3 迁移、需要新依赖、需要把锁定审计写入普通业务表、三锁漂移。
