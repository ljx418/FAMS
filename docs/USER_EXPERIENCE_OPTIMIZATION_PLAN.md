# FAMS 用户体验优化开发与验收计划

更新时间：2026-07-03

## 1. 阶段定位

当前网页基础功能已经通过人工验收，但普通用户或无财经背景用户仍难以快速理解界面。下一阶段新增独立开发目标：

```text
ordinaryUserExperienceReady=false
expertModeAvailable=true
plainLanguageDecisionPathRequired=true
frontendComplexityReduced=false
formalTradingUnlocked=false
autoTradeUnlocked=false
dualTrackExperienceDocumented=true
chatBoxWorkbenchPrimaryPathDocumented=true
expertModuleTabsPreserved=true
productVisualRefreshReady=false
implementationEntityStatusIndexed=true
drawioEntityStatusExplicit=true
```

本计划不改变交易边界。红利低波、组合回测、人工计划草案仍只能用于研究、观察、比较和人工复核；不得因为界面简化而隐藏数据不足、模型验证不足或正式交易阻断。

2026-06-30 ChatBox / AgentCore 补充定位：

```text
chatBoxFirstClassTargetDocumented=true
chatBoxV1Integrated=true
piAgentCoreRuntimeIntegrated=true
chatBoxBusinessEntryReady=false
chatBoxUxOptimized=false
plainLanguageChatResultReady=false
guidedTaskEntryReady=false
dataHealthExplanationReady=false
piLlmAgentLoopEnabled=partial_controlled_intent_router
chatSessionPersistenceReady=true
chatStreamingReady=false
fullBusinessToolCoverageReady=false
inlineChartResultReady=false
ordinaryUserWorkbenchReady=false
expertModuleDeepUseReady=true
```

ChatBox 是第一业务入口和体验解释层的一部分，用于帮助用户查询候选、组合、任务、回测入口和阻断原因。它可以发起需要二次确认的扫描、刷新和人工计划草案，但不能创建订单、不能输出正式 ADD / REDUCE，也不能绕过 validation、audit 或 trade gate。ChatBox 后续完整集成计划维护在 `docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md`，全业务覆盖范围维护在 `docs/CHATBOX_TOOL_COVERAGE_MATRIX.md`。

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
| 开发中 / 需修改 | 黄色 | 已有入口或能力，但体验、状态词、结构化结果、数据健康或视觉层级不达标 | ChatBox 任务入口、普通话回复层级、技术细节折叠、数据健康提示、Dashboard 工作台承接、红利低波结论卡、组合回测摘要、任务中心普通用户摘要、视觉降噪和可访问性 |
| 未开发 / 待新增 | 橘黄 | 目标体验需要新增的前端组件、审计产物或图表承接能力 | `WelcomeTaskBoard`、`AssistantMessage`、`StructuredResultRenderer`、`ActionCardList`、`DataHealthNotice`、`AgentStatusDetails`、`UserTaskWorkbench`、`JourneyStepper`、`ExpertPageChatExplain`、`frontend_ux_consistency_audit.json`、`chatbox_ux_optimization_audit.json`、`dual_track_ux_audit.json` |
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
桌面/平板/移动端截图
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
