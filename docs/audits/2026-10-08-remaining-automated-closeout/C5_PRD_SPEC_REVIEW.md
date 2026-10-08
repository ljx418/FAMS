# C5 PRD 规格复核

日期：2026-10-08

## 复核基线

- `docs/PRD_COMPLETION_TRACEABILITY_MATRIX.md`
- `docs/current-stage-state.json`
- `docs/INVESTMENT_WORKFLOW_UX_PRD.md`
- `docs/DAILY_PORTFOLIO_REVIEW_PRD.md`
- `docs/V2_PX_PRD.md`
- `docs/DIVIDEND_LOW_VOL_PRD.md`
- `docs/INVESTMENT_POLICY_SETTINGS_PRD.md`
- FTR-0..FTR-6 manifest、交易边界合同和目标架构文档

## 规格对照

| PRD 域 | 工程/自动状态 | 未完成项 | 判断 |
| --- | --- | --- | --- |
| 三类资产投资工作流 | 19/20 | 集中人工体验 1 项 | 自动范围完成，PRD 未全完成 |
| 每日投资组合复盘 | 30/30 工程与真实数据 E2E | 普通用户人工体验 | 工程完成，出门待人工 |
| V2-PX External Brain | 20/20 工程合同 | PX6-02 人工 0/10 | 工程完成，产品候选仍 false |
| ChatBox/双轨工作台/Excel | 自动合同通过 | 最终可理解性和视觉核查 | 工程完成，视觉状态 needs_work |
| 投资策略设置 | 三桶比例、仓位上限、止损和准入已实现 | 用户真实参数核对和启用 | 不允许自动替用户启用 |
| 红利低波/FTR | point-in-time、benchmark、5/6 窗口、53 路径、隔离和 provisional 包通过 | 8 类人工签核及 A7 | 自动前置完成，正式 release 未完成 |
| MCP | stdio/HTTP/OAuth resource-server 代码通过 | HTTPS、外部 IdP、外部 ChatGPT 连接 | 本地 ready，公网 release 不 ready |

## 架构与 PRD 偏移检查

- 三类资产、策略族、统一回测、每日复盘、ChatBox、Operation 和交易 gate 的依赖方向与目标架构一致。
- 专家多页未被 ChatBox 替代；普通用户入口和专家入口共享服务与审计证据。
- quote-list 修复只合并真实缓存并约束只读验收，不引入 mock 或改变业务权限。
- V2-PX 修复只修正负例构造，不放宽 schema、sourceRef 或身份合同。
- 没有发现新增 Fatal 或 Major 规格偏差。

## 完成判定

```text
documentedAutomatedDevelopmentPlanComplete=true
fullPrdComplete=false
remainingImplementationGap=none_within_current_automated_scope
remainingHumanAcceptanceGates=true
remainingExternalDeploymentGates=true
formalTradingReleaseReady=false
```

若集中人工发现策略归属错误、曲线含义误导、移动端不可用或视觉理解失败，应按缺陷所属 PRD 打回新的代码子阶段；在人工结果产生前，不预先虚构剩余代码计划。
