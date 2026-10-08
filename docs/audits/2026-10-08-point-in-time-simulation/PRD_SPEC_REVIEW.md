# WF-8 PRD 规格检视

日期：2026-10-08

## 1. 对照结论

`INVESTMENT_WORKFLOW_UX_PRD.md` 第 74 条要求：

```text
point_in_time_simulation：使用冻结策略版本和当日可见数据逐日重放，禁止未来数据泄漏。
```

本轮实现满足该规格，未发现 Fatal 或 Major 偏差。

```text
fatalSpecificationDeviation=0
majorSpecificationDeviation=0
unsupportedClaimFound=false
staticReplayMasqueradingAsDynamic=false
futureDataLeakageDetected=false
```

## 2. 规格到实现映射

| PRD 要求 | 实现实体 | 验收 |
|---|---|---|
| 冻结策略版本 | `StrategyVersion` + `pointInTimeGridSimulation.ts` | 仅接受 `fams.grid-strategy.v2` |
| 当日可见数据 | `dailyDecisions[].visibleThrough` | 逐条边界断言通过 |
| 禁止未来泄漏 | 真实后续 K 线追加不变性测试 | PASS |
| 真实行情 | `MarketBarCanonical` | Sina / Eastmoney 149 日 |
| 建议/不执行/实仓比较 | `ScenarioComparisonService.compareGridPointInTime` | 三场景共轴 PASS |
| 历史口径披露 | `historicalPolicyApplication` + UI 警告 | PASS |
| 用户可见入口 | `Backtest.tsx` 冻结策略与逐日模拟选择器 | 桌面/移动证据 PASS |
| 不创建交易 | route/service 响应四锁 + 只读摘要 | PASS |

## 3. 不扩大的范围

- 未将无 `strategyVersionId` 的历史 Advice 自动推导成冻结策略。
- 未把日线模拟描述为逐笔成交回放。
- 未支持未登记的策略 schema。
- 未把研究场景表现转换成下单或正式交易资格。

## 4. 阶段判定

WF-8 可以退出并进入后续自动化总体验收。投资工作流的工程自动覆盖由 `18/20` 更新为
`19/20`；剩余一项是集中人工体验，不是新的代码缺口。只有该人工项完成后才允许声明投资工作流
PRD `20/20`，且该声明仍不等于正式交易 release。

