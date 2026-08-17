# 领域地图

需求状态：APPROVED。交付状态：DESIGNING。

## 分层

适配层包括 telegram-experience、未来 App 与 admin-web；它们依赖应用用例，不被领域核心反向依赖。领域核心由身份、安全、托管、账本与各资金产品模块组成。平台支持层提供对账、运营、集成可靠性和可观测性。

## 依赖方向

1. identity-and-membership 提供 UID、会员、最小资料、注册幂等记录与渠道绑定，可发布无资金效果的 UidCreated；它不创建具体资产账户。
2. account-security-and-recovery 依赖 UID，提供支付授权、安全状态与恢复决定。
3. asset-custody 定义资产、网络、地址和链上能力。
4. ledger-and-balances 依赖 UID 与已批准资产目录，是唯一资金写入口；资产账户由应用编排显式幂等开通或按批准策略懒创建，不由身份事务或 UidCreated 直接创建。
5. deposits、internal-transfers、claims、red-packets、withdrawals、exchange、fiat-payouts 通过公开命令使用账本，不访问余额表内部。
6. fees-and-risk 在第一个资金功能前提供最小费用、风险和限额合同，随后渐进扩展运营能力；它不能直接过账。
7. bills-and-reconciliation 在第一个资金功能前提供订单到账本的最小对账接口，随后扩展外部资产、供应商和差异案件；它不更改历史分录。
8. admin-and-audit 在第一个资金功能前提供服务端授权、追加式审计和配置版本；提现前补齐独立管理员身份、Maker-Checker、重新认证与 Signer 策略审批；它不直接写领域表。
9. platform-operations 从阶段 1 提供事务/UoW、Inbox/Outbox、持久任务、结构化日志、OpenTelemetry 接口、配置校验和敏感字段过滤，阶段 10 再完成生产级容量、恢复和发布加固；它不解释业务成功。
10. telegram-experience 与 future-apps-and-integrations 只做通道适配。

阶段 1 v1.2 明确 grammY 仅存在于 Telegram adapter；adapter 把合法 Update 映射为项目内部命令或 ignored 结果，identity/reliability 不导入 grammY 类型。Inbox 冲突、Outbox 租约和配置暂停属于 platform-operations 的公开可靠性合同，领域不自行绕过。

## 领域协作

跨领域协作使用同进程显式应用服务或版本化事件；禁止读取别的领域私有表来绕过接口。同步调用只用于必须在同一事务确认的资格、授权与记账；通知、扫描、外部查询和对账走 Outbox/Inbox/持久任务。领域清单和所有权见 [domains/README.md](../domains/README.md)。

横切领域采用“早期最小合同、随资金阶段扩展、后期运营成熟化”的交付方式。领域依赖表示调用方向，不表示被依赖领域要等到路线图后期才首次实现。

## 阶段 1 实施事实（2026-08-17）

identity-and-membership、ledger 边界前的 reliability 平台层与 telegram-experience 适配层已实施；`no-domain-to-telegram` 等四规则由 depcruise 机器强制（`pnpm architecture:check`，84 模块 0 违规）。资金领域（阶段 3+）未开始。
