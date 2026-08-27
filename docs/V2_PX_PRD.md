# V2-PX External Brain Productization PRD

更新时间：2026-08-27

## 1. 审批与阶段状态

用户已认可 V2-PX 的产品规划和目标体验。本轮只完善开发文档、原型规格和架构，不授权实际代码开发。

```text
prdStatus=APPROVED_PRODUCT_SCOPE_DOCUMENTATION_REVIEW
productGoalApproval=APPROVED_BY_USER
documentationPhase=INTERNAL_AUDIT_PASS_AWAITING_EXTERNAL_AND_USER_REVIEW
externalChatGptAuditStatus=PENDING
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
px0GithubReviewGate=PASS
px1PlanningAllowed=true
px1FeasibilitySpikeEligible=true
px1FeasibilitySpikeAllowed=false
px2PlusAllowed=false
v2PxComplete=NO_GO
```

权威配套文档：

- 目标架构：`docs/V2_PX_TARGET_ARCHITECTURE.md`
- API/运行时合同：`docs/V2_PX_API_RUNTIME_CONTRACT.md`
- 开发及验收计划：`docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md`
- 原型规格：`docs/prototypes/v2-px/V2_PX_PROTOTYPE_DESIGN.md`
- 需求追踪：`docs/V2_PX_PRD_TRACEABILITY_MATRIX.md`
- 架构图：`docs/v2-px-target-architecture-gap.drawio`
- 文档验收：`docs/V2_PX_DOCUMENTATION_ACCEPTANCE.md`
- 外部审计包：`docs/V2_PX_CHATGPT_AUDIT_PACKET.md`

## 2. 产品问题

FAMS 已经拥有 ChatBox、每日复盘、任务中心、分析建议、RRG、回测和审计证据，但用户需要在多个页面之间切换，ChatBox 也不适合承载大型图表、DAG、来源详情和完整证据。浏览器刷新、关闭重开、重复点击和跨入口跳转还没有统一 workspace 状态与证据链。

V2-PX 要解决的不是“再造一个投资模型”，而是把现有研究能力组织成一个浏览器级 External Brain：

- Side Panel 提供随时可用的轻入口和简明摘要。
- Workspace Page 承载完整研究、来源、追踪、图谱和证据。
- FAMS Host App、Side Panel、Workspace Page 指向同一任务上下文。
- Background 统一路由、标签页复用、幂等、恢复和审计。
- 所有完成声明必须来自真实 Chrome 证据，而非静态 mock。

## 3. 目标用户与使用时刻

### 3.1 主要用户

本地运行 FAMS、每天在开盘后和收盘前使用持仓复盘、ChatBox、截图识别和专业研究页面的个人用户。

### 3.2 高频时刻

1. 浏览财经网页时快速询问当前持仓或标的。
2. 在 Side Panel 看到摘要后进入完整工作台查看图表和证据。
3. 从每日复盘、任务中心或 ChatBox 把当前结果送入同一 Workspace。
4. 次日重新打开浏览器并恢复上一轮研究任务。
5. 查看结论来源、Operation 时间线和复盘 DAG，确认结果不是无来源文本。

## 4. 产品目标与成功结果

| 目标 | 用户结果 | 最终验收指标 |
| --- | --- | --- |
| 降低入口复杂度 | 三个入口都能进入同一知识任务 | 三入口场景矩阵 100% 通过 |
| 解决 ChatBox 空间不足 | 侧栏只显示摘要，完整内容进入 Workspace | 360/420/768/1280 四视口均无横向溢出 |
| 保持任务连续性 | 刷新、关闭重开、扩展 reload 后能够恢复或明确阻断 | 必测恢复场景 100% 有可推导结果 |
| 阻止重复副作用 | 重复点击只聚焦已有标签页，重复命令被去重 | 20 次重复打开产生 1 个 workspace tab、0 个重复 operation |
| 提升结果可信度 | 来源、时间、任务、证据可以追踪 | 五 intent 均能到达真实 read model 和 evidenceRefs |
| 杜绝假绿 | 真实 extension URL、trace、事件、哈希和 commit 可复核 | G1～G7 全绿且负例必须失败 |

性能目标适用于本地验收环境，不作为互联网生产 SLA：

```text
sidePanelShellUsable <= 2s
workspaceShellUsable <= 3s
existingWorkspaceFocus <= 1s
reconnectResultVisible <= 5s
unexpectedConsoleErrors = 0
unexpectedFailedRequests = 0
rootHorizontalOverflow = 0
```

## 5. 目标体验

### 5.1 Side Panel

用户打开 Side Panel 后首先看到连接状态、当前任务、简明结论、数据时间、查看依据和“在完整工作台打开”。复杂图表、原始 evidence 和大型表格不进入 Side Panel 首屏。

### 5.2 Workspace Page

Workspace Page 使用 768/1280px 的完整布局，包含来源库、来源详情、问答、追踪、图谱、普通话摘要、恢复提示和证据抽屉。高级审计默认折叠，不要求普通用户先理解内部字段。

### 5.3 Host App

FAMS ChatBox、每日复盘和任务中心增加统一的“在外部大脑打开”入口。入口只传递 workspace/source/review/operation 等标识，不把问题正文、原始账户截图、cookie 或 token 放进 route payload。Host App 的“查看来源”可靠 fallback 是打开或复用 Workspace 来源详情，不把能否自动打开 Side Panel 作为产品正确性的前提。

详细线框与状态见 `docs/prototypes/v2-px/V2_PX_PROTOTYPE_DESIGN.md`。

## 6. 核心用户故事

### US-PX-01 快速提问

作为日常使用 FAMS 的用户，我希望从 Chrome Side Panel 快速提问并先看到简明摘要，从而不用离开当前网页。

验收：在已连接本地 FAMS 的前提下提交问题，Side Panel 显示结论、依据、数据时间和下一步；没有原始异常或订单动作。

### US-PX-02 查看完整工作台

作为需要深入核查的用户，我希望从摘要打开完整 Workspace，从而查看图表、来源、任务追踪和证据。

验收：点击后打开或复用正确 workspace tab，并定位到当前 source/operation/view。

### US-PX-03 从 FAMS 页面延续任务

作为正在查看每日复盘或任务中心的用户，我希望把当前结果在 External Brain 中打开，从而不重新输入上下文。

验收：host app bridge 传递受控 ID，Workspace 显示相同 review/operation，route/correlation 可追溯。

### US-PX-04 恢复与断连

作为跨时段使用的用户，我希望刷新、关闭重开或扩展 reload 后恢复任务；无法恢复时看到原因和操作。

验收：每个生命周期场景由事件推导为 restored 或 blocked，禁止空白和伪成功。

### US-PX-05 核查证据

作为谨慎用户，我希望知道结论来自哪个数据、任务和代码版本，从而判断是否值得采用。

验收：能打开来源详情、Operation trace、review graph 和浏览器证据摘要；隐私数据已脱敏。

## 7. 产品需求

| ID | 需求 | 用户价值 | 可量化验收 |
| --- | --- | --- | --- |
| PX-REQ-001 | 三入口容器 | 从 sidepanel、Workspace、host app 进入同一任务 | 三入口均有真实路径证据 |
| PX-REQ-002 | 三类入口动作 | 查看来源、打开工作台、在工作台中定位 | 3×3 动作矩阵按入口目标容器通过，非法组合被拒绝；Host 查看来源落在 Workspace |
| PX-REQ-003 | 五类 route intent | 来源库、详情、问答、追踪、图谱均可访问 | 五 intent 均有 read model、页面和证据 |
| PX-REQ-004 | Side Panel 轻入口 | 快速理解结论且不拥挤 | 360/420 无溢出，摘要和主动作首屏可见 |
| PX-REQ-005 | Workspace 完整宿主 | 图表、来源、追踪和证据有足够空间 | 768/1280 可用，刷新状态一致 |
| PX-REQ-006 | 标签页复用 | 不产生重复 Workspace | 20 次重复打开只保留一个匹配 tab |
| PX-REQ-007 | 刷新与恢复 | 研究上下文不中断 | Back/Forward/Refresh/关闭重开均有确定结果 |
| PX-REQ-008 | 断连与重连 | FAMS 或 extension 短暂中断可恢复 | 5 秒内显示 restored 或明确 blocked |
| PX-REQ-009 | 幂等与重复 ingest | 防止重复任务和数据副作用 | dispatch 前落 ledger；同 key 同 payload 重放；不同 payload hard fail；未知结果不自动重试 |
| PX-REQ-010 | 真实 Chrome 证据 | 人类能确认真实扩展运行 | extension URL、ID、版本、trace、事件、hash、SHA 齐全 |
| PX-REQ-011 | 四类 viewport | 侧栏与完整页都可正常使用 | 360/420/768/1280 均无根级横向溢出 |
| PX-REQ-012 | 隐私与证据脱敏 | 截图和证据不泄露敏感信息 | secret/cookie/token/账户原图提交数为 0 |
| PX-REQ-013 | FAMS 有界领域适配 | 复用本地已有 Chat/Review/Operation | 只读视图与受控 Ask 分离；五 intent 不复制投资计算，合同通过 |
| PX-REQ-014 | Background 单写状态 | 三入口不会各自写出冲突状态 | 所有状态变更均有 background event |
| PX-REQ-015 | 最小权限连接 | 用户知道扩展访问哪些本地地址 | 安装默认 host 权限为空；授权由用户动作触发；无 `<all_urls>` |
| PX-REQ-016 | 简明摘要与高级证据分层 | 普通用户不用阅读原始字段 | 首屏包含结论/依据/可信度/下一步；evidence 默认折叠 |
| PX-REQ-017 | 完整降级状态 | 未连接、加载、空、失败、恢复、阻断都可理解 | 6 状态均有可读原因和下一步 |
| PX-REQ-018 | 投资交易硬边界 | 产品化不会误开放交易 | 四个交易锁恒 false；broker order 请求为 0 |
| PX-REQ-019 | 可访问性和键盘操作 | 窄屏和键盘用户可以完成核心路径 | 44px 点击区、4.5:1 对比度、focus-visible、核心路径可键盘完成 |
| PX-REQ-020 | 可审计文档与防规格漂移 | 开发结果能与 PRD 逐项比较 | 20/20 traceability、G1～G7、负例和 commit 复核通过 |

## 8. 五类 Intent 的业务定义

| Intent | 首期定义 | 复用的 FAMS 事实 | 非目标 |
| --- | --- | --- | --- |
| `source_library` | Operation artifact 和 Daily Review evidence 的统一只读索引 | `operationService`、`dailyReviewService` | 不建设通用互联网收藏系统 |
| `source_detail` | 单个来源的摘要、时间、可信状态和关联任务 | artifactRefs、review/operation detail | 不把任意网页全文自动入库 |
| `ask` | 进入问答视图；提交问题由独立 operation command 完成 | `famsChatService` 的结构化结果 | 不开放无约束工具调用或自动确认 |
| `trace` | Operation timeline 和复盘步骤追踪 | `operationService`、workflow | 不展示仅内部可读的 secret |
| `graph` | Daily Review DAG 和 evidence 关联图 | `dailyReviewWorkflowService` | 不新增知识图谱数据库或投资模型 |

## 9. 数据、权限和状态边界

1. FAMS 后端继续拥有持仓、复盘、Operation 和 artifact 的业务真相。
2. PX background 只拥有 route、correlation、idempotency、容器和恢复状态；Ask 结果的业务真相继续属于 FAMS Chat 会话。
3. `chrome.storage.local` 只保存最小恢复索引，不保存原始截图、cookie、token 或完整账户数据。
4. 安装时不默认请求主机权限；用户点击“连接本地 FAMS”后，只能授予后端 `localhost/127.0.0.1:4000`。前端 3000 只用于 Host App 外部消息 allowlist，不属于扩展 host permission。
5. PX-1 仅验证本地单用户开发环境，不宣称生产身份与远程安全已经完成。
6. PX Core 保持领域无关；FAMS adapter 继续执行研究与交易边界。

## 10. 质量需求

### 10.1 可靠性

- 状态摘要必须由 lifecycle events 推导。
- GET/health 具有超时和有限退避；POST Ask dispatch 后禁止自动重试，未知结果必须显式阻断。
- 活动任务终止或所有容器关闭后停止后台轮询。
- 恢复失败必须显示 blocked，不得静默清空或显示 success。

### 10.2 安全与隐私

- CSP 只允许 self，禁止远程可执行代码。
- 禁止 `<all_urls>`、cookie 复制、token 写入证据。
- host app 外部消息校验 sender origin、schema、permission 和 payload。
- evidence collector 输出到 Git 忽略的私有目录。

### 10.3 可维护性

- Background、UI container、FAMS adapter、acceptance collector 依赖方向单向。
- 不从 extension 直接 import 后端业务服务。
- 不复制 Daily Review 或 Operation 的计算逻辑。
- 目标代码实体必须保持与 `V2_PX_TARGET_ARCHITECTURE.md` 一致。

## 11. 非目标

本阶段明确不做：

- 新投资策略、行情 provider、估值模型或 LLM 模型升级。
- 正式交易、券商订单、自动买卖或交易权限解锁。
- Chrome Web Store 发布、远程多用户部署和生产身份系统。
- 通用网页全文抓取、通用知识库或新图数据库。
- 用 Side Panel 替代全部 FAMS 页面。
- 用静态 HTML、设计稿截图或 mock URL 作为真实 Chrome 验收。
- 在用户批准前创建 extension package 或修改生产源码。

## 12. 里程碑与出门声明

| 里程碑 | 用户可感知结果 | 出门声明 |
| --- | --- | --- |
| M0 文档重构 | 人类能从 PRD、原型和 8 页图判断目标与风险 | `documentationReadyForImplementationReview=true` |
| M1 PX-1 feasibility | 真实 Chrome 中能启动双容器并跑通最小路由 | `routeATechnicallyValidated=true`，不代表产品完成 |
| M2 PX-2 Workspace/API | 完整页读取真实 bounded facade，显示五 intent 与恢复 | `workspaceHostAccepted=true` |
| M3 PX-3 Side Panel | 轻入口、摘要和跳转可用 | `sidePanelEntryAccepted=true` |
| M4 PX-4 Router/Adapter | 三入口同语义、标签复用、FAMS read model 可用 | `intentAndAdapterAccepted=true` |
| M5 PX-5 Lifecycle | 刷新、断连、重开和 reload 可恢复 | `dualContainerLifecycleAccepted=true` |
| M6 PX-6 Candidate | 真实 Chrome、G1～G7、HTML 和人工体验核查完成 | `v2PxProductizationCandidate=true` |

M6 仍不表示正式交易、生产身份或 Chrome Web Store 发布可用。

## 13. 当前出门条件

本轮文档阶段只有在以下条件满足后才可请求用户批准进入 PX-1：

```text
prdRequirementTraceability=20/20
targetArchitectureEntityMappingComplete=true
apiRuntimeContractDecisionChecks=40/40
prototypeStateMatrixComplete=true
drawioPages<=8
drawioChinese=true
acceptanceScenariosHavePreconditionStepsThresholdEvidenceOwner=true
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
productionCodeChanged=false
```

真实实现和 Chrome 证据仍从 PX-1 开始；在用户明确批准前，`px1FeasibilitySpikeAllowed` 必须保持 `false`。
