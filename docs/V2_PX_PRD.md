# V2-PX External Brain Productization PRD

更新时间：2026-08-27

## 1. 阶段定位

V2-PX 目标是把 External Brain 产品化为可被真实 Chrome 验证、可审计、可回放、可人工核查的浏览器扩展体验。PX-0 文档与 anti-false-green 合同已经完成；真实浏览器能力仍从 PX-1 开始实现和验证。

```text
px0GithubReviewGate=PASS
px1PlanningAllowed=true
px1CodeSpikeAllowed=false
px1FeasibilitySpikeEligible=true
px2PlusAllowed=false
v2PxComplete=NO_GO
```

## 2. 权威状态

本文是 V2-PX 当前权威 PRD。以下权威字段已由 `V2_PX_AUTHORITY_BASELINE.md` 冻结：

```text
productId
repository
branch
commitSha
hostApplication
extensionPackage
```

基线 SHA 为 `6e5fd81157c8eec081637b901351465332617f98`。字段冻结只关闭 PX-0 文档门禁，不代表 PX-1 原型符合 PRD。

## 3. 用户目标

用户应能从浏览器扩展轻入口、独立 Workspace Page 和 host app 三处进入 External Brain，对同一知识任务执行查看来源、打开工作台和在工作台中打开等动作，并能在真实 Chrome 中追溯路由、生命周期、证据和恢复状态。

## 4. 需求列表

| ID | 需求 | 用户价值 | 验收口径 |
| --- | --- | --- | --- |
| PX-REQ-001 | 三入口容器 | 用户可从 sidepanel、Workspace Page、host app 进入 | `entryContainer=sidepanel/workspace_page/host_app` 均有证据 |
| PX-REQ-002 | 三类用户动作 | 用户可查看来源、打开工作台、在工作台中打开 | `entryAction=view_source/open_workspace/open_in_workspace` 均有证据 |
| PX-REQ-003 | 五类 route intent | 用户可进入来源库、来源详情、问答、追踪和图谱 | `source_library/source_detail/ask/trace/graph` 均有真实路径 |
| PX-REQ-004 | Side Panel 轻入口 | Side Panel 不承载完整主体验，只做轻入口和状态提示 | 420/360px 视口下可用，不出现主工作台挤压 |
| PX-REQ-005 | Workspace Page 完整宿主 | Workspace Page 承载完整 External Brain 主体验 | 1280/768px 视口下可用，刷新后可恢复 |
| PX-REQ-006 | 标签页复用 | 重复打开同一任务时复用或聚焦正确标签页 | 多窗口、多标签 trace 可证明 |
| PX-REQ-007 | 刷新与恢复 | Back/Forward/Refresh/关闭重开后状态可恢复 | lifecycle/recovery audit 通过 |
| PX-REQ-008 | Runtime offline/reconnect | background、sidepanel、workspace 断连后可重连 | reconnect event 与恢复结果可证明 |
| PX-REQ-009 | 幂等与重复 ingest | 重复 ingest 不产生重复副作用 | operation command 使用 idempotencyKey |
| PX-REQ-010 | 真实 Chrome 证据 | 验收必须来自真实 Chrome，不接受静态 mock | screenshot/trace/hash/URL/extensionId 可验证 |
| PX-REQ-011 | 四类 viewport | 420、360、768、1280px 均可用 | 每个 viewport 有截图和检查结果 |
| PX-REQ-012 | 隐私与证据脱敏 | 审计证据不泄露密钥、cookie、隐私文本 | evidence artifact 通过脱敏检查 |

## 5. 非目标

```text
PX-0 不交付生产 Workspace Page
PX-0 不交付生产 Side Panel
PX-0 不交付生产 background router
PX-0 不声明真实 Chrome evidence passed
PX-0 不声明 V2-PX complete
```

## 6. PX-0 出门结果

PX-0 已建立：

```text
requirementId -> planned prototype element -> architecture entity -> schema -> semantic validator -> fixture -> planned evidence -> human review item
```

真实 implementation file、Chrome evidence 与 human review 属于 PX-1 及以后，因此：

```text
px0ContractTraceability=PASS
prototypePrdAlignment=NOT_TESTABLE_UNTIL_PX1
realChromeEvidencePresent=false
```
