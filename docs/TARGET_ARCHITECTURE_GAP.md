# FAMS 目标架构 Gap 与演进路线

更新时间：2026-09-16

## 1. 当前集成状态与剩余目标

```text
FTR 当前：A0/FTR-1/FTR-2/FTR-3 point-in-time v2 正式链已通过；免费来源 5216/5216 标的与六时点 6/6 ready，红利低波 5/6 窗口、53 条动态路径通过自动门槛，`wf-04` 失败保留
FTR 自动化段：FTR-4 不可自签队列已冻结 8 类审查项，FTR-5 隔离回归已通过，FTR-6 provisional review package 已生成并逐字节校验
投资工作流：WF-0 至 WF-7 文档支撑的自动化实现与真实数据验收已完成；PRD 自动覆盖 18/20，真实基线为 16 个持仓、57 条交易、16 个待确认策略归属
剩余目标一：A6、V2-PX 和投资工作流集中人工核查；通过后只使用已签核的同一 artifact 哈希重建 A7 最终评审包
剩余目标二：另立开发阶段实现 advice-level `point_in_time_simulation` 冻结策略逐日重算，未实现前不得声明 PRD 全部完成
自动化段出门：batchHumanReviewReady=true / formalTradingReleaseReviewReady=true / finalFormalReleaseReviewPackageReady=false / evidence=provisional
集中核查出门：humanAcceptanceStatus=passed；A7 仍需按签核哈希重建后才能令 finalFormalReleaseReviewPackageReady=true
当前项目级结论：documentedAutomatedScopePassed=true / prdRequirementPassed=18/20 / prdFullyComplete=false
未来独立高风险门：生产适配器与正式交易解锁
始终保持：formalTradingUnlocked=false / autoTradeUnlocked=false / canCreateOrder=false / orderCreateAllowed=false
```

本文件和 `target-architecture-gap.drawio` 描述同一架构。若文字与图冲突，以 `current-stage-state.json`、本文件和最新 drawio 解析输出的共同结论为准。

## 2. 当前到目标的实体映射

| 分层 | 已实现实体 | 当前状态/风险 | 下一阶段实体 | 用户可见结果 | 验收证据 |
| --- | --- | --- | --- | --- | --- |
| 体验 | `FamsChatBox.tsx`、`Assets.tsx`、`Positions.tsx`、`RelativeRotation.tsx`、`DividendLowVol.tsx`、`Backtest.tsx`、`DailyReviews.tsx`、`Operations.tsx` | 双轨体验和 WF-0..7 自动验收通过；策略归属及截图修正仍待人工确认 | 保留 ChatBox 首入口和专家页；在现有页面呈现三类资产、策略归属、场景比较、candidate/provider/validation/signoff | 普通用户按资产录入 -> 归属确认 -> 策略 -> 回测 -> 复盘前进，专家可下钻证据 | Headless E2E + HTML 报告 + 人工清单 |
| API | `chat.ts`、`position.ts`、`investmentWorkflow.ts`、`backtest.ts`、`dailyReview.ts`、`relativeRotation.ts`、`formalRelease.ts`、`operation.ts` | 日常复盘/RRG/投资工作流/FTR API 已实现；正式交易和动态建议级时点模拟仍 blocked | 保持 Fastify 模块边界，统一读取状态源、投资工作流 services 和 FTR services | 页面、ChatBox、审计包读取同一事实和同一交易锁 | API contract audit |
| 投资决策 | `PositionStrategyAssignmentService`、`RotationVolatilityStrategyService`、`AlipayAllocationStrategy`、`ScenarioComparisonService` | 三类资产路由、行业轮动网格、红利建议、组合策略与场景比较已实现；16 个持仓归属待人工确认；历史建议逐日动态重算未实现 | 为 `point_in_time_simulation` 冻结每日可见事实、策略版本和 advice 输出；保持 `actual/hold/follow_advice` 三场景同口径 | 用户能区分同花顺轮动/红利资产和支付宝组合资产，并比较按建议、不执行、实仓曲线 | WF-7 artifacts + 后续动态模拟合同/重放证据 |
| 输入 | `PortfolioBacktestInputBuilder`、`ReleaseCandidateSetService` | 七对象已冻结，但旧版未区分工程样本、诊断、参照和产品候选 | `FormalValidationProfileSet`：角色、profile、benchmark、成分与适用性不可变 | 用户明确知道哪些对象参与 release gate、哪些只作研究或诊断 | `release_candidate_set.json` + `validation_profile_set.json` |
| 计算 | `PortfolioBacktestEngine` + `FormalValidationService` + point-in-time runner/verifier | FTR-3 v2 自动门禁通过；六窗口 5/6，失败窗口保留，尚待模型人工复核 | A6 只复核冻结结果；任何否决均打回对应 FTR 阶段，不得现场改参数 | 计算结果与放行结论可分别审计 | deterministic replay + service contract + failed-window evidence |
| 数据 | `FormalDataProviderService`、`FormalDataFreshnessPolicy`、`FieldEvidenceValidator`、`FreePointInTimeSnapshotService` | FTR-1 v2 已通过；5216/5216 标的、六个冻结决策点均达到 >=80%，授权范围为本机个人非商业用途 | A6 数据审核只复核来源、用途、日期、哈希和覆盖率，不补造授权 | 每个历史决策日都能说明当时知道什么、哪些股票可选 | `15_data_governance_audit.json` + `point_in_time_data_readiness.json` |
| Benchmark | `FormalBenchmarkService`、`portfolioBenchmarkService` | H00300 trusted total-return 已通过 FTR-2；正式商业授权未声明 | 重构候选继续绑定已冻结 H00300，不因失败更换 benchmark | 总回报与降级原因可见 | `16_benchmark_qualification_audit.json` |
| 验证 | `FormalValidationService`、`freePointInTimeSnapshotService.ts`、point-in-time v2 runner/verifier | 免费来源 6/6 ready；FTR-3 v2 为 5/6、53 路径、6/3/3 分组，自动门槛通过；人工复核 pending | FTR-4 队列固定完整哈希链；其他六对象保持 not_applicable，`wf-04` 不得隐藏 | 用户能看到候选为何通过、哪个窗口失败、数据来源和待人工核查状态 | `17_formal_validation_audit.json` + FREE-P1/R0/R1 + point-in-time parameter/group/tradeability artifacts |
| 签核 | `ManualSignoffService`、`formalReviewerAuthService`、`DeferredHumanReviewQueueService`、`HumanAcceptanceDraftService`、`formal-release-human-checklist.html` | 队列已冻结 8 类审查项；A6 工作台与本地私有草稿 API 已实现并通过 32/32 步配图和三视口验收；28 张为真实运行/冻结证据图，4 张为非证据操作示意；8 pending、0 approved | A6 授权审核人照图核验并回填实际结果；V2-PX 仍需另采真实 Chrome 截图/trace；草稿成熟后再进入授权签核，且必须绑定原 artifact 哈希 | 审核人一次进入完整队列，每一步都有图，能看状态和失败归属，且不会把示意图误当通过证据 | queue + source manifest + A6 draft schema/runtime audit + `18_manual_signoff_audit.json` |
| 隔离 | `ExecutionIsolationService` + FTR-5 runner/verifier | FTR-5 自动验收通过；真实账户只读、paper intent 可用、5 类生产变更阻断 | A6 风险审核复核隔离证据；生产适配器仍 disabled | paper intent 可见，真实动作 blocked | `13_execution_isolation_audit.json` + wording/adapter records |
| Release | `ReleaseGateService`、`FormalReleasePackageService.buildProvisional` | FTR-6 provisional 包已生成：28 个来源 artifact 逐字节校验；业务 gate 因人工签核 blocked | A6 通过后按相同哈希重建 A7 final 包，不重新计算或覆盖结论 | 一份 HTML 展示全部 gate、证据、责任人和未完成项 | source manifest + `14_release_gate_audit.json` + provisional manifest + HTML |

日常产品链已实现：`FamsChatBox.tsx / Assets.tsx / Positions.tsx / RelativeRotation.tsx / DividendLowVol.tsx / Backtest.tsx / DailyReviews.tsx -> position.ts / investmentWorkflow.ts / backtest.ts / dailyReview.ts / relativeRotation.ts -> PositionStrategyAssignmentService / RotationVolatilityStrategyService / AlipayAllocationStrategy / ScenarioComparisonService / AlipayOneClickReviewService -> Operation / 私有真实数据证据`。DPR-001 至 DPR-030 的自动合同已覆盖；投资工作流 PRD 当前为 18/20，不能用日常链通过替代动态时点模拟或人工确认。

## 3. 开发顺序

```text
A0 正式 provider/benchmark 授权输入 + 七对象 inventory/profile/benchmark 冻结（已完成）
  -> A1 FTR-1 正式数据治理（已完成 provisional）
  -> A2 FTR-2 total-return benchmark（已完成 provisional）
  -> A3 FTR-3 Formal validation（v2 真实业务 5/6，自动通过、人工待核查）
  -> FREE-P1 免费来源全量回填（5216/5216、六时点 6/6，已完成）
  -> A3R1 冻结无前视候选 v2 并顺序重跑 A0/A1/A2/A3（已完成）
  -> A4 FTR-4 不可自签队列 + FTR-5 执行隔离回归（已完成自动验收）
  -> A5 FTR-6 provisional review package（已完成自动验收，28 个来源 artifact 哈希通过）
  -> A6 集中人工验收（产品/数据/模型/风险/合规/final）
  -> A7 最终评审包
  -> 独立未来阶段：生产适配器与交易权限审批

并行完成的产品链：
WF-0 文档/合同 -> WF-1 三类资产路由 -> WF-2 行业轮动与波动网格
  -> WF-3 红利低波建议 -> WF-4 支付宝组合策略 -> WF-5 场景比较
  -> WF-6 跨页用户路径 -> WF-7 真实数据/三视口/PRD 审计（自动范围已完成）
  -> 集中人工：截图行纠正、16 个持仓策略归属、页面语义核查
  -> 后续独立开发：冻结策略逐日 `point_in_time_simulation` -> 重跑 PRD 矩阵
```

A0 负责取得并冻结可执行的数据使用授权，同时冻结 candidate role、`validationProfileId`、成分和候选级 benchmark；A6 只独立复核授权 artifact、适用范围、有效期与哈希，不得补签或追认缺失授权。授权或 profile 复核失败直接打回 A0，并失效依赖的后续证据。

详细命令、产物和打回条件以 `FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json` 为准。

## 4. 用户路径

### 普通用户

资产截图/Excel 导入 -> Assets 核对来源与价格日期 -> Positions 确认三类资产和策略归属 -> RelativeRotation/DividendLowVol/Backtest 运行对应策略 -> 工作台查看结论、关键数字、下一步和数据健康 -> DailyReviews/Operations 复盘与追溯证据。

### 研究用户

选择行业轮动、红利低波或组合 candidate -> 查看对应网格/建议/配置 -> 在统一 Backtest 比较 `actual/hold/follow_advice` 或不同组合 -> 查看收益、最大回撤、时间敏感性、数据日期与 benchmark -> 不足时回到数据或策略计划。当前 `follow_advice` 动态历史重算必须显示 controlled block。

### 审计与签核用户

Operations -> 一次打开冻结的产品/数据/benchmark/validation/隔离证据队列 -> 按角色签核或打回 -> 重建 final review package -> 另行决定是否进入生产授权流程。

### 禁止动作

ChatBox、专家页或 API 请求 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` -> permission gate blocked -> 不创建订单、不修改持仓 -> 记录阻断审计。

## 5. 里程碑与出门条件

| 里程碑 | 出门门槛 | 用户体验 |
| --- | --- | --- |
| M0 文档冻结 | drawio 8 页、实体映射完整、人工认可方向 | 能看懂下一阶段做什么 |
| MW 投资工作流自动范围 | WF-0..7 合同、API、页面、真实数据和三视口通过；PRD 矩阵诚实记录 18/20 | 能按三类资产进入对应策略并查看场景比较，不误认为历史动态模拟已完成 |
| M1 数据通过 | 当前候选 FTR-1 已通过；若重构动态候选，六个历史决策点行情/交易状态/证券状态/as-of 候选覆盖均 >=80%，公告日截断可验证 | 能判断每个历史时点的数据可信和恢复动作 |
| M2 Benchmark 通过 | official/trusted total-return + 授权证据 | 能看真实总回报比较 |
| M3 Validation 通过 | point-in-time 6/6；冻结 6 窗口通过 5/6，53 条路径及参数/分组门槛通过，失败 `wf-04` 保留 | 能看模型为何通过、哪个窗口失败及为何仍待人工复核 |
| M4 自动证据冻结 | queue 含 8 类审查项、28 个来源 artifact 和完整哈希；8 pending、0 approved | 能一次核查完整范围 |
| M5 集中人工核查 | 产品、数据、benchmark、模型、风险、合规和 final 全通过 | 能追溯谁批准了什么 |
| M6 Final review package ready | 签核哈希与原证据一致，HTML 可复核 | 人类可决定是否另开生产解锁阶段 |
| M7 PRD 全量闭环 | 人工项通过且 `point_in_time_simulation` 冻结策略逐日重算通过真实数据、防前视和回放验收 | 用户可审计历史每个建议日的输入、建议、执行场景与收益曲线 |

## 6. Drawio 规则

drawio 固定 8 页：

1. 当前基线与下一阶段目标。
2. 存量代码到目标能力的六条横向强关联实体链（含投资工作流）。
3. 正式数据治理。
4. Benchmark 与 Formal validation。
5. 集中人工核查与证据失效。
6. 四条横向用户操作与验收泳道。
7. 两行连续 A0-A7 开发里程碑、失效和打回规则。
8. 验收门槛、出门条件和独立生产解锁边界。

颜色：灰=现有基础，绿=已实现并验收，黄=已实现但未达 release，橙=待新增/拆分，蓝=证据，红=硬边界。

第 2 页每条横向链必须在同一视觉行内具备：

```text
现有代码实体 -> 当前风险/内嵌方法 -> 目标实体 -> API/数据 -> 审计产物 -> 用户结果
```

不得出现没有代码实体的“数据层”“策略层”“智能层”等泛化盒子。

表现形式遵循 Archify `showcase` 基线：主路径唯一、旁支贴近归属节点、关系标签简短、常见桌面宽度正文可读、关系线不得穿过节点。Archify 参考规格为 `fams-formal-release-readiness.architecture.json`；它用于校验信息层级，不替代本 drawio 的完整八页规格。

## 7. 禁止退化

- 不得删除 ChatBox、普通用户工作台、资产 Excel 或专家多 Tab 的已验收能力。
- 不得把 S0-S8 或 WF-0..WF-7 已通过的自动化范围重新画成待开发；也不得把 18/20 写成 PRD 全完成。
- 不得把已实现的 FTR Service、`DeferredHumanReviewQueueService` 或 FTR-6 provisional package 标记为待开发；也不得把 8 项 pending 写成人工已通过。
- 不得只写验收名词而没有用户场景、操作步骤、硬门槛和失败归属。
- 不得把截图、命令退出 0 或合同生成成功等同业务 gate passed。
- 不得把 formal review ready、manual draft、formal validation passed 解释为正式交易 unlocked。
