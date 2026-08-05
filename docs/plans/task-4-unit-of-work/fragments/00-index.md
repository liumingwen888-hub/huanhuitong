# Task 4 canonical fragments index

[← Task 4 LAYOUT-S1 index](../00-index.md)

Current technical plan: `v1.10`. Layout: `S1`. The canonical bodies remain frozen byte-for-byte from v1.9/v11 and are unchanged by v1.10. These fragments are the only canonical storage for the five future engineering files; they are plan inputs, not implemented project files.

## Reconstruction order

| Future target | Exact canonical order | Full bytes | Full lines | Frozen v11 SHA-256 |
|---|---|---:|---:|---|
| `apps/platform/src/infrastructure/database/database.ts` | [06-database.ts.md](06-database.ts.md) | 14767 | 474 | `455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C` |
| `apps/platform/test/unit/database.spec.ts` | [04-database.spec.ts.md](04-database.spec.ts.md) | 12062 | 366 | `07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC` |
| `apps/platform/src/infrastructure/database/transaction-context.ts` | [07-transaction-context.ts.md](07-transaction-context.ts.md) | 5511 | 220 | `CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C` |
| `apps/platform/src/infrastructure/database/unit-of-work.ts` | [01-unit-of-work.ts.md](01-unit-of-work.ts.md) → [02-callback-connection.ts.md](02-callback-connection.ts.md) | 25165 | 904 | `A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A` |
| `apps/platform/test/database/unit-of-work.integration.spec.ts` | [03-unit-of-work.spec.ts.md](03-unit-of-work.spec.ts.md) → [05-unit-of-work.integration.spec.part-01.ts.md](05-unit-of-work.integration.spec.part-01.ts.md) → [05-unit-of-work.integration.spec.part-02.ts.md](05-unit-of-work.integration.spec.part-02.ts.md) → [05-unit-of-work.integration.spec.part-03.ts.md](05-unit-of-work.integration.spec.part-03.ts.md) → [05-unit-of-work.integration.spec.part-04.ts.md](05-unit-of-work.integration.spec.part-04.ts.md) | 113197 | 3091 | `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789` |

## Canonical segment manifest

| Segment | Target | Sequence | Bytes | Lines | SHA-256 |
|---|---|---:|---:|---:|---|
| [01-unit-of-work.ts.md](01-unit-of-work.ts.md) | `apps/platform/src/infrastructure/database/unit-of-work.ts` | 1/2 | 19005 | 678 | `C301DDC091D8C31911DD1B7AA54973D9F5E2645B8FC6C2DD25F8BE167E81ACE7` |
| [02-callback-connection.ts.md](02-callback-connection.ts.md) | `apps/platform/src/infrastructure/database/unit-of-work.ts` | 2/2 | 6160 | 226 | `8AD4EBC0F13AEDA07ED6D4987D5827C018D26E913514367490F8D6B83C905C22` |
| [03-unit-of-work.spec.ts.md](03-unit-of-work.spec.ts.md) | `apps/platform/test/database/unit-of-work.integration.spec.ts` | 1/5 | 31460 | 1139 | `2FD69656F5222354A7C88F59257E03AD7F6E1E3029F311FDE90B6BE29C3773D2` |
| [04-database.spec.ts.md](04-database.spec.ts.md) | `apps/platform/test/unit/database.spec.ts` | 1/1 | 12062 | 366 | `07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC` |
| [05-unit-of-work.integration.spec.part-01.ts.md](05-unit-of-work.integration.spec.part-01.ts.md) | `apps/platform/test/database/unit-of-work.integration.spec.ts` | 2/5 | 36441 | 1081 | `C60B0499D4D4E35B51FCC95966A6554DADFEFC5E1EFEDC9E131EAFE068EC8226` |
| [05-unit-of-work.integration.spec.part-02.ts.md](05-unit-of-work.integration.spec.part-02.ts.md) | `apps/platform/test/database/unit-of-work.integration.spec.ts` | 3/5 | 10782 | 329 | `89FF2BB30704047D8231A1A752464C3EFD7DDBBAC38822E8D04B61D1DD81ECF1` |
| [05-unit-of-work.integration.spec.part-03.ts.md](05-unit-of-work.integration.spec.part-03.ts.md) | `apps/platform/test/database/unit-of-work.integration.spec.ts` | 4/5 | 13232 | 388 | `9ECB0FD8AFB38213F58889C7045C5276B0D8DE62FA125C1E476D6D74E3B08414` |
| [05-unit-of-work.integration.spec.part-04.ts.md](05-unit-of-work.integration.spec.part-04.ts.md) | `apps/platform/test/database/unit-of-work.integration.spec.ts` | 5/5 | 21282 | 154 | `BDD8442A2F91ECFB7363C38AE46060279417B7E3ED9A1907B7F47C0B2ECC64C7` |
| [06-database.ts.md](06-database.ts.md) | `apps/platform/src/infrastructure/database/database.ts` | 1/1 | 14767 | 474 | `455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C` |
| [07-transaction-context.ts.md](07-transaction-context.ts.md) | `apps/platform/src/infrastructure/database/transaction-context.ts` | 1/1 | 5511 | 220 | `CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C` |

## Integration spec exact concatenation

The future `apps/platform/test/database/unit-of-work.integration.spec.ts` is reconstructed in this exact order:

1. [03-unit-of-work.spec.ts.md](03-unit-of-work.spec.ts.md)
2. [05-unit-of-work.integration.spec.part-01.ts.md](05-unit-of-work.integration.spec.part-01.ts.md)
3. [05-unit-of-work.integration.spec.part-02.ts.md](05-unit-of-work.integration.spec.part-02.ts.md)
4. [05-unit-of-work.integration.spec.part-03.ts.md](05-unit-of-work.integration.spec.part-03.ts.md)
5. [05-unit-of-work.integration.spec.part-04.ts.md](05-unit-of-work.integration.spec.part-04.ts.md)

Concatenated result: 113197 bytes, 3091 lines, SHA-256 `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789`.

## Extraction contract

For each fragment, extract the UTF-8 text inside the single `XHT-CANONICAL-BEGIN/END` fenced block, append exactly one LF omitted by the Markdown closing-fence delimiter, and concatenate by the sequence above. Do not normalize code bytes, indentation, quotes or line endings.
