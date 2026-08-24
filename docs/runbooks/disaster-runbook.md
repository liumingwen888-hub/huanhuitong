# 灾难模式处置手册（Runbook）

适用范围：换汇通生产环境。每类场景按 **检测 → 止损 → 诊断 → 恢复 → 复盘** 五步处置。红线：任何处置不得在未查询权威状态前自动对外付款。

## 通用前置

- 值班管理员登录 admin-web（MFA + 高风险操作重认证）。
- 所有资金相关操作走审批工作台（FINANCE_OFFICER + ELEVATED，双人）。
- 每步操作落入审计（自动）+ 事件单（人工）。

---

## 场景一：账本分叉

**现象**：对账视图（`/admin/ops/reconciliation`）出现 PROJECTION_MISMATCH / GLOBAL_BALANCE / ACCOUNT_INTEGRITY 类差异；ledger 域 `ledger_posting_rejected_total > 0`（P0 告警）。

### 检测
1. 告警 `ledger-posting-rejected`（P0）触发——立刻响应。
2. 打开对账视图确认差异类别与数量。

### 止损
1. **暂停新订单受理**：将 signer_policies / provider_configs 全部 max_amount 调 1（经配置发布流发布新版本——立即生效但可逆）。
2. 不停数据库——账本是事实源，停写不修复已有分叉。

### 诊断
1. `audit_events` 查差异时间窗内的 `ADMIN_API_*` 与 `ledger_*` 事件。
2. 若 PROJECTION_MISMATCH：跑投影重算（ReconciliationService 提供的重算入口——差异仅投影层则修复即消失）。
3. 若 GLOBAL_BALANCE / ACCOUNT_INTEGRITY：**进入冻结流程**——这是真实分叉，不可自动修复。

### 恢复
1. 投影层差异：重算后对账清零 → 逐步恢复 max_amount → 观察一小时。
2. 真实分叉：保留现场（全量 pg_dump + 审计导出）→ 冲正分录（走账本补偿接口，关联审批请求）→ 对账确认 → 恢复。

### 复盘
- 24 小时内出根因报告：分叉入口（并发/绕过/迁移缺陷）→ 补测试 → 补门禁。

---

## 场景二：供应商异常

**现象**：代付供应商回调停止 / `payout_provider_unavailable` 告警（P1）持续；待审清单 PAYOUT_UNKNOWN 积压。

### 检测
1. 告警 `payout-provider-unavailable`（>5 次/15 分钟）。
2. 观察清单 UNKNOWN 项是否持续增长。

### 止损
1. **暂停新代付提交**：provider_configs 发布 max_amount=1 版本（新单停止提交，存量不受影响）。
2. 已提交未确定的订单**保持 UNKNOWN**——绝不推断失败、绝不自动重付。

### 诊断
1. 审批台逐单触发"查询裁决"（queryFirst——查询优先红线）。
2. 供应商侧确认：API 状态页 / 人工联系（合同 SLA 联系人）。

### 恢复
1. 供应商恢复 → 查询裁决逐单落定（SUCCEEDED → 排结算 / FAILED → 释放）。
2. 对账视图确认 payout 域零差异 → 恢复 max_amount。

### 复盘
- 记录供应商故障时长与影响单量；评估熔断阈值是否需调整。

---

## 场景三：密钥泄露

**现象**：Vault 密钥泄露告警 / 异常管理员登录（`admin_auth_failed_total` 激增）/ 未知 IP 高频 API 调用。

### 检测
1. 告警 `admin-auth-brute-force`（P1）或人工发现。
2. 审计查询：`category=ADMIN_API_` 按时间窗检索异常 actor。

### 止损
1. **立即吊销泄露会话**：DELETE /admin/auth/session（可疑管理员的全部活跃会话）。
2. **锁定账户**：admin_credentials.locked_until 置远期（数据库操作，双人在场）。
3. 若 Telegram Bot Token 泄露：立即通过 BotFather 吊销重发（**不经过本系统**）。

### 诊断
1. 审计全量导出泄露窗口的操作——确认是否有资金动作。
2. Vault 侧确认泄露范围（哪些引用受影响）。

### 恢复
1. 受影响密钥全部轮换（Vault 重新发券 → 更新引用）。
2. 若有资金动作：按账本冲正流程处理（关联审批）。
3. 解锁账户（改密 + 重新绑定 TOTP）。

### 复盘
- 泄露渠道分析；评估 MFA 覆盖面是否需加强。

---

## 场景四：数据丢失

**现象**：数据库不可用 / 存储损坏 / 误删除。

### 检测
1. platform/worker 健康检查失败（数据库不可达）。
2. `docker compose ps` postgres 状态异常。

### 止损
1. **停全部服务**（docker compose down platform worker admin-web——postgres 保留）。
2. 保护 WAL 归档卷（只读挂载防止覆盖）。

### 诊断
1. 确认备份可用性：`pg-restore-check.sh` 对最近备份跑验证。
2. 评估丢失窗口：最近成功备份时间 vs 故障时间（WAL 归档可缩至接近零）。

### 恢复（严格按序）
1. 新存储就位 → 物理恢复（备份目录启动 + WAL 重放至目标时间点）。
2. 跑 `pg-restore-drill.sh` 级别的对账断言（借贷平衡 / 投影零漂移）。
3. 确认 **SAFE_TO_RESUME**（Outbox 未投递原样保留 / 零新租约）。
4. 逐步恢复服务（先 worker 观察投递 → 再 platform → 最后 admin-web）。
5. 三域对账确认零差异 → 对外公告（如用户可感知）。

### 复盘
- RTO 实测数字记录（对比目标 <30 分钟）；备份频率与保留策略评估。

---

## 附录：升级矩阵

| 严重级 | 定义 | 响应时限 | 决策人 |
|---|---|---|---|
| P0 | 账本分叉 / 数据丢失 / 密钥泄露 | 立即 | 技术负责人 + 业务负责人 |
| P1 | 供应商异常 / 单域功能不可用 | 1 小时 | 值班管理员 |
| P2 | 性能退化 / 积压 | 4 小时 | 值班管理员 |
