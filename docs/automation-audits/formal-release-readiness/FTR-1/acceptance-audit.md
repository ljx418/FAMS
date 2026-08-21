# FTR-1 入口诊断验收审计

日期：2026-08-21  
工程合同：`PASS`  
业务阶段：`BLOCKED_AT_ENTRY`  
出门结论：`NOT_ACCEPTED`

## Manifest 命令

- `npm run test:fams-data-governance`：exit 0；工程合同、secret 隔离及 missing/stale/tampered 负向夹具通过，但真实 data governance artifact 状态为 `blocked`。
- `npm run test:portfolio-asset-sample-revalidation`：exit 0；隔离审计账户 3 个样例持仓使用真实 canonical bars，Excel 三个 sheet 和 120 点组合回测通过；release gate 仍 `blocked`，四项交易锁 false。

## 真实入口证据

```text
provider=tushare_pro
authorizationRecordCount=0
authorizationStatus=blocked
credentialConfigured=false
credentialPersisted=false
blockers=provider_authorization_missing,formal_provider_credential_missing
```

最新 `15_data_governance_audit.json` 状态为 `blocked`，28 个字段项中 4 个 dividend 关键项为 freshness unknown、coverage blocked、coveragePercent=0、evidenceRefs 为空；这些缺口不能由 price/benchmark/tradeability 的较高覆盖率抵消。

## 证据路径

- `backend/data/gpt-audit/next-stage-automation/2026-08-20T17-07-23-036Z/15_data_governance_audit.json`
- `backend/data/gpt-audit/next-stage-automation/2026-08-20T17-07-23-036Z/data_source_audit.json`
- `backend/data/gpt-audit/next-stage-automation/2026-08-20T17-07-23-036Z/provider_freshness_audit.json`
- `backend/data/gpt-audit/next-stage-automation/2026-08-20T17-07-46-012Z/01_portfolio_asset_sample_revalidation_audit.json`

注意：审计账户持仓是隔离样例，行情为真实本地 canonical 数据；它验证工程链路，不是正式 provider 授权证据，也不替代用户真实账户。

本次没有追加授权记录、配置或输出密钥、修改真实用户持仓、创建订单或改变交易权限。
