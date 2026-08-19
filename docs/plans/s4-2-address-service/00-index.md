# S4-2 地址生成与分配服务 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S4-2 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 4 总体规划 v1.0](../2026-08-17-stage-4-deposits-master-plan.md)（HD 派生 + 地址复用策略）、[deposits 领域](../../domains/deposits.md)、S4-1 已交付（V6 表 + 仓储 + fake HD）。

## 目标

**`DepositAddressService`**——面向业务模块的地址查询/分配入口（find-or-create 语义）：

1. `getOrCreateAddress(uid, assetCode): DepositAddressSnapshot`：
   - 查已分配 ACTIVE 地址 → 命中返回（**地址复用**——同 uid+asset 恒同地址直到 RETIRED/COMPROMISED）；
   - 未命中 → 资产→网络映射（USDT-TRC20→TRON、USDT-ERC20/ETH→ETHEREUM、BTC→BITCOIN、USD-FIAT→无链上地址→拒绝）；
   - createNextAddress（S4-1 仓储，ON CONFLICT + 竞态回读幂等）；
   - 并发同 uid+asset 恰得一地址（唯一约束兜底）。
2. `retireAddress(addressId)`：状态 ACTIVE→RETIRED CAS（安全事件时停止使用旧地址）；下次 getOrCreate 会生成新地址。
3. `markCompromised(addressId)`：状态→COMPROMISED（与 RETIRED 语义区分：安全事件 vs 轮换）。
4. 资产→网络映射表：版本化（复用 S3-4 ConfigStore），初始硬编码 + 后续可配置覆盖。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/deposits/application/deposit-address.service.ts`、`test/database/deposit-address-service.integration.spec.ts`。Modify：0。

## 测试矩阵（S4AS）

- getOrCreate 幂等（同 uid+asset 两次调用返回同一地址）；
- 并发 getOrCreate 恰得一地址（真并发双连接）；
- 不同资产不同地址、同资产跨用户不同地址；
- USD-FIAT（非法币链上充值）拒绝；
- retireAddress 后 getOrCreate 生成新地址（索引递增）；
- markCompromised 后同上；
- 状态 CAS（重复 retire 拒绝）。

## 停止条件

需要真实密钥材料、需要新迁移、三锁漂移。

## 裁决

地址复用（而非每次生成新地址）——减少地址膨胀，简化用户体验；与 Binance/OKX 等主流交易所策略一致。轮换仅因安全事件触发。
