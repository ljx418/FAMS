# 三类资产策略与统一复盘开发及验收计划

更新时间：2026-09-15
权威规格：`docs/INVESTMENT_WORKFLOW_UX_PRD.md`

## 1. 顺序

| 阶段 | 开发目标 | 退出证据 |
| --- | --- | --- |
| WF-0 | PRD、架构、接口、风险和验收基线 | 文档审计、基线构建、规格追踪 |
| WF-1 | 账户来源、截图主入口、真实研究输入快照 | 来源冲突负例、真实截图、行情新鲜度审计 |
| WF-2 | 策略归类建议与人工确认 | 三类归属、未确认阻断、仓位页 E2E |
| WF-3 | 轮动四层信号与已有网格复核 | 真实持仓策略运行、信号合同、人工计划清单 |
| WF-4 | 红利低波结论层与组合策略到期门禁 | 普通模式 E2E、到期/确认合同 |
| WF-5 | 统一回测与三场景曲线 | 无未来数据、成本、真实流水对账、曲线审计 |
| WF-6 | 跨页工作流、旧路由和 ChatBox 联动 | 六步主路径、专家页保留、Operation 一致性 |
| WF-7 | 全量真实数据与视觉验收 | HTML 报告、截图、PRD 矩阵、交易边界审计 |

WF-1 至 WF-7 开始前必须分别落盘 development-plan、predevelopment-audit；结束后必须落盘 acceptance-audit 和 prd-spec-review。Fatal 或 Major 未关闭不得进入下一阶段。

## 2. 目标接口

新增聚合接口但不删除现有专家 API：

```text
GET  /api/v1/investment-workflow/readiness
GET  /api/v1/investment-workflow/assignments
PUT  /api/v1/investment-workflow/assignments/:positionId
POST /api/v1/investment-workflow/strategy-runs
POST /api/v1/backtest/scenario-comparison
```

长任务继续使用 Operation。策略运行必须返回 `strategyFamily/strategyVersion/inputSnapshotId/asOf/dataHealth/conclusion/signalLayers/previousPlanComparison/manualOrderDrafts/invalidationConditions/evidenceRefs/blockedReasons/permissionState`。

## 3. 自动验收

- 后端 TypeScript、前端生产构建和现有每日复盘、红利低波、RRG、组合回测、交易边界测试全部通过。
- 新增账户来源、策略归类、轮动信号、年度策略、三场景回测和页面合同测试。
- 真实 E2E 使用已确认账户数据与 canonical 行情，记录数据日期、provider、数据库健康、成功/失败资产及 artifact hash。
- Headless Chromium 覆盖 1440x900、768x1024、390x844；截图后清理浏览器实例。
- Hard fail：未来数据泄漏、伪实时声明、LLM 新增事实、实际流水不对平仍出曲线、未确认归类运行策略、创建 Transaction/Position/订单、交易锁变 true。

## 4. 集中人工核验

自动化阶段完成后再集中人工核验截图识别纠错、策略归类合理性、人工计划可读性、三场景曲线含义和移动端路径。自动化不得代替这些人工判断，也不得因人工尚未执行而伪造通过。

## 5. 2026-09-16 执行状态

| 范围 | 状态 | 证据 / 边界 |
| --- | --- | --- |
| WF-0 至 WF-6 | 自动化验收通过 | 各阶段 `acceptance-audit` 与 `prd-spec-review` |
| WF-7 合同矩阵 | 通过 | 12/12 命令符合预期；严格交易 gate 以预期退出码 1 阻断 |
| WF-7 真实浏览器 | 通过 | 1440 / 768 / 390 三视口、18 张截图、零控制台错误、零失败 HTTP |
| 账户事实保护 | 通过 | 验收前后 16 条策略归类、16 条开放持仓与 57 条流水不变 |
| PRD 自动覆盖 | 18/20 通过 | 1 项集中人工验收待执行；1 项动态 point-in-time 逐日重算未实现 |
| 正式交易 | 未放行 | `formalTradingUnlocked=false` / `autoTradeUnlocked=false` / `canCreateOrder=false` / `orderCreateAllowed=false` |

当前可声明：文档完整支撑的 WF-0 至 WF-7 自动化实现与验收范围已完成。

当前不可声明：整份 PRD 全量完成、集中人工验收完成、动态 point-in-time 重算完成或正式交易可用。
