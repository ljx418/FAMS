# V2-PX PRD Traceability Matrix

更新时间：2026-08-27

## 1. 当前结论

```text
traceabilityMatrixReady=PX0_CONTRACT_READY
prototypePrdAlignment=NOT_TESTABLE_UNTIL_PX1
px1CodeSpikeAllowed=false
px1FeasibilitySpikeEligible=true
```

本文件用于把 PRD requirement 映射到架构实体、原型元素、schema、测试、证据和人工复核项。当前仍是文档级矩阵，不代表实现完成。

## 2. 追踪矩阵

| Requirement | Prototype Element | Architecture Entity | Contract / Schema | Planned Test | Evidence Artifact | Human Review |
| --- | --- | --- | --- | --- | --- | --- |
| PX-REQ-001 三入口容器 | sidepanel / workspace / host app 入口图 | sidepanel, Workspace Page, host app bridge | `v2-px-intent-route.schema.json` | PX-0: `test:v2-px-semantic-contract`; PX-1: `test:v2-px-intent-route` | PX-0 fixture result；PX-1 route scenario result | 三入口是否真实可见 |
| PX-REQ-002 三类用户动作 | 查看来源 / 打开工作台 / 在工作台中打开 | entry action handler | `entryAction` enum | `test:v2-px-entry-action-matrix` | action matrix audit | 用户动作是否语义清晰 |
| PX-REQ-003 五类 route intent | source library/detail/ask/trace/graph 页面 | PX intent router | `routeIntent` enum | `test:v2-px-route-intent-matrix` | route intent audit | 五类 intent 是否覆盖 PRD |
| PX-REQ-004 Side Panel 轻入口 | 420/360 sidepanel 设计 | sidepanel shell | real Chrome evidence schema | `test:v2-px-sidepanel-entry` | sidepanel screenshots | 是否轻入口而非完整主体验 |
| PX-REQ-005 Workspace Page | 1280/768 workspace 设计 | Workspace Page host | lifecycle + evidence schema | `test:v2-px-workspace-host` | workspace screenshots | 是否完整承载主体验 |
| PX-REQ-006 标签页复用 | tab reuse journey | background router | operation/route command | `test:v2-px-tab-reuse` | tab trace audit | 多窗口复用是否正确 |
| PX-REQ-007 刷新恢复 | reload/reopen journey | state restore module | lifecycle schema | `test:v2-px-recovery` | recovery audit | 刷新后状态是否一致 |
| PX-REQ-008 reconnect | offline/reconnect journey | background + container ports | lifecycle schema | `test:v2-px-reconnect` | reconnect event log | 断连恢复是否可信 |
| PX-REQ-009 幂等 ingest | duplicate ingest journey | PX operation command handler | `v2-px-operation-command.schema.json` | PX-0: semantic negative fixture；PX-1: `test:v2-px-idempotency` | idempotency contract result / audit | 重复提交是否去重 |
| PX-REQ-010 真实 Chrome | evidence review page | evidence collector | real Chrome evidence schema | `test:v2-px-real-chrome-evidence` | screenshots + trace | 是否排除 mock |
| PX-REQ-011 四类 viewport | 420/360/768/1280 设计 | responsive shell | evidence schema | `test:v2-px-viewports` | viewport screenshots | 是否无遮挡/溢出 |
| PX-REQ-012 隐私脱敏 | evidence redaction view | artifact sanitizer | acceptance manifest schema | `test:v2-px-evidence-redaction` | redaction audit | 是否无密钥/cookie |

## 3. 当前阻断

```text
prototypeIncrementPresent=px0_contract_fixtures_only
realChromeEvidencePresent=false
semanticValidatorImplemented=true
implementationFileMappingMissing=true
px0AutomatedContractTestImplemented=true
px1BrowserTestsNotImplemented=true
```

PX-0 已建立 `requirement -> schema -> semantic validator -> fixture` 的合同链路。`prototype element -> production implementation file -> real Chrome evidence -> human review` 属于 PX-1 及以后，仍不得标记完成。
