# FIVD-R Phase 16：Asset Identity Remediation 开发、验收与审计

版本：v0.1  
日期：2026-06-02  
阶段目标：把 `asset_identity_missing` 从 remediation plan 的 `planned` 推进为可执行、可审计的研究身份解析动作，但不污染正式资产账本，不伪造完整事实集，不放行交易动作。

## 1. PRD 对齐

总 PRD 要求 FIVD-R 对外只有一套入口，候选研究必须具备结构化输出、evidenceRefs、可复现 runId，并且 Validation Evidence 未通过时禁止 `ADD / REDUCE / AUTO_TRADE`。

本阶段只解决一个明确缺口：

```text
候选或持仓研究中出现 asset_identity_missing 时，系统应能生成可审计的 identity remediation artifact。
```

本阶段不做：

- 自动创建正式资产。
- 自动创建持仓。
- 伪造完整资产事实集。
- 将 lightweight research identity 误称为正式 asset identity。
- 放行 manual trade draft、ADD、REDUCE、AUTO_TRADE。

## 2. 开发计划

### 2.1 后端能力

新增或扩展：

```text
backend/src/services/analysis/analysisService.ts
backend/src/services/analysis/dataGapRemediationService.ts
backend/src/routes/analysis.ts
```

新增 FIVD-R identity remediation 动作：

```text
actionId=resolve_asset_identity
operationType=fivd_r_asset_identity_resolution
```

新增 API：

```text
POST /api/v1/analysis/fivd-r/asset-identity-resolution
```

输入：

```ts
{
  userId?: string
  symbols?: string[]
  gaps?: DataGap[]
  sourceRunId?: string | null
}
```

输出 artifact：

```text
asset_identity_resolution_report.json
```

报告必须包含：

```text
schemaVersion=fivd.r.asset_identity_resolution_report.v1
runId
sourceRunId
resolvedCount
unresolvedCount
identities[]
blockedReasons[]
prohibitedActions=["ADD","REDUCE","AUTO_TRADE"]
auditOpinion
```

### 2.2 Remediation 集成

`dataGapRemediationService` 中：

- `asset_identity` gap 从 `planned` 改为 `executable`。
- 执行 API 能启动 identity resolution report。
- 如果 symbol 为空，仍保持 `planned`，要求先补 symbol。

### 2.3 前端能力

Analysis 页现有 Data Gap Remediation 面板无需新增大结构，只需要能展示：

- `resolve_asset_identity`
- `operationType=fivd_r_asset_identity_resolution`
- executable / planned 状态

## 3. 验收标准

后端验收：

1. `asset_identity_missing` gap 能生成 `resolve_asset_identity` remediation action。
2. 有 symbol 时 action 状态为 `executable`。
3. 无 symbol 时 action 状态为 `planned`。
4. 执行后生成 `fivd.r.asset_identity_resolution_report.v1`。
5. report 中每个 identity 必须包含：
   - `symbol`
   - `assetType`
   - `market`
   - `confidenceScore`
   - `resolved`
   - `lightweightResearchIdentity`
   - `evidenceRefs`
   - `warnings`
6. report 不写正式 `Asset`，除非已有本地匹配。
7. report 禁止 `ADD / REDUCE / AUTO_TRADE`。

前端验收：

1. `npm run build` 通过。
2. Data Gap Remediation 面板能展示 `resolve_asset_identity` 可执行动作。
3. 执行后显示已启动 operation/audit id。
4. 页面不把 identity remediation 展示为交易放行。

真实数据验收：

1. 使用真实本地候选/真实 symbol 执行至少一个 identity remediation。
2. 使用一个受控未知 symbol 验证 unresolved 分支。
3. 验证 output artifact 中 `prohibitedActions` 包含 `ADD / REDUCE / AUTO_TRADE`。
4. 验证 `test:trade-action-readiness` 仍按预期失败，blocker 仍为 `validation_evidence`。

## 4. 验收命令

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:fivd-r-asset-identity-remediation
npm run test:fivd-r-data-gap-remediation
npm run test:fivd-r-core
npm run test:fivd-r-trade-gate-contract
npm run test:production-readiness
npm run test:trade-action-readiness
```

```bash
cd frontend
npm run build
```

预期：

- 除 `test:trade-action-readiness` 外均通过。
- `test:trade-action-readiness` 在真实 validation evidence 未通过时继续失败。

## 5. 审计意见

致命风险：无。

重大规格偏差风险：无。

一般风险：

1. 用户可能误解 lightweight research identity 为正式资产入账。
   - 闭环：report 字段必须显式区分 `matchedAsset` 与 `lightweightResearchIdentity`。
2. 资产身份解析可能基于代码规则产生高置信但不完整的研究身份。
   - 闭环：保留 `confidenceScore`、`warnings` 和 evidenceRefs，不写正式账本。
3. identity remediation 被误用为交易可用前置。
   - 闭环：report 固定禁止 `ADD / REDUCE / AUTO_TRADE`，trade gate contract 继续验证。

审计结论：

```text
允许进入实质开发。
本阶段仅闭环 asset identity research remediation，不改变 validation evidence gate，不放行交易动作。
```
