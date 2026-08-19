# S4-3 充值检测 Worker 详细计划索引

计划版本：`v1.0`。风险级别：`L2`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S4-3 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 4 总体规划](../2026-08-17-stage-4-deposits-master-plan.md)（第三方 RPC 接口层 + fake 适配器）、S4-1 检测表/确认策略、S4-2 地址服务。

## 目标

**充值检测 Worker**——扫描链上交易并匹配已分配地址：

1. **链上适配器接口** `ChainScannerPort`：
   ```ts
   interface ChainScannerPort {
     getLatestBlock(network): Promise<bigint>;
     getTransactionsForAddress(
       network, addressText, fromBlock, toBlock
     ): Promise<readonly OnChainTransaction[]>;
   }
   interface OnChainTransaction {
     networkTxid: string;
     toAddress: string;
     amount: string;
     blockNumber: bigint;
     blockTimestamp: Date;
     confirmations: number;
   }
   ```
   测试用 `FakeChainScanner`（确定性注入交易）；真实实现（TronGrid/Etherscan等）需独立授权。

2. **检测 Worker** `DepositDetectionWorker`：
   - `runOnce(network)`：
     1. 读 chain_scan_checkpoints 获取上次扫描位置；
     2. 获取 ACTIVE deposit_addresses（按 network）；
     3. 逐地址调用 scanner.getTransactionsForAddress；
     4. 匹配到的交易 upsertDetection（幂等——已有交易更新确认数）；
     5. 更新 checkpoint（CAS 防并发）。
   - worker 角色（只读地址+读写检测表——但检测表 platform 也有写权，入账由 platform 编排；本 Worker 设计为 platform 进程内运行，非独立 worker 进程）。

3. **确认跟踪**：upsertDetection 使用 GREATEST(confirmations)——每次扫描更新最新确认数；确认达标后 S4-4 确认等待模块消费。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/deposits/domain/chain-scanner.port.ts`、`domain/fake-chain-scanner.ts`、`application/deposit-detection.worker.ts`、`test/database/deposit-detection.integration.spec.ts`。Modify：S4-1 检测仓储（如需 checkpoint 方法——按先例登记）。

## 测试矩阵（S4DW）

- fake 注入交易→检测记录创建（txid/金额/地址正确）；
- 同交易重复扫描→确认数更新非新建（幂等）；
- 多地址多交易批量处理；
- checkpoint 更新（扫描进度推进 + CAS 防并发回退）；
- 已 RETIRED 地址不被扫描；
- 确认数达到策略阈值后检测状态仍为 DETECTED（等 S4-4 转换）。

## 停止条件

需要真实链连接、需要新迁移、三锁漂移。

## 裁决

检测 Worker 运行在 platform 进程（非独立 worker 进程）——简化部署；真实生产可移至 worker（接口已解耦）。
