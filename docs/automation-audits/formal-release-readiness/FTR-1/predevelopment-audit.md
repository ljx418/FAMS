# FTR-1 开发前审计

日期：2026-08-21  
最终结论：`ENTRY_BLOCKED/formal_provider_authorization`

## 入口条件核对

| 条件 | 当前状态 | 证据 |
| --- | --- | --- |
| FTR-0 passed | PASS | `FTR-0/acceptance-audit.md` |
| release candidate 固定 | PASS（工程合同） | `PortfolioBacktestInputBuilder` 冻结具体策略 ID/版本；manifest 负向合同通过 |
| provider authorization owner identified | BLOCKED | 仓库、权威状态和现有 artifact 未发现可用 owner/授权记录 |

## 工程与业务状态分离

- `FormalDataProviderService`、`FormalDataFreshnessPolicy`、`FieldEvidenceValidator`、Prisma authorization model 与 artifact schema 已实现。
- 工程测试中的 `data.reviewer@example.test`、test-only license review 和 memory store 仅是负向/正向合同夹具，禁止作为真实授权证据。
- `test:fams-data-governance` 即使退出 0，也允许并预计返回业务 `status=blocked`；必须读取 blocker。

## 风险意见

- 致命防虚假验收约束：自动化不得自行写入 approved authorization 记录，不得猜测 owner，不得把配置 token 等同于授权许可。
- 重大入口缺口：真实 provider 授权 owner/authorizationRef/evidenceRefs 未识别。
- 允许操作：执行 manifest 诊断命令、只读计数与脱敏状态检查、落盘阻断审计。
- 禁止操作：追加授权、配置或输出密钥、把 free source 提升为 official、进入 FTR-2。

诊断确认：Prisma 中 `tushare_pro` authorization 记录为 0；脱敏状态为 `credentialConfigured=false`，blocker 为 `provider_authorization_missing`、`formal_provider_credential_missing`。在入口缺口被真实证据关闭前，不允许 FTR-1 实质开发或业务出门。
