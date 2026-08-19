# 最近验证

## 2026-08-17 — S5-5 Telegram UX 接线实施（macOS/arm64 本地）

- 写入：Create 3（transfer-commands.ts 分类器、transfer-replies.ts 零动态插值常量、transfer-command.handler.ts 编排）+ Modify 1（controller 扩展 transfer 命令分支）+ unit spec。
- **四条命令**：/transfer（解析对方 Telegram ID + 金额→resolveUid→TransferExecutionService）；/claim（领取码→ClaimLinkService）；/redpacket（总金额+个数→RedPacketService）；/balance（余额查询占位）。
- **命令分类器**：复用 S2-6 security-commands 模式（私聊/有效 from.id/严格正则校验）；零动态插值回复常量（静态断言锁定）。
- **Controller 扩展**：transfer 命令在 security 命令之前检查（互不冲突——前缀不同）；Inbox 幂等由 controller digest 层保证。
- 验证：S5-5 unit spec 3/3（分类矩阵、畸形拒绝、零动态插值静态断言）。全量 unit 226/226、db 368/403（M06/M14/M16 已知边界）、architecture 0 违规（146 模块）、三锁无漂移。

## 2026-08-17 — S5-4 红包服务实施（macOS/arm64 本地）

- 写入：Create 2（red-packet.service.ts、database spec）。
- **RedPacketService**：
  - createPacket：DR creator / CR CLAIM_LIABILITY（冻结总额）+ 金额整除校验 + 24h 过期；
  - claimPacket：DR LIABILITY / CR claimer（每人固定金额）+ UNIQUE 防重复 + 领完自动 DEPLETED；
  - 惰性过期退款：DR LIABILITY / CR creator（仅退剩余未领取部分，已领不退）。
- 验证：S5-4 spec 5/5——创建冻结（01）、多人领取各得正确金额（02）、重复领取拒绝（03）、领完 DEPLETED+后续拒绝（04）、过期仅退剩余（05）。全量 unit 223/223、db 368/403（M06/M14/M16 已知边界）、architecture 0 违规（143 模块）、三锁无漂移。
- 实施期修正：过期退款余额断言从 -500000 改为 -900000（退还后 creator 持有 900000 = 700000 剩余 + 200000 退回；signed = -900000）。

## 2026-08-17 — S5-3 领取链接服务实施（macOS/arm64 本地）

- 写入：Create 2（claim-link.service.ts、database spec）。
- **ClaimLinkService**：
  - createLink：DR creator 可用 / CR CLAIM_LIABILITY（冻结）+ claim_code + 24h 过期 + 通知；
  - claim：DR CLAIM_LIABILITY / CR claimer 可用（释放）+ markClaimed CAS + 双端通知；
  - 惰性过期退款：领取时发现 expires_at 已过 → DR CLAIM_LIABILITY / CR creator 可用（退回）+ markExpired + 通知。
- 验证：S5-3 spec 5/5——创建冻结正确（01）、领取释放正确（02）、重复领取拒绝（03）、过期退款（04）、不存在返回 not_found（05）。全量 unit 223/223、db 363/398（M06/M14/M16 已知边界）、architecture 0 违规（142 模块）、三锁无漂移。

## 2026-08-17 — S5-2 转账执行服务实施（macOS/arm64 本地）

- 写入：Create 2（transfer-execution.service.ts、database spec）。
- **TransferExecutionService**：
  - execute：幂等查重（EXECUTED 返回既有）→ PENDING 订单 → ensureAccount 双方 → internalTransfer 模板 → PostMoneyService 过账 → markExecuted CAS → **双端 Outbox 通知**（transfer-sent + transfer-received）；
  - 失败路径：过账异常 → markFailed(reason) + 零余额变化 + 不自动重试；
  - 并发安全：PostMoneyService 行锁 + 余额防线 + order_ref UNIQUE。
- 验证：S5-2 spec 4/4——正常转账+余额+双端通知（01）、幂等重放零新行（02）、余额不足失败+零变化+零通知（03）、**并发双花恰一成功**（04）。全量 unit 223/223、db 358/393（M06/M14/M16 已知边界）、architecture 0 违规（141 模块）、三锁无漂移。

## 2026-08-17 — S5-1 转账领域合同与 V7 迁移实施（macOS/arm64 本地）

- 授权：用户复审 S5-1 v1.0 通过并显式授权 V7 migration。
- 写入：Create 5（V7__stage_5_transfers_redpackets.sql、contracts/transfers.ts、platform transfers domain/application/infrastructure 三层、database spec）+ Modify（contracts index）。
- **V7 四表**：transfer_orders（UNIQUE(order_ref) 幂等 + FK 链 + 执行形状 CHECK）；claim_links（UNIQUE(claim_code) 一次性 + 过期检测）；red_packets + red_packet_claims（UNIQUE(packet_id, claimer_uid) 同一用户唯一领取 + ON CONFLICT DO NOTHING）。
- 验证：S5-1 spec 6/6——幂等创建（01）、同 sender/recipient 拒绝（02）、claim 链接一次性（03）、过期检测（04）、红包同用户唯一（05-06）、worker 只读（07）。全量 unit 223/223、db 354/389（M06/M14/M16 已知边界）、architecture 0 违规（140 模块）、三锁无漂移。
- 实施期修正（如实登记）：① FK 约束——测试中用 dummy ledger_transactions 行满足 FK（claim_links 和 red_packet_claims 均引用 ledger_transactions）；② claimPacket 加 ON CONFLICT DO NOTHING（UNIQUE 违约返回 false 而非异常）。

## 2026-08-17 — S4-8 阶段 4 验收（macOS/arm64 本地）

- **7 个测试块（14 项验收 S4A01–14）全部 PASS**：地址确定性/唯一/轮换（01-03）、检测记录+RETIRED跳过（04-05）、确认CAS+重组+幂等（06-08）、入账+余额+通知+自动开户（09-11）、归集广播+过账（12）、链上对账差异+告警（13）、deposits 零渠道依赖（14）。
- 全量回归：unit 223/223、architecture 0 违规（136 模块）、integration 含阶段验收全过。
- 威胁模型增补 9 项充值威胁→控制→证据映射。
- **阶段 4 代码 READY 等待用户验收**（充值全链路：地址→检测→确认→入账→归集→对账；四项长期授权保持 0）。

## 2026-08-17 — S4-7 链上对账实施（macOS/arm64 本地）

- 写入：Create 2（chain-reconciliation.service.ts、database spec）+ Modify 2（scanner port 补 getAddressBalance + fake 实现）。
- **ChainScannerPort 扩展**：getAddressBalance(network, addressText)——FakeChainScanner 支持 setAddressBalance 注入预期余额。
- **ChainReconciliationService**：reconcileAll——链上余额 vs POSTED 检测累计逐地址对比；差异→结构化报告（chainBalance/ledgerBalance/difference）→幂等告警写 risk_decisions。
- 验证：S4-7 spec 5/5——匹配零差异（01）、链上>账本差异+告警（02）、链上<账本差异（03）、幂等告警不重复（04）、多地址批量（05）。全量 unit 223/223、db 355/383（M06/M14/M16 已知边界）、architecture 0 违规（136 模块）、三锁无漂移。
- 实施期修正（如实登记）：差异告警 uid 引用从 ledger_accounts 改为 users 表（测试环境无 ledger_accounts 行导致 FK 违约）。

## 2026-08-17 — S4-6 归集 Sweep 服务实施（macOS/arm64 本地）

- 写入：Create 3（transaction-broadcaster.port.ts + fake-broadcaster.ts、deposit-sweep.service.ts、database spec）。
- **TransactionBroadcasterPort**：broadcast + getStatus——纯接口，测试用 FakeBroadcaster（可配置费率/失败/状态）。
- **DepositSweepService**：
  - findSweepCandidates：按 POSTED 检测金额累计≥阈值筛选（GROUP BY address HAVING SUM >= threshold）；
  - sweepAddress：广播→归集过账（DR custody/CR custody 资产转移 + DR upstream_cost/CR custody 费用）；
  - sweepAll：批量执行，返回 outcomes 明细（含失败原因）；
  - 平台承担链上费用（用户到账不变）。
- 验证：S4-6 spec 5/5——阈值候选识别（01）、低于阈值跳过（02）、归集过账+广播（03）、广播失败不记账（04）、多地址批量（05）。全量 unit 223/223、db 350/378（M06/M14/M16 已知边界）、architecture 0 违规（135 模块）、三锁无漂移。

## 2026-08-17 — S4-5 充值入账编排实施（macOS/arm64 本地）

- 写入：Create 2（deposit-posting.service.ts、database spec）。
- **DepositPostingService**：CONFIRMED 检测→S3-6 depositConfirmed 模板→S3-2 PostMoneyService 过账→CAS POSTED + ledger_transaction_id→Outbox 通知。三层幂等：应用层（ledgerTransactionId 跳过）+ 账本层（幂等键 UNIQUE）+ 状态层（CAS）。
- 验证：S4-5 spec 5/5（含 S4PO00 直接过账验证）——确认检测入账+余额+通知（01）、幂等重放零新行（02）、多笔批量（03）、用户账户自动开通（04）。全量 unit 223/223、db 345/373（M06/M14/M16 已知边界）、architecture 0 违规（132 模块）、三锁无漂移。
- **根因修复（值得记录）**：**V6 GRANT 缺 `ledger_transaction_id` 列**——deposit_detections 的 UPDATE 授权未包含新增列，`#markPosted` 被 42501 拒。通过定位"poster 成功但 markPosted 失败"（逐步标记法）发现。另修复测试查询列名（uid→owner_uid）。
- **充值全链路打通**：链上交易→检测（S4-3）→确认（S4-4）→入账过账（S4-5）→余额增加→Outbox 通知。用户从地址收款到看到余额的完整管道就绪。

## 2026-08-17 — S4-4 确认等待与重组处理实施（macOS/arm64 本地）

- 写入：Create 2（deposit-confirmation.service.ts、database spec）+ Modify（V6 补 ledger_transaction_id 列）。
- **DepositConfirmationService**：
  - processConfirmations：DETECTED + 确认达标 → CAS 转 CONFIRMED（幂等——已 CONFIRMED 跳过）；
  - processReorg：POSTED → 冲正（如有 Reverser）或标记（无 Reverser）；CONFIRMED → 阻止；DETECTED → 阻止——全部转 REORG_DETECTED 作为审计痕迹；
  - refreshConfirmations：批量刷新已有检测的确认数（S4-3 遗留完善）；
  - **UNKNOWN 不推断**：无 Reverser 时 POSTED 标记但不自动冲正/重付。
- 验证：S4-4 spec 6/6——确认推进（01）、阈值+幂等（02）、重组 CONFIRMED→阻止（03）、POSTED 无 Reverser→标记（04）、DETECTED→阻止（05）、不存在 txid 零操作（06）。全量 unit 223/223、db 340/368（M06/M14/M16 已知边界）、architecture 0 违规（131 模块）、三锁无漂移。

## 2026-08-17 — S4-3 充值检测 Worker 实施（macOS/arm64 本地）

- 写入：Create 3（chain-scanner.port.ts + fake-chain-scanner.ts、deposit-detection.worker.ts、database spec）。
- **ChainScannerPort 接口**：getLatestBlockNumber + getTransactionsForAddress——第三方 RPC 适配器接口；FakeChainScanner 确定性注入+按地址/区块范围过滤+确认数更新。
- **DepositDetectionWorker**：读 checkpoint→获取 ACTIVE 地址→逐地址扫描→upsertDetection 幂等（GREATEST 确认数）→checkpoint 单调递增（INSERT DO NOTHING + UPDATE WHERE <）。
- 验证：S4-3 spec 5/5——注入交易检测记录（01）、同交易重扫确认数更新非新建（02）、多地址多交易（03）、checkpoint 推进+不回退（04）、RETIRED 地址跳过（05）。全量 unit 223/223、db 334/362（M06/M14/M16 已知边界）、architecture 0 违规（130 模块）、三锁无漂移。
- 实施期修正（如实登记）：① **V6 GRANT 缺 INSERT**——chain_scan_checkpoints 只授了 SELECT/UPDATE，Worker 的 INSERT 被拒 42501（根因通过逐步调试定位：upsert 成功但 checkpoint 败）；② S4DW02 确认更新需 checkpoint 回退（第二次扫描范围已跳过原区块——设计语义：确认跟踪独立于新交易扫描，留 S4-4 完善）。

## 2026-08-17 — S4-2 地址生成与分配服务实施（macOS/arm64 本地）

- 写入：Create 2（deposit-address.service.ts、database spec）。Modify 0。
- **DepositAddressService**：
  - getOrCreateAddress find-or-create + 地址复用（同 uid+asset 恒同 ACTIVE 地址）；
  - 并发安全（S4AS02 双连接真并发恰得一地址）；
  - 资产→网络映射（USDT-TRC20→TRON / USDT-ERC20+ETH→ETHEREUM / BTC→BITCOIN / USD-FIAT→DEPOSIT_NETWORK_UNSUPPORTED 拒绝）；
  - retireAddress（轮换）/ markCompromised（安全事件）→ 下次 getOrCreate 自动新地址（索引递增）；
  - CAS 状态转换（重复 retire 返回 false）。
- 验证：S4-2 spec 4/4。全量 unit 223/223、db 329/357（M06/M14/M16 已知边界）、architecture 0 违规（127 模块）、三锁无漂移。
- 实施期修正（如实登记）：法币资产拒绝断言改为 DEPOSIT_NETWORK_UNSUPPORTED（原误写 TRANSACTION_CALLBACK_FAILED——UoW 外抛错不包装）。

## 2026-08-17 — S4-1 地址领域合同与 V6 迁移实施（macOS/arm64 本地）

- 授权：用户复审 S4-1 v1.0 通过并显式授权 V6 migration。
- 写入：Create 5（V6__stage_4_deposit_addresses.sql、contracts/deposits.ts、platform deposits domain/application/infrastructure 三层 + FakeDerivationSource、database spec）+ Modify（contracts index）。
- **V6 五表**：deposit_addresses（UNIQUE(network,address_text) + UNIQUE(asset_code,derivation_index)——地址唯一且派生索引单调）；address_assignments（幂等键 UNIQUE）；deposit_detections（UNIQUE(network,txid,address_id)——同交易对同地址只检测一次 + 确认数 GREATEST UPSERT）；chain_scan_checkpoints（每网络扫描进度）；confirmation_policies（复合 PK(version,network) + UNIQUE(network)——TRON 19/ETH 12/BTC 6 种子）。
- **FakeDerivationSource**：确定性 fake（SHA-256 hash → 地址文本 + BIP-44 路径），同 (network,index) 恒同地址——零真实密钥。
- 验证：S4-1 spec 7/7——确认策略种子（01）、地址确定性创建+查找闭环（02）、派生索引单调（03）、不支持网络拒绝（04）、检测幂等 UPSERT（05）、确认阈值→CONFIRMED 检测→POSTED 状态转换→过期拒绝（06）、worker 只读权限（07）。全量 unit 223/223、db 326/353（M06/M14/M16 已知边界）、architecture 0 违规（126 模块）、三锁无漂移。
- 实施期修正（如实登记）：① confirmation_policies PK 改为复合 (version, network)——三网络同版本插入违反单列 PK；② deposit_addresses GRANT 列修正（原引用了 detections 表的 updated_at/confirmations 列）。

## 2026-08-17 — S3-7 阶段 3 验收（macOS/arm64 本地）

- **11 个测试块（12 项验收 S3A01–12）全部 PASS**：空账本零差异（01）、幂等重放零新行（02）、超支拒绝零写入（03）、entries 不可变权限实证（04）、并发双花恰一（05）、冲正全链+二次拒绝+余额归零（06-07）、投影实时一致（08）、篡改→校验→重建→清零（09）、模板过账投影正确（10）、横切三接口（费率+风险+管理员 RBAC）（11）、ledger 零渠道依赖（12）。
- 全量回归：unit 223/223、architecture 0 违规（121 模块 157 依赖）、integration 含阶段验收全过、docs:check 通过。
- 威胁模型增补 9 项资金威胁→控制→证据映射。
- **阶段 3 代码 READY 等待用户验收**（S2-7 模式：验收不产生部署授权，四项长期授权保持 0）。

## 2026-08-17 — S3-6 记账模板实施（macOS/arm64 本地）

- 写入：Create 2（posting-templates.ts 含 13 个模板函数、database spec）。Modify 2（posting/reverse 两服务的 DEBIT_NORMAL_PURPOSES 集合修正——按 S2-4 先例登记）。
- **13 个模板函数**（七大场景全覆盖）：depositConfirmed、internalTransfer（含费用腿）、claimExecuted、redPacketCreated/Refunded、withdrawalRequested/Succeeded/Failed、exchangeFrozen/Settled（双腿清算差中间）、fiatPayoutRequested/Succeeded/Failed。全部纯函数：构造合法 PostMoneyCommand + 标准化幂等键（业务类型:订单:操作:代次），不做校验（内核管）。
- 验证：S3-6 spec 7/7——全部经真实数据库过账验证（借贷平衡由触发器证明、投影变化逐账户断言、幂等键格式、负余额拒绝 S3T12）。全量 unit 223/223、architecture 0 违规（121 模块）、三锁无漂移。
- **实施期三项真实缺陷修正（测试驱动）**：
  ① FEE_INCOME 从借方正常重分类为贷方正常（收入随贷方增加——标准会计语义；原分类导致费用腿被内核拒绝）；
  ② CLEARING_DIFF 从借方正常集合移除（清算差异可正可负——约束它导致 bootstrap 注入后后续过账被误拒）；
  ③ withdrawalSucceeded/fiatPayoutSucceeded 的费用腿从冻结账户改到可用账户（原设计 DR 冻结(金额+费用)但只有金额被冻结，费用从未入冻——超支拒绝）。

## 2026-08-17 — S3-5 订单关联与对账接口实施（macOS/arm64 本地）

- 写入：Create 3（reconciliation.service.ts、worker reconciliation-task.ts、database spec）。Modify 0。
- **ReconciliationService**（纯读，零写账本）：
  - checkGlobalBalance：每资产借贷净和≠0 差异（S3R02 实证——禁用触发器注入不平衡行后捕获）；
  - checkProjectionConsistency：投影 vs SUM（S3R03 篡改→差异→告警→同窗幂等→异窗新告警）；
  - checkAccountIntegrity：FROZEN/CLOSED 账户有创建后分录的交叉校验；
  - recordDiscrepancyAlerts：差异写入 risk_decisions（RECONCILIATION_DISCREPANCY，幂等键=窗口+类型+目标）；
  - findTransactionByOrderKey：幂等键片段反查 transactionId（S3R04 订单查询闭环）。
- **Worker ReconciliationTask**：动态加载 platform dist，三检查→告警→幂等窗口；不自动修复。
- 验证：S3-5 spec 4/4（干净零差异/注入不平衡捕获/投影篡改+幂等告警/订单反查）。全量 unit 223/223、db 317/320（M06/M14/M16 已知边界）、architecture 0 违规（120 模块 157 依赖——跨包动态导入被门禁正确忽略）、三锁无漂移。
- 实施期修正（如实登记）：① worker 任务引用 platform 源码触发 rootDir 约束——改为动态加载 dist（结构化 Pool 类型，不依赖 @types/pg）；② S3R02 注入不平衡需临时禁用触发器（正常路径触发器在 COMMIT 已拒绝——对账是最后防线语义）。

## 2026-08-17 — S3-4 横切最小合同实施（macOS/arm64 本地）

- 授权：用户复审 S3-4 v1.0 通过并显式授权 V5 migration。
- 写入：Create 2（V5__stage_3_crosscutting.sql、crosscutting.services.ts 含四接口）+ database spec。
- **V5 六表**：fee_schedules（版本化费率/无 DELETE 权限）、risk_decisions（追加幂等/七操作类型）、operation_limits（窗口限额/UNIQUE(uid,type)）、config_versions（key+version 唯一）、admin_principals + admin_role_grants（独立管理员身份与五角色 RBAC/撤销时间戳）。
- **四接口**：FeeCalculator（最新版本费率=基点+固定额；纯读零写账本）；RiskGate（限额超量拒绝 + 幂等键重放返回原裁决 + **fail-closed**异常关闭——已实测）；ConfigStore（当前版本读取 + 版本激活追加）；AdminAuthorizer（查 ACTIVE principal + 未撤销 grant → allow/deny）。
- 验证：S3-4 spec 6/6——费率计算/未知资产拒绝（01）、限额超量拒绝+幂等重放（02）、无限制放行+决策落库（03）、配置版本激活+历史不可变+缺失拒绝（04）、管理员 RBAC 授权/撤销/角色隔离/无效 ID 全拒（05）、费率表不可删（06）。全量 unit 223/223、db 313/315（M14/M16 已知边界）、architecture 0 违规（111 模块）、三锁无漂移。
- 实施期修正（如实登记）：① FeeCalculator/ConfigStore 抛错位置移到 UoW 外（避免被包装为 TRANSACTION_CALLBACK_FAILED）；② RiskGate 窗口聚合查询引用不存在的 payload 列——移除死代码路径（窗口计数逻辑留给 S3-5 对账接口时正确实现，风险决策当前依赖 max_amount 单笔限额 + fail-closed 兜底）。

## 2026-08-17 — S3-3 余额投影实施（macOS/arm64 本地）

- 授权：用户复审 S3-3 v1.0 通过并显式授权 V4 增量迁移。
- 写入：Create 3（V4__stage_3_balance_projection.sql、balance-query.service.ts、database spec）+ Modify 3（S3-1 仓储接口投影三方法、S3-2 两服务同事务投影同步、两既有 spec 清理顺序——均按先例登记）。
- **V4**：account_balances（account_id PK、signed_balance 同内核符号、last_transaction_id FK）；platform SELECT/INSERT/UPDATE、worker 只读、**无 DELETE 权限**（重建=UPSERT 覆盖）。
- **内核同步**：post/reverse 成功路径同事务 applyProjectionDelta（受影响账户净额 UPSERT）——投影与条目零延迟一致。
- **BalanceQueryService**：accountBalanceOf（业务查询唯一通道）、verifyProjection（投影 vs entries SUM 差异清单）、recomputeAll（以条目为源幂等重建）。
- 验证：S3-3 spec 5/5——过账后投影即时准确且 verifyProjection 零差异（01）、冲正精确回退（02）、幂等重放零漂移（03）、**篡改→校验捕获→重建修复→差异清零**（04）、投影不可删除（05）。全量：unit 223/223、database 299/302+27 skip（M06/M14/M16 并行负载与平台边界）、architecture 0 违规（110 模块）、三锁无漂移。
- 实施期修正（如实登记）：① 投影 FK 阻断测试清理——清理顺序 account_balances 前置；② bootstrap 原始 SQL 注入须经 recomputeAll 对齐投影（真实语义：维护操作由重建任务覆盖）。

## 2026-08-17 — S3-2 过账内核实施（macOS/arm64 本地）

- 写入：Create 4（post-money.service.ts、reverse-transaction.service.ts、unit/database 双 spec）+ Modify 3（contracts ledger 错误码增补 NEGATIVE/ALREADY_REVERSED、S3-1 仓储接口五方法、V3 约束修正——均按先例登记）。
- **PostMoneyService**（唯一资金写入口）：命令防御（复用）→ REVERSAL 类型拒入 → 幂等键查重（命中返回 existing posted:false）→ 按账户聚合净额 → **排序行锁**（防死锁）→ 账户存在/ACTIVE 校验 → **用途感知的正常余额防线**（借方正常用途 signed≥0；贷方正常用途 signed≤0）→ 原子过账 → version 递增。
- **ReverseTransactionService**：原交易 POSTED 校验 → 全行反向 REVERSAL 新交易（引用原交易）→ 同防线 → 原交易 status=REVERSED + reversed_by 标记（CAS）→ 二次冲正拒绝；幂等键复用返回。
- 验证：S3-2 spec 11/11——过账落库+version（S3PE01）、幂等重放零新行（02）、缺失/FROZEN 拒绝（03）、REVERSAL 拒入（04）、**超支拒绝零写入**（05）、**并发双花恰一成功**（06，真双连接）、冲正全链+二次拒绝（07）、聚合累积（08）；unit 防御 3/3。
- 实施期裁决与缺陷修复（如实登记，测试驱动）：① **余额符号语义修正**——借方正常（托管/费用/上游/清算差）与贷方正常（用户三用途+两负债）防线方向相反，原统一"<0 拒绝"会阻断对用户负债的贷记（真实会计缺陷）；② V3 冲正形状 CHECK 矛盾修正——被冲正的原交易也携带 reversed_by，约束改为仅要求 REVERSAL 必须引用（V3 checksum 变更，测试容器每次全新无影响）；③ 测试资金流按 ledger-model 模板对齐（DR 托管/CR 用户负债；bootstrap 经 CLEARING_DIFF 注入）。
- 全量：unit 223/223、database 315/317+7 skip（M14/M06 已知边界）、architecture 0 违规（109 模块）、三锁无漂移。

## 2026-08-17 — S3-1 账本领域合同与 V3 迁移实施（macOS/arm64 本地）

- 授权：用户复审 S3-1 v1.0 通过并显式授权 V3 migration（首个资金 schema）。
- 写入：Create 6（V3__stage_3_ledger_core.sql、contracts/ledger.ts、platform ledger domain 双文件 + application 接口 + infrastructure 双仓储 + database spec）+ Modify（contracts index）。
- V3 五表落地：asset_catalog（5 合成种子）；ledger_accounts（九用途、用户/平台所有权形状 CHECK、并发版本、UNIQUE(owner,asset,purpose)）；ledger_transactions（幂等键 UNIQUE、九类型、REVERSAL 必须引用原交易形状 CHECK）；ledger_entries（只插、BIGINT>0、索引唯一、**DEFERRABLE CONSTRAINT TRIGGER 强制借贷平衡**——未平衡在 COMMIT 拦截）；account_openings（方案 A 显式幂等开通，UNIQUE 键）。权限：entries 任何角色零 UPDATE/DELETE；transactions 仅 status/reversed_by 可更；worker 只读。
- 合同与防御：MoneyAmount 十进制字符串；parsePostMoneyCommand（Proxy/访问器防御、正整数金额、≥2 行、BigInt 借贷平衡校验）；仓储（openUserAccount ON CONFLICT + openings 记录 + 竞态回读；insertPostedTransaction 全行插入）。
- 验证：S3-1 spec 7/7（种子/CHECK 拒绝/幂等开通/命令防御/平衡过账+未平衡 COMMIT 拦截/幂等键唯一+不可变实证（platform UPDATE/DELETE 42501；bootstrap 例外登记）/worker 只读）；全量 unit 220/220、database 307/309+7 skip（M14/M06 已知边界）、architecture 0 违规（107 模块）、三锁无漂移。
- 实施期裁决（如实登记）：① **USER_LIABILITY/CLAIM_LIABILITY 重分类为平台聚合账户**（owner NULL）——个人头寸在 AVAILABLE/FROZEN/IN_TRANSIT，聚合负债/领取负债镜像全体义务（测试暴露原归类矛盾）；② 未平衡分录在 COMMIT 被延迟触发器拦截 → UoW 如实报 TRANSACTION_COMMIT_OUTCOME_UNKNOWN（断言接受两种失败码）；③ 阶段 1 边界断言合法演进（M13 限定九张阶段 1 表、18 号改为"identity-only 库零账本行"、documentation 阶段标记跟随路线图）。

## 2026-08-17 — S2-7 威胁模型与阶段 2 验收（macOS/arm64 本地）

- 写入：Create 1（stage-two-acceptance.integration.spec.ts，S2A01–16 编号连续）+ Modify（threat-model.md 增补 9 项威胁→控制→证据映射）。
- **16 项验收全部 PASS**：泄漏矩阵（五表零密码材料 + 日志零敏感 + span 零通道）；暴力（5 次锁定、第二次锁定 1800s 阶梯、锁定短路）；重放（nonce 零效果、update duplicate）；生命周期（缓冲清零、重哈希升级可再验证）；恢复（四因子→APPROVED→COOLDOWN→authorize 受限；不足失败关闭）；集成（Bot UX 全链 setup→authorize，全表零密码材料）；架构（security 模块零渠道依赖）。
- **验收抓到并修复 2 项真实缺陷**：① 逐位 nonce 含数字字符——重复数字（919191）误判重放导致输入丢失（位置化 nonce 修复）；② 阶梯锁定按绝对尝试数计算——锁定窗口阻断后续尝试使阶梯不可达（改按 security_locks 锁定事件计数）。
- 全量回归：unit 220/220、database 301/302+7 skip（仅 M14 平台边界，M06 本轮 PASS）、integration 12/12（acceptance）+ 全部既有、architecture 0 违规（102 模块）、docs:check 通过、三锁无漂移。
- 状态收敛：S2-7 `IMPLEMENTED`；**阶段 2 代码 READY 等待用户验收**（验收不产生部署授权——四项长期授权保持 0）。

## 2026-08-17 — S2-6 Telegram 安全 UX 接线实施（macOS/arm64 本地）

- 写入：Create 4（security-replies.ts 零动态常量、security-commands.ts 分类器、security-command.handler.ts 编排、unit/database 双 spec）+ Modify 3（controller 安全旁路 + createPlatformApp securityHandler 透传 + worker 提示投递——两项为 S2-4 先例登记的计划外最小增补；gateway 接口 sendPrompt 可选方法）。
- 全链实证：/setpassword → 数字两段 → /done×2 → ACTIVE + 会话 CONFIRMED + 静态提示 3 条入 Outbox（S6D01）；不一致 FAILED 零入库（S6D02）；无会话数字零副作用（S6D03）；同 update_id 重放 duplicate 零新提示（S6D04）；cancel 终止会话与输入流（S6D05）；/authorize 演示流 authorized 且提示零密码/零订单材料（S6D06）；Inbox/Outbox/audit 全载荷零数字材料（S6D07）；分类矩阵与静态断言（S6U01–03）。
- 架构裁决（如实登记）：① 嵌套 UoW 被 Task 4 防逃逸拒绝——编排改为三段式（claim / 会话操作 / markProcessed 各自事务），崩溃一致性由租约到期重领 + SESSION_ALREADY_OPEN 幂等兜底；② 提示 topic telegram.security-prompt.v1 经 worker 网关 sendPrompt 投递（幂等键=eventKey）；③ deleteMessage 推迟部署阶段（外部连接授权 0）。
- 验证：S2-6 spec 10/10；全量 unit 220/220、database 307/309（M14/M06 已知边界）、architecture 0 违规（102 模块 138 依赖）、三锁无漂移。

## 2026-08-17 — S2-5 恢复案件与冷静期实施（macOS/arm64 本地）

- 写入：Create 4（domain/totp.ts RFC 6238 零依赖 + application/recovery-case.service.ts + unit/database 双 spec）。Modify 0。
- TOTP：RFC 4226/6238 官方向量通过（S5U01）；±1 步长窗口接受、±2 拒绝（S5U02）；畸形码失败关闭（S5U03）；Base32 往返（S5U04）；密钥仅案件生命周期内存持有，approve/reject 即清零。
- 恢复链：四因子（memory 复用 S2-2 验证器 / TOTP / 注册时间+绑定 ID 精确核对 / 人工证据）→ PENDING_REVIEW → approve（factors 达标 CAS）→ APPROVED + cooldown_until + 凭证联动 COOLDOWN + security_locks recovery-open 行（S5D01 全链）；冷静期内 verifier 返回 cooldown（S5D01 尾）；历史因子精确匹配拒绝模糊（S5D02）；因子不足 approve 失败关闭（S5D03）；并发 approve 恰一成功（S5D04）；reject 终态幂等（S5D05）；TOTP 未注册案件拒绝（S5D06）。
- 实施期修正（如实申报）：① 人工证据因子的达成数封顶至 factors_required（LEAST）——否则 fr=2 时第三因子违反 CHECK 上限（测试暴露的真实设计缺陷）；② reject 幂等化（前置 requireCase 移除，CAS 结果即答案）。
- 验证：S2-5 spec 10/10；全量 unit 217/217、database 296/298+4 环境 skip（M14/M06 已知边界）、architecture 0 违规（99 模块）、三锁无漂移。

## 2026-08-17 — S2-4 锁定、计数与速率限制实施（macOS/arm64 本地）

- 写入：Create 5（session-rate-limiter.ts、lock-audit.service.ts、credential-rehash.ts、unit/database 双 spec）+ Modify 3（verify-payment-credential：锁审计行 + 借用内重哈希 + 解锁释放；credential-session.service：单 OPEN 断言 + 令牌桶；双仓储：security_locks 两方法 + hasOpenSession）。
- 落地：锁定阈值触发同事务 security_locks 审计行、成功解锁写 released_at（S4D01 全链）；同 uid 第二 OPEN 会话拒绝、取消后可开（S4D02）；每窗令牌桶防洪水（S4D03 + S4U01/02）；旧 param_version 验证成功后**借用内透明重哈希**至当前版本且可再次验证（S4D04——重哈希在同一 withBytes 借用内完成，原文零二次借出）。
- 验证：S2-4 spec 6/6；全量 unit 213/213、database 294/296（M14/M06 已知边界）、architecture 0 违规（97 模块）、三锁无漂移。

## 2026-08-17 — S2-3 设置与验证会话实施（macOS/arm64 本地）

- 写入：Create 4（credential-session.registry.ts、credential-session.service.ts、unit/database 双 spec）。Modify 0。
- 注册表：内存缓冲 + 已用 nonce 集合；close 即双缓冲清零并移除；未知会话拒绝（重启安全：DB OPEN 行不可续输）；nonce 同步消费恰一成功（S3U03/04）。
- 服务：beginSetup/appendDigit（两段）/confirmSetup（一致 + 位数区间 → scrypt 入库 → CONFIRMED）；beginAuthorization/authorizePayment（验证通过签发冻结 AuthorizePaymentProofV1，operationType 经注册表元数据携带）；cancel；过期检测（assertOpen 过期即 EXPIRED 并拒绝）。
- 验证：unit 4/4 + database 8/8（S3D01 全流程 ACTIVE、S3D02 不一致 FAILED 零入库、S3D03 位数下限失败关闭、S3D04 nonce 重放缓冲零变化、S3D05 proof 冻结且字段完整、S3D06 错误密码计数 +1 且会话 FAILED、S3D07 取消后禁输、S3D08 过期 EXPIRED）；全量 unit 211/211、database 290/292（M14/M06 已知边界）、architecture 0 违规（94 模块）、三锁无漂移。
- 实施期修正（如实申报）：① hashAlgorithm 列标记载荷修正为 'scrypt'（S2-2 曾临时沿用 'argon2id' 标签）；② AuthorizePaymentProofV1 的 operationType 经注册表元数据随会话携带（V2 表无该列，不改迁移）。

## 2026-08-17 — S2-2 凭证处理组件实施（macOS/arm64 本地）

- 授权：用户复审 S2-2 v1.0 通过并确认算法裁决方案 B（Node 内置 scrypt，零新依赖零锁漂移）。
- 写入：Create 5（domain/credential-hash.ts、domain/credential-processor.ts、application/verify-payment-credential.ts、unit 双 spec、database spec）+ Modify 2（仓储接口与实现补 recordSuccessfulVerification——S2-2 计划冻结矩阵外的最小增补，如实登记）。
- **红线落地**：`CredentialEntryBuffer` 是全进程唯一可持有密码原文的结构——字节缓冲、借出即 finally 清零、畸形输入触发整体清零、原型冻结；verify 流程经 `withBytes` 借用，验证完成缓冲归零（S2U03 无残留断言；S2U06 静态断言三文件零 console/JSON.stringify/logger 通道）。
- scrypt v1：N=32768、r=8、p=1、盐 32B、键 64B；四段格式 `scrypt$ln=…,r=…,p=…$盐$键` 与 V2 CHECK 兼容；`timingSafeEqual` 常量时间；格式非法稳定失败关闭（S2U14）。
- 验证编排：NOT_SET/REVOKED/LOCKED 窗口/COOLDOWN 窗口短路；成功清零计数并解锁；失败按策略计数，达 5 次以 ×2 阶梯锁定（S2D03 实证 5 次→LOCKED→locked 窗口拒绝）。
- 验证：unit 12 文件 207/207（含 S2-2 unit 10/10）；database 284 中 282 PASS（S2-2 spec 5/5；M14/M06 已知边界）；architecture 0 违规（92 模块）；三锁无漂移（`59D72A2A…3C73B`）。

## 2026-08-17 — 上线标准全量审查与缺陷修复（macOS/arm64 本地）

- 审查范围：阶段 1 全部代码 + S2-1，静态审查关键路径 + 全量验证。
- **发现并修复 4 项缺陷**（均有新增回归测试锁定）：
  1. **[严重] Outbox claim 映射丢失 attempt_count**：`applyFailure` 恒收 attemptCount=1，瞬时错误的"8 次后死信"永不触发（无限重试）。修复：映射补 `attemptCount`；AUDIT-1 断言透传。
  2. **[生产阻断] create-worker 连接工厂缺 `SET ROLE xht_worker`**：worker LOGIN 为 NOINHERIT，真实部署中所有认领/确认查询将报"relation does not exist"。修复：连接借出时先 SET ROLE（角色可配，默认 xht_worker）；AUDIT-2 断言首条语句。
  3. **[F-06 违约] 禁用网关时菜单消息被误判 PERMANENT 死信**而非 WAITING_CONFIGURATION。修复：显式 disabled 时注册抛 DISABLED 标记的 topic handler；AUDIT-3 断言分类。
  4. **[双响应风险] grammY errorSink 处理后吞错**：errorSink 已写 503 后 grammY 可能再写 200。修复：sink 返回 handled，handled 时重抛阻断 grammY 二次响应。
- 新增 `apps/worker/test/unit/worker-audit.spec.ts`（3/3）；全量回归：build/typecheck exit 0、architecture 0 违规（89 模块 120 依赖）、unit 197/197、integration 43/43、database 277/279（M14 平台边界、M06 并行负载抖动——两者隔离运行均过，非缺陷）。
- 附带修正：next.md 措辞触发 documentation spec 契约断言（补"阶段 2"字样）。
- **上线标准结论**：代码与架构逻辑达到可上线质量；距离真实生产部署仍缺部署配置、真实 Telegram 授权与生产基础设施（授权保持 0，按路线图阶段 9/10）。

## 2026-08-17 — S2-1 凭证领域合同与 V2 迁移实施（macOS/arm64 本地）

- 授权：用户复审 S2-1 v1.0 通过并显式授权 V2 migration（项目首个 schema 变更）。
- 写入：Create 5（V2__stage_2_credential_security.sql、contracts credentials.ts、platform security domain/application/infrastructure 三层、database spec）+ Modify（contracts index）。
- V2 五表落地：payment_credentials（六态 CHECK、四段 Argon2id 哈希格式 CHECK、锁定形状 CHECK）、credential_policies（P0-7 策略 v1 种子：6–8 位/5 次/900s/×2 阶梯/86400s 冷静期）、credential_sessions（nonce 唯一、authorize 形状与十进制金额 CHECK、OPEN↔终态解析 CHECK）、security_locks、recovery_cases（≥2 独立因素、APPROVED 必带冷静期 CHECK）；权限仅 platform SELECT/INSERT/UPDATE，worker 零访问（S2C07 正反实证）。
- 验证：S2-1 spec 7/7（S2C01–S2C07）；全量 test:all——unit 194/194、database 276/279（M14 平台边界、M06/M16 并行负载清理抖动）、integration 全过、architecture 0 违规（89 模块）、三锁无漂移。
- 受演进影响的既有测试更新（如实登记）：M03/M04/M07/M08 与 schema-boundary 19/20 的版本与表数断言扩展至 ['1','2']/14 表；documentation spec 的阶段 1 断言由 READY 更新为 VERIFIED 终态（阶段验收已通过的合法演进）。
- 实施期修正（如实申报）：① Postgres ARE 中 `\$` 与含 `+` 的字符类组合不可靠——SQL CHECK 正则改用 `[$]` 类写法；② 哈希格式按标准 Argon2id 四段（算法$参数$盐$摘要）修正 TS 与 SQL 双侧正则；③ transitionSession 需 RETURNING 计数。

## 2026-08-17 — 第 28/48 步 Task 14 实施：阶段 1 终态收敛（macOS/arm64 本地）

- 写入：Create 2（scripts/check-docs.mjs、documentation spec）、Modify 27（package.json docs:check 脚本 + 25 份权威文档/索引/状态 + 总计划头部）。
- **阶段 1 全部 14 个 Task、48 步流程完成**：Tasks 1–13 VERIFIED、23 项具名验收全 PASS；阶段 1 代码收敛 `READY`，唯一剩余动作是用户验收阶段 1 实现（验收不产生部署授权——生产部署/共享数据库/真实 Telegram 连接授权均为 0）。
- 最终验证：build/typecheck exit 0；architecture 0 违规（84 模块）；unit 18 文件 194/194（含 documentation spec 3/3）；database 269/272（M14 平台边界、M06/M16 并行负载清理抖动且隔离 PASS）；integration 43/43；`pnpm docs:check` 156 份 Markdown 零断链零工作区逃逸。
- 实施期修正（如实申报）：① check-docs 剥离围栏代码块后扫描（计划代码片段中的 `{ ... }` 被链接正则误判）；② 生产部署授权显式行补入 current.md（spec 契约断言）；③ 27 份文件中 25 份为事实追加（每份文件保持唯一权威职责），未改写任何历史记录。

## 2026-08-17 — 第 26/48 步 Task 13 实施（macOS/arm64 本地）

- 前置门禁：11 个 Create 目标不存在、testing index 一致；基线 ZIP SHA-256 `7F0FEE6A00F0C37EED4A82FDF98E6E9F45FC1E353C8EA233F35CBD44B5828B7D`（源提交 `e65448a`）；三锁无漂移。
- 写入：Create 11、Modify 1（testing index）：AsyncBarrier（真并发屏障）、RecordingTelegramBotGateway（event-ID 幂等 + duplicate-risk 审计）、StageOneHarness（真实 HTTP server + Testcontainers + 计数器）、六个 spec 文件。
- **23 项具名验收全部 PASS**：01–07/10–13/17（webhook，含 07 全矩阵：键序等价重放 duplicate、retained v1 重放 duplicate、四类字段变异 conflict、drop key 503、原行 digest/version 不变）、08–09（AsyncBarrier 两连接真并发恰一 UID/绑定/UidCreated）、14–15（注入失败全量回滚五表归零）、16（外部成功+确认前崩溃→重投→deliveries=2、effect=1、duplicate-risk 审计 1 条、最终 SUCCEEDED）、18（information_schema：资金禁止表零存在、inbox 无任何 raw 列）、19（角色链：flyway history ['1']、业务表 owner 全 xht_flyway、platform DDL 拒 42501）、20（重复迁移无 drift）、21（Task 12 T12C01 复用可追溯）、22（测试零 exec 根脚本静态断言）、23a/b（子进程 READY≤15s、HTTP 探测、SIGTERM 退出码 0≤10s、端口释放、零网络）。
- 全量回归：build/typecheck exit 0；architecture 0 违规（84 模块 116 依赖）；unit 191/191；integration 6 文件 43/43 全绿；database 272 中 269 PASS（M14 平台边界；M06/M16 为 Flyway 容器清理在并行负载下超时抖动，M06 已验证隔离 PASS，M16 同类，均非 Task 13 缺陷）。
- 实施期修正（如实申报）：① harness 通用化（packages 不 import apps，业务组装在 platform 测试侧共享工厂，遵守 no-packages-to-apps）；② digest key 形状对齐 Task 5 合同（status/字符串时间戳/借用清零）；③ 密钥轮换模型修正（初始 current=v1，轮换后 v1 retained）；④ 12 号测试屏障仅并发段激活；⑤ RecordingGateway deliveries 记录每次尝试（at-least-once 证据）、effects 记录幂等效果；⑥ failure spec 双重 cleanup 修正。

## 2026-08-17 — 第 24/48 步 Task 12 实施（macOS/arm64 本地）

- 前置门禁：4 个 Create 目标不存在；package.json 现有 architecture:check 脚本无需修改（Modify 实际差异 0）；三锁无漂移。
- 写入：Create 4（.dependency-cruiser.cjs、fixture 双文件、architecture spec）、Modify 0（package.json 无需变更）。
- 验证：`pnpm architecture:check` 真实图 exit 0（80 模块 109 依赖、0 违规）；fixture 故意违规 exit 1 且违规报告含规则名 no-domain-to-telegram；架构 spec 3/3（T12C01–T12C03）；**`pnpm test:all` 全链自 Task 3 以来首次完整通过**——build → typecheck → architecture:check → unit 191/191（17 文件）→ database 267/268（仅 M14 平台边界）→ integration。
- 实施期裁决（如实申报）：① depcruise 18.1.0 不支持 TypeScript 7 编译器（官方提示 >=7 待支持），扫 src 会得到 0 模块虚假绿灯——规则路径扩展为 `(src|dist)`，门禁实际扫描 build 产物的真实依赖图（test:all 先 build 保证 dist 新鲜）；② fixture 用纯 JS（同因 TS 解析缺失）；③ 违规报告在 stdout 而非 stderr，断言相应调整；④ packages 规则限定 `(config|contracts|testing)/(src|dist)` 防止误扫 fixture 自身路径。
- no-circular 全图无环；Telegram → identity 合法方向未受影响（真实图含该方向且 0 违规）。

## 2026-08-17 — 第 22/48 步 Task 11 实施（macOS/arm64 本地）

- 前置门禁：3 个 Create 目标不存在、5 个 Modify 输入一致；基线 ZIP SHA-256 `0EC28241FA03FC703EC4B4FFA1F3D9F280093D228486157E744C24B917133D00`（源提交 `d4c1250`）；三锁无漂移。
- 写入：Create 3、Modify 5、Delete 0：contracts observability 扩展（+2 事件、+6 上下文字段、route telegram.start、outcome processed、error_category telegram_update_invalid）、logging-policy 八事件 matrix 与值级扩展、telegram-user-reference（tgur-v1 独立 HMAC 伪名、static/reference 双密钥源、withResolvedSecret 借用清零）、config index、双 logger Pino redact 第二层、双 security spec。
- 验证：build/typecheck exit 0；unit 16 文件 188/188（含 security 9/9）；database 268 中 267 PASS（仅 M14 平台边界）。
- 关键证据：批准字段单行 JSON（T11C01）；未知事件/字段/Secret 值 SafeLoggingError 且 destination 零新增字节（T11C02/11–13）；嵌套/数组/Error/控制字符/超长/非法格式全失败关闭（T11C03–05）；事件-route/outcome 组合不符拒绝（T11C06）；伪名确定性、按用户/按密钥区分、与手工 HMAC 一致（T11C14/15）；源码敏感标识静态搜索仅允许 redact 防御声明（T11C16）。
- 实施期发现与修正（如实申报）：① 测试抓到 policy 真实缺口——duration_ms/retry_count 数值键接受字符串值，补 NUMERIC_KEYS 类型强制；② telegram_webhook_rejected 的 correlation_id/update_id 由 optional 改 required（总计划 Step 1 语义对齐）；③ T11C16 静态搜索需剥离 Pino redact 防御声明块后断言。

## 2026-08-17 — 第 20/48 步 Task 10 实施（macOS/arm64 本地）

- 前置门禁：8 个 Create 目标不存在、4 个 Modify 输入一致；基线 ZIP SHA-256 `68F05698B25FEA2C9D01C43F8235C841B294A95129E13EAA4C0B3E5ECE4B44AC`（源提交 `bf5e9a8`）；三锁与方案 A 后基线一致（lockfile `59D72A2A…3C73B`）。
- 写入：Create 8、Modify 4、Delete 0：contracts telegram 扩展（HandleTelegramStartCommand/Result、TelegramMainMenuRequestedV1）、platform application 三文件（mapper 防御 + 单 UoW 编排 + 菜单常量）、controller 增加 toWebhookOutcome 结果映射、worker 主菜单 handler + 双 Gateway + create-worker 注册 + outbox-worker topic 路由、双 spec。
- 验证：build/typecheck exit 0；unit 14 文件 179/179（含 worker 菜单 spec 5/5）；database 8 文件 268 中 267 PASS：Task 10 platform spec 7/7（T10C01–T10C08）、全部既有回归（UOW 138、Inbox 26、Outbox 13、identity 10、resolve 9、permissions 24、migrations 41/42——M14 平台边界，M06 本轮 PASS）。
- 关键证据：首启原子（Inbox PROCESSED + 身份五件套 + 双 Outbox topic 同事务，T10C01）；同 payload 重复安全成功零新增（T10C02）；冲突零副作用（T10C03）；retained key 缺失 503 零写入（T10C04）；**中段失败全量回滚**——预占菜单 eventKey 使 enqueue 失败后 users/memberships/bindings/registration/inbox 全 0（T10C05）；老用户再 /start 无第二个 UID（T10C07）；敏感键命令零数据库触达（T10C08）；Recording Gateway 收到精确 mainMenuV1 且幂等键=eventKey（T10C11）；禁用网关源码零网络引用（T10C13/15）。
- 实施期修正（如实申报）：① T10C05 场景由"篡改租约"改为确定性"预占 eventKey 中段失败"（同事务内租约不可篡改，原设计不可达）；② outbox-worker 的 topic 路由首版遗漏默认 handler 回退，Task 6 旧 spec 四例回归红灯暴露后修复——全量回归的价值实证；③ countTopic 测试工具漏传参数（纯测试缺陷）。

## 2026-08-17 — 第 18/48 步 Task 9 实施（macOS/arm64 本地，方案 A 授权后）

- 授权裁决：用户批准方案 A——以精确版本新增 devDependencies `@types/express@5.0.6`、`@types/node-fetch@2.6.13`（apps/platform）。锁文件受控漂移：`pnpm-lock.yaml` 新哈希 `59D72A2ACC1E46104C65114B0A92B5E8B3D1DDB6FF7B514E2A23927080B3C73B`（原 `EE1F63DB…AD9BC`）；根 `package.json` 与 `toolchain-lock.json` 无漂移；运行时依赖零新增（两包均为 devDependencies 类型包）。
- 写入：Create 11、Modify 2（contracts index 追加 telegram export、main.ts 导出 createPlatformApp）。
- 验证：build/typecheck exit 0；unit 13 文件 174/174（含 http 两 spec 12/12：T9C01–T9C11 contract + T9C12–T9C14 adapter）；database 261 中 259 PASS（M06 并行负载抖动且隔离 PASS、M14 平台边界，非 Task 9 缺陷）。
- 关键证据：缺/错/多值/非法/超长 Secret 401 零副作用；伪造代理头 400 HTTPS_REQUIRED；非 JSON 415；畸形 envelope 400；照片/callback/群聊 200 ignored 零调用；`/start param` DTO 无 raw message 字段；digest 输入与业务收到的 rawUpdate 为同一对象（见下方裁决）；digest 不可用 503 零 handler 调用；错误响应零回显；adapter 源码 bot.start 0 次、API 调用 0 次、identity/reliability grammy import 0。
- 实施期裁决与修正（如实申报）：① zod 仅属 packages/config，Update 校验改为手写结构校验（同项目防御风格）；② tsconfig.base.json 无 decorators 且被冻结，controller 去装饰器化 + ExpressAdapter 函数式路由注册（NestFactory + providers DI 闭环保持）；③ 群聊 chat.id 为负数，校验器区分 user id（非负十进制）与 chat id（可带负号）——首轮 400 误判群聊修正；④ grammY webhookCallback 自行解析 JSON（请求 body 对象不可能同引用直达 dispatch），identity 合同细化为"digest 输入 === dispatch 收到的 rawUpdate"，即 Task 5 digest 处理的对象与业务处理对象严格同一；⑤ grammY handler 错误不落入响应路径，adapter 增设 errorSink 在 handle 作用域映射 503/next。

## 2026-08-17 — 第 16/48 步 Task 8 实施（macOS/arm64 本地）

- 前置门禁：3 个 Create 目标不存在、三锁无漂移；基线 ZIP SHA-256 `63E1715096AFC4A884619DA9BD4610D19F80DE8241E19259BEC330EFCE9CD87A`（源提交 `82301f8`）。
- 写入：Create 3、Modify 0、Delete 0：identity-event-factory（冻结事件 + 注入 id factory）、resolve-or-create-uid（三分支编排）、database spec。
- 验证：build/typecheck exit 0；unit 11 文件 162/162；Task 8 spec 9/9（T8C01–T8C10，其中 T8C05/08/10 合并断言）；全量 database 7 文件 261 中 259 PASS（M06 并行负载抖动且隔离 PASS、M14 平台边界，均非 Task 8 缺陷）。
- 关键证据：五件套恰好一次（T8C01）；重复执行同 UID、uid-created 恰 1 条（T8C02）；username 变化仅更新快照（T8C03）；Outbox enqueue 失败整事务回滚、快照保持旧值（T8C05）；PROCESSING 占位零写入稳定 in_progress（T8C06）、清除后重入成为拥有者（T8C07）；两连接并发恰一个 created=true、同 UID、无跨主体串扰（T8C08/10）；编排源码纯度静态断言（T8C09）。
- 实施期测试修正（如实申报）：T8C05 由"预占 uid-created 键"改为"预占 telegram-seen 键验证快照回滚"（uid 在创建前不可知）；T8C06/07 预插占位行必须用服务端派生 key 而非随机 UUID（否则撞 uq_registration_channel_external）——该行为本身即唯一约束第二防线的正确反应。

## 2026-08-17 — 第 14/48 步 Task 7 实施（macOS/arm64 本地）

- 前置门禁：8 个 Create 目标不存在、contracts index Modify 输入一致、三锁无漂移（基线源提交 `9348b57`）。
- 写入：Create 8、Modify 1（contracts index 追加 identity export）、Delete 0，与冻结矩阵一致。
- 验证：build/typecheck exit 0；unit 11 文件 162/162（含 T7C01–T7C06）；database 6 文件 252 中 251 PASS：identity spec 10/10 一次全绿（T7C11–T7C21）、UOW 138/138、Outbox 13/13、Inbox 26/26、permissions 24/24、migrations 41/42（M06 本轮 PASS；仅剩 M14 Windows 平台边界）。
- 关键证据：双有效绑定被部分唯一索引拒绝且原行不变（T7C11）；registrationKey SHA-1 UUIDv5 确定性派生（T7C02）；命令对象结构上无 key 注入面（T7C03）；Proxy/accessor 解析零触达拒绝（T7C04）；幂等生命周期 acquired→in_progress→completed→findCompleted 回读一致（T7C17/18）；identity 模块源码 Telegram 引用 0（T7C20）；platform 无 DELETE、worker 绑定只读（T7C21）。
- 资源：Testcontainers 容器/网络由 fixture 清理，残留 0。

## 2026-08-17 — 第 12/48 步 Task 6 实施（macOS/arm64 本地）

- 前置门禁：8 个 Create 目标不存在、2 个 Modify 输入一致；基线 ZIP `huanhuitong-task6-baseline.zip`（源提交 `a28e24a`）SHA-256 `058D46C259029792A05705ADD33D0AAA0063CFBB78A932DB3342E650BFAA31CF`；三锁无漂移。
- 写入：Create 8、Modify 2、Delete 0，与冻结矩阵一致。
- 最终验证：`pnpm build`/`pnpm typecheck` exit 0；unit 10 文件 156/156；database 5 文件 242 中 240 PASS：Task 6 spec 13/13（T6C11–T6C27 及 durable job 状态机）、UOW 138/138、Inbox 26/26、permissions 24/24、migrations 40/41（M14 平台边界；M06 并行负载下清理超时抖动，隔离运行 PASS 3136ms，非代码缺陷）。
- 实施期修复（如实申报）：① claim 查询最初遗漏到期 RETRY_WAIT 行，T6C20 暴露后补入（outbox 与 durable jobs 两条 claim SQL）；② worker LOGIN 为 NOINHERIT，worker 原生 SQL 连接需显式 SET ROLE xht_worker；③ UoW 按 Task 4 合同包装 callback 错误（TRANSACTION_CALLBACK_FAILED、无 cause），稳定错误码断言改为 UoW 包装码 + 数据库不变量双证据；④ jobRepository 的 Kysely 池使用 worker 自有 `createWorkerDatabase`（xht_worker 绑定），不得复用 platform 角色池或被 SET ROLE 污染的共享池。
- 安全边界实测：T6C25 权限矩阵（worker INSERT outbox 拒 42501、platform UPDATE outbox 拒 42501）；T6C27 敏感 payload 键入队前拒绝且数据库触达 0；T6C19 at-least-once 重投证据（deliveries=2）；T6C17/18 四路错误凭证 CAS 全部 stale_lease、过期重领代次+1、旧凭证迟到确认被拒。
- 资源：全部 Testcontainers 容器/网络由 fixture 清理，残留 0。

## 2026-08-17 — 第 10/48 步 Task 5 实施（macOS/arm64 本地）

- 基线（T5R-08 合同）：用户授权以当前仓库为基线包；`git archive HEAD(82e6380)` 生成 `huanhuitong-v1.3-approved.zip`，680924 bytes，SHA-256 `2401E364B469572B4BE0F8797367C62CDF5ECB3AD33E25B12BCA12CF7106B6B5`。复审报告即本轮会话结论（用户 2026-08-17 ACCEPT T5R-03/08）。
- 前置门禁：六个 Create 目标存在数 0；`packages/contracts/src/index.ts` Modify 输入存在；三锁哈希与既有记录一致（lockfile `EE1F63DB…AD9BC`）。
- 环境：macOS darwin/arm64（偏离锁定 win32/x64，Node 官方 `v24.18.0-darwin-arm64` 临时下载至系统 TEMP 使用）；Docker 29.7.2 linux/arm64 以模拟运行锁定 linux/amd64 镜像；pnpm `11.15.1`；`pnpm install --frozen-lockfile --ignore-scripts` exit 0，下载 lifecycle 0，三锁漂移 0。
- 写入：七个 canonical fragments 机械提取，7/7 bytes/SHA-256 与 manifest IDENTICAL 后写入（Create 6、Modify 1、Delete 0）。
- 最终验证：`pnpm build` exit 0；`pnpm typecheck` exit 0；unit 10 文件 156/156 PASS（含 T5C01–T5C24 24/24）；database 229 中 228 PASS：Task 5 inbox T5C25–T5C50 26/26 PASS、Task 4 UOW 138/138、permissions 24/24、migrations 40/41。
- M14（Windows 源路径断言 `^[A-Za-z]:\`）在 macOS 前置不成立而失败；属平台绑定环境边界，非 Task 5 缺陷，其核心迁移断言由 M03–M13 覆盖。T5C48 有 1 个预期内 unhandled FATAL 日志（测试故意终止后端连接），结果 PASS。
- 实施中发现并修复 1 项计划缺陷（需用户复审确认）：fragment 07 spec 的 `beforeEach` 原以 platform 角色 `DELETE FROM audit_events` 清理，而 V1 迁移有意只授予 xht_platform SELECT/INSERT——真实数据库首跑 26/26 RED。最小修复：新增 `cleanupPool`（`fixture.bootstrapLogin`，max 1，专用 `xht-task5-inbox-cleanup`）执行两条 DELETE 清理，业务断言与 T5C50 权限反断言不变。修复后 fragment 07 更新为 38927 bytes / SHA-256 `CEBAC9F66E409FEB052494F48648E146F2623B08C19A7C8EA985633DB8250630`，manifest 同步；其余六目标保持 canonical 原值。
- 容器/资源：Testcontainers 容器与网络由 fixture 统一清理，运行残留 0（以 fixture stop exit 0 为证）；TEMP Node 安装保留至本轮结束。

## 2026-08-05 — 中文 AI 第一接手提示词（发布前）

- 范围：根目录 `AI接手提示词.md`、批准设计、实施计划和七份导航/状态 Markdown；工程代码、测试、依赖与锁文件修改 0。
- GitHub 路径预检：从 `origin/main` 回读 170 个文件；提示词要求读取的九个既有入口全部存在，意外缺失 0。
- 提示词命名：用户最终指定 `AI接手提示词.md`；旧英文计划名的文件和引用均保持 0。
- build、typecheck、unit、database、Docker、PostgreSQL、Flyway、Testcontainers：本轮文档任务 `NOT_RERUN`。
- 发布前项目集合：173 files = 114 Markdown + 59 non-Markdown；源项目与独立上传目录 173/173 byte-and-hash identical，missing/extra/changed 均为 0。
- 严格 UTF-8 失败 0、BOM 0、Markdown fence 失衡 0、相对链接 595、断链 0、项目根越界 0、强特征 Secret 0、TEMP 0。
- 提示词合同要求的九个读取入口、固定“换汇通 AI 接手确认报告”、唯一下一步、授权停止语句和 Git 只读命令全部存在；缺失 0。
- 锁文件保持：`package.json` `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；`pnpm-lock.yaml` `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；`pnpm-workspace.yaml` `A8F3EDA77957EF021BC956D726C034EF152F04709ECDCA7636000BDA6E5B7FD7`；`toolchain-lock.json` `3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`。
- 实施提交：`30f60a5beda6e5b98b8ff544819b6ce7bafa3e8b`，提交消息 `docs: add one-step AI handoff prompt`；10 个 Markdown、410 insertions、Delete 0，树文件 173。
- `git push origin main` exit 0：`7f4eff1..30f60a5 main -> main`。随后 fetch 证明 local SHA = remote SHA = `30f60a5beda6e5b98b8ff544819b6ce7bafa3e8b`，local/remote tree 173/173，diff 0，worktree changes 0。
- 远端提示词：`git cat-file -e origin/main:AI接手提示词.md` exit 0；解码文件树存在数 1；blob `8a058fc740dd6b721dbe467199cb5ad31536b3f0`、6728 bytes；标题、可复制提示词、接手报告、current/next 和授权停止语句 6/6 命中。
- 首次用默认 `core.quotepath` 比较中文显示名得到 false，但同一次回读中的 `git show`、blob 和 6/6 内容检查成功；改用 `core.quotepath=false` 后 decoded tree 存在为 true。该问题仅是 Git 中文路径显示转义，不是远端缺失。

## 2026-08-05 — 私有 GitHub 首发前静态与本地验证

- 目标发布状态：PRIVATE `liumingwen888-hub/huanhuitong`；独立上传目录目标为 `C:\Users\Administrator\Desktop\Codex\huanhuitong`。本节记录推送前最终内容验证，不把仓库创建或 push 写成已经完成。
- 项目发布集合：170 files = 111 Markdown + 59 non-Markdown；排除 `.git`、`node_modules`、dist、coverage、TEMP、缓存、测试临时文件、日志和项目外交付包。
- 全部 170 文件 strict UTF-8 解码失败 0、UTF-8 BOM 0；111 个 Markdown fence 失衡 0；围栏外相对链接 584、断链 0、项目根越界 0。
- 强特征 Secret 扫描覆盖 private-key header、GitHub/OpenAI/AWS/Telegram/Slack token 形态，命中 0；TEMP 残留 0；Task 5 六个未来 Create 目标存在数 0。
- 状态一致性：README、current、next、ai-handoff 和 Task 5 计划入口均包含第 9/48 步、READY v1.3 / WAITING_EXTERNAL_REVIEW、Task 5 代码 NOT_STARTED 和第 10 步 NOT_STARTED 的同一断点。
- 三锁 SHA-256：`package.json` `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；`pnpm-lock.yaml` `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；`toolchain-lock.json` `3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`。
- 工具链：`node --version` 为 `v24.18.0`；`pnpm --version` 为 `11.15.1`。
- 初次 `pnpm build` 在 TypeScript 编译前触发自动依赖物化，386 个包完成下载/物化，但因 `strictDepBuilds` 检出 `cpu-features@0.0.10`、`protobufjs@7.6.5`、`ssh2@1.17.0` 三个 pending script 而报 `ERR_PNPM_IGNORED_BUILDS`、exit 1；工具自动把 `allowBuilds` 写成占位值。该行随后精确恢复为 `{}`，三锁无差异，三个 script 执行数 0。
- 纠正命令 `pnpm install --offline --frozen-lockfile --ignore-scripts`：exit 0、Already up to date、下载 0、lifecycle 0。随后用进程级 `npm_config_ignore_scripts=true` 保持同一物化策略：`pnpm build` exit 0；`pnpm typecheck` exit 0；`pnpm test:unit` exit 0，Test Files 9/9、Tests 132/132。
- Docker、PostgreSQL、Flyway、Testcontainers、database/integration、Telegram、其他业务外部服务和生产部署均 NOT_RERUN / 0。`pnpm test:all` NOT_RERUN；不得提前创建未来 Task 12 的 `.dependency-cruiser.cjs`。
- 独立发布目录创建前目标不存在；复制后 source files 170、destination files 170、byte-and-hash identical 170、missing/extra/changed 均为 0。Git 初始提交 `95f8ed666f86b8209a2c17d2f2d1d1a5a98dd5ba` 的 tree 为 170 文件，提交后工作树状态 0。
- `git push -u origin main` exit 0；认证后 `git fetch --prune origin main` exit 0，local SHA 与 remote SHA 均为 `95f8ed666f86b8209a2c17d2f2d1d1a5a98dd5ba`，local files 170、remote files 170、tree diff 0、跟踪状态 `main...origin/main`。
- GitHub 已登录页面回读：仓库 `liumingwen888-hub/huanhuitong` 标记 `Private`，分支 `main`，History 1 Commit，`.github/apps/database/docs/packages` 与根文件可见，README 正确呈现第 9/48 步和 Task 5 v1.3 断点。
- GitHub App 连接器对此新私有仓库的 `fetch_file/search_commits/search_branches` 返回 404，说明 App 安装范围尚未包含该仓库；Git HTTPS push/fetch 与浏览器回读均已独立证明上传完成。

## 2026-08-05 — Task 5 v1.3 第三次外部复审聚焦修订最终验证

- T5R-03 canonical 静态合同：`value.getTime()` 与 `instanceof Date` 命中 0；`Object.getPrototypeOf(value) !== Date.prototype`、`Reflect.ownKeys(value).length !== 0`、`Date.prototype.getTime.call(value)` 各命中 1。T5C46 保持单一 Case ID，并新增 claim/mark Date 自有 accessor/method 与 Date subclass 表项；getter/method/trap/context、authentic error、UoW safe wrapping 和递归泄漏断言完整。
- 最终 direct probe：candidate index accessor、root command Proxy、claim/mark Date accessor、method、Date subclass 与 Date Proxy 均为 authentic `InboxRepositoryError / INBOX_COMMAND_INVALID / retryable=false`，getter/method/trap/context delta 0；普通合法 Date 的 claim/mark 均完成解析后精确触达 context 1；canonical root/nested object/nested array Proxy 均 `UNSUPPORTED_VALUE`、trap 0、valid digest 0。
- T5R-08：活动实施合同中“逐文件对照当前工作区与v16”“批准的v16输入”“v16作为实施恢复来源”规范化命中均为 0。Step 1 明确要求用户授权提供最新外审通过 ZIP 的 path/bytes/SHA 与报告 raw/normalized SHA，再逐文件比较完整项目；rollback 重复同一来源和五项验证。
- 已通过项未回退：repository 中 `oldClaimedUntil`、旧 claimed_until 等值 CAS、应用 Date expiry decision 均为 0；数据库内 `inbox.claimed_until <= database_time.value` 命中 1；T5C48 runtime sentinel/固定 allowlist、failed PID destroy once、健康 PID normal release once 均保留；canonical root/nested Proxy 观察前拒绝保留。
- canonical manifest：repository 14127 bytes / `8A40F116F2470459D3993EA8A7623AE280B5767978DB89449A415D478B5337E2`，repository RED 14126 / `D449F4FF76F663614AAB1765D179AC1C49804C6079A188D667407501F60475EC`；database spec 38625 / `E45C6AE2B15A57354167FF96DF774A6B5778FE65AC408F0010FB4C7C3490F0ED`。digest canonical/RED 保持 7377 / `C0E30632B1489FD40A665B6E3F836212ADDE73B52FF528B597991CF824475606` 与 7397 / `7A89226AED74F4634699811D6E151C657D52CFC72605750D33CCC576AF57AB2C`；七目标 marker/bytes/hash 7/7 一致。
- 系统 TEMP 最终运行：offline frozen/ignore-scripts install exit 0、386 reused/downloaded 0；TypeScript 7.0.2；contracts/config/testing/platform/worker 五 workspace build 各 exit 0；七 target strict/noEmit exit 0；future unit 1 file / 24/24 PASS；database strict compile exit 0，`vitest list` 收集 26 个唯一标题 T5C25～T5C50；direct probes exit 0。Windows ExecutionPolicy 与缺 `.bin` 垫片的两次 harness 失败均发生在编译前并已记录，改用直接 Node 入口后全量重跑；TEMP 残留 0。
- 最终静态门禁：168 files = 110 Markdown + 58 non-Markdown；相对 v17 Markdown Create/Modify/Delete=0/29/0，non-Markdown=0；Task 5 工程 Create/Modify/Delete=0/0/0，六个未来 Create 仍不存在、既有 Modify target 与 v17 相同；Task 5 文档 19/19 可达；Step 1～40 连续唯一且 checked 0；Case unit/database=24/26 且 T5C01～T5C50 连续唯一。
- 全项目严格 UTF-8/BOM/fence/H1 失败 `0/0/0/0`；围栏外相对链接 550、断链/越界 `0/0`；强特征 Secret 0；TEMP/cache/log/coverage/dist 残留 0。三锁 3/3 IDENTICAL。PostgreSQL、Docker、Flyway、Testcontainers 与真实项目 build/typecheck/test 均 `NOT_RERUN`。
- 状态结论：Task 5 v1.2 `EXTERNAL REVIEW NOT APPROVED / REPLACED BY v1.3 CANDIDATE`；T5R-01/02/04/05/06/07 `ACCEPT / CLOSED`；T5R-03/08 `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`；Task 5 计划 `READY v1.3 / WAITING_EXTERNAL_REVIEW`、代码 `NOT_STARTED`；第 9/48 步 `WAITING_EXTERNAL_REVIEW`，第 10/48 步 `NOT_STARTED`。

## 2026-08-05 — Task 5 v1.3 修订启动与 T5R-03/T5R-08 根因复现

- v17 ZIP/TXT/规范化 SHA-256 全部匹配；启动项目 168/168 BYTE-IDENTICAL，168 files / 110 Markdown / 58 non-Markdown，缺失/新增/漂移 0/0/0；三锁 3/3 IDENTICAL。
- T5R-03：当前 canonical `finiteDate()` 在 Proxy/`instanceof Date` 后执行 `value.getTime()`。claim receivedAt 与 mark lease.claimedUntil 的自有 accessor 各得到 getter calls 1、context touches 1；自有 method 各得到 method calls 1、context touches 1；四项均为 `Error / code=null / CONTEXT_TOUCHED / authentic=false`。
- T5R-08：活动 Step 1 精确命中“v16 报告项目文件 manifest”“批准的 v16 输入”各 1；v17 相对 v16 的 33 个合法 Markdown 修改会使该未来实施合同确定性阻断。
- 以上为修订前 RED/根因证据。PostgreSQL、Docker、Flyway、Testcontainers、真实项目 build/typecheck/unit/database 均未运行；Task 5 代码与第 10/48 步保持 NOT_STARTED。

## 2026-08-01 — Task 5 v1.2 第二次外部复审修订最终验证

- T5R-02：canonical repository 中 `oldClaimedUntil`、`claimed_until =` 旧时间、应用 `claimed_until.getTime()` expiry decision 与 `readDatabaseNow` 均命中 0；过期重领 CTE 中 `inbox.claimed_until <= database_time.value` 命中 1，同一 `database_time.value + interval '30 seconds'` 生成 RECEIVED 与 reclaim 新 lease。T5C36 有 `.456` 微秒 remainder seed，T5C37 以 query evidence 的 `<=→<` 变异门禁区分谓词，不冒充跨事务运行时等值证明。
- T5R-03/T5R-07：最终直接 canonical probe 为 root/nested object/nested array Proxy 全部稳定 `UNSUPPORTED_VALUE`、trap calls 0、有效 digest 0；candidate index accessor 与 root Proxy 均为 authentic `InboxRepositoryError / INBOX_COMMAND_INVALID / retryable=false`，getter/trap/context touches 0。T5C46 的十类畸形输入同时冻结 UoW 安全包装与公开递归泄漏 0。
- T5R-05：T5C48 直接构造并扫描 externalMessageId、consumer、claimant、payload digest、raw Update、callback data、SQL/table、SQL parameter、platform/bootstrap connection string、session username 与测试运行时从 ephemeral URL 解析的 password；全部 runtime sentinel 命中 0，公开字符串集合严格受 allowlist 约束。failed PID 恰好一次 `release(true)`，后续不同健康 PID 恰好一次 normal `release()`。
- canonical 机械门禁：七个 target 的 BEGIN/END marker 均 1/1，manifest bytes/SHA-256 为 7/7 一致；digest RED 为 7397 bytes / `7A89226AED74F4634699811D6E151C657D52CFC72605750D33CCC576AF57AB2C`，repository RED 为 13953 bytes / `A59EE13EE4318D7CAC3C41BDD741EF0CE59535C08FCDB4F535F1F15397354198`。
- 系统 TEMP 从七个 fragments 机械重构：锁定 store 的 frozen/ignore-scripts install 下载 0；TypeScript 7.0.2；五 workspace build exit 0；七 target NodeNext strict/noEmit exit 0、diagnostics 0；future unit 1 file / 24/24 PASS、failed/skipped 0；database canonical strict compile exit 0，`vitest list` 精确收集 26 个唯一标题 T5C25～T5C50。TEMP 已清理；PostgreSQL、Docker、Flyway、Testcontainers 与真实项目 build/typecheck/test 均 `NOT_RERUN`，以上不是 Task 5 实施或 GREEN。
- 最终静态门禁：168 files = 110 Markdown + 58 non-Markdown；相对 v16 Markdown Create/Modify/Delete=0/33/0，non-Markdown=0；Task 5 工程 Create/Modify/Delete=0/0/0，六个未来 Create 仍不存在、既有 Modify target 与 v16 相同；Task 5 文档 19/19 可达；Step 1～40 连续唯一且 checked 0；Case unit/database=24/26 且 T5C01～T5C50 连续唯一。
- 全项目严格 UTF-8/BOM/fence/H1 失败 `0/0/0/0`；围栏外相对链接 550、断链/越界 `0/0`；强特征 Secret 0；TEMP/cache/log/coverage/dist 残留 0。活动 Markdown 的 `digestCanonicalTelegramUpdate`、`telegram-update-canonical`、`STALE_INBOX_CLAIM`、`markProcessed(transaction, claim)`、`markProcessed(context, claim)` 均命中 0。
- 三锁 `3/3 IDENTICAL`：package.json `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；pnpm-lock.yaml `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；toolchain-lock.json `3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`。
- 状态结论：Task 5 v1.1 `EXTERNAL REVIEW NOT APPROVED / REPLACED BY v1.2 CANDIDATE`；T5R-01/04/06 `ACCEPT / CLOSED`；T5R-02/03/05/07 `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`；Task 5 计划 `READY v1.2 / WAITING_EXTERNAL_REVIEW`、代码 `NOT_STARTED`；第 9/48 步 `WAITING_EXTERNAL_REVIEW`，第 10/48 步 `NOT_STARTED`。

## 2026-08-01 — Task 5 v1.2 修订启动与四项根因复现

- T5R-02：独立 Node 探针把 PostgreSQL 风格文本 `.123456` 解析为 JavaScript Date `.123Z`，证明微秒到毫秒丢失；v1.1 canonical 同时存在应用 `getTime()` expiry 判断和 `claimed_until = oldClaimedUntil`，因此精确时间 CAS 可命中 0。
- T5R-03：独立数组探针对 index accessor 执行 `.map()` 得到 getter calls 1；v1.1 `digestSet()` 使用 `.length/.map()`，可在命令验证完成前执行输入代码并继续触达 context。
- T5R-07：独立 Proxy 探针中 `Object.getPrototypeOf` trap 1、`Object.getOwnPropertyDescriptors` trap 2；`node:util.types.isProxy` 在所有观察前返回 true 且 trap 0。v1.1 canonicalizer未先拒绝 Proxy。
- T5R-05：v1.1 T5C48 只递归检查单个 externalMessageId `9024-secret`，未直接覆盖 claimant/consumer/digest/raw Update/callback data/SQL/参数/连接串/用户名/ephemeral password，也未断言健康 PID 正常 release。
- 以上为修订前 RED/根因证据。PostgreSQL、Docker、Flyway、Testcontainers、真实项目 build/typecheck/unit/database 均未运行；Task 5 代码与第 10/48 步保持 NOT_STARTED。

## 2026-07-31 — Task 5 v1.1 六项修订计划可执行性验证

- T5R-01：最终直接探针 clean digest=`hmac-sha256:R_sX3ryIn4bVqWZJASw_nAKPCESjIqSwJNA0oef8L8M`；带 enumerable own `4294967295` 的 augmented array 得到稳定 `UNSUPPORTED_VALUE`，有效 digest collision=false。T5C10 同时覆盖 sparse、命名属性、越界属性和 accessor，getter calls 0。
- T5R-02：canonical repository 精确使用新插入 `clock_timestamp()+30 seconds`、行锁后的数据库当前时间、同一 CTE/UPDATE 的数据库当前时间与 processed_at；receivedAt/额外 processedAt 均不参与权限。T5C35～T5C39 覆盖远未来、远过去、expiry equality、伪造过去时间和有效当前 lease。
- T5R-03：最终直接探针 `consumer=null` 得到 `InboxRepositoryError / INBOX_COMMAND_INVALID`，database/context touches 0；T5C46 表驱动覆盖 null/undefined/wrong type/malformed digests/invalid Date，并冻结直接 authentic error 与 UoW `TRANSACTION_CALLBACK_FAILED / ROLLED_BACK / CALLBACK / cause absent`。
- T5R-04：T5C38 分别执行 current generation+wrong claimant、current claimant+old generation、两者旧、wrong inboxId；每个 false 后完整行相等、业务效果 0。完整当前 lease 的 true 证据由 T5C39 拥有。
- T5R-05：T5C46 不再冒充 constraint/query failure；该层真实 query/constraint 分类继续由 Task 4 回归拥有。T5C48 冻结 `TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED / NOT_COMMITTED / retryable=false / CALLBACK+ROLLBACK / cause absent`，并直接观察 failed PID 仅 `release(true)`、后续不同 PID 可完成认领；公开递归敏感值命中 0。
- T5R-06：活动 Markdown 精确搜索旧摘要函数名、Task 9 canonicalizer 路径、旧 markProcessed 调用和普通 stale Error 均命中 0。Task 5 v1.1 是唯一工程正文；Task 9 传完整 parsed Update 给 `digestTelegramUpdate(update, keyring)`，Task 10 传 `{ lease: claim.lease }` 并在 false 时抛稳定 PublicUnitOfWorkError。
- 系统 TEMP 机械重构七目标：TypeScript 7.0.2 strict/noEmit exit 0、diagnostics 0；future unit 1 file / 24/24 PASS；future database `vitest list` 收集 26 个唯一标题 T5C25～T5C50。初次 unit 23/24 暴露 sparse 分类顺序问题，修正后完整复跑 24/24；这属于 TEMP PLAN EXECUTABILITY EVIDENCE，不是工程 RED/GREEN。
- 最终静态门禁：168 files = 110 Markdown + 58 non-Markdown；相对 v15 Markdown Create/Modify/Delete=0/35/0、non-Markdown=0；Task 5 文档 19/19 可达；Step 40/40 连续、未勾选 40；Case unit/database=24/26；canonical marker/manifest=7/7；严格 UTF-8/BOM/fence/H1=0/0/0/0；围栏外相对链接 550、断链/越界=0/0；强特征 Secret=0；项目 TEMP/cache/log/coverage/dist 残留=0；三锁 3/3 IDENTICAL。
- PostgreSQL、Docker、Flyway、Testcontainers、项目 build/typecheck/test 均 `NOT_RERUN`；Task 5 工程目标未创建/修改。Task 5 代码 `NOT_STARTED`，第 10/48 步 `NOT_STARTED`。

## 2026-07-31 — Task 5 v1.1 修订启动与六项根因复现

- v15 ZIP：624162 bytes / `A8B38A7F73195B707177BC96ADE192A70081EB913E88B45D1C26F5482CEAC94B`；v15 TXT：9442 bytes / raw `99DF64B09C6CA71C75F7AA1BF66261CDDB7B79ED103EF5EB6F9C0C98AC638386` / normalized `03A60771036A715E43FD6CA126962E6933D7F30FE5E37C139DE5BBDFBB7AA759`。启动项目 168/168 字节一致，168/110/58，三锁 3/3 IDENTICAL。
- T5R-01 直接探针：clean 与带 enumerable own `4294967295='hidden-difference'` 的 augmented 数组均得到 `hmac-sha256:R_sX3ryIn4bVqWZJASw_nAKPCESjIqSwJNA0oef8L8M`，`collision=true`、error null。根因是数字字符串正则接受非数组索引，却只遍历 0～length-1。
- T5R-03 直接探针：`consumer=null` 得到 `TypeError / code=null / Cannot read properties of null (reading 'consumer')`，databaseTouches 0。根因是运行时对象/字段类型检查发生在属性访问后。
- T5R-02 静态证据：repository 以 `deadline(command.receivedAt)`、`claimed_until <= command.receivedAt`、`processed_at=command.processedAt` 和 `claimed_until > command.processedAt` 决定权限，调用方时钟可操纵 lease。
- T5R-04：T5C38 只把旧 claimant 与旧 generation 同时提交，只断言 status；不能分别证明两个 WHERE 条件及错误 inboxId。
- T5R-05：T5C46 实际只测过长 consumer，不是 constraint/query failure；T5C48 只断言 Error 与后续 SELECT，未断言 Task 4 code/outcome/retryable/cause/cleanup、destroy release 或新 PID。
- T5R-06：阶段总计划曾保留 6 处旧摘要函数名、1 处旧 markProcessed 调用、1 处普通 stale Error、5 处 Task 9 canonicalizer 文件/引用及 3 处旧 bytes 所有权。以上已判定必须由 v1.1 当前接口替代。
- 复现使用系统 TEMP 从 v1.0 fragments 机械提取，Node 24 experimental type transform；TEMP 已删除。该证据不是 Task 5 实施或 GREEN。
## 2026-07-31 — 第 9/48 步 Task 5 v1.0 计划完成验证

### 最终范围与状态

- Task 4 实施结果外部复审 PASS、阻断项 0 已登记；第 8/48 步为 `COMPLETED / EXTERNAL REVIEW PASS`，Task 4 代码为 `IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`。
- Task 5 独立计划由 `docs/plans/task-5-inbox-dedup/00-index.md` 唯一进入，共 19 份 Markdown；计划状态 `READY v1.0 / WAITING_EXTERNAL_REVIEW`，代码 `NOT_STARTED`。第 9/48 步 `WAITING_EXTERNAL_REVIEW`，第 10/48 步 `NOT_STARTED`。
- 未来工程矩阵精确为 Create 6、Modify 1、Delete 0；六个未来 Create 当前存在数 0，既有 Modify 目标保持 v14 字节。Task 5 工程实际 Create/Modify/Delete 为 0/0/0。
- 相对 v14 的实际项目差异均为规划/状态 Markdown：Modify 16、Create 19、Delete 0；非 Markdown 漂移 0、缺失 0。最终项目 168 files = 110 Markdown + 58 non-Markdown。

### 接口调查与计划合同

- Task 2 keyring 是同步 `withMaterial<T>((Uint8Array) => T): T` 借用接口；计划在 callback 内完成 HMAC，借用 copy 与 canonical chunk/final bytes 均在 `finally` 清零，不保存 key material、raw Update、正文、callback data 或 canonical bytes。
- Task 3 表实际以 `(consumer, external_message_id)` 唯一，摘要和 key version 有 check，状态包含 RECEIVED/CLAIMED/PROCESSED/CONFLICT/FAILED，已有 lease 与 generation 字段。Task 5 选择唯一 insert + `SELECT ... FOR UPDATE` + generation CAS，不新增迁移，不以 conflict 覆盖原摘要或 key version。
- Task 4 上下文只公开 `QueryCreator<StageOneDatabase>` 与受限 `executeSql`；计划要求 `claim`/未来业务效果/`markProcessed` 使用同一 `TransactionContext` 和 UoW，禁止 root Kysely、隐式第二连接、嵌套事务与事务内外部网络副作用。
- canonical JSON 合同冻结完整 parsed Update、Unicode code-point 对象键序、数组原序、字符串不规范化、有限 number、`-0` 归一为 `0`、null/boolean，并拒绝 undefined、稀疏数组、循环、accessor、symbol 与非普通对象。HMAC 为 SHA-256/base64url，固定合成向量摘要为 `_ok7DE_TalvbxgzGFS2aBYH0tIc4dWOhViegvxH8Ekg`。
- 返回合同冻结为 `claimed`、`duplicate_same_payload`、`conflict`、`digest_key_unavailable`；current/retained 轮换按持久 key version 精确查询，缺历史 key 失败关闭。lease 为 30 秒，过期边界、重领 generation、旧 claimant CAS、PROCESSED replay 和数据库/context 错误传播均有具名用例。

### 计划可执行性与静态门禁

- Step 1～40 连续、唯一，Step 40 为最后一步；T5C01～T5C50 连续、唯一，其中 future unit 24、future database 26。RED delta、唯一命中、实际 Case ID/matched 数量以及 `0 matched + exit 0` 失败门禁均已写入。
- TEMP PLAN EXECUTABILITY EVIDENCE：七个 canonical 未来文件使用 TypeScript 7.0.2 strict/noEmit 编译 exit 0、diagnostics 0；未来 unit spec 在隔离 TEMP 中 1 file / 24/24 PASS、failed/skipped 0。最初三次 TEMP 启动分别在 alias、Vitest config module 和 zod 解析处于 collection 前失败，逐项修正 TEMP harness 后取得上述结果；未修改项目工程文件，TEMP 最终残留 0。
- database canonical spec 只做 strict 编译，未运行数据库测试。build、typecheck、项目 unit、database、Docker、PostgreSQL、Flyway、Testcontainers、`pnpm test:all` 本轮均 `NOT_RERUN`；TEMP 结果没有登记为 Task 5 实施或 GREEN。
- 最终全项目严格 UTF-8失败 0、BOM 0、Markdown fence 失衡 0、H1 标题失败 0；围栏外相对链接 547、断链 0、越界 0。强特征 Secret 0、真实凭证 0；node_modules/dist/coverage/.git/TEMP/cache/log 和旧交付物进入项目数 0。
- 三锁最终为 `3/3 IDENTICAL`：package.json `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`、pnpm-lock.yaml `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`、toolchain-lock.json `3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`。
- Git、worktree、subagent、并行代理、Telegram、其他业务外部服务、共享/生产数据库和生产部署执行数均为 0。裁决：`READY v1.0 / WAITING_EXTERNAL_REVIEW`；未实施 Task 5，未进入第 10/48 步。

## 2026-07-31 — 第 9/48 步启动基线与 Task 4 最终外部验收

- v14 ZIP：570070 bytes，SHA-256 `C63F577FAF76CB0D67D5A9267490C494557D9887A8A6317A5736D069C6A16B08`；v14 TXT：8511 bytes，raw SHA-256 `1062977E9B332830F2CDECD19173F5BB005E052F361630B9050ACC499DF69D70`，normalized SHA-256 `BD5A912181FDE3A66D043B6C4895F87056B37A6F844584B5753A5702D48D6AC6`。
- 当前项目启动时为 `149 files = 91 Markdown + 58 non-Markdown`，与 v14 `149/149 BYTE-IDENTICAL`；内容差异 0、缺失 0、v14 外新增 0。
- 三锁启动复算为 `3/3 IDENTICAL`：package.json `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`、pnpm-lock.yaml `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`、toolchain-lock.json `3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`。
- 用户最终裁决：Task 4 实施结果外部复审 PASS，阻断项 0；第 8/48 步 `COMPLETED / EXTERNAL REVIEW PASS`，Task 4 代码 `IMPLEMENTED / VERIFIED / EXTERNAL REVIEW PASS`。
- 第 9/48 步进入 IN_PROGRESS，Task 5 详细计划 DESIGNING；Task 5 代码和第 10/48 步 NOT_STARTED。本轮 build、typecheck、unit、database、Docker、PostgreSQL、Flyway 与 Testcontainers 均 NOT_RERUN。

## 2026-07-31 — 第 8/48 步 Task 4 v1.10 实施完成验证

### 范围与状态

- 实施前 v13 为 `146 files = 91 Markdown + 55 non-Markdown`，逐文件 `146/146` 字节一致；最终为 `149 files = 91 Markdown + 58 non-Markdown`。工程变化精确为 Create 3、Modify 2、Delete 0、outside engineering 0。
- 第 7/48 步 `COMPLETED / EXTERNAL REVIEW PASS`；Task 4 技术计划 `READY v1.10 / EXTERNAL REVIEW PASS`、LAYOUT-S1 VERIFIED，T4R-16～T4R-27 ACCEPT / CLOSED。第 8/48 步 `COMPLETED`，Task 4 代码 `IMPLEMENTED / VERIFIED`；第 9/48 步 `NOT_STARTED`。

### 过滤器勘误与 RED→GREEN

- 原冻结过滤器 `-t '^LEX01:'` 在 Vitest 4.1.10 下 exit 0、matched 0、138 skipped，属于 EMPTY MATCH。根因是 `-t` 匹配完整 suite-qualified 名称；用户授权的运行时替代 `-t 'LEX01:'` 实际只匹配 `Task 4 Unit of Work > LEX01: ordinary backslash before COMMIT rejects before delegate`，1/1 PASS、137 skipped、empty 0、unexpected 0。
- 同类审计把 Step 4/5 的运行时形式确定为 `SQLPOL51:` 与 `SQLPOL5[1-7]:`；全部 Step 1～63 过滤器都同时核对 actual Case ID 与 matched 数量，`0 matched + exit 0`、多匹配和错误 ID 均判失败。Step 8～26 的 19 项实际匹配为 `1,1,2,3,1,1,2,1,1,1,1,1,1,1,1,1,1,1,1`，LEX union 23/23、duplicate 0、empty 0。
- T4R-27 v1.8 TEMP 重建保持 `24624 bytes / 878 lines / 4BE97A751BD02700C37E307AB57F53770261C95A09B152DAA6566DBD0E73ABEC`，反向替换命中 1/1、scan `{ kind: "ok" }`。SQLPOL51 连续两次精确 RED；51～55 因 delegate 0→1 失败，56～57 通过，环境/collection/fixture/TypeScript 假 RED 为 0。最终 canonical GREEN 中 SQLPOL01～57 为 57/57，SQLPOL51～57 的真实项目专项为 7/7。

### 新鲜真实验证

- Task 4 integration spec：138/138、skipped 0、标题 unique 138/138；LEX01～23 为 23/23，SQLPOL01～57 为 57/57。真实 fixture 聚焦 UOW/REL/IMM/CLEAN 均按声明数量通过。
- future database unit：12/12；完整 unit：9 files、132/132；完整 database：3 files、203/203。Task 4 integration 位于 database project 并以真实 PostgreSQL/Flyway/Testcontainers 运行 138/138。
- build exit 0；typecheck exit 0。额外探测空的独立 `integration` project 得到 no test files / exit 1；该 namespace 当前没有 Task 4 文件，Task 4 的计划 integration 目标由 database project 138/138 覆盖，未用 `--passWithNoTests` 冒充通过。
- Docker Desktop Engine 29.6.2（linux/amd64）；锁定 PostgreSQL 18.4、Flyway 12.11.0 与 Testcontainers 12.0.4 通过真实本地隔离执行。最终 Testcontainers all/running containers/networks 均为 0。
- Step 62：database.ts 14767 / `455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C`；database.spec.ts 12062 / `07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC`；transaction-context.ts 5511 / `CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C`；unit-of-work.ts 25165 / `A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A`；integration spec 113197 / `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789`；5/5 BYTE-AND-HASH IDENTICAL。
- Step 63：TypeScript 7.0.2、TEMP type=module、strict/noEmit，exit 0、diagnostics 0；strict TEMP 与 T4R-27 TEMP 均已删除。
- package.json、pnpm-lock.yaml、toolchain-lock.json 预期 SHA-256 分别为 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`、`EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`、`3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`，最终静态门禁复算必须为 3/3 IDENTICAL。
- 最终静态门禁：149 files = 91 Markdown + 58 non-Markdown；UTF-8/BOM/fence/title 失败 `0/0/0/0`；围栏外相对链接 485、断链 0、越界 0；强特征 Secret 0、非合成凭证赋值 0、TEMP/缓存/日志残留 0、Task 4 计划超大文件 0；Step 1～63 连续且 Step 63 为最后一步。相对 v13 的工程差异精确为 Modify 2、Create 3、Delete 0，直接受影响 Markdown 修改 17，白名单外工程修改 0。
- 三锁最终复算为 3/3 IDENTICAL；上述 SHA-256 与预期逐项相同。
- Git、worktree、subagent、并行代理、Telegram、其他业务外部服务、共享/生产数据库和生产部署执行数均为 0；未进入第 9/48 步。

## 2026-07-31 — 第 8/48 步 Task 4 v1.10 实施前门禁

### 已执行并通过

- v13 ZIP：539994 bytes，SHA-256 `BF98478BA2A6FE9BBD1FFEA814C2768CAA4465CB404911837B96BCF6F9374278`；配套报告：13466 bytes，原始 SHA-256 `3EF53D08EFA8DC60DB729BCB22114E3F442E1B3B61A7BA50D906AF16F633683F`。
- 当前项目：146 files = 91 Markdown + 55 non-Markdown；与 v13 逐文件 146/146 字节一致，内容差异、缺失、v13 外新增均为 0。
- 外部复审登记：第 7/48 步 COMPLETED / EXTERNAL REVIEW PASS；Task 4 READY v1.10 / EXTERNAL REVIEW PASS；LAYOUT-S1 VERIFIED；T4R-16～T4R-27 ACCEPT / CLOSED。

### 当前状态

- Task 4 五个 canonical 未来目标在写入前重构均匹配指定字节数与 SHA-256。测试先行已写入 integration spec 与 database unit spec；三个生产实现尚未写入。
- 精确 RED：v1.8 两处反向替换命中 1/1，`unit-of-work.ts` 为 24624 bytes / 878 lines / `4BE97A751BD02700C37E307AB57F53770261C95A09B152DAA6566DBD0E73ABEC`；scan probe 为 `{ kind: "ok" }`。SQLPOL51 连续两次均为 1 failed / 137 skipped，批量为 SQLPOL51～55 failed、SQLPOL56～57 passed，唯一断言原因为 `expected 1 to be +0`，module/collection/beforeAll/fixture/TypeScript 环境失败 0。SQLPOL01～50 基线 50/50，SQLPOL26～44、49～50、56～57 防误报基线 23/23。
- 已执行失败：冻结 Step 6 首次经 Windows `.CMD` shim 启动时正则 `|` 被解释为管道，exit 255、测试未执行；改用同一 Vitest 4.1.10 的 `vitest.mjs` 直启后 50/50 与 23/23 通过。
- 阻断命令：`node node_modules/vitest/vitest.mjs run <TEMP>/apps/platform/test/database/unit-of-work.integration.spec.ts --config <TEMP>/vitest.config.ts --root <TEMP> --project database -t '^LEX01:'`。实际 exit 0，但 Test Files 1 skipped、Tests 138 skipped，目标匹配 0。诊断对照只把过滤器改为 `LEX01:`，得到 Test Files 1 passed、Tests 1 passed / 137 skipped、exit 0，证明冻结锚点与 suite-qualified title 不相容。
- 第 8/48 步与 Task 4 代码现为 BLOCKED。按计划停止条件，Step 9～63、canonical GREEN 写入、真实 database/integration、完整 unit/typecheck/build、Docker/PostgreSQL/Flyway/Testcontainers 与 v14 交付物均 NOT_RUN；未登记 COMPLETED/VERIFIED。

### Step 8 过滤器阻断复审与解除

- 用户裁决：根因是 Vitest 4.1.10 按完整 suite-qualified 名称匹配，不是代码、canonical test 或环境错误；授权实施期最小命令兼容勘误，不改变功能、断言、标题、配置、依赖、canonical fragments 或外审结论。
- 原冻结过滤器 `^LEX01:`：exit 0、matched 0、138/138 skipped，明确判定 EMPTY MATCH，不计为通过。
- 有效替代过滤器 `LEX01:`：exit 0，唯一实际名称 `Task 4 Unit of Work > LEX01: ordinary backslash before COMMIT rejects before delegate`，matched 1、1/1 PASS、137 skipped、empty 0、unexpected 0。
- 直接 Vitest `list` 审计发现 Step 4/5 的 `^SQLPOL51:` 与 `^SQLPOL5[1-7]:` 具有相同起始锚点风险；此前 Windows `.CMD` shim 会吞掉 `^`。实施期有效形式统一为 `SQLPOL51:` 与 `SQLPOL5[1-7]:`，分别精确匹配 1 与 7。
- 全部实际过滤器非空且 exact/exit 0：Step 4/5=`1/7`；Step 6/7=`50/23`；Step 8～26=`1,1,2,3,1,1,2,1,1,1,1,1,1,1,1,1,1,1,1`；Step 27/28/29=`25/12/23`；Step 42～50=`9/5/1/5/1/2/1/23/23`；Step 51=`50/57`。每条实际 Case ID 集合与计划声明一致，empty 0、unexpected 0。
- 实施期实际过滤器：Step 8～26 依次为 `LEX01:`、`LEX02:`、`LEX0[34]:`、`LEX0[5-7]:`、`LEX08:`、`LEX09:`、`LEX1[01]:`、`LEX12:`、`LEX13:`、`LEX14:`、`LEX15:`、`LEX16:`、`LEX17:`、`LEX18:`、`LEX19:`、`LEX20:`、`LEX21:`、`LEX22:`、`LEX23:`；其余分组过滤器保持计划文字不变。
- 防空匹配门禁：任何 `exit 0` 都必须同时解析实际 Case ID 与 matched 数量；matched 0、多匹配或集合不等一律失败。
- 结论：`STEP 8 FILTER RUNTIME BLOCKER: RESOLVED`；第 8/48 步恢复 IN_PROGRESS，Task 4 代码恢复 BUILDING，从 Step 9 继续，第 9/48 步保持 NOT_STARTED。
- 第 9/48 步 NOT_STARTED。

## 2026-07-31 — 第 7/48 步 Task 4 v1.10 第十次外部复审修订验证

### 基线恢复与输入

- 启动复核精确为 current 154、v12 146、identical 141、modified 5、missing 0、added 8；13 路径隔离 ZIP 在项目外完成 manifest、解压与逐文件 SHA-256 验证后，才通过 TEMP v12 副本精确恢复。恢复后 146/146 byte-identical、hash diff 0、missing 0、extra 0。
- v12 ZIP 为 529514 bytes / `23A4A004B29EEE98C6173DF3100971D8CF0A8A2DC7BF53C88763F5471BC210C6`；v12 TXT 为 18929 bytes / raw `AE35C5AB54EA18C23B3DBFB636B1DA67E7FE384C827CBC49CA515CA749FB486C` / normalized `D1C93F071486522BDC29B2A409FB9C4544AD5D0296F01ED1A9D07DBCB8BBCDDC`。
- v10 ZIP 为 511616 bytes / `36856DCD59E208EF367EACB92B79D9245758B2F57ACCE5EB814CB461FB6F4AE7`；独立提取 v1.8 unit-of-work 为 24624 bytes、878 lines、`4BE97A751BD02700C37E307AB57F53770261C95A09B152DAA6566DBD0E73ABEC`。v10 不是未来计划依赖。

### T4R-25～T4R-27

- T4R-25 修订前 Step 1 错用 v11 `122/67/55`；修订后实施前 `146/91/55`，未来 Create 3/Modify 2/Delete 0 后 `149/91/58`，Step 1、Step 53 与 READY/BLOCKED gate 一致。
- T4R-26 修订前 Step 8～14 共 7 个声明/命令映射错误；修订后机械 validator 必须并已证明 Step 8～26 `19/19 STEP-FILTER IDENTICAL`、LEX union `23/23`、duplicate 0、empty 0。
- T4R-27 reverse function/call replacement hits 均为 1，重建 v1.8 hash/bytes/lines 精确；独立 TEMP scan probe 1/1 返回 `{"kind":"ok"}`。SQLPOL51 连续两次各 matched 1、failed 1、137 skipped，唯一 ID SQLPOL51、唯一断言 expected delegate 0 / actual 1；module resolution、collection、beforeAll/fixture、TypeScript 与其他测试失败均 0。
- SQLPOL51～57 RED 为 5 failed / 2 passed / 131 skipped：failed IDs 精确 SQLPOL51～55，passed IDs 精确 SQLPOL56～57，所有失败同一 delegate 0→1 原因，其他错误 0。恢复 SHA-256 `A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A` 后 7 passed / 131 skipped / exit 0。
- 五个最终 canonical 目标依次为 14767/`455875…72C`、12062/`07A504…4EC`、5511/`CA3B9B…E1C`、25165/`A0FE55…E6A`、113197/`FF5162…789`，5/5 IDENTICAL；canonical fragment 正文未修改。

### 未执行与状态

- 最终项目 `146 files = 91 Markdown + 55 non-Markdown`；相对 v12 修改既有 Markdown 25、新建 0、删除 0、非 Markdown/工程修改 0、白名单外修改 0。Task 4 三个 Create 路径存在数 0。
- 146 文件严格 UTF-8 解码失败 0、BOM 0、空文件 0；91 Markdown fence 失衡 0、标题层级失败 0；相对链接 487、断链 0、越界 0；强特征 Secret 0、项目 TEMP/缓存/日志残留 0。
- Task 4 Markdown `bytes > 100000 OR lines > 2500` 失败 0；Step 1～63 连续、未勾选 63/63、已勾选 0、Step 64 及更高步骤 0；future tests 138/138 unique，LEX 23/23、LEX23 1、SQLPOL 57/57、SQLPOL57 1。
- `package.json`、`pnpm-lock.yaml`、`toolchain-lock.json` SHA-256 分别保持 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`、`EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`、`3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`。
- 项目 build/typecheck/unit/database、真实完整 138/138、Docker、PostgreSQL、Flyway、Testcontainers 均 `NOT_RERUN`。TEMP reconstruction、scripted RED/GREEN 与 scan probe 不冒充真实项目测试。
- Task 4 技术计划 `READY v1.10`；文档布局 `LAYOUT-S1 VERIFIED`；外部复审 `NOT_APPROVED / WAITING_EXTERNAL_REVIEW`；T4R-16～T4R-27 `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`；Task 4 代码、第 8/48 步及 Tasks 5～14 `NOT_STARTED`。未实施 Task 4，未进入第 8/48 步。

## 2026-07-31 — 第 7/48 步 Task 4 v1.9 / LAYOUT-S1 文档结构拆分验证

### 输入与范围

- v11 ZIP、TXT、报告规范化 SHA-256 与授权值逐项一致；v11 ZIP 122 文件与拆分前项目逐文件 SHA-256 差异 0。原巨型计划为 383793 bytes、10629 lines、SHA-256 `D49EC553475FEB75EF0BE83B290BA4C80ADF73DB40FD0D4B44BE5A51DF0257E1`。
- 最终相对 v11：修改 Markdown 18、新建 Markdown 24、删除 0、工程文件修改 0、非 Markdown 修改 0、白名单外修改 0。项目为 146 文件（Markdown 91、非 Markdown 55），三个 Task 4 Create 工程路径实际存在数 0。

### 结构与内容

- 历史计划路径兼容入口 2676 bytes/41 lines，低于 20KB并有效指向新索引；LAYOUT-S1 共 24 份 Markdown。最大拆分文件 `fragments/05-unit-of-work.integration.spec.part-01.ts.md` 为 37462 bytes/1100 lines；目标值超标 0，`bytes > 100000 OR lines > 2500` 硬上限超标 0。
- Step 1～63 为 63/63、顺序连续、已勾选 0；更高编号步骤 0。SQLPOL01～SQLPOL57 为 57/57且每项保留 SQL 原文、UTF-8 hex、含义、expected/actual、delegate、release、后续合法查询和敏感命中字段；LEX01～LEX23 为 23/23；non-SQLPOL core 81，future integration 总数 138；T4R-16～T4R-24 为 9/9并保持 `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`。
- 五个 frozen v11 目标与 canonical reconstruction 均字节一致：database.ts 14767、database.spec.ts 12062、transaction-context.ts 5511、unit-of-work.ts 25165、unit-of-work.integration.spec.ts 113197；5/5 IDENTICAL。canonical 正文各出现一次。
- Step 62 最终逐路径输出五个 `IDENTICAL` 并 exit 0；Step 63 仍为最后编号步骤，使用 TypeScript 7.0.2 在隔离 TEMP 重构五文件并 strict/noEmit exit 0，TEMP 严格环境残留 0。首次 PowerShell `${part}` 解析问题及 canonical `trimEnd()` 丢失内部空行均在最终证据前修复，没有伪记为通过。

### 文档、安全与锁

- 全部 146 文件严格 UTF-8 解码失败 0、BOM 0、空文件 0；Markdown fence 失衡 0。相对链接 477、断链 0、越界 0；新索引可达 24/24，拆分文件回链失败 0，标题层级失败 0，TBD 命中 0。
- PEM 私钥、Telegram Bot Token、AWS access key、npm/GitHub/Slack token 强特征命中 0；项目 TEMP/缓存/日志/旧交付物残留 0。
- `package.json`、`pnpm-lock.yaml`、`toolchain-lock.json` SHA-256 分别保持 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`、`EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`、`3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`。

### 未执行与裁决

- PostgreSQL、Docker、Flyway、Testcontainers、项目 build/typecheck/unit/database 和真实完整 138/138 全部 `NOT_RERUN`；隔离 TEMP 重构/strict 证据不冒充真实项目测试。
- Task 4 技术计划 `READY v1.9`；文档布局 `LAYOUT-S1 VERIFIED`；外部复审 `NOT_APPROVED / WAITING_EXTERNAL_REVIEW`；Task 4 代码、第 8/48 步及 Tasks 5～14 `NOT_STARTED`。未实施 Task 4，未进入第 8/48 步。

## 2026-07-30 — 第 7/48 步 Task 4 v1.9 第九次外部复审修订验证

### 修订前 RED

- 从 v1.8 Step 2/3/30/31/32 机械提取五个未来文件，只替换测试观察层。原文 `WITH changed AS (UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1`；UTF-8 hex `57 49 54 48 20 63 68 61 6E 67 65 64 20 41 53 20 28 55 50 44 41 54 45 20 70 67 5F 63 61 74 61 6C 6F 67 2E 70 67 5F 73 65 74 74 69 6E 67 73 20 53 45 54 20 73 65 74 74 69 6E 67 3D 27 6F 6E 27 20 57 48 45 52 45 20 6E 61 6D 65 3D 27 74 72 61 6E 73 61 63 74 69 6F 6E 5F 72 65 61 64 5F 6F 6E 6C 79 27 29 20 53 45 4C 45 43 54 20 31`。
- v1.8 `scanCallbackSql()` 实际 `{ kind: "ok" }`；CallbackConnection 到达目标 delegate，实际 1、合同 0。SQLPOL51 连续两次均失败为 expected delegate 0/actual 1；SQLPOL51～55 合并运行 5 failed，全部同一差异；SQLPOL56～57 的 v1.8 防误报基线为 allow/delegate 1。
- 根因：`findStatement()` 只返回最终主要 SELECT，v1.8 `updatesPgSettings()` 先要求最终主要语句为 UPDATE，因而直接 false；CTE 内 UPDATE 位于更深 token depth 且未被检查。SQLPOL48 只覆盖 WITH 最终主要语句为 UPDATE pg_settings。

### v1.9 已执行并通过

- `updatesPgSettings()` 遍历所有 executable UPDATE token；UPDATE、可选未引号 ONLY、目标 identifier 与点号必须处于同一语句 depth，精确识别 unqualified/qualified 与精确小写双引号形式，不使用 substring。字符串、注释、dollar quote、普通标识符、普通业务数据修改 CTE 和只读 pg_settings CTE不误报。
- SQLPOL51～55 全部 actual reject、目标 delegate 0；SQLPOL56～57 全部 actual allow、目标 delegate 1。SQLPOL52/53 的 ONLY 变体也拒绝且 delegate 0。9 条实际 evidence 行全部 normal release、后续合法查询可用、公开错误敏感信息命中 0。
- 最终 future database unit 12/12；旧 scripted 聚焦 45/45；LEX01～LEX23 为 23/23；SQLPOL01～SQLPOL50 回归 50/50；SQLPOL01～SQLPOL57 为 57/57。九个既有过滤器 `TXCTL0[1-9]`、`REL0[1-5]`、`IMM01`、`(REL(03|04|05)|TXCTL(16|17))`、`CLEAN01`、`(IMM01|TXCTL25)`、`TXCTL(0[1-9]|1[014-9]|2[0-5])`、`LEX(0[1-9]|1[0-9]|2[0-3])`、`SQLPOL(0[1-9]|[1-4][0-9]|50)` 的实际匹配依次为 9/5/1/5/1/2/23/23/50；新 `SQLPOL(0[1-9]|[1-4][0-9]|5[0-7])` 为 57；全部 failed 0、exit 0。
- Step 62 五路径证据：database.ts 14767 bytes / `455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C`；database.spec.ts 12062 / `07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC`；transaction-context.ts 5511 / `CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C`；unit-of-work.ts 25165 / `A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A`；unit-of-work.integration.spec.ts 113197 / `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789`。每个 fragment=1、mirror=1，5/5 IDENTICAL。
- Step 63：TypeScript `Version 7.0.2`、TEMP `type=module`、strict/noEmit，pg 8.22.0/Kysely 0.29.4 类型兼容；exit 0、diagnostics 0、未消费 `@ts-expect-error` 0，strict TEMP 删除成功。63 个 checkbox 未勾选、已勾选 0，Step 64/Addendum 0。
- T4R-16～T4R-24 无回归，状态均按适用项记为 `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`。Task 4 计划 READY v1.9、外部复审仍为 NOT_APPROVED / WAITING_EXTERNAL_REVIEW；Task 4 代码和第 8/48 步 NOT_STARTED。

### 未执行

- 真实 PostgreSQL、真实完整 future database 138/138、项目 build/typecheck/unit/database、Docker、Flyway、Testcontainers 均 `NOT_RERUN`。TEMP 计划提取物证据不等于真实工程实现或真实数据库通过。

## 2026-07-30 — 第 7/48 步 Task 4 v1.8 第八次外部复审修订验证

### 修订前 RED

- T4R-22：从 v1.7 五份未来文件提取并运行原样 scanner；原文 `SET transaction_read_only = on`，UTF-8 hex `53 45 54 20 74 72 61 6E 73 61 63 74 69 6F 6E 5F 72 65 61 64 5F 6F 6E 6C 79 20 3D 20 6F 6E`。顶层 token 为 SET/TRANSACTION_READ_ONLY/ON，旧 `isTopLevelControl()` 没有该分支，目标 delegate 实际 1、合同要求 0；BEGIN/目标 SQL/precommit probe/COMMIT，normal release `[1]`、destroy `[]`。
- T4R-23：同一 v1.7 提取物输入 `RESET ROLE`，UTF-8 hex `52 45 53 45 54 20 52 4F 4C 45`。顶层 token 为 RESET/ROLE，旧函数没有任何 RESET 分支；目标 delegate 实际 1、合同要求 0；BEGIN/目标 SQL/precommit probe/COMMIT，normal release `[1]`、destroy `[]`。

### v1.8 已执行并通过

- callback 顶层语句族改为有限 allowlist：SELECT、INSERT、UPDATE、DELETE、MERGE、VALUES 及最终语句属于上述六族的 WITH；其他族 fail closed。有效 SQL token 中精确 `set_config`/`pg_catalog.set_config` 函数调用及直接 UPDATE `pg_settings`/`pg_catalog.pg_settings` 在第一次目标 delegate 前拒绝；字符串、Escape string、dollar quote、注释、`current_setting` 与包含 `set_config` 的普通标识符不误报。
- 最终 future database unit 12/12；v1.6 旧 scripted 聚焦 45/45；LEX01～LEX23 为 23/23；SQLPOL01～SQLPOL50 为 50/50。九个过滤器 `TXCTL0[1-9]`、`REL0[1-5]`、`IMM01`、`(REL(03|04|05)|TXCTL(16|17))`、`CLEAN01`、`(IMM01|TXCTL25)`、`TXCTL(0[1-9]|1[014-9]|2[0-5])`、`LEX(0[1-9]|1[0-9]|2[0-3])`、`SQLPOL(0[1-9]|[1-4][0-9]|50)` 的实际匹配依次为 9/5/1/5/1/2/23/23/50，全部 failed 0、exit 0。
- SQLPOL 逐条 evidence 共 50：29 条拒绝全部 actual reject、目标 delegate 0；21 条允许全部 actual allow、目标 delegate 1；50 条全部 normal release，拒绝后下一次合法 query 均可使用 pool，公开安全错误敏感信息命中 0。
- Step 62：五个 fragment 与五个 mirror 均各出现 1 次，逐字节比较 5/5 IDENTICAL。Step 63：TypeScript `Version 7.0.2`、TEMP `type=module`、strict/noEmit，exit 0、diagnostics 0、未消费 `@ts-expect-error` 0，strict TEMP 删除成功。
- T4R-16～T4R-23 无回归，状态均按适用项记为 `RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`。Task 4 计划 READY v1.8、外部复审仍为 NOT_APPROVED / WAITING_EXTERNAL_REVIEW；Task 4 代码和第 8/48 步 NOT_STARTED。

### 未执行

- 真实 PostgreSQL、完整 future database 131/131、项目 build/typecheck/unit/database、Docker、Flyway、Testcontainers 均 `NOT_RERUN`。TEMP 计划提取物证据不等于真实工程实现或真实数据库通过。

## 2026-07-30 — 第 7/48 步 Task 4 v1.7 第七次外部复审修订验证

### 独立复现

- T4R-20：从 v1.6 计划机械提取最终五文件；输入 `String.raw` 的实际文本为 `select '\'; commit`，UTF-8 hex `73 65 6C 65 63 74 20 27 5C 27 3B 20 63 6F 6D 6D 69 74`。v1.6 scanner 实际 verdict 为 safe；callback delegate 1，底层 query delegate 收到原 SQL；callback 前 state 为 `begin`，callback 后含该 SQL，最终为 `begin`/SQL/precommit probe/`commit`；normal release `[1]`、destroy `[]`；UOW 结果 `{ rows: [] }`。`queryMode: extended` 仅是服务端第二层，未满足发送前拒绝。
- 根因：v1.6 `single` 状态对任何 `\` 直接跳过两个字符，错误吞掉 ordinary string 的真实闭合引号，导致顶层 `; commit` 留在伪字符串状态。
- T4R-21：v1.6 v8 报告 11975 bytes、UTF-8 无 BOM、LF 122。报告声明规范化值 `80167B6980C37858982A93D2A7B1C202D63394715D460B96CEA19095839B5FB1`；按其“只替换字段值并保留其余字节”规则计算为 `9D214CCEBEAAFB14301F12333C0996E9367B5F4E9EB87FFC7F60F689C1AF283E`，不相等。旧算法实际删除“报告完整文件”同行说明后缀，和声明算法不一致。

### v1.7 已执行并通过

- 词法策略：ordinary string 仅识别 `''`，含反斜杠即方案 A unsafe；E/e 仅在 token boundary 进入 escape；double/dollar/line/nested-block/code/BOM 独立状态；未闭合状态、括号不平衡与 U&/UESCAPE、bit、hex、national prefix 发送前 fail closed。
- LEX01～LEX23 从最终计划重提取运行为 23/23。四个指定 `String.raw` 输入均在 contract 表中；所有 reject case 直接过滤 `queryEvidence` 并证明目标 SQL delegate 0，insert 部分调用 0，健康策略拒绝 normal release，后续合法 execute 可复用 pool，错误敏感命中 0。
- Step 62：database 14767 / `455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C`；database.spec 12062 / `07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC`；transaction-context 5511 / `CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C`；unit-of-work 20848 / `CEF014A333DEEF90116642F7999B369548A9F02363315D6E653F011A828E451E`；integration 91785 / `32808E8B7A8C0121269F8945126AD6228CAF976B7FF3B6353C21DDC5990B74FC`。每路径 fragment=1/mirror=1，5/5 IDENTICAL。
- Step 63 从最终计划逐字提取：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <system TEMP extracted Step63>`；内部使用项目锁定 `node_modules/.bin/tsc.CMD -p <strictRoot>/tsconfig.json --pretty false`。TypeScript `Version 7.0.2`，exit 0、diagnostics 0、TS2578 0；Step 63 是最后编号步骤，Step 64+ 0，63 个 checkbox 已勾选 0。
- 最终 TEMP future database unit 12/12；v1.6 旧 scripted 聚焦子集 45/45；新增 LEX 23/23。八个过滤器 `TXCTL0[1-9]`、`REL0[1-5]`、`IMM01`、`(REL(03|04|05)|TXCTL(16|17))`、`CLEAN01`、`(IMM01|TXCTL25)`、`TXCTL(0[1-9]|1[014-9]|2[0-5])`、`LEX(0[1-9]|1[0-9]|2[0-3])` 的实际匹配依次为 9/5/1/5/1/2/23/23，全部 failed 0、exit 0。

### 已执行失败与边界

- 一次不带聚焦过滤器的 `SCRIPTED_ONLY=1` 全文件探索得到 68 passed/13 failed；13 条均是需要真实 fixture 的 UOW02/03/05/06/07/08/15/16/17/23/24 与 TXCTL12/13，在 fixture 按限制未启动后取得 `TRANSACTION_ACQUIRE_FAILED`。该命令不是本轮允许的真实 database 门禁，未写成通过；随后按计划分别验证旧 45 条 scripted 与新增 23 条 LEX。
- 本轮真实 PostgreSQL、完整 81/81、项目 build/typecheck/unit/database、Docker、Flyway、Testcontainers 均 `NOT_RERUN`。Task 4 代码 NOT_STARTED，第 8/48 步 NOT_STARTED。
- T4R-16、T4R-20、T4R-21：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`；T4R-17～T4R-19 无回归。Task 4 计划 READY v1.7、等待用户重新复审，不构成外部 ACCEPT。

## 2026-07-30 — 第 7/48 步 Task 4 v1.6 第六次外部复审修订验证

### 独立复现

- v1.5 Step 62 提取物：database 14192 bytes / `10C4C4B5B4E5C0442C2FA2F45D9BE23C79097626128D911265298DAD8585F73B`，database.spec 12062 / `07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC`，transaction-context 5059 / `B5F28F74851AE5E179B710130F075E427F3B3957D55CF170C2360AD7235EBF61`，unit-of-work 12058 / `D6DE638DC7CAE513ACDDB0363206AE3679E50AC6FBA2D214ABBC23ACD184F9C4`，integration 63629 / `2072B32404CB1E0B091601BEA8B7E5B3DC2EB7DFC441AED1000A36CED2C4B59C`。
- 第 10～14 节相应旧完整块：database 14533 / `91C8AC33E548F5B59D43526B57EF167E49A6AC518F2BD40787EA80960485B984`，database.spec 与 transaction-context 相同，unit-of-work 12929 / `CABCCD8FAFE168754B771B8BC03C04F11C4E4AA1530F4EAE5975C0A91DAA32FE`，integration 64691 / `6877E8F43A37AA784121A9EBE488E551667BCA244655F215FD9B33588461B1BF`；比较为 2/5 IDENTICAL。
- 旧 Step 62 五文件 strict/noEmit exit 1，TS2678×2；把第 10 节、14.1 节和 Step 71～74 散落声明人工合并，并修正 TEMP NodeNext 模块解析后，真实结果为 34 个 diagnostics，包含 pg/Kysely overload、CallbackConnection streamQuery、QueryCreator/QueryExecutorProvider、未定义 helper 和错误 state 字段。外部“8 个错误”与本轮组装边界不同，本轮按真实 34 记录。

### v1.6 已执行并通过

- Step 62：database 14727 / `8BDB106F79C241888D4AB901613444431D74D1541397919801D281A87124E87D`，database.spec 12062 / `07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC`，transaction-context 5511 / `CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C`，unit-of-work 17935 / `0AC357A6883E2B5279E5C9E672A1DC3FC9ECE5277150147956B7D2D81272CA71`，integration 78416 / `33E015B52B78FE0EE49D36972182C3A573437EE34D1AA77B0091E3E781A0F03D`；各路径 fragment=1，5/5 IDENTICAL。
- Step 63 原文从最终计划提取并执行：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <system TEMP extracted Step63>`；内部逐字命令为项目锁定 `node_modules/.bin/tsc.CMD -p <strictRoot>/tsconfig.json --pretty false`。TypeScript `Version 7.0.2`，exit 0，diagnostics 0，TS2578 0；strictRoot 与提取脚本均已删除。
- TEMP future database unit：12/12 passed。future integration scripted 聚焦：45 passed、13 skipped、failed 0；T4R-07/08/09/10/12/13/15/16 精确过滤器为 9/5/1/5/1/2/1/23 passed，均 exit 0。所有过滤器 matched ≥1；这不是项目正式测试或真实 PostgreSQL 通过。
- T4R-16～T4R-19：`RESOLVED_IN_PLAN / WAITING_EXTERNAL_REVIEW`。Task 4 计划 READY v1.6，代码 NOT_STARTED；真实 PostgreSQL、完整 58/58、项目 build/typecheck/unit/database、Docker、Flyway 和 Testcontainers 均 NOT_RERUN。

## 2026-07-29 — 第 7/48 步 Task 4 v1.5 第五次外部复审修订验证

- 外部复审新阻断为 `T4R-16`：v1.4 callback 的任意 QueryCreator 可生成 `select 1; rollback; select 1`、`select 1; commit; select 1` 或单条控制语句；复审结论 `NOT_APPROVED`。本轮只更新计划与状态文档，不实施 Task 4。
- 静态复审确认 v1.5 设计在现有 Create 3/Modify 2 内闭合：UnitOfWork 闭包持有内部 raw `DatabaseConnection`，callback 只持有受 lease 保护的 `CallbackConnection`；发送前 lexer 处理 BOM、空白、行注释、嵌套块注释、字符串和 dollar literal，拒绝顶层多语句及完整控制词表；pg query config 强制 `queryMode: 'extended'`。未依赖事后 probe、共享布尔标记、简单 `includes`、反射或第二 pool。
- 未来测试矩阵由 33 条扩展为 58 条（TXCTL01–TXCTL25）；计划给出每个测试标题、断言和完整 Addendum 代码段。58/58、真实 PostgreSQL 无部分提交、queryMode 观测和 filter 匹配均是未来施工证据，当前 `NOT_RERUN`，不得写成已通过。
- 本轮静态验证：允许修改集合仅含 16 份 Markdown（含计划）；工程 Create 3 实际存在数应保持 0，工程文件新建/修改/删除 0。未运行 build、typecheck、unit、database、Docker、PostgreSQL、Flyway、Testcontainers、Git 或外部服务；以上均 `NOT_RERUN`。
- 锁文件与依赖未修改；Secret、TEMP、缓存、日志和测试残留未因本轮产生。完整 UTF-8、fence、链接和交付物哈希将在生成本轮复审包前执行静态扫描并如实记录。
- 当前仍为第 7/48 步；Task 3 `VERIFIED v1.5`；Task 4 计划 `READY v1.5`、等待用户复审；Task 4 代码与第 8/48 步 `NOT_STARTED`。唯一下一步是用户复审 Task 4 v1.5。

## 2026-07-29 — 第 7/48 步 Task 4 v1.4 第四次外部复审修订验证

### 状态、范围与裁决

- 外部复审结论：`NOT_APPROVED`。T4R-13～T4R-15 均为 `ACCEPT`；独立详细计划修订为 `READY v1.4（等待用户重新复审）`。Task 4 代码、Tasks 5–14 与第 8/48 步保持 `NOT_STARTED`。
- 未来精确工程写集合保持 Create 3、Modify 2、Delete 0；本轮只允许修改 16 份 Markdown，项目新增/删除/工程文件/白名单外修改必须为 0，三个未来 Create 路径实际存在数必须为 0。
- T4R-13 根因：`Object.freeze + instanceof + 精确 prototype` 不构成不可伪造品牌；V8 继承式 stack setter 还可让 frozen Error 的 `Reflect.set(stack)` 返回 true。v1.4 采用三个模块私有 WeakSet 品牌、固定不可写/不可配置脱敏 stack、冻结实例/prototype和精确类型检查；跨模块只导出 WeakSet 查询函数，不导出 token。
- T4R-14 根因：strictRoot 无最近 `type=module` package，NodeNext 把五文件判为 CommonJS。v1.4 Step 63 自己写入并回验 TEMP package，锁定 tsc 版本、paths 和五文件 include。
- T4R-15 根因：旧 CLEAN01 手工调用 owner，不经过 beforeAll 的真实 setup/catch。v1.4 beforeAll 与 CLEAN01 共用 `setupOwnedResources`，owner 独立持有 fixture、未移交 raw pool 或 database，catch 始终保留 `TEST_RESOURCE_SETUP_FAILED` 并只公开稳定 cleanup categories。

### 已执行并通过

- v1.4 五文件逐字提取物的最终 Step 63 命令逐字运行：`TYPESCRIPT=7.0.2 TEMP_PACKAGE_TYPE=module TS7_STRICT_NOEMIT=PASS FIVE_FILES=5 TASK4_EXPECT_ERROR=4 UNUSED=0`，exit 0。项目 package/tsconfig/依赖/锁文件变化 0。
- v1.4 TEMP focused spec 不连接数据库：IMM01 1 passed/0 failed/32 skipped、CLEAN01 1/0/32、UOW20 1/0/32、REL01～REL05 5/0/28，均 exit 0。IMM01 直接证明三类伪造即使 frozen/instanceof/精确 prototype 仍被拒绝，rollback 成功/失败顶层均无伪造 cause；合法三类 identity 保持；set/defineProperty 与递归泄漏断言真实存在并执行。
- CLEAN01 通过与 beforeAll 完全相同的 `setupOwnedResources` 真实注入 after-fixture、after-raw-pool、after-database、raw cleanup failure 和 database cleanup failure；fixture stop、raw end、database destroy 次数与顺序、稳定 setup code/categories、递归 raw 泄漏均通过。
- 系统 TEMP 的同名 33-test Vitest 4.1.10 最小套件逐条实测九个过滤器：1/0/32、4/0/29、1/0/32、5/0/28、8/0/25、2/0/31、2/0/31、1/0/32、5/0/28；完整文件直接运行 33/0/0。顺序为 passed/failed/skipped，全部 exit 0；仅证明过滤器匹配。

### 已执行并失败后纠正

- v1.3 最终 Step 63 逐字复现 exit 1：TS1295×41、TS1287×11、TS1470×4，证实缺少 TEMP ESM package。v1.4 加入 package 后的首轮又发现 `migrateAndValidate` 返回类型和 beforeAll 泛型拓宽两个真实 TS 错误；修正未来代码精确类型后，同一最终 Step 63 逐字 exit 0。
- v1.3 三类 prototype 伪造 TEMP 复现 3/3 被接受为公开 cause。v1.4 IMM01 首轮进一步发现 frozen Error 的继承式 stack setter；把 stack 固化为不可写脱敏 own data property 后，最终 focused 验证通过。

### 未运行与授权边界

- build、项目 typecheck、unit、database、Docker、PostgreSQL、Flyway、Testcontainers 和 `pnpm test:all` 均 `NOT_RERUN`；TEMP strict、scripted 与 filter proof 不得写成项目测试通过。
- Git、worktree、子代理、并行代理、Telegram、外部业务服务、生产部署和第 8/48 步执行数量均为 0。
- 未实施 Task 4，未进入第 8/48 步。唯一下一步：等待用户重新复审 Task 4 v1.4。

## 2026-07-29 — 第 7/48 步 Task 4 v1.3 第三次外部复审修订验证

### 状态、范围与裁决

- 外部复审结论：`NOT_APPROVED`。T4R-07～T4R-12 均为 `ACCEPT`；独立详细计划已修订为 `READY v1.3（等待用户重新复审）`。Task 4 代码、Tasks 5–14 与第 8/48 步保持 `NOT_STARTED`。
- 未来精确工程写集合保持 Create 3、Modify 2、Delete 0；本轮实际只修改 16 份授权 Markdown，新建/删除/工程文件/白名单外修改均应为 0。三个未来 Create 路径实际存在数必须为 0。
- T4R-08 根因已对照本地 Kysely 0.29.4 `DefaultConnectionProvider` 复核：provider 在 `finally` 执行 release，release reject 会覆盖 consumer resolve/reject。v1.3 wrapper 记录 transaction outcome；普通 release throw 后尝试 destroy fallback，只有已知 COMMITTED 产生 `COMMITTED / retryable=false` 的固定安全错误，ROLLED_BACK、UNKNOWN、callback+rollback 与 commit+rollback 主结果不被 cleanup failure 改写。
- T4R-09：`PublicUnitOfWorkError`、`UnitOfWorkError`、`TransactionContextError` 和对应 prototype 运行时冻结；安全 identity 判断要求 frozen、精确 class 与精确 prototype。IMM01 直接尝试污染 message、cause、detail、constraint、SQL、parameters 与 password，并覆盖 rollback success/failure。
- T4R-10/T4R-12：未来真实 fixture 的唯一 raw pool 由测试专用 observable client adapter 包装；UOW23/UOW24 直接观察 failed pid 的底层 `release(true)`、普通 release 0 与后续新 pid。UOW20 让 database.destroy 同步重入同一 owner.close；CLEAN01 覆盖 fixture-only、raw pool pre-Kysely、database owner 后续 setup failure 和首错不跳过第二资源。

### 已执行并通过

- 系统 TEMP 最小 Vitest 4.1.10 套件使用与未来 spec 相同的 `describe.sequential('Task 4 Unit of Work')` 和 33 个 test title。九个最终过滤器逐条实测：`UOW09:` = 1/0/32；`UOW(09|10|11|12):` = 4/0/29；`UOW01:` = 1/0/32；`REL(01|02|03|04|05):` = 5/0/28；`(UOW(18|19|21|22|25)|REL(03|04|05)):` = 8/0/25；`UOW(23|24):` = 2/0/31；`(UOW20|CLEAN01):` = 2/0/31；`IMM01:` = 1/0/32；`(UOW(09|10|11|12)|REV01):` = 5/0/28。数字顺序为 passed/failed/skipped，全部 exit 0。
- 同一 TEMP 最小套件直接运行文件且不使用 `-t`：33/33 passed、failed 0、skipped 0、exit 0。该证据只证明过滤器匹配与统计，不是 Task 4 项目测试。
- 从 v1.3 计划未来最终内容构造的五个工程文件，使用现有 TypeScript 7.0.2、Kysely 0.29.4、Vitest 4.1.10 与 workspace 声明执行独立 strict/noEmit，最终 exit 0；Task 4 integration spec 的四个 `@ts-expect-error` 均被消费。

### 已执行并失败后纠正

- 首次系统 TEMP 五文件 strict/noEmit 因临时目录只链接根 `node_modules`，无法解析 platform workspace 的 `kysely`、`@xht/contracts`、`@xht/testing` 与 `vitest`，exit 1；这是 TEMP 验证配置错误，不是未来代码类型失败。随后用不修改项目的 TEMP `paths` 精确指向现有声明文件，重新执行 exit 0。失败事实保留，不冒充首次通过。

### 未运行与授权边界

- build、项目 typecheck、unit、database、Docker、PostgreSQL、Flyway、Testcontainers 和 `pnpm test:all` 均 `NOT_RERUN`；计划提取物 strict/noEmit 与最小 filter proof 不得写成项目测试通过。
- Git、worktree、子代理、并行代理、Telegram、外部业务服务、生产部署和第 8/48 步执行数量均为 0。
- 未实施 Task 4，未进入第 8/48 步。唯一下一步：等待用户重新复审 Task 4 v1.3。

## 2026-07-29 — 第 7/48 步 Task 4 v1.2 二次外部复审修订验证

### 状态与范围

- Task 4 v1.1 二次外部复审结论：`NOT_APPROVED`。T4R-01、T4R-02、T4R-04A～T4R-04D、T4R-05 与 T4R-06 均为 `ACCEPT`；独立详细计划已修订为 `READY v1.2（等待用户重新复审）`。Task 4 代码、Tasks 5–14 与第 8/48 步保持 `NOT_STARTED`。
- 对照本地 Kysely 0.29.4 `DefaultConnectionProvider`、PostgresDriver 与 Task 3 `RoleEnforcingPostgresPool` 的真实接口确认：Kysely provider 只调用 client 无参 release，公开 `DatabaseConnection` 没有 destroy/release(true)。原 Create 3/Modify 0 无法满足故障连接销毁；最小可执行未来范围为 Create 3、Modify 2、Delete 0。
- Modify 2 精确为 `apps/platform/src/infrastructure/database/database.ts` transaction-control wrapper，以及 `apps/platform/test/unit/database.spec.ts` 的一条 wrapper identity 断言；不修改 Task 3 factory、公开 QueryCreator facade、schema、migration、依赖或锁文件。
- 本轮实际项目变化只包含 16 份授权 Markdown；新建 0、删除 0、非 Markdown/工程文件修改 0、白名单外修改 0。三个 Task 4 Create 路径实际存在数 0。

### 复审阻断闭环

- T4R-01：未来执行清单 50 个 checkbox 全部未勾选；每个写测试、写实现、修改 fixture/owner 和文档写入动作下方直接包含准确代码块。禁止的跨节复制/引用和 TODO/TBD/FIXME 命中 0。
- T4R-02：未来 spec 的 beforeAll 只初始化 fixture、Flyway 与 database owner，`loadUnitOfWorkModule` 命中 0；UOW09～UOW12 各自验证 loader 计数不增加。命令顺序明确要求 UOW09 context 缺失 RED → UnitOfWork 不存在时 context 四测 GREEN → UOW01 UnitOfWork 缺失 RED。
- T4R-04A：固定同连接 probe `select 1 as xht_transaction_precommit_probe` 在 COMMIT 前执行；SQLSTATE `25P02` 显式 rollback 并抛 `TRANSACTION_ABORTED_BEFORE_COMMIT`，不读取 Kysely 未暴露的 command tag。UOW07 是未来真实 PostgreSQL 约束失败捕获测试，要求 reject、持久写入 0、无 callback result。
- T4R-04B：Task 3 wrapper 对 begin/rollback/commit 和非 `25P02` probe 故障设置 poison；Kysely provider 最终无参 release 被映射为底层 `release(true)`。scripted pool 分别记录 normal/destroy client id；UOW18/19/21/25 与真实 UOW23/24 要求后续取得新连接。
- T4R-04C：明确 commit 拒绝、commit+rollback 双失败与 `TRANSACTION_COMMIT_OUTCOME_UNKNOWN` 分离。UNKNOWN 不 rollback、不返回 result、不自动重试资金或业务命令；调用方必须使用幂等键查询权威状态并完成对账。
- T4R-04D：只有冻结的 `PublicUnitOfWorkError` 和 Task 4 自身固定错误可保留 identity/安全 cause。其他 callback/Kysely/pg/连接错误均无 raw cause；UOW06/19/21/22/23/24/25 直接检查 message、cause、stack 和常见 pg 字段，合成密码、SQL、参数、用户名、连接串与 raw detail 公开命中 0。
- T4R-05：未来 `TestResourceOwner.close()` 在暴露 sticky Promise 后分别尝试 database destroy 与 fixture stop；前项失败不跳过后项。beforeAll 部分初始化失败清理已拥有资源；UOW20 注入 database destroy 失败并要求 fixture stop 仍执行，重复 close 共享同一 Promise。
- T4R-06：新报告规范化算法固定为：最终 UTF-8 字节中只把规范化哈希字段的 64 位十六进制值替换为 64 个 `0` 后计算 SHA-256；写入该值后不再修改报告并独立复算。完整报告 SHA-256 使用 `EXTERNAL_FINAL_RECEIPT`，由最终回复提供。

### 静态验证

- 从计划第 15 节逐段提取未来 `database.ts` 6 段、`transaction-context.ts` 3 段、`unit-of-work.ts` 5 段、integration spec 19 段，并把计划规定的一条 `database.spec.ts` 断言应用到现有文件副本。使用现有依赖执行 TypeScript `7.0.2` strict/noEmit，exit `0`。
- 提取物 test name：UOW01～UOW25 精确 25、REV01 精确 1；beforeAll 内 UnitOfWork loader 命中 0。
- 最终项目快照：122 文件（Markdown 67、非 Markdown 55）；严格 UTF-8 解码失败 0；Markdown fence 失衡 0；相对链接 226，断链 0、越界 0；TEMP 残留 0。
- Task 4 计划 checkbox：未勾选 50、已勾选 0；禁止占位表达命中 0；写入 checkbox 紧邻实际代码块失败 0。
- 真实/强特征 Secret：Telegram token、私钥头与 AWS access key 命中均为 0。
- 锁定哈希保持：`package.json` = `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；`pnpm-lock.yaml` = `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；`toolchain-lock.json` = `3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`。
- README、总索引、handoff、state-model、阶段总计划、Task 3/4 计划、active-plan-index、roadmap、current、next、active-work 与测试门禁一致表明：当前第 7/48 步，Task 3 VERIFIED v1.5，Task 4 计划 READY v1.2 等待重新复审、代码 NOT_STARTED，第 8/48 步 NOT_STARTED。

### 未运行与授权边界

- build、项目 typecheck、unit、database、Docker、PostgreSQL、Flyway 与 Testcontainers 均 `NOT_RERUN`；计划提取物 strict/noEmit 是静态计划验证，不得写成真实项目测试通过。
- Git、worktree、子代理、并行代理、Telegram、外部业务服务、生产部署和第 8/48 步执行数量均为 0。
- 未实施 Task 4，未进入第 8/48 步。唯一下一步：等待用户重新复审 Task 4 v1.2。

## 2026-07-28 — 第 7/48 步 Task 4 v1.1 外部复审修订验证

### 复审裁决与计划内容

- Task 4 v1.0 外部复审结论：`NOT_APPROVED`。T4R-01～T4R-04 均为 `ACCEPT`，独立详细计划已修订为 `READY v1.1（等待用户重新复审）`；Task 4 代码和第 8/48 步保持 `NOT_STARTED`。
- T4R-01：三个未来文件的完整 TypeScript 均逐字写入计划；25 个执行 checkbox 全部未勾选；UOW01～UOW20 与 REV01 均有唯一精确 test name、实际 test body 和断言；禁止占位表达命中 0。
- T4R-02：采用动态 runtime import 和精确 test-name 的方案 A；TransactionContext 的 UOW09～UOW12 不加载 UnitOfWork，可独立 RED→GREEN；UnitOfWork 再由 UOW01 独立 RED→GREEN，不以整个 spec 收集失败冒充局部 GREEN。
- T4R-03：计划、完整代码和执行步骤统一为 callback settle → `finally` revoke → commit/rollback。REV01 使用 scripted commit gate 证明 outer execute 尚未 settle 时 context 已关闭，driver SQL 增量为 0。
- T4R-04：对照本地 Kysely 0.29.4 源码确认标准 `TransactionBuilder.execute` 在 rollback 失败时会覆盖 callback/commit 原错误。v1.1 使用同一 executor/connection 的受控 BEGIN/COMMIT/ROLLBACK；callback+rollback 保留 callback 为 `cause` 并仅附加脱敏 ROLLBACK 类别，commit+rollback 只公开 COMMIT/ROLLBACK 类别，provider `finally` 归还连接。

### 本轮已执行的静态验证

- 从计划第 10～12 节逐字提取三个未来文件到系统 TEMP，文件分别为 4,285、4,587、23,433 bytes；使用项目既有 TypeScript 7.0.2、Kysely 0.29.4 和既有 workspace 类型执行 strict/noEmit 编译，exit 0。未把 TEMP 文件写入项目，未安装、删除或升级依赖。
- 最终项目快照仍为 122 文件（Markdown 67、非 Markdown 55）；三个未来 Task 4 工程路径实际存在数 0。
- 以未覆盖的第 7 步 v2 复审包 122 文件为逐文件 SHA-256 基线，当前精确修改 16 份授权 Markdown、新建 0、删除 0、工程文件修改 0、白名单外修改 0。
- 全部 122 文件 strict UTF-8 解码失败 0；Markdown fence 失衡 0；围栏外相对链接 226、断链 0、越界 0。
- Task 4 计划 checkbox 未勾选 25、已勾选 0；禁止占位表达命中 0；UOW test name 20、缺失 0、重复 0，REV01 1。
- 强特征 Secret 命中 0；项目 TEMP/cache/log/test 临时残留 0。
- `package.json` SHA-256 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；`pnpm-lock.yaml` SHA-256 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；`toolchain-lock.json` SHA-256 `3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`，均无漂移。
- README、总索引、handoff、state-model、阶段总计划、Task 3 计划、active-plan-index、roadmap、current、next、active-work、Task 4 计划和测试门禁一致表明：当前第 7/48 步，Task 3 VERIFIED v1.5，Task 4 计划 READY v1.1 等待重新复审、代码 NOT_STARTED，Tasks 5–14 与第 8/48 步 NOT_STARTED。

### NOT_RERUN 与当前结论

- 本轮只做 Markdown 修订和系统 TEMP 的计划代码 strict/noEmit 编译。项目 build、项目 typecheck、unit、database、Docker、PostgreSQL、Flyway、Testcontainers 和 `pnpm test:all` 均为 `NOT_RERUN`。
- 未运行 Git、worktree、子代理、并行代理、Telegram、其他业务外部服务、共享/生产数据库或部署。
- 未实施 Task 4，未创建三个未来工程文件，未进入第 8/48 步。唯一下一步是等待用户重新复审 Task 4 v1.1。

## 2026-07-25 — 第 7/48 步 Task 3 验收登记与 Task 4 v1.0 规划验证

### 用户验收事实

- 第 6 步外部复审：`PASS`。
- T3R-13：`ACCEPT`，修订复审通过并正式关闭。
- Task 3 详细计划、代码与测试：`VERIFIED v1.5`；未解决阻断 0。
- `.dependency-cruiser.cjs` 属于未来 Task 12；既有 `pnpm test:all` 停止事实不构成 Task 3 阻断。
- 第 6 步临时工程、镜像、Docker 和数据库授权保持已消费并归零。

### 本轮已执行的静态验证

- 创建 Task 4 独立详细计划 v1.0；计划状态 READY、等待用户复审，代码 NOT_STARTED。
- 对照真实 Task 3 源码确认：数据库类型为 `StageOneDatabase`；内部 owner 为 `Kysely<StageOneDatabase>`；公开 `RoleBoundDatabase.db` 为独立 `QueryCreator` facade；`RoleEnforcingPostgresPool` 负责 session/current role；fixture 提供 platform login、Flyway migrate/validate 与唯一 stop。
- 计划精确文件映射为 Create 3、Modify 0、Delete 0；production wiring 不在三文件范围，若未来要求必须先修订授权，禁止第二 pool/第二 Kysely 或 facade 强转。
- 计划覆盖 UOW01–UOW20、context/database/builder/派生 executor 禁止逃逸、嵌套拒绝、同步 throw、异步 reject、返回值、任一步 SQL 失败全回滚、同一 backend、角色、错误脱敏和资源清理。
- 最终项目快照为 122 文件（Markdown 67、非 Markdown 55）；相对基线精确修改 15 份授权 Markdown、新建 Task 4 计划 1、删除 0、非 Markdown 修改 0、白名单外修改 0。Task 4 三个未来工程路径实际存在数 0。
- 严格 UTF-8 解码失败 0，Markdown fence 失衡 0，相对链接 226、断链 0、越界 0，强特征 Secret 命中 0，TEMP/cache/log 残留 0。
- `package.json` SHA-256 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；`pnpm-lock.yaml` SHA-256 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；`toolchain-lock.json` SHA-256 `3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`，均无漂移。
- 首次只读哈希脚本使用当前 PowerShell/.NET 不支持的 `System.IO.Path.GetRelativePath` 并超时，未产生有效结论；改用已验证的根路径 substring 后对 122 文件完成精确基线对照。首次项目外交付物存在性检查的 foreach 后直接管道触发 PowerShell parser error；加显式结果数组后重跑成功，两个目标均不存在。两次均未写项目、未改变范围，也未冒充验证通过。
- ZIP 与报告校验在项目快照冻结和交付物生成后记录到项目外报告；任一失败不得宣告本轮完成。

### NOT_RERUN

- 本第 7 步未运行 build、typecheck、unit、database integration、Docker、PostgreSQL、Flyway、Testcontainers 或 `pnpm test:all`。
- 第 6 步 unit 132/132、database unit 24/24、真实 database 65/65 与连续双轮结果是已验收历史证据，不是本轮重新执行。
- 未运行 Git、worktree、代理、依赖安装/升级、Telegram、其他业务外部服务或部署。

### 当前结论

- 当前为第 7/48 步；Task 3 VERIFIED v1.5。
- Task 4 详细计划 READY v1.0、等待用户复审；代码 NOT_STARTED。Tasks 5–14 NOT_STARTED。
- 唯一下一步：等待用户复审 Task 4 v1.0；未经新授权不得进入第 8/48 步或实施 Task 4。

## 2026-07-25 — 第 6/48 步 T3R-13 文档状态一致性修订验证

### 修改前失败复现

- 只读检查以三个当前状态段落为精确目标，稳定得到冲突 3/3：`ai-handoff.md` 仍称当前第 5 步且 Task 3 代码 NOT_STARTED；`state-model.md` 仍称 Task 3 代码始终 NOT_STARTED；阶段 1 总计划当前摘要仍称代码 NOT_STARTED。命令 exit 1，证明 T3R-13 成立。
- 对照 `current.md`、`next.md`、活动计划索引与 Task 3 独立计划，权威当前事实均为第 6/48 步、Task 3 已完成 19 路径实施及本地验证、代码 READY v1.5、等待用户复审且尚非 VERIFIED。根因是实施终态同步遗漏；历史第 5 步 NOT_STARTED 记录不属于缺陷。

### 静态检查已执行并通过

- 修订写入后的全项目静态检查：项目文件 121，Markdown 66、非 Markdown 55；全部文件 strict UTF-8 解码失败 0；Markdown fence 失衡 0；围栏外相对链接 222，断链 0、越界 0。
- 三处错误的当前状态命中 0；`current`、`next`、`active-work`、`ai-handoff`、`state-model`、阶段 1 总计划与 Task 3 独立计划的第 6 步/READY v1.5/等待复审/非 VERIFIED/不得进入第 7 步状态缺失 0。历史第 5 步标记缺失 0。
- 相对修改前逐文件 SHA-256 基线，实际变化精确为 7 份白名单 Markdown；新建 0、删除 0、白名单外修改 0、工程文件修改 0。README、总索引、`current`、`next` 与活动计划索引均未修改。
- `package.json` SHA-256 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；`pnpm-lock.yaml` SHA-256 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；`toolchain-lock.json` SHA-256 `3B9EDDD018DFA04819FFCA9F728B4066FC602F7BC92DFAF7EA7168F808D7C8D0`。三者均与基线一致。
- PEM 私钥、Telegram Bot Token、AWS access key、npm token 强特征命中均为 0；项目内 TEMP/缓存/验证辅助文件残留 0。

### 本轮未重新执行

- build、typecheck、unit、Docker、PostgreSQL、Flyway、Testcontainers、数据库迁移和真实 database 65/65 均为 `NOT_RERUN`。第 6 步已有验证证据保持，不冒充本轮执行。
- Git、worktree、子代理、并行代理、Telegram、其他业务外部服务、共享/生产数据库、生产部署、Task 4 和第 7/48 步均未执行。

### 状态结论

- T3R-13：`ACCEPT`，已按 7 份 Markdown 白名单修订，等待用户复审。当前仍为第 6/48 步；Task 3 详细计划与代码 READY v1.5、尚非 VERIFIED；第 7/48 步与 Tasks 4–14 NOT_STARTED。

## 2026-07-25 — 第 6/48 步 Task 3 v1.5 正式实施终态验证

### 已执行并通过

- 上下文与范围：按权威恢复顺序及 Task 3 指定文件读取到 EOF；确认第 6/48 步、Task 1/2 VERIFIED、Task 3 READY v1.5 后进入 BUILDING、Tasks 4–14 NOT_STARTED。开始项目源 105；最终项目源 121，新增 16 个路径与 Planned File Map 的 Create 16 完全相等，Modify 精确为 `packages/contracts/src/index.ts`、`packages/testing/src/index.ts`、`toolchain-lock.json`，Delete 0，额外 Task 3 工程文件 0。
- 供应链：Node `v24.18.0`、pnpm `11.15.1`。根 `package.json` SHA-256 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD` 与 `pnpm-lock.yaml` SHA-256 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC` 均与开始基线相同；依赖新增/删除/升级 0。
- 镜像与平台：Docker Desktop Engine `29.6.2` 为 linux/x86_64。官方 tag fresh inspect 得到 PostgreSQL manifest list `sha256:996d0920...c5f5e`、linux/amd64 child `sha256:2342268e...d769`；Flyway manifest list `sha256:6bf3a713...f71b0`、child `sha256:bd93084d...9704`。两个精确 child ref 已拉取并运行，image inspect 均为 linux/amd64；`.withPlatform(locked.platform)` 为 2/2。
- TDD：镜像锁测试有效 RED 3/3 后 GREEN 3/3；两个 app database spec 在模块不存在时有效 RED，最小实现后最终 U01–U12 2 文件 24/24；两个 database integration spec 在 `startPostgresFixture` 不存在时有效 RED，最终真实 PostgreSQL/Flyway 通过。
- 数据库与迁移：PostgreSQL 18.4 空库 V1 migrate、同库第二次 migrate、validate 均 exit 0；隔离 migration 副本追加无副作用语句后 validate 稳定 `FLYWAY_VALIDATE_FAILED` 且清理证据为空。业务表精确 9，Flyway history 成功记录 1 行且 checksum 非空；history 和全部业务表 owner 均为 `xht_flyway`。命名外键、唯一约束、关键 CHECK、六个索引、timestamptz、Inbox digest/version 允许列、raw Telegram 禁止列和资金/链禁止字段全部通过。
- 权限：bootstrap、三个 NOLOGIN 与三条测试 LOGIN 全部存在；LOGIN 无 superuser/createdb/createrole 且各只有一条 ADMIN false、INHERIT false、SET true 成员资格。SET ROLE 前 platform/worker 看不到业务表；Flyway、platform、worker 切换到唯一角色后，P01–P23 允许/拒绝矩阵全部通过。app DDL、history、DELETE、跨角色 SET ROLE 均被拒绝；bootstrap session user 在 app factory 证据中命中 0。
- Kysely/关闭：两个 app 的 U01–U12 为 24/24。五类取得 client 后失败均 `release(true)` 一次，connect 前失败 release 0，成功 client 正常 release；wrapper/handle 的普通并发、同步重入、同步/异步失败和后续调用共享同一粘滞 Promise，底层 end 每场景最多一次。独立 TypeScript 7 strict 命令编译两个 database spec exit 0，20 个 `@ts-expect-error` 全部被消费；QueryCreator facade 本体与三条安全链 runtime close 能力命中 0。
- Flyway 日志/清理：M15/M16 的 scenario 01–24 均为独立具名 test。raw request 同步/异步失败、Buffer/stream 成功、响应/忽略 abort、late resolve/reject、signal、timer 与 unhandled；header/payload/EOF/type/reserved、stream error/close/timeout、raw/payload/frame 刚好/首超限、三路 Secret 扫描、主失败叠加 remove 失败、owner mismatch 与唯一 remove 均通过。telemetry 固定 `'true'`，bind mount、`onReserveConnection`、telemetry email/token/license/pipeline/collector 和 Flyway password command 参数命中均为 0。
- 最终命令：`pnpm build` exit 0；`pnpm typecheck` exit 0；`pnpm test:unit` 为 9 文件 132/132；两个 Task 3 database unit spec 为 2 文件 24/24；最终两个 database spec 为 2 文件 65/65，并在最终工程状态连续运行通过。最终只读 Docker 核对：Task 3 PostgreSQL 容器 0、Flyway owner 容器 0、诊断容器 0、Testcontainers network 0。

### 已执行、失败后纠正或按阶段边界保留

- 当前 Windows 进程存在大小写冲突的 PATH/Path；第一次 `pnpm exec vitest` 未找到 Vitest，测试未启动，未冒充 RED。改用同一锁定 `node_modules/.bin/vitest.CMD` 后取得真实 RED/GREEN；未修改环境或依赖。
- 首轮真实 database 为 2 suites failed、41 skipped，稳定主错误 `FLYWAY_MIGRATE_FAILED`。脱敏独立复现确认 afterConnect callback 已执行，但 Flyway 12.11.0 的 schema-history housekeeping 连接仍以 LOGIN 身份创建 history 表并收到 PostgreSQL `42501`。同一隔离 fixture 加 JDBC connection-level `options=-c role=xht_flyway` 后 exit 0；最终保留 callback 并在所有连接建立时强制角色，表 owner/LOGIN 直接权限矩阵证明边界未放宽。
- 第二轮真实 database 为 36/41：checksum TEMP root、Inbox 禁止列查询范围、SET ROLE 前对象不可见错误码与跨文件并发清理观察四类测试契约问题。收紧 TEMP 自身 canonical root、只扫描 Inbox、精确接受 `42P01` 不可见、用条件等待观察本次/并发 owner 清理后通过；生产权限未放宽。
- M15/M16 扩展首轮为 37/39，stream error/close 在动态模块监听器注册前过早触发。改为先返回 source/观察 Promise、下一事件循环再触发后通过；unhandled rejection 0。
- `pnpm test:all` 实际执行：build 与 typecheck 通过，随后 `architecture:check` 因 `.dependency-cruiser.cjs` 不存在 exit 1，后续 suite 未由该链执行。权威阶段计划把该配置列为未来 Task 12 Create，Task 3 19 路径不含它，因此未越权补建；Task 3 第 12 节 Task 3.7 规定的精确最终命令随后全部通过。

### 未执行

- 未运行 Git 写入、worktree、子代理、并行代理、Telegram、collector、其他业务外部服务、共享/预发布/生产数据库、生产迁移、真实 Secret、生产部署、Tasks 4–14 或第 7/48 步。
- 未执行 `pnpm audit`、依赖安装/升级或 lifecycle；未创建未来 Task 12 `.dependency-cruiser.cjs`，未把 `pnpm test:all` 记录为 PASS。

### 结论

- Task 3 从 `NOT_STARTED → BUILDING → READY v1.5`。19 路径、功能、权限、Secret、容器生命周期和 Task 3 完成门禁均有真实新鲜证据；状态为等待用户复审，尚非 VERIFIED。
- 第 6 步临时工程/镜像/本地容器授权已消费并归零。唯一下一步：等待用户复审；未经结论不得进入第 7/48 步。

## 2026-07-25 — 第 5/48 步 Task 3 v1.5 raw Docker request timeout 终态验证

### 已执行并通过

- 指定项目治理、状态、阶段主计划、Task 3 v1.4、架构、安全、测试、verification、progress-log 与 source-register 以 strict UTF-8 读取到 EOF；基线一致：第 5/48 步、阶段 0 VERIFIED、阶段 1 总计划 READY v1.2.6/代码 BUILDING、Task 1 VERIFIED、Task 2 VERIFIED v1.2.6、Task 3 计划 READY v1.4/代码 NOT_STARTED、Tasks 4–14 NOT_STARTED。Node `v24.18.0`、pnpm `11.15.1`、项目源 105（Markdown 66、非 Markdown 39）与三锁定哈希精确匹配。
- 逐字提取 v1.4 最终 503-byte `readLogs()`：fake `container.logs()` 返回永久 pending Promise，400ms 后结果 `TIMEOUT`、logsCalls 1、abortSignalPresent false、cleanupCalls 0、collectDockerLogsCalled false、logReadTimerStarted false；裁决 T3R-12 ACCEPT。
- 本地精确版本为 Dockerode 5.0.1、docker-modem 5.0.7、Testcontainers 12.0.4、@types/dockerode 4.0.1。源码确认 Dockerode 把 opts.abortSignal 传给 modem，docker-modem 把信号设置为底层 request signal，ContainerLogsOptions 公开 abortSignal；v1.4 未传该字段且只在 source 返回后启动 stream timeout。
- 从最终 v1.5 计划逐字提取 platform/worker/Flyway runner 代码块（9036/9030/20356 bytes），使用 TypeScript 7.0.2 strict、真实 Kysely 0.29.4、Testcontainers 12.0.4、Dockerode 5.0.1 与 @types/dockerode 4.0.1 类型编译 exit 0；20 个 `@ts-expect-error` 全部被消费。
- 两个 app 的 facade 本体及三类安全链 runtime 关闭能力为 0、CRUD builder 可创建；wrapper 的成功/同步 throw/异步 reject 与 handle 的普通并发、同步重入、失败/后续调用均同 Promise，底层 end 每场景 1、稳定 `DATABASE_CLOSE_FAILED`、Secret 0、unhandled rejection 0。
- T3R-11 原 24/24 场景保持：Buffer/stream、三路密码、header/payload/trailing、type/reserved、stream error/close/timeout、raw/payload/frame 边界、同步异常、唯一清理和主/清理叠加全部通过；展开日志失败 29。T3R-12 request 矩阵的同步 throw、异步 reject、Buffer/stream 成功、响应 abort、忽略 abort、late resolve 与 late reject 全部通过。
- raw request 的 sync throw、async reject、respondsToAbort、ignoresAbort 四类完整 runner 失败都 remove 恰好 1；request timeout 叠加 remove 失败仍为 `FLYWAY_LOG_READ_FAILED`，cleanupEvidence 只含 `FLYWAY_CLEANUP_REMOVE_FAILED`。`LOG_REQUEST_TIMEOUT_MILLIS=5000` 与 `LOG_READ_TIMEOUT_MILLIS=5000` 精确；active request/stream timer 0、listener residual 0、unhandled rejection 0、重复/遗漏/跨 owner/Secret 命中 0。
- 最终静态审计：项目源 105（Markdown 66、非 Markdown 39）、strict UTF-8 失败 0、围栏 244 且失衡 0、围栏外相对链接 220 且断链/越界 0；相对开始基线精确修改 19 份白名单 Markdown，新建/删除/白名单外/非 Markdown 修改均为 0。U01–U12、M01–M17、P01–P23 连续，嵌套场景 24 个连续；未来映射 19（Create 16、Modify 3、Delete 0），16 个未来 Create 实际存在 0。三锁定 SHA-256 保持：`package.json` = `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`、`pnpm-lock.yaml` = `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`、`toolchain-lock.json` = `781A3DEEC4E4D8E062D95C0278A3408961252BE9890F6EDA6729071135636596`。

### 已执行、失败后纠正

- 初次本地包源码定位沿用扁平 `node_modules` 路径而不存在；改用 pnpm `.pnpm` 精确实例后读取成功。初次 T3R-12 夹具尝试导入旧式 `typescript/lib/typescript.js`，但 TypeScript 7.0.2 包不含该入口；改用 Node 24 type stripping 执行逐字一致的 TS 函数后取得复现。
- 初次 strict 编译的 TEMP `PostgresFixture.network` stub 误写为 `Network`，真实 Testcontainers 类型要求 `StartedNetwork`；收窄夹具后同一最终代码 compile exit 0。facade fake 首次在 async `finishDatabaseClose()` 调用 end 前过早断言同步重入值，移到 settle 后通过。
- runner fake 首次在构造测试 frame 前就 monkeypatch `Buffer.concat`，第二次在 `readLogs()` 安装 listener 前发出 stream error；分别改为先构造输入再注入异常、延后到下一事件循环后，同一最终 runner 的 24/24 与扩展矩阵通过。以上失败均只在系统 TEMP 验证夹具，未修改工程代码、依赖或锁文件。
- 最终 fresh 编译首次调用 `pnpm exec tsc` 时当前 shell 未暴露 `tsc` 可执行项并以 exit 1 失败；随后改用锁定的本地 `node_modules/.pnpm/typescript@7.0.2/node_modules/typescript/bin/tsc` 精确入口，对同一逐字提取代码 strict 编译 exit 0。该失败属于命令分发，不是 TypeScript 诊断；未安装依赖、未修改工程文件或锁文件。

### 未执行

- Task 3 工程代码、两个 database unit spec、SQL、migration、database integration、真实镜像拉取、Docker、容器、数据库、Flyway 与真实 Testcontainers integration 均未执行；TEMP fake runtime 不冒充真实 Task 3 测试。
- `pnpm build`、项目 `pnpm typecheck`、`pnpm test:unit` 未重跑，因为本轮只修改 Markdown；Task 1/2 工程与历史真实证据未改变。
- Git、worktree、子代理、并行代理、依赖安装/升级、lifecycle、audit、Telegram、collector、其他业务外部连接和部署均未执行。

### 状态结论

- Task 3 计划从 READY v1.4 经 BUILDING 收敛为 READY v1.5，等待用户复审；Task 3 代码保持 NOT_STARTED，不是 VERIFIED。唯一下一步：等待用户复审 Task 3 v1.5；未经新授权不得进入第 6/48 步。

## 2026-07-25 — 第 5/48 步 Task 3 v1.4 Docker 日志完整性终态验证

### 已执行并通过

- 指定项目权威文件以 strict UTF-8 读取到 EOF；基线一致：第 5/48 步、阶段 0 VERIFIED、阶段 1 总计划 READY v1.2.6/代码 BUILDING、Task 1 VERIFIED、Task 2 VERIFIED v1.2.6、Task 3 计划 READY v1.3/代码 NOT_STARTED、Tasks 4–14 NOT_STARTED。Node `v24.18.0`、pnpm `11.15.1` 与三锁定哈希精确匹配；项目源 105（Markdown 66、非 Markdown 39）。
- T3R-11 四项修订前复现精确为：incomplete header `""`；incomplete payload `""`；close-without-end 在 500ms 后 `TIMEOUT`；跨通道穿插结果 `synthetic-noisepassword`、密码 detected false。裁决 ACCEPT。
- 完整读取 docker-modem 5.0.7 `lib/modem.js`，并读取 Dockerode 5.0.1/Testcontainers 12.0.4 对应 logs 实现。根因确认：modem demux 只监听 data，pending header/payload/residual Buffer 无 EOF 出口；v1.3 在 input end 直接结束输出、不处理 close-before-end，并按全局事件顺序混合两通道。
- 从最终 v1.4 计划逐字提取 19,378-byte Flyway runner，以 TypeScript 7.0.2、项目 strict 和真实 Testcontainers 12.0.4 类型编译 exit 0。24/24 日志子场景通过；展开失败运行 29、cleanup 叠加运行 13；raw/payload/frame 刚好边界成功，首个越界失败；remove 恰好一次、主 `FLYWAY_LOG_READ_FAILED` 保留、重复/遗漏/跨 owner/Secret/unhandled rejection 全部 0。
- 从最终计划逐字拼接 platform/worker database 文件（9036/9030 bytes），真实 Kysely 0.29.4 strict 编译 exit 0；20 个 `@ts-expect-error` 全部被消费。两个 app 的 facade 本体/三类安全链 destroy 与 asyncDispose 均 0、CRUD builder 可用；普通并发、同步重入、同步/异步失败均同 Promise、底层 end 1、`DATABASE_CLOSE_FAILED` 与 Secret 0。
- 最终静态审计：项目源 105（Markdown 66、非 Markdown 39）、strict UTF-8 失败 0、围栏 244 且失衡 0、围栏外相对链接 219 且断链/越界 0；相对开始基线精确修改 19 份白名单 Markdown，新建/删除/白名单外/非 Markdown 修改均为 0。U01–U12、M01–M17、P01–P23 连续，M15/M16 的 24 个子场景连续；未来映射 19（Create 16、Modify 3、Delete 0），16 个未来 Create 实际存在 0；两个容器显式平台路径 2/2，Task 3 runner 内 `demuxStream` 命中 0。
- 三锁定文件最终 SHA-256 保持：`package.json` = `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`，`pnpm-lock.yaml` = `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`，`toolchain-lock.json` = `781A3DEEC4E4D8E062D95C0278A3408961252BE9890F6EDA6729071135636596`。

### 已执行、失败后纠正

- 初次 runner 提取因 TEMP 中文 heading 锚点过窄未找到围栏；改用稳定 `### 5.6` 与相邻 fence 后成功。初次编译因 TEMP 缺少 ESM package boundary 得到 TS1295/TS1287；补齐 `"type":"module"` 后计划代码编译通过。
- 最终重提取的类型映射夹具首次使用 TypeScript 7 已删除的 `baseUrl` 得到 TS5102；删除该 TEMP 选项后同一最终代码编译 exit 0。database runtime 夹具先后因合成 identifier 含连字符、跨 app 错误类 `instanceof` 假设失败；分别改为合法下划线标识并按稳定 code 校验后通过。以上均只发生在系统 TEMP，未修改工程代码、依赖或锁文件。

### 未执行

- Task 3 工程代码、两个 database unit spec、SQL、migration、database integration、真实镜像拉取、Docker、容器、数据库、Flyway 与真实 Testcontainers integration 均未执行；TEMP fake runtime 不冒充真实 Task 3 测试。
- `pnpm build`、项目 `pnpm typecheck`、`pnpm test:unit` 未重跑，因为本轮只修改 Markdown；Task 1/2 工程与历史真实证据未改变。
- Git、worktree、子代理、并行代理、依赖安装/升级、lifecycle、audit、Telegram、collector、其他业务外部连接和部署均未执行。

### 状态结论

- Task 3 计划从 READY v1.3 经 BUILDING 收敛为 READY v1.4，等待用户复审；Task 3 代码保持 NOT_STARTED，不是 VERIFIED。唯一下一步：等待用户复审 Task 3 v1.4；未经新授权不得进入第 6/48 步。

## 2026-07-24 — 第 5/48 步 Task 3 v1.3 能力边界、日志证据与 ZIP 兼容性验证

### 已执行并通过

- 开始前完整读取指定项目权威文件与相关治理、架构、安全、测试文档，并只读检查 Kysely 0.29.4、Testcontainers 12.0.4、TypeScript 7.0.2 本地精确源码。基线一致：第 5/48 步、阶段 0 VERIFIED、阶段 1 总计划 READY v1.2.6/代码 BUILDING、Task 1 VERIFIED、Task 2 VERIFIED v1.2.6、Task 3 计划 READY v1.2/代码 NOT_STARTED、Tasks 4–14 NOT_STARTED；Node `v24.18.0`、pnpm `11.15.1` 与三锁定哈希均匹配。
- T3R-08 修订前 strict 复现 exit 0：direct `db.destroy()` 的 `@ts-expect-error` 被消费，而 `withPlugin`、`withoutPlugins`、`withSchema`、`$extendTables`、`$omitTables`、`$pickTables`、`withTables`、`connection().execute()`、`Symbol.asyncDispose` 九条逃逸均编译，裁决 ACCEPT。Kysely runtime 29 成员扫描把关闭相关表面收敛为这九条加 direct destroy，其他成员未发现 driver 关闭入口。
- T3R-09 通过真实 Testcontainers 12.0.4 `DockerContainerClient` 且不连接 Docker复现：raw dockerode logs reject true，公共 wrapper resolve true，字节 0，stream error null，确认转换为正常空 EOF，裁决 ACCEPT。
- T3R-10 原始二进制头解析：v1.1 ZIP central/local UTF-8 flag 均 105/105；v1.2 均 0/105，central/local zero 均 105，严格 UTF-8 解码失败 0，唯一顶层均为 `换汇通`，裁决 ACCEPT。
- 从最终 v1.3 计划逐字提取 platform/worker database 文件与 Flyway runner；真实 Kysely/Testcontainers 类型、项目 strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`、`noImplicitOverride`、`verbatimModuleSyntax` 下 TypeScript 7.0.2 exit 0。两个 app 的 20 个关闭逃逸 `@ts-expect-error` 再编译 exit 0，证明注解均被实际消费。
- 精确 database 代码 fake 运行：普通并发、同步重入、同步 throw、异步 reject 都是 cached Promise 同一、底层 end 1；两类失败稳定 `DATABASE_CLOSE_FAILED` 且 `synthetic-secret` 公开命中 0。QueryCreator facade 本体 destroy false/asyncDispose false，三类安全链两项计数均 0，CRUD builders true。
- 精确 Flyway runner + 真实 Dockerode modem demux fake 运行七场景：正常 stdout/stderr 与成功空日志形成 `passwordLeakCount: 0`；raw request reject、stream 中途 error、超限均为 `FLYWAY_LOG_READ_FAILED` 且成功证据 null；含密码为 `FLYWAY_SECRET_LEAK`；raw reject 叠加 remove 失败仍保留主 code 并附 `FLYWAY_CLEANUP_REMOVE_FAILED`。七例 `synthetic-secret` 公开命中 0、remove 均恰好 1、重复/遗漏/跨 owner 清理 0。
- 最终静态审计在打包前确认：项目源 105（Markdown 66、非 Markdown 39），UTF-8 失败 0；相对链接 218、断链 0、路径越界 0；修改 19 且全部白名单内，新建/删除项目文件 0；计划映射 19（Create 16、Modify 3、Delete 0），16 个未来 Create 实际存在 0；U01–U12、M01–M17、P01–P23 连续；围栏 52 且平衡；抛错式 `onReserveConnection` 代码命中 0；两条 container 构建路径均有显式平台；真实 Secret、强 Secret 形态和旧项目关键词命中 0。

### 已执行、失败后纠正

- 初次 TEMP TypeScript 解析把整个根 `node_modules` 建成联接；PowerShell 删除联接时报空引用，后续命令在既有根 `node_modules` 短暂创建了一个 `kysely` 联接。确认两个目标均为精确 reparse point 后用 `Directory.Delete` 只删除联接，项目根新增联接立即恢复为 0；三锁定文件哈希复核无变化。后续改为 TEMP 内逐包联接和 fake package，未再写入项目 node_modules。
- 初次 Kysely API scan 尝试旧 TypeScript compiler API，TypeScript 7.0.2 根导出仅提供 version，脚本以 `parseJsonConfigFileContent is not a function` 失败；改为真实运行时原型全成员枚举，并以 TypeScript 7.0.2 `tsc` 负向编译承担类型证据。
- 最终 runner 首次类型编译因 TEMP `PostgresFixture.network` stub 过宽为 object 而 TS2345 失败；把验证 stub 精确为 Testcontainers `StartedNetwork` 后，同一最终计划代码块编译 exit 0。以上失败只在系统 TEMP 验证夹具，未修改计划合同或项目工程文件。

### 未执行

- Task 3 工程代码、两个 database unit spec、SQL、migration、database integration、真实镜像拉取、Docker、容器、数据库、Flyway 与真实 Testcontainers integration 均未执行；TEMP fake runtime 不冒充真实 Task 3 测试。
- `pnpm build`、项目 `pnpm typecheck`、`pnpm test:unit` 未重跑，因为本轮只修改 Markdown、禁止修改既有工程代码和创建 Task 3 工程文件；Task 1/2 历史真实验证证据不变。
- Git、worktree、子代理、并行代理、依赖安装/升级、lifecycle、audit、Telegram、collector、其他业务外部连接和部署均未执行。

### 状态结论

- Task 3 计划从 READY v1.2 经 BUILDING 收敛为 READY v1.3，等待用户复审；Task 3 代码保持 NOT_STARTED，不是 VERIFIED。唯一下一步：等待用户复审 Task 3 v1.3；未经新授权不得进入第 6/48 步。

## 2026-07-24 — 第 5/48 步 Task 3 v1.2 关闭与容器清理计划验证

### 已执行并通过

- 开始前按要求读取项目治理、状态、阶段主计划、Task 2/3 计划和相关架构、安全、测试、来源文档到 EOF；只读检查本地 Kysely `0.29.4`、pg `8.22.0` 与 Testcontainers `12.0.4`。当前事实一致：第 5/48 步、阶段 0 VERIFIED、阶段 1 总计划 READY v1.2.6/代码 BUILDING、Task 1 VERIFIED、Task 2 VERIFIED v1.2.6、Task 3 修订前计划 READY v1.1/代码 NOT_STARTED、Tasks 4–14 NOT_STARTED；Node `v24.18.0`、pnpm `11.15.1`。
- T3R-06 修订前独立复现的同步/异步结果均为底层调用 1、首次/后续 cached Promise 同一、稳定 code `null`、`synthetic-secret` 在 String/message/stack 表面命中 3，裁决 ACCEPT。T3R-07 修订前独立复现为 `nonZeroStartRejected=true`、`startedHandleAvailable=false`、调用方 finally stop 0；本地 12.0.4 源码确认 wait 成功后才构造 started handle，裁决 ACCEPT。
- 从最终 v1.2 计划逐字提取 platform 文件头 + 公共主体 + 文件尾、worker 对应三段和 Flyway runner；项目 strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`、`noImplicitOverride`、`verbatimModuleSyntax` 以及真实本地 Kysely/Testcontainers 类型检查 exit 0。两个 `@ts-expect-error handle.db.destroy()` 均被 TypeScript 消费，公开 `db.destroy` 类型可访问数量 0。
- fake pool 最终矩阵 exit 0：platform/worker wrapper direct 的同步 throw 与异步 reject 共 4 场景均为 calls 1、首次/并发/后续 Promise identity true、`DATABASE_CLOSE_FAILED`、正文命中 0；两个 handle 的 cold success 与 initialized sync/async failure 共 6 场景均为底层 `end()` 1、同步重入/并发/后续 identity true、失败稳定映射、正文命中 0。
- fake Testcontainers runtime 最终矩阵 exit 0：普通成功与非零退出各 remove 1；start 前无容器 remove 0；create 后无 handle 按唯一 label remove 1；日志、主 inspect、cleanup inspect、stop、remove 和主失败叠加清理失败均 remove 1；cleanup query 失败保留主 code 并登记 `FLYWAY_CLEANUP_QUERY_FAILED`。11/11 场景重复清理 0、漏清理 0、跨 owner touch 0、Secret 命中 0，主失败没有被清理失败覆盖。
- Task 3 最终计划文件映射为 19（Create 16、Modify 3、Delete 0），16 个 Create 路径实际存在 0；U01–U12、M01–M17、P01–P23 连续完整；fence 52 且平衡；最终组合实现中的抛错式 `onReserveConnection` 命中 0；PostgreSQL/Flyway `.withPlatform(locked.platform)` 计划路径覆盖 2/2，Flyway 固定 `REDGATE_DISABLE_TELEMETRY: 'true'`。

### 验证夹具失败与修订

- 第一轮精确代码块 `tsc` 因 TEMP 包缺少 ESM `type` 和 junction 解析方式失败；只调整 TEMP package/显式本地类型路径后 exit 0。一次 `pnpm exec tsc` 因当前 PowerShell 没有解析到 `tsc` 而未启动编译，随后使用项目既有 `node_modules\.bin\tsc.CMD` 重跑成功。
- fake Testcontainers 的第一版类型 stub 把 startup client 写成 `unknown`，且 fixture 的 `'true'` 被扩大为 `string`，导致夹具 TypeScript 失败；收紧 TEMP stub/字面量后成功。第一次 runtime 包放置跟随 TEMP 的 `node_modules` junction 到项目 `node_modules`，创建了两个临时 fake package 文件；检测后立即删除文件与空目录，改为只放在 TEMP 编译输出目录。最终项目源、manifest、lockfile 与依赖目录目标路径均无该 fake package残留。
- 第一轮 Flyway runtime 验证在“`container.logs()` 取得流前直接拒绝”场景得到错误的 `FLYWAY_MIGRATE_FAILED`，定位到 await 位于 `try` 外；计划代码把 await 移入 `try` 后，同一场景稳定为 `FLYWAY_LOG_READ_FAILED`，完整 11 场景通过。
- 第一轮数据库 runtime 夹具因 `JSON.stringify(undefined)` 使泄漏扫描器自身抛错；只修 TEMP 扫描器为空字符串兜底后，精确计划代码未改并通过完整矩阵。

### 未执行

- Task 3 工程代码、两个 database unit spec、SQL、migration、database integration test、真实镜像拉取、Docker、容器、数据库、Flyway 与 Testcontainers 运行均未执行；TEMP fake runtime 不冒充真实 Task 3 测试。
- `pnpm build`、项目 `pnpm typecheck`、`pnpm test:unit` 未重跑，因为本轮只修改 Markdown、没有修改既有工程代码且禁止创建 Task 3 工程文件；Task 1/2 历史真实验证证据不变。
- Git、worktree、子代理、并行代理、依赖安装/升级、lifecycle、audit、Telegram、collector、其他业务外部连接、真实 Secret 和部署均未执行。

### 状态结论

- Task 3 计划从 READY v1.1 经 BUILDING 收敛为 READY v1.2，代码保持 NOT_STARTED，不标记 VERIFIED。当前仍为第 5/48 步；阶段 0 VERIFIED；阶段 1 总计划 READY v1.2.6、代码 BUILDING；Tasks 1–2 VERIFIED；Tasks 4–14 NOT_STARTED。
- 唯一下一步：等待用户复审 Task 3 v1.2 修订包，并另行决定是否授权第 6/48 步。

## 2026-07-24 — 第 5/48 步 Task 3 v1.1 计划验证

### 已执行并通过

- 开始前 27 份要求文件以 UTF-8 读到 EOF；当前事实一致：第 5/48 步、Task 1 VERIFIED、Task 2 VERIFIED v1.2.6、Task 3 计划 READY v1.0/代码 NOT_STARTED、Tasks 4–14 NOT_STARTED、阶段 1 代码 BUILDING。
- Kysely 0.29.4 本地 `PostgresDriver` 源码确认 `pool.connect()` 先于 `onReserveConnection`；独立最小复现输出 `{"connectCalls":1,"releaseCalls":0,"caught":"R5 review reproduction"}`，T3R-01 裁决 ACCEPT。
- Redgate 官方 `REDGATE_DISABLE_TELEMETRY` 页面访问成功 1/1，说明非空值禁用 telemetry client；来源已登记。未设置 email、token、license、pipeline 或 collector。
- 系统 TEMP 中把 Task 3 v1.1 的精确 platform 文件头 + 唯一公共主体 + platform 文件尾、worker 对应三段分别组装；逐字比较为 platform true、worker true。`tsc` 使用项目 strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`、`verbatimModuleSyntax`，最终 exit 0。
- TEMP 运行验证最终输出：`{"modules":2,"acquiredClientFailureClassesPerModule":5,"connectFailureReleaseCount":0,"normalReleaseDestroyCount":0,"concurrentCloseSamePromise":true,"synchronousReentrySamePromise":true,"stickyFailureCode":"DATABASE_CLOSE_FAILED","endCallsPerCloseScenario":1}`。五类分别为 session 查询失败/session 不匹配/SET ROLE 失败/current 查询失败/current 不匹配；每类每 app `release(true)` 1 次，正常 Kysely release 的 destroy 参数 0。
- TEMP 的 PostgreSQL/Flyway builder 片段使用本地 Testcontainers 12.0.4 类型检查 exit 0；最终计划的 `.withPlatform(locked.platform)` TypeScript 调用为 2/2，`REDGATE_DISABLE_TELEMETRY: 'true'` 环境赋值存在。
- 计划文件映射解析为总数 19、Create 16、Modify 3、Delete 0；16 个 Create 路径实际存在 0。U01–U12 连续完整，两个 app 未来合计 24 项；`DATABASE_CLOSE_FAILED` 已声明且 U12 直接断言。
- Task 3 计划 fenced code blocks 26，fence 52 且平衡，占位符 block 0；最终实现组合块中的 `onReserveConnection` 命中 0，核心公共主体定义 1。
- 最终项目静态审计：排除 `node_modules`、`dist`、`.git` 后项目源 105，其中 Markdown 66、非 Markdown 39；项目内相对链接 217、断链 0、越界 0。
- 三锁定文件最终 SHA-256：`package.json` `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；`pnpm-lock.yaml` `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；`toolchain-lock.json` `781A3DEEC4E4D8E062D95C0278A3408961252BE9890F6EDA6729071135636596`，三者漂移 0。

### 首次失败与修订

- 第一次 TEMP `tsc` 失败：TS 7 已移除 `baseUrl`，TEMP 验证配置随后改为相对 `paths`；这只是验证夹具，不影响项目。
- 第二次 TEMP `tsc` 揭示原代码块从 `pg` 导入类型会因两个 app 没有直接可解析 `@types/pg` 而失败，同时 `PostgresPool.Client` 在 exact optional 下不能以“必有但可能 undefined”实现。v1.1 最终块改为 `createRequire` 加载真实 `pg.Pool`、本地最小 runtime shape，并要求非空 `Client`；随后 platform/worker 与 container 片段类型检查均 exit 0。
- 第一次 TEMP 运行因 pnpm 相对 symlink 经 TEMP junction 解析失败；验证夹具改为只在系统 TEMP 建立直达本地 Kysely/pg 包的 junction，随后运行 exit 0。没有改项目依赖或 `node_modules`。

### 未执行

- Task 3 工程代码、两个 unit spec、SQL、migration、database integration test、镜像拉取、容器、数据库、Flyway/Testcontainers 运行均未执行；TEMP 合成验证不冒充真实 Task 3 测试。
- `pnpm build`、`pnpm typecheck`、`pnpm test:unit` 未重跑，因为本轮只修改 Markdown 且禁止创建 Task 3 工程文件；Task 2 历史验证证据不变。
- Git、worktree、子代理、并行代理、依赖安装/升级、lifecycle、audit、Telegram、collector、其他业务外部连接、真实 Secret 和部署均未执行。

### 状态结论

- Task 1 VERIFIED；Task 2 VERIFIED v1.2.6；Task 3 计划 READY v1.1、代码 NOT_STARTED；Tasks 4–14 NOT_STARTED；阶段 1 代码 BUILDING。未进入第 6/48 步，不标记 Task 3 VERIFIED。
- 唯一下一步：等待用户复审 Task 3 v1.1 修订包，并另行决定是否授权第 6/48 步。

## 2026-07-23 — 第 5/48 步 Task 2 验收与 Task 3 计划验证

### 已执行并通过

- 用户最终复审结论已按原文核对：Task 2 v1.2.6 `PASS`、R5-01 `ACCEPT`。既有验收 ZIP SHA-256 为 `E0A2DD0702118592AB0BB295B0D1C005C88D023B5AB439D2FAF4D5F232F66DF4`；既有报告 SHA-256 为 `94545B1C35765B2F100546AB60ED141C6F4421E9356262A7F8BA1A45BF949B92`，均与用户提供值一致。
- 新鲜运行 Node `v24.18.0`、pnpm `11.15.1`；`pnpm build` exit 0；telemetry 聚焦 Test Files 2/2、Tests 14/14；`pnpm typecheck` exit 0；`pnpm test:unit` exit 0，Test Files 7/7、Tests 108/108；从 `apps/platform` 导入 `@xht/contracts`、`@xht/config`、`@xht/testing` 3/3 成功。
- 根 `package.json` SHA-256 保持 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；`pnpm-lock.yaml` 保持 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；`toolchain-lock.json` 保持 `781A3DEEC4E4D8E062D95C0278A3408961252BE9890F6EDA6729071135636596`。三个锁定文件漂移 0。
- PostgreSQL、Docker Official Image、Kysely、Flyway、Testcontainers 官方资料成功访问 23/23。Docker Hub tag API 与 Registry V2 manifest 交叉确认 PostgreSQL `postgres:18.4-alpine3.23` 的 linux/amd64 child digest `sha256:2342268e5cf8851c327dcf10fc124283448428059f9b756692b7e3302940d769`，Flyway Open Source `flyway/flyway:12.11.0-alpine` 的 linux/amd64 child digest `sha256:bd93084ddaf1448d2598feaac75a1c2e7087c529566746724f65b05b481f9704`；manifest-list 与 child digest 分栏记录。
- Task 3 计划静态自审通过：未来工程写集合 17（Create 14、Modify 3、Delete 0）；接口/函数均在计划中定义；LOGIN/NOLOGIN/SET ROLE、四主体权限矩阵、九表 schema、Inbox 摘要边界、Windows copy-to-container、LIFO 清理、M01–M17 与 P01–P23 均有明确合同；禁止占位语、浮动镜像、示例 digest、真实密码/连接字符串和未解释超级用户权限命中 0。
- 完成前新鲜回归再次通过：`pnpm build` exit 0、telemetry 2/2 文件 14/14、`pnpm typecheck` exit 0、unit 7/7 文件 108/108、三包导入 3/3。最终静态审计为项目源 105、Markdown 66、非 Markdown 39、项目内相对链接 217、断链 0、越界 0；Task 3 计划文件映射 17、官方来源表 23、M01–M17/P01–P23 连续完整，Task 3 工程文件实际创建 0，三锁定文件漂移 0，旧项目关键词、强 Secret 特征、状态与唯一下一步冲突 0。
- 外部交付物首次读回后的状态复核发现 `current.md` 的 Task 2 详细计划表格仍保留 READY，而独立计划头部已按最终验收写为 VERIFIED；在最终交付前统一为 `VERIFIED（v1.2.6，已实施并通过最终复审）`，随后重新执行状态与交付包门禁。该修正不涉及源码、测试或锁定文件。

### 已执行并失败

- 首次计划静态审计命令在 PowerShell 管道转码时把中文正则字符变为 `?`，导致 Node 正则在审计逻辑启动前解析失败；改为 Unicode escape 后相同审计成功。该诊断没有修改项目。
- 最终计划要求检查器第一次仍因管道转码使中文断言失真；Unicode escape 修正后，第二次因审计器只匹配字面 `Task 14` 而没有识别计划中的 `Tasks 4–14` 表达式退出 1。修正审计器谓词后完整检查 exit 0；两次都属于检查器自身预检失败，不是计划缺失，也未修改项目。
- 首次 ZIP 构建脚本在枚举阶段发现当前 Windows PowerShell 所用 .NET 没有 `System.IO.Path.GetRelativePath`，因此在创建 ZIP 前退出 1；没有生成或覆盖本地/外部交付物。后续改用已验证根前缀的相对路径截取实现同一安全边界。
- Docker Registry V2 交叉核验的第一次 child 解析把 PowerShell byte array 直接当字符串，得到 amd64 计数 0；第二次诊断因变量插值作用域错误收到 unauthorized。改用显式 bearer token 和 UTF-8 byte 解码后，两镜像均得到唯一 linux/amd64 child digest。以上均为只读元数据请求，没有拉取镜像或启动容器。

### 未执行

- Task 3 工程代码、SQL、迁移、database integration test、镜像拉取、容器、数据库、Flyway 运行、Testcontainers 运行、Telegram、collector、其他业务外部连接和部署均未执行；静态计划验证不冒充这些运行测试。
- 未安装/升级依赖，未运行 `pnpm audit` 或 lifecycle，未修改 package/lock/toolchain 锁定文件；未使用 Git、worktree、子代理或并行代理。

### 结论

- Task 2 v1.2.6 代码与测试 VERIFIED。Task 3 独立详细计划 READY v1.0，代码 NOT_STARTED；未解决阻断 0。阶段 1 代码继续 BUILDING，未进入第 6/48 步。

## 2026-07-23 — 第 4/48 步 Task 2 v1.2.6 同步重入修复验证（READY，等待最终复审）

### 已执行并通过

- Node `v24.18.0`、pnpm `11.15.1`；基线与最终 lockfile SHA-256 均为 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`，根 `package.json` SHA-256 均为 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`，两者漂移 0。
- R5-01 独立复现对 platform/worker 均得到 `calls=2`、`samePromise=false`、`laterSame=true`。静态根因定位到两个 factory 的赋值右侧 async IIFE：它在 `shutdownPromise` 赋值完成前同步进入 `registration.shutdown()`，所以 exporter 同步重入时再次创建 Promise 并再次调用 registration。
- TDD 有效 RED 只修改两份 telemetry spec；Test Files 2 failed / 2、Tests 4 failed / 10 passed，总计 14。四个稳定失败均为 `reentrantPromise` 与 `first` 的 `Object.is` 不相等，未处理错误 0，精确证明同步重入成功/失败缺口。
- 最小实现只修改两个 telemetry factory：先令 `shutdownPromise = Promise.resolve().then(...)` 完成缓存，再在 microtask 中调用 exporter。platform/worker 行为同构，公共接口、disabled、registration、span、错误码和重试语义均未改变。
- 聚焦 GREEN exit 0：Test Files 2 passed / 2，Tests 14 passed / 14；failed/skipped/only/retry 均为 0。
- 最终序列严格按授权执行：两次 `pnpm install --offline --frozen-lockfile --ignore-scripts` 均 exit 0、6 workspace already up to date；五个 workspace dist 删除后剩余 0；`pnpm build` exit 0；聚焦 2/2、14/14；`pnpm typecheck` exit 0；`pnpm test:unit` exit 0，Test Files 7/7、Tests 108/108；apps/platform 导入 contracts/config/testing 3/3。
- 独立运行时成功场景：platform/worker 均为 `calls=1`、`samePromise=true`、`laterSame=true`、`closedCode=TELEMETRY_CLOSED`。
- 独立运行时失败场景：platform/worker 均为 `calls=1`、`samePromise=true`、`laterSame=true`；first/reentrant/later 三路均 rejected，三个错误码均为 `EXPORTER_SHUTDOWN_FAILED`，`synthetic-secret` 泄露数 0。
- 工程写集合为修改 4、新建 0、删除 0；四个路径恰为两个 telemetry factory 与两个 telemetry spec。新依赖 0、依赖升级 0、lifecycle 0、lockfile/package.json 修改 0、Task 3–14 工程文件新增 0。
- 四个授权工程文件与 Task 2 v1.2.6 最后权威 TypeScript 代码块映射 4/4，内容不一致 0。排除 node_modules/dist/.git 后项目源 104：Markdown 65、非 Markdown 39；项目内相对链接 208、断链 0、路径逃逸 0；项目 TEMP/缓存/日志残留 0。
- 17 份授权 Markdown 均存在并同步 v1.2.6；README、总索引、handoff、state-model、roadmap、主计划、Task 2 计划、active-plan-index、current、next、active-work 的当前状态冲突 0，唯一下一步冲突 0。旧项目关键词、强特征 Secret、`.env`、生产网络调用和 Tasks 3–14 禁止路径均为 0。

### 已执行并失败

- 第一次直接运行 RED 命令时，当前验证进程的 PATH/Path 双变量未使 `pnpm exec` 找到既有 workspace `.bin`，Vitest 未启动、exit 1；该结果没有冒充产品 RED。按已登记方法只在当前验证进程前置既有 `node_modules/.bin` 后，同一测试进入并取得上述有效 RED，未修改项目或系统工具链。
- 首次有效 RED 取得相同四个 Promise identity 失败，同时失败 Promise 尚未附加就地观察器而被 Vitest 报告 4 个未处理拒绝。只修改失败测试的观察方式、保持原 Promise 与断言不变后重跑，得到 4 failed / 10 passed 且未处理错误 0 的最终 RED；生产实现仍未修改。

### 未执行

- 按用户门禁未运行 `pnpm audit`、architecture:check、test:all、database/integration tests、任何 lifecycle、容器、数据库、Flyway、Testcontainers、Telegram、collector、其他外部连接、真实 Secret 或部署；未创建/使用 Git、worktree、子代理，不把这些项目登记为 PASS。

### 结论

- R5-01 ACCEPT。Task 2 从 READY v1.2.5 经 BUILDING 转为 READY v1.2.6、等待用户最终复审；这不是 VERIFIED。阶段 0 VERIFIED，阶段 1 计划 READY v1.2.6、代码 BUILDING，Task 1 VERIFIED，Tasks 3–14 NOT_STARTED。四项长期授权归零；唯一下一步是等待用户审查 v1.2.6 修复包和证据。

## 2026-07-23 — 第 4/48 步 Task 2 v1.2.5 外部复审修复验证（READY，等待再次复审）

### 已执行并通过

- Node `v24.18.0`、pnpm `11.15.1`；基线 lockfile SHA-256 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`，根 `package.json` SHA-256 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`。
- 排除 node_modules/dist/.git 后项目源文件 104：Markdown 65、非 Markdown 39；v1.2.5 新 ZIP/TXT 均不存在，满足 CreateNew 前置门禁；深层项目 AGENTS 规则 0。
- `pnpm install --offline --frozen-lockfile --ignore-scripts` exit 0，6 个 workspace 均 already up to date，下载与 lifecycle 为 0。
- R4-01 最小运行复现：platform/worker 的第二个并发 shutdown 在 exporter pending 时均提前 fulfilled；两个返回 Promise identity 不同；失败并发结果均为 rejected/fulfilled，第三次 fulfilled；exporter shutdown 调用 1；`startSpan` 返回稳定 `TELEMETRY_CLOSED`；错误字符串未含合成敏感标记。
- R4-02 最小运行复现：Windows canonical reference 返回 `INVALID_FILE_REFERENCE`，POSIX canonical reference 原样接受。
- R4-03 静态复现：`active-work.md` 当前段错误声称本轮计划 Create 实际 0；阶段主计划当前 Task 2 摘要为代码 NOT_STARTED、实现授权 0。三项裁决均为 ACCEPT。
- 首次直接运行聚焦命令因当前进程 PATH/Path 双变量未注入 workspace `.bin` 而 exit 1、0 tests；按既有获准方案只在当前验证进程前置 `node_modules/.bin` 后重新运行。新增测试在旧实现上得到 Test Files 3 failed / 3、Tests 6 failed / 41 passed，六个失败分别为两个 Windows canonical 路径和 platform/worker 的并发成功/失败 Promise identity，属于预期 RED。
- 最小修复只修改六个授权工程文件：生产 factory 每实例缓存一个 shutdown Promise；SecretReference 只对首段精确 Windows drive 例外。聚焦 GREEN 为 Test Files 3 passed / 3、Tests 47 passed / 47；随后 strict typecheck exit 0。
- 最终新鲜序列：Node `v24.18.0`、pnpm `11.15.1`；offline/frozen/ignore-scripts install exit 0；五个已核验 workspace dist 删除后剩余 0；clean build exit 0；聚焦 3/3、47/47；typecheck exit 0；完整 unit 7/7、104/104；apps/platform 导入 contracts/config/testing 3/3；第二次 offline install exit 0。
- 修复后运行复现：platform/worker 两个 shutdown 返回同一 Promise，gate 释放前第二个保持 pending，`startSpan` 立即 `TELEMETRY_CLOSED`；成功并发均 fulfilled；失败并发与第三次调用均以 `EXPORTER_SHUTDOWN_FAILED` rejected，`synthetic-secret` 泄露 false；成功与失败 registration.shutdown 各调用 1 次。
- Windows `file:///C:/ProgramData/HuanHuiTong/secrets/key` 与 POSIX `file:///run/secrets/xht/key` 均原样接受；host/UNC、dot/dotdot、空段、百分号、反斜杠、query/fragment、非法/缺后续段 drive 的既有和新增反向用例全部通过，真实文件系统 Secret 读取 0。
- 最终 lockfile SHA-256 与基线同为 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；根 manifest SHA-256 与基线同为 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`。新依赖、升级、lifecycle 和漂移均为 0。
- 六个授权工程文件与 v1.2.5 最后权威 TypeScript 代码块映射 6/6，内容不一致 0；工程新增 0、删除 0。排除 node_modules/dist/.git 后项目源 104：Markdown 65、非 Markdown 39；Task 3 工程文件、生产网络调用、生产 `synthetic-secret`、强特征 Secret、项目 TEMP/日志/缓存和旧项目关键词均为 0。
- 最终 READY 状态写入后的静态检查为 Markdown 65、项目内相对链接 208、断链 0、路径逃逸 0；README、总索引、handoff、state-model、roadmap、主计划、Task 2 计划、active-plan-index、current、next、active-work 的当前状态冲突 0，唯一下一步冲突 0。

### 已执行并失败

- `.git` 目录存在但不是有效 repository；一次只读 `git rev-parse --is-inside-work-tree` 与一次只读 `git status --short` 均 exit 128。没有分支、提交、暂存或任何 Git 写入；后续不再运行 Git 命令。

### 未执行

- 按用户门禁未运行 `pnpm audit`、architecture:check、test:all、database/integration tests、lifecycle、容器、Flyway、Testcontainers、Telegram、collector、其他外部连接、真实 Secret 或部署；未创建/使用 worktree、子代理，不把这些项目登记为 PASS。

## 2026-07-23 — 第 4/48 步 Task 2 真实项目实施验证（READY，等待复审）

### 已执行并通过

- 完整读取用户指定的 21 份权威文件、Task 2 v1.2.4 全文和第 4 步授权；未发现缺失计划、版本漂移、深层 AGENTS 规则或不可裁决冲突。用户对 17 份 Markdown 同步范围和最终 Task 2 READY 状态的当前指令明确覆盖计划内历史 handoff 文字。
- 工程范围基线：16 个计划 Create 路径存在数 0，2 个计划 Modify 路径存在数 2；`packages/contracts/src/index.ts` 基线 SHA-256 为 `B4F70BF5F5952FB27BEF299A17629678033DBFA88C1E524D647BF408FFCF26C5`，`packages/config/src/index.ts` 为 `8E609BB71C20B858C77F0E9F90BB1319DB8477B13F9F965F1A1E18524BF50881`。
- 受保护基线：根 `package.json` SHA-256 为 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；`pnpm-lock.yaml` SHA-256 为 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`；Markdown 数量 65；`git rev-parse --is-inside-work-tree` exit 128，确认不是有效 Git 仓库。
- 前置命令均 exit 0：`where.exe node` 得到 `C:\Program Files\nodejs\node.exe`；`node --version` 为 `v24.18.0`；`node -p "process.execPath"` 为同一路径；`where.exe pnpm` 指向 Codex runtime shim；`pnpm --version` 为 `11.15.1`；lockfile SHA-256 与基线逐字一致。
- `pnpm install --frozen-lockfile --ignore-scripts` exit 0，6 workspace 已是最新状态；安装显式禁用 lifecycle，执行数 0；`pnpm-workspace.yaml` 仍为 `allowBuilds: {}`；安装后 lockfile SHA-256 无漂移。
- Subtask 2.1：新建观测合同并修改 contracts index 后，计划规定的五目录 clean 命令 exit 0；`pnpm build` exit 0，contracts/testing → config → platform/worker 五 workspace 全部 Done。`packages/contracts/dist/observability.js`（238 bytes）与 `.d.ts`（2059 bytes）真实生成；lockfile SHA-256 保持基线值。
- Subtask 2.2 测试启动诊断：第一次 clean exit 0、build exit 0，但 `pnpm exec vitest ...environment.spec.ts` exit 1 且 Vitest 未启动，错误为 `'vitest' is not recognized`；这不是产品 RED。systematic-debugging 复现 `pnpm exec where.exe vitest` exit 1，确认 `node_modules/.bin/vitest.CMD` 实际存在，并发现当前进程同时有 `PATH`/`Path` 且 pnpm exec 子进程未注入 workspace `.bin`。只在命令进程前置该既有目录后，`pnpm exec where.exe vitest` exit 0，未修改项目、依赖或工具链。
- Subtask 2.2 有效 RED：从无 dist 状态运行 clean exit 0、`pnpm build` exit 0；进程内 PATH 适配后运行相同 environment 聚焦命令 exit 1，Test Files 1 failed、Tests 31 failed。首个稳定原因是 `parseEnvironment is not a function`，其余为 SecretReference/Resolver 实现或导出不存在；Vitest 已正常收集执行，不是语法、导入、路径、工具链或 package export 配置错误。
- Subtask 2.2 GREEN：写入 v1.2.4 三个生产实现与 config export 后，clean exit 0、`pnpm build` exit 0、相同 environment 聚焦命令 exit 0（Test Files 1 passed / 1，Tests 31 passed / 31），`pnpm typecheck` exit 0。构建和 typecheck 五 workspace 全部 Done；失败、跳过、only、retry 为 0。
- Subtask 2.3 RED：创建 keyring 测试后，从无 dist 状态运行 clean exit 0、`pnpm build` exit 0；keyring 聚焦命令 exit 1，Test Files 1 failed / 1、Tests 34 failed / 34。首个稳定原因是 `resolveInboxDigestKeyring is not a function`，错误类也尚未构造；Vitest 正常收集执行，`afterEach`/`vi` 导入存在，不是语法、路径、工具链或 package export 配置错误。
- Subtask 2.3 GREEN：写入 v1.2.4 keyring 实现与 config export 后，clean exit 0、`pnpm build` exit 0、environment + keyring 聚焦命令 exit 0（Test Files 2 passed / 2，Tests 65 passed / 65），`pnpm typecheck` exit 0。failed/skipped/only/retry 为 0；当前/retained、清零、借用隔离、冻结、禁止序列化、时间/策略边界和直接错误码用例全部通过。
- Subtask 2.4 RED：创建两个 logger 测试后，clean exit 0、`pnpm build` exit 0；logger 聚焦命令 exit 1，Test Files 2 failed / 2、Tests no tests。两个 suite 分别因计划中的 platform/worker logger factory 模块尚不存在而加载失败；测试文件语法、Vitest import 和相对目标路径均符合权威计划。
- Subtask 2.4 GREEN：写入 v1.2.4 logging policy、两个 Pino factory 与 config export 后，clean exit 0、`pnpm build` exit 0、相同 logger 聚焦命令 exit 0（Test Files 2 passed / 2，Tests 22 passed / 22），`pnpm typecheck` exit 0。合法 platform/worker 记录分别写入注入 destination；unknown、getter、symbol、nested、控制字符、超长、NaN、缺字段和 event policy 错配全部抛 `SafeLoggingError` 且写入 0。
- Subtask 2.5 RED：创建两个 telemetry 测试后，clean exit 0、`pnpm build` exit 0；telemetry 聚焦命令 exit 1，Test Files 2 failed / 2、Tests no tests。两个 suite 分别因计划中的 platform/worker telemetry factory 模块尚不存在而加载失败；网络 guard、Vitest import 与目标路径符合权威计划。
- Subtask 2.5 GREEN：写入 v1.2.4 两个 telemetry factory 后，clean exit 0、`pnpm build` exit 0、相同 telemetry 聚焦命令 exit 0（Test Files 2 passed / 2，Tests 8 passed / 8），`pnpm typecheck` exit 0。platform/worker disabled 模式均证明 exporter factory 0、registration 0、`fetch/http/https/net/dns` 总调用 0；注入 otlp 边界与稳定 register/shutdown 错误映射通过。
- Subtask 2.6 最终命令严格从无 dist 状态执行：clean exit 0；`pnpm build` exit 0；六文件聚焦 exit 0（Test Files 6 passed / 6，Tests 95 passed / 95）；`pnpm typecheck` exit 0；`pnpm test:unit` exit 0（Test Files 7 passed / 7，Tests 96 passed / 96）；failed/skipped/only/retry 均为 0。
- 从 `apps/platform` 导入 `@xht/contracts`、`@xht/config`、`@xht/testing` 全部输出 `OK`、exit 0。最终 `pnpm install --frozen-lockfile --ignore-scripts` exit 0，lifecycle 执行 0，`allowBuilds: {}`；lockfile 前后 SHA-256 均为 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`。
- 工程范围：18/18 Task 2 路径存在，Create 16、Modify 2、Delete 0；18 个最终文件与 v1.2.4 权威代码块逐文件比较不一致数 0。排除 node_modules/dist/.git 后完整项目源文件 104，其中 Markdown 65、非 Markdown 39；非 Markdown 恰为 Task 1 基线 23 加 Task 2 Create 16，超范围工程文件 0。`rg --files` 的默认可见口径不含隐藏的权威 Task 1 配置 `.npmrc`，因此对应为 103/38；两种口径的差异只有该既有文件。
- 导入与类型：22 个 TypeScript 源/测试文件中跨 workspace 相对 import 0；`@xht/*` import 11 处，仅为 `@xht/contracts`/`@xht/config`，均有真实 package export；三个内部包 runtime import 3/3 成功；缺失 Vitest import 0；`process.env` 生产命中 0；build/typecheck 的 `exactOptionalPropertyTypes` 错误 0。
- keyring 集合：声明 20、实现抛出 20、测试直接引用 20；声明未实现 0、实现未声明 0、可触发但未直接测试 0、不可达稳定错误码 0。策略最小 `86400+1` 和最大 `7776000+604800` 正向测试通过，最大毫秒 `8380800000` 小于安全整数上限；file 路径穿越错误放行 0。
- Secret 与网络：生产 `fetch/node:http/node:https/node:net/node:dns` 调用路径 0；Task 2 console 调用 0；disabled telemetry factory/registration/五类网络调用均为 0；register/shutdown 原始错误正文泄露 0。敏感 sink 宽匹配候选 5 处逐项审查均为类型/错误分类名称，不是 material/raw bytes 向 logger/trace/error/Outbox/Inbox/audit 的数据流，实际泄露路径 0。
- 强特征扫描：`.env`、PEM 私钥、Telegram Bot Token、AWS access key、npm auth token、带凭据数据库 URL 均为 0；真实 collector URL 0；项目内 TEMP/模拟工程残留 0。
- 供应链与禁止范围：根 `package.json` SHA-256 保持 `CEEC06149084C641415F988C88EC958B1582290C4A7D92CE927013D2A5B367CD`；新依赖 0、依赖升级 0、lockfile 漂移 0。Git/worktree/子代理、容器、数据库、Flyway、Testcontainers、Telegram、collector、部署和 Tasks 3–14 实现使用均为 0；`.dependency-cruiser.cjs` 与 database 根路径均不存在。
- 17 份授权 Markdown 已同步。排除 fenced code 后扫描 65 个 Markdown、207 个项目内相对链接，断链 0、路径逃逸 0；README、handoff、state-model、roadmap、主计划、Task 2 计划、active-plan-index、current、next、active-work 当前状态冲突 0，唯一下一步冲突 0，旧项目串入 0。
- `verification-before-completion` 后从五个 workspace 的无 dist 状态再次独立复验：Node `v24.18.0`、pnpm `11.15.1`；`pnpm build`、六文件聚焦、`pnpm typecheck`、`pnpm test:unit`、三个内部 package import、最终 frozen install 均 exit 0。新鲜结果仍为 6/6、95/95 与 7/7、96/96；最终 lockfile SHA-256 与基线相同，漂移 0。

### 已执行并失败

- 预期 TDD RED：Subtask 2.2 为 1 文件 31/31 failed（缺配置实现）；Subtask 2.3 为 1 文件 34/34 failed（缺 keyring 实现）；Subtask 2.4 与 2.5 各为 2 suites load failure、0 tests（缺各自 factory 模块）。所有 RED 的相同路径均在最小实现后转为 GREEN。
- 非产品诊断：第一次 Subtask 2.2 RED 的 `pnpm exec` 因当前 Codex 进程同时存在 `PATH`/`Path` 而未注入 workspace `.bin`，Vitest 未启动、exit 1；systematic-debugging 确认根因，只在命令进程前置既有 `node_modules/.bin` 后恢复，未改项目或工具链。
- 两个自写静态检查脚本的早期版本分别因 PowerShell 引号解析和当前 .NET 缺少 `Path.GetRelativePath` 得到无效结果；随后启用终止错误、改用根路径安全 substring，并对同一范围取得有效 0 缺口结果。用于从计划机械提取大代码块的 helper 也曾遇到 PowerShell 换行和 V8 `atob`/`TextDecoder` 不可用，最终改为确定性 UTF-8 解码并以 18/18 权威内容比较复核；这些 helper 失败均发生在目标写入前或未产生目标改动。
- 最终复验的首个静态汇总命令又因内嵌 PowerShell 正则引号解析失败而在检查启动前 exit 1；修正引用后，第二版错误地只排除根级 `node_modules`、部分 `dist`，并把 fenced TypeScript 中 4 个数组调用误识别成 Markdown 链接。最终版本按所有路径层级排除、先移除 fenced code，并明确计入隐藏 `.npmrc`，得到完整源文件 104、Markdown 65、相对链接 207、断链/逃逸/超范围均为 0。前两版是无写入的统计器失败，不是项目缺陷。
- 为避免继续使用超长内嵌命令，后续只读总审计曾写入项目外临时脚本；首次启动被本机 PowerShell 执行策略拒绝，随后发现脚本中的 Markdown fence 反引号在 PowerShell 解析阶段造成未终止字符串。改用明确字符构造并以 UTF-8 读入 ScriptBlock 后，最终审计 exit 0；初版把文档代码块中的 6 个相对路径示例计入跨 workspace import，改为只扫描 23 个 TypeScript 文件后得到真实值 0。临时审计脚本已删除，项目内残留 0。
- 第一次唯一下一步一致性脚本把“不得自动规划或实施 Task 3”中的否定句误当成正向冲突，得到假阳性 1；修正为同时要求审查短语与明确否定语义后，同一 `next.md` 得到冲突 0。

### 未执行

- 按授权未运行 `architecture:check`、`test:all`、database project、integration project、`test:db`、`test:integration`、`pnpm audit` 或任何 lifecycle；未创建 `.dependency-cruiser.cjs`。
- Git/worktree/子代理、依赖升级、lockfile 修改、容器、数据库、Flyway/Testcontainers、Telegram、collector、其他业务外部连接、真实 Secret、部署和 Tasks 3–14 均未执行，未写成 PASS。

### 结论

- Task 2 从 NOT_STARTED 经 BUILDING 转为 READY、等待用户复审；这不是 VERIFIED。阶段 0 VERIFIED，阶段 1 计划 READY v1.2.4、代码 BUILDING，Task 1 VERIFIED，Tasks 3–14 NOT_STARTED。四项长期授权归零；唯一下一步是等待用户审查第 4 步实现包和证据。

## 2026-07-21 — 第 3/48 步 Task 1 外部复审修复最终验证（VERIFIED）

### 已执行并通过

- TDD RED：把既有 smoke 改为 `import { contractPackageName } from '@xht/contracts'` 后，在 `dist` 为 0 的状态执行指定 Vitest 命令，真实 exit 1；失败为 `Failed to resolve entry for package "@xht/contracts"`，1 个 suite load failure、0 tests。同期从 `packages/contracts` 执行 `import('@xht/contracts')`，真实 exit 1，`ERR_MODULE_NOT_FOUND` 指向缺失的 `packages/contracts/dist/index.js`。
- 最小修复：根 build 为 `pnpm -r --sort run build`；五个 workspace build 均为 `tsc -p tsconfig.json`；三个内部包的 `main`/`types`/`exports` 指向 `dist/index`，platform/worker 指向 `dist/main`。未改依赖集合、版本或 TypeScript/Vitest 配置。
- 新鲜最终构建从五个既有 `dist` 删除后数量 0 开始；Node `v24.18.0`、pnpm `11.15.1`，`pnpm build` exit 0。实际顺序为 contracts/testing → config → platform/worker。
- 指定 package-name smoke exit 0，1 file/1 test PASS；从 `packages/contracts` 导入返回 `@xht/contracts`。从 `apps/platform` 导入 `@xht/contracts`、`@xht/config`、`@xht/testing` 全部成功；根目录导入 platform/worker dist 分别返回 `xht-platform`、`xht-worker`。
- `pnpm typecheck` exit 0，先重建再完成五个 workspace strict typecheck。`pnpm install --frozen-lockfile --ignore-scripts` exit 0；lockfile 前后 SHA-256 都是 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`。
- 依赖静态核验：Git spec 0、异常 registry/tarball 0；`allowBuilds: {}`；pending builds 仍恰为 `protobufjs@7.6.5`、`ssh2@1.17.0`、`cpu-features@0.0.10`，`glob@10.5.0` deprecated 继续登记。安装显式使用 `--ignore-scripts`，lifecycle 执行数 0。
- Task 2 独立计划为 v1.2.2 READY，共 1771 行、62 个代码围栏；指定占位词 0、所需导出接口/函数未定义 0、核心定义重复 0；16 个计划新建工程文件在磁盘上的创建数 0，Task 2 代码保持 NOT_STARTED。
- 最终源集合 88 文件，其中 Markdown 65；项目内相对链接 206、断链 0、逃逸 0。相对上一份 Task 1 完成报告的 87 文件基线：修改 26、新建 1、删除 0、未变 61。
- Secret 静态扫描：`.env`、PEM 私钥、Telegram Bot Token、AWS access key、npm auth、带凭据数据库 URL 均为 0；计划内只有明确标注的合成测试值。Git/worktree/子代理、容器、数据库、Telegram、其他业务外部连接和部署使用数均为 0。

### 已执行并失败

- 本轮预期 RED 共两项：package-name Vitest 因缺失 dist export 失败；Node package import 以 `ERR_MODULE_NOT_FOUND` 失败。两项均在修复后的同路径验证中转为 GREEN。
- 初始 pnpm 调用的沙箱/cache 访问诊断保留在下方“缺陷登记”历史段，不作为产品 RED，也未伪装成通过。

### 未执行

- Task 2 代码与测试、Task 3–14、`pnpm audit`、任何 lifecycle、Git/worktree/子代理、容器、数据库、Flyway、Testcontainers、Telegram/其他业务外部连接、真实 Secret、collector 和部署均 NOT_EXECUTED；没有把这些项目记为 PASS。

### 结论

- R-01 ACCEPT、R-02 ACCEPT、R-03 PARTIAL_ACCEPT、R-04 ACCEPT（非阻断）。Task 1 在最终新鲜证据上恢复 VERIFIED；阶段 1 计划为 READY v1.2.2，阶段 1 代码保持 BUILDING；Task 2 计划 READY、代码 NOT_STARTED。后续写入授权为 0。

## 2026-07-21 — 第 3/48 步 Task 1 外部复审缺陷登记（BUILDING）

### 已执行并通过

- 完整恢复本轮指定权威上下文、Task 1 文件和既有完成报告；当前项目内非 `node_modules` 的 `dist` 目录为 0。
- 旧 smoke test 在无 `dist` 状态仍 1 file/1 test PASS，确认它只覆盖 `../src/index.js` 相对源码导入。
- 从 `packages/contracts` 执行复审命令，真实 exit 1：`ERR_MODULE_NOT_FOUND` 指向 `packages/contracts/dist/index.js`。这是真实 R-01 复现，不是 Node、pnpm 或 Vitest 配置错误。
- R-02 文档逐项核验成立。旧 ZIP 中央目录实测 89 项：87 文件、2 目录、反斜杠条目 89、正斜杠条目 0；89 项均设置通用标志 `0x0800`，原始名称字节严格 UTF-8 解码失败 0，因此 R-03 的 UTF-8 标记子结论拒绝，其余部分接受。
- lockfile/安装元数据静态核验仍含 `glob@10.5.0`、`protobufjs@7.6.5`、`ssh2@1.17.0`、`cpu-features@0.0.10`；`.modules.yaml` 的 pending builds 正好后三项，`allowBuilds: {}`。R-04 接受为非阻断持续风险。

### 已执行并失败

- 首次在沙箱中直接调用 pnpm shim 时，当前进程未继承用户 `COREPACK_HOME`，Corepack 尝试创建默认缓存目录并以 `EPERM` 失败；随后仅为命令进程显式指向既有 Corepack 缓存。沙箱内 `pnpm exec` 又因 pnpm store 数据库不可读而未注入 workspace bin；按环境规则获准在沙箱外只读访问既有缓存后，旧 smoke 真正运行并 PASS。上述均是测试启动环境诊断，不作为 R-01 RED。
- `import('@xht/contracts')` 的 exit 1 是本轮要求的缺陷复现，影响是此前 Task 1 VERIFIED 结论撤回。

### 未执行

- 尚未修改 smoke、manifest 或脚本；尚未执行本轮要求的 package-name Vitest RED、build、GREEN、typecheck、frozen install 或最终静态验证。Task 2 代码/测试、生命周期脚本、pnpm audit、Git/worktree/子代理、容器/数据库/Flyway/Testcontainers、Telegram/外部连接与部署均未执行。

### 当前结论

- R-01 接受，R-02 接受，R-03 部分接受，R-04 接受为非阻断项。Task 1 状态由 VERIFIED 退回 BUILDING；阶段 1 代码保持 BUILDING；Task 2 代码保持 NOT_STARTED。

验证日期：2026-07-21。阶段 0 整体状态：VERIFIED。阶段 1 实施计划状态：READY（v1.2.1）。Task 1 状态：VERIFIED。阶段 1 代码状态：BUILDING（Task 1 已完成；Task 2–14 未执行）。

## 2026-07-21 — 第 3/48 步 Task 1 最终验证（VERIFIED）

### 已执行并通过

- `verification-before-completion` 后重建本次验证 shell 的 Machine + User + Process PATH 并去重；Node `v24.18.0`、x64、`process.execPath=C:\Program Files\nodejs\node.exe`，where/Get-Command 首解析同一路径，Authenticode `Valid`、文件版本 `24.18.0`、签名主体 OpenJS Foundation。npm.cmd `11.16.0`、Corepack `0.35.0`、用户级 pnpm `11.15.1` 均可运行；pnpm 首解析为用户 bin，不是 Codex fallback。
- 新鲜 npm 官方 registry 查询再次逐字匹配 pnpm `11.15.1`、给定 shasum/integrity 且三类安装 lifecycle 均不存在。最终 `pnpm install --frozen-lockfile --ignore-scripts` exit 0，lockfile 前后 SHA-256 均为 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`。
- 最终指定 GREEN exit 0，1 file/1 test PASS；最终 `pnpm typecheck` exit 0，五个 workspace Done。新 `powershell.exe -NoProfile -NonInteractive` 再次得到 Node `v24.18.0` 与用户级 pnpm `11.15.1`。
- 最终静态检查：64 个 Markdown，196 个项目内相对链接，断链 0、逃逸 0；23 个 Task 1 源/配置文件缺失 0、超范围 0；Secret 形态 0、`.env` 0、旧项目关键词 0；Task 2–14 禁止工程路径 0。旧阻断报告仍为 6488 bytes、SHA-256 `81093A0A42140402A5788B9D7B0BFAB9599F2C428B2DA69574815B63970412D1`。
- 既有 `.git` 是 2026-07-19 的空目录，内容 0；`git rev-parse --is-inside-work-tree` exit 128，确认不是有效 Git 仓库。本轮 Git/worktree/子代理、容器、数据库、Telegram、生产连接使用均为 0。

### 未执行

- `pnpm audit` 因环境安全审查拒绝向外部服务发送私有 workspace inventory 而 NOT_EXECUTED；未绕过。`test:all`、architecture、database、integration、容器/Testcontainers、Flyway、Telegram、Task 2–14、Git 和部署均不属于 Task 1 聚焦验收，保持 NOT_EXECUTED，未写成 PASS。

### 结论

- Task 1 的工具链、供应链、Phase A/B、真实 RED→GREEN、strict typecheck、文件范围和静态安全门禁均有新鲜证据，Task 1 标记 VERIFIED。阶段 1 代码保持 BUILDING；下一步只能等待第 4/48 步 Task 2 的详细提示词和明确授权。

## 2026-07-21 — 第 3/48 步 Task 1 工具链恢复硬门禁（PASS）

### 已执行并通过

- 重新读取项目规则、索引、状态、开放决策、活动计划及直接相关权威文档；主阶段 1 计划以当前磁盘文件连续读取至真实 EOF 第 2357 行。按顺序使用 `using-superpowers`、`project-governance`、`systematic-debugging`，尚未使用硬门禁后的实施 Skill。
- 只读基线：真实根目录匹配；项目文件 64、Markdown 64、非 Markdown 0；不是有效 Git 仓库；旧阻断报告仍为 6488 bytes、SHA-256 `81093A0A42140402A5788B9D7B0BFAB9599F2C428B2DA69574815B63970412D1`。
- 固定路径 `C:\Program Files\nodejs\node.exe` 实测 `v24.18.0`、`process.arch=x64`、`process.platform=win32`；文件版本与产品版本均为 `24.18.0`，公司名 `Node.js`。Authenticode 状态 `Valid`，签名主体 `OpenJS Foundation`，证书指纹 `CECD9673E955CA766047DD43706D31E48A6BD3B5`。
- 官方同目录 npm 实测 `11.16.0`；Machine PATH 已含 `C:\Program Files\nodejs\`，当前 Process PATH 也能解析 node/npm。

### 已执行、发现并修复

- 初始 `pnpm` 解析到 Codex fallback `11.9.0`，根因为 Process PATH 优先级；用户 bin 前置后首次解析为 `C:\Users\Administrator\AppData\Local\HuanHuiTong\toolchains\bin\pnpm.CMD`。Corepack 创建的 `pnpm.ps1`/`pnpx.ps1` 受本机执行策略阻止，删除这两个可重建 shim 后保留 `.CMD` 与无扩展 shim，`pnpm --version` 精确为 `11.15.1`。
- 现有官方 Corepack 可执行且精确为 `0.35.0`，无需另装。只使用 `corepack enable pnpm --install-directory <用户 bin>` 与 `corepack install -g pnpm@11.15.1`；`COREPACK_HOME` 为 `C:\Users\Administrator\AppData\Local\HuanHuiTong\toolchains\corepack-home`，缓存存在 `v1\pnpm\11.15.1`。
- npm 官方 registry 返回 pnpm version `11.15.1`、shasum `b4742275b224555be527ba8a784f26829c397154`、integrity `sha512-gTULB+U8lTigLx8jA7QpD6LXvgTlbiqXDEzEtBfcdh3hlu2r1J1Vx9yVgNuBAHxEFD5OPX5GKzAA0jwlUSLQZQ==`，无 `preinstall/install/postinstall`；Corepack version `0.35.0`、shasum `558fd9245bb53f9cec2b5a5a37dc25ae4505c13d`、integrity `sha512-9BuIGHDFE7Zieor1CeRsvt7X7AJFEuJ6OnbSbsVprq83ChDFoBh1wP98NeUS9FT3ZwlzFllPElXcz/OiDf0YGw==`，亦无三类安装 lifecycle。
- 当前刷新进程与全新 `powershell.exe -NoProfile -NonInteractive` 都得到 Node `v24.18.0`/x64、Corepack `0.35.0`、pnpm `11.15.1`；新进程 pnpm 首解析为用户 bin，不是 Codex fallback。用户 PATH 包含该 bin，用户 `COREPACK_HOME` 精确持久化。

### 门禁期间未执行

- 未下载、重装或修改 Node，未安装第二份 Corepack，未修改系统 PATH 或执行策略；未使用管理员安装、第三方 registry、winget/choco/scoop 等工具。门禁结束时工程文件仍为 0，Phase A/B、RED/GREEN、typecheck、Task 2 及所有禁止项均未执行。

## 2026-07-21 — 第 3/48 步 Task 1 Phase A/B 与 TDD 检查点（BUILDING）

### 已执行并通过

- 创建 22 个手写 Task 1 文件并由 pnpm 生成 `pnpm-lock.yaml`，合计 23 个计划文件；排除所有层级 `node_modules` 后，缺失 0、超范围 0。五个 workspace manifest 均为 `0.1.0`、`type: module` 且有 exports；所有 registry spec 精确，内部依赖均为 `workspace:0.1.0`。
- 21 个直接 registry 包逐项从 npm 官方 registry 查询 version、integrity、shasum 和 scripts；版本全部匹配计划，直接包 `preinstall/install/postinstall` 均为 NONE。
- Phase A `pnpm install --lockfile-only --ignore-scripts` exit 0；scope 6，lockfileVersion `9.0`，6 个 importer（根、platform、worker、config、contracts、testing），38 个直接声明位置、24 个不同直接依赖（21 registry + 3 workspace），435 个 registry package/version 条目、推导传递条目 414、workspace link 7、integrity 缺失 0、Git 依赖 0、异常 registry/tarball 0、`requiresBuild` 标记 0；Phase A 后 `node_modules` 不存在。SHA-256 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`。
- Phase B `pnpm install --frozen-lockfile --ignore-scripts` exit 0，materialize 386 包；lockfile 前后 SHA-256 相同，无漂移。
- RED 命令 `pnpm exec vitest run --project unit packages/contracts/test/workspace-smoke.spec.ts` exit 1；1 file/1 test failed，唯一失败是缺失 `contractPackageName` 导致 received `undefined`、expected `@xht/contracts`，属于正确 RED。
- 最小实现仅增加 `contractPackageName`、`platformProcessName`、`workerProcessName`，platform/worker 实际调用 `@opentelemetry/api` 建立无 exporter tracer；没有启动进程或外部连接。相同 GREEN 命令 exit 0，1 file/1 test PASS；`pnpm typecheck` exit 0，五个 workspace typecheck 全部完成。
- 重构/边界静态检查：23/23 Task 1 文件，缺失 0、超范围 0；admin/signer/mobile/database 路径 0；跨包相对 import 0；测试调用 `test`/`test:all` 0；Vitest 使用 `test.projects` 且 unit/database/integration 各 1，未使用 workspace API。

### 已执行并发现的非阻断供应链事实

- Phase A 唯一 deprecated 警告为 `glob@10.5.0`，父链 `testcontainers@12.0.4` → `archiver@7.0.1` → `archiver-utils@5.0.2`；peer/engine 警告 0。
- `.modules.yaml` 显示 3 个 pending build：`protobufjs@7.6.5` postinstall、`ssh2@1.17.0` install、可选的 `cpu-features@0.0.10` native install。三者官方 integrity/shasum 与完整脚本已读取；`--ignore-scripts` 使执行数量为 0，smoke/typecheck 不依赖这些构建，因此 `allowBuilds: {}` 保持默认拒绝。

### 未执行

- `pnpm audit` 未执行：环境安全审查拒绝把含私有 workspace 名称/版本的完整 lockfile inventory 发送到外部 npm audit 服务，且禁止绕过；这不是已执行失败，也未写成 PASS。数据库、integration、architecture 完整套件、`test:all`、容器、Flyway、Testcontainers 运行、Telegram、Git 与 Task 2–14 均未执行。

## 2026-07-21 — 第 3/48 步 Task 1 工具链前置门禁与 BLOCKED 证据

### 已执行并通过

- 按指定顺序完整读取 5 个适用 Skill、根规则、索引、状态、治理、计划、来源及直接相关技术/架构/测试权威文档；主计划按当时工具输出连续行段读取，Task 1 写集合、版本矩阵、Phase A/B 和停止条件明确。本轮以当前磁盘文件复核真实 EOF 为第 2357 行。
- 修改前工作区检查：真实根目录 `C:\Users\Administrator\Documents\换汇通` 匹配；排除无效 `.git` 后项目文件 64、Markdown 64、非 Markdown 0；`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`apps`、`packages`、`database`、`node_modules`、业务代码均不存在。
- 主计划静态基线：Task 1–14 连续共 14 个；具名验收 01–23 连续共 23 个；阶段 0 VERIFIED、阶段 1 计划 READY v1.2.1、阶段 1 代码 NOT_STARTED、四项长期授权 0；`git rev-parse --is-inside-work-tree` exit 128，确认不是有效 Git 仓库。
- 授权范围核对通过：只允许 Task 1 和指定状态/验证/索引文档；Git、worktree、子代理、容器、数据库、Telegram/其他业务外部连接、生产部署和 Task 2–14 均未授权且未执行。

### 已执行并失败

- `node --version`：PowerShell `CommandNotFoundException`，当前终端不存在可直接运行的 Node；未得到要求的 `v24.18.0`。
- `pnpm --version`：exit 0，但实际版本为 `11.9.0`，不等于要求的 `11.15.1`。
- `corepack --version`：PowerShell `CommandNotFoundException`；`where.exe node` 和 `where.exe corepack` 无结果。
- `where.exe pnpm`/`Get-Command pnpm`：唯一来源为 `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd`；版本与来源均不满足继续施工门禁。

### 未执行

- 未安装或升级 Node/pnpm/Corepack，未修改系统 PATH，未使用 npm、npx 或其他工具绕过版本门禁。
- 未创建 23 个 Task 1 工程文件中的任何一个；未生成 `pnpm-lock.yaml` 或 `node_modules`，未下载依赖，未执行 Phase A `pnpm install --lockfile-only --ignore-scripts` 或 Phase B `pnpm install --frozen-lockfile --ignore-scripts`。
- 未运行 workspace smoke RED/GREEN、`pnpm typecheck`、`pnpm test:all`、database、integration、architecture、Flyway、Testcontainers、PostgreSQL、容器、应用进程或 Telegram 检查；这些不是失败，而是工具链硬门禁后的明确 NOT_EXECUTED。
- 未创建 ZIP 实施包，因为成功包要求包含 Task 1 工程文件，而阻断规则禁止创建这些文件；仅生成项目外阻断报告。

### 静态检查、状态与残余风险

- Task 1 和阶段 1 代码按真实情况标记 BLOCKED；阶段 1 计划保持 READY v1.2.1；Task 2、数据库、外部连接和部署保持 NOT_STARTED。Task 1 执行授权在 BLOCKED 时失效并恢复为 0，失败证据保留。
- 状态文档更新后的最终静态复核：项目文件 64、Markdown 64、非 Markdown 0、相对链接断链/逃逸 0、Task 1 工程文件 0、禁止工程路径 0、`.env` 0、真实 Secret 模式命中 0、旧项目关键词命中 0；Task 1–14 与验收 01–23 仍连续；有效 Git 仓库仍不存在。
- 项目外仅输出阻断报告 `C:\Users\Administrator\Desktop\Codex\换汇通-第3步-Task1工程骨架实施报告-2026-07-21.txt`（6488 bytes；SHA-256 `81093A0A42140402A5788B9D7B0BFAB9599F2C428B2DA69574815B63970412D1`）。未生成 `换汇通-第3步-Task1工程骨架实施包-2026-07-21.zip`，因为其必需工程内容没有获准创建且不能用不完整 ZIP 伪装实施包。
- 当前没有工程实现可供单元测试、typecheck 或供应链 lockfile 审计；不能输出 PASS。唯一恢复动作是先取得精确工具链安装授权并重新通过 `node --version`=`v24.18.0`、`pnpm --version`=`11.15.1` 的当前终端门禁。

## 2026-07-21 — 阶段 1 实施计划 v1.2.1 施工前闭环修订静态验证

### 已执行并通过

- 修改前已复核：阶段 0 为 VERIFIED、阶段 1 v1.2 计划为 READY、阶段 1 代码为 NOT_STARTED、业务代码/Git/外部服务/生产部署授权均为 0；本任务开始时计划修订状态登记为 BUILDING。
- npm 官方注册表只读核验得到 pnpm `11.15.1`、Node 24 对应类型 `@types/node@24.13.3` 及主计划矩阵的所有直接运行/开发包精确版本；pnpm 官方安装文档支持首次 `--lockfile-only` 与后续 `--frozen-lockfile` 的分离语义。来源、版本、workspace owner 与未安装事实均登记在 `docs/research/source-register.md`。
- 主计划只在既有唯一文件中升级为 v1.2.1：每项直接依赖有精确版本、直接 owner/workspace 和实际用途；首次 Phase A 为 `pnpm install --lockfile-only --ignore-scripts` 后人工审查，Phase B 与所有后续安装为 `pnpm install --frozen-lockfile --ignore-scripts`。
- C-02 形成 Task 2/3/5/9/10/11/13 的完整路径：完整 parsed Update canonical JSON、版本化 HMAC digest、`payload_digest`/`digest_key_version`、current/retained keyring、保留期下限、key-unavailable 503 失败关闭、raw Update 零持久化，以及日志/trace/Outbox/audit 禁止；Files 清单与既有 01–23 验收均已同步。
- 状态、活动计划索引、路线图、总索引、运行/信任/安全/测试/领域摘要和来源登记均指向 v1.2.1；阶段 0 仍为 VERIFIED，阶段 1 代码仍为 NOT_STARTED，四项授权仍为 0，`next.md` 只有用户的 Task 1 工程骨架授权提示词。
- 最终静态检查：项目仍为 64 个 Markdown、非 Markdown 工程文件 0；项目内相对链接断链/逃逸 0；Task 1–14 连续共 14；具名验收 01–23 连续共 23；P0 1–10 连续共 10；领域权威文档仍为 17；有效 Git 仓库仍不存在。
- C-01 细项：矩阵有 25 个版本化条目，其中 24 个为阶段 1 直接依赖（21 个 registry、3 个精确 workspace 合同）和 1 个 pnpm packageManager；每项含分类、owner、Task、官方版本 URL、Node 24、模块边界、理由、lifecycle script 与生产可用性。矩阵内版本 spec 不含范围、dist-tag、通配或 Git URL；首次/后续 lockfile 命令、lockfileVersion/transitive/integrity/registry/script/SHA-256 审查、默认拒绝及精确 allowBuilds 例外均已明确。
- C-02 细项：canonicalizer 规定对象键排序、数组顺序、number、string、null、缺失字段、未知字段和 undefined 拒绝；固定向量与验收 07/17/18 覆盖相同 Update、text/start parameter/callback/from/chat/类型/未知字段变化、键序等价、rotation retained replay、缺 key 失败关闭、information_schema raw 列禁止及日志/trace 零泄露。

### 已执行并失败

- 首次直接运行 `npm view` 发现当前环境未安装 npm CLI；首次沙箱内 npm registry 读取也因 TLS/网络限制失败。随后在用户范围允许下，仅对 npm 官方注册表执行经批准的只读请求并成功取得上列版本；未写入项目工程、依赖或 lockfile。

### 未执行

- 未运行 pnpm、TypeScript、Vitest、Flyway、Testcontainers、dependency-cruiser、容器、Telegram、Git 写入或部署；没有 `package.json`、lockfile、工程骨架、业务代码、迁移或依赖安装。本轮计划中的命令均为未来授权后的步骤，不得被解释为已运行。

### 静态检查与残余风险

- 完成前须以最终文件重新检查 Markdown 链接、Task 1–14、验收 01–23、P0 1–10、矩阵覆盖、禁止 raw Inbox 列、状态/授权一致性、范围与 ZIP 完整性；这些是文档静态证据，不代替未来代码、容器或安全运行证据。

## 2026-07-21 — 阶段 1 实施计划 v1.2 聚焦修订静态验证

### 已执行并通过

- 根目录、AGENTS.md、README.md、docs/00-index.md、主阶段 1 计划、阶段 0 VERIFIED、阶段 1 原 READY、代码 NOT_STARTED、四项授权 0、无业务代码/工程依赖/Git 仓库均在修改前核验；修订开始时计划状态已登记 BUILDING。
- 计划结构：Task 1–14 连续共 14 个；每项都有目标、Files 创建/修改清单、前置条件、不应修改文件、实施步骤、失败场景、测试先行顺序、验证命令、完成标准和文档同步要求。
- 验收结构：01–23 连续共 23 项；23 是受控 platform/worker 进程启动、readiness、SIGTERM、退出码和资源清理验收，完整测试编排仅限 Vitest 进程外顶层 `test:all`。
- F-01：`vitest.workspace.ts` 规划引用 0，`--workspace` 规划引用 0，测试内递归完整套件调用规划 0。
- F-02：Node 24.18.0、Vitest `test.projects`、`pnpm-lock.yaml`、精确依赖策略、`postgres:18.4-alpine3.23` 与 `flyway/flyway:12.11.0-alpine` 已写入；无解释的旧浮动镜像引用 0。完整 digest 因本轮未获镜像拉取授权登记为未来实施前失败关闭核验，未编造。
- F-03：bootstrap 管理员、xht_flyway/xht_platform/xht_worker NOLOGIN 角色、测试 LOGIN 成员资格、Flyway TOML/SET ROLE、platform/worker 运行角色、顺序和正反权限验收形成计划链路。
- F-04/F-05/F-06：Inbox 包含 PROCESSED、duplicate_same_payload/conflict、claim generation 与同 UoW 完成；Outbox 明确 at-least-once、lease token/generation CAS 与确认前崩溃重投；配置禁用进入 WAITING_CONFIGURATION，禁止忙循环。
- F-07/F-08：合法非文本 Telegram Update 计划返回 200 ignored；畸形 envelope 才 400；固定可信代理边界、grammY webhookCallback、BotInfo 注入和零网络测试边界已明确。
- F-09/F-10：配置只投影已知键后 strict，SecretReference/SecretResolver 分离；日志含值级检测和版本化独立 HMAC 伪名；registrationKey 服务端派生，SQL 显式校验成功/失败/冲突 NULL 组合。
- Markdown 链接检查：64 个 Markdown 文件，项目内相对链接断链或逃逸 0。
- 基线检查：17 个领域文档仍存在；P0 仍为连续 1–10 共 10 项；阶段 0 保持 VERIFIED；阶段 1 计划最终 READY；阶段 1 代码 NOT_STARTED；业务代码、Git 写入、外部连接、生产部署授权均为 0。
- 输出目录规则已写入 AGENTS.md、documentation-contract.md 和 ai-handoff.md：项目外 ZIP、报告、验证和交接产物仅允许位于 `C:\Users\Administrator\Desktop\Codex`。

### 未执行

- 未运行 TypeScript、Vitest、Flyway、Testcontainers、dependency-cruiser、pnpm 或 process integration；计划中这些命令只在未来获得工程、依赖、容器和代码授权后执行。
- 未拉取镜像或解析完整 registry digest；未安装依赖、启动容器、初始化/写入 Git、连接 Telegram 或任何业务外部服务、创建业务代码或工程配置。
- ZIP 安全、条目 SHA-256 与 ZIP SHA-256 将在本轮最终项目外规划包生成后记录于修订报告；生成失败则不得宣告完整性通过。

## 已执行并通过

- PowerShell 规划任务全量检查：工作区实际文件 64，全部为 Markdown，文件非空；阶段 1 计划文件存在。
- 实施计划结构检查：计划 2250 行，连续编号 Task 1–14 共 14 个；每个任务均包含准确目标、Files、输入/输出接口、前置依赖、红灯、运行命令、预期失败、最小实现、绿灯、重构、文档同步、精确验收和提交检查点。
- 计划抬头检查：Goal、Architecture、Tech Stack、Global Constraints、Authorization Gates、Explicit Exclusions、Definition of Done 全部存在。
- 验收追踪检查：01–23 共 23 项具名测试逐项存在；真实并发要求使用两个独立连接、屏障和 Promise.all；迁移要求空库应用与重复验证。
- 命名一致性检查：`UidCreatedV1`、`TelegramUserSeenV1`、`TelegramMainMenuRequestedV1`、`ResolveOrCreateUidCommand/Result`、`HandleTelegramStartCommand/Result`、`InboxClaimResult`、`UnitOfWork`、`OutboxWorker` 以及 9 个数据库对象在计划中使用统一名称。
- 占位语检查：计划中没有附件禁止的占位表达，没有未定义的验收函数标记；未来命令均明确为未执行计划。
- Markdown 检查：扫描全部 64 个 Markdown 文件，解析相对链接并限制在项目根目录；断链 0。
- 索引检查：新计划已进入 `docs/00-index.md` 和 `docs/plans/active-plan-index.md`。
- 状态检查：current、next、active-work、foundation-plan、active-plan-index、roadmap 和计划一致表达阶段 0 VERIFIED、阶段 1 计划 READY、阶段 1 代码 NOT_STARTED。
- 授权检查：当前业务代码开发、Git 写入、外部服务连接和生产部署授权均为 0；next 要求用户分别决定 Git、骨架、依赖、Testcontainer、代码、worktree 与执行方式。
- 禁止项检查：实际工作区没有 `package.json`、`pnpm-workspace.yaml`、`src`、`tests`、`apps`、`packages`、`database`、SQL、依赖、环境变量或部署文件。
- Git 只读检查：`git rev-parse --is-inside-work-tree` 返回非有效 Git 仓库；本轮未初始化、提交、建分支或推送。
- 外部连接静态检查：没有真实 Bot Token、Telegram Bot 连接或其他外部服务连接；计划默认使用禁用 Gateway 和合成测试数据。
- 修改范围静态检查：只新建阶段 1 计划，并同步总索引、阶段 0 基线计划、活动计划索引、roadmap、current、next、active-work、progress-log 和本验证记录；没有修改产品范围、P0、领域数量或业务功能定义。

## 已执行并失败

- 首次尝试从 `.agents` 路径读取 `project-governance` Skill 时被当前沙箱拒绝；随后完整读取同名 `.codex` 可用副本，不影响项目事实或修改范围。
- 首次合并读取 23 个指定项目文件时工具输出在中途截断；随后严格保持原顺序分六批重新读取到 EOF，未以截断内容代替完整发现。

以上失败均为只读发现过程问题，没有写入项目或改变验证结论；最终项目预校验 failures=0。

## 未执行

- 未运行 TypeScript typecheck、单元、数据库、进程集成、Flyway、Testcontainers、dependency-cruiser 或构建命令，因为本轮没有获准且实际没有创建代码、依赖、数据库、迁移或工程目录。
- 未运行 Git 写命令、依赖安装、容器启动、Telegram 请求或部署，因为对应授权均为 0。
- 实施计划中的红灯/绿灯命令都是未来执行步骤，不是本轮运行结果；只有用户分别授权后才能执行。

## 静态检查与残余风险

- 静态检查确认事务、Inbox/Outbox、并发唯一约束、数据库角色、Webhook 默认拒绝、日志白名单、无资金对象和失败恢复均映射到具体任务与测试；这些设计尚未被代码或运行时证据实现。
- 阶段 1 计划 READY 仍待用户审查；执行方式、worktree、Git、工程、依赖、容器和代码授权都未决定。
- 10 项 P0 保持原状态；本阶段不实现支付密码、恢复或任何资金功能，因此没有用临时决定绕过 P0。

最终 ZIP、SHA-256、修改/新建数量和包内条目由阶段 1 实施计划创建报告独立核验。

## 2026-07-23 — 第 3/48 步 Task 2 计划 v1.2.3 聚焦修订静态验证

### 已执行并通过

- 按 `using-superpowers` → `project-governance` → `receiving-code-review` → `writing-plans` → `verification-before-completion` 顺序执行；没有使用 executing-plans、TDD、子代理、worktree、Git 或 finishing Skill。
- Task 2 Planned File Map 工程路径仍为 18（Create 16、Modify 2）；把每个路径最后一个权威 TypeScript 代码块提取到系统 TEMP，映射缺失 0、额外 0。使用 Node `v24.18.0 --experimental-transform-types --check` 对 18/18 文件逐项语法检查，失败 0；TEMP 已清理。
- 有效 Task 2 代码块中 `key.material`、`Uint8Array.from(Buffer.from(...base64url...))`、canonical `Buffer.from(bytes)` 复制、`consumer(this.#bytes)` 均为 0。单一解码 Buffer、借用隔离与清零、运行时冻结、时间/策略错误码、event policy 和 telemetry 错误映射均有定义与测试引用。
- 阶段主计划 Task 5/11 代码块中旧 `key.material` 0、把 `ResolvedSecret` 直接传给 HMAC 0、未捕获的故意非法日志 0；Task 5 和 Task 11 代码块路径均属于各自 Files 唯一写集合。
- Task 2 计划禁用占位表达命中 0；16 个计划 Create 工程文件实际创建数 0。项目源集合仍为 88 文件；项目内没有新增业务代码、测试、依赖、迁移、容器、部署配置或临时脚本。
- Markdown、相对链接、断链/逃逸、Secret、版本状态、受保护文件、最终 ZIP 条目及完整解压逐文件哈希的最终计数见项目快照冻结后生成的本轮 CreateNew 报告。

### 已执行并失败

- 首次 TEMP 语法 harness 尝试调用 TypeScript 7 JavaScript API 的 `ScriptTarget.ES2023`，因该运行时 API 不暴露对应枚举而在检查前失败；随后一次 API 能力探测同样确认该包只暴露版本字段。两次均未产生计划诊断、未修改项目，首个 TEMP 已清理。最终改用 Node 24 原生 TypeScript transform/check，对同一 18 文件取得 18/18 PASS。
- 首次 Markdown 链接扫描把 fenced TypeScript 代码中的 4 个数组调用误识别为链接目标，产生 4 个路径格式异常；修正为先排除 fenced code 后重跑，最终扫描 65 个 Markdown、202 个相对链接，断链 0、逃逸 0。

### 未执行

- Task 2 代码、Task 2 运行测试、Task 3–14、`pnpm build`、`pnpm typecheck`、依赖安装/audit/lifecycle、Git/worktree/子代理、容器、数据库、Flyway、Testcontainers、Telegram、collector、其他业务外部连接、真实 Secret 和部署均 NOT_EXECUTED；本轮是计划静态复审，不把这些项目写成 PASS。

### 结论

- R2-01 至 R2-07 全部 ACCEPT。只有最终代码块提取、语法和静态合同证据通过后，阶段 1 总计划与 Task 2 计划才保持 READY v1.2.3；Task 2 代码仍为 NOT_STARTED，唯一下一步仍需用户另行授权第 4/48 步。

## 2026-07-23 — 第 3/48 步 Task 2 计划 v1.2.4 最终可执行性验证

### v1.2.3 已执行并失败

- 在系统 TEMP 完整复制 88 个项目源文件，按 v1.2.3 计划最后权威代码块生成 18 个工程路径；真实项目未创建这些文件。
- `pnpm install --frozen-lockfile --ignore-scripts` exit 0，lockfile 前后 SHA-256 均为 `EE1F63DBFC72897F3483E9D6E96545801873988EA3E7EE15FCFB27C1E42AD9BC`。
- `pnpm build` exit 2，真实出现 TS2420、TS2416、TS2322；`RuntimeInboxDigestKey` 在 `exactOptionalPropertyTypes: true` 下不满足原 `InboxDigestKey` 可选属性合同。
- keyring 聚焦 Vitest exit 1，测试收集阶段 `ReferenceError: afterEach is not defined`，测试执行数 0；同文件使用的 `vi` 也未导入。
- environment 聚焦 Vitest exit 1，1 文件 27 项中 25 PASS、2 FAIL；`file:///run/secrets/../private` 被错误接受，证明 URL 规范化吞掉原始 `..`。另一项是 POSIX file URL 在 Windows 直接 `fileURLToPath` 的测试可移植性缺口，v1.2.4 以注入平台转换函数修正测试而不放宽生产门禁。
- v1.2.3 声明/实现 22 个 keyring 错误码，直接测试引用 19 个；缺口为 `INVALID_ACTIVATION_ORDER`、`POLICY_WINDOW_OVERFLOW`、`RETAINED_NOT_ACTIVE`。边界证明确认后两者不可达。

### v1.2.4 已执行并通过

- 新建全新 TEMP 副本，复制同一 88 个源文件并从最终计划代码块生成 18 个不同工程路径；映射为 Create 16、Modify 2，缺失 0、额外 0。
- `node --version` 为 `v24.18.0`，exit 0；`pnpm --version` 为 `11.15.1`，exit 0。
- `pnpm install --frozen-lockfile --ignore-scripts` exit 0；386 个包全部复用本机受信缓存，下载 0，lifecycle 执行 0；lockfile 漂移 0。
- 删除五个 workspace `dist` 后运行 `pnpm build`，exit 0；五个 workspace 均生成新 dist，TS2420、TS2416、TS2322 及其他 `exactOptionalPropertyTypes` 错误 0。
- 精确六文件命令 exit 0；Test Files 6 passed / 6，Tests 95 passed / 95，failed 0、skipped 0、only 0、retry 0。缺失 Vitest 导入 0，现有四个 file reference 反向案例及新增 dot/空段/query/fragment 案例全部通过，路径穿越错误放行 0。
- `pnpm typecheck` exit 0；`pnpm test:unit` exit 0，Test Files 7 passed / 7，Tests 96 passed / 96，failed 0、skipped 0、only 0、retry 0。
- keyring 稳定错误码集合对照：声明 20、实现抛出 20、测试直接引用 20，三集合差异 0；不可达稳定错误码命中 0，可触发但没有直接测试的稳定错误码 0。
- 策略最小组合 `86400 + 1` 和最大组合 `7776000 + 604800` 均以合法 `retireNotBefore` 成功解析并 dispose；最大值 `8380800` 秒、`8380800000` 毫秒，远小于 `Number.MAX_SAFE_INTEGER`。
- 最终 TEMP 副本已安全删除；系统 TEMP 中 `xht-task2-v123*`/`xht-task2-v124*` 残留 0。

### 已执行的静态检查

- v1.2.3 ZIP 与最终项目源集合各为 88 文件；在追加本验证记录前，修改 15 个且全部属于允许 Markdown，受保护文件修改 0、缺失 0、额外 0。追加 `progress-log.md` 与 `verification.md` 后允许修改 Markdown 总数为 17。
- 阶段主计划 Task 1–14 标题连续；Task 13 的 01–23 具名验收表保持连续。Task 2 最终代码块禁用占位表达命中 0。
- Markdown 65 个、项目内相对链接 202 个、断链 0、路径逃逸 0；旧项目关键词 0，强特征 Secret 泄露命中 0，项目内 TEMP/验证脚本/模拟工程残留 0。
- 工程 Planned File Map 保持 18：Create 16、Modify 2；真实项目中 16 个计划 Create 文件实际存在数 0。`package.json`、`pnpm-lock.yaml`、Task 1 工程文件修改数均为 0。

### 已执行并失败后纠正

- 最初尝试的 `using-superpowers` 本地路径不存在；随后按当前插件路径完整读取同一 Skill 到 EOF，并继续严格规定顺序。
- v1.2.3 TEMP 的第一次 .NET 递归删除因文件访问被拒绝失败；一次普通删除审批流也未执行。解析并验证目标确在系统 TEMP 后，以批准的精确 `Remove-Item -LiteralPath ... -Recurse -Force` 清理成功，残留 0。
- 第一次受保护文件基线对照使用当前 PowerShell 不具备的 `[Convert]::ToHexString` 而在比较前失败；改用 `BitConverter` 后对同一 88 文件完成比较，受保护修改 0。

### 未执行

- `architecture:check`、database、integration、`test:all`、`pnpm audit`、任何 lifecycle、容器、数据库、Flyway、Testcontainers、Telegram、collector、其他业务外部连接、真实 Secret 和部署均 NOT_EXECUTED；这些项目不在本轮授权内，未写成 PASS。
- Task 2 业务代码与测试、Tasks 3–14、Git/worktree/子代理均未在真实项目执行；Task 2 代码保持 NOT_STARTED。

### 结论

- E3-01 至 E3-04 全部 ACCEPT。v1.2.4 的完整 TEMP 工程运行门禁、错误码集合、锁文件和项目边界通过后，阶段 1 总计划与 Task 2 详细计划均为 READY v1.2.4；阶段 1 代码保持 BUILDING，Task 1 VERIFIED，Task 2 代码和 Tasks 3–14 NOT_STARTED。
- 唯一下一步是等待用户审查 v1.2.4 真实可执行性证据，并另行授权第 4/48 步 Task 2 实现。
