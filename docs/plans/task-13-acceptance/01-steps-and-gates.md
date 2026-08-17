# 实施步骤与门禁

[返回索引](00-index.md)

## 实施步骤（第 26/48 步获授权后执行）

- [ ] Step 1：基线核对——11 Create 不存在、testing index 一致、三锁无漂移；记录基线 ZIP SHA-256。
- [ ] Step 2：AsyncBarrier + RecordingGateway + StageOneHarness 最小实现（真实 server/container/A-B pool）。
- [ ] Step 3：并发 spec 红灯→绿灯（08–09，--pool=forks --maxWorkers=1）。
- [ ] Step 4：webhook spec 01–07、10–13、17 逐项（07 为 HMAC 全矩阵重点）。
- [ ] Step 5：failure spec 14–15（注入装配）。
- [ ] Step 6：outbox-recovery spec 16（崩溃重投 + 幂等 effect + 审计）。
- [ ] Step 7：schema-boundary spec 18–20、22。
- [ ] Step 8：双 lifecycle spec 23（子进程、readiness、SIGTERM、清理、零网络）。
- [ ] Step 9：聚焦逐文件绿 → 进程外顶层 `pnpm test:all` 全绿。
- [ ] Step 10：重构检查（无顺序循环冒充并发、无真实 Telegram、失败注入仅在装配、连接串零泄露）。
- [ ] Step 11：verification.md 写入每项 PASS/FAIL、镜像 digest、超时、清理证据与未执行项。
- [ ] Step 12：交付与验收报告；等待用户外部复审。

## 验证命令

```
pnpm build && pnpm typecheck
pnpm exec vitest run --project integration <单个文件>   # 聚焦
pnpm test:all                                            # 仅进程外顶层
```

## 停止条件

- 需要修改生产实现/migration/配置 manifest：停止。
- 23 项任一无法以真实驱动满足（结构性而非测试问题）：停止登记。
- 并发/恢复出现非确定性失败：停止登记，不得重试掩盖。
- 三锁漂移或目标外写入：停止。

## 完成标准（总计划原文收敛）

23 项编号连续、全有真实断言；process 验收使用子进程/HTTP readiness、SIGTERM、退出码和资源清理；所有流程零真实外部连接。
