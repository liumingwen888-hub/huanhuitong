# 威胁模型

需求状态：APPROVED（威胁范围）；控制参数 DRAFT。交付状态：DESIGNING。

## 资产与主体

关键资产包括用户 UID 与绑定、支付凭证、账本与余额、托管私钥、链上资产、供应商资金、管理员权限、配置、审计和备份。主体包括终端用户、攻击者、客服/运营/财务/管理员、Telegram、链节点、签名设施、法币供应商和运维人员。

## 信任边界

Telegram Webhook、用户输入、管理浏览器、供应商回调、链节点响应和恢复数据均不可信。platform 与 signer、应用与数据库、生产与备份、用户身份与资金授权之间是强边界。完整边界见 [trust-boundaries.md](../architecture/trust-boundaries.md)。

## 主要威胁与控制

| 威胁 | 失败方式 | 核心控制 |
|---|---|---|
| 托管密钥泄露 | 攻击者签名转走资产 | signer 隔离、最小权限、审批、轮换、钱包限额和应急隔离 |
| 重放与重复付款 | 重复 Update、任务、回调或广播产生多次资金动作 | Inbox/Outbox、业务幂等键、唯一约束、状态查询和账本命令去重 |
| 账本污染 | 越权直写、失衡分录、错误金额 | 唯一账本入口、借贷平衡、防负余额、不可变分录和数据库权限 |
| Telegram Webhook 伪造 | 伪造用户操作 | HTTPS、secret_token、Update 去重、会话 nonce、服务端身份解析 |
| Telegram 账号或客户端接管 | 攻击者同时控制会话与密码输入通道 | 支付密码作为知识因子、短期授权绑定订单、高风险操作叠加 TOTP/未来 App 强认证、恢复独立验证 |
| 供应商回调伪造 | 伪成功触发结算 | 合同验签、时间窗、防重放、主动查询、对账和 UNKNOWN |
| 管理员越权 | 直接改资金或绑定 | 独立身份、默认拒绝、RBAC、范围/字段权限、Maker-Checker、审计 |
| 广播结果未知 | 超时后重发导致双花或双付 | 保持 UNKNOWN、冻结资金、按交易意图查询、禁止自动替代付款 |
| 节点分歧与链重组 | 过早入账或错误确认 | 确认策略、多源/健康评估、重组状态与补偿分录 |
| 账号恢复欺诈 | 弱证据接管有资金 UID | 独立验证因素、人工复核、冷静期、风险限制、不可自动合并 |
| 汇率异常 | 错价造成资金损失 | 来源白名单、有效期、偏离/陈旧检测、限额、熔断和人工复核 |
| 上游重复代付 | 超时/回调乱序后再次付款 | 同一供应商幂等键、主动查询、回调 Inbox、对账 |
| 备份不可恢复 | 灾难时事实源丢失 | 加密备份、校验、异地副本、定期恢复演练和证据 |
| 恢复后重复资金动作 | 旧任务/Outbox 再次执行 | 外部副作用暂停、恢复点核验、任务租约重建、查询与资金对账 |

## 隐私与敏感数据

支付密码原文在用户输入时会短暂存在于 Telegram 客户端并经过 Telegram 基础设施；专用凭证组件可在短期内存中组合和验证，完成、取消或过期后立即清除。原文不得持久保存到数据库或缓存，不得进入日志、追踪、错误、普通审计、Outbox/Inbox 正文、资金领域、客服/管理后台或消息回显。原始 callback_query 不记录，密码 Update 采用字段白名单日志。持久层仅保存版本化安全哈希，资金领域只接收短期授权证明或引用。

Telegram Bot 不是端到端加密的独立安全设备。支付密码在账号或客户端被接管时仍是知识因子，但不能单独覆盖高风险提现、敏感安全变更或账号恢复。TOTP 或未来 App 强认证的采用由现有 P0 第 7、8 项决定。验证码、TOTP 密钥、私钥、Bot Token、供应商密钥和恢复凭证不得出现在日志、普通审计、客户端或文档。个人与收款数据按最小字段、数据范围、保留期和脱敏控制。

## 残余风险

真实链、托管资产、供应商、运营国家、法律主体、认证参数和恢复因素尚未确定，因此相关具体威胁评估保持 DRAFT，并由 [P0 开放决策](../product/open-decisions.md) 阻塞对应开发。

Task 2 v1.2.6 已实现以下控制：file Secret reference 在 URL 规范化前拒绝 `.`、`..`、空中间片段、反斜杠、百分号编码、query、fragment 和控制字符；Windows 只允许第一段精确 `[A-Za-z]:` 并要求至少一个后续安全段，POSIX 与 Windows 随后都执行 canonical URL、realpath 与允许根门禁；Secret 大小为 1–65536 bytes，resolver/借用结束清零。Inbox digest keyring 每项只有一个受管理解码 Buffer，canonical 检查不复制，`withMaterial` 每次只借出 finally 清零副本，内部 material 永不直出；32–64 bytes、current/retained/版本/激活/retention+retry/now/策略边界均默认拒绝无效值，对象运行时冻结，序列化与 inspect 脱敏。策略最大窗口 `8380800000` 毫秒远小于安全整数上限；两个不可达错误码未保留，其余 20 个可触发稳定错误码均有直接测试。日志按六事件精确 policy 整条拒绝非法输入；telemetry register/shutdown 原始异常不越过稳定错误边界，shutdown 在调用 exporter 前缓存 Promise，使普通并发、同步重入和后续调用共享粘滞的成功/失败结果，exporter 最多一次，disabled 不调用 factory 或网络。真实 Secret 管理、真实 exporter/collector、Webhook、Inbox 业务持久化、Outbox 处理和 Telegram 仍属于后续 Tasks 的未实现边界；Task 3 仅完成数据库基础。

Task 3 v1.5 已把 T3R-01–T3R-12 转化为真实工程控制并通过本地验证：pre-return pool wrapper 阻断角色门禁失败后 client 泄漏；QueryCreator facade 阻断 Kysely 关闭能力逃逸；锁定 linux/amd64 镜像、停止 wait + ExitCode inspect 与唯一 owner 回收控制 one-shot 生命周期；raw Dockerode request 的独立 5 秒 timeout/abort/race 和后续 strict bounded multiplex parser 阻断永久 pending、截断、非法 frame、late settle 与跨通道 Secret 漏检。Flyway 12.11.0 多连接实测还要求在 JDBC 建连层强制 `role=xht_flyway`，callback 保留二次证明，测试 LOGIN 不获得直接对象权限。真实 database 65/65、database unit 24/24、全量 unit 132/132 与资源残留 0 构成本地证据；Task 3 已通过最终外部复审并 VERIFIED，但这不代表生产凭据、共享数据库或部署风险已关闭。

Task 4 已实现并验证单连接 Unit of Work、TransactionContext 禁止逃逸、同步/异步异常回滚、错误传播、SQL 策略和连接释放；完整 unit 132/132、database 203/203、Task 4 integration 138/138 与资源残留 0 构成本地证据。Task 5 v1.3 当前仍是等待外部复审的未来 Inbox/Telegram Update 去重计划；其 canonical fragments 和 TEMP 可执行性证据不是已实施控制。

## 阶段 1 实施事实（2026-08-17）

已实证控制：Webhook 五道门禁（401/400/415/413/503 矩阵）、Secret constant-time、代理信任伪造拒绝、Inbox 零 raw 存储、日志零敏感值、HMAC 密钥分离与轮换、并发注册唯一性（屏障真并发）、失败全量回滚、子进程 SIGTERM 清理。

## 阶段 2 威胁模型增补（2026-08-17，S2-7）

| 威胁 | 控制 | 证据 |
|---|---|---|
| 支付密码原文泄露（内存/日志/持久层/消息回显） | 专用组件唯一持有 + 借出即清零 + 白名单日志 + 零回显静态常量 | S2A01-04、S2A10 |
| 凭证库拖库离线破解 | scrypt v1（N=32768,r=8,p=1,32B 盐）+ 参数版本透明升级 | S2A11 |
| 暴力尝试 | 5 次锁定 + 按锁定事件数 ×2 阶梯 + security_locks 审计 | S2A06-07 |
| 会话/回调重放 | Inbox update_id 幂等 + 逐位位置化 nonce + 会话 nonce 唯一 | S2A08-09 |
| 会话洪水 | 单 OPEN 约束 + 每窗令牌桶 | S2-4 S4D02-03 |
| 恢复社工/越权 | ≥2 独立因子（默认 3 含人工）+ 精确历史核对 + 不足失败关闭 | S2A12-14 |
| 冷静期绕过 | APPROVED→凭证 COOLDOWN 联动 + 验证短路 | S2A12-13 |
| 渠道耦合扩散 | security 模块零 grammY/telegram 引用（静态 + depcruise） | S2A16 |
| span 属性侧信道 | telemetry 无 attribute 通道（静态） | S2A05 |

实施期缺陷修复（验收抓到）：逐位 nonce 位置化（重复数字误判重放）；阶梯锁定改按锁定事件计数（原绝对尝试数在锁定窗口阻断下不可达）。

## 阶段 3 威胁模型增补（2026-08-17，S3-7）

| 威胁 | 控制 | 证据 |
|---|---|---|
| 账本历史被篡改 | entries 零 UPDATE/DELETE 权限（任何角色）+ 冲正=新交易 | S3A04 |
| 幂等重放产生重复记账 | 幂等键 UNIQUE + 内核查重返回既有 | S3A02 |
| 负余额（超支） | 用途感知正常余额防线（借方≥0/贷方≤0）+ 行锁+SUM | S3A03 |
| 并发双花 | 排序行锁 + 投影原子性 | S3A05 |
| 冲正被滥用（二次冲正/改历史） | REVERSAL 只经专用服务 + 原 POSTED CAS + 全新反向交易 | S3A06-07 |
| 投影与条目不一致 | 同事务投影同步 + verifyProjection + recomputeAll 重建 | S3A08-09 |
| 对账遗漏 | 三检查（平衡/投影/完整性）+ 幂等告警 | S3A01, S3A08-09 |
| 金额精度丢失 | 全链十进制字符串 + BIGINT + BigInt 运算 | 全部 |
| 跨资产不一致 | 每资产独立平衡约束 + 清算差中间账户 | S3A01 |

## 阶段 4 威胁模型增补（2026-08-17，S4-8）

| 威胁 | 控制 | 证据 |
|---|---|---|
| 充值地址私钥泄露 | HD 派生接口隔离 + fake 密钥（真实实现需独立授权） | S4A01 |
| 充值地址分配冲突 | UNIQUE(network,address) + 竞态回读 | S4A01-03 |
| 链上检测遗漏 | checkpoint 单调递增 + RETIRED 地址排除 | S4A04-05 |
| 确认数不足即入账 | 版本化确认策略（TRON19/ETH12/BTC6）+ CAS | S4A06-08 |
| 链重组导致已入账资金回滚 | 重组检测→已POSTED冲正 / 已CONFIRMED阻止 / UNKNOWN标记 | S4A06-08 |
| 充值重复入账 | 三层幂等（应用层+账本层UNIQUE+状态层CAS） | S4A09-11 |
| 归集失败或链上费用超支 | FakeBroadcaster 失败路径 + 上游成本账户记录 | S4A12 |
| 链上余额与账本不一致 | 链上对账差异检测+告警（零容忍不自动修复） | S4A13 |
| 充值模块渠道耦合 | deposits 零 grammY/telegram 依赖（静态+depcruise） | S4A14 |

## 阶段 5 威胁模型增补（2026-08-17，S5-6）

| 威胁 | 控制 | 证据 |
|---|---|---|
| 转账重复执行 | order_ref UNIQUE + 幂等查重 + PostMoneyService 幂等键 | S5A02 |
| 转账余额超支 | PostMoneyService 用途感知正常余额防线 + 行锁 | S5A03 |
| 并发双花 | 行锁 + order_ref UNIQUE 多层防线 | S5A04 |
| 领取链接重放 | claim_code UNIQUE + markClaimed CAS | S5A06 |
| 过期链接被领取 | expires_at > now 条件 + 惰性退款 | S5A07 |
| 红包抢夺（同用户多次领取） | UNIQUE(packet_id, claimer_uid) + ON CONFLICT | S5A09 |
| 过期红包退款遗漏 | 惰性退款触发 + 仅退剩余 | S5A10 |
| 转账模块渠道耦合 | transfers 零 grammY/telegram 依赖（静态+depcruise） | S5A12 |

## 阶段 6 威胁模型增补（2026-08-19，S6-8）

| 威胁 | 控制 | 证据 |
|---|---|---|
| 提现双付（广播后崩溃窗口） | 确定性签名→同 txid 链上幂等 + markBroadcast CAS 三层论证 | S6A06、S6WR02 |
| UNKNOWN 误判为失败后重付 | UNKNOWN 零状态写入；仅链端口权威 FAILED 才迁移 | S6A07、S6WR04 |
| 审批合谋/同人重复审批 | UNIQUE(withdrawal_id, admin_id) + FINANCE_OFFICER 活跃角色门 + 配置缺失 fail-closed 双审 | S6A08、S6WB01/04/07 |
| 支付证明重放/替换/跨单挪用 | 七维度绑定校验（type/uid/操作/orderRef/金额/资产/过期）精确相等 | S6WA01、S6WU02 |
| 费用不可扣时挪用或部分收费 | 结算 fail-closed：停留 BROADCAST 待运营，绝不部分收费、绝不推断成功 | S6WF08 |
| 过期扫描误杀进行中审批 | TTL 走 ConfigStore；无配置零过期（反向 fail-closed） | S6A05、S6WF07 |
| 签名密钥越界进入业务/日志/库 | VaultPort 无密钥返回方法（HSM 型）+ 序列化扫描无密钥字段 | S6WS06 |
| 通知/回复泄露敏感数据 | 零插值常量（类别化）+ outbox 载荷扫描 | S6A11、S6WU03b |
| NULL-owner 平台账户重复建户（实现期发现） | SELECT-first 三步 ensure + 内核负余额兜底拒绝 | S6A09 对账 + S6-6 实施裁决 |

## 阶段 7 威胁模型增补（2026-08-19，S7-8）

| 威胁 | 控制 | 证据 |
|---|---|---|
| 异常汇率操纵/预言机失真 | referenceRate 容差精确整数比较 + fail-closed 零写入 | S7QT04、S7A08 |
| 过期报价被确认 | 消费 CAS 含 expires_at > now + 惰性清扫 | S7XF03、S7A04 |
| 并发重复确认/重复结算/重复释放 | quote_id UNIQUE + 消费 CAS + 确定性 orderRef 动作幂等键 + 状态 CAS | S7A05、S7A06 |
| 精度/舍入资金损耗（浮点污染） | 纯 BigInt 向下舍入 + 库中无浮点（text 存档） | S7QT07 |
| 跨资产清算混账 | exchangeSettled 拆双腿清算（各资产内平衡） | S7XS02、S7A02 |
| 点差/舍入价值暗损 | 双清算账户隔离 + 对账计值汇总（报价时点参考价） | S7A12 |
| 挂单误杀（错误释放进行中换汇） | 结算 TTL 无配置零过期（反向 fail-closed） | S7XR04、S7A04 |
| 换汇确认冒用（无支付门裁决的补偿控制） | resolveUid 身份绑定 + 订单绑定 uid + 资金不出平台边界 | S7EU03、S7-4 裁决 |
| 清算账户被绕过写入/篡改 | 对账累计 vs 权威重算 + schema FK/形状 CHECK 双层 | S7RC02/04 |
| 数字显示注入（UX 层） | 受控数值渲染字符集白名单（金额纯数字/市场键大写连字符） | S7EU06 |

## 阶段 8 威胁模型增补（2026-08-19，S8-8）

| 威胁 | 控制 | 证据 |
|---|---|---|
| 伪造/篡改供应商回调 | HMAC 验真端口（Fake 真实运算+常量时间比较）；验真失败永久拒绝零写入 | S8A07、S8CB02 |
| 回调重放 | callback_inbox (provider, eventId) UNIQUE 去重锚 | S8A08、S8CB03 |
| 双付（提交重试/崩溃窗口） | 确定性键派生 + V12 UNIQUE + 供应商按键去重三层 | S8A06、S8PS02 |
| UNKNOWN 误判重付 | submit 抛错零状态写入 + 查询优先裁决 | S8A09、S8PS04 |
| 收款人信息泄露 | token 引用 + SHA-256 摘要零明文（双形状 CHECK）；载荷无收款人字段 | S8PO04、S8A11 |
| 验签密钥泄露 | callback_secret_ref 仅 vault: 引用；端口输入只有引用 | S8PO01、S8CB07 |
| 状态分叉（报告 vs 订单） | 对账一致性（报 FAILED + 已 SUCCEEDED 为最严重信号，只浮现不修复） | S8RC03、S8A10 |
| 跨类证明挪用 | operationType='fiat-payout' 七维绑定（assetSummary 绑路线） | S8PR01 |
| 供应商配置漂移 | provider_configs 版本化只增不改 + 订单快照版本 | S8PO05 |
| 费用边界挪用 | 结算费用 fail-closed（停留 ACCEPTED 待运营） | S8ST06 |

## 阶段 9 威胁模型增补（2026-08-19，S9-8）

| 威胁 | 控制 | 证据 |
|---|---|---|
| 管理员凭据暴力破解 | argon2id（OWASP 参数）+ 5 次失败锁 15 分钟 fail-closed | S9AM02、S9A01 |
| 会话令牌窃取/重放 | 原始令牌只出现一次（库中仅 sha256）+ 30 分钟短会话 | S9AM01、S9A10 |
| TOTP 密钥泄露 | vault: 引用（本体不落库）+ TotpSecretPort 解析 | S9AM07 |
| 越权 API 访问 | 默认拒绝路由表（未注册 404）+ 三级中间件（会话/角色/提升） | S9RB02、S9A02 |
| 角色提权（操作者审自己） | 自审拒绝服务层强制（配置 maker≠checker；审批 AUDITOR 只读） | S9CR02、S9A11 |
| 审批权滥用（单人双批） | UNIQUE(withdrawal_id, admin_id) + 不同管理员双审 | S9AP07、S9A03 |
| 审计篡改/删除 | audit_events 仅 INSERT 权限 + 元审计（检索自身落档） | S9A09、S9AQ06 |
| 配置未审发布 | 草稿→复核→发布 Maker-Checker + 恰一次结算（最新版本判定） | S9CR04、S9A08 |
| 前端供应链攻击 | 零 UI 框架/零状态库四依赖 + esbuild 精确构建批准 | S9FE、实施裁决 |
| 前端令牌持久化泄露 | sessionStorage（标签页级）而非 localStorage | S9FE03 |
| 注入（审计检索 LIKE） | 类别前缀白名单 + actor 字符集校验 | S9AQ03 |
