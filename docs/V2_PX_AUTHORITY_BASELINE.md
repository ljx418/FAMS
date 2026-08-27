# V2-PX 权威产品与代码仓基线

更新时间：2026-08-27

## 1. 当前结论

```text
authorityBaselineStatus=FROZEN
fatalDocumentationBaselineIssueCount=0
px0GithubReviewGate=PASS
px1CodeSpikeAllowed=false
px1FeasibilitySpikeEligible=true
```

V2-PX 的产品归属已经确定为 FAMS。PX-0 基线提交的 40 位 Git SHA 已完成回填。Route A 可以进入受限 feasibility spike 的启动评审，但本次未开始 PX-1，也未创建扩展生产包。

```text
observedLocalRepository=https://github.com/ljx418/FAMS.git
observedLocalBranch=main
observedIntegrationBranch=codex/daily-review-v1-2-closure
```

Navia/mercury 不再是本仓库 V2-PX 的候选权威归属。历史文档中的相关名称只用于说明已关闭的歧义，不得进入 schema、fixture、包名或验收报告。

## 2. 必须冻结的权威字段

以下字段已经冻结；`commitSha` 指向包含 PX-0 schema、semantic validator 与 fixtures 的基线提交：

```json
{
  "productId": "fams-v2-px",
  "productName": "FAMS External Brain",
  "repository": "https://github.com/ljx418/FAMS.git",
  "branch": "main",
  "commitSha": "6e5fd81157c8eec081637b901351465332617f98",
  "hostApplication": "FAMS",
  "extensionPackage": "packages/fams-v2-px-extension",
  "workspacePageEntrypoint": "packages/fams-v2-px-extension/entrypoints/workspace/index.html",
  "sidepanelEntrypoint": "packages/fams-v2-px-extension/entrypoints/sidepanel/index.html",
  "backgroundEntrypoint": "packages/fams-v2-px-extension/entrypoints/background.ts"
}
```

这三个 entrypoint 是 PX-1 spike 的冻结目标路径，在 PX-0 中不创建生产包，也不表示文件已经存在。

## 3. 已选择的权威归属

注意：本节的权威归属选项不是 ADR 中的 Route A。ADR Route A 特指“独立 Workspace Page + sidepanel/background”架构路线。

选择 Authority Option FAMS：

```text
productId=fams-v2-px
repository=https://github.com/ljx418/FAMS.git
hostApplication=FAMS
```

PX 核心浏览器合同不内置投资交易 gate；交易边界继续由 FAMS domain adapter 的外层 policy 执行。

## 4. SHA 封印规则

为避免文档自引用导致 SHA 永远变化，采用两次提交：

```text
Commit 1: 提交 PX-0 schema、semantic validator、fixtures 与待封印权威基线
Commit 2: 将 Commit 1 的 40 位 SHA 写入 commitSha，并把状态切换到 FROZEN / ACCEPTED_FOR_SPIKE
```

`commitSha` 始终指向 Commit 1；Commit 2 是只包含封印字段和阶段状态的 seal commit。

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

SHA seal 完成后：

```text
px0GithubReviewGate=PASS
px1CodeSpikeAllowed=false
px1FeasibilitySpikeEligible=true
```

`px1CodeSpikeAllowed=false` 表示本次实现停在 PX-0，仍需单独启动 PX-1；它不否定 Route A 已达到 `ACCEPTED_FOR_SPIKE`。
