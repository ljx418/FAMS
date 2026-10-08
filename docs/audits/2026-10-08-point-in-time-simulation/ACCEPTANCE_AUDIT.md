# WF-8 冻结策略逐时点模拟验收审计

日期：2026-10-08

## 1. 结论

```text
automatedAcceptance=PASS
prdSpecificationReview=PASS
realDataAcceptance=PASS
concentratedHumanAcceptance=PENDING
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

WF-8 已完成文档支持范围内的工程实现与自动验收。该结论只表示冻结策略研究回放可用，
不表示历史当时已部署该策略，不表示正式交易或自动交易放行。

## 2. 真实数据证据

- 冻结策略：真实 `StrategyVersion`，schema 为 `fams.grid-strategy.v2`。
- 标的：恒瑞医药 `600276`。
- 日线：149 个真实交易日，来源为 Sina / Eastmoney canonical OHLC。
- 实际成交：本地账本中的 40 条真实成交。
- 模拟事件：冻结网格策略逐日产生 6 条成交事件。
- 三场景共轴：按冻结策略执行、不执行建议、实际成交流水均为 149 个日期点。
- 账户保护：验收前后 Position / Transaction / Advice / GridPlan / StrategyVersion 摘要哈希一致。

机器证据见私有审计目录：

```text
docs/automation-audits/investment-workflow/WF-8/evidence/
  point-in-time-simulation-audit.json
  point-in-time-ui-audit.json
  point-in-time-desktop.png
  point-in-time-mobile.png
```

## 3. 自动门禁结果

| 门禁 | 结果 | 证据 |
|---|---|---|
| 当日可见数据边界 | PASS | 每条 decision 的 `visibleThrough <= decisionDate` |
| 未来数据不变性 | PASS | 追加真实后续 K 线后，原区间决策和曲线不变 |
| 确定性 | PASS | 相同输入、策略版本和费用模型产生相同摘要 |
| 三场景共轴 | PASS | 三条曲线日期轴一致 |
| 真实成交口径 | PASS | actual 场景读取本地确认成交，不生成交易事实 |
| 只读保护 | PASS | 受保护账户事实摘要不变 |
| 桌面 UI | PASS | 1440px 截图、控制台错误 0、失败 HTTP 0 |
| 移动 UI | PASS | 390px 侧栏折叠、无水平溢出 |
| 交易边界 | PASS | 四项交易能力全部保持 false |

执行命令：

```bash
cd backend
npm run build
npm run test:investment-workflow-point-in-time
npm run test:investment-workflow-scenario-comparison
npm run test:investment-workflow-point-in-time-ui

cd ../frontend
npm run build
```

## 4. 失败与重规划记录

首次截图复核发现历史未读的券商复盘提醒会批量堆叠，遮挡回测曲线，因此该轮 UI 证据被打回。
修复方式不是在报告中裁掉遮挡区域，而是将全局提醒改为单例：一次只展示最新未见提醒，
并把同批历史提醒记为已见。之后重新执行桌面和移动端 headless 验收，通知清理断言、布局断言和
截图复核全部通过。

## 5. 残余边界

1. 日线无法判断同日内高低点先后，模拟采用已披露的保守 OHLC 路径假设，不声称逐笔精度。
2. 当前冻结版本晚于部分回测日期，界面明确显示“当前策略回套历史”。
3. 没有冻结版本的 Advice 继续返回 `frozen_strategy_version_required_for_point_in_time_simulation`。
4. 集中人工体验在所有自动开发完成后统一执行，不影响本子阶段工程退出，但会阻断 PRD 完成声明。

