# Implementation Steps 01–20

[← Task 4 LAYOUT-S1 index](00-index.md) · [Canonical fragments](fragments/00-index.md)

> Task 4 v1.10 execution checklist. Step numbers, order and unchecked state are authoritative. Future engineering code is referenced by canonical fragment and SHA-256 instead of duplicated.

- [ ] **Step 1:** 在系统 TEMP 记录实施前 exact baseline：项目 `146 files = 91 Markdown + 55 non-Markdown`，三个 Create 路径不存在，三锁 SHA-256，授权写集合和资源残留；未来范围保持 `Create 3 / Modify 2 / Delete 0 / outside 0`，三个 Create 均为非 Markdown，因此未来实施完成数量必须为 `149 files = 91 Markdown + 58 non-Markdown`。任一实施前或数量公式不一致立即停止；历史 `122/67/55` 不得作为当前基线。

- [ ] **Step 2:** 先写未来完整 integration spec，保持所有真实 PostgreSQL test 与 TEMP scripted 开关；按 [canonical fragment manifest](fragments/00-index.md) 的 integration exact concatenation 顺序重建并写入 `apps/platform/test/database/unit-of-work.integration.spec.ts`，该 manifest 与对应 fragments 是该路径唯一施工权威输入。

> Canonical target: [integration prefix](fragments/03-unit-of-work.spec.ts.md) → [part 01](fragments/05-unit-of-work.integration.spec.part-01.ts.md) → [part 02](fragments/05-unit-of-work.integration.spec.part-02.ts.md) → [part 03](fragments/05-unit-of-work.integration.spec.part-03.ts.md) → [part 04](fragments/05-unit-of-work.integration.spec.part-04.ts.md). Full SHA-256: `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789`.

- [ ] **Step 3:** 写未来完整 database unit spec；从 [canonical database spec](fragments/04-database.spec.ts.md) 重建并写入 `apps/platform/test/unit/database.spec.ts`，该 fragment 是该路径唯一施工权威输入。

> Full SHA-256: `07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC`.

- [ ] **Step 4:** 执行 [T4R-27 self-contained v1.8 RED reconstruction](11-verification-and-delivery-gates.md#t4r-27-self-contained-v18-red-reconstruction)：从当前 canonical fragments 在系统 TEMP 重构五个 v1.10 文件，对 `unit-of-work.ts` 两处精确反向替换且命中各 1，先核对 `24624 bytes / 878 lines / 4BE97A751BD02700C37E307AB57F53770261C95A09B152DAA6566DBD0E73ABEC`，再直接记录 `scanCallbackSql()` 对 SQLPOL51 的 `{ kind: "ok" }` 并连续运行两次 `^SQLPOL51:`。每次必须精确 matched 1、failed 1、唯一失败 ID 为 SQLPOL51、唯一原因是 expected delegate 0 / actual delegate 1；module resolution、test collection、beforeAll/fixture、TypeScript 和其他测试失败必须全为 0。非零 exit code 本身不构成正确 RED。

权威可执行 PowerShell、精确输出判定和清理逻辑只保存在 Step 4 链接的验证门禁，避免第二份可漂移命令。

- [ ] **Step 5:** 在同一 hash-identical v1.8 TEMP 重建物上运行 `^SQLPOL5[1-7]:`；必须 matched 7，failed IDs 精确为 SQLPOL51～SQLPOL55，passed IDs 精确为 SQLPOL56～SQLPOL57，五个失败均只显示 expected delegate 0 / actual delegate 1，其他错误 0。不得先改生产片段后补写 RED。

批量 RED 复用 Step 4 链接的自包含 harness，不能以任意非零退出替代结构化断言。

- [ ] **Step 6:** 在 v1.8 提取物运行 SQLPOL01～SQLPOL50 既有基线；所有拒绝项第一次目标 delegate 为 0，所有允许项为 1，T4R-22/T4R-23、`set_config`、顶层/最终主要语句 `pg_settings` 与 allowlist 均无回归。

```powershell
$env:XHT_TASK4_SCRIPTED_ONLY='1'; pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t 'SQLPOL(0[1-9]|[1-4][0-9]|50)'
```

- [ ] **Step 7:** 在自当前 canonical 反向重建且 hash-identical 的 v1.8 TEMP 副本单独复核 SQLPOL26～SQLPOL44、SQLPOL49～SQLPOL50 与 SQLPOL56～SQLPOL57 防误报基线；字符串、Escape 字符串、dollar quote、注释、`current_setting`、普通标识符、六类业务语句族、普通业务数据修改 CTE 与只读 pg_settings CTE 必须保留 delegate 1。

```powershell
$env:XHT_TASK4_SCRIPTED_ONLY='1'; pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t 'SQLPOL(2[6-9]|3[0-9]|4[0-4]|49|50|5[6-7])'
```

- [ ] **Step 8:** 以声明过滤器 `^LEX01:` 回归 LEX01，证明 ordinary string 反斜杠后的 COMMIT 仍在发送前拒绝。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX01:'
```

- [ ] **Step 9:** 以声明过滤器 `^LEX02:` 回归 LEX02，证明 ordinary string 反斜杠后的 ROLLBACK 仍在发送前拒绝。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX02:'
```

- [ ] **Step 10:** 以声明过滤器 `^LEX0[34]:` 回归 LEX03/04，证明插入绕过、大小写变体的目标 delegate 和部分副作用均为 0。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX0[34]:'
```

- [ ] **Step 11:** 以声明过滤器 `^LEX0[5-7]:` 回归 LEX05～LEX07，证明 ordinary string 内控制词文本与连续 `''` 不误报。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX0[5-7]:'
```

- [ ] **Step 12:** 以声明过滤器 `^LEX08:` 回归 LEX08，`String.raw` 单反斜杠 E string 必须接受且 delegate=1。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX08:'
```

- [ ] **Step 13:** 以声明过滤器 `^LEX09:` 回归 LEX09，闭合 E string 后的顶层 `; commit` 必须 delegate=0。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX09:'
```

- [ ] **Step 14:** 以声明过滤器 `^LEX1[01]:` 回归 LEX10/11，`e`/`E` 等价且普通标识符末尾 `e` 不被误判为 Escape prefix。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX1[01]:'
```

- [ ] **Step 15:** 以声明过滤器 `^LEX12:` 回归 LEX12，完整 dollar tag 内分号与控制词必须接受且 delegate=1。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX12:'
```

- [ ] **Step 16:** 以声明过滤器 `^LEX13:` 回归 LEX13，dollar quote 闭合后的第二条语句必须在首次 delegate 前拒绝。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX13:'
```

- [ ] **Step 17:** 以声明过滤器 `^LEX14:` 回归 LEX14，行注释、CRLF、嵌套块注释和单个末尾分号必须正确闭合。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX14:'
```

- [ ] **Step 18:** 以声明过滤器 `^LEX15:` 回归 LEX15，BOM、CRLF、空白与注释组合不得隐藏普通字符串反斜杠。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX15:'
```

- [ ] **Step 19:** 以声明过滤器 `^LEX16:` 回归 LEX16，未闭合普通字符串必须固定 unsafe 且 delegate=0。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX16:'
```

- [ ] **Step 20:** 以声明过滤器 `^LEX17:` 回归 LEX17，未闭合 Escape 字符串必须 fail closed 且 delegate=0。

```powershell
pnpm exec vitest run apps/platform/test/database/unit-of-work.integration.spec.ts --project database -t '^LEX17:'
```
