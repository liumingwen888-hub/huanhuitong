# S2-2 凭证处理组件 详细计划索引

计划版本：`v1.0`。风险级别：`L3`（全项目最敏感组件）。计划状态：`READY v1.0 / WAITING_EXTERNAL_REVIEW`。S2-2 代码状态：`NOT_STARTED`。

## 权威需求来源

- [AGENTS.md 支付密码红线](../../../AGENTS.md)、[account-security-and-recovery 领域](../../domains/account-security-and-recovery.md)、[阶段 2 总体规划 v1.0](../2026-08-17-stage-2-account-security-master-plan.md)。
- S2-1 已交付：V2 表/策略种子/仓储；V2 CHECK 哈希格式为通用四段。

## 关键裁决：哈希算法（须用户复审确认）

**推荐：Node 内置 `crypto.scrypt`（方案 B）**——格式 `scrypt$ln=32768,r=8,p=1$<salt-b64>$<hash-b64>`，四段结构通过 V2 CHECK（无需迁移变更）、零新依赖、零锁漂移、跨平台纯运行时。参数：N=32768(2^15)、r=8、p=1、salt 32B、key 64B（OWASP 认可配置）。
备选：Argon2id（`@node-rs/argon2` 预编译原生依赖）——需按方案 A 先例新增运行时依赖并锁漂移登记。

## 目标

1. **专用凭证处理组件** `credential-processor.ts`：唯一允许接触密码原文的模块——内存中按位组合、验证后立即清零（`zeroFill` finally）、对外仅输出布尔结果或哈希串；模块级导出面冻结。
2. 哈希服务 `credential-hash.ts`：scrypt 计算（异步、参数版本化 `hash_param_version`）；常量时间比较（`timingSafeEqual`）；参数升级路径（旧版本验证→重哈希）。
3. **验证编排** `verify-payment-credential.ts`：读策略→查凭证→锁定/冷静期检查→哈希验证→失败计数与阶梯锁定执行（×2 递增）→成功清零计数。
4. 内存安全合同：输入 digit 缓冲借出即清零；组件外零原文引用（测试以内存扫描断言）；禁止 JSON.stringify/日志/异常携带原文（静态断言 + 运行时哨兵）。

## 冻结未来工程矩阵

Create：`apps/platform/src/modules/security/domain/credential-processor.ts`、`domain/credential-hash.ts`、`application/verify-payment-credential.ts`、`test/unit/credential-processor.spec.ts`、`test/unit/credential-hash.spec.ts`、`test/database/verify-credential.integration.spec.ts`。Modify：0。

## 测试矩阵（S2Cx 编号）

- unit：组合/清零生命周期（借出后缓冲全零）、输入类型防御（Proxy/超长/非数字拒绝）、哈希确定性与盐唯一、常量时间等长不等值、参数版本升级重哈希、内存扫描零残留、静态断言（无 console/log/JSON 序列化路径）。
- database：验证成功/失败计数/5 次锁定/阶梯 ×2/冷静期拦截/NOT_SET 拒绝/LOCKED 期间拒绝/REVOKED 拒绝；并发验证单计数。

## 停止条件

需要新依赖（若用户选 Argon2id 则按方案 A 授权后继续）、需改 V2 CHECK、三锁漂移、原文出现在组件外任何路径。
