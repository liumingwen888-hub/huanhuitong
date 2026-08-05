# Canonical JSON 与 HMAC 合同

[返回索引](00-index.md)

## 输入边界

`digestTelegramUpdate(update: unknown, keyring: InboxDigestKeyring)` 只接受已经由未来 HTTP 适配器解析得到的完整 Telegram Update 根对象。它不是字段白名单 mapper：所有 enumerable string-keyed unknown/future fields 都参与摘要。Task 9 在调用后只传最小业务 DTO 和 `InboxDigestSet`，不传 raw Update 或 canonical bytes。

## Canonical JSON 规则

1. 根必须是普通对象或 null-prototype 对象，不接受数组、null 或原始值。
2. 任意 object 值先以 Node 内置 `node:util/types.isProxy` 判断；根 Proxy、嵌套 object Proxy 与嵌套 array Proxy 必须在任何 prototype、ownKeys、descriptor 或属性观察前以 `UNSUPPORTED_VALUE` 拒绝，trap/getter 调用 0、有效 digest 0。通过该门禁后，普通对象遍历全部 own enumerable string data properties；未知字段保留。symbol key、accessor/getter、不可枚举业务属性或非普通 prototype 默认拒绝。
3. object key 以 Unicode code point 序列升序比较；不得依赖插入顺序。未配对 surrogate 以其 code unit 数值参与稳定比较。
4. array 保持元素顺序；own property 集合必须精确等于 `length` 加 `0`～`length-1` 的全部自有 data index。稀疏 hole、命名属性、symbol、accessor、非枚举 index、越界数字属性、`4294967295` 或更大数字字符串、`undefined` 元素全部稳定拒绝；任何 own property 都不得静默忽略。
5. string 由 `JSON.stringify` 的 JSON escaping 写出；不 trim、不截断、不做 NFC/NFD 或大小写归一化。
6. number 必须有限；`NaN`、正负 Infinity 拒绝。`-0` 精确写为 `0`；其他值按 ECMAScript `JSON.stringify(number)` 的最短 JSON number 形式。`1`、`1.0` 和 `1e0` 在 parsed 边界同值并得到同一形式。
7. null 写为 `null`；boolean 写为 `true`/`false`。
8. `undefined`、bigint、function、symbol、循环引用拒绝；不会被省略、转 null 或字符串化。
9. 同一非循环对象被多个位置引用时按每个位置完整写出；active-path WeakSet 只拒绝 cycle。
10. canonicalizer 不选择 `/start`、message、callback、from 或 chat 白名单；顶层 update 类型、text、start parameter、callback data、from.id、chat.id 和未来字段任一变化都改变摘要。唯一允许的结构等价是对象键顺序变化；数值 lexical 等价在 parsed 边界也等价。

## UTF-8 内存生命周期

实现以 byte writer 逐 token 编码，不创建一份完整 canonical JSON string。每个临时 chunk 在合并后立即 `fill(0)`；最终 canonical Buffer 只在本次所有 current/retained HMAC 计算期间存在，并在外层 `finally` 清零。canonical Buffer、chunk、raw Update 或其引用不得出现在返回 DTO、class field、closure cache、日志、错误或异步 callback 中。

`withMaterial` 回调必须同步完成并只返回 digest string DTO；借用 key material 由 Task 2 自己的 `finally` 清零。Task 5 不二次持有、复制、缓存或 dispose keyring。

## 摘要格式与轮换

- 算法：HMAC-SHA-256。
- 输入：上述完整 canonical UTF-8 bytes。
- key：Task 2 `InboxDigestKey.withMaterial` 同步借用。
- 存储格式：`hmac-sha256:` + 32-byte digest 的无 padding base64url，固定 43 字符 payload，总长 55。
- 新行只写 `keyring.current.version` 与 current digest。
- `comparisonCandidates` 精确包含 current 和所有 retained，各版本一次；repository 按原行 `digest_key_version` 精确选一个，不尝试“任一 key 匹配”。
- 原版本不在 current/retained 集合时返回 `digest_key_unavailable`，不更新行、不产生业务或 Outbox 效果，并由未来 HTTP 层映射稳定 503 以保留 Telegram 重试。

## 固定合成向量

合成 key：32 个 `0x02` bytes；版本 `v2`。完整 parsed Update：

```json
{"update_id":9001,"message":{"text":"/start alpha","from":{"id":100},"chat":{"id":200}}}
```

Canonical JSON：

```json
{"message":{"chat":{"id":200},"from":{"id":100},"text":"/start alpha"},"update_id":9001}
```

Canonical UTF-8 hex：

```text
7b226d657373616765223a7b2263686174223a7b226964223a3230307d2c2266726f6d223a7b226964223a3130307d2c2274657874223a222f737461727420616c706861227d2c227570646174655f6964223a393030317d
```

期望摘要：

```text
hmac-sha256:_ok7DE_TalvbxgzGFS2aBYH0tIc4dWOhViegvxH8Ekg
```

固定向量只使用合成数据。测试必须同时断言 key-order 等价、字段变更不等价、输出格式、版本和清零证据。

## 错误合同

`CanonicalTelegramUpdateError` 只暴露稳定 code；Proxy 统一复用 `UNSUPPORTED_VALUE`：`ROOT_NOT_OBJECT`、`UNSUPPORTED_VALUE`、`NON_FINITE_NUMBER`、`SPARSE_ARRAY`、`ACCESSOR_PROPERTY`、`SYMBOL_PROPERTY`、`NON_PLAIN_OBJECT`、`CYCLIC_VALUE`。message/stack 不包含输入值；不挂 raw cause。Task 2 `KEYRING_DISPOSED` 等稳定错误原样传播到调用方，再由 Task 4/未来 HTTP 安全分类；不得把 key/version/digest/raw 内容拼入错误。
