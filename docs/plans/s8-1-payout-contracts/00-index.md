# S8-1 代付合同与 V12 迁移 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（法币出站 schema 基础）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S8-1 代码状态：`NOT_STARTED`。

## 权威需求来源

[阶段 8 总体规划 v1.0](../2026-08-19-stage-8-fiat-payout-master-plan.md)（已裁决决策 2/3）、[法币代付领域](../../domains/fiat-payouts.md)（PayoutOrder/BeneficiarySnapshot/ProviderAttempt 实体、"供应商幂等键唯一"）、[S6-1/S7-1 先例](../s6-1-withdrawal-contracts/00-index.md)。

## 目标

1. **V12 增量迁移**（须显式授权）——两张表：

### `payout_orders`
- `payout_order_id uuid PK`；`order_ref text UNIQUE`（用户幂等键）；`uid uuid FK users`；
- `source_asset_code text FK asset_catalog`（出金资产，如 USDT-TRC20）；`route text NOT NULL`（国家:币种，如 `US:USD`）；`amount bigint CHECK(>0)`；`fee_amount bigint DEFAULT 0 CHECK(>=0)`；
- **收款人（决策 2）**：`beneficiary_ref text NOT NULL`（token 引用，`^[A-Za-z0-9-]{4,64}$`）+ `beneficiary_digest text NOT NULL`（SHA-256 摘要，`^sha256:[A-Za-z0-9_-]{43}$`）——零明文银行细节，CHECK 双形状强制；
- `status`：八态 `FUNDS_RESERVED → SUBMITTING → ACCEPTED → SUCCEEDED | UNKNOWN；UNKNOWN →(查询裁决) ACCEPTED/SUCCEEDED/FAILED；FAILED → REFUNDED；SUCCEEDED → REVERSED`；
- `provider_config_version int`（活跃供应商配置版本引用，S8-2 消费）；`provider_idempotency_key text UNIQUE NOT NULL`（**同业务意图在供应商侧只付一次的锚**）；
- `ledger_transaction_id uuid NOT NULL FK`（冻结过账）；`settlement_ledger_transaction_id uuid NULL FK`（收口过账：成功结算/失败释放/冲正）；
- `failure_reason text NULL`；`created_at/updated_at`；
- CHECK：SUCCEEDED⇒收口非空；FAILED⇒原因非空；REFUNDED⇒收口非空；REVERSED⇒收口非空；
- 索引：uid+status+created；status 部分索引（SUBMITTING/ACCEPTED/UNKNOWN 观察窗）；
- 权限：平台 SELECT+INSERT+UPDATE(status, settlement_ledger_transaction_id, failure_reason, updated_at)；worker 只读。

### `provider_configs`
- `(provider_id text, config_version int) PK`；`provider_name text`；`route text`；`source_asset_code FK`；`fixed_fee bigint CHECK(>=0)`；`min_amount/max_amount bigint CHECK`；`callback_secret_ref text NOT NULL`（**密钥引用，非密钥本体**——HMAC 密钥存 Vault 边界，决策 4 配套）；
- 版本化只增不改（平台无 UPDATE）；种子一行合成配置（provider `fake-bank-v1`、route `US:USD`、source USDT-TRC20、费 2000、限额区间）；
- 权限：平台 SELECT+INSERT；worker 只读。

2. **contracts**：`PayoutOrderStatus`（8 态）、`PayoutOrderSnapshot`、`ProviderConfigSnapshot`、`PayoutContractErrorCode`。
3. **仓储**：订单（幂等 create + findByOrderRef/findById）；供应商配置（findActive/findLatest）。

## 冻结未来工程矩阵

Create：`database/migrations/V12__stage_8_fiat_payouts.sql`、`packages/contracts/src/fiat-payouts.ts`（index 导出）、platform `modules/fiatpayout/{application,infrastructure}` 仓储三文件、迁移测试更新。Modify：contracts index。

## 测试矩阵（S8PO）

- S8PO01 迁移正反：V1–V11 兼容、种子就位、角色矩阵（平台列级 UPDATE/worker 只读）
- S8PO02 订单幂等创建（同 order_ref 返回同单）；beneficiary 形状 CHECK 拒绝（明文/坏摘要）
- S8PO03 provider_idempotency_key UNIQUE 拒绝第二单同键
- S8PO04 状态机 CHECK 拒绝非法值；形状 CHECK（SUCCEEDED 无收口被拒）
- S8PO05 provider_configs 版本切换（新版本活跃、旧行保留）；callback_secret_ref 无密钥本体形状

## 停止条件

V1–V11 兼容破坏、收款人列出现任何明文倾向、密钥本体入库。
