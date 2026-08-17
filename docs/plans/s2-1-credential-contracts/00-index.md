# S2-1 凭证领域合同与 V2 迁移 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S2-1 代码状态：`NOT_STARTED`。

## 权威需求来源

- [阶段 2 总体规划 v1.0](../2026-08-17-stage-2-account-security-master-plan.md)（P0-7/8/10 裁决后）与 [account-security-and-recovery 领域](../../domains/account-security-and-recovery.md)。
- 阶段 1 底座：Task 3 迁移/角色链、Task 4 UoW、Task 13 验收模式。

## 目标

1. **V2 migration**（项目首个 schema 变更，须显式授权）：`payment_credentials`（uid 唯一、status CHECK NOT_SET/ACTIVE/LOCKED/RESET_PENDING/COOLDOWN/REVOKED、版本化哈希列 `hash_v1`（text，格式前缀）、`hash_algorithm`、`hash_param_version`、`failed_attempts`、`locked_until`、`cooldown_until`）；`credential_policies`（版本化策略行：位数上下限、锁定阈值、锁定时长表、冷静期）；`credential_sessions`（uid、session 状态机 OPEN/CONFIRMED/CANCELLED/EXPIRED/FAILED、purpose、order_ref、amount/asset 摘要、`expires_at`、动作 nonce 唯一）；`security_locks`；`recovery_cases`（独立因素达成矩阵列、`cooldown_until`、审计引用）。权限：platform SELECT/INSERT/UPDATE；worker/客服角色零访问。
2. **contracts**：`PaymentCredentialStatus`、`CredentialSessionPurpose`、`AuthorizePaymentProofV1`（uid+操作类型+订单+金额/资产摘要+短期限，冻结对象）、领域命令/结果类型。
3. **仓储接口**：凭证/会话/锁定/恢复四仓储（TransactionContext 显式注入，复用阶段 1 模式）。
4. 测试：迁移正反矩阵（V2 后 V1 数据兼容、角色权限、CHECK 拒绝非法 NULL 组合）、合同解析防御。

## 冻结未来工程矩阵

Create：`database/migrations/V2__stage_2_credential_security.sql`、`packages/contracts/src/credentials.ts`、platform `modules/security/domain|application|infrastructure` 五文件、unit/database 双 spec（实施前细化）；Modify：contracts index、testing fixture 迁移清单（如需）。

## 关键红线

- 迁移只建表/约束/授权，不含任何种子密码或哈希。
- `hash_v1` 列格式 `argon2id$<params>$<digest>`（算法裁决：Argon2id，S2-2 细化参数版本）；无明文列、无可逆列。
- 金额/资产摘要为十进制字符串（禁 number）。

## 实施步骤（获授权后）

红灯（迁移前空库拒绝 V2 断言、角色零访问断言）→ V2 SQL → contracts → 仓储 → 绿灯 → test:all/docs:check 回归 → 文档同步 → 等待外部复审。

## 停止条件

V1 兼容性破坏、需要超出矩阵的 schema 变更、三锁漂移、migration 授权未获明确批准。
