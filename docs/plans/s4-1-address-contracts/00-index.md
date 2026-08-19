# S4-1 地址领域合同与 V6 迁移 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（涉及密钥路径）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S4-1 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 4 总体规划 v1.0](../2026-08-17-stage-4-deposits-master-plan.md)（HD 派生 + 合成推进 + 第三方 RPC 接口层）、[deposits 领域](../../domains/deposits.md)、[asset-custody 领域](../../domains/asset-custody.md)。

## 目标

1. **V6 增量迁移**（须显式授权）：
   - `deposit_addresses`：address_id PK、uid FK、asset_code FK、network、address_text（链上地址格式）、derivation_path（BIP-44 路径）、derivation_index（单调递增）、status（ACTIVE/RETIREd/COMPROMISED）、created_at；UNIQUE(network, address_text)；UNIQUE(asset_code, derivation_index)。
   - `address_assignments`：assignment_id PK、address_id FK、uid FK、idempotency_key UNIQUE（显式幂等分配记录，方案 A 同 S3-1）。
   - `deposit_detections`：detection_id PK、address_id FK、network_txid（链上交易 ID）、network_timestamp、amount BIGINT、confirmations integer、status（DETECTED/CONFIRMED/REORG_DETECTED/POSTED/FAILED_POST）、UNIQUE(network, network_txid, address_id)。
   - `chain_scan_checkpoints`：network PK、last_scanned_block/height、updated_at。
   - `confirmation_policies`：policy_version PK、network、required_confirmations、activated_at（版本化确认数配置——TRON 19/ETH 12/BTC 6 种子）。
   - 权限：platform 读写、worker 只读检测表/地址表（入账由 platform 编排）。
2. **contracts**：DepositAddressSnapshot、DepositDetectionStatus、ChainNetwork 枚举、确认策略快照类型。
3. **仓储接口**：地址（findAssigned/createNext/assign 幂等）、检测（upsert/findConfirmed）、扫描检查点（读/更新 CAS）。
4. **HD 派生接口**：`deriveAddress(network, index): {address, derivationPath}`——纯接口，测试用确定性 fake（非真实密钥），真实实现需独立授权。

## 冻结未来工程矩阵

Create：`database/migrations/V6__stage_4_deposit_addresses.sql`、`packages/contracts/src/deposits.ts`、platform `modules/deposits/{domain,application,infrastructure}` 五文件、database spec。Modify：contracts index。

## 测试矩阵（S4DA）

- V6 迁移正反（V1-V5 兼容、角色矩阵、CHECK 拒绝）；
- 地址分配幂等（同 uid+asset 重复请求返回同一地址）；
- derivation_index 单调递增（并发 createNext 恰一赢者）；
- 检测表 UNIQUE 约束拒绝同 txid+address 重复；
- 确认策略版本化（新版本不覆盖旧）；
- fake HD 派生确定性（同 index 同地址）。

## 停止条件

需要真实密钥材料（接口层 fake 优先）、V1-V5 兼容破坏、三锁漂移、V6 未获授权。
