# FAMS 目标架构 Gap 与演进路线

更新时间：2026-07-16

## 1. 下一阶段唯一目标

```text
当前：S0-S8 受控开发已验收，formal release blocked
下一阶段：Formal Release Readiness Closure
自动化出门：formalTradingReleaseReviewReady=true
人工高风险门：releaseApprovalStatus=pending_human_approval
始终保持：formalTradingUnlocked=false / autoTradeUnlocked=false / canCreateOrder=false / orderCreateAllowed=false
```

本文件和 `target-architecture-gap.drawio` 描述同一架构。若文字与图冲突，以 `current-stage-state.json`、本文件和最新 drawio 解析输出的共同结论为准。

## 2. 当前到目标的实体映射

| 分层 | 已实现实体 | 当前状态/风险 | 下一阶段实体 | 用户可见结果 | 验收证据 |
| --- | --- | --- | --- | --- | --- |
| 体验 | `FamsChatBox.tsx`、`Dashboard.tsx`、`Backtest.tsx`、`DividendLowVol.tsx`、`Operations.tsx` | 双轨体验已验收；正式 gate 仍以技术状态为主 | 在现有页面增加 candidate、provider、validation、signoff 和 release review 视图 | 普通用户看结论和 blocker，专家看完整 evidence | Headless E2E + HTML 报告 |
| API | `chat.ts`、`portfolioBacktest.ts`、`strategy.ts`、`operation.ts` | API 已返回 audit；职责由引擎集中构建 | 保持 API，改为编排独立 FTR services | 页面、ChatBox、审计包读取同一状态 | API contract audit |
| 输入 | `PortfolioBacktestInputBuilder` | 可构建 7 类策略；没有正式 candidate 集合 | `ReleaseCandidateSet` | 用户明确知道哪些策略参与 release 评审 | `release_candidate_set.json` |
| 计算 | `PortfolioBacktestEngine` | 计算与 release 决策耦合 | 引擎保留回测；gate 决策拆出 | 计算结果与放行结论可分别审计 | deterministic replay + service contract |
| 数据 | `formalProviderIngestionService`、`marketDataFreshnessService`、本地缓存 | 部分 provider/freshness/coverage unknown | `FormalDataProviderService`、`FormalDataFreshnessPolicy`、`FieldEvidenceValidator` | 每字段来源、日期、覆盖和恢复动作可见 | `15_data_governance_audit.json` |
| Benchmark | `portfolioBenchmarkService`、内嵌 qualification builder | 免费源可评审，官方/可信资格未通过 | `BenchmarkQualificationService` + official/trusted adapter | 总回报与降级原因可见 | `16_benchmark_qualification_audit.json` |
| 验证 | 内嵌 formal validation builder | `0/7 passed`，整体 insufficient | `FormalValidationService` | OOS、walk-forward、参数和分组状态可见 | `17_formal_validation_audit.json` |
| 签核 | `portfolioBacktestReviewService`、内嵌 signoff builder | 五角色 missing | `ManualSignoffService` | 审核人逐角色签核，用户看状态 | `18_manual_signoff_audit.json` |
| 隔离 | `buildExecutionIsolationAudit`、`portfolioBacktest.ts` 与 `famsChatService.ts` 内嵌阻断 | paper ready，production disabled；尚无独立边界服务 | `ExecutionIsolationService` | paper intent 可见，真实动作 blocked | `13_execution_isolation_audit.json` |
| Release | 内嵌 release gate builder | 正确 blocked | `ReleaseGateService` | 一份报告展示全部 gate 和责任人 | `14_release_gate_audit.json` + HTML |

## 3. 开发顺序

```text
FTR-0 文档与状态冻结
  -> FTR-1 正式数据治理
  -> FTR-2 官方/可信 total-return benchmark
  -> FTR-3 Formal validation
  -> FTR-4 五角色人工签核
  -> FTR-5 执行隔离回归
  -> FTR-6 Release review 总验收
  -> 人工高风险 release decision（自动化范围外）
```

详细命令、产物和打回条件以 `FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json` 为准。

## 4. 用户路径

### 普通用户

资产 Excel 导入 -> Dashboard 数据健康 -> ChatBox 组合比较 -> 工作台结论/关键数字/下一步 -> 数据或 validation blocker -> 打开专家页或 Operations 查看证据。

### 研究用户

选择 release candidate -> 配置回测区间与成本 -> 查看总回报 benchmark -> 查看 OOS/walk-forward/参数/分组 -> 不足时回到样本和模型计划。

### 审计与签核用户

Operations -> 数据证据 -> benchmark 授权 -> validation artifact -> 五角色签核 -> release review package -> 人工决定是否进入后续生产授权流程。

### 禁止动作

ChatBox、专家页或 API 请求 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` -> permission gate blocked -> 不创建订单、不修改持仓 -> 记录阻断审计。

## 5. 里程碑与出门条件

| 里程碑 | 出门门槛 | 用户体验 |
| --- | --- | --- |
| M0 文档冻结 | drawio 8 页、实体映射完整、人工认可方向 | 能看懂下一阶段做什么 |
| M1 数据通过 | release candidates 无关键 provider/freshness/coverage/evidence blocker | 能判断数据可信和恢复动作 |
| M2 Benchmark 通过 | official/trusted total-return + 授权证据 | 能看真实总回报比较 |
| M3 Validation 通过 | candidate 集合全部达到既定统计门槛 | 能看模型为何通过或失败 |
| M4 Signoff 通过 | 五角色签核及 artifact hash 完整 | 能追溯谁批准了什么 |
| M5 Isolation 通过 | paper/sandbox only，生产适配器 disabled | 不会误触真实订单 |
| M6 Review package ready | FTR-1 至 FTR-5 全部关联，HTML 可复核 | 人类可做最终 release 决策 |

## 6. Drawio 规则

drawio 固定 8 页：

1. 当前基线与下一阶段目标。
2. 当前架构与目标架构差异。
3. 正式数据治理。
4. Benchmark 与总回报回测。
5. Formal validation。
6. 人工签核、隔离和 Release Gate。
7. 开发计划、里程碑和用户路径。
8. 验收门槛、出门条件和硬边界。

颜色：灰=现有基础，绿=已实现并验收，黄=已实现但未达 release，橙=待新增/拆分，蓝=证据，红=硬边界。

第 2 页每条链必须具备：

```text
现有代码实体 -> 当前风险/内嵌方法 -> 目标实体 -> API/数据 -> 审计产物 -> 用户结果
```

不得出现没有代码实体的“数据层”“策略层”“智能层”等泛化盒子。

## 7. 禁止退化

- 不得删除 ChatBox、普通用户工作台、资产 Excel 或专家多 Tab 的已验收能力。
- 不得把 S0-S8 重新画成待开发。
- 不得把目标独立 Service 标记为已开发。
- 不得只写验收名词而没有用户场景、操作步骤、硬门槛和失败归属。
- 不得把截图、命令退出 0 或合同生成成功等同业务 gate passed。
- 不得把 formal review ready、manual draft、formal validation passed 解释为正式交易 unlocked。
