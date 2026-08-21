# V2-PX 权威产品与代码仓基线

更新时间：2026-07-15

## 1. 当前结论

```text
authorityBaselineStatus=UNRESOLVED
fatalDocumentationBaselineIssueCount=1
px0GithubReviewGate=FAIL
px1CodeSpikeAllowed=false
```

当前 V2-PX 文档使用了 External Brain / WXT / sidepanel / Workspace Page / background / 双容器 Chrome 等产品化概念，但现有工作目录和远端信息显示当前本地仓库为 FAMS：

```text
observedLocalRepository=https://github.com/ljx418/FAMS.git
observedLocalBranch=main
observedLocalCommit=c6aacc47c197706a69cf7ed6ea6bc5e00a8fda60
```

外部审计指出可能存在 Navia/mercury 与 FAMS 的权威基线混用。该问题必须在 PX-0 内关闭，否则不得进入 PX-1 代码 spike。

## 2. 必须冻结的权威字段

PX-0 出门前必须由项目负责人明确以下字段：

```json
{
  "productId": "",
  "productName": "",
  "repository": "",
  "branch": "",
  "commitSha": "",
  "hostApplication": "",
  "extensionPackage": "",
  "workspacePageEntrypoint": "",
  "sidepanelEntrypoint": "",
  "backgroundEntrypoint": ""
}
```

## 3. 两种可接受权威归属选项

注意：本节的权威归属选项不是 ADR 中的 Route A。ADR Route A 特指“独立 Workspace Page + sidepanel/background”架构路线。

### Authority Option FAMS

如果 V2-PX 属于 FAMS，则必须冻结：

```text
productId=fams-v2-px
repository=https://github.com/ljx418/FAMS.git
hostApplication=FAMS
```

并允许在 PX 合同中保留 FAMS 领域术语。但 PX 核心浏览器合同仍不得把投资交易 gate 写成核心字段；交易边界应作为 FAMS domain adapter 的外层 policy，而不是 `intent route` 的基础 schema。

### Authority Option Navia / Mercury

如果 V2-PX 属于 Navia/mercury，则必须：

```text
productId=navia-v2-px 或 mercury-v2-px
repository=<Navia/mercury 权威仓库>
hostApplication=<Navia/mercury host app>
```

并从 PX 核心合同中移除 FAMS namespace、投资建议和交易权限字段。

## 4. 当前处理

在权威基线未冻结前，PX 文档采用中立 PX 合同：

```text
PX core schema 不再内置 notTradingAdvice / ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
FAMS 交易边界只保留在 FAMS adapter / release gate 文档中
Route A 仍为 proposed，不得宣称 accepted / frozen
```

## 5. 状态推进顺序

为避免循环门禁，PX-0 使用以下顺序推进：

```text
Step 1 authorityBaselineStatus=FROZEN
Step 2 routeAAdrStatus=ACCEPTED_FOR_SPIKE
Step 3 routeAAdrStatus=TECHNICALLY_VALIDATED after PX-1
Step 4 routeAAdrStatus=PRODUCTION_APPROVED before PX-2+ production implementation
```

`authorityBaselineStatus=FROZEN` 不依赖 Route A ADR 已接受；它只冻结产品、仓库、branch、commit 和宿主。

## 6. 出门门槛

```text
authorityBaselineStatus=FROZEN
productId 非空
repository 非空
branch 非空
commitSha 为 40 位 Git SHA
hostApplication 非空
extensionPackage 非空
```

未满足时：

```text
px0GithubReviewGate=FAIL
px1CodeSpikeAllowed=false
```
