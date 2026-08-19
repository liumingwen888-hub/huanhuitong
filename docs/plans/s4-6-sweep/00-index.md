# S4-6 归集（Sweep）服务 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S4-6 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 4 总体规划](../2026-08-17-stage-4-deposits-master-plan.md)（阈值归集 + 定时批量补充）、[ledger-model 记账模板](../../architecture/ledger-model.md)、S4-5 入账编排。

## 目标

**`DepositSweepService`**——从充值地址归集资金到平台主钱包：

1. **归集候选识别** `findSweepCandidates(network, thresholdAmount)`：
   - 查询有 POSTED 检测且金额累计 ≥ 阈值的充值地址；
   - 返回 { addressId, addressText, uid, assetCode, totalAmount, detectionCount }。

2. **归集执行** `sweepAddress(candidate, broadcaster)`：
   - 调用 `TransactionBroadcasterPort.broadcast(fromAddress, toMainWallet, amount, fee)`——纯接口，测试用 Fake；
   - 归集入账：DR 充值地址托管 / CR 平台主钱包托管（资产从用户充值地址转移到平台冷/热钱包）；
   - 归集费用：DR 平台上游成本 / CR 充值地址托管（链上 gas 从归集金额中扣除）；
   - 记录归集交易状态（broadcast_txid → confirmed → reconciled）。

3. **`TransactionBroadcasterPort`** 接口：
   ```ts
   interface TransactionBroadcasterPort {
     broadcast(input: {
       network: ChainNetwork;
       fromAddress: string;
       toAddress: string;
       amount: string;
       feeRate: string;
     }): Promise<{ broadcastTxid: string; actualFee: string }>;
     getStatus(network: ChainNetwork, txid: string): Promise<'PENDING' | 'CONFIRMED' | 'FAILED'>;
   }
   ```

4. **归集表**（V7 增量迁移或复用现有结构——裁决：**新增 `sweep_batches` 表**）：
   - sweep_id PK、network、from_address_id FK、to_address_text、amount、fee、broadcast_txid、status（BROADCAST/PENDING/CONFIRMED/FAILED）、ledger_transaction_id FK。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/deposits/domain/transaction-broadcaster.port.ts`、`domain/fake-broadcaster.ts`、`application/deposit-sweep.service.ts`、`test/database/deposit-sweep.integration.spec.ts`。Modify：0（如需 V7 migration 另行申请）。

## 测试矩阵（S4SW）

- 阈值候选识别：≥阈值被选中、<阈值跳过；
- 归集过账：DR/CR 方向正确、余额变化正确；
- 归集费用记账：费用进入上游成本；
- Fake 广播：txid 返回、状态跟踪；
- 多地址批量归集；
- 归集失败（broadcast FAILED）→ 状态标记 + 不自动重试。

## 停止条件

需要真实链连接/广播、需要 V7 migration 未获授权、三锁漂移。

## 裁决

- 归集触发方式：**服务层主动调用**（非定时任务）——由外部调度器或手动触发 `sweepAll(network, threshold)`；阶段 9 管理后台提供 UI 入口。
- 归集费用：**从归集金额中扣除**（用户到账金额不变，平台承担链上费用）；上游成本账户记录费用支出。
- V7 migration 延后：sweep_batches 表与真实链上功能紧密耦合，先用 fake 接口验证机制层，V7 在 S4-7/S4-8 阶段验收前统一申请。
