# 下一步

阶段 8 总体规划 v1.0 READY（五项设计决策已裁决）。S8-1"代付合同与 V12 迁移"详细计划 v1.0 已完成（`docs/plans/s8-1-payout-contracts/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点：收款人零明文设计（token 引用 + SHA-256 摘要双 CHECK）、provider_idempotency_key UNIQUE 作为"同意图只付一次"的数据库锚、八态状态机的 UNKNOWN/REVERSED 语义、callback_secret_ref 只存引用不存密钥本体。复审通过并显式授权 V12 后实施。
