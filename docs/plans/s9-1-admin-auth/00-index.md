# S9-1 管理员认证与 V14 迁移 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（运营平面信任根）。计划状态：`READY v1.0`（2026-08-19 用户外部复审通过；同日显式授权 V14 迁移与 hash-wasm 依赖）。S9-1 代码状态：`VERIFIED`（2026-08-19 实施完成；见下方实施验证）。

## 权威需求来源

[阶段 9 总体规划 v1.0](../2026-08-19-stage-9-admin-master-plan.md)（已裁决决策 2）、[admin-and-audit 领域](../../domains/admin-and-audit.md)（独立管理员身份、MFA/重新认证、默认拒绝）、[V5 既有骨架](../../../database/migrations/V5__stage_3_crosscutting.sql)（admin_principals/admin_role_grants）、[S2 TOTP 实现](../../../apps/platform/src/modules/security/domain/totp.ts)。

## 目标

1. **V14 增量迁移**（须显式授权）——两表：

### `admin_credentials`
- `admin_id uuid PK FK` → admin_principals（1:1）；`username text UNIQUE NOT NULL`（`^[a-z0-9-]{3,32}$`）；
- `password_hash text NOT NULL`（argon2id 编码串——PHC 格式，含盐与参数）；
- `totp_secret_ref text NOT NULL`（`^vault:[A-Za-z0-9_-]{4,64}$`——**密钥本体不落库**，经 TotpSecretPort 引用解析，与 callback_secret_ref 同型）；
- `failed_attempts integer DEFAULT 0`；`locked_until timestamptz NULL`；`created_at/updated_at`；
- CHECK：failed_attempts >= 0；锁定窗口 15 分钟（5 次失败触发——服务层强制，列存事实）；
- 权限：平台 SELECT + UPDATE(password_hash, failed_attempts, locked_until, updated_at)；INSERT 走 bootstrap 一次性（seed）；worker 无权限。

### `admin_sessions`
- `session_id uuid PK`；`admin_id FK`；`token_hash text UNIQUE NOT NULL`（sha256(原始令牌)——**原始令牌只在登录响应出现一次**）；
- `created_at`；`expires_at`（created + 30 分钟）；`elevated_until timestamptz NULL`（重认证后 +5 分钟）；`revoked_at timestamptz NULL`；
- CHECK：expires_at > created_at；
- 索引：admin_id 活跃会话；权限：平台 SELECT+INSERT+UPDATE(revoked_at, elevated_until)；worker 无权限。

- **种子**：一名 bootstrap 管理员（username `bootstrap-admin`，argon2 哈希为文档化合成密码 `Bootstrap-Admin-2026!`，TOTP secret_ref `vault:bootstrap-totp-v1`）+ SUPER_ADMIN 角色——首登强制改密的生产要求记录为 S9-8 验收项。

2. **服务（modules/admin/application）**：
- `AdminAuthService.login({username, password, totp})`——失败计数/锁定 fail-closed、argon2 验证（**hash-wasm argon2id**——纯 WASM 无原生构建依赖）、TOTP 验证（复用 S2 totp 算法 + TotpSecretPort 解析）、成功创建会话返回原始令牌一次；
- `logout(sessionToken)` / `elevate(sessionToken, password, totp)`（刷新 elevated_until）；
- `requireSession(token, level)`——校验哈希存在、未撤销、未过期、（level=ELEVATED 时）elevated_until > now。
- **TotpSecretPort**（admin/domain）：`resolveSecret(ref) → string`——纯接口 + FakeTotpSecretStore（测试注入合成密钥）；生产实现经 Vault 边界。

3. **contracts**：AdminSessionSnapshot、AdminAuthErrorCode（含 LOCKED/INVALID/MFA_REQUIRED/SESSION_EXPIRED/ELEVATION_REQUIRED）。

## 冻结未来工程矩阵

Create：`database/migrations/V14__stage_9_admin_auth.sql`、`modules/admin/domain/{totp-secret.port.ts, fake-totp-secret.store.ts}`、`modules/admin/application/{admin-auth.service.ts, admin-session.repository.ts}`、`modules/admin/infrastructure/postgres-admin-session.repository.ts`、`apps/platform/test/database/admin-auth.integration.spec.ts`（S9AM）。Modify：contracts（新文件 admin.ts + index 导出）、package 依赖 hash-wasm。

## 测试矩阵（S9AM）

- S9AM01 bootstrap 登录成功（合成密码+TOTP）→ 会话令牌返回一次、库中仅哈希
- S9AM02 密码错误 ×5 → 锁定 15 分钟；正确密码在锁定期内仍拒
- S9AM03 TOTP 错误 → MFA_REQUIRED 拒绝且计数
- S9AM04 会话校验矩阵：有效/过期/撤销/未知令牌；elevate 后 ELEVATED 窗口通过、窗口过后拒绝
- S9AM05 logout 撤销后会话失效
- S9AM06 角色矩阵：worker 对两表零权限；平台对 sessions 无 INSERT 旁路（列级）
- S9AM07 哈希格式与安全：库中无明文密码/无 TOTP 本体（扫描断言）

## 实施裁决记录（2026-08-19）

1. **V14 两处 FK 改 ON DELETE CASCADE**（credentials/sessions → admin_principals）：种子 bootstrap 管理员的持续存在与既有规格"清 admin_principals 重建"的清理模式冲突（RESTRICT 挡删）；级联语义为"删主体即清除其凭据与会话"，主体删除本身仍是受控操作。
2. 两个既有规格清理列表补 `admin_role_grants`（withdrawal-contracts/request）——V14 种子带 SUPER_ADMIN 授权后，从未清理 grants 的规格被 V5 FK 挡住；种子引入持续事实则依赖清理需覆盖其全部从属。
3. argon2id 参数 m=19456/t=3/p=1（≥OWASP 建议）；bootstrap 哈希为迁移内常量（合成密码文档化）。
4. 会话过期测试回填须同时回填 created_at（ck_admin_sessions_expiry 形状约束——与 S7 报价回填同型）。

## 实施验证（2026-08-19，macOS/arm64 本地）

- `pnpm build` + 全 workspace typecheck exit 0；`pnpm architecture:check` 0 违规（204 模块、220 依赖）。
- unit 32 文件 253/253 PASS。
- S9AM01–S9AM07 全 PASS：登录返回原始令牌恰一次（库中仅 sha256 十六进制、非令牌本体）、五次失败锁 15 分钟（正确凭据锁定期内仍拒）、TOTP 错误计数拒绝、会话矩阵（未提升拒/提升后过/窗口过期拒/会话过期拒/未知令牌拒）、logout 永久失效、worker 对两表零权限 + 平台 INSERT 旁路被拒、零明文扫描（密码哈希非明文 + TOTP 引用格式）。
- 数据库回归：512/515（M06/M14/M16 已知三件套）；integration 121/121。两规格（exchange-settlement/payout-callback）在全量并行时套件级 Flyway 抖动，隔离复跑 12/12 通过（已知容器负载敏感类）。
- 交付物：`V14__stage_9_admin_auth.sql`（两表 + bootstrap 种子）、`modules/admin/domain/{totp-secret.port, fake-totp-secret.store}.ts`、`modules/admin/application/{admin-auth.service, admin-session.repository}.ts`、`modules/admin/infrastructure/postgres-admin-session.repository.ts`、contracts/admin.ts、hash-wasm 依赖、S9AM 规格、迁移钉 V14（46 表）+ 两规格清理修正。

## 停止条件

TOTP 本体或原始令牌入库、锁定可被绕过、argon2 参数弱于 OWASP 建议（m≥19456 KiB, t≥2, p≥1）。
