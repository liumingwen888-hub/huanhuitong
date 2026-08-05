# Task 5 canonical fragments index

[返回 Task 5 索引](../00-index.md)

本目录是七个未来工程目标的唯一完整正文来源。其他 Markdown 不复制完整 body；实施时只提取 `XHT-T5-CANONICAL-BEGIN/END` 之间的一个 `ts` fence，末尾追加一个 LF。当前 fragments 是计划，不是已实施工程文件。

## Manifest

| 操作 | Target | Fragment | Bytes | SHA-256 |
|---|---|---|---:|---|
| Create | `packages/contracts/src/inbox-digest.ts` | [01](01-inbox-digest.ts.md) | 836 | `FB7B68D0ABD5B9567C7F0F713A59E11D40CCD3D305D099420B12D54C4AAC6D82` |
| Modify | `packages/contracts/src/index.ts` | [02](02-contract-index.ts.md) | 164 | `9B5C7E5513D424D51AAB9C525C47C10025C5575EF196CD0B9CC5639859EBFB38` |
| Create | `apps/platform/src/modules/reliability/inbox/inbox.types.ts` | [03](03-inbox.types.ts.md) | 2665 | `1CB3204C9E2024BD18D4E062799BE080EB3C674F1166F34ABAAF960E743E18AF` |
| Create | `apps/platform/src/modules/reliability/inbox/telegram-update-digest.ts` | [04](04-telegram-update-digest.ts.md) | 7377 | `C0E30632B1489FD40A665B6E3F836212ADDE73B52FF528B597991CF824475606` |
| Create | `apps/platform/src/modules/reliability/inbox/inbox.repository.ts` | [05](05-inbox.repository.ts.md) | 14127 | `8A40F116F2470459D3993EA8A7623AE280B5767978DB89449A415D478B5337E2` |
| Create | `apps/platform/test/unit/telegram-update-digest.spec.ts` | [06](06-telegram-update-digest.spec.ts.md) | 14484 | `6E410A0E10B58BA6024B6914F3335EA328B1D96331D7B51BC5DB82BBEE898D45` |
| Create | `apps/platform/test/database/inbox-repository.integration.spec.ts` | [07](07-inbox-repository.integration.spec.ts.md) | 38625 | `E45C6AE2B15A57354167FF96DF774A6B5778FE65AC408F0010FB4C7C3490F0ED` |

合计 Create 6、Modify 1、Delete 0。Target 集合外内容写入即停止。

## 精确 RED delta manifest

### Digest RED

Canonical needle（全文件命中必须为 1）：

```text
.digest('base64url')
```

TEMP RED replacement：

```text
.digest('base64url').replace(/.$/u, 'A')
```

RED target 应为 7397 bytes / `7A89226AED74F4634699811D6E151C657D52CFC72605750D33CCC576AF57AB2C`。只允许 T5C01 固定向量断言失败；恢复后回到 7377 bytes / canonical SHA。

### Repository RED

Canonical 三行上下文（全文件命中必须为 1）：

```text
inboxId: inserted.inbox_id,
        lease: newLease,
        reclaimed: false
```

只把最后一行改为 `reclaimed: true`。RED target 应为 14126 bytes / `D449F4FF76F663614AAB1765D179AC1C49804C6079A188D667407501F60475EC`。只允许 T5C25 的 reclaimed false/true 行为断言失败；恢复后回到 14127 bytes / canonical SHA。

## v1.3 计划可执行性证据

在系统 TEMP 从以上七 fragments 机械重构后，本轮真实结果为：

- 离线 frozen/ignore-scripts install 使用锁定 pnpm store，下载 0；TypeScript `Version 7.0.2`。
- 五 workspace build exit 0；七 future targets 的 NodeNext strict/noEmit exit 0、diagnostics 0。
- future unit：1 file、24/24 PASS、T5C01–T5C24 连续，failed/skipped 0；T5C14 的三类 Proxy 均 `UNSUPPORTED_VALUE`、trap 0、有效 digest 0。
- future database：strict compile exit 0；`vitest list` 收集 26 个唯一标题 T5C25–T5C50；未启动 PostgreSQL，因此不记为 PASS。
- T5R-03 直接探针：candidate index accessor、root Proxy、claim/mark Date 自有 `getTime` accessor/method 与 Date subclass 均得到 authentic `InboxRepositoryError / INBOX_COMMAND_INVALID / retryable=false`；getter/method/trap/context touches 0；普通合法 Date 由 `Date.prototype.getTime.call(value)` 成功解析。
- T5R-02 静态合同：repository 中 `claimed_until = oldClaimedUntil`、应用 `getTime()` expiry decision 与 `readDatabaseNow` 路径均为 0；重领 CTE 同时包含一次 database_time、`claimed_until <= database_time.value` 与同一时间生成新 lease。T5C36 有数据库微秒 seed，T5C37 的 `<=→<` query-evidence mutation gate 明确存在。
- T5R-05：T5C48 运行时构造完整 sentinel 集、递归 own data-property scan 与固定字符串 allowlist；failed PID destroy once、健康 PID normal release once 均有直接断言。数据库本轮未运行。
- 最初 strict 编译曾真实发现 array descriptors 的 `length` 类型冲突与 T5C46 union-Promise 泛型冲突；分别改为 own length descriptor 与 `Promise<unknown>` 后重跑最终全部通过，未把失败伪装为通过。
- 未连接 Docker/PostgreSQL/Flyway/Testcontainers；所有 TEMP 已清理。

这些结果统一标记 `TEMP PLAN EXECUTABILITY EVIDENCE`，不等于 Task 5 项目实施、真实项目 build/typecheck 或 database validation。

## 机械门禁

1. 七个 target 各有且只有一个 BEGIN/END sequence=1。
2. 每个 fragment 提取命中 1；其他 Markdown target marker 命中 0。
3. 提取结果的 bytes/SHA 必须与表相同。
4. 实施前 Create 目标 6 个不存在，Modify 输入 hash 与获批交付一致。
5. 写入后七目标与 manifest 7/7 identical，任何 formatter 后差异也视为失败。
