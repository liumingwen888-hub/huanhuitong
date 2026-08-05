# Implementation Steps 21–40

[← Task 4 LAYOUT-S1 index](00-index.md) · [Canonical fragments](fragments/00-index.md)

> Task 4 v1.10 execution checklist. Step numbers, order and unchecked state are authoritative. Future engineering code is referenced by canonical fragment and SHA-256 instead of duplicated.

- [ ] **Step 21:** 以声明过滤器 `^LEX18:` 回归 LEX18，未闭合 dollar tag 必须 fail closed 且 delegate=0。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX18:'
```

- [ ] **Step 22:** 以声明过滤器 `^LEX19:` 回归 LEX19，未闭合嵌套块注释必须 fail closed 且 delegate=0。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX19:'
```

- [ ] **Step 23:** 以声明过滤器 `^LEX20:` 回归 LEX20；`U&'…'`、`U&"…"`、bit、hex、national prefixed forms 必须逐个 delegate=0。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX20:'
```

- [ ] **Step 24:** 以声明过滤器 `^LEX21:` 回归 LEX21，策略拒绝后健康 client 必须 rollback 后 normal release，不得 destroy。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX21:'
```

- [ ] **Step 25:** 以声明过滤器 `^LEX22:` 回归 LEX22，策略拒绝后的下一次合法 execute 必须复用健康 pool 且只发送合法 SQL。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX22:'
```

- [ ] **Step 26:** 以声明过滤器 `^LEX23:` 回归 LEX23，公开 unsafe 错误的 SQL、参数、连接字段、stack 与内部对象敏感命中必须为 0。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX23:'
```

- [ ] **Step 27:** 运行既有 TXCTL01～TXCTL25 回归基线，确认 allowlist 没有替代 T4R-16 的多语句、extended 与私有通道隔离合同。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t 'TXCTL(0[1-9]|1[0-9]|2[0-5]):'
```

- [ ] **Step 28:** 运行 context、database、builder、release、cleanup 与安全错误回归基线，确认 T4R-17～T4R-19 合同不倒退。

```powershell
pnpm exec vitest run apps/platform/test/unit/database.spec.ts apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '(UOW(09|10|11|12|20)|REL0[1-5]|IMM01|CLEAN01)'
```

- [ ] **Step 29:** 汇总 RED/基线证据：自当前 canonical 两处反向替换得到的 hash-identical v1.8 必须明确记录 scan `{ kind: "ok" }`、替换命中各 1、SQLPOL51 连续两次 matched 1/failed 1/唯一原因 delegate 0→1，以及批量 matched 7、failed IDs 51～55、passed IDs 56～57、其他错误 0；既有 SQLPOL01～50、TXCTL/LEX/REL/IMM/CLEAN 保持基线。不得依赖 v10，不得先改生产片段后补写 RED。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t 'LEX(0[1-9]|1[0-9]|2[0-3])'
```

- [ ] **Step 30:** 实现完整 TransactionContext、QueryCreator lease 和受保护 executeSql 生命周期；从 [canonical TransactionContext](fragments/07-transaction-context.ts.md) 重建并写入 `apps/platform/src/infrastructure/database/transaction-context.ts`，该 fragment 是该路径唯一施工权威输入。

> Full SHA-256: `CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C`.

- [ ] **Step 31:** 实现完整 pg/Kysely overload、extended query、outcome/poison/release 保持；从 [canonical database source](fragments/06-database.ts.md) 重建并写入 `apps/platform/src/infrastructure/database/database.ts`，该 fragment 是该路径唯一施工权威输入。

> Full SHA-256: `455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C`.

- [ ] **Step 32:** 实现完整 UnitOfWork、内部私有控制通道、CallbackConnection/CallbackLease、有限顶层业务语句族 allowlist、WITH 终止语句解析及 token 级 `set_config`/每一可执行语句作用域 `UPDATE [ONLY] pg_settings` 拒绝；按 [unit-of-work prefix](fragments/01-unit-of-work.ts.md) → [callback connection suffix](fragments/02-callback-connection.ts.md) 重建并写入 `apps/platform/src/infrastructure/database/unit-of-work.ts`，两 fragment 是该路径唯一施工权威输入。

> Full SHA-256: `A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A`.

- [ ] **Step 33:** 运行 TransactionContext GREEN：四个 `@ts-expect-error` 被消费，runtime facade 不出现 transaction/connection/destroy/getExecutor。

- [ ] **Step 34:** 运行 UOW01～UOW03，确认 callback 返回值、对象 identity、两次写入同 backend 和成功 commit。

- [ ] **Step 35:** 运行 UOW04～UOW08，确认同步 throw、异步 reject、第二写失败、caught SQL failure 与派生 QueryCreator 全部原子回滚。

- [ ] **Step 36:** 运行 UOW09～UOW12 与 REV01，确认 revoke 发生在 commit 前且逃逸 query/builder/plugin/executeSql 零发送。

- [ ] **Step 37:** 运行 UOW13～UOW17，确认嵌套拒绝不取得第二连接、独立并发隔离、可见性与角色保持。

- [ ] **Step 38:** 运行 UOW18～UOW25，确认 acquire/begin/rollback/precommit/commit 的固定 outcome 和错误脱敏。

- [ ] **Step 39:** 运行 REL01～REL05，确认 COMMITTED、ROLLED_BACK、UNKNOWN 与组合失败不被 release 覆盖。

- [ ] **Step 40:** 运行 IMM01，确认私有身份品牌、Object.create、Reflect.set/defineProperty、prototype 和递归字段门禁。
