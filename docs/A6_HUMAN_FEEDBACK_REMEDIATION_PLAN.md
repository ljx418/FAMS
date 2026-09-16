# A6 人工反馈整改开发及验收计划

## 1. 目标与基线

本阶段以人工验收草稿 `ftr6-provisional-26c7f6d0b02dac0c`、`sourceManifestSha256=7123317ed18c2852316e2b2f03f6dfe370f7158523e99dd8129bd0e068344201`、`revision=120` 为只读整改基线。

整改范围是普通用户体验、真实资产估值、建议选择、执行诊断、任务可恢复性、V2-PX 进入指引和 A6 渐进披露。不得修改用户账户事实，不得调低既有验收门槛，不得把研究或草案解释为正式交易能力。

## 2. 顺序与出门规则

| 阶段 | 目标体验 | 主要实现实体 | 真实验收 |
| --- | --- | --- | --- |
| R0 | 每条反馈均可追踪且旧反馈不可覆盖 | `humanAcceptanceDraftService`、整改映射 | 核对 package/hash/revision 与八项反馈 |
| R1 | 首次陈旧访问自动获得可信估值 | `positionService`、`operationService`、`Assets.tsx` | 当前真实持仓逐仓求和、12 小时 freshness、重复请求幂等 |
| R2 | ChatBox 能直接看持仓或经确认生成复盘 | `famsChatService`、`FamsChatBox.tsx` | 真实持仓摘要、确认卡、Operation、整页滚动 |
| R3 | 普通用户先看结论与下一步 | `DailyReviews.tsx`、`Backtest.tsx`、A6 HTML | 普通/专家模式、技术细节默认折叠、普通模式无图表 Slider |
| R4 | 用户通过摘要选择建议而非手输 ID | `analysisService`、`analysis.ts`、`Backtest.tsx` | 真实 Advice 只读目录、同花顺来源标识、回测同源 |
| R5 | 未执行原因可解释，不用虚假成交率 | Advice 执行诊断、回测详情 | 建议/可执行/触价/人工接受/记录分母及 insufficient |
| R6 | 任务中心区分历史失败与当前可用性 | `operationService`、`Operations.tsx`、LLM synthesis | 真实任务分组、核心结果与 LLM 增强分层、有限 provider 切换 |
| R7 | 人类无需查代码即可进入 V2-PX | A6 checklist、extension build 指引 | 构建、加载、Side Panel、Workspace、Host bridge 状态检查 |
| R8 | 新包承接整改结果且保留旧反馈 | provisional package、A6 context、验收报告 | 新 package/hash、桌面/平板/手机、真实数据、四项交易锁 |

每个阶段开始前必须落盘开发计划、验收标准和预开发审计；完成后必须落盘真实数据验收与 PRD 规格检视。若出现 Fatal/Major、新数据无法复核或交易边界漂移，则打回当前阶段。

## 3. 统一交易边界

阶段完成后仍必须保持：

```text
productionAdapterEnabled=false
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

禁止动作仍为 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE`。

## 4. 集中人工复验

自动化整改全部通过后才生成新 provisional package。旧 `revision=120` 作为历史反馈来源保留，不自动继承为新包的通过结论。人工须在新包上重新核验受影响项目，最终审核仍由人类完成。

## 5. 2026-09-15 自动化执行状态

R0-R8 已顺序实现并完成专项验收、PRD 规格检视和真实数据全系统 E2E。新 provisional package 为 `ftr6-provisional-99e13a74a10cbe47`，包含 28 项冻结源 artifact；新包反馈草稿从 revision 0 开始。旧包 `ftr6-provisional-26c7f6d0b02dac0c` 的 revision 120 反馈及 SHA-256 保持不变。

当前允许声明：

```text
a6FeedbackAutomatedRemediationCompleted=true
batchHumanReviewReady=true
humanAcceptanceStatus=pending_batch_review
```

当前不得声明：

```text
dailyPortfolioReviewHumanAcceptancePassed=true
manualSignoffPassed=true
px602Passed=true
finalFormalReleaseReviewPackageReady=true
formalTradingReleaseReady=true
formalTradingUnlocked=true
autoTradeUnlocked=true
canCreateOrder=true
orderCreateAllowed=true
```

下一步是对新包执行一次集中人工复验，不再继续自动修改人工反馈或生成官方签核。
