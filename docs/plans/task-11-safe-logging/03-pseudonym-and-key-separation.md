# 伪名与密钥分离

[返回索引](00-index.md)

## toTelegramUserReference

```ts
toTelegramUserReference(externalUserId: string): Promise<string>
// 输出 'tgur-v1:<43-char-base64url>'（HMAC-SHA256、版本前缀、可轮换）
```

- 密钥来源：环境 SecretReference（`withResolvedSecret` 借用后清零），与 Task 2 Inbox digest keyring **完全独立**——不同密钥、不同版本命名空间、独立轮换；测试证明两者密钥字节不相等且互推不可行。
- 确定性：同 id 同密钥版本 → 同伪名（审计关联）；跨版本轮换保留旧版本可读性（版本号在输出中）。
- 输入仅 Telegram user.id 十进制字符串；无盐哈希、截断 SHA-256 等方案禁止（F-09 裁决）。
- Secret 值只在受控短生命周期存在（Task 2 合同），伪名函数不记录输入。

## 密钥分离测试要点

- logger HMAC key 与 Inbox digest key 材料相同 → 测试失败。
- 旧版本伪名在新版本激活后仍可由审计离线重算（版本化输入固定）。
