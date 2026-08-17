# S2-5 恢复案件与冷静期 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S2-5 代码状态：`NOT_STARTED`。

## 权威需求来源

P0-8 裁决（2026-08-17）、[领域文档](../../domains/account-security-and-recovery.md)（RecoveryCase/RecoveryEvidence/冷静期/测试重点"越权恢复"）、V2 已建 `recovery_cases`（factors ≥2、APPROVED 必带 cooldown_until）。

## 目标

1. **TOTP 模块** `domain/totp.ts`：RFC 6238（HMAC-SHA1、6 位、30s 步长、±1 窗口）——纯 node:crypto 实现零依赖；Base32 编解码手写；密钥仅以受控摘要形式持久（enrollment 存 HMAC 后的验证密文？裁决：enrollment 行存 Base32 密钥于专用表列，读写仅经本模块，日志零接触；表用 V2 已有 recovery_cases 不够——需新列或复用？**不新增迁移**：TOTP 密钥暂存内存注册表 + 恢复案件以"已验证 TOTP 因子"记录，enrollment 持久化推迟至 V3（登记为后续项））。
2. **恢复案件服务** `application/recovery-case.service.ts`：
   - `beginRecovery(uid, factorsRequired=3)` → OPEN 案件 + security_locks（reason=recovery-open）；
   - 因子达成接口：`achieveFactorMemory`（复用 S2-2 验证器对旧密码验证成功即记 1 因子）、`achieveFactorTotp(code)`（TOTP 校验）、`achieveFactorHistory(claim)`（注册日期/绑定外部 ID 核对——对 users.created_at 与 channel_bindings 精确匹配）、`submitEvidenceForReview(evidenceRef)` → PENDING_REVIEW；
   - `approve(caseId)`（人工复核）：factors_achieved ≥ factors_required 才可 → APPROVED + resolved_at + cooldown_until = policy.cooldownSeconds；同事务将 payment_credentials 置 COOLDOWN + cooldown_until；重置凭证（新密码由用户在冷静期内经设置流重设，approve 不接触新密码）；
   - `reject(caseId)` → REJECTED。
3. **冷静期执行**：`VerifyPaymentCredential` 已短路 COOLDOWN 窗口（S2-2 落地）——补测试证明恢复后冷静期内 authorize 被拒。
4. **越权防护**：案件与 uid 绑定；approve/reject 幂等（状态机 CAS）；并发 approve 恰一成功；被拒案件不可复活。

## 冻结未来工程矩阵

Create：`domain/totp.ts`、`application/recovery-case.service.ts`、`test/unit/totp.spec.ts`、`test/database/recovery-case.integration.spec.ts`。Modify：0（复用既有仓储 + 直接 SQL 经 context；如需小接口增补按 S2-4 先例登记）。

## 测试矩阵（S5Cx）

unit：TOTP RFC 向量（已知 secret+时间的期望码）、±1 窗口接受/±2 拒绝、Base32往返、非法输入失败关闭。
database：begin→三因子达成（memory/totp/history 各实证）→PENDING_REVIEW→approve→APPROVED+cooldown+凭证 COOLDOWN；冷静期内 authorize 返回 cooldown；factors 不足 approve 拒绝；并发 approve 恰一；reject 终态；security_locks recovery-open 行存在。

## 停止条件

需要 V3 迁移或新依赖、TOTP 密钥需要持久化（超出上述裁决）、三锁漂移。
