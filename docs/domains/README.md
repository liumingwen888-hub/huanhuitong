# 领域索引

需求状态：APPROVED。交付状态：DESIGNING。

以下 17 个文件是各领域完整规则的唯一权威来源：

1. [identity-and-membership](identity-and-membership.md)
2. [account-security-and-recovery](account-security-and-recovery.md)
3. [asset-custody](asset-custody.md)
4. [ledger-and-balances](ledger-and-balances.md)
5. [deposits](deposits.md)
6. [internal-transfers](internal-transfers.md)
7. [claims](claims.md)
8. [red-packets](red-packets.md)
9. [withdrawals](withdrawals.md)
10. [exchange](exchange.md)
11. [fiat-payouts](fiat-payouts.md)
12. [fees-and-risk](fees-and-risk.md)
13. [bills-and-reconciliation](bills-and-reconciliation.md)
14. [telegram-experience](telegram-experience.md)
15. [admin-and-audit](admin-and-audit.md)
16. [platform-operations](platform-operations.md)
17. [future-apps-and-integrations](future-apps-and-integrations.md)

领域依赖遵循 [domain-map.md](../architecture/domain-map.md)：通道适配层依赖应用用例；资金产品依赖身份、安全、资产、费用风险和账本公开接口；所有资金写入只进入账本；运维、管理和对账不能反向侵入领域内部。跨领域状态通过显式命令、查询或版本化事件交换，禁止直接修改其他领域的私有表。

每个领域都记录目标、边界、流程、实体、状态、接口、资金、幂等、安全、审计、测试、状态、门禁和待确认问题。开放问题只链接 [P0 清单](../product/open-decisions.md)，避免重复产生漂移。

