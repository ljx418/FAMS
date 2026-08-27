# V2-PX 开发文档覆盖度审查

更新时间：2026-08-27

## 1. 审查结论

本轮开始前，V2-PX 文档能够支撑“继续讨论和做 PX-1 规划”，但不能完整、低风险地支撑实际代码开发。按本文件的覆盖度量表评估，修订前为 `51/100`；主要缺口不是 schema 数量不足，而是目标体验、当前代码实体、目标代码实体、FAMS 数据接入、逐场景验收和专项 draw.io 没有闭环。

本轮修订后，文档对已批准产品目标的结构化覆盖为 `20/20 PRD requirements`，每项均映射到目标实体、阶段、计划测试、证据和人类检查。该结论只表示“文档可以支撑受控分阶段开发”，不表示 PX-1 已启动、代码已实现或真实 Chrome 已通过。

```text
currentPhase=DOCUMENTATION_READY_FOR_IMPLEMENTATION_REVIEW
documentationCoverageBefore=51/100
documentationCoverageAfter=100/100
documentationRequirementTraceabilityAfter=20/20
documentationSupportsControlledDevelopment=true
documentationSupportsUnattendedImplementation=false
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
px1FeasibilitySpikeAllowed=false
px2PlusAllowed=false
productionCodeChangedInThisPhase=false
```

## 2. 评估方法

| 维度 | 权重 | 修订前 | 修订后目标 | 修订前主要问题 |
| --- | ---: | ---: | ---: | --- |
| 产品问题、目标、非目标 | 10 | 8 | 10 | 有目标，但没有把“不是投资模型升级”写成清晰边界 |
| 用户路径、状态和原型 | 15 | 5 | 15 | 只有动作清单，没有可快速评审的双容器线框和状态矩阵 |
| 当前架构与真实实体盘点 | 15 | 5 | 15 | 未说明现有 `FamsChatBox`、Daily Review、Operation 如何被复用 |
| 目标架构与代码实体映射 | 20 | 11 | 20 | extension entrypoint 较清楚，但 FAMS adapter、API、状态与权限链缺失 |
| 开发阶段、依赖和回滚 | 10 | 7 | 10 | 有 PX-0～PX-6，但阶段效果、依赖和停止条件不够具体 |
| 用户场景、步骤、阈值和证据 | 15 | 8 | 15 | 有 G1～G7 名称，但缺逐场景操作和量化出门阈值 |
| 追踪、状态一致性和防假绿 | 10 | 7 | 10 | 合同较强，但原型状态文本存在 `stub`/`fixtures` 漂移 |
| 中文 draw.io gap 总图 | 5 | 0 | 5 | 现有 8 页图属于 FTR，不是 V2-PX 架构图 |
| 合计 | 100 | 51 | 100 | 修订前不应进入实现 |

“修订后目标 100”表示文档结构覆盖完整，不代表实现完成率。PX-1～PX-6 的代码与真实浏览器证据当前仍为 `0%`。

## 3. 修订前阻断实际开发的缺口

### DOC-GAP-01：目标体验不够具体

“三入口、五 intent、双容器”是技术词，不能直接回答用户打开侧边栏后看到什么、如何进入完整工作台、断连时如何恢复。本轮以 `docs/prototypes/v2-px/V2_PX_PROTOTYPE_DESIGN.md` 固化目标页面、核心文案、状态矩阵和四视口体验。

### DOC-GAP-02：当前与目标代码实体没有完整桥接

旧文档没有说明以下已实现能力如何复用：

- `frontend/src/components/chat/FamsChatBox.tsx`
- `frontend/src/pages/DailyReviews.tsx`
- `frontend/src/pages/Operations.tsx`
- `backend/src/routes/chat.ts`
- `backend/src/routes/dailyReview.ts`
- `backend/src/routes/operation.ts`
- `famsChatService / dailyReviewService / operationService / dailyReviewWorkflowService`

本轮由 `docs/V2_PX_TARGET_ARCHITECTURE.md` 给出逐层实体、状态、依赖方向和交互关系。

### DOC-GAP-03：权限合同与数据目标冲突

旧 ADR 同时写了“独立 extension Workspace Page 读取 FAMS 能力”和 `hostPermissions=[]`。extension 页面在没有主机权限或受控桥接的情况下无法完成目标数据接入。本轮选择：

```text
required permissions = sidePanel + tabs + storage
optional host permissions = 精确本地 FAMS 前后端 origin
grant timing = 用户在“连接本地 FAMS”动作中主动授权
PX core = 领域无关
FAMS business data = 通过 FamsDomainAdapter 与只读聚合 API
```

若 PX-1 证明该路径不可行，必须回到 ADR，不得静默扩大权限。

### DOC-GAP-04：五类 intent 没有业务落点

本轮明确映射：

| Intent | 首期复用数据 |
| --- | --- |
| `source_library` | Operation artifact、Daily Review evidence 的只读索引 |
| `source_detail` | 单一 artifact / review / operation 详情 |
| `ask` | `famsChatService` 的结构化问答结果 |
| `trace` | Operation timeline 与 Daily Review DAG |
| `graph` | Daily Review workflow / evidence 关系图，不新增投资模型 |

### DOC-GAP-05：验收章节不够可操作

旧文档列出了路径和命令名称，但没有为每个用户场景同时给出前置条件、操作步骤、量化阈值、证据文件和失败归属。本轮在开发计划和 draw.io 第 8 页补齐，杜绝“三无验收”。

### DOC-GAP-06：缺少 V2-PX 专项 draw.io

现有 `docs/target-architecture-gap.drawio` 是 FTR 权威架构，不应被覆盖。本轮新增 `docs/v2-px-target-architecture-gap.drawio`，共 8 页、中文、具体代码实体、状态色一致，从而避免 FTR 文档退化。

## 4. 本轮文档产物

| 文档 | 责任 |
| --- | --- |
| `V2_PX_PRD.md` | 问题、用户目标、20 项需求、质量目标、非目标和成功口径 |
| `V2_PX_TARGET_ARCHITECTURE.md` | 当前/目标实体、状态、交互、权限、数据和故障边界 |
| `V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md` | 文档门、PX-1～PX-6、里程碑、验收场景、停止规则 |
| `V2_PX_PRD_TRACEABILITY_MATRIX.md` | Requirement 到实体、阶段、测试、证据、人类检查的全链路 |
| `prototypes/v2-px/V2_PX_PROTOTYPE_DESIGN.md` | Side Panel 与 Workspace Page 目标体验及状态矩阵 |
| `adr/ADR-2026-07-15-v2-px-route-a.md` | Route A.1、权限选择、状态所有权、替代方案和代价 |
| `v2-px-target-architecture-gap.drawio` | 8 页中文架构、计划、里程碑、验收和出门图 |
| `V2_PX_DRAWIO_SUMMARY.md` | 页级目标、实体和防退化检查清单 |

## 5. 文档阶段出门门槛

只有全部满足后，文档阶段才可以标记 ready；仍需用户另行明确批准才允许启动 PX-1：

1. 20 项 PRD requirement 均能追溯到具体目标代码实体、PX 阶段、计划测试、证据和人类检查。
2. 当前实体与待新增实体不混用状态颜色或完成措辞。
3. draw.io 页数 `<=8`，页面名称、节点和边可被 XML 解析。
4. draw.io 同时覆盖目标体验、当前/目标差异、实体交互、开发计划、里程碑、验收门槛和出门条件。
5. 每个关键用户场景都有前置条件、操作步骤、通过阈值、证据和失败归属。
6. PX-1+ 所有命令明确标为“计划命令”，不能因文档存在而宣称实现。
7. `px1FeasibilitySpikeAllowed=false`、`px2PlusAllowed=false`，直到用户再次明确批准。
8. 本轮 Git diff 只包含文档或文档状态源，不包含生产源码、扩展包、schema 行为或构建配置变更。

## 6. 当前决策

```text
documentationRedesignAcceptedGoal=true
documentationExitReviewRequired=true
implementationMustWaitForUserApproval=true
```

本轮不会把用户对“规划和目标”的认可解释成对 PX-1 代码开发的授权。
