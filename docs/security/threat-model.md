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
