# 安全门禁

需求状态：APPROVED。交付状态：DESIGNING。

## 所有阶段

- 明确资产、参与者、入口、信任边界和授权，不只验证登录。
- 对缺失、无效、过期、重放、重复、越权、跨 UID、畸形与并发输入采用默认拒绝。
- Secret 不进代码、文档、日志、普通审计或客户端。
- 资金操作具备端到端幂等、账本关联、失败状态和可对账证据。
- 管理动作服务端鉴权并按风险使用 Maker-Checker。

## 进入代码前

需求 APPROVED，领域/架构边界一致，相关 P0 已解决，威胁模型更新，书面实施计划和验收测试获批，业务代码开发授权大于 0。

阶段 1 v1.2.2 还要求：精确依赖矩阵逐项映射到直接 import 与 workspace owner；首次 `pnpm install --lockfile-only --ignore-scripts` 生成的 `pnpm-lock.yaml` 已审查，后续只使用 frozen 安装；容器精确 tag 和完整 digest 已在获准拉取时核验；Flyway、platform、worker 角色链和 SET ROLE 正反权限测试可执行；完整 Update Inbox HMAC、key rotation/保留/缺 key 失败关闭、raw Update 零持久化及日志/trace 阻断均有测试；测试文件不递归调用完整测试套件；外部连接禁用不会形成忙循环。

Task 5 v1.3 的不可信命令门禁还要求：Proxy 在任何观察前拒绝；Date 只接受 prototype 精确为 `Date.prototype` 且 own key 为 0 的普通实例，并只通过 `Date.prototype.getTime.call(value)` intrinsic 读取。自有 accessor/method、Date subclass、Proxy、intrinsic 异常与非有限时间必须在 context/database/executeSql 前稳定转换为 authentic `INBOX_COMMAND_INVALID`，且不公开输入 sentinel。

## 合并前

完成 TDD、代码审查、安全审查、依赖方向检查、敏感信息扫描、失败/并发/重放测试、文档同步和最新真实验证。任何资金或权限测试失败都阻止合并。

## 发布前

完成法律主体、运营国家、牌照、KYC、AML、制裁筛查、交易监控、密钥管理、供应商合同、观测告警、备份恢复演练、对账和应急止损。生产部署授权必须大于 0。

## 运行中

高危告警可暂停新订单，但不得凭告警直接篡改账本。Break-Glass 限时、最小权限并强制事后复核。未知外部结果只查询与对账，不自动重付。

Task 3 v1.5 数据库门禁已实施并通过：会抛错的 Kysely reserve hook 使用 0；取得 client 后五类角色门禁失败 `release(true)` 恰好一次；wrapper/handle 关闭失败统一 `DATABASE_CLOSE_FAILED`、底层正文命中 0且 Promise 粘滞；独立 QueryCreator facade 本体/链式结果的关闭能力在 runtime 和 TypeScript 均为 0。两个容器显式平台覆盖 2/2，Flyway telemetry 固定关闭。raw request 的 5 秒 timeout/abort/race、后续 5 秒 stream timeout、strict parser、三路聚合、late settle、Secret 净化、非零退出 inspect 与唯一 owner 回收由 scenario 01–24 通过。真实 LOGIN/NOLOGIN 权限矩阵还证明 JDBC connection-level Flyway role 不给 LOGIN 直接 schema/table/history 权限。完成状态是 READY v1.5 等待用户复审；共享/生产数据库、真实 Secret 与部署门禁仍未满足。

## 阶段 1 实施事实（2026-08-17）

已运行门禁：`pnpm test:all`（build→typecheck→architecture:check→unit 191→database 272→integration 43）、`pnpm docs:check`（156 文件零断链零逃逸）、depcruise 四规则。合并/发布门禁待 Git 流程建立后启用。
