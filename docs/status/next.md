# 下一步

阶段 6 进行中（阶段 1–5 已 VERIFIED，S6-1/S6-2/S6-3 已实施 VERIFIED）。S6-4"Signer 隔离接口"详细计划 v1.0 已完成（`docs/plans/s6-4-signer-isolation/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点：VaultPort 的 HSM 型语义（密钥不出边界——接口层就没有返回密钥的方法）、签名产物不落库的裁决（确定性 + 广播幂等替代持久化 SigningIntent）、SIGNING 态幂等重签的崩溃恢复路径。复审通过后实施（无新迁移、contracts 不动）。
