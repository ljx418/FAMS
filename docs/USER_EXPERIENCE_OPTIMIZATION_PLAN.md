# FAMS 用户体验优化开发与验收计划

更新时间：2026-06-30

## 1. 阶段定位

当前网页基础功能已经通过人工验收，但普通用户或无财经背景用户仍难以快速理解界面。下一阶段新增独立开发目标：

```text
ordinaryUserExperienceReady=false
expertModeAvailable=true
plainLanguageDecisionPathRequired=true
frontendComplexityReduced=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

本计划不改变交易边界。红利低波、组合回测、人工计划草案仍只能用于研究、观察、比较和人工复核；不得因为界面简化而隐藏数据不足、模型验证不足或正式交易阻断。

2026-06-30 ChatBox / AgentCore 补充定位：

```text
chatBoxV1Integrated=true
piAgentCoreRuntimeIntegrated=true
chatBoxBusinessEntryReady=false
piLlmAgentLoopEnabled=false
chatSessionPersistenceReady=false
chatStreamingReady=false
```

ChatBox 是全局业务入口和体验解释层的一部分，用于帮助用户查询候选、组合、任务、回测入口和阻断原因。它可以发起需要二次确认的扫描、刷新和人工计划草案，但不能创建订单、不能输出正式 ADD / REDUCE，也不能绕过 validation、audit 或 trade gate。ChatBox 后续完整集成计划维护在 `docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md`。

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

验收标准：

- 用户无需阅读文档即可知道下一步入口。
- 首屏不能只展示复杂表格。
- 移动端和桌面端均可看到页面目的和下一步按钮。
- ChatBox 首屏必须显示“研究模式 / 不创建订单 / 正式交易仍锁定”的边界说明。

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

## 5. 端到端验收

| 用户场景 | 普通用户通过标准 | 专业用户通过标准 |
| --- | --- | --- |
| 红利低波筛选 | 能看懂 Top 候选为什么可观察、为什么不能交易 | 能展开完整分数、证据和 rejection taxonomy |
| 买卖观察区间 | 能看懂当前是低位、中性、高位或需刷新 | 能看到 priceAudit、tradeDate、sourceType、freshness |
| 组合回测 | 能看懂哪条策略收益高、回撤低、数据不足 | 能查看曲线、指标、benchmark、validation 和 artifact |
| 人工计划草案 | 能看懂草案待复核、不构成交易指令 | 能查看 checklist、blockedReasons 和 gate contract |
| 任务审计 | 能看懂任务是否成功和产物用途 | 能定位审计包和 JSON artifact |
| ChatBox 业务入口 | 能用自然语言找到候选、组合、任务和阻断原因 | 能确认工具、operationId、artifactRefs 和交易 gate |

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
```

## 6. 出门条件

完成本 UX 阶段后，可以声明：

```text
ordinaryUserExperienceReady=true
expertModeAvailable=true
plainLanguageDecisionPathReady=true
frontendComplexityReduced=true
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
