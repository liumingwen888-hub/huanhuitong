# 下一步

S2-2"凭证处理组件"详细计划 v1.0 已完成（`docs/plans/s2-2-credential-component/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点（关键裁决）：**哈希算法选择**——推荐方案 B（Node 内置 crypto.scrypt：零依赖、零锁漂移、四段格式与 V2 CHECK 兼容、OWASP 认可参数）；备选 Argon2id 需新增原生依赖（按方案 A 先例授权）。复审通过并确认算法后实施。
