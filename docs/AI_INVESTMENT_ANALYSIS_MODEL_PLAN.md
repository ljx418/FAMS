# AI 投资分析与选股模型建设计划

更新时间：2026-05-18

## 背景

当前分析建议主链路仍是 `rules-engine-v1`，适合做纪律提醒，但不适合直接承担“投资分析建议模型”。K 线和技术指标不能以 FAMS 自己的刷新记录和手写公式作为正式来源；正式技术面必须优先从成熟数据源获取 K 线、指标或技术评级，本地计算只能作为审计、对账和兜底。后续分析建议必须基于外部可信行情、外部成熟技术指标、可验证技术模型、AI 解释层和人工微调闭环。

当前股票分析中的“基本面、消息面、技术面”存在明显问题：内容偏模板化，缺少可验证数据、来源、时间和指标值，用户无法据此做投资判断。后续大改的最低标准是：每一个结论都必须能追溯到结构化数据或外部来源；没有数据时必须明确显示“暂无可靠数据”，不得输出空泛判断。

## 调研结论

1. 技术指标和 K 线优先来自成熟外部数据源，而不是自己用刷新记录计算后直接下结论。
   - TradingView Technical Ratings：可作为成熟技术评级模型候选，使用移动平均组和振荡器组聚合出 Sell / Neutral / Buy 等评级。
   - TA-Lib：成熟技术指标库，可作为本地复核工具，覆盖 ADX、MACD、RSI、Stochastic、Bollinger Bands 等大量指标，但本地复核结果不能直接等同于投资建议。
   - `kand`、`technicalindicators`、`@ixjb94/indicators`：仅作为本地审计和 fallback 候选，不作为正式建议主源。

2. 外部指标和选股可接入 TradingView Screener 类工具，但必须标记来源、延迟和可用市场。
   - `TradingView-Screener-ts` 可查询 TradingView 字段和指标，适合做外部技术指标对照源。
   - 这类接口依赖第三方可用性，不能作为唯一事实源，需要 fallback 和审计记录。

3. 如何利用技术指标得出分析建议，必须引入可验证模型，而不是手写 RSI/MACD 阈值话术。
   - 第一类模型：TradingView Technical Ratings 类聚合模型，分别聚合均线和振荡器，再形成综合评级。
   - 第二类模型：可回测策略模型，用 vectorbt / backtrader 类框架把指标转成入场、退出、仓位和风控规则，并用胜率、收益、回撤、换手率验证。
   - 第三类模型：研究型机器学习 / 强化学习模型，例如 FinRL 管线，但必须先离线训练、回测和人工审核，不能直接上线给出买卖建议。

4. AI 分析建议应参考“数据管道 + LLM 解释”的架构，而不是让 LLM 直接猜行情。
   - Daily Stock Analysis 类项目采用 AkShare/Tushare/YFinance/Pytdx/Baostock 等行情源、新闻源、技术指标，再交给 Gemini/OpenAI/Claude/DeepSeek/Qwen 等 LLM 生成结构化报告。
   - 适合 FAMS 的做法是：模型输入必须包含行情、指标、新闻、基本面、持仓、风险约束和数据可靠性；模型输出必须是 JSON schema，可追溯、可回测、可人工调整。

5. 选股模型需要区分“规则筛选”和“机器学习排序”。
   - 规则筛选：A 杀后横盘、放量、突破/收复均线、回撤幅度、量比、ATR、换手率等，适合先落地，必须展示命中/未命中原因。
   - 机器学习排序：可参考 Dynamic Stock Recommendation 的滚动窗口建模思路，用多类指标预测后续收益并排名；FAMS 先不直接交易，只输出候选池、置信度和风险解释。

6. 策略发现与策略锦标赛需要单独建模。
   - 外部策略来源可以参考 Freqtrade 的 strategy / backtesting / hyperopt / lookahead-analysis 思路，但 Freqtrade 主要面向加密货币，FAMS 只借鉴“策略格式、参数优化、偏差检查和回测报告”。
   - FinRL / FinRL-X 提供“选股、组合分配、择时、风险覆盖”的组合式策略管线思路，可作为后续机器学习排序和组合权重优化参考。
   - vectorbt 类框架适合批量参数扫描和大规模信号研究，适合作为策略锦标赛的计算引擎候选。

## 目标架构

### 1. 数据层

- 行情：日 K、周 K、分钟级可选；至少包含 open/high/low/close/volume/amount/turnover；正式分析必须优先从成熟外部 K 线源获取。
- 外部技术指标：优先接 TradingView Technical Ratings、TradingView Screener 或同类 provider；本地 `TechnicalIndicatorService` 只做审计对账和 provider 不可用时的低置信 fallback。
- 新闻消息面：接入可配置新闻源，保存来源、时间、标题、摘要、链接、情绪标签、相关性评分和去重结果。
- 基本面：估值、盈利、成长、现金流、负债、ROE、毛利率、净利率、机构一致预期、行业分位，按 provider 标注更新时间。
- 持仓上下文：当前仓位、市值、成本、收益率、止盈止损收益率、标签、目标仓位。

### 1.1 三面分析事实模型

股票分析必须先构建 `StockAnalysisFactSet`，再由策略和 AI 使用。禁止直接让 LLM 根据标的名称生成三面分析。

基本面至少包含：

- 财务指标：营收、净利润、扣非净利润、毛利率、净利率、ROE、经营现金流、资产负债率。
- 估值指标：PE、PB、PS、股息率、市值、行业估值分位。
- 成长指标：近 4 个季度同比、环比趋势，近 3 年 CAGR。
- 质量指标：现金流/净利润匹配度、商誉/资产比例、负债压力。
- 行业对比：至少给出同业或指数分位；没有行业分位时不能写“估值合理/偏低/偏高”。

消息面至少包含：

- 最近新闻/公告标题、来源、发布时间、链接或来源 ID。
- 事件分类：财报、业绩预告、政策、监管、产品、订单、减持、增持、诉讼、行业事件。
- 情绪与影响方向：利好、利空、中性，并给出触发词或摘要证据。
- 时效性：超过配置窗口的新闻不得作为当前信号；必须标记 `stale`。

技术面至少包含：

- 外部成熟指标或技术评级：趋势、均线、成交量、量比、RSI、MACD、BOLL、ATR、支撑位、压力位、综合技术评级。
- 多周期：日线为主，周线作为趋势过滤；分钟级只用于短线观察，不参与中长期建议。
- 指标来源：外部 provider、本地审计值、更新时间、样本数量、provider 延迟、模型版本。
- 不确定性：样本不足、停牌、缺量、除权缺口、价格异常跳变必须阻断买卖建议。

三面分析输出规则：

- 每段结论必须包含 `evidence[]`，列出指标值、来源和时间。
- 不允许使用“需关注”“建议结合”“整体偏弱/偏强”等没有证据的空话。
- AI 可以总结，但不能新增事实；AI 输出中出现输入快照不存在的数据时，判定为 hallucination，建议生成失败。

### 2. 指标层

- `ExternalTechnicalDataProvider`：正式获取外部 K 线、技术指标、技术评级和 provider 元数据。
- `TechnicalIndicatorService`：只做本地复核、样本质量审计和 provider 失败时的低置信 fallback，不直接产出买卖建议。
- `TechnicalAdviceModelRegistry`：注册“指标如何转化为分析建议”的可靠模型，例如 TradingView 综合评级解释模型、回测通过的趋势/均值回归模型、人工审核后的策略模型。
- 每个指标输出必须包含：
  - `source`: `external_provider` / `local_kand` / `local_fallback`
  - `window`: 指标周期
  - `sampleCount`: 有效交易日数量
  - `asOf`: 指标对应交易日
  - `quality`: `ok` / `insufficient_data` / `stale` / `provider_failed`
- 样本不足、provider 不可靠、模型未验证或只有本地 fallback 时不得输出买卖建议，只能输出“数据不足”或“仅供观察”。

### 3. 策略层

- `StrategyModelRegistry`：内置策略可配置、可启停、可调参数。
- `ExternalStrategyRegistry`：保存从外部来源导入或解析出的策略，记录来源、作者、许可证、适用市场、策略描述、参数空间和风险提示。
- `StrategyTournamentService`：将选股策略和投资执行策略组合成矩阵，批量仿真后排名。
- 初始策略：
  - A 杀后横盘放量
  - 放量突破平台
  - 跌破后收复关键均线
  - 宽基回撤建仓
  - 持仓止盈止损收益率纪律
  - 亏损持仓分批补仓条件
- 每个策略输出：
  - 命中条件
  - 未命中条件
  - 数据质量
  - 回测摘要
  - 参数版本

策略组合拆分：

- 选股策略：负责给出候选股票池和入选原因，例如 A 杀后横盘放量、低估值高 ROE、强势突破、回撤建仓等。
- 投资策略：负责买入、卖出、止盈止损、仓位、再平衡、最大持仓数，例如等权买入、分批买入、移动止盈、固定 5% 止损、ATR 止损等。
- 风控策略：负责单票上限、行业上限、最大回撤熔断、现金底线、黑名单。
- 同一个选股策略必须能搭配多个投资策略回测；同一个投资策略也必须能搭配多个选股策略回测。

### 4. AI 层

- `AIInvestmentAdvisor` 不直接计算事实，只解释结构化事实。
- LLM 输入：行情、指标、策略命中、消息面、基本面、持仓、风险约束、用户偏好。
- LLM 输出必须符合 `Advice JSON Schema`：
  - 结论
  - 消息面/基本面/技术面拆分
  - 支撑位/压力位
  - 买入区间
  - 仓位策略
  - 风险点
  - 必须人工确认的动作
- 每个字段必须带 `evidenceRefs`，引用输入快照中的事实 ID。
- 如果基本面、消息面或技术面事实不足，LLM 必须输出“数据不足”，不能补写模板结论。
- AI 输出必须保存 provider、model、promptVersion、schemaVersion 和完整输入快照。

### 5. 人工微调

- 策略参数可在前端配置：周期、回撤幅度、横盘天数、量能放大倍数、仓位上限、风险偏好。
- AI 建议可人工修改，修改后的参数进入下一次建议上下文。
- 所有人工修改保留审计记录。

## 阶段计划

### 阶段 A：新增持仓与数据入口闭环

- 持仓页支持新增持仓。
- 输入标的、金额或份额，系统识别资产、取外部现价/净值、创建买入交易和持仓。
- 验收：API、数据库、前端弹窗、持仓页刷新全部验证。

### 阶段 B：技术指标服务重构

- 接入成熟外部 K 线和技术指标 / 技术评级 provider，作为正式技术面主源。
- 本地 `TechnicalIndicatorService` 只作为审计和 fallback：按交易日去重、样本不足不输出信号、只能给出复核值。
- 新增 `TechnicalAdviceModelRegistry`，只有通过来源、版本、回测和适用市场审核的模型才能把指标转成建议。
- 验收：同一标的外部 provider 指标、技术评级、本地复核值完成对账；只有外部数据可信且模型已验证时，系统才能输出技术面建议。

进度 2026-05-18：保护性第一段已完成。本地 `TechnicalIndicatorService` 已封装为审计/fallback 服务，输出结构化指标快照和质量状态；`AnalysisService` 已迁移，但本地指标不会再产生买卖信号；股票分析服务不再用实时价伪造历史 K 线，也不会把本地指标包装成正式建议。下一段必须接入外部成熟 K 线/指标源和可靠技术建议模型。

进度 2026-05-18：外部技术指标展示第一段已完成。新增 `ExternalTechnicalDataProvider`，通过 TradingView Scanner 获取 A 股外部技术指标和 Technical Ratings，字段包括 `Recommend.All`、`Recommend.MA`、`Recommend.Other`、RSI、MACD、Stoch、BOLL、ATR、SMA5/10/20、close、volume、change。股票分析 API 返回 `externalTechnical`，前端技术指标面板优先展示外部技术评级、来源、TradingView 标的、更新时间和外部指标值；本地指标仍保留为复核区，不作为交易建议。

验证：`npm run test:external-technical` 通过，`601127` 解析为 `SSE:601127`，TradingView 返回综合评级、均线评级、振荡器评级、RSI14 和 SMA20；后端/前端 TypeScript 检查通过；接口 `GET /api/v1/stocks/601127?market=A股&days=80` 返回 `externalTechnical.quality=ok`、`provider=TradingView Scanner`。

进度 2026-05-18：外部技术指标新增多源可信度校验。`externalTechnical.confidence` 现在包含 `score`、`level`、`sourceCount` 和逐项 `checks`；TradingView 作为技术评级主源，Eastmoney/Sina K 线作为独立复核源，校验收盘价、SMA20、RSI14 和 MACD 方向。差异小则提高可信度，差异过大则降级并阻断技术面建议。

验证：接口 `GET /api/v1/stocks/601127?market=A股&days=80` 返回 `confidence.score=95`、`level=high`、`sourceCount=2`；收盘价差异 `0.00%`、SMA20 差异 `0.01%`、RSI14 差异 `0.32%`、MACD 方向一致。

进度 2026-05-18：`TechnicalAdviceModelRegistry` 第一版落地。新增 `tradingview_ratings_interpretation_v1`，只有在外部指标 `quality=ok`、存在 Technical Ratings、多源可信度不低于 `80` 且无失败校验时，才把技术指标解释为技术面观察结论；输出 `status`、`stance`、`summary`、`observation`、`risk`、`actionBoundary`、`model`、`evidence` 和 `blockedReasons`。该模型只输出技术面观察和边界，不输出直接买卖指令。

验证：`npm run test:technical-advice-model` 通过，覆盖高可信可用和低可信阻断两条路径；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `technicalAdvice.status=available`、`stance=defensive`、`summary=技术面偏防守`，证据引用 TradingView 综合评级、均线评级、振荡器评级、RSI14 和多源可信度。

进度 2026-05-18：`StockAnalysisFactSet` 技术面第一段落地。股票分析 API 新增 `factSet`，schema 为 `stock.analysis.factset.v1`，包含 `technical / fundamental / news` 三个分区。当前已填充技术面 facts，包括 TradingView 评级、外部 RSI/SMA、多源可信度、本地复核值、模型输出和交叉校验明细；基本面和消息面分区明确返回 `insufficient_data` 和缺失 Provider 警告，禁止生成空泛结论。`technicalAdvice.evidenceRefs` 已指向 factSet 中真实存在的 fact id。

验证：新增 `npm run test:stock-analysis-factset` 并通过；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `factSet.schemaVersion=stock.analysis.factset.v1`、`technical.quality=ok`、技术 facts `13` 条、`fundamental/news=insufficient_data`，且 `technicalAdvice.evidenceRefs` 全部能在技术面 facts 中找到。

进度 2026-05-18：`StockAnalysisFactSet` 基本面估值第一段落地。新增 `FundamentalDataProvider`，通过东方财富 quote/fundamental 接口获取动态 PE、PB、总市值、流通市值和最新价；股票分析 API 返回 `fundamentalSnapshot`、`peRatio`、`pbRatio`，并将 PE/PB/市值写入 `factSet.fundamental.facts`。当前基本面只覆盖估值与市值快照，成长、盈利质量、现金流和行业分位仍标记为未接入，禁止生成完整基本面结论。

验证：新增 `npm run test:fundamental-factset` 并通过；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `peRatio=47.22`、`pbRatio=3.45`、`factSet.fundamental.quality=ok`、基本面 facts `4` 条，来源为 `Eastmoney Quote/Fundamental`。

进度 2026-05-18：`StockAnalysisFactSet` 消息面事件流第一段落地。新增 `NewsDataProvider`，通过东方财富搜索获取个股相关新闻事件，保存标题、摘要、媒体来源、发布时间、链接、事件类型、规则情绪和相关性；股票分析 API 返回 `newsSnapshot`，并将最近新闻写入 `factSet.news.facts`。当前消息面只接入新闻搜索事件流，公告全文、权威公告源、影响强度模型和 LLM 情绪复核仍未接入，因此只展示事实和规则分类，不生成完整消息面结论。

验证：新增 `npm run test:news-factset` 并通过；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `factSet.news.quality=ok`、新闻 facts `6` 条、新闻事件 `8` 条，首条事件为证券日报 `赛力斯：公司将聚焦主业发展`。

进度 2026-05-18：`StockAnalysisSummary` 三面汇总第一段落地。新增汇总层 `stock.analysis.summary.v1`，从 `StockAnalysisFactSet` 和 `TechnicalAdviceModelRegistry` 生成技术面、基本面、消息面摘要；每个分区输出 `status`、`summary`、`evidenceRefs` 和 `blockedReasons`。技术面在模型可用时为 `available`，基本面和消息面由于仍缺成长/质量/现金流/行业分位、公告全文、影响强度等能力，只能输出 `partial` 并保留阻断原因。

验证：新增 `npm run test:stock-analysis-summary` 并通过；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `analysisSummary.overallStatus=partial`、技术面 `available`、基本面 `partial`、消息面 `partial`，所有摘要均带 evidenceRefs 或 blockedReasons。

进度 2026-05-18：基本面财报主指标第一段落地。`FundamentalDataProvider` 在估值快照之外新增东方财富 F10 财务主指标接口，获取最近 4 期财报；当前写入最新一期营业收入、营收同比、归母净利润、归母净利同比、ROE、毛利率、资产负债率、经营现金流和 EPS。`factSet.fundamental` 从 4 个估值 facts 扩展到 13 个 facts，`StockAnalysisSummary` 基本面摘要同步引用财报期、营收、利润、ROE、负债率和经营现金流。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset` 通过，`601127` 返回 `2026一季报`、营收 `25745711786.75`、归母净利 `754464672.82`、ROE `1.83`、资产负债率 `65.9226`、经营现金流 `-20950295141.48`；`npm run test:stock-analysis-factset` 和 `npm run test:stock-analysis-summary` 通过；接口验证基本面 facts `13` 条。

进度 2026-05-18：基本面行业分位第一段落地。`FundamentalDataProvider` 读取东方财富行业板块和成分股，当前 `601127` 映射到 `乘用车(BK1262)`；同业样本写入 PE/PB/总市值分位，并对行业成分股拉取 F10 财务主指标后计算 ROE 和资产负债率分位。`factSet.fundamental` 从 13 条扩展到 20 条，摘要层新增同业对比段落。找不到板块代码时仅输出 warning，不生成估值高低判断。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；运行态接口验证 `601127` 返回 `乘用车(BK1262)`、PE 低估分位 `11.11`、PB 低估分位 `44.44`、ROE 分位 `100`、负债率低位分位 `33.33`，基本面 facts `20` 条。

进度 2026-05-18：财报主指标同厂不同接口复核第一段落地。新增 `financialCrossCheck`，使用东方财富 F10 主指标 `RPT_F10_FINANCE_MAINFINADATA` 与数据中心业绩报表 `RPT_LICO_FN_CPD` 交叉校验营业收入、归母净利润、基本 EPS、ROE 和毛利率；复核状态和逐项差异写入 `factSet.fundamental`。当前属于同厂不同接口复核，仍以 warning 标明独立公告全文/新浪等来源未接入。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset` 通过，`601127` 五项复核均为 `pass`、差异 `0%`；`npm run test:stock-analysis-factset` 验证基本面 facts `26` 条；`npm run test:stock-analysis-summary` 和运行态接口验证摘要显示 `财报复核：ok / RPT_LICO_FN_CPD`。

进度 2026-05-19：独立来源财报复核第一段落地。新增 `independentFinancialCrossCheck`，解析搜狐证券重要财务指标页 `SOHU_CWZB`，按页面单位“万元”转换为元后，与东方财富 F10 主指标交叉校验主营业务收入、净利润、每股收益、ROE 和资产负债率；复核状态和逐项差异写入 `factSet.fundamental`，摘要层展示独立来源复核状态。该来源独立于东方财富，但仍是页面解析，后续继续补交易所公告 PDF/HTML 原文。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset` 通过，`601127` 搜狐 5 项复核均为 `pass`；`npm run test:stock-analysis-factset` 验证基本面 facts `32` 条；`npm run test:stock-analysis-summary` 和运行态接口验证摘要显示 `独立来源复核：ok / SOHU_CWZB`，营收和净利润复核均 `pass / 差异 0%`。

进度 2026-05-19：公告原文定位第一段落地。新增 `officialAnnouncement`，通过搜狐证券重大事项备忘页定位对应报告期公告，并提取上交所 `static.sse.com.cn` PDF 链接、公告标题和披露日期；`factSet.fundamental` 写入公告原文定位状态、标题、披露日期和 PDF URL，摘要层展示公告原文状态。当前已做到官方原文链接可追溯，PDF 表格字段抽取仍未接入。

验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset` 通过，`601127` 定位到 `2026年第一季度报告`、披露日期 `2026-04-30`、上交所 PDF `https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-04-30/601127_20260430_LC8M.pdf`；`npm run test:stock-analysis-factset` 和 `npm run test:stock-analysis-summary` 通过；运行态接口验证基本面 facts `36` 条并显示 `公告原文：located / PDF`。

### 阶段 C：策略模型注册表

- 把当前 AI 选股策略迁入 `StrategyModelRegistry`。
- 每个策略参数化、可配置、可回测。
- 验收：A 杀横盘放量策略覆盖全 A 股样本，并展示命中/未命中原因。

### 阶段 D：AI 建议模型

- 新增 `AIInvestmentAdvisor`，LLM 只基于结构化事实生成 JSON 建议。
- 合并总览 AI 股票分析、分析建议、AI 选股入口。
- 新增 `StockAnalysisFactSet`，把基本面、消息面、技术面拆成可追溯事实集合。
- 基本面必须接入真实财务/估值 provider；消息面必须接入新闻/公告 provider；技术面必须接入外部成熟指标和可靠技术建议模型；本地 `TechnicalIndicatorService` 只能作为复核 evidence。
- 验收：任意标的/板块搜索返回消息面、基本面、技术面、支撑压力位、买入区间、结合持仓策略，并保存完整快照；每条结论都有 evidenceRefs；数据不足时明确显示不足，不输出模板话术。

### 阶段 D1：股票三面分析重构

- 重构股票分析页和 API，废弃空泛模板字段。
- 新增三面分析卡片：
  - 基本面：财务、估值、成长、质量、行业分位。
  - 消息面：新闻/公告事件流、情绪、影响方向、时效性。
  - 技术面：外部指标、本地指标、趋势、量价、支撑压力、样本质量。
- 每张卡片展示来源、更新时间、证据和风险提示。
- 验收：
  - 输入 `601127`、`600276`、`000651` 至少三个真实股票，三面分析均有可追溯证据或明确的数据不足原因。
  - 人工断网或 provider 失败时，页面显示失败来源和缺失字段，不生成买卖建议。
  - LLM 输出引用的 evidenceRefs 必须全部存在于输入快照。

### 阶段 E：人工微调与回测闭环

- 前端提供策略参数配置和建议修订。
- 修订后的建议可进入回测。
- 验收：同一策略参数调整前后，候选池、建议和回测结果可对比。

### 阶段 F：外部策略发现与策略锦标赛

- 新增外部策略发现入口：
  - GitHub / 文档 URL / 用户粘贴文本 / 本地策略模板。
  - LLM 只负责把外部自然语言策略解析为结构化候选，不能直接标记为可用策略。
  - 系统必须检查策略来源、许可证、适用市场、所需数据字段、是否存在未来函数风险。
- 新增策略导入审核：
  - 策略进入 `draft` 状态，人工确认后才进入 `active`。
  - 每个策略必须有参数空间、默认参数、数据需求、风险说明和禁用条件。
- 新增策略锦标赛：
  - 对多个选股策略 × 多个投资策略 × 多个参数组合进行批量回测。
  - 默认按滚动窗口执行 train / validation / test，避免只在单一历史区间过拟合。
  - 输出胜率、总收益、年化收益、最大回撤、夏普、盈亏比、交易次数、换手率、平均持仓周期、回撤恢复天数、样本覆盖率。
  - 排名必须支持多目标：高胜率、低回撤、高收益、低换手、稳定性。
- 新增可视化：
  - 策略排行榜。
  - 收益曲线对比。
  - 回撤曲线。
  - 胜率/收益/回撤散点图。
  - 选股策略 × 投资策略热力图。
  - 参数敏感性图。
  - 单策略交易明细和持仓轨迹。
- 验收：
  - 至少导入 3 个外部启发策略和 3 个内置策略。
  - 至少对 3 个选股策略 × 3 个投资策略完成批量回测。
  - 结果必须显示样本区间、样本股票数、数据缺失、费用滑点假设和排名依据。
  - 所有胜率和收益结论必须能追溯到回测批次、策略版本、参数和行情快照。

## 当前状态

- 阶段 A 已启动：持仓页新增“新增持仓”入口；后端新增 `/api/v1/positions/manual-buy`，可按买入金额或份额新增持仓并创建买入交易。
- 阶段 B/D1 基本面第一轮已收尾：`StockAnalysisFactSet` 基本面已覆盖估值、市值、财报主指标、行业分位、东方财富同厂复核、搜狐独立页面复核和交易所公告 PDF 定位；`StockAnalysisSummary` 基本面为 `partial`，明确保留 `PDF 表格抽取未接入` 边界。公告 PDF 表格抽取、审计意见、完整三表明细、消息影响强度和更多外部模型仍待启动。
- 阶段 F 已启动第一段并完成持久化：AI 选股接口新增 `strategyTournament`，同一批全 A 股 K 线样本可横向比较内置三类选股策略，并用最近可验证交易日信号计算持有 N 日后的短窗胜率、平均收益和当前命中数；每次扫描会生成 `batchId`，并把每个内置策略保存为 `Backtest / BacktestResult`，结果可追溯到原始查询、阈值、样本池、数据质量和信号样本。完整外部策略发现、策略导入审核、费用滑点假设和可视化对比仍待启动。

## 参考来源

- Kand: https://github.com/kand-ta/kand
- TA-Lib: https://ta-lib.org/
- TradingView Technical Ratings: https://www.tradingview.com/support/solutions/43000475547-what-do-the-ratings-in-the-screener-mean/
- TradingView-Screener-ts: https://github.com/Anny26022/TradingView-Screener-ts
- VectorBT: https://vectorbt.dev/
- Daily Stock Analysis: https://github.com/ZhuLinsen/daily_stock_analysis
- Dynamic Stock Recommendation paper: https://arxiv.org/abs/2511.12129
- technicalindicators: https://www.npmjs.com/package/technicalindicators
- Freqtrade: https://github.com/freqtrade/freqtrade
- Freqtrade Hyperopt: https://www.freqtrade.io/en/stable/hyperopt/
- FinRL: https://github.com/AI4Finance-Foundation/FinRL
- VectorBT ecosystem overview: https://python.financial/
