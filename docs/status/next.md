# 下一步

S6-2"提现申请与冻结服务"详细计划 v1.0 已完成（`docs/plans/s6-2-withdrawal-request-freeze/`），`READY v1.0 / WAITING_EXTERNAL_REVIEW`。

复审重点：支付授权证明的绑定合同（orderRef/金额/资产摘要精确相等 + 过期拒绝）、冻结编排的崩溃自愈路径（模板幂等键 + order_ref UNIQUE）、双轨路由阈值语义（amount < minAutoAmount 走自动轨）。复审通过后实施（无新迁移，V8 已授权）。
