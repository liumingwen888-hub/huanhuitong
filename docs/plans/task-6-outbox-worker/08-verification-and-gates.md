# 验证、停止与交付门禁

[返回索引](00-index.md)

## 验证命令（获授权后）

```
pnpm build
pnpm typecheck
pnpm test:unit          # 含 T6C01–T6C10
pnpm test:db            # 含 T6C11–T6C28 与全量回归
```

环境沿用第 10 步先例：官方 Node 24.18.0、frozen/ignore-scripts install、Docker Testcontainers 锁定镜像；完成后容器/网络/TEMP 残留必须为 0。

## READY 条件

- 本计划（及 v1.1 canonical fragments，如复审要求）获用户外部复审通过。
- 十个冻结目标核对通过；无 schema/依赖/锁漂移。

## BLOCKED / 停止条件

- 发现 schema 缺口需要改 migration：停止，按范围外申请。
- CAS 或并发测试出现非确定性失败：停止并登记，不得以重试掩盖。
- 任何目标外文件需要写入：停止。
- 三锁漂移：停止。

## 回滚

实施开始前记录基线（含各文件 SHA-256）；失败时按基线恢复全部 10 个目标路径；docs 状态同步回实施前。

## 完成标准（总计划 Task 6 节原文收敛）

- at-least-once 明示；所有 mark/extend 以 outboxId + workerId + leaseToken + lockGeneration CAS；旧租约更新 0 行；禁用不轮询写库/刷日志；重复风险有审计/补偿说明；无真实 Telegram Gateway，不作外部绝对不重复承诺。
