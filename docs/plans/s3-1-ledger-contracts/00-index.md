# S3-1 账本领域合同与 V3 迁移 详细计划索引

计划版本：`v1.0`。风险级别：`L3`。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S3-1 代码状态：`NOT_STARTED`。

## 权威需求来源

[ledger-model](../../architecture/ledger-model.md)（核心结构/金额规则/并发冲正）、[AGENTS 资金红线](../../../AGENTS.md)、[阶段 3 总体规划 v1.0](../2026-08-17-stage-3-ledger-master-plan.md)（开通策略方案 A）。

## 目标

1. **V3 migration**（首个资金 schema，须显式授权）：
   - `asset_catalog`：asset_id/network/symbol/decimals/status（合成种子：USDT-TRC20、USDT-ERC20、BTC、ETH、USD 法币记账资产——真实清单 P0 阶段 4 前裁决）；platform 读写、worker 只读。
   - `ledger_accounts`：account_id PK、owner_uid（用户类账户必填/平台类 NULL）、asset_id、purpose 枚举（USER_AVAILABLE/USER_FROZEN/USER_IN_TRANSIT/PLATFORM_CUSTODY/USER_LIABILITY/CLAIM_LIABILITY/FEE_INCOME/UPSTREAM_COST/CLEARING_DIFF）、status（ACTIVE/FROZEN/CLOSED）、version 并发计数、UNIQUE(owner_uid, asset_id, purpose)（平台账户 owner NULL 由种子保证单例）。
   - `ledger_transactions`：transaction_id PK、idempotency_key UNIQUE（业务类型+订单+操作+重试代次）、transaction_type（含 REVERSAL）、reversed_transaction_id 自引用、status（POSTED/REVERSED）、created_at。
   - `ledger_entries`：entry_id PK、transaction_id FK、account_id FK、direction（DEBIT/CREDIT）、amount BIGINT CHECK(>0)、entry_index；"transaction 借贷平衡"由内核+触发器级 CHECK 辅助（sum(debit)=sum(credit) per transaction 用 CONSTRAINT TRIGGER 实现或内核+断言测试双保险——计划裁决：**内核强校验 + 交付测试证明**，触发器作为 DB 最后防线用 CONSTRAINT TRIGGER 实现）。
   - 历史不可变：entries 无 UPDATE/DELETE 授权（任何角色）；冲正=新交易引用原交易。
   - `account_openings`：显式幂等开通记录（owner/asset/purpose/请求幂等键 UNIQUE）。
2. **contracts**：LedgerAccountId 品牌、MoneyAmount（十进制字符串+decimals 携带）、PostMoneyCommand/PostingResult、账户用途/方向/类型枚举、错误码族。
3. **仓储接口**：账户（find/open 显式幂等/版本）、交易（幂等键查重）、条目只插入；金额读写全字符串。
4. 测试：迁移正反（V3 后 V1/V2 数据完整、角色矩阵：entries 零 UPDATE/DELETE、worker 只读、平台无 DROP）、合同解析防御、种子目录约束。

## 冻结未来工程矩阵

Create：`database/migrations/V3__stage_3_ledger_core.sql`、`packages/contracts/src/ledger.ts`、platform `modules/ledger/{domain,application,infrastructure}` 五文件、database spec。Modify：contracts index、testing fixture 迁移清单（如需，按先例登记）。

## 停止条件

V1/V2 兼容破坏、需要超出矩阵 schema、三锁漂移、migration 授权未获批、金额任何路径出现 JS number 承载。
