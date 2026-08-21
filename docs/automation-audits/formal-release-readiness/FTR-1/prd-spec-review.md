# FTR-1 规格检视

日期：2026-08-21  
结论：`BLOCKED`  
打回阶段：`FTR-1 entry`

| 规格门禁 | 结果 | 说明 |
| --- | --- | --- |
| FTR-0 passed | PASS | FTR-0 基线冻结已通过。 |
| provider authorization owner identified | BLOCKED | 无 owner、无 authorization record、无 authorizationRef/evidenceRefs。 |
| release candidate IDs fixed | PASS（工程） | 具体策略 ID 与版本在构建后冻结，模板占位符不会进入候选集。 |
| noCriticalProviderUnknown | NOT PROVEN | 没有可用正式 provider snapshot。 |
| criticalFieldsHaveEvidenceRefs | FAIL | 4 个 dividend 关键项 evidenceRefs 为空。 |
| noCriticalFreshnessUnknownOrStale | FAIL | 4 个 dividend 关键项 freshness unknown。 |
| noCriticalCoverageBlocked | FAIL | 4 个 dividend 关键项 coverage 0/blocked。 |
| researchFallbackPromotedToFormal=false | PASS | 免费/研究源未提升为正式源。 |
| formalDataGovernancePassed=true | FAIL | artifact 业务状态 blocked。 |

致命规格偏差 0；重大实现偏差 0；未满足的外部/业务 gate 1 组。工程实现没有虚假判绿风险，原因是 artifact 明确保留所有 blocker。

FTR-1 不满足出门标准，禁止进入 FTR-2。需要人类提供正式 provider 授权 owner、可审计授权引用/范围/有效期/证据，以及通过安全渠道配置的 provider credential，随后从 FTR-1 入口重新审计。
