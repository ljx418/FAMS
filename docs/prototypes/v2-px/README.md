# V2-PX Prototype Evidence 说明

更新时间：2026-08-27

## 当前状态

```text
prototypeIncrementPresent=documentation_stub_only
realChromeEvidencePresent=false
legacyMockEvidenceAllowedForPxAcceptance=false
px0GithubReviewGate=PASS
prototypePrdAlignment=NOT_TESTABLE_UNTIL_PX1
prototypeInteractionCoverage=FAIL
semanticValidatorImplemented=true
antiFalseGreenAcceptanceContractPassed=true
```

本目录用于承载 V2-PX External Brain Productization 的原型增量、合同 fixture、真实 Chrome 验收证据和 anti-false-green 说明。`fixtures/` 已提供 PX-0 结构与语义合同正反例，但还没有 PX-1 浏览器原型，不能作为真实 Chrome 或 V2-PX 完成证据。

## PX-0 fixture

运行：

```bash
npm --prefix backend run test:v2-px-semantic-contract
```

当前 fixture 覆盖 unknown intent、入口来源矛盾、secret-like 字段、假 Chrome URL、文件缺失、哈希不一致、生命周期乱序、PX-2 越级和幂等冲突。正例仅是合同数据，不包含或冒充生产证据。

## 后续必须补齐的原型范围

1. 入口容器：
   - sidepanel 入口。
   - Workspace Page 独立入口。
   - host app 跳转入口。
2. 用户动作：
   - 查看来源。
   - 打开工作台。
   - 在工作台中打开。
3. route intent：
   - `source_library`
   - `source_detail`
   - `ask`
   - `trace`
   - `graph`
4. 状态矩阵：
   - 正常。
   - 加载。
   - 空状态。
   - 失败。
   - 恢复。
5. 视口：
   - 420px sidepanel。
   - 360px 窄屏。
   - 768px tablet / workspace。
   - 1280px desktop / workspace。
6. 路由 intent 原型：
   - 同一任务从三入口进入同一 `routeId / correlationId`。
   - `entryContainer / entryAction / routeIntent / targetContainer / routePayload` 通过 `v2-px-intent-route.schema.json` 校验。
7. 双容器生命周期原型：
   - sidepanel start/resume/close。
   - Workspace Page start/resume/close。
   - sidepanel/workspace reconnect。
   - background route/reconnect/blocked。
8. 真实 Chrome 证据：
   - 桌面 Chrome 截图。
   - trace refs。
   - lifecycle event log。

## 不得作为验收证据

```text
static mock HTML screenshot
unversioned design image
manual-only screenshot without Chrome trace
prototype image without lifecycle event log
```

## PX-1 原型出门门槛

```text
entryContainerMatrixComplete=true
entryActionMatrixComplete=true
routeIntentMatrixComplete=true
targetContainerMatrixComplete=true
stateMatrixComplete=true
viewportMatrixComplete=true
sameIntentRouteIdAcrossEntries=true
dualContainerLifecycleEventsCaptured=true
realChromeScreenshotsPresent=true
realChromeTracePresent=true
antiFalseGreenContractPassed=true
```

当前上述字段均不得声明为 true。当前目录仅是 PX-0 文档修复占位，不能证明原型符合 PRD。
