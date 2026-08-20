# FAMS 交易边界合同

> 2026-07-16 下一阶段补充：`formalTradingReleaseReviewReady=true` 只表示人类 release 决策包完整，仍必须保持 `productionAdapterEnabled=false`、`formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false`。任何自动化流程不得把 review ready 升级为 production ready。

更新时间：2026-07-16

## 1. 目标

交易边界检查不能只依赖 `rg` 文本扫描。下一阶段每个子阶段都必须同时使用：

```text
AST/TypeScript 检查
JSON artifact 解析
API/runtime contract test
ChatBox 回复合同测试
前端按钮/文案扫描
```

## 2. Hard fail 字段

以下字段在当前阶段不得以正向状态出现：

```text
formalTradingUnlocked: true
autoTradeUnlocked: true
canCreateOrder: true
orderCreateAllowed: true
```

以下动作不得出现在允许动作中：

```text
ADD
REDUCE
ORDER_CREATE
AUTO_TRADE
```

## 3. 允许出现的负面语境

以下文本只能出现在禁止、阻断、非目标、hard fail、不得声明等语境中：

```text
formalTradingUnlocked 字段被置为 true
autoTradeUnlocked 字段被置为 true
canCreateOrder 字段被置为 true
orderCreateAllowed 字段被置为 true
ORDER_CREATE 被描述为 allowed
AUTO_TRADE 被描述为 allowed
```

## 4. 子阶段验收要求

每个 `substage_acceptance_manifest.json` 必须包含交易边界合同测试。仅有文本扫描不得视为通过。

最低测试范围：

```text
backend API response
backend generated audit JSON
frontend visible buttons and labels
ChatBox structured response
Operation artifact
SUMMARY_FOR_GPT.md
acceptance-report.html
```

## 5. 当前阶段结论

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
tradeBoundaryContractRequired=true
```
