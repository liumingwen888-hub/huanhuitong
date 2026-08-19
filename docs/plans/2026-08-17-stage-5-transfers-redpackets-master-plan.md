# 阶段 5 内部转账、领取链接和红包 总体规划

计划版本：`v0.1（需求确认中）`。计划状态：`DRAFT`。交付状态：`DESIGNING`。

基线：阶段 1–4 VERIFIED（2026-08-17 用户验收通过）。

## 目标

在已验证的复式账本和充值管道上，建立**用户间资金转移能力**：内部转账（uid→uid）、领取链接（一次性领取）和红包（创建/领取/退款），全部经 S3-2 过账内核原子记账。

## 任务分解草案（v0.1）

| # | 任务 | 内容 |
|---|---|---|
| S5-1 | 转账领域合同 | InternalTransferCommand/Result、状态机（PENDING→EXECUTED/FAILED）、V7 迁移（transfer_orders 表：订单号/金额/资产/付款人/收款人/费用/状态/幂等键 UNIQUE） |
| S5-2 | 转账执行服务 | 余额校验（RiskGate）→ S3-6 internalTransfer 模板 → PostMoneyService → 状态更新 → Outbox 通知；幂等（订单号 UNIQUE）；并发安全（行锁+余额防线兜底） |
| S5-3 | 领取链接 | ClaimLinkCommand、claim_links 表（链接 ID/领取码/金额/资产/创建人/状态/过期时间/领取人）；一次性领取 CAS；过期退款 |
| S5-4 | 红包 | 红包创建（S3-6 redPacketCreated）→ 领取（claimExecuted）→ 退款（redPacketRefunded）；红包表（红包 ID/总额/个数/类型/状态）；并发领取恰一 |
| S5-5 | Telegram UX | /transfer、/claim、/redpacket 命令路由；输入验证；余额展示；通知 |
| S5-6 | 威胁模型与验收 | 转账/领取/红包全链路验收（含并发/幂等/退款/过期） |

## 核心设计决策（需确认）

1. **转账即时性**：内部转账即时到账（无确认等待——账本内操作，非链上）。
2. **领取链接过期**：默认 24 小时，可配置；过期自动退款（定时任务或惰性检查）。
3. **红包类型**：普通红包（固定金额）vs 拼手气（随机金额）——先做普通，拼手气留后续。
4. **费用**：内部转账免费（阶段 1 决策）；归集/提现/换汇才有链上或供应商费用。

## 前置条件

- S3-6 internalTransfer / claimExecuted / redPacketCreated/Refunded 模板已就绪 ✅
- S3-2 PostMoneyService 已验证 ✅
- S3-4 RiskGate 已实现 ✅
- 支付密码验证（阶段 2）可作为转账确认 ✅

## 授权现状

阶段 5 代码实施授权为 0；V7 migration 须显式授权。
