# WF-8 冻结策略逐时点模拟开发及验收计划

日期：2026-10-08

## 1. 目标与边界

本子阶段补齐 `INVESTMENT_WORKFLOW_UX_PRD.md` 第 74 条尚未实现的
`point_in_time_simulation`。实现只消费已冻结的 `StrategyVersion`、真实持仓快照、
本地真实成交流水和 `MarketBarCanonical` 日线，不创建或修改任何券商订单。

首个受支持合同为 `fams.grid-strategy.v2`。没有冻结策略版本的 Advice、未知策略版本、
缺少真实 OHLC 或无法核对期初资产的请求必须保持 `insufficient`，不得退化成保存建议回放。

## 2. 实现步骤

1. 新增纯函数逐时点引擎，按交易日只读取当日及此前可见的 OHLC。
2. 逐日维护固定网格的活动档位、父子单、暂停线、T+1、现金和持仓状态。
3. 在 `ScenarioComparisonService` 中接入带冻结版本的 `grid_plan`；保留无版本 Advice 的阻断。
4. 输出 `follow_advice / hold_without_action / actual_transactions` 共用日期轴的三条曲线。
5. 前端允许选择“保存建议回放 / 冻结策略逐日模拟”，并展示策略版本、口径和阻断原因。
6. 使用当前 SQLite 中真实策略版本、真实 K 线、真实持仓与成交流水做只读验收。

## 3. 自动验收门槛

- 真实 `fams.grid-strategy.v2` 版本和真实日线可生成逐日决策记录。
- 每条决策的 `visibleThrough` 不得晚于 `decisionDate`。
- 在原始历史之后追加未来 K 线，不得改变原历史区间内的决策和曲线。
- 策略版本配置哈希、输入快照哈希和行情证据引用必须落盘。
- 三个场景日期轴完全一致；实际成交仍使用本地已确认成交价。
- 无冻结版本、未知 schema、缺 OHLC 时必须 `insufficient` 并返回明确 blocker。
- 验收前后 Position、Transaction、Advice、GridPlan、StrategyVersion 数量及内容摘要不变。
- `formalTradingUnlocked / autoTradeUnlocked / canCreateOrder / orderCreateAllowed` 全部为 `false`。
- 后端 TypeScript、前端 build、专项测试和相关真实数据 E2E 全部通过。

## 4. 防假绿约束

- 禁止把 `saved_advice_replay` 重命名为逐时点模拟。
- 禁止用随机或手写价格 fixture 代替最终真实数据验收；纯函数负例可使用确定性 fixture。
- 禁止用策略生成时间证明历史当时已经存在该建议。若版本生成晚于回测起点，必须披露
  `historicalPolicyApplication=true`。
- 单日日线同时命中买卖档位且无法从日线判定先后时，必须采用已记录的保守路径假设并给出 warning。
- 本阶段仅完成研究回放，不改变正式交易和自动交易门禁。

## 5. 产物

- `backend/src/services/backtest/pointInTimeGridSimulation.ts`
- `backend/src/services/backtest/scenarioComparisonService.ts`
- `backend/scripts/verify-investment-workflow-point-in-time.ts`
- `frontend/src/pages/Backtest.tsx`
- `docs/automation-audits/investment-workflow/WF-8/evidence/point-in-time-simulation-audit.json`
- 本目录 `ACCEPTANCE_AUDIT.md` 与 `PRD_SPEC_REVIEW.md`

