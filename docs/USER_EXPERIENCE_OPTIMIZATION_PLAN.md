# FAMS 用户体验优化开发与验收计划

更新时间：2026-07-07

2026-07-07 补充：当前人工体验反馈认为前端基础功能可见，但视觉统一性、卡片交互质感、Dashboard 信息密度和资产本地数据入口仍不达标。该问题已进入 UX-F7 实现与验收闭环，代码层已补齐统一设计风格、卡片按压反馈、资产 Excel 导入导出、Dashboard 图标与空白密度，并生成专项审计与截图证据。

## 1. 阶段定位

当前网页基础功能已经通过人工验收，但普通用户或无财经背景用户仍难以快速理解界面。下一阶段新增独立开发目标：

```text
ordinaryUserExperienceReady=true
expertModeAvailable=true
plainLanguageDecisionPathRequired=true
frontendComplexityReduced=true
formalTradingUnlocked=false
autoTradeUnlocked=false
dualTrackExperienceDocumented=true
chatBoxWorkbenchPrimaryPathDocumented=true
expertModuleTabsPreserved=true
productVisualRefreshReady=true
visualStyleUnified=true
cardPressFeedbackReady=true
assetExcelImportExportReady=true
dashboardIconAndDensityReady=true
implementationEntityStatusIndexed=true
drawioEntityStatusExplicit=true
```

本计划不改变交易边界。红利低波、组合回测、人工计划草案仍只能用于研究、观察、比较和人工复核；不得因为界面简化而隐藏数据不足、模型验证不足或正式交易阻断。

2026-06-30 ChatBox / AgentCore 补充定位：

```text
chatBoxFirstClassTargetDocumented=true
chatBoxV1Integrated=true
piAgentCoreRuntimeIntegrated=true
chatBoxBusinessEntryReady=true
chatBoxUxOptimized=true
plainLanguageChatResultReady=true
guidedTaskEntryReady=true
dataHealthExplanationReady=true
piLlmAgentLoopEnabled=partial_controlled_intent_router
chatSessionPersistenceReady=true
chatStreamingReady=true
fullBusinessToolCoverageReady=true
inlineChartResultReady=true
ordinaryUserWorkbenchReady=true
expertModuleDeepUseReady=true
```

ChatBox 是第一业务入口和体验解释层的一部分，用于帮助用户查询候选、组合、任务、回测入口和阻断原因。当前阶段已完成任务式入口、普通话结构化回复、数据健康提示、对话内结构化图表、SSE 流式事件、Operation 联动、审计追溯和交易阻断验收。它可以发起需要二次确认的扫描、刷新和人工计划草案，但不能创建订单、不能输出正式 ADD / REDUCE，也不能绕过 validation、audit 或 trade gate。ChatBox 后续增强重点是完整多轮上下文记忆和更强 tool-calling agent loop，不阻断当前 UX 出门。ChatBox 后续完整集成计划维护在 `docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md`，全业务覆盖范围维护在 `docs/CHATBOX_TOOL_COVERAGE_MATRIX.md`。

## 2. 目标体验

用户进入系统后，应能在 30 秒内回答四个问题：

1. 我现在应该先看哪里？
2. 系统目前给我的结论是什么？
3. 这个结论可信吗，哪里还不可信？
4. 下一步我能做什么，哪些动作不能做？

默认界面面向普通用户：

- 首屏优先显示“当前状态、推荐查看路径、关键结论、风险提示、下一步按钮”。
- 专业分数、字段级证据、validation matrix、审计 artifact 默认折叠。
- 所有财经术语必须有简短解释，例如“股息率”“低波动”“回撤”“benchmark”“数据可信度”。
- 所有交易相关文案必须使用“观察区间 / 人工计划草案 / 待复核”，不得使用“买入建议 / 卖出建议 / 可下单”。

专业模式面向审计用户和高阶用户：

- 可展开查看完整候选表、分数明细、字段级 evidence、API artifact、模型验证和审计包路径。
- 专业模式不得替代默认模式，不能要求普通用户先理解审计术语才能完成基本任务。

## 2.1 双轨体验架构

本阶段 UX 目标不是废弃现有多 Tab / 多模块系统，而是把入口分层：

```text
普通用户默认路径：
ChatBox -> 任务工作台 -> 结果摘要 -> 数据可信/交易阻断 -> 必要时跳转详情

资深用户深度路径：
左侧菜单 / 多 Tab 模块 -> 红利低波、组合回测、任务、审计、持仓等页面直接操作
```

产品体验定义：

- ChatBox 是普通用户默认入口，负责自然语言理解、任务推荐、结果摘要、图表展示、下一步行动和阻断解释。
- 任务工作台承接 ChatBox 的结果，把“候选、组合回测、任务状态、人工计划草案、审计链接”整理成低认知负担的操作路径。
- 现有专家模块页保留，作为资深用户和审计用户的深度工作台；不得因为 ChatBox 优化而删除专业表格、筛选、排序、证据、artifact 和 validation 入口。
- ChatBox 与专家模块页必须共享同一套 API、服务、审计产物和交易 gate；ChatBox 只是入口和解释层，不是绕过系统的独立智能体。

典型普通用户路径：

```text
打开系统 -> 看到 ChatBox 和“今天先做什么”任务工作台
-> 输入“对比永久组合和全天候组合最近三年收益和最大回撤”
-> ChatBox 返回摘要、指标卡、收益曲线、回撤曲线、数据可信和非交易提示
-> 用户点击“查看完整工作台”
-> 工作台展示回测详情、证据、数据缺口和审计链接
-> 需要深入时跳转 Backtest 专家页面
```

典型资深用户路径：

```text
打开系统 -> 直接进入左侧菜单中的 DividendLowVol / Backtest / Operations / Audit
-> 使用筛选、排序、参数配置、完整指标、字段级 evidence 和 artifactRefs
-> 必要时调用 ChatBox 解释当前页面结果或继续追问
```

视觉体验目标：

- 默认视觉方向为“light-first、通透、低噪音、专业财富管理工作台”，避免当前深紫/深蓝高饱和监控台观感继续扩散。
- 专家模块可以保留更高信息密度，但必须遵守统一设计 token、状态色、排版层级和可访问性标准。
- 普通用户工作台优先使用结论卡、任务卡、摘要图表和折叠证据；专家细节默认不占据首屏。

## 2.2 实体状态矩阵

本阶段文档和 drawio 必须直接标注每类代码实体的状态，不能只用“数据层 / 策略层 / 展示层”等抽象词。状态定义如下：

| 状态 | 图中颜色 | 代表含义 | 当前实体 |
| --- | --- | --- | --- |
| 已开发基础 | 灰色 | 现有代码路径已经存在，可作为后续 UX 改造依赖 | `FamsChatBox.tsx`、`AppLayout.tsx`、`Dashboard.tsx`、`DividendLowVol.tsx`、`Backtest.tsx`、`Operations.tsx`、`backend/src/routes/chat.ts`、`famsChatService`、`chatLlmPlannerService`、`piAgentCoreAdapter`、`PortfolioBacktestEngine`、`dividendLowVolStrategyService`、`DividendLowVolDaily`、`market_bar_canonical`、`acceptance-report.html` |
| 本阶段已修改 | 黄色 | 已有入口或能力已按 UX-F7 收口，但后续仍需保持一致性回归 | ChatBox 任务入口、普通话回复层级、技术细节折叠、数据健康提示、Dashboard 工作台承接、资产本地账本入口、视觉降噪和可访问性 |
| 本阶段已新增 / 已补齐 | 橘黄 | 目标体验所需的新入口、审计产物或截图证据已生成 | `UserTaskWorkbench`、资产 Excel 导出接口、`frontend_visual_system_audit.json`、`asset_excel_flow_audit.json`、`dashboard_visual_density_audit.json`、`frontend_runtime_visual_acceptance.json`、`trade_boundary_wording_audit.json`、`acceptance-report.html` |
| 硬边界 | 红色 | 不因 UX 优化改变，任何入口都不能绕过 | `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false`、禁止 `ADD / REDUCE / ORDER_CREATE / AUTO_TRADE` |

实体关联关系必须在 drawio 中体现为：

```text
ChatBox / 工作台展示层
-> 现有页面与 API
-> 现有策略服务和数据证据
-> Operation 与审计产物
-> Trade Gate 硬边界
-> 用户可理解结果
```

不允许把 ChatBox 目标画成替代原多 Tab 专家系统；也不允许把专家页画成被删除、弱化或隐藏的旧入口。

## 2.3 2026-07-03 UX 基线检视结论

本轮只读检视使用桌面和移动端页面截图、样式检索和可访问性抽样完成。结论是：当前功能链路存在，但普通用户体验仍不达标，下一阶段必须先修复体验基线，再继续扩大功能。

关键问题：

1. **移动端外壳失衡**：移动端左侧导航仍常驻，占用过多横向空间，导致 Dashboard、红利低波、策略回测和任务中心主内容被挤成窄列。
2. **视觉系统过重**：页面被深蓝、深紫、深灰卡片主导，存在工程监控台观感，缺少 light-first、通透、低噪音的财富管理工作台气质。
3. **硬编码样式扩散**：`#0f172a`、`#111827`、`border-white/10`、深色半透明卡片等样式分散在页面中，未完全收敛到设计 token。
4. **普通模式仍技术化**：普通用户仍会看到 `validation_evidence`、`free_source_total_return`、`sqlite_lightweight_health_gate`、provider、raw blocker、artifactRefs 等内部术语。
5. **按钮和标签密度过高**：红利低波、回测和任务中心存在小按钮、状态标签、警示卡片堆叠，主结论、下一步和证据详情的层级不够清晰。
6. **ChatBox 第一入口不够强**：ChatBox 已经接入，但仍像解释浮层和快捷问题集合，尚未成为“普通用户默认从这里完成任务”的主路径。

这些问题不改变当前交易边界。它们在 2026-07-03 基线时曾阻止以下状态被声明为 true；该块是历史基线，不是当前有效状态：

```text
ordinaryUserExperienceReady: false at 2026-07-03 baseline
frontendComplexityReduced: false at 2026-07-03 baseline
chatBoxExperienceOptimized: false at 2026-07-03 baseline
productVisualRefreshReady: false at 2026-07-03 baseline
ordinaryUserWorkbenchReady: false at 2026-07-03 baseline
```

2026-07-07 UX-F7 实现与复验后，本阶段可声明：

```text
ordinaryUserExperienceReady=true
frontendComplexityReduced=true
productVisualRefreshReady=true
ordinaryUserWorkbenchReady=true
visualStyleUnified=true
cardPressFeedbackReady=true
assetExcelImportExportReady=true
dashboardIconAndDensityReady=true
```

下一阶段验收必须把这些问题转成可检查证据：

- 桌面 1440px、平板 768px、移动端 390px 截图必须证明主路径可读。
- 移动端主内容不得被常驻侧栏挤压。
- 页面不得继续被深紫/深蓝高饱和色主导。
- 普通模式主视图不得只展示内部枚举、provider、raw blocker 或 artifactRefs。
- ChatBox 主视图必须展示任务入口、结论、关键数字、下一步、数据可信和证据详情。
- 专家页必须保留，但默认路径必须优先 ChatBox + 工作台。

## 3. 设计原则

| 原则 | 说明 | 不允许出现 |
| --- | --- | --- |
| 先结论后细节 | 每页顶部先给状态和下一步，再给表格和指标 | 首屏只出现复杂表格、分数和技术标签 |
| 普通话解释 | 财经术语用一句话解释 | 只展示英文状态、字段名或内部枚举 |
| 渐进披露 | 默认简单，点击展开高级指标 | 把所有审计字段平铺在主界面 |
| 状态一致 | 红利低波、回测、任务中心使用同一套状态词 | 同一状态在不同页面叫法不同 |
| 不隐藏风险 | 简化界面但必须保留数据不足和交易锁定 | 用“体验优化”弱化 blocker |

## 4. 开发计划

### UX-1 全局信息架构重排

目标：把当前“功能菜单集合”重排为用户任务路径。

实现实体：

- `frontend/src/components/layout/AppLayout.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/DividendLowVol.tsx`
- `frontend/src/pages/Backtest.tsx`
- `frontend/src/pages/Operations.tsx`
- `frontend/src/components/chat/FamsChatBox.tsx`

开发内容：

- 左侧菜单保留现有入口，但每个页面顶部增加“本页能做什么 / 适合谁 / 下一步”的简短说明。
- Dashboard 增加“今日从这里开始”区块，推荐进入红利低波、策略回测或任务审计。
- 红利低波页面默认显示 5 步工作台：看状态、筛候选、看区间、跑回测、生成草案。
- 回测页面默认显示 3 步路径：选策略、选时间、看曲线与阻断。
- ChatBox 默认提供“红利低波前三候选 / 当前组合情况 / 最近任务状态 / 为什么不能下单”四类快捷问题，并用行动卡跳转到对应页面。
- ChatBox 后续第一公民目标必须支持“永久投资组合 vs 全天候投资组合最近三年收益和最大回撤”的对话内 quick-run 比较，并返回收益曲线、回撤曲线、指标卡、数据缺口和非交易建议提示。

验收标准：

- 用户无需阅读文档即可知道下一步入口。
- 首屏不能只展示复杂表格。
- 移动端和桌面端均可看到页面目的和下一步按钮。
- ChatBox 首屏必须显示“研究模式 / 不创建订单 / 正式交易仍锁定”的边界说明。
- ChatBox 的结构化结果不得只返回自然语言；组合比较类结果必须能落到图表 payload 或明确说明当前缺口。

### UX-2 普通模式 / 专业模式

目标：降低普通用户理解成本，同时保留审计完整性。

实现实体：

- 新增 `frontend/src/components/common/ExperienceModeToggle.tsx`
- 新增 `frontend/src/components/common/PlainLanguageHelp.tsx`
- 改造 `frontend/src/pages/DividendLowVol.tsx`
- 改造 `frontend/src/pages/Backtest.tsx`

开发内容：

- 默认 `普通模式`：展示结论卡、关键风险、下一步动作。
- `专业模式`：显示完整指标表、字段级证据、validation matrix、审计路径。
- 用户偏好保存到 localStorage。
- 专业模式切换不改变后端结果，只改变展示层。

验收标准：

- 首次进入页面默认普通模式。
- 普通模式下用户仍能看到数据可信度和交易锁定。
- 专业模式下完整审计字段仍可访问。

### UX-3 红利低波结论卡重构

目标：把“分数堆叠”改成“这只股票为什么值得观察 / 为什么不能进入草案 / 当前处于什么区间”。

实现实体：

- `frontend/src/pages/DividendLowVol.tsx`
- 新增 `frontend/src/components/dividend-low-vol/DividendLowVolDecisionCard.tsx`
- 新增 `frontend/src/components/dividend-low-vol/DividendLowVolMetricGlossary.tsx`

开发内容：

- 候选列表默认展示：
  - 结论：可研究 / 仅观察 / 数据不足 / 风险剔除
  - 原因：最多 3 条普通话解释
  - 当前区间：低位观察 / 中性 / 高位观察 / 需刷新后重算
  - 数据可信：可信 / 需复核 / 不足
  - 下一步：查看详情 / 生成观察草案 / 刷新数据 / 查看阻断
- 完整分数放入详情抽屉或专业模式。
- 每个指标有 tooltip 或解释面板。

验收标准：

- 普通用户不需要理解 `evidenceAdjustedScore` 也能看懂候选状态。
- 每个候选至少显示一条“为什么是这个状态”的自然语言原因。
- 被剔除或数据不足的标的必须显示明确原因。

### UX-4 策略回测可读性重构

目标：让用户看懂不同投资组合策略在不同时间段下的结果，而不是只看到曲线和指标。

实现实体：

- `frontend/src/pages/Backtest.tsx`
- 新增 `frontend/src/components/backtest/PortfolioBacktestSummaryCard.tsx`
- 新增 `frontend/src/components/backtest/StrategyComparisonExplainer.tsx`

开发内容：

- 回测结果顶部显示：
  - 哪个策略收益最高
  - 哪个策略回撤最低
  - 哪个策略数据最可信
  - 哪些策略只能研究观察
- 把 Sharpe、Calmar、最大回撤、超额收益转换成普通解释。
- 支持“为什么这个策略没有通过”的 blocker 摘要。

验收标准：

- 用户能在结果页 10 秒内知道哪条策略表现更稳、哪条收益更高、哪条数据不足。
- 曲线、表格和解释文案一致，不得相互矛盾。
- 正式交易锁定提示必须始终可见。

### UX-5 审计与任务中心人类可读

目标：让非开发者也能理解任务和审计包代表什么。

实现实体：

- `frontend/src/pages/Operations.tsx`
- `scripts/full-system-e2e-acceptance.mjs`
- `backend/scripts/generate-interactive-strategy-backtest-audit-package.ts`

开发内容：

- Operation 展示“这个任务做了什么 / 成功还是失败 / 产物在哪里 / 能否用于交易”。
- ChatBox 展示工具调用的用户含义，例如“这是读取候选池”“这是启动扫描，需确认”“这是被交易 gate 阻断”。
- 审计报告增加普通用户摘要：
  - 当前能做什么
  - 当前不能做什么
  - 证据有哪些
  - 下一步需要补什么
- 审计包文件名旁显示用途说明。

验收标准：

- 审计报告不只服务开发者，也能让业务用户理解。
- 任务中心每条关键任务都有用户可读状态。
- 审计报告不得把 formal-review-ready 写成 formal-trading-ready。

### UX-6 可访问性与视觉降噪

目标：提升可读性、扫描效率和无障碍基础质量。

实现实体：

- `frontend/src/index.css`
- `frontend/src/pages/DividendLowVol.tsx`
- `frontend/src/pages/Backtest.tsx`
- 公共卡片、标签、表格组件

开发内容：

- 修复响应式外壳：移动端侧栏必须折叠为菜单或轻量入口，主内容获得完整宽度；桌面端保持左侧专家导航。
- 建立设计 token：背景、表面、边框、文字、状态色、间距、圆角和阴影统一定义；页面不得继续散落硬编码深色卡片。
- 视觉方向改为 light-first、低噪音、通透、专业财富管理工作台；深色模式后续可作为主题，而不是默认唯一风格。
- 减少一屏内彩色标签数量，建立统一状态色：
  - 绿色：可研究/已通过
  - 黄色：需复核/警告
  - 红色：阻断/风险
  - 灰色：不适用/历史信息
- 表格默认隐藏低频专业列，支持“显示全部指标”。
- 增加空状态、加载状态和错误状态的普通话解释。
- 保证按钮、卡片、标签文字不溢出。
- 核心路径满足键盘可达和 WCAG AA 对比度要求。

验收标准：

- 移动端截图中，左侧导航不得常驻挤压主内容；Dashboard、红利低波、回测和任务中心的主标题、主要按钮和首屏卡片必须完整可读。
- `frontend_ux_consistency_audit.json` 必须记录硬编码深色样式数量、低对比度抽样、小按钮抽样、文字溢出和移动端主内容宽度。
- 红利低波和回测页面截图中不得出现明显文字溢出或标签堆叠不可读。
- 关键操作按钮名称必须是动词短语，例如“查看区间”“运行回测”“查看阻断”。
- 自动化截图覆盖桌面、平板和移动端。

### UX-7 / CB-F ChatBox 对话体验深度优化

目标：把当前偏技术调试面板的 ChatBox 改造成普通用户能理解、能继续操作、能看清边界的第一业务入口。该阶段承接 `CHATBOX_FIRST_CLASS_ACCEPTANCE_PLAN.md` 的功能链路，不扩大工具权限，不改变交易 gate。

实现实体：

- `frontend/src/components/chat/FamsChatBox.tsx`
- 后续拆分组件：`ChatLauncher`、`ChatPanel`、`WelcomeTaskBoard`、`AssistantMessage`、`StructuredResultRenderer`、`ActionCardList`、`DataHealthNotice`、`AgentStatusDetails`
- `backend/src/services/chat/famsChatService.ts`
- `backend/src/services/chat/famsChatTypes.ts`
- `backend/src/routes/chat.ts`

开发内容：

- ChatBox 首屏从长文本快捷问题改为任务卡，按“今天先看什么 / 对比组合策略 / 分析红利低波 / 解释不能交易 / 查看任务审计”组织。
- 助手回复统一为“结论 / 关键数字 / 下一步 / 数据可信 / 证据详情”。证据、provider、mode、内部状态码默认折叠。
- 数据异常、SQLite 损坏、provider 不可用、数据不足时，显示普通话数据健康提示和安全下一步，不直接暴露 `HTTP 400/500` 或原始异常。
- 组合策略对比、红利低波候选、单票观察区间、任务状态和交易阻断都必须返回用户可读摘要。
- 需要副作用的扫描、刷新、持久化回测、人工计划草案继续使用确认卡；确认卡必须说明“会创建什么、不会创建订单、在哪里查看结果”。
- 消息级操作支持“重试 / 复制 / 打开相关页面 / 查看证据 / 继续追问”。
- 技术状态，例如 LLM provider、key 状态、planner mode、AgentCore runtime，移入“技术状态”折叠区。

验收标准：

- 普通用户打开 ChatBox 后，不输入也能看到 3 个以上清晰任务入口。
- 每条助手回复主视图必须包含一句话结论和下一步动作。
- 主视图不得只展示 raw `blockedReasons`、`evidenceRefs`、provider、mode 或内部枚举。
- 数据异常必须展示 `DataHealthNotice` 风格的用户可读解释和恢复路径。
- “为什么不能下单”必须明确 `canCreateOrder=false`、`orderCreateAllowed=false`、`formalTradingUnlocked=false`、`autoTradeUnlocked=false`。
- 组合策略对比结果必须在对话框内显示指标卡、收益曲线、回撤曲线、数据可信度和非交易建议提示。
- 移动端和桌面端截图不得出现文字溢出、图表遮挡或按钮挤压。
- 不得出现“可交易、可下单、正式买入、正式卖出、自动交易、自动再平衡已启用”等误导文案。

### UX-8 产品级双轨体验与视觉系统重构

目标：在 UX-7 / CB-F ChatBox 体验优化之后，把全站从“模块堆叠的工程后台”升级为“ChatBox + 工作台优先、专家模块保留”的双轨体验。

执行顺序：

```text
先完成 UX-7 / CB-F：
任务式 ChatBox、普通话结果、数据健康提示、技术细节折叠、移动端可读。

再进入 UX-8：
产品级用户旅程、工作台承接页、统一视觉系统、专家模块视觉降噪。
```

实现实体：

- `frontend/src/components/layout/AppLayout.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/components/chat/FamsChatBox.tsx`
- `frontend/src/pages/DividendLowVol.tsx`
- `frontend/src/pages/Backtest.tsx`
- `frontend/src/pages/Operations.tsx`
- 后续新增普通用户工作台组件：`UserTaskWorkbench`、`JourneyStepper`、`DecisionSummaryCard`、`EvidenceDrawer`、`DataTrustPill`、`RiskBoundaryBanner`

开发内容：

- 首页和 ChatBox 共同形成普通用户主路径：今日状态、推荐任务、最近结果、继续追问、查看完整工作台。
- 专家模块页继续存在，但在导航和页面标题中明确标记为“深度工作台 / 专业模式”。
- ChatBox 结果必须能跳转到对应工作台状态，而不是只跳到原始复杂表格。
- 每个专家页面提供“用 ChatBox 解释当前结果”的反向入口。
- 建立统一视觉 token：浅色优先、低饱和中性色、少量语义状态色、柔和边框、稳定间距、可访问对比度。
- 禁止只通过换色解决 UX 问题；必须同时完成信息架构、层级、工作台和专家路径分离。

验收标准：

- 普通用户不进入专家页面，也能通过 ChatBox + 工作台完成：候选查询、组合对比、观察区间解释、任务状态和交易阻断理解。
- 资深用户仍能通过左侧菜单直接进入各模块完成筛选、排序、参数配置、完整指标查看和审计追踪。
- ChatBox 到工作台、工作台到专家页、专家页回到 ChatBox 的三类跳转均可被 E2E 截图证明。
- 视觉验收必须证明页面不再被深紫/深蓝高饱和色主导，状态色数量受控，文字不溢出，卡片不嵌套卡片。
- 交易边界保持显眼：`formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false`。

### UX-F0 到 UX-F6 下一阶段执行顺序

为避免“只换颜色但认知负担不变”，下一阶段实际开发必须按以下顺序推进：

| 子阶段 | 目标 | 主要实体 | 出门验收 |
| --- | --- | --- | --- |
| UX-F0 基线证据 | 固化当前问题和截图证据 | `frontend_ux_consistency_audit.json`、E2E 截图脚本 | 记录移动端侧栏、硬编码深色、小按钮、低对比度和文字溢出基线；必须包含 1440px、768px、390px 截图 |
| UX-F1 ChatBox 任务入口 | 让普通用户打开系统就知道先做什么 | `FamsChatBox.tsx`、`WelcomeTaskBoard`、`ActionCardList` | 至少 3 个任务卡；主视图明确研究模式和不能下单 |
| UX-F2 普通话结果层级 | 把技术输出变成结论、数字、下一步、可信度、证据 | `AssistantMessage`、`StructuredResultRenderer`、`PlainLanguageHelp` | 每条核心回复都有一句话结论和下一步，技术详情默认折叠 |
| UX-F3 数据健康和交易边界 | 让错误和阻断可理解 | `DataHealthNotice`、`RiskBoundaryBanner`、trade gate 文案审计 | 不直接暴露 raw HTTP/SQLite/provider 错误；禁止动作始终清楚 |
| UX-F4 响应式外壳 | 修复移动端主内容被侧栏挤压 | `AppLayout.tsx`、全局导航、页面容器 | 390px 移动截图主内容完整，按钮不挤压，图表不裁切 |
| UX-F5 双轨工作台 | 普通用户走 ChatBox + 工作台，资深用户走专家页 | `Dashboard.tsx`、`UserTaskWorkbench`、`ExpertPageChatExplain` | ChatBox->工作台、工作台->专家页、专家页->ChatBox 三条路径通过 |
| UX-F6 视觉系统收口 | 建立产品级统一视觉 | `index.css`、公共卡片/按钮/标签/表格组件 | 浅色优先、状态色受控、无卡片嵌套卡片、无明显溢出 |
| UX-F7 视觉质感与资产 Excel 体验收口 | 修复色块不均、卡片无按压反馈、Dashboard 空白和图标不足、资产无本地数据入口 | `index.css`、`Dashboard.tsx`、`Assets.tsx`、`frontend/src/components/common/*`、`backend/src/routes/asset.ts`、`backend/src/routes/template.ts` | 统一 token 覆盖核心页面；卡片 hover/active/focus/disabled 状态可感知；Dashboard 卡片有语义图标且密度合理；资产可下载模板、预览导入、确认导入、导出当前资产 Excel |

UX-F0 到 UX-F7 完成并通过截图验收前，不得声明：

```text
ordinaryUserExperienceReady=true
frontendComplexityReduced=true
chatBoxExperienceOptimized=true
productVisualRefreshReady=true
```

### UX-F7 视觉质感与资产 Excel 体验收口

目标：在不删除 ChatBox、工作台或专家多 Tab 的前提下，解决当前人工体验反馈中的四类问题：页面色块不均、卡片缺少力感按压反馈、资产管理缺少本地数据入口、Dashboard 空白过多且缺少图标。该阶段仍只改善体验和资产数据维护入口，不改变策略计算、数据可信判断或交易 gate。

实现实体：

- `frontend/src/index.css`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/Assets.tsx`
- `frontend/src/components/common/*`
- `backend/src/routes/asset.ts`
- `backend/src/routes/template.ts`
- 现有免费开源图标：`@ant-design/icons`
- 现有 Excel 解析依赖：`xlsx`

开发内容：

1. **统一视觉 token 与色块规则**
   - 以 light-first 财富管理工作台为默认视觉方向，定义背景、表面、边框、文字、阴影、状态色、图标色和交互色 token。
   - 核心页面不得继续散落 `bg-[#...]`、深紫深蓝半透明卡片、局部自定义边框和不一致状态色。
   - Dashboard、资产、红利低波、回测、任务中心、ChatBox 必须共用同一套卡片、按钮、标签、表格和数据健康提示样式。

2. **卡片力感与可访问交互**
   - 卡片必须具备 default / hover / active pressed / focus-visible / disabled / loading / empty 状态。
   - pressed 状态使用轻微位移、阴影压低和边框强调表达“被按下”，不得使用夸张动效。
   - 所有可点击卡片必须有明确 cursor、键盘 focus、ARIA label 或可读按钮文本。

3. **Dashboard 图标与密度**
   - 总览关键卡片使用 `@ant-design/icons` 中的免费开源图标，例如资产、收益、风险、任务、回测、红利低波、交易锁定等语义图标。
   - 解决卡片之间空白过多的问题：建立 12/16/24px 间距层级，首屏优先展示状态摘要、资产数据入口、ChatBox 任务入口和最近审计状态。
   - 空状态必须指向资产 Excel 导入或示例模板，不得只显示空数字。

4. **资产 Excel 导入 / 导出路径**
   - 保留当前已有 `/api/v1/assets/template`、`/api/v1/assets/parse`、`/api/v1/assets/import`。
   - 下一阶段新增或完善 `GET /api/v1/assets/export?userId=default`，导出当前本地资产、交易记录和字段说明。
   - `Assets.tsx` 必须提供“下载模板 -> 上传预览 -> 校验错误 -> 确认导入 -> Dashboard 刷新”的完整路径。
   - 默认用户无资产时，Dashboard 和资产页显示“导入 Excel 开始维护本地持仓”，并提供模板下载。
   - Excel 导入只写入本地资产账本，不代表交易下单；导入后仍必须显示数据来源、本地导入时间和可编辑状态。

5. **审计与验收证据**
   - 新增 `frontend_visual_system_audit.json`：统计 token 覆盖、硬编码色块、状态色数量、交互状态覆盖、对比度抽样。
   - 新增 `asset_excel_flow_audit.json`：记录模板下载、解析预览、错误校验、确认导入、导出文件结构。
   - 新增 `dashboard_visual_density_audit.json`：记录首屏卡片数量、空白比例、图标覆盖率、空状态入口和移动端截图。

验收标准：

- `visualStyleUnified=true`：Dashboard、Assets、DividendLowVol、Backtest、Operations、ChatBox 使用统一 token 和组件基线；不得出现明显色块断层。
- `cardPressFeedbackReady=true`：所有可点击卡片有 hover、active pressed、focus-visible 和 disabled 状态；移动端触摸反馈可见。
- `assetExcelImportExportReady=true`：用户能下载模板、上传 Excel、预览校验、确认导入、导出当前资产；导出至少包含“当前持仓 / 交易记录 / 字段说明”。
- `dashboardIconAndDensityReady=true`：总览核心卡片有语义图标，首屏空白减少，空状态能引导用户导入资产或进入 ChatBox。
- `expertModuleTabsPreserved=true`：资产、红利低波、回测、任务、审计等专家入口继续保留，UX-F7 不得把多 Tab 功能砍掉。
- `formalTradingUnlocked=false`、`autoTradeUnlocked=false`、`canCreateOrder=false`、`orderCreateAllowed=false`：Excel 导入、导出、卡片操作和 ChatBox 入口都不得被解释为交易动作。
- 桌面 1440px、平板 768px、移动端 390px 截图必须证明文字不溢出、按钮不挤压、图标不遮挡、卡片间距一致。

### UX-F 硬验收补充

ChatBox 的体验优化不得停留在“把自然语言写得更友好”。核心业务回复必须有结构化 payload，供对话框、工作台、审计报告和 E2E 测试共同复核。最低结构：

```json
{
  "answerLevel": "plain_language",
  "summary": "一句话结论",
  "keyNumbers": [],
  "nextActions": [],
  "dataHealth": {},
  "evidenceRefs": [],
  "technicalDetailsCollapsed": true,
  "prohibitedActions": ["ADD", "REDUCE", "ORDER_CREATE", "AUTO_TRADE"]
}
```

适用范围：

- 红利低波前三候选。
- 单票买卖观察区间解释。
- 永久组合与全天候组合 quick-run 对比。
- 任务 / Operation 状态解释。
- 人工计划草案确认卡。
- 正式交易阻断解释。

`DataHealthNotice` 必须覆盖：

```text
provider unavailable
SQLite risk / DB health issue
data insufficient
artifact missing
operation failed
validation blocker
```

普通模式不得只展示 `HTTP 400`、`HTTP 500`、`Unknown error`、raw provider 异常或 raw SQLite 异常。专业模式可以展开原始错误，但必须先给普通话解释和恢复路径。

双轨工作台必须用截图和审计 JSON 证明三条路径都成立：

```text
ChatBox -> 工作台
工作台 -> 专家页
专家页 -> ChatBox 解释
```

`dual_track_ux_audit.json` 至少包含：

```json
{
  "expertModuleTabsPreserved": true,
  "dividendLowVolPageStillAvailable": true,
  "backtestPageStillAvailable": true,
  "operationsPageStillAvailable": true,
  "analysisPageStillAvailable": true
}
```

`trade_boundary_wording_audit.json` 必须扫描 ChatBox 回复、按钮文案、确认卡、工作台卡片、专家页入口、审计报告 SUMMARY 和 E2E HTML 报告。任何把人工计划草案、quick-run、formal-review-ready 或 tradeActionReadiness passed 解释为可下单、正式交易可用或自动交易可用的文案，都属于重大规格偏差。

## 5. 端到端验收

| 用户场景 | 普通用户通过标准 | 专业用户通过标准 |
| --- | --- | --- |
| 红利低波筛选 | 能看懂 Top 候选为什么可观察、为什么不能交易 | 能展开完整分数、证据和 rejection taxonomy |
| 买卖观察区间 | 能看懂当前是低位、中性、高位或需刷新 | 能看到 priceAudit、tradeDate、sourceType、freshness |
| 组合回测 | 能看懂哪条策略收益高、回撤低、数据不足 | 能查看曲线、指标、benchmark、validation 和 artifact |
| 人工计划草案 | 能看懂草案待复核、不构成交易指令 | 能查看 checklist、blockedReasons 和 gate contract |
| 任务审计 | 能看懂任务是否成功和产物用途 | 能定位审计包和 JSON artifact |
| ChatBox 业务入口 | 能用自然语言找到候选、组合、任务和阻断原因；能看懂结论、下一步和数据健康状态 | 能确认工具、operationId、artifactRefs、技术状态和交易 gate |
| 双轨体验 | 能通过 ChatBox + 工作台完成主流程，不必进入复杂模块 | 能继续使用多 Tab / 多模块页面做深度操作 |
| 视觉系统 | 能快速扫描结论、风险和下一步，界面低噪音且有通透感 | 能在高密度页面中保持可读、可筛选、可审计 |

验收命令：

```bash
cd frontend
npm run build

cd ../backend
npm run test:frontend-ux-consistency
npm run test:portfolio-backtest-frontend-runtime
npm run test:dividend-low-vol-frontend-runtime
npm run run:full-system-e2e-acceptance-report
```

验收证据：

```text
acceptance-report.html
1440px/768px/390px 截图
frontend_ux_consistency_audit.json
prd_spec_review.json
trade_gate_contract.json
chatbox_agentcore_audit.json
chatbox_ux_optimization_audit.json
```

## 6. 出门条件

完成本 UX 阶段后，可以声明：

```text
ordinaryUserExperienceReady=true
expertModeAvailable=true
plainLanguageDecisionPathReady=true
frontendComplexityReduced=true
chatBoxUxOptimized=true
plainLanguageChatResultReady=true
guidedTaskEntryReady=true
dataHealthExplanationReady=true
dualTrackExperienceReady=true
ordinaryUserWorkbenchReady=true
expertModuleTabsPreserved=true
productVisualRefreshReady=true
visualStyleUnified=true
cardPressFeedbackReady=true
assetExcelImportExportReady=true
dashboardIconAndDensityReady=true
formalTradingUnlocked=false
autoTradeUnlocked=false
```

仍不能声明：

```text
不得声明正式交易 ready
不得声明订单创建已允许
不得声明自动交易 ready
不得声明模型有效性已完整验证
不得声明官方 benchmark 已认证
```

<!-- UX_F7_V3_DOC_START -->
## 2026-07-07 UX-F7 v3 目标展示形态补充

本阶段已将 UX-F7 目标从“流程图和架构说明”推进到“可用于代码实现和验收的目标页面展示形态”。本轮实现已以 `docs/prototypes/ux-f7-prototype-review.html` 和 `docs/prototypes/ux-f7-assets/v3/` 作为视觉基线；其中 v3 PNG 是目标页面样式，v2 SVG 仅作为结构说明和模块关系说明。

目标状态：

```text
targetVisualMockupDocumented=true
pageDisplayShapeDocumented=true
moduleVisualDesignDocumented=true
uxF7PrototypeReviewReady=true
uxF7ImplementationAccepted=true
businessCodeChangeAllowed=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

### UX-F7 v3 目标页面

| 页面 | 目标展示形态 | 主要实现实体 | 验收重点 |
| --- | --- | --- | --- |
| Dashboard 普通用户工作台 | `v3/dashboard-visual.png` | `Dashboard.tsx`、`UserTaskWorkbench`、`FamsChatBox.tsx` | 首屏有任务入口、资产导入、研究摘要、交易锁定提示；专家菜单保留。 |
| ChatBox 第一业务入口 | `v3/chatbox-visual.png` | `FamsChatBox.tsx`、`WelcomeTaskBoard`、`StructuredResultRenderer`、`DataHealthNotice` | 任务卡、结构化回复、图表、数据健康、证据折叠和交易边界同屏可理解。 |
| 资产 Excel 本地台账 | `v3/assets-excel-visual.png` | `Assets.tsx`、`backend/src/routes/asset.ts`、`backend/src/routes/template.ts` | 模板下载、上传预览、校验修正、确认导入、导出当前资产闭环。 |
| 组合回测 | `v3/backtest-visual.png` | `Backtest.tsx`、`PortfolioBacktestEngine`、`PortfolioBacktestInputBuilder` | 普通摘要、收益曲线、回撤曲线、策略对比表、专家入口和数据等级。 |
| 红利低波 | `v3/dividend-low-vol-visual.png` | `DividendLowVol.tsx`、`dividendLowVolStrategyService`、`dividendLowVolTradingZoneService` | 候选、观察区间、数据可信、剔除原因和交易阻断同屏可理解。 |
| 任务审计 | `v3/operations-visual.png` | `Operations.tsx`、Operation artifact、审计报告 | 任务状态、失败原因普通话解释、artifact 和审计包入口。 |
| 移动端 Shell | `v3/mobile-visual.png` | `AppLayout.tsx`、响应式导航、Dashboard 移动布局 | 390px 下任务入口、资产入口、ChatBox、底部导航可读且不挤压。 |
| 组件样式板 | `v3/component-kit-visual.png` | `index.css`、公共 Card/Button/Tag/Table/Chart/DataHealth 组件 | 卡片按压、按钮、标签、表格、空状态、数据可信提示使用同一设计系统。 |

### UX-F7 模块级实现边界

- 统一视觉系统必须覆盖 Dashboard、Assets、DividendLowVol、Backtest、Operations、ChatBox，不允许继续按页面各自定义大色块。
- 卡片和按钮必须覆盖 default、hover、active pressed、focus-visible、disabled、loading、empty 状态；移动端触摸反馈必须可见。
- Excel 导入导出只维护本地资产账本，不代表正式持仓变更、下单或自动再平衡。
- ChatBox 是第一入口，但专家多 Tab 仍是一等入口；不得删除或弱化 `Assets / DividendLowVol / Backtest / Operations / Analysis`。
- 任何后续截图、按钮文案、ChatBox 回复或审计报告不得把 quick-run、人工计划草案、Excel 导入或 formal-review-ready 描述为交易执行能力。
<!-- UX_F7_V3_DOC_END -->

## 2026-07-14 文档开发阶段：架构风险闭环与 drawio 重构

更新时间：2026-07-14 15:24:06+08:00

本轮仍处于文档开发阶段，不进入业务代码实现。目标是把当前已认可的开发主线固化为可审查、可执行、可验收的架构文档，避免 drawio 相比前序文档出现信息退化。

### 当前文档修订目标

```text
documentationOnlyStage=true
businessCodeChangeAllowed=false
drawioPageCountLimit=8
drawioCurrentTargetRelationReady=true
implementationEntityStateIndexReady=true
nextStagePlanActionable=true
prdSpecDeviation=none
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

### drawio 第 2 页重构要求

`docs/target-architecture-gap.drawio` 的「当前架构与目标架构差异」页必须采用四列映射，而不是抽象流程图：

| 列 | 必须回答的问题 | 示例实体 |
| --- | --- | --- |
| 当前存量实体 | 当前项目已经有哪些可复用代码、页面、服务、数据或审计产物 | `Dashboard.tsx`、`Assets.tsx`、`FamsChatBox.tsx`、`Backtest.tsx`、`DividendLowVol.tsx`、`chat.ts`、`asset.ts`、`portfolioBacktest.ts` |
| 当前风险 | 为什么当前实现还不能支撑正式交易前置出门 | 市场数据新鲜度 unknown、proxy benchmark、formal validation 不足、普通用户路径复杂、状态词漂移 |
| 目标架构实体 | 下一阶段需要新增或强化的明确代码实体 | `FormalDataProviderService`、`ProviderFreshnessService`、`BenchmarkQualificationService`、`FormalValidationService`、`ManualSignoffService`、`ExecutionIsolationService`、`ReleaseGateService` |
| 验收证据 | 开发完成后如何证明没有规格偏移和虚假验收 | `15_data_governance_audit.json`、`16_benchmark_qualification_audit.json`、`17_formal_validation_audit.json`、`18_manual_signoff_audit.json`、`acceptance-report.html` |

### 不允许出现的文档退化

以下任一情况出现，则不得声明文档阶段出门：

```text
无法从 drawio 判断当前架构与目标架构关系
无法从文档判断 PRD 规格偏移风险
无法从验收章节判断用户如何操作、如何验收、失败如何打回
待开发项被写成已完成
专家多 Tab 被删除或弱化
真实数据缺口、benchmark 缺口、formal validation 缺口被 UX 文案隐藏
出现 formalTradingUnlocked 不得为 true / autoTradeUnlocked 不得为 true / canCreateOrder 不得为 true / orderCreateAllowed 不得为 true
```

### 下一阶段开发仍未完成的明确范围

当前阶段完成后只能说明文档可以支撑下一阶段开发，不能说明正式交易可用。仍未完成：

```text
S2 正式 provider 与字段级数据治理
S3 官方或可信 total-return benchmark
S4 formal validation 与模型有效性验证
S5 人工签核与 release blocker
S6 执行隔离与订单防线
S7 release gate 总验收
S8 完整多轮 tool-calling Agent loop 增强
```

