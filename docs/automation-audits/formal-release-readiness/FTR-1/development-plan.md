# FTR-1 详细开发与验收计划：正式数据授权治理

日期：2026-08-21  
状态：`BLOCKED_AT_ENTRY`

## 目标

把明确 release candidate 的研究/免费源数据升级为字段级可授权、可追溯、可判定的正式数据证据，并满足 `FORMAL_DATA_GOVERNANCE_CONTRACT.md`。工程服务已经存在，本阶段剩余关键工作是取得真实 provider 授权、凭据和 data owner 复核，不重写已有服务。

## 入口标准

1. FTR-0 已通过。
2. provider authorization owner 已识别并可提供不可伪造授权引用。
3. `releaseCandidateStrategyIds` 和版本在运行前冻结；排除项有理由。

## 允许的入口诊断

- 只读查询当前 FormalProviderAuthorization 记录和脱敏 credential 状态。
- `npm run test:fams-data-governance`：验证真实回测 data governance artifact 与工程负向合同；命令退出 0 不代表业务 gate 通过。
- `npm run test:portfolio-asset-sample-revalidation`：使用隔离审计账户和真实本地行情验证资产/Excel/回测路径，不改变真实用户持仓。

## 业务出门标准

```text
providerAuthorizationVerified=true
criticalFieldsHaveEvidenceRefs=true
noCriticalProviderUnknown=true
noCriticalFreshnessUnknownOrStale=true
noCriticalCoverageBlocked=true
researchFallbackPromotedToFormal=false
formalDataGovernancePassed=true
```

并要求 `provider_authorization_audit.json`、`field_evidence_validation_audit.json`、`15_data_governance_audit.json` 与 schema 一致，任何 credential 只报告 configured/missing，不得落盘或输出明文。

## 停止条件

若 authorization owner、授权证据或 credential 缺失，FTR-1 必须以 `ENTRY_BLOCKED/formal_provider_authorization` 停止；不得用 test-only reviewer、伪造 licenseRef、免费源或研究缓存替代，不得进入 FTR-2。
