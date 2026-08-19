# 下一步

阶段 8 进行中（S8-1～S8-4 已实施 VERIFIED，2026-08-19）。S8-5"回调接收与 UNKNOWN 查询"详细计划 v1.0 已完成（`docs/plans/s8-5-callback-query/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点：验真失败永久拒绝零写入红线、"回调不单独视为终态事实"的映射设计（SUCCEEDED 排内部结算队列而非直接改终态——V12 CHECK 与 S8-6 职责分离的 natural fit）、FakeHmacVerifier 做真实 HMAC 运算（非总是通过）、V13 callback_inbox 只增不改。复审通过并显式授权 V13 后实施。
