# 全量 E2E 运行时加固 PRD 规格复核

日期：2026-10-08

## 规格结论

```text
implementationMatchesDocumentedArchitecture=true
automatedPrdScopeComplete=true
fullPrdComplete=false
investmentWorkflowRequirements=19_automated_passed_1_human_pending
v2PxAutomatedRequirements=20_of_20
v2PxHumanScenarios=0_of_10
manualSignoffPassed=false
finalFormalReleaseReviewPackageReady=false
```

本轮代码没有扩展 PRD 范围，只修复验收自包含性和查询职责边界。实现与 `current-stage-state.json`、`PRD_COMPLETION_TRACEABILITY_MATRIX.md`、`TARGET_ARCHITECTURE_GAP.md` 和 `target-architecture-gap.drawio` 的当前/目标状态一致。

## 已完成开发内容

1. 基本信息确认：截图/Excel 资产录入、账户来源、数据日期、价格和指标链。
2. 仓位策略：三类资产归属、行业轮动与波动网格、红利低波建议、支付宝组合策略。
3. 回测复盘：按建议、不执行建议、实际持仓和经典组合曲线；冻结策略 point-in-time 动态重算；每日复盘。
4. 双轨体验：ChatBox 普通用户入口、专家页面、Operation 和 artifact 追溯。
5. FTR 自动链：数据治理、benchmark、formal validation、人工队列、执行隔离和 provisional package。
6. 安全边界：真实账户只读、paper intent、交易和自动交易持续阻断。

## 仍未完成的 PRD 内容

| 项目 | 当前状态 | 完成条件 | 是否代码缺口 |
| --- | --- | --- | --- |
| 投资工作流最终体验 | `19/20` | 人类核对策略归属、截图纠正、曲线语义和移动体验 | 否，集中人工门禁 |
| 每日复盘最终体验 | 工程 `30/30`，人工未执行 | 普通用户按清单完成体验核查 | 否，集中人工门禁 |
| V2-PX | 工程 `20/20`，人工 `0/10` | 真实 Chrome permission、十项场景和截图/trace | 否，真实浏览器人工门禁 |
| A6 正式评审 | 工作台和 32/32 图文步骤已实现，8 项 pending | 授权审核人完成数据、模型、风险、合规和 final 核查 | 否，不允许自动代签 |
| A7 最终评审包 | 未生成 | A6 全部通过后使用原 artifact 哈希重建 | 是，但前置未满足，当前禁止执行 |
| 正式交易/自动交易 | 未开放 | 另立高风险阶段，需生产适配器与独立人工批准 | PRD 当前明确非目标 |

## 文档对剩余计划的支撑度

- 当前自动化范围：完整支撑，开发、测试、证据和失败回退均已落盘并通过。
- 集中人工范围：完整支撑操作与反馈回填，A6 工作台 32/32 步有图；其中四步必须由人类采集真实 Chrome 证据。
- A7：流程和哈希继承规则已支撑，但在 A6 通过前不允许生成或验收。
- 正式交易：文档只支撑继续锁定，不支撑生产下单和自动交易实现。

## 后续备选开发目标

在集中人工核查给出失败证据前，不应臆造新的 PRD 修复。可独立规划但不能冒充当前 PRD 出门的工程目标为：

1. 首屏和重页面性能预算：优化 SQLite 健康检查、红利低波审计包和回测页面初载，建立 P50/P95 门槛。
2. 免费数据源韧性：为实时源不可用建立多源 freshness 评分和清晰降级，不承诺免费源实时 SLA。
3. 外部 LLM 可用性：补充 provider health、余额不足提示和明确的确定性降级状态。
4. MCP 公网发布：HTTPS/OAuth gateway 和宿主依赖安全修复；本地与受保护 HTTP 已完成。
5. 正式交易阶段：仅在人类单独批准新 PRD 后规划 production adapter，不从当前研究系统隐式解锁。

## 是否允许声明 PRD 全完成

不允许。当前准确表述是：

```text
documentedAutomatedScopePassed=true
batchHumanReviewReady=true
fullPrdExitStatus=blocked
prdFullyComplete=false
```
