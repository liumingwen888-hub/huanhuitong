# 阶段 6 提现、Signer、广播和确认 总体规划

计划版本：`v0.1（需求确认中）`。计划状态：`DRAFT`。交付状态：`DESIGNING`。

基线：阶段 1–5 VERIFIED（2026-08-17 用户验收通过）。

## 目标

在已验证的充值和转账管道上，建立**资金出站能力**：用户提现申请、独立 Signer 隔离签名、链上广播和确认监控，全部经复式账本原子记账并受 Maker-Checker 和增强认证保护。

## 前置裁决（阻塞实施，须用户决策）

### P0-3 哪些资产与网络支持链上提现
- USDT-TRC20（TRON）？USDT-ERC20/ETH（Ethereum）？BTC？
- 各链提现最小/最大限额？
- 需确认：真实网络清单（可与充值共用合成推进）

### 提现安全策略
- **Maker-Checker**：提现审批需要独立管理员双人确认（阶段 2 的 admin_principals 已有骨架）
- **增强认证**：提现需支付密码 + 可能的 TOTP（阶段 2 已实现）
- **Signer 隔离**：签名密钥存储方案（HSM/加密数据库/Vault）
- **热/冷钱包分离**：日常提现走热钱包，大额走冷钱包人工操作

## 任务分解草案（v0.1）

| # | 任务 | 内容 |
|---|---|---|
| S6-1 | 提现领域合同与 V8 迁移 | withdrawal_orders（订单号/金额/资产/目标地址/状态机/幂等 UNIQUE）+ Signer 策略表 |
| S6-2 | 提现申请与冻结服务 | 支付密码验证→RiskGate→DR 可用/CR 冻结（S3-6 withdrawalRequested 模板）→Outbox 通知 |
| S6-3 | Maker-Checker 审批流 | 独立管理员→审批→增强认证→批准/拒绝；金额阈值分级审批 |
| S6-4 | Signer 隔离接口 | TransactionSignerPort（纯接口 + Fake）；密钥存储接口（VaultPort）；签名策略版本化 |
| S6-5 | 广播与确认监控 | TransactionBroadcasterPort（复用 S4-6）→广播→确认数跟踪→UNKNOWN 不推断 |
| S6-6 | 提现完成/失败结算 | 成功→DR 冻结/CR 托管+费用（S3-6 withdrawalSucceeded）；失败→DR 冻结/CR 可用（释放） |
| S6-7 | Telegram UX | /withdraw 命令→支付密码→审批状态跟踪→通知 |
| S6-8 | 威胁模型与验收 | 提现全链路验收（含审批/签名/广播/UNKNOWN） |

## 核心设计决策（需确认）

1. **提现审批模式**：全自动（低额）/ 人工审批（高额）双轨？
2. **Signer 隔离级别**：同进程接口隔离 vs 独立进程/容器？
3. **热/冷钱包策略**：金额阈值切换 vs 全部热钱包（初期）？
4. **提现费用**：固定费 vs 动态 gas 费率？
5. **每日提现限额**：单笔/累计限额（复用 S3-4 operation_limits）？

## 前置条件

- S3-6 withdrawalRequested/Succeeded/Failed 模板已就绪 ✅
- S3-4 RiskGate + operation_limits 已实现 ✅
- S2 支付密码验证 + TOTP 已实现 ✅
- S2 admin_principals RBAC 骨架已有 ✅
- S4-6 TransactionBroadcasterPort 已定义 ✅

## 授权现状

阶段 6 代码实施授权为 0；V8 migration 须显式授权；真实链签名须独立授权。
