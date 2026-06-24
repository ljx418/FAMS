# FAMS 会话进度记录

更新日期：2026-05-31  
工作环境：WSL，项目路径 `/mnt/c/workspace/financial-asset-manager`

## 今日主线

继续按 `docs/target-architecture-gap.drawio` 推进，V1.5 主线已闭合，已进入 `V2.0 FAMS Connect 与 MCP 工具契约`。

最新更新：2026-05-31

## 2026-05-31 P5/P4.34 中断恢复与全 A 证据链复验

- 接上中断点后，先确认旧任务 `4f49488a-7649-4ff0-8ebd-c72f2e9c4873` 已 `cancelled`，避免重复 worker 干扰。
- 完成估值模型后续阻断复验：PE/PB 缺失已通过 quote-list / 财报派生兜底补齐，分析建议可以输出，但交易动作仍受验证证据闸门控制。
- 新增全 A 聚合性能优化：
  - 历史信号命中按 `strategyId + symbol + holdingDays` 缓存，避免执行策略矩阵重复计算同一批历史信号。
  - 基础排名阶段 benchmark 改为流式 summary，不再为每个候选构造完整 benchmark outcomes 数组。
  - 全 A 深度验证增加 OOS/walk-forward 短路：未先通过时不运行高成本参数敏感性，并写入 `insufficient` 证据，不能用于交易放行。
- 验证：后端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 均通过。
- 全 A queued Operation `15fae43c-c208-47b7-9596-90dedc99377b` 完成，状态 `partial`，生成 33 个 artifact：
  - universe `5524`
  - scanned `5524`
  - evaluated `5447`
  - failure `77`
  - providerSuccessRate `98.61%`
  - cacheHitRate `99.95%`
  - backtestDays `60`
  - rankedCandidates `126`
  - bestSampleSize `3766`
  - bestCredibility `high`
  - `backtest.aggregate` 用时约 `3m43s`
- 验收结论：
  - `npm run test:production-readiness -- --strict` 通过，`analysisAdviceReady=true`、`productionReady=true`。
  - `npm run test:trade-action-readiness` 按预期失败，唯一 blocker 为 `validation_evidence`。
  - 最新 `validationDecision=OBSERVE_ONLY`，禁止 `ADD / REDUCE / AUTO_TRADE`。
  - 10/10 深度验证候选样本外失败，`validationEvidence.primaryBlocker=out_of_sample`。
- 当前状态：P1-P5 的分析建议、全 A 数据链路、缓存、Operation、产物和生产分析 gate 可收口；交易建议/调仓动作不可收口。下一步继续主线时，必须优先处理 `validation_evidence`，不能通过降低验证阈值改绿。

## 2026-05-27 P4.32.2 进度同步

- 按阶段规则复跑验收：后端/前端 TypeScript、quote-list canonical、market-cap worker、事实集预热和 120 样本 dry-run 均完成。
- 新增受控长样本入口：`run-long-sample-dry-run.ts` 支持环境变量配置扫描上限、回测天数、持有天数、分片大小和 query；新增 `npm run run:long-sample-controlled`。
- 修复市值补齐坏数据反复占用名额：BaoStock 无法派生市值的标的写入 `BaoStock 派生流通市值缺失` warning，后续 warmup 默认跳过；artifact 增加结构化 `failedSymbols`。
- 修正 `test:quote-list-market-cap-worker` 验收口径：允许真实 provider 坏数据导致 `partial`，但必须记录成功/失败、失败原因、artifact 和 provider health。
- 500 样本首跑：`providerSuccessRate=99.8%`、`cacheHitRate=24.2%`、`bestSampleSize=234`、`bestCredibility=medium`，暴露缓存和事实集覆盖不足。
- 补齐 quote-list 市值后，canonical 完整覆盖提升到 `437`，500 样本事实集覆盖 `87.2%`。
- 500 样本复跑 Operation `d772c4ae-91bb-45fd-a140-a1c385c1f104`：`scannedCount=500`、`evaluatedCount=499`、`providerSuccessRate=99.8%`、`cacheHitRate=99.43%`、`bestSampleSize=234`、`bestCredibility=medium`。
- 当前唯一剩余 blocker：`universe_coverage=9.05% < 80%`。P4.32 仍不能标记全量通过，下一步进入 1000 样本和更高覆盖 gate 的受控验收。

## 2026-05-27 P4.32.3 进度同步

- 执行 1000 样本前置验收：初始事实集覆盖 `43.6%`、行情缓存命中估算 `49.69%`，不满足直接长跑条件。
- 完成 1000 样本行情缓存预热：补齐 506 个缺口，`estimatedCacheHitRate` 从 `49.69%` 提升到 `99.47%`，仅 8 个样本仍不充分。
- 完成 quote-list 市值补齐 500 样本：`successCount=499 / failureCount=1`，canonical 完整覆盖提升到 `975`。
- 1000 样本事实集复检：`initialFullCoverage=97.4%`。
- 1000 样本受控长样本 Operation `f0bd05f5-2c61-47cd-973f-bbe07b9d954e` 完成，状态 `partial`：
  - `scannedCount=1000`
  - `evaluatedCount=997`
  - `providerSuccessRate=99.7%`
  - `cacheHitRate=99.52%`
  - `bestSampleSize=488`
  - `bestCredibility=medium`
- 当前唯一剩余 blocker：`universe_coverage=18.11% < 80%`。下一步建议做 2000 样本前置预热，或先做长样本 worker/SQLite 性能和 artifact 体积专项验收。

## 2026-05-27 P4.32.4 进度同步

- 修复事实集预热上限：`preheatScreenerFactsets` 的 `maxScan` 上限从 `1000` 放宽到 `6000`，2000 样本复检不再被截断。
- 完成 2000 样本行情缓存预热：补齐 1008 个缺口，耗时 `1648185ms`，拉取 `120275` 条 K 线，`estimatedCacheHitRate=49.83% -> 99.68%`。
- 预热中发现一次 SQLite 写入超时：`providerHealth.upsert` 对 `300534` 超时，已记录为后续性能专项风险。
- 完成 quote-list 市值补齐 1000 样本：Operation `739a33b0-6da9-4a09-a402-2364f4839b16`，`successCount=995 / failureCount=5`，canonical 完整覆盖提升到 `1970`。
- 2000 样本事实集复检：`initialFullCoverage=98.45%`。
- 2000 样本受控长样本 Operation `f9cfc6b9-874a-41f5-b9bd-5aa1def19ede` 完成，状态 `partial`：
  - `scannedCount=2000`
  - `evaluatedCount=1997`
  - `providerSuccessRate=99.85%`
  - `cacheHitRate=99.71%`
  - `bestSampleSize=828`
  - `bestCredibility=high`
  - `artifactRefs=17`
- 当前唯一剩余 blocker：`universe_coverage=36.21% < 80%`。下一步不建议直接冲全 A，应优先做 market bar 预热和 quote-list 市值补齐的 Operation/worker 化，以及 SQLite 写入压力和 artifact 体积专项验收。

## 2026-05-28 P4.33.1 进度同步

- 已启动服务：
  - 前端：`http://localhost:3000/`
  - 后端：`http://localhost:4000/`
- 新增 `market_bar_cache_preheat` Operation 类型，把 K 线缓存预热从同步脚本迁入 Operation/worker。
- 新增后端 API：`POST /api/v1/operations/market-bar-cache-preheat`。
- Worker 支持 `market_bar_cache_preheat` 的 queued 领取、恢复和重试。
- 每个 chunk 写入 `OperationTask`，记录 success/failure/warning/cacheHitRate/fetchedBars/provider。
- 产物新增 `market_bar_cache_preheat_report.json`。
- 前端任务中心新增 `K线预热` 类型、摘要展示和 `预热K线` 按钮。
- 小样本 queued 验收 Operation `c2bb9772-d05f-4793-9e8f-16f81687fe27` 完成：
  - `requestedSymbols=4`
  - `attemptedSymbols=1`
  - `successCount=1`
  - `failureCount=0`
  - `fetchedBars=120`
  - artifact 可通过前端代理读取。
- 后端/前端 TypeScript 均通过。
- 下一步：做取消/恢复专项、2000 样本 queued 验收、SQLite timeout 复现与写入压力优化。

## 2026-05-25 P4.31 进度同步

- 完成事实集覆盖补齐第一段：新增独立 screener factset 预热入口和验收脚本。
- 新增 `StockScreenerService.preheatScreenerFactsets`，输出 before/after 覆盖率、成功/失败、失败标的和 warnings。
- 新增 `backend` 脚本 `npm run run:screener-factset-preheat` 和 `npm run test:screener-factset-preheat`。
- 成功口径已收紧：只有同时取得东方财富行业板块和总市值/流通市值才算预热成功。
- 验证：指定 `601127` 的覆盖率为 100%；受控 20 样本预热 attempted=20、success=0、failure=20、finalFullCoverage=0。
- 检视意见：前排深市/默认样本行业和市值 provider 覆盖失败，P4.32 全 A 长样本正式扫描暂缓。下一步必须先修复基础事实集 provider 或接入独立批量行业/市值数据源。

## 2026-05-25 P4.31.1 事实集预热可靠性修复

- 修复基础事实输出：`em_industry_board` 不再依赖行业分位增强；总市值/流通市值接入东方财富全 A 列表快照兜底。
- 修复预热职责偏移：`preheatScreenerFactsets` 改为轻量行业/市值预热，不再调用完整股票分析链路，避免被实时行情、技术面、消息面和财报接口拖慢。
- 修复缓存污染：无有效行业/市值时不写空缓存；读取缓存时优先选择已有完整行业/市值事实的旧缓存，避免最新空事实覆盖旧证据。
- 验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:screener-factset-preheat` 通过，`successSymbols=1`、`failureSymbols=0`、`finalFullCoverage=100`。
- 检视意见：缓存污染与预热职责偏移已闭环；东方财富列表接口仍有短时空回复，全新 20 样本覆盖暂不能作为 P4.32 准入。下一步补独立来源或本地持久化 quote-list 快照。

## 2026-05-25 P4.31.2 本地 Quote-list 快照缓存

- 新增 `backend/data/a-share-quote-list-cache.json`，保存行业、总市值、流通市值、来源和抓取时间。
- `FundamentalDataProvider` 优先读取本地 quote-list 快照；设置 `FAMS_REFRESH_QUOTE_LIST_CACHE=1` 时才强制刷新外部 provider；provider 成功后自动写回缓存，失败时读取旧缓存。
- 新增 `npm run test:quote-list-cache`，验证 provider 不可用时本地缓存仍能支撑 screener 事实集预热。
- 新增 `npm run run:quote-list-cache-refresh`，用于 provider 恢复后刷新全量快照。
- 验证：后端 TypeScript 通过；`test:screener-factset-preheat` 通过；`test:quote-list-cache` 通过，10 个缓存样本 `finalFullCoverage=100`。
- 检视意见：本地快照机制已闭环；当前缓存仍是种子样本，默认 20 样本覆盖为 75%，P4.32 前必须刷新全量 quote-list 或接入第二来源。

## 2026-05-25 P4.31.3 Quote-list 缓存验收与回退报告修正

- 修复 `run:quote-list-cache-refresh` 输出：外部 provider 失败并回退本地缓存时返回 `quote_list_cache_refresh_fell_back_to_local_cache`，并输出 `externalSnapshots=0` 和 `sourceSummary`，避免误报外部刷新成功。
- 新增 `run:quote-list-cache-merge-factsets`，从已有 `StockFactSetCache` 合并完整行业+市值事实到 quote-list 缓存。
- 验证：后端 TypeScript 通过；merge 脚本结果 `previousItems=16 / mergedItems=0 / finalItems=16`；refresh 脚本确认当前为本地回退；`test:quote-list-cache` 通过；20 样本预热 `successSymbols=15 / failureSymbols=5 / finalFullCoverage=75%`。
- 检视意见：脚本语义和缓存验收已闭环；样本覆盖仍不足，P4.32 继续暂缓。下一步必须补第二来源或刷新全量 quote-list。

## 2026-05-25 P4.31.4 多信源 Quote-list Canonical 与交叉验证

- 新增 `backend/scripts/providers/a_share_quote_sources.py`，接入 BaoStock 与 AKShare 两个免费信源。BaoStock 提供全 A 基础信息、上市状态和证监会行业；AKShare 提供全 A 代码/名称，并尽力获取 spot 市值。
- 新增 `backend/scripts/refresh-quote-list-canonical.ts`，生成 `backend/data/a-share-quote-list-canonical.json`，合并 `baostock`、`akshare` 和 `eastmoney_local_cache`，保留 sourceRefs、confidence、warnings 和 providerReports。
- `FundamentalDataProvider` 优先读取 canonical quote-list，缺失时回退旧 quote-list 缓存；事实集预热允许写入行业可用但市值缺失的部分事实，避免误判行业覆盖。
- 新增 `npm run run:quote-list-canonical-refresh` 和 `npm run test:quote-list-canonical`。
- 验证：后端 TypeScript 通过；canonical refresh 输出 `itemCount=5846`，BaoStock `5531`、AKShare `5522`、本地 Eastmoney 缓存 `16`；`test:quote-list-canonical` 通过，10 个完整样本 `finalFullCoverage=100`；20 样本预热提升到 `successSymbols=16 / failureSymbols=4 / finalFullCoverage=80%`。
- 检视意见：多信源 canonical 框架和行业覆盖已闭环；AKShare 市值接口当前受 Eastmoney/proxy 上游失败影响，市值完整覆盖仍只有种子缓存级别。P4.32 之前继续补市值第二来源，不能把当前结果标为全 A 高可信验收。

## 2026-05-26 P4.31.5 BaoStock 派生流通市值第二来源

- BaoStock provider 新增流通市值派生：用日线 `close * volume * 100 / turn` 推导流通市值，作为独立于东方财富市值字段的第二来源。
- 新增 `FAMS_BAOSTOCK_FLOAT_CAP_LIMIT` 控制派生规模，默认 120；全量派生后续应进入 Operation/worker，不在前端同步触发。
- `test:quote-list-canonical` 门槛提升为至少 100 个行业+市值完整样本，且至少 100 个多 provider 完整样本。
- 验证：canonical refresh 输出 `fullCoverageCount=121 / multiProviderFullCoverageCount=121`，BaoStock `derived float market cap count=119, failed=0`；后端 TypeScript 通过；`test:quote-list-canonical` 通过；20 样本预热 `successSymbols=20 / failureSymbols=0 / finalFullCoverage=100%`。
- 检视意见：P4.31 事实集覆盖补齐可收口；P4.32 前还需把 121 只受控补齐扩展成可取消、可恢复、限速的全量市值补齐任务，并做耗时/provider health 验收。

## 2026-05-26 P4.31.6 市值补齐 Operation 化第一段

- `a_share_quote_sources.py` 新增 `baostock_market_cap` provider，可按指定 symbols 查询 BaoStock 日线并派生流通市值。
- 新增 `npm run run:quote-list-market-cap-warmup`，创建 `quote_list_market_cap_warmup` Operation，按 chunk 写 `OperationTask`，支持跳过已完成 chunk、检查取消状态、增量写回 canonical，并生成 `quote_list_market_cap_warmup_report.json` artifact。
- 验证：后端 TypeScript 通过；小样本 Operation `2ea5e944-f57d-4b0d-8a32-900291dee293` 完成，`requestedSymbols=5 / successCount=5 / failureCount=0`，2 个 task 均 `completed`，canonical 覆盖从 `121` 提升到 `126`。
- 复验：`test:quote-list-canonical` 通过，`fullCoverageCount=126 / multiProviderFullCoverageCount=126`；20 样本事实集预热 `initialFullCoverage=100 / finalFullCoverage=100`。
- 检视意见：市值补齐已具备 Operation/task/artifact 形态；下一步补任务中心入口、worker 类型白名单和 provider health 统一上报，再做受控大样本限速验收。

## 2026-05-26 P4.31.7 市值补齐任务中心与 Worker 接入

- `OperationService` 正式支持 `quote_list_market_cap_warmup`：新增启动方法、queued/inline 执行、worker 白名单、重试、启动恢复和 artifact next action。
- 后端新增 `POST /api/v1/operations/quote-list-market-cap-warmup`。
- 前端任务中心新增“补齐市值”按钮，默认提交 queued 任务 `limit=40 / chunkSize=10`；任务摘要展示请求、成功、失败和完整覆盖。
- 新增 `npm run test:quote-list-market-cap-worker`。
- 验证：后端/前端 TypeScript 通过；worker 验证 Operation `bc363972-b4fc-43b5-9f08-846bc87d0983` 完成，2 个 chunk task 均成功，artifact 可读取；canonical 覆盖提升到 `130`；20 样本预热仍为 `100%`。
- 检视意见：任务中心和 worker 链路已闭环；下一步补 provider health 统一上报，并做 200-500 只受控样本限速验收。

## 2026-05-26 P4.31.8 Provider Health 与受控样本限速验收

- `quote_list_market_cap_warmup` 每个 chunk 写入 `provider_health`，provider=`baostock_market_cap`、endpoint=`quote_list_market_cap`，记录请求、成功、失败、bad data、延迟、熔断状态和最近 chunk metrics。
- `quote_list_market_cap_warmup_report.json` artifact 增加 provider health 快照。
- `test:quote-list-market-cap-worker` 增加 provider health 断言。
- 验证：后端 TypeScript 通过；`test:quote-list-market-cap-worker` 通过；40 样本 Operation `c61f3a33-e2d4-42f4-8169-86690ea6b8f7` 完成，`successCount=40 / failureCount=0`，耗时约 `11904ms`；provider health `healthy / closed`；canonical 覆盖提升到 `182`；20 样本预热保持 `100%`。
- 检视意见：40 样本限速验收已闭环；下一步跑 200 只中样本验收，再决定是否进入 P4.32 长样本扫描。

## 2026-05-25 P4.30 进度同步

- 完成 PostgreSQL / worker 性能验收与全量扫描前置评审第一段。
- `stock_screener_full_scan` 新增 `executionMode=queued`，支持只入队不立即由 API 进程执行。
- `OperationService` 新增 worker 领取入口 `runNextQueuedOperation` 和 `executeQueuedOperation`，可处理 queued 或过期 lease 的 `stock_screener_full_scan / batch_factset_refresh`。
- 新增 `backend` 脚本 `npm run run:operation-worker-once` 和 `npm run test:operation-worker-readiness`。
- 验证：`test:operation-worker-readiness` 通过，排队小样本 Operation completed，过期租约选股 Operation 被恢复并 completed；`test:operation-recovery` 通过，原批量事实集恢复未回归。
- 下一步继续 P4.31：事实集覆盖补齐，优先解决 120 样本 factset coverage 仍为 0% 的阻断。

## 2026-05-25 P4.29 进度同步

- 完成 market bar 缓存预热与 universe 来源防误判第一段。
- 新增 `MarketBarCacheService.getCoverageReport`，可审计 canonical K 线覆盖率、缺口、过期标的和估算 cache hit rate。
- 新增 `backend` 脚本 `npm run run:market-bar-cache-preheat`，扫描前按缺口预热，只拉缺失或过期 K 线。
- 全 A 股票池新增本地持久缓存；长样本验收新增 `universeSource / universeTotal` 和 `universe_source` blocker，fallback 小样本不得通过验收。
- 验证：全 A provider 拉取 5521 只；预热脚本用全 A 来源运行，120 样本 cache hit rate 达 100%；复跑 Operation `29dbb2f3-f238-45c4-92ca-8b551a8ed011` 完成，provider 成功率 100%、cache hit rate 100%、验收仍为 insufficient。
- 剩余阻断：扫描覆盖率 2.17%、最佳成交样本 83、稳定性证据不足、事实集覆盖 0%。下一步继续 P4：PostgreSQL/worker 性能验收、全量扫描前置评审、持仓建议证据联动。

## 2026-05-25 P4.28 进度同步

- 完成长样本 dry-run 实际运行与产物沉淀第一段。
- 新增 `backend` 脚本 `npm run run:long-sample-dry-run`。
- Operation `65a36d22-c4cc-400b-8755-0cf2a62a2618` 已完成，耗时约 155 秒，生成 17 个 artifact。
- dry-run 配置：120 只样本、60 个交易日、持有 3 日、跳过事实集预热。
- 结果：120/120 评估成功，provider 成功率 100%，缓存命中率 7.42%，最佳样本 83，最佳可信度 low，长样本验收为 insufficient。
- 下一步继续 P4：market bar 缓存预热、PostgreSQL/worker 性能验收、持仓建议证据联动。

## 2026-05-25 P4.27 进度同步

- 完成长样本验收受控入口第一段。
- 后端 `stock_screener_full_scan` 新增 `mode=default / long_sample_dry_run / long_sample_full`。
- `long_sample_dry_run` 固定使用 120 只样本、60 个交易日、跳过事实集预热；`long_sample_full` 必须显式 `confirmedFullScan=true`。
- 任务中心新增“长样本验收”按钮，用于提交 dry-run 并查看 `long_sample_acceptance.json`。
- 后端/前端 TypeScript、`npm run test:screener-service`、`npm run test:strategy-tournament-backtest` 均通过。
- 下一步继续 P4：运行真实长窗口样本并沉淀产物、PostgreSQL/worker 性能验收、持仓建议证据联动。

## 2026-05-25 P4.26 进度同步

- 完成全 A 长样本验收闸门第一段。
- 全市场扫描新增 `long_sample_acceptance.json` artifact，并同步嵌入 `data_quality_report.json`。
- 任务中心新增“长样本验收”产物预览，展示扫描覆盖、provider 成功率、缓存命中、回测窗口、样本量、稳定性验证和事实集覆盖。
- 后端/前端 TypeScript、`npm run test:screener-service`、`npm run test:strategy-tournament-backtest` 均通过。
- 下一步继续 P4：真实全 A 长窗口样本运行、PostgreSQL/worker 性能验收、持仓建议证据联动。

## 已完成

- `generate_daily_advice` Operation 产物追踪契约已完成：
  - Operation DTO 返回 `operationId`、`artifactRefs`、`nextActions`。
  - 建议任务结果持久化并引用 `advice`、`advice_input_snapshot`、`position_snapshot`、`market_snapshot`。
  - 修复 `scope=all` 携带自然语言 query 时误过滤全部持仓的问题。
  - 建议快照行情读取增加短超时兜底，外部行情慢或不可用时不阻断任务完成。
- 任务中心前端接入 `artifactRefs` 与 `nextActions`：
  - 新增“任务产物与下一步”面板。
  - `nextActions` 支持链接跳转和 POST 动作提交。
  - 修正 `open_advice` 链接，能打开当前 Operation 并聚焦建议快照区域。
  - 移动端布局已优化，长 artifact refs 不再撑开页面。
- Operation 取消和重试能力已在前后端可见：
  - 后端支持 `POST /api/v1/operations/:id/cancel`。
  - 前端任务列表和详情弹窗提供取消按钮。
  - 失败或取消任务可 retry。

## 本轮新增

- 高可靠与高正确计划阶段 1 最小闭环：
  - 新增 `backend/src/services/asset/assetIdentityResolver.ts`。
  - 新增 `GET /api/v1/assets/resolve`。
  - `GET /api/v1/prices/realtime` 接入 resolver，返回 identity、置信度和 warnings。
  - 外部行情超时时返回结构化失败；有本地最近价时返回 `local_last_price`，无本地价时明确返回 `price=null`。
- 价格刷新失败修复：
  - `refreshAssetMarketData` 外部行情失败时保留本地最近可信价。
  - 资产无 `lastPrice` 时使用持仓 `currentPrice / avgCost` 兜底。
  - 兜底结果返回 `local_last_price`、`stale=true`、`fallbackUsed=true` 和 warning。
  - 兜底价格同步更新持仓展示价、市值和浮盈亏。

- 后端新增 artifact ref 解析能力：
  - `GET /api/v1/operations/artifacts/:ref`
  - 支持 `advice:*`、`advice_input_snapshot:*`、`position_snapshot:*`、`market_snapshot:*`、`operation:*`、`alert:*`
  - 返回结构化产物详情，便于任务中心追踪产物。
- 前端任务中心将 Artifact Refs 从静态标签升级为可点击入口。
- 新增产物详情弹窗，展示 ref、类型、ID、创建时间和结构化 JSON。
- 完成 `artifactRef` 查询参数深链路：`/operations?artifactRef=...` 可直接打开指定产物详情。
- 完成 V1.5 异步化准备收口：
  - Operation DTO 新增 `operation_id`，兼容 `operationId` 与 `id`。
  - 前端任务提交入口统一解析 `operation_id / operationId / id`。
  - 旧 `/api/v1/positions/sync` 和 `/api/v1/positions/refresh-prices` 改为返回价格刷新 Operation。
  - 任务详情页展示 `operation_id`，作为后续 Connect/MCP 的稳定任务引用。
- 启动 V2.0 DomainPack 与工具契约：
  - HTTP MCP Bridge 新增 `GET /api/v1/mcp/domain-pack`。
  - `GET /api/v1/mcp/tools` 返回 `domain`、`version`、`inputSchema`、`outputSchema`、`permissions`、`safety`、`aliases`。
  - 新增 canonical tools：`operation.list`、`operation.get`、`operation.get_artifact`、`market_data.refresh_prices`、`alert.check`、`advice.generate_daily`、`backtest.run_from_advice`。
  - 保留旧工具名，并通过 `aliases` 对齐 dotted canonical naming。
  - 新增静态注册参考 `mcp/fams-domain-pack.json`。
- 完成 V2.0 工具契约复用模块拆分：
  - 新增 `backend/src/mcp/registry.ts`，集中维护工具注册、manifest、tools list、单工具调用和 batch 调用。
  - `backend/src/mcp/index.ts` 只保留 HTTP bridge 传输层。
  - `mcp/financial-mcp.json` 加入 `domainPack=mcp/fams-domain-pack.json`，capabilities 切换为 canonical tool names。
- 完成 V2.0 最小 stdio MCP Provider：
  - 新增 `backend/src/mcp/stdio.ts`，支持 `initialize`、`tools/list`、`tools/call`、`fams/domain-pack`。
  - stdio provider 复用 `backend/src/mcp/registry.ts`。
  - 新增 `backend/src/db/prisma.ts`，service/route 不再从 `index.ts` 导入 Prisma，避免 stdio 导入 registry 时启动 HTTP server。
  - `mcp/financial-mcp.json` 指向 `backend/dist/mcp/stdio.js`。
  - `mcp/fams-domain-pack.json` 将 stdio 状态标记为 `implemented`。
- 完成 V2.0 交易保护确认节点：
  - `create_transaction` MCP 工具新增 `confirmation` 输入 schema。
  - 未传入 `confirmation.confirmed=true` 与 `confirmation.confirmedBy` 时，MCP 只返回确认阻断结果和 `confirm_transaction_write` next action。
  - 阻断路径不会调用 `transactionService.createTransaction`，不会写入交易流水。
  - 普通 REST 交易录入路径保持不变，由前端人工操作页面继续承载。
- 完成 V2.0 MCP 调用 envelope 与审计上下文收口：
  - `callMcpTool` 统一返回 `fams.mcp.call.v1`。
  - 所有调用带 `status=completed|blocked|failed`、工具元数据和 `audit` 上下文。
  - HTTP `/call`、`/batch` 与 stdio `tools/call` 使用同一套 envelope。
  - stdio 成功/阻断路径在 content 文本中返回 envelope，失败路径在 JSON-RPC `error.data` 中返回 envelope。
- 完成 V2.0 Connect 用户上下文与授权边界：
  - MCP registry 支持显式 `parameters.userId`、HTTP `x-fams-user-id / x-user-id` header、stdio `params.context.userId`。
  - 工具需要 user context 且参数未带 userId 时，会从调用上下文自动注入。
  - 参数 userId 与调用上下文 userId 不一致时返回 `USER_CONTEXT_MISMATCH`。
  - 缺少 user context 时返回 `USER_CONTEXT_REQUIRED`。
  - 调用 envelope 的 `audit` 增加 `userContextSource`、`parameterUserId`、`contextUserId`。
- 完成 V2.0 harnessOS 最小连接器 manifest：
  - 新增 `mcp/harnessos-connector.json`。
  - 定义 `fams_mcp_http` 与 `fams_mcp_stdio` 两个 connector 注册入口。
  - 连接器 manifest 引用 `mcp/fams-domain-pack.json`，并声明用户上下文、调用 envelope、交易保护和 15 个 canonical tools。
  - `mcp/fams-domain-pack.json` 新增 `connectorManifest`。
  - `mcp/financial-mcp.json` 新增 `harnessOSConnector`。
- 完成 V2.0 验收收口和发现问题修复：
  - `/api/v1/workflows` 从占位实现改为进程内真实 execution registry。
  - `daily_analysis` 工作流复用 MCP/Operation 路径，包含价格刷新、仓位读取、告警检查和每日建议。
  - 价格刷新步骤改为提交异步子 Operation 后继续，避免外部行情源阻塞分析链路。
  - workflow execution 支持真实状态查询、历史列表和取消，取消时尽力取消子 Operation。
  - 任务中心移动端布局、Operation detail 深链、artifact 结构化展示已修复。
  - Dashboard 修复长百分比和风险仪表盘重叠。
- 修复 AI 股票分析链路：
  - 后端入口加载 `.env`，DeepSeek / MiniMax key 可进入运行态。
  - 股票行情 HTTP provider 增加 curl fallback，规避 axios 经本机代理访问 HTTPS 时返回 400/502 的问题。
  - A 股实时行情新增 Sina fallback，601888 可正确识别为中国中免。
  - 移除“真实数据失败后按代码前缀伪造贵州茅台/平安银行/比亚迪”的静默 mock。
  - LLM 响应新增 `provider`、`isAiGenerated`，前端明确展示 DeepSeek / MiniMax / 本地规则兜底。
- 修复本轮用户反馈问题：
  - 删除“集合投资”标签类型，并从前端预设、后端自动类型标签和现有数据库持仓标签中移除。
  - TagSelector 增加“管理标签/删除”入口，删除标签时同步解除资产关联和持仓 JSON 标签。
  - Dashboard 活跃告警风险仪表盘隐藏轴刻度，修复数字重叠。
  - 价格刷新 Operation 改为并发刷新并设置单资产 8 秒超时，告警检查不再二次刷新价格。
  - 分析建议页合并 Dashboard AI 股票分析入口，新增统一标的/板块研究信息块和 AI 选股入口。
  - AI 选股第一版支持“A杀后横盘放量”规则，返回候选、指标和分析建议。

## 验证记录

- 查询正确性阶段 1：
  - `backend`: `node node_modules/typescript/bin/tsc` 通过。
  - `frontend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - `GET /api/v1/assets/resolve?input=513770` 返回 `assetType=etf`，并提示本地资产类型 `stock` 与规则类型 `etf` 冲突。
  - `GET /api/v1/assets/resolve?input=601888` 返回 `stock / CN / SH`。
  - `GET /api/v1/assets/resolve?input=600276` 返回 `stock / CN / SH`。
  - `GET /api/v1/assets/resolve?input=000651` 返回 `stock / CN / SZ`。
  - `GET /api/v1/assets/resolve?input=现金-现金-银行卡` 返回 `cash / LOCAL`。
  - `GET /api/v1/assets/resolve?input=015311` 返回 `fund / CN`。
  - `GET /api/v1/assets/resolve?input=009725` 返回 `bond / CN`。
  - `GET /api/v1/prices/realtime?symbol=513770` 返回 `assetType=etf`、`price=0.421`、`source=local_last_price` 和实时行情超时 warning。
  - `GET /api/v1/prices/realtime?symbol=601888` 无本地最近价时返回 `price=null` 和明确失败 warning。
- 价格刷新验证：
  - `backend`: `node node_modules/typescript/bin/tsc` 通过。
  - `POST /api/v1/operations/refresh-prices` 创建 Operation `d7ee2bf0-3bda-4aee-a9c7-7a42e01f7ef2`。
  - 轮询返回 `status=completed`、`progress=100`、`refreshed=24`、`failed=0`、`liveSuccesses=3`、`staleFallbacks=21`。
  - 原失败项 `006476`、`021634` 通过持仓 `currentPrice` 兜底纳入成功结果。

- 后端 artifact API：
  - `GET /api/v1/operations/artifacts/advice%3A62d04d94-7a68-4573-8497-6163b8b638df`
  - `GET /api/v1/operations/artifacts/position_snapshot%3Ae1de5e8b-3d7b-4aaf-8851-0f52fe2ebe20`
- 类型检查：
  - `frontend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - `backend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端运行态截图：
  - `.verification/operation-artifact-clickable.png`
  - 截图确认任务中心 Artifact Refs 可见，布局正常。
  - `.verification/operation-artifact-detail-deeplink-fixed.png`
  - 截图确认 `artifactRef` 深链路可直接打开建议产物详情弹窗。
- Operation ID 契约与轮询：
  - `POST /api/v1/operations/check-alerts` 返回 `id`、`operationId`、`operation_id`。
  - `GET /api/v1/operations/e37f0323-fd75-4e25-b930-b41f4e10b358` 轮询到 `completed`。
  - `POST /api/v1/positions/refresh-prices` 返回 `refresh_prices` Operation 和 `operation_id`。
  - `.verification/operation-id-polling-contract.png`
  - 截图确认任务详情展示 `operation_id`、完成状态、输入参数和执行结果。
- V2.0 DomainPack / MCP HTTP 验证：
  - `GET /api/v1/mcp/domain-pack` 返回 `schemaVersion=fams.domainpack.v1`、8 个 domain、15 个工具。
  - `GET /api/v1/mcp/tools` 返回 `schemaVersion=fams.mcp.tools.v1`。
  - `create_transaction.permissions.requiresHumanConfirmation=true`。
  - `alert.check.safety.returnsOperationId=true`。
  - `POST /api/v1/mcp/call` 调用 `operation.list` 返回带 `operation_id` 的 Operation 列表。
  - `POST /api/v1/mcp/call` 调用 `alert.check` 返回 `operation_id=fe58d1e9-f738-44a7-a290-14cf32aa1235` 并完成任务。
- V2.0 registry 复用验证：
  - `backend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - `mcp/financial-mcp.json` 与 `mcp/fams-domain-pack.json` JSON 解析通过。
  - `GET /api/v1/mcp/domain-pack` 仍返回 8 个 domain、15 个 tools。
  - `POST /api/v1/mcp/call` 调用 `operation.list` 仍返回带 `operation_id` 的 Operation。
  - 缺失工具返回 `404` 与 `TOOL_NOT_FOUND`。
- V2.0 stdio Provider 验证：
  - `backend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - stdio JSON-RPC 调用 `initialize`、`tools/list`、`fams/domain-pack` 成功。
  - stdio provider 不再启动额外 HTTP server。
  - 自动比对 HTTP 与 stdio：两边均返回 15 个 tools，DomainPack schema 一致。
  - `create_transaction.permissions.requiresHumanConfirmation=true` 在 stdio `tools/list` 中保留。
- V2.0 交易保护确认验证：
  - `backend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - `mcp/fams-domain-pack.json` 与 `mcp/financial-mcp.json` JSON 解析通过。
  - HTTP `GET /api/v1/mcp/tools` 返回 `create_transaction` 的 `confirmation` schema、`requiresHumanConfirmation=true`、`returnsNextActions=true`。
  - HTTP `POST /api/v1/mcp/call` 未带确认调用 `create_transaction` 返回 `blocked=true` 与 `HUMAN_CONFIRMATION_REQUIRED`。
  - 数据库 `transaction.count()` 调用前后均为 3，确认阻断路径未写入交易流水。
  - stdio JSON-RPC `tools/list` 和 `tools/call` 返回同样的确认 schema 与阻断结果。
- V2.0 MCP envelope 验证：
  - `backend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - HTTP `operation.list` 返回 `schemaVersion=fams.mcp.call.v1`、`status=completed`、`audit.transport=http`。
  - HTTP 未确认 `create_transaction` 返回 `status=blocked`、`result.code=HUMAN_CONFIRMATION_REQUIRED`，数据库交易数量仍保持 3。
  - HTTP 缺失工具返回 `404`、`status=failed`、`error.code=TOOL_NOT_FOUND`。
  - HTTP batch 返回 `schemaVersion=fams.mcp.batch.v1`，子调用状态分别为 `completed` 与 `failed`。
  - stdio JSON-RPC 验证 `completed`、`blocked`、`failed` 三种路径均携带 `fams.mcp.call.v1` 与 `audit.transport=stdio`。
- V2.0 用户上下文边界验证：
  - `backend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - HTTP 显式 `parameters.userId=default` 调用 `operation.list` 保持兼容，`userContextSource=explicit_parameter`。
  - HTTP 仅传 `x-fams-user-id=default` 且参数不带 userId 时，`operation.list` 成功，`userContextSource=http_header`。
  - HTTP header userId 与参数 userId 冲突时返回 `USER_CONTEXT_MISMATCH`。
  - HTTP 缺少任何 userId 时返回 `USER_CONTEXT_REQUIRED`。
  - stdio `params.context.userId=default` 可自动注入，冲突时返回 JSON-RPC error 且 `error.data.error.code=USER_CONTEXT_MISMATCH`。
  - 未确认 `create_transaction` 通过 header 注入 userId 后仍返回 `status=blocked`，数据库交易数量仍保持 3。
- V2.0 harnessOS 连接器 manifest 验证：
  - `mcp/harnessos-connector.json`、`mcp/fams-domain-pack.json`、`mcp/financial-mcp.json` JSON 解析通过。
  - connector manifest 与 DomainPack 的 canonical tools 完全一致，数量均为 15。
  - `backend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - HTTP `GET /api/v1/mcp/domain-pack` 返回 15 个 tools，stdio 状态为 `implemented`。
  - HTTP `GET /api/v1/mcp/tools` 返回 15 个 tools 且包含 `operation.list`。
  - HTTP 使用 `x-fams-user-id=default` 调用 `operation.list` 返回 `status=completed`。
  - stdio JSON-RPC `fams/domain-pack`、`tools/list`、带 `context.userId=default` 的 `operation.list` 调用均成功。
  - 未确认 `create_transaction` 经 HTTP header 注入 userId 后仍返回 `status=blocked`、`HUMAN_CONFIRMATION_REQUIRED`，数据库交易数量仍保持 3。
- V2.0 端到端 workflow 与前端验收：
  - `backend`: `node node_modules/typescript/lib/tsc.js --noEmit` 通过。
  - `frontend`: `node node_modules/typescript/bin/tsc` 通过。
  - `frontend`: `node node_modules/vite/bin/vite.js build` 通过，仅有既有 chunk size warning。
  - `POST /api/v1/workflows/execute` 执行 `daily_analysis`，execution `75d7d8da-6f1f-4691-82de-16f9195dc29a` 轮询到 `completed`、`progress=100`、`completedSteps=4/4`、3 个子 Operation、无 errors。
  - 建议子 Operation `d96f438e-d6a6-4793-abfc-2d0c18a89c6c` 完成，生成 advice `3f8b623d-a902-46c6-9419-994e135b7d83`、24 个持仓快照、17 个行情快照、43 个 artifact refs。
  - Chrome 截图：`.verification/v20-fixed-operations-desktop-final.png`、`.verification/v20-fixed-operations-mobile-final3.png`、`.verification/v20-fixed-operation-detail-final.png`、`.verification/v20-fixed-artifact-detail-final.png`、`.verification/v20-fixed-dashboard-final.png`。
- AI 股票分析验证：
  - `backend`: `node node_modules/typescript/lib/tsc.js --noEmit` 通过。
  - `frontend`: `node node_modules/typescript/bin/tsc` 通过。
  - `GET /api/v1/stocks/601888?market=A股&days=30` 返回 `name=中国中免`、`currentPrice=62.68`。
  - `POST /api/v1/llm/stock-advice` 输入 `601888` 返回 `provider=deepseek`、`isAiGenerated=true`、`name=中国中免`、3 条 AI reasoning。
- 本轮反馈修复验证：
  - `GET /api/v1/tags` 返回 `hasCollection=false`，数据库清理结果 `removedAssetLinks=1`、`removedFromPositions=1`。
  - `backend`: `node node_modules/typescript/bin/tsc` 通过。
  - `frontend`: `node node_modules/typescript/bin/tsc --noEmit` 通过。
  - `POST /api/v1/operations/refresh-prices` 轮询 Operation `6a0a8eec-c7c0-412f-8897-e1a0204020ef` 返回 `completed`，任务不再卡死；当前外部 provider 超时导致 `refreshed=3`、`failed=21`。
  - `POST /api/v1/analysis/stock-screener` 返回 `strategy=A杀后横盘放量`、`universeSize=10` 和候选列表。
  - Windows Chrome headless 截图：`.verification/dashboard-after-fix-wait.png`、`.verification/analysis-ai-screener-wait.png`。
- 价格刷新口径与 Sina 实时源修复：
  - 本地最近可信价不再计入刷新成功，只显示为 `retainedLocalPrices` / `fallbackUsed=true` / `stale=true`。
  - A 股和场内 ETF provider 顺序调整为 Sina 优先；Sina provider 使用系统 `curl` 获取行情，规避 Node axios 在当前 WSL 代理环境下超时或 503。
  - `GET /api/v1/prices/realtime?symbol=513770` 返回 `price=0.429`、`source=sina`、`fallbackUsed=false`、行情时间 `2026-05-11 15:00:03` 北京时间。
  - `POST /api/v1/operations/refresh-prices` 轮询 Operation `ffccccac-58fd-4337-bed5-a76a855b8690` 返回 `completed`、`refreshed=9`、`failed=15`、`realtimeRefreshed=9`、`retainedLocalPrices=15`。
  - 单标的刷新 Operation `8aeba2a8-caa6-4a86-bc6c-8cb57c31b286` 验证 `513770` 持仓同步为 `currentPrice=0.429`、`lastPrice=0.429`、`lastUpdated=2026-05-11 15:00:03` 北京时间。
  - 前端资产页、持仓页、任务页已改为显示“实时成功 / 未刷新 / 保留旧价”，失败明细表显示保留旧价和三位小数价格。
- 基金/债基 provider 补强：
  - 天天基金接口改为 curl 通道，规避 Node axios 在当前 WSL 代理环境下的 400、ECONNRESET 和 timeout。
  - 非交易所 ETF 前缀的本地 fund/bond 类型优先，修复 `007467`、`019062`、`012857` ETF 联接基金误走股票/场内 ETF provider。
  - 天天基金实时估值为空时使用东方财富最新官方净值 `eastmoney_nav`，并保留行情日期。
  - 前端刷新文案从“实时成功”改为“外部成功”，避免把官方净值称为盘中实时价。
  - 全量刷新 Operation `6041c162-867b-4128-814e-d0d45b307909` 验证 `completed`、`refreshed=24`、`failed=0`、`externalRefreshed=24`、`retainedLocalPrices=0`，来源覆盖 `sina / tiantian / manual / eastmoney_nav`。
- 行情可靠性自动回归：
  - 新增 `backend/scripts/verify-market-data-reliability.ts`，覆盖 resolver、单标的行情和全量刷新。
  - `backend/package.json` 新增 `npm run test:market-data`，使用 `node node_modules/tsx/dist/cli.mjs` 稳定入口。
  - `npm run test:market-data` 通过，验证 `513770=etf`、`007467/019062/012857=fund`，行情源分别为 `sina / tiantian / eastmoney_nav`，全量刷新 Operation `bf146b0e-a45a-4c05-97e5-b68c4c952f78` 返回 `external=24`、`failed=0`、`retained=0`。
- 异常价格跳变和行情来源展示：
  - 刷新结果新增 `previousPrice`、`priceChangeFromPreviousPercent`、`abnormalPriceJump`，超过阈值时写入 warning，summary 汇总异常跳变数量。
  - 持仓 DTO 新增 `asset.lastPriceSource`，资产页新增“来源”列，任务中心和刷新 toast 显示异常跳变数量。
  - `npm run test:market-data` 再次通过，Operation `b09a55a5-f2f6-4c15-84b6-3522f29e906e` 验证 `external=24`、`failed=0`、`retained=0`、关键样例未触发异常跳变。
  - 持仓接口验证 `513770 source=sina`、`006476/021634 source=eastmoney_nav`。
  - 前端 Vite 服务恢复监听 `http://localhost:3000`。
- 目标研究和 AI 股票分析接入 resolver：
  - `analyzeTarget` 不再对 6 位代码走股票快捷行情源，统一先经 `Asset Identity Resolver`，再通过 `MarketDataService` 查询行情。
  - 目标研究输入快照和建议参数带入 `identity`、`source`、`sourceTime`、`fallbackUsed` 和可靠性信息。
  - `/api/v1/llm/stock-advice` 新增 resolver 守卫，仅允许 `stock/CN` 标的进入 AI 股票分析；ETF、基金、债券返回 400 和 identity。
  - `npm run test:market-data` 通过，Operation `de3d3de1-c706-47b9-9220-6392c26973ca` 验证 `external=24`、`failed=0`、`retained=0`。
  - `POST /api/v1/analysis/target-research` 输入 `513770` 返回 `identity.assetType=etf`、`quote.source=sina`、`sourceTime=2026-05-11T07:00:03.000Z`；`POST /api/v1/llm/stock-advice` 输入 `513770` 返回 400，并提示使用统一标的研究入口。
- 同花顺持仓成本口径修复：
  - `TransactionService` 股票/ETF 部分卖出改为卖出净回款冲减剩余持仓成本，并重新计算剩余股数成本价。
  - open 持仓的部分卖出盈亏不再单独累加到 `realizedPnl`，避免和成本价重复计算；回滚买入/卖出也同步改为交易实际买入成本和卖出净回款。
  - 已定向修复 `601127` 当前持仓：`quantity=1900`、`avgCost=136.4541052631579`、`costBasis=259262.8`、`currentPrice=89.19`、`marketValue=169461`、`unrealizedPnl=-89801.8`、`realizedPnl=0`。
  - 追加核验并修复新卖出的两笔交易：`513770` 卖出 12000 份后 `quantity=82800`、`avgCost=0.5068309178743962`、`costBasis=41965.6`、`realizedPnl=0`；`159851` 卖出 13100 份后 `quantity=38100`、`avgCost=0.8120026246719159`、`costBasis=30937.3`、`realizedPnl=0`。
  - 新增 `backend/scripts/verify-transaction-cost-model.ts` 和 `npm run test:transaction-cost`，锁定同花顺成本公式；脚本验证 `513770`、`159851`、`601127` 三个真实卖出案例和“卖出后再买入”合成案例。
  - 跨接口验证 `GET /api/v1/positions?userId=default&limit=100` 与 `GET /api/v1/positions/by-tag/default` 对 `513770`、`159851`、`601127` 的盈亏和收益率一致。
- 基金估值口径修复：
  - 核对当前基金持仓发现 `costBasis = quantity × avgCost` 正确，但部分基金刷新外部净值后仍保留导入时 `marketValue`，导致现价与市值/浮盈口径不一致。
  - `MarketDataService` 批量刷新和 `PositionService.refreshPositionPrices` 已统一逻辑：真实份额基金按 `marketValue = quantity × currentPrice` 重算，`unrealizedPnl = marketValue - costBasis`；`quantity=1` 的债券/类固收手工总额资产继续保留导入市值。
  - `backend/scripts/verify-market-data-reliability.ts` 增加基金估值断言；`npm run test:market-data` 通过，Operation `735eb249-276f-43b0-bb93-dc5d29869014` 验证 `external=23`、`failed=0`、`retained=0`。
  - 接口复核 `019062`、`011613`、`014064`、`021634`、`015311`、`007467`、`014674`、`015916`、`013597`、`012857`、`501008` 的 `marketValue` 均等于 `quantity × currentPrice`；`013785`、`009725`、`014086` 保持手工总额；`npm run test:transaction-cost` 同时通过。
- 持仓/标签/页面聚合一致性：
  - 新增 `backend/scripts/verify-position-consistency.ts` 和 `npm run test:position-consistency`，验证 `/positions` summary、持仓列表和 `/positions/by-tag` 的总市值、总成本、总盈亏、持仓数量一致，并验证持仓公式与标签注册表完整性。
  - `syncAssetTags` 改为精确同步，标签修改或删除后不会被旧 assetTag 重新带回；按标签分组同时合并 `position.tags` 与 `asset.assetTags`。
  - `GET /api/v1/tags` 会补齐历史持仓 JSON 标签，`赛里斯` 已进入标签注册表，修复“管理标签比所有标签少”的问题。
  - 验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:position-consistency` 返回 `positions=23, totalValue=713046.64, bins=5`；`npm run test:transaction-cost` 通过。
  - Windows Chrome headless 截图：`.verification/position-consistency-dashboard-loaded.png`、`.verification/position-consistency-assets-loaded.png`，总览和资产页总市值均显示 `71.30万`。
- 分析建议行情快照前端可追溯：
  - `generateInvestmentSuggestions` 返回 `marketDataTrace`，包含每个建议输入标的的行情来源、来源标签、价格、涨跌幅、置信度、行情时间、fallback 状态和 warnings。
  - 分析建议页新增“行情取数快照”面板，日常建议和单标的研究都能看到来源、时间、回退和警告数量；标的研究行情卡片新增“行情时间”。
  - 新增 `backend/scripts/verify-analysis-trace.ts` 和 `npm run test:analysis-trace`，验证日常建议 `marketDataTrace=23` 且与 matched positions 对齐，`513770` 标的研究返回 `source=sina`、`timestamp=2026-05-11T07:00:03.000Z`、`fallbackUsed=false`。
  - 验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:analysis-trace` 通过；Windows Chrome headless 截图 `.verification/analysis-market-trace-visible.png` 确认面板可见。

## 当前服务

- 后端：`http://localhost:4000`
- 前端：`http://localhost:3000`
- 本轮重启后监听进程：
  - backend node pid 当前为 `4457`
  - frontend Vite node pid 当前为 `5153`

## 2026-05-12 最新进度

- 新增行情监控模块：后端复用 `AlertRule` 保存宽基回撤监控配置，默认启用上证指数、沪深300、中证500、中证1000、创业板指、科创50，观察窗口 250 个交易日，默认 10% 建仓提醒。
- 新增接口：`GET /api/v1/alerts/market-watch/rules`、`PUT /api/v1/alerts/market-watch/rules`、`GET /api/v1/alerts/market-watch/evaluations`、`POST /api/v1/alerts/market-watch/check`。
- 前端 Alerts 页面新增“宽基回撤监控”和“宽基监控配置”，支持监控标的、回撤阈值、观察窗口和启用状态配置。
- 新增 `backend/scripts/verify-market-watch-alerts.ts` 和 `npm run test:market-watch`。
- 验证：后端和前端 TypeScript 检查通过；`npm run test:market-watch` 通过；API 验证当前上证指数 `latestDate=2026-05-12`、`latestPrice=4214.489`、`peakPrice=4230.184`、`drawdownPercent=0.37`、未触发 10% 建仓提醒；规则保存接口验证成功。
- 前端截图验证已完成：临时解包 Playwright 缺失库到 `.verification/playwright-libs/lib`，截图 `.verification/market-watch-alerts-page.png` 验证页面包含“宽基回撤监控”、“宽基监控配置”、上证指数、沪深300 和 10% 阈值，且无前端错误日志；页面点击“检查宽基”确认 POST 检查接口返回 200，并联动刷新规则、评估和告警列表。
- AI 选股策略服务抽离：新增 `backend/src/services/screener/stockScreenerService.ts`，`AnalysisService` 改为委托调用。返回结果新增 `strategyDefinition`、结构化阈值、`matchedRules / unmatchedReasons`、`observability` 和数据质量统计。
- 新增 `backend/scripts/verify-stock-screener-service.ts` 和 `npm run test:screener-service`，合成 K 线验证命中样例 `score=100`、未命中样例返回三条原因，并验证查询里的阈值解析。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:screener-service` 通过；`npm run test:screener-resolver` 通过，返回 `universe=5514`、`candidates=8`、`excluded=18`、`failures=0`；Playwright 截图 `.verification/analysis-screener-service-structured.png` 验证分析页展示“策略定义”、`provider成功率`、命中/未命中原因和全 A 股样本池，且无前端错误日志。
- AI 选股第二批策略：新增 `放量突破平台` 和 `跌破后收复关键均线`，查询文本会映射到 `volume_platform_breakout` 或 `ma_reclaim`。接口验证两个策略均返回正确 `strategyDefinition.id` 和扫描结果；Playwright 截图 `.verification/analysis-screener-multistrategy-platform.png` 验证前端展示放量突破平台策略、策略定义、provider 成功率和突破规则说明，且无前端错误日志。

## 2026-05-17 最新进度

- 持仓级止盈止损提醒闭环完成并修正为收益率阈值：资产管理表格新增“收益率止盈/止损”列，编辑弹窗支持为非现金持仓维护止盈收益率、止损收益率；保存后调用风险检查，当前收益率已触发时生成风险告警。
- 后端 `/api/v1/alerts/risk-check` 支持 `refreshPrices=false`，用于按当前已验证持仓收益率做即时检查；`Position.stopLoss / takeProfit` 支持保存和清空。
- `backend/scripts/verify-stop-alerts.ts` 与 `npm run test:stop-alerts` 改为收益率阈值验证，验证 `601127` 当前收益率 `-38.98%`、测试止损收益率 `-38.97%` 后返回 `alertedSymbols=["601127"]` 并生成包含“收益率”的“触及止损线”风险告警，验证后恢复阈值并清理测试告警。
- 验证：后端/前端 TypeScript 检查通过；Playwright 截图 `.verification/assets-return-percent-stop-alerts.png` 和 `.verification/assets-return-percent-stop-alerts-modal.png` 验证资产页收益率止盈/止损列和编辑弹窗字段可见，无前端错误日志。
- 分析技术指标输入按交易日去重：`014064` 银华农业最近 30 天原始刷新记录 21 条，但有效交易日只有 3 天，样本不足时不输出 RSI 信号，避免重复刷新记录把 RSI 扭曲为 `0`。
- 持仓页新增“新增持仓”能力：后端新增 `/api/v1/positions/manual-buy`，前端新增弹窗，支持按金额或份额新增买入持仓并创建交易；`npm run test:manual-buy-position` 验证 8000 元 / 1.25 元临时持仓反推 6400 份，通过后自动清理数据。
- 新增 `docs/AI_INVESTMENT_ANALYSIS_MODEL_PLAN.md`，明确后续分析建议建设为外部可信指标、可回测策略模型、LLM 解释和人工微调闭环。
- 股票分析三面内容空泛问题已纳入开发计划：后续基本面、消息面、技术面必须基于 `StockAnalysisFactSet` 和 `evidenceRefs`，没有可靠数据时显示数据不足，不再输出模板化空话。
- 外部策略发现与策略锦标赛已纳入开发计划：后续系统从 GitHub/文档/用户粘贴策略中解析选股策略和投资策略，经审核后批量模拟买入执行，按胜率、收益、回撤、夏普、换手率等指标可视化对比。
- 技术指标服务保护性第一段已完成：新增 `TechnicalIndicatorService`，统一交易日去重、样本质量、均线、RSI、MACD、BOLL、ATR、量比和支撑压力位；`AnalysisService.getTradingSignals` 已迁移到该服务，但本地指标只作为审计和 fallback，不再生成交易信号；股票分析服务不再用实时价伪造历史 K 线，历史样本不足时返回数据不足。正式技术面建议后续必须接入外部成熟 K 线/指标源和可靠技术模型。
- 验证：`npm run test:technical-indicators`、后端 TypeScript 检查、`npm run test:analysis-trace`、`npm run test:stop-alerts` 均通过。
- 股票分析技术面外部指标展示已完成第一段：新增 `ExternalTechnicalDataProvider`，通过 TradingView Scanner 获取 A 股外部技术评级和指标；前端技术指标面板展示外部来源、TradingView 标的、综合/均线/振荡器评级、RSI、MACD、ATR、SMA 和更新时间。本地指标仅作为复核值。
- 验证：`npm run test:external-technical` 通过；接口 `GET /api/v1/stocks/601127?market=A股&days=80` 返回 `externalTechnical.quality=ok`、`provider=TradingView Scanner`、`providerSymbol=SSE:601127`；后端/前端 TypeScript 检查通过。
- 外部技术指标多源可信度评分已完成：`externalTechnical.confidence` 输出分数、等级、来源数和校验明细；TradingView 技术评级与 Eastmoney/Sina K 线复核收盘价、SMA20、RSI14 和 MACD 方向。`601127` 验证可信度 `95/high`，来源数 `2`，四项交叉校验均通过。
- `TechnicalAdviceModelRegistry` 第一版已完成：`tradingview_ratings_interpretation_v1` 在外部指标质量正常、多源可信度达到 `80` 且无失败校验时，输出技术面观察结论、证据、风险、边界和阻断原因。`601127` 验证返回 `technicalAdvice.status=available`、`stance=defensive`、`summary=技术面偏防守`；低可信路径由 `npm run test:technical-advice-model` 覆盖并阻断。
- `StockAnalysisFactSet` 技术面第一段已完成：股票分析 API 返回 `factSet.schemaVersion=stock.analysis.factset.v1`，技术面 facts 覆盖外部指标、可信度、交叉校验、本地复核和模型输出；基本面、消息面明确为 `insufficient_data`。`npm run test:stock-analysis-factset` 通过，`601127` 返回技术 facts `13` 条，`technicalAdvice.evidenceRefs` 全部可追溯。
- 基本面估值事实第一段已完成：新增 `FundamentalDataProvider`，通过东方财富获取动态 PE、PB、总市值和流通市值，写入 `factSet.fundamental` 并同步前端估值卡片。`npm run test:fundamental-factset` 通过，`601127` 返回 `peRatio=47.22`、`pbRatio=3.45`、基本面 facts `4` 条；成长、盈利质量、现金流和行业分位仍待接入。
- 消息面事件流第一段已完成：新增 `NewsDataProvider`，通过东方财富搜索获取个股新闻，写入标题、摘要、媒体、发布时间、链接、事件类型、规则情绪和相关性，并同步到 `factSet.news`。`npm run test:news-factset` 通过，`601127` 返回新闻事件 `8` 条、消息面 facts `6` 条、首条来源证券日报；公告全文、影响强度和多源去重仍待接入。
- `StockAnalysisSummary` 三面汇总第一段已完成：股票分析 API 返回 `analysisSummary`，技术面、基本面、消息面分别包含状态、摘要、证据引用和阻断原因。`npm run test:stock-analysis-summary` 通过，`601127` 返回技术面 `available`、基本面 `partial`、消息面 `partial`、整体 `partial`。
- 基本面财报主指标第一段已完成：`FundamentalDataProvider` 新增东方财富 F10 财务主指标接口，`factSet.fundamental` 从估值 4 条扩展到 13 条，覆盖最新财报期、营收、营收同比、归母净利、净利同比、ROE、毛利率、资产负债率、经营现金流和 EPS；`StockAnalysisSummary` 基本面摘要同步展示这些财报事实。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；接口验证 `601127` 返回 `2026一季报`、营收 `25745711786.75`、归母净利 `754464672.82`、ROE `1.83`、资产负债率 `65.9226`、经营现金流 `-20950295141.48`。
- 基本面行业分位第一段已完成：`FundamentalDataProvider` 接入东方财富行业板块和成分股，`601127` 映射到 `乘用车(BK1262)`，同业样本数 9；基本面 facts 扩展到 20 条，新增 PE/PB/总市值/ROE/资产负债率同业分位，摘要层展示“同业对比”。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；运行态接口返回 PE 低估分位 `11.11`、PB 低估分位 `44.44`、ROE 分位 `100`、负债率低位分位 `33.33`。
- 财报主指标同厂不同接口复核第一段已完成：新增 `financialCrossCheck`，用东方财富 F10 主指标与东方财富数据中心业绩报表交叉校验营业收入、归母净利润、基本 EPS、ROE 和毛利率；复核状态和逐项差异写入 facts。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset` 验证 `601127` 五项复核全部 `pass`、差异 `0%`；`npm run test:stock-analysis-factset` 验证基本面 facts `26` 条；运行态接口显示 `财报复核：ok / RPT_LICO_FN_CPD`。
- 独立来源财报复核第一段已完成：新增 `independentFinancialCrossCheck`，解析搜狐证券重要财务指标页 `SOHU_CWZB`，按万元转换为元后复核主营业务收入、净利润、每股收益、ROE 和资产负债率；基本面 facts 扩展到 32 条，摘要显示独立来源复核状态。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset` 验证 `601127` 搜狐 5 项复核全部 `pass`；`npm run test:stock-analysis-factset` 和 `npm run test:stock-analysis-summary` 通过；运行态接口显示 `独立来源复核：ok / SOHU_CWZB`。
- 公告原文定位第一段已完成：新增 `officialAnnouncement`，通过搜狐证券重大事项备忘页定位 `601127` 对应报告期公告，抽取 `2026年第一季度报告`、披露日期 `2026-04-30` 和上交所 PDF 链接；基本面 facts 扩展到 36 条，摘要显示 `公告原文：located / PDF`。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；运行态接口返回 PDF `https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-04-30/601127_20260430_LC8M.pdf`。
- 基金/债基刷新口径修复：用户手工录入总市值和收益率只用于反推份额与成本，后续刷新净值时固定份额和成本，按 `marketValue = quantity × official NAV` 重算市值与收益率。
- 净值源修复：场外基金/债基优先使用东方财富官方单位净值 `eastmoney_nav`；天天基金 `gsz` 标记为盘中估值，不再作为“最新净值”主源。
- 新增 `backend/scripts/verify-fund-nav-sources.ts` 和 `npm run test:fund-nav-sources`，逐只对比东方财富官方净值、天天基金官方旧净值和天天基金盘中估值，并断言系统当前净值采用东方财富官方净值。
- 验证：刷新 Operation `b5952ee2-a61f-4588-9130-8b54c2ed82d7` 返回 `externalRefreshed=22 / failed=0 / retainedLocalPrices=0`；`npm run test:market-data`、`npm run test:position-consistency`、`npm run test:derived-quantity`、`npm run test:fund-nav-sources` 均通过；资产页截图 `.verification/assets-fund-nav-official-refresh.png` 通过。

## 2026-05-19 最新进度

- AI 选股多策略短窗胜率评估第一段完成：`StockScreenerService` 复用同一批历史 K 线，同时评估 `A杀后横盘放量`、`放量突破平台`、`跌破后收复关键均线`，返回 `strategyTournament`。
- 胜率口径：最近 `验证天数` 个可验证交易日内出现策略信号后，按 `持有天数` 后的收盘价计算收益和胜负；默认 `验证天数=5`、`持有天数=3`，查询文本可覆盖。
- 前端 AI 选股结果新增“多策略短窗胜率”区块，展示策略排行、信号数、胜负、平均收益和当前命中数。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:screener-service` 通过；运行态接口 `多策略胜率；扫描上限=30；验证天数=5；持有天数=3` 返回 A杀策略 `signals=5 / wins=0 / winRate=0 / avg=-6.06`，均线收复 `signals=1 / wins=0 / avg=-8.54`，平台突破 `signals=0`。
- AI 选股短窗胜率回测批次持久化完成：每次扫描生成 `batchId`，三类内置策略分别保存为 `Backtest / BacktestResult`，`reviewReportJson` 记录原始查询、策略阈值、样本池、数据质量、观测指标、信号样本和候选。运行态验证 `batchId=13529910-0c3a-424a-9ae4-af490e2f48a7`，A杀策略 Backtest `57a4eb9d-6859-4615-b507-3e384b76ca18` 可通过 `/api/v1/backtest/results/:id` 追溯。
- 基本面开发第一轮收尾：`npm run test:fundamental-factset` 和 `npm run test:stock-analysis-summary` 通过，`601127` 基本面 facts `36` 条，覆盖估值、2026 一季报主指标、行业分位、东方财富同厂复核、搜狐独立复核和上交所 PDF 定位；摘要保持 `partial`，明确 `PDF 表格抽取未接入`。
- 持仓研究面板优化：后端按股票、基金/ETF/债基、黄金、现金分别输出基本面/技术面/消息面研究边界，前端改为市值、现价/成本、支撑/压力、止盈止损四个指标块和三栏研究卡片。运行态验证 22 条持仓研究，`601127` 指向个股事实集和公告原文，现金持仓显示金额口径。
- AI 选股可信度评估增强：多策略胜率结果新增同窗口全样本基准、超额收益、样本充分度、95% Wilson 胜率置信区间和可信评级，前端展示基准、超额和可信分。运行态 `扫描上限=50` 返回基准样本 250、基准平均收益 `-2.95%`、基准胜率 `21.2%`；三类策略当前均为 `low` 可信。
- 全 A 选股异步化和历史行情缓存第一段完成：新增 `OperationTask`、`MarketBarRaw`、`MarketBarCanonical`、`ProviderHealth`；`stock_screener_full_scan` Operation 按 `universe.snapshot / market_data.warmup / strategy.evaluate / backtest.aggregate / artifact.generate` 执行。
- 缓存与 provider 可靠性：扫描前先查 canonical 缓存，不足时拉 Sina 历史 K 线并写 raw/canonical；每个 warmup chunk 记录成功数、失败数、耗时、provider、cache hit rate 和 validation warnings；provider health 支持 degraded/open_circuit、指数退避、限速和健康报告。
- 任务产物：扫描完成生成 `leaderboard.json`、`candidate_list.json`、`strategy_metrics.json`、`data_quality_report.json`、`provider_health_report.json` 五类 artifactRefs。
- 前端任务中心：新增“全A选股扫描”按钮；详情页展示 Operation 分片任务表、取消按钮、partial success、失败原因、warnings、provider、缓存命中率和产物入口。
- 验证：后端/前端 TypeScript 检查通过；Prisma `db push/generate` 完成；端到端小样本 Operation `07f2582e-cb22-4f13-98ec-79f14ac51535` 完成，`artifactRefs=5`，`leaderboard.json` 可读取；数据库验证 `market_bar_raw=2209`、`market_bar_canonical=2200`。验证过程中发现 SQLite 并发写缓存会锁库，已加 WAL/busy_timeout、写入串行队列和扫描并发上限；全量 5500 只正式验收仍建议迁移 PostgreSQL/队列 worker。
- GPT 架构建议已合并进开发计划：FAMS 正式定位为有数据血缘、任务产物、回测审计和持仓约束的个人投资研究与决策系统。LLM 只解释结构化事实集和规则/回测/仓位引擎结论，不直接决定买卖。
- 后续开发顺序锁定为 P0-P6：Operation 状态机、历史 K 线缓存、Provider 治理、PositionAdviceFactSet + PositionAdviceEngine、策略锦标赛升级、持仓研究面板缓存化、AI Agent 接入。P0-P2 已完成第一段但未正式收口；下一主线进入 P3 持仓建议事实集和确定性仓位建议引擎。
- 硬规则已写入计划：数据不足、provider 冲突、策略可信度 `low / insufficient` 时不得输出加仓建议，只能输出观察、持有或无动作；没有 `evidenceRefs` 的建议不得进入交易计划；交易影响动作必须人工确认。
- P0-P2 兼容增强已执行：Operation 补充进度、取消、错误摘要和恢复字段；OperationTask 补充 attempt、idempotencyKey、输入/输出 JSON；raw/canonical K 线表补充 timeframe、providerSymbol、exchange、validationStatus、primaryProvider、confidence；provider_health 补充 endpoint、circuitState、cooldown 和错误/延迟统计字段。
- 验证：Prisma 同步通过，后端/前端 TypeScript 检查通过；小样本 Operation `1cf3e0b6-e92f-4865-b868-4af12e24512f` 完成，`progressCurrent=100`、`artifactRefs=5`、5 个任务分片均有 idempotencyKey，warmup cacheHitRate=31.14，raw/canonical 审计字段可查询。
- P3 持仓建议事实集和确定性仓位建议引擎第一段完成：新增 `positionAdviceService`，可生成 `position.advice.factset.v1`，覆盖组合权重、持仓成本/收益、行情来源、技术评分、基本面/消息面边界、策略证据、`blockedReasons` 和 `evidenceRefs`；新增 `PositionAdviceEngine`，按规则公式输出目标仓位区间、动作、理由、风险、触发条件和反证条件。
- 新增接口 `/api/v1/analysis/position-advice` 和 `/api/v1/analysis/position-advice/:positionId`；新增 `npm run test:position-advice`。硬边界已进入代码：低可信或证据不足时不输出 `ADD`，现金持仓为 `NO_ACTION`，缺少价格进入阻断。
- 验证：后端 TypeScript 检查通过；`npm run test:position-advice` 验证 22 个持仓事实集，结果都有 evidenceRefs；HTTP 端到端验证返回 22 条建议，非现金样例 `009725` 因 `strategy_evidence_missing` 返回 `OBSERVE / insufficient`。
- P3 前端接入第一段完成：`getHoldingsResearch` 返回 `positionAdvice`，分析建议页“当前持仓研究面板”展示仓位建议引擎卡片；证据不足时展示“证据不足”，不显示可执行目标仓位。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:position-advice` 通过；HTTP 持仓研究返回 22 条 `positionAdvice`；截图 `.verification/analysis-position-advice-holdings-layout-final.png` 验证前端持仓研究分区可见。
- P5 持仓建议缓存第一段完成：新增 `PositionAdviceCache`，缓存持仓建议事实集、确定性建议、summary、evidenceRefs、providerTrace、warnings、fresh 状态和下次刷新时间；`positionAdvice` 普通查询命中缓存，`forceRefresh=true` 强制重建；持仓研究面板展示缓存状态。
- 验证：Prisma 同步、后端/前端 TypeScript 检查和 `npm run test:position-advice` 通过；HTTP `forceRefresh=true` 写入 22 条缓存，后续普通查询返回 `cache.refreshed=false`；截图 `.verification/analysis-position-advice-cache-restarted.png` 显示“缓存新鲜”。验证期间发现 SQLite `dev.db` 损坏，已备份并迁移到完整性 ok 的干净库，核心资产/持仓/交易/回测/行情缓存保留，14 条损坏 `MarketSnapshot` 未恢复。
- P5 股票事实集缓存第一段完成：新增 `StockFactSetCache`，缓存个股 full analysis、`stock.analysis.factset.v1`、三面汇总、evidenceRefs、providerTrace、warnings、fresh 状态和下次刷新时间；股票分析接口普通查询命中缓存，`forceRefresh=true` 强制重建；个股分析页展示缓存状态。
- 验证：Prisma 同步、后端/前端 TypeScript 检查通过；`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary`、`npm run test:fundamental-factset`、`npm run test:stock-factset-cache` 通过；HTTP 601127 第二次查询返回 `cache.refreshed=false`，facts 为 13/36/6；截图 `.verification/stock-analysis-factset-cache.png` 显示“缓存新鲜”。
- P5 stale-while-revalidate 第一段完成：持仓建议缓存和股票事实集缓存过期但可解析时，接口先返回 `cache.status=stale` 的旧结果，同时后台去重刷新；刷新成功后恢复 `fresh`。
- 验证：`npm run test:position-advice` 覆盖持仓建议 stale -> fresh；`npm run test:stock-factset-cache` 覆盖 601127 股票事实集 stale -> fresh；后端/前端 TypeScript 通过；SQLite 完整性检查 ok，缓存状态为 `StockFactSetCache fresh=1`、`PositionAdviceCache fresh=22`。
- P5 批量事实集刷新 Operation 第一段完成：新增 `batch_factset_refresh` 和 `/api/v1/operations/refresh-factsets`，支持按 `all / position_advice / stock_factset` 范围批量刷新，可指定 `symbols` 和 `limit`；子任务记录成功数、失败数、耗时、provider、warnings 和失败详情，股票事实集单标的刷新加入 60 秒超时保护。
- 验证：后端/前端 TypeScript 通过；Operation `b2959557-bea6-41e7-87b2-71a77eafb856` 刷新 3 条持仓建议成功，Operation `521b8b6c-a1d0-4707-b2e1-2ab1bf5dac62` 刷新 `601127` 股票事实集成功；截图 `.verification/operations-factset-refresh-button.png` 验证任务中心“刷新事实集”入口和完成记录可见。
- P5 Operation 恢复第一段完成：`batch_factset_refresh` 支持服务启动后恢复 `queued/running` 状态任务，写入 `recoveryJson`，并按 `skip_completed_phase_tasks` 跳过已完成阶段，继续未完成的 `position_advice.refresh / stock_factset.refresh`；恢复范围暂时只覆盖事实集批量刷新，避免价格刷新、交易影响类任务重复副作用。
- 验证：新增 `npm run test:operation-recovery`，模拟 running 任务后恢复完成；Operation `d7a71d5e-d3bc-4dca-bdea-1f1efd8f3d4a` 返回 `completed / progress=100`，`position_advice.refresh success=1 / failed=0`，接口可查询 `recovery.reason=server_startup`。
- P5 Operation 租约与心跳第一段完成：`Operation` 新增 `leaseOwner / leaseExpiresAt / heartbeatAt`；`batch_factset_refresh` 执行前必须获取租约，进度更新续租并刷新心跳，完成/失败/取消释放租约；启动恢复只接管 `queued`、无租约或租约过期的任务，有效租约任务会跳过。
- 验证：Prisma `db push/generate`、后端 TypeScript、`npm run test:operation-recovery` 通过；运行态 Operation `b5656d4f-d29b-4730-843a-9b5d09b1e12c` 完成，`position_advice.refresh success=1 / failed=0`，`leaseOwner=null / leaseExpiresAt=null / heartbeatAt` 保留最后心跳；SQLite 完整性检查 ok。
- P5 到期事实集刷新调度第一段完成：新增 `scheduleDueFactsetRefresh` 和 `/api/v1/operations/refresh-due-factsets`，扫描缺失、stale、failed、partial、`nextRefreshAfter` 到期或持仓更新时间晚于缓存生成时间的事实集；支持预览、强制提交、刷新范围、提前窗口和 limit；任务中心新增“刷新到期事实集”按钮。
- 验证：后端/前端 TypeScript 通过；新增 `npm run test:due-factset-refresh`，过期缓存触发 scheduler Operation `dd94ce24-ba34-4f00-be08-55308db95a9a` 并完成；运行态 HTTP `submit=false` 预览返回 `009725 / refresh_due` 且不提交任务；SQLite 完整性检查 ok。
- P5 到期事实集 cron 调度器第一段完成：新增 `factsetRefreshScheduler`，后端启动后按 `FAMS_FACTSET_SCHEDULER_CRON` 定期扫描到期事实集，默认每 15 分钟、北京时间、提前 60 分钟、单批 20，并避开 A 股交易时段；调度器只提交 `createdBy=scheduler` 的 `batch_factset_refresh` Operation，不直接刷新数据。
- 验证：后端 TypeScript 和 `npm run test:factset-refresh-scheduler` 通过，交易时段返回 `trading_window` 跳过，盘后提交 Operation `3bccf010-841c-47d1-ba70-6ebcb4bd7b90` 并完成；后端重启后日志显示 `Factset refresh scheduler started`。
- P5 调度租约第一段完成：新增 `SchedulerLease` 表记录 `leaseOwner / leaseExpiresAt / heartbeatAt / lastRunAt / lastResultJson`；`factsetRefreshScheduler` 每次 tick 前抢占 `factset_refresh` 租约，抢不到返回 `scheduler_lease_not_acquired` 并跳过，tick 完成后释放租约并记录最后运行结果。
- 验证：Prisma `db push/generate`、后端 TypeScript、`npm run test:factset-refresh-scheduler` 通过；测试覆盖有效调度租约阻止 tick，释放后盘后提交 Operation `c323ce70-d0fa-4db1-8edd-0a9ad3bd224c` 并完成；后端重启后 scheduler 正常启动。
- P5 调度状态可视化第一段完成：新增 `GET /api/v1/operations/schedulers/factset-refresh` 返回调度配置、进程运行状态、`SchedulerLease` 租约、上次运行时间和上次结果；任务中心新增“事实集后台调度”状态卡。
- 验证：后端/前端 TypeScript 通过；HTTP 返回 `enabled=true / taskStarted=true / lease.locked=false / lastResult.operationId=c323ce70-d0fa-4db1-8edd-0a9ad3bd224c`；SQLite 完整性检查 ok。前端截图验证因本机 Playwright 缺少 `libnspr4.so` 阻断，待补环境后复验。

## 2026-05-21 全量检视并行修复记录

- 并行检视方向：架构设计、代码实现、需求偏移。第一批优先处理会造成错误结论、任务错写、缓存污染或前端状态误判的问题。
- Operation 可靠性：`Operation` 增加 `leaseToken` fencing；进度、任务、完成、失败、取消均校验 `leaseOwner + leaseToken`；有效租约取消进入 `cancelling`，由 owner 收口；`idempotencyKey` 冲突返回已有任务。
- LLM 边界：股票 AI 分析只输出事实观察、证据引用、数据缺口和风险提示；前端股票详情旧“投资建议”改为“技术事实观察”，不再展示买入/卖出、目标价、止损、止盈或仓位。
- 股票事实集缓存：`StockFactSetCache` 唯一键加入 `lookbackDays / timeframe`；到期调度扫描全部开放持仓，`position_advice / stock_factset` 分开提交，避免窗口污染和 mixed scope 被 limit 截断。
- 契约同步：MCP Operation schema 补齐 `succeeded / partial / cancelling`；资产页、持仓页轮询把 `succeeded / partial` 当终态，`partial` 显示为部分成功。
- 验证脚本保护：会改写 dev 数据库的验证脚本要求 `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1`，防止无意识污染开发账本。
- 验证：Prisma `validate/generate` 通过；后端/前端 TypeScript 通过；`verify-operation-recovery`、`verify-due-factset-refresh`、`verify-stock-factset-cache`、`verify-factset-refresh-scheduler` 均通过。Playwright 前端截图仍受 WSL 缺少 `libnspr4.so` 阻断。

## 2026-05-21 用户边界与开放持仓唯一性记录

- `ensureUser` 已收紧：默认只允许自动创建 `default` 本地用户；非 default 用户必须已存在，或设置 `FAMS_ALLOW_DYNAMIC_LOCAL_USERS=1`。`AnalysisService` 自建用户逻辑已移除，统一复用 `ensureUser`。
- `Position` 新增 `openKey` 唯一键，开放持仓写入 `userId:assetId`，平仓后置空；同一用户同一资产最多一个开放持仓。
- 交易买入创建持仓时写入 `openKey`；如果并发或重复提交触发唯一冲突，会重新读取开放持仓并合并数量、成本和市值。现金持仓同样受保护。
- 错误处理补充 Prisma `P2002` 映射为 `409 CONFLICT`，`P2025` 映射为 `404 NOT_FOUND`。
- 新增 `backend/scripts/verify-open-position-uniqueness.ts` 和 `npm run test:open-position-uniqueness`。该脚本会回填现有开放持仓 `openKey`、扫描重复 open position、验证交易合并和非 default 动态用户阻断。
- 验证：Prisma `db push --accept-data-loss / generate` 通过；`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 node node_modules/tsx/dist/cli.mjs scripts/verify-open-position-uniqueness.ts` 返回 `openCount=22 / missingOpenKey=0`；后端/前端 TypeScript、SQLite integrity、交易成本模型和持仓聚合一致性均通过。

## 2026-05-21 P4.1 策略锦标赛可信回测记录

- AI 选股内置三策略暂不新增，先把 `strategyTournament` 从短窗胜率升级为可信回测第一段：T 日收盘信号、T+1 开盘入场、持有 N 日后按收盘退出。
- 回测样本扣除佣金、最低佣金、印花税和滑点，并输出 `grossReturnPercent / returnPercent / costPercent`。
- 市场约束加入 ST/退市风险排除、上市天数不足、停牌或成交量为 0、成交额不足、T+1 涨停不可买、退出日跌停不可卖；阻断样本进入 `blockedSamples`，不计入可执行交易。
- 策略排行新增 `sampleSize / tradeCount / medianReturnPercent / profitFactor / maxDrawdownPercent / sharpe / sortino / calmar / turnoverPercent / tailLossP95Percent / tailLossP99Percent`，并保留低可信不得进入加仓建议的边界。
- Operation 产物新增 `sample_trades.csv`、`equity_curve.json`、`drawdown_curve.json`、`backtest_assumptions.json`，原有 leaderboard、candidate list、strategy metrics、data quality、provider health 保留。
- 前端 AI 选股策略排行展示交易数、中位收益、最大回撤、Sharpe、盈亏比、尾部亏损和市场约束阻断数量，低可信或证据不足时提示“仅进入观察池，不进入加仓建议”。
- 新增 `backend/scripts/verify-strategy-tournament-backtest.ts`，并注册 `npm run test:strategy-tournament-backtest`、`npm run test:backtest-market-constraints`、`npm run test:backtest-cost-model`。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:screener-service` 通过；`npm run test:strategy-tournament-backtest` 通过，覆盖 T+1 日期、成本扣减、ST 排除、成交额不足、T+1 涨停不可买和单样本可信度 `insufficient`。

## 2026-05-21 P4.2 策略锦标赛版本化审计记录

- 每个 `strategyTournament.ranked` 项新增 `versionBundle`，绑定信号策略、入场策略、退出策略、仓位规模策略、组合策略、成本模型、市场约束和引擎版本。
- 每个策略排名项新增稳定 `auditHash`，用于证明同一批次结论对应的策略版本、执行假设、样本和阻断原因没有被混淆。
- `Strategy.parameters`、`BacktestResult.reviewReportJson`、`leaderboard.json`、`backtest_assumptions.json` 均写入版本束和审计哈希。
- Operation 产物新增 `strategy_manifest.json`，批次级列出每个策略候选的版本束、审计哈希、关键指标和可信度。
- 前端 AI 选股策略卡展示策略版本、执行版本和审计哈希前缀，便于用户把页面结果与回测产物对应起来。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 通过，验证版本束 schema、执行版本、成本模型版本和 sha256 审计哈希；`npm run test:screener-service` 通过，验证持久化报告包含 `versionBundle` 和 `auditHash`。

## 2026-05-21 P4.3 样本外验证记录

- 每个 `strategyTournament.ranked` 项新增 `outOfSampleValidation`。
- 第一段采用 `chronological_70_30_split`：按信号日期排序，前 70% 可执行样本作为训练窗口，后 30% 作为样本外窗口。
- 训练窗口和样本外窗口分别输出样本数、胜率、平均收益、基准收益和超额收益。
- 样本总数小于 30 或样本外窗口小于 10 时标记 `insufficient` 并写入 warnings，避免短窗样本被误读为稳定策略。
- 持久化回测报告、`leaderboard.json`、`strategy_manifest.json` 写入样本外验证结果，Operation 产物新增 `out_of_sample_validation.json`。
- 前端 AI 选股策略卡展示样本外状态、样本外交易数、样本外超额收益和 warnings。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 通过，覆盖单样本不足和 5 样本 70/30 切分；`npm run test:screener-service` 通过，验证持久化报告包含 `outOfSampleValidation`。

## 2026-05-21 P4.4 walk-forward 稳定性审计记录

- 每个 `strategyTournament.ranked` 项新增 `walkForwardValidation`。
- 第一段采用 `chronological_3_window_split`：按信号日期切成 3 个连续窗口。
- 每个窗口输出样本数、胜率、平均收益、基准收益、超额收益和窗口状态，并汇总 `passedWindows / totalWindows`。
- 样本总数小于 30、可用窗口少于 2 或通过窗口不足时写入 warnings，继续保持 `insufficient`，不提升策略可信度。
- 持久化回测报告、`leaderboard.json`、`strategy_manifest.json` 写入滚动窗口验证结果，Operation 产物新增 `walk_forward_validation.json`。
- 前端 AI 选股策略卡展示滚动窗口状态、通过窗口数、最近窗口超额收益和 warnings。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 通过，覆盖单样本不足、3 窗口结构和 5 样本切分；`npm run test:screener-service` 通过，验证持久化报告包含 `walkForwardValidation`。

## 2026-05-21 P4.5 参数敏感性审计记录

- 每个 `strategyTournament.ranked` 项新增 `parameterSensitivity`。
- 第一段采用 `local_threshold_grid_v1`，不新增策略，只对现有策略关键阈值做小范围扰动。
- A杀/平台突破策略扰动成交量阈值和横盘振幅阈值；均线收复策略扰动修复量比和回撤阈值。
- 每个参数变体在同一批 K 线、同一 T+1 执行、同一成本模型、同一市场约束下重新回测，输出样本数、可执行交易数、胜率、平均收益、超额收益、最大回撤和状态。
- 持久化回测报告、`leaderboard.json`、`strategy_manifest.json` 写入参数敏感性结果，Operation 产物新增 `parameter_sensitivity.json`。
- 前端 AI 选股策略卡展示参数稳健/敏感/样本不足、稳定变体数和 base 超额收益。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 通过，覆盖参数敏感性 schema、5 个变体和 base 变体；`npm run test:screener-service` 通过，验证持久化报告包含 `parameterSensitivity`。

## 2026-05-22 P4.6 回测曲线前端可视化记录

- `strategyTournament.ranked` 返回 `equityCurve`，每个点包含 `index / value / drawdownPercent`。
- 持久化回测报告和 `leaderboard.json` 写入权益/回撤曲线。
- 前端 AI 选股策略卡新增轻量 SVG 迷你图，绿色展示权益曲线，红色展示回撤曲线。
- 参数敏感性块补充前三个参数变体的成交数和超额收益。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 通过，验证 `equityCurve` 与 `drawdownPercent`；`npm run test:screener-service` 通过，三策略回归和持久化仍正常。

## 2026-05-22 P4.7 策略锦标赛 artifact 深链路可视化记录

- 任务中心 `operation_artifact` 弹窗按产物文件名渲染可读预览。
- `leaderboard.json` 和 `strategy_metrics.json` 展示策略排行、可信度、成交数、胜率、超额收益、最大回撤和权益/回撤曲线。
- `equity_curve.json`、`drawdown_curve.json`、`out_of_sample_validation.json`、`walk_forward_validation.json`、`parameter_sensitivity.json`、`strategy_manifest.json` 和 `sample_trades.csv` 分别展示曲线、验证状态、参数变体、版本束和样本交易预览。
- 验证：后端/前端 TypeScript 检查通过；本节点不改变后端回测计算口径，只增强任务中心 artifact 验收视图。

## 2026-05-22 target gap 图可读性重排记录

- `docs/target-architecture-gap.drawio` 从长流水记录改为两页摘要图。
- 第一页只展示目标架构层次：用户界面、API 与领域服务、事实与决策、异步任务与产物、数据与 Provider、Connect 与 Agent 边界、可靠性硬规则。
- 第二页只展示 P0-P6 阶段、当前 P4 状态、核心 Gap、验收规则和 P4 artifact 产物链路。
- 详细历史继续保留在 Markdown 文档，不再塞进 drawio 框内，避免文字堆叠。
- 验证：`node read-drawio.mjs target-architecture-gap.drawio` 解析通过，图节点从原来的长文本堆叠改为短摘要卡片。

## 2026-05-22 P4.8 样本交易结构化验收记录

- 任务中心 `sample_trades.csv` artifact 从纯文本预览升级为结构化表格。
- 表格展示策略、标的、信号日、入场日、退出日、入场价、退出价、毛收益、净收益、成本、盈利状态和阻断原因。
- 顶部汇总记录数、可执行样本、阻断样本和盈利样本；原始 CSV 仍保留在表格下方用于审计。
- 验证：后端/前端 TypeScript 检查通过；本节点不改变后端回测计算口径和 CSV artifact 格式。

## 2026-05-22 P4.9 参数敏感性二维热力图记录

- 任务中心 `parameter_sensitivity.json` artifact 新增参数热力图。
- 前端自动从各变体 `thresholds` 中识别相对 base 发生变化的参数，选择前两个变化参数作为 X/Y 轴。
- 每个格子展示超额收益、成交数和变体 ID，颜色按超额收益分层；只有一个参数变化时降级为单轴热力条。
- 验证：后端/前端 TypeScript 检查通过；本节点不改变后端回测计算口径和 artifact 格式。

## 2026-05-22 P4.10 artifact 交叉跳转记录

- 任务中心 artifact 弹窗新增“同批次产物导航”。
- 前端从当前 `operation_artifact:<operationId>:<filename>` 解析 operationId，生成同批次核心产物快捷入口。
- 支持在策略排行、锦标赛总览、样本交易、权益曲线、回撤曲线、样本外、walk-forward、参数敏感性和版本清单之间直接跳转。
- 深链打开单个产物时也能使用同批次导航，当前产物会高亮。
- 验证：后端/前端 TypeScript 检查通过；本节点不改变后端回测计算口径和 artifact 格式。

## 2026-05-22 P4.11 正式策略版本表记录

- 新增 `StrategyVersion` 表，保存策略信号、入场、退出、仓位、组合、成本、市场约束和引擎版本束。
- `strategyId + auditHash` 作为唯一约束，避免同一策略版本重复落库。
- 策略锦标赛持久化时创建或复用 `StrategyVersion`，排名项返回 `persistedStrategyVersionId`。
- `BacktestResult.reviewReportJson`、`leaderboard.json`、`strategy_manifest.json` 和 `Strategy.parameters` 写入版本 ID 或 latest 版本引用。
- 验证：Prisma `db push/generate` 完成；后端/前端 TypeScript 检查通过；`npm run test:screener-service` 验证版本表落库；`npm run test:strategy-tournament-backtest` 通过。

## 2026-05-22 P4.12 更大参数网格记录

- 参数敏感性从 `local_threshold_grid_v1` 升级为 `local_threshold_grid_v2`。
- A杀/平台突破按 `lastTwoVolumeRatio × sidewaysRangePercent` 生成 3×3 网格。
- 均线收复按 `reclaimVolumeRatio × drawdownPercent` 生成 3×3 网格。
- 每个策略默认输出 9 个参数组合，base 变体固定作为对照，并按阈值去重。
- 不新增策略类型，继续复用同一批 K 线、T+1 执行、成本模型和市场约束。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 9 个组合变体和二维组合 id；`npm run test:screener-service` 通过。

## 2026-05-24 P4.13 策略 × 执行策略组合矩阵记录

- `strategyTournament` 新增 `executionMatrix`，三类内置信号策略 × 3 个退出持有周期默认形成 9 个 `TournamentCandidate`。
- 第一段只比较 `基准持有N日 / 短持有N-1日 / 长持有N+2日`，保持 T+1 入场、成本模型和市场约束不变。
- 每个排名项新增 `candidateId` 和 `executionPolicy`，避免同一 `strategyId` 的不同执行策略在 artifact 中互相覆盖。
- 持久化回测报告、`leaderboard.json`、`strategy_manifest.json`、`backtest_assumptions.json` 和 `StrategyVersion` 均写入候选组合信息。
- Operation 产物新增 `execution_matrix.json`，任务中心 artifact 导航和预览新增“执行矩阵”。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 和 `npm run test:screener-service` 通过。

## 2026-05-24 P4.14 止损止盈退出策略矩阵记录

- `executionMatrix` 从 3 个固定持有退出策略扩展为 6 个执行策略，三类信号策略默认形成 18 个候选组合。
- 每个持有周期同时生成固定持有版本和 `止损5% / 止盈10%` 版本。
- 回测样本在入场后逐日扫描高低价，触发止盈或止损时提前退出，并写入 `exitReason`。
- `versionBundle.exitPolicy` 区分 `exit.hold_n.close.v1` 和 `exit.stop_take_profit.v1`。
- `sample_trades.csv` 新增退出原因，任务中心样本交易表展示执行策略与退出原因。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证止盈提前退出；`npm run test:screener-service` 通过。

## 2026-05-24 P4.15 入场策略矩阵记录

- 开始前复验 P4.14：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过，未发现阻塞或重要问题。
- 独立评审结论：本阶段只补 `T+1开盘买入 / T+1收盘买入` 两个确定入场口径，不引入突破价和回踩价。
- `executionMatrix` 扩展为三类信号策略 × 2 个入场策略 × 6 个退出策略，默认 36 个候选组合。
- `versionBundle.entryPolicy` 区分 `entry.t1_open.v1` 和 `entry.t1_close.v1`，`candidateId` 带入场策略维度。
- `sample_trades.csv` 新增 `entryReason`，任务中心策略卡、执行矩阵和样本交易表展示入场策略。
- 止损止盈阈值改为按实际入场价计算，T+1 收盘入场不会复用开盘价阈值。
- 验证：后端/前端 TypeScript 检查通过；前端 Vite 构建通过；`npm run test:strategy-tournament-backtest` 验证 36 个候选组合、不同入场价和 `entryReason`；`npm run test:screener-service` 通过。

## 2026-05-24 P4.16-P4.18 移动止盈、仓位策略矩阵和执行矩阵收口记录

- 开始前复验 P4.15：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过，未发现阻塞或重要问题。
- P4.16 新增固定 `8%` 移动止盈退出策略，按入场后 high-water mark 计算回撤触发价，样本写入 `exitReason=触发移动止盈8%`。
- P4.17 新增 `volatility_scaled_notional` 仓位策略，按近 20 日波动率把本金限制在 `0.5x - 1.0x`，只降仓不放大。
- P4.18 完成执行矩阵第一段收口：入场、退出、仓位三个维度统一进入 `executionMatrix`、`versionBundle`、`leaderboard`、`strategy_manifest` 和 `sample_trades.csv`。
- 执行矩阵默认 108 个候选组合：三类信号策略 × 2 个入场策略 × 3 个持有周期 × 3 个退出策略 × 2 个仓位策略。
- 任务中心策略卡、执行矩阵和样本交易表展示入场、退出、仓位策略；样本交易新增 `positionSizingReason / notional / positionSizeMultiplier`。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 108 个候选组合、移动止盈提前退出和波动率缩放本金；`npm run test:screener-service` 通过。

## 2026-05-24 P4.19-P4.21 分组稳定性和 P4 剩余计划评审记录

- 开始前复验 P4.18：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。
- 统一评审 P4 剩余计划：后续不新增选股策略，优先收口真实长窗口样本、分组稳定性、PostgreSQL/worker 性能、正式行业/市值数据源和持仓建议证据联动。
- 每笔回测样本新增 `marketSegment / industryGroup / marketCapGroup / marketRegime`，用于判断策略是否只在单一市场状态、板块、行业或流动性分组有效。
- 每个 `TournamentCandidate` 新增 `groupStabilityValidation`，按市场状态、市场板块、行业分组、市值/流动性代理四个维度输出分组样本、胜率、平均收益、超额收益、最大回撤、状态和 warnings。
- Operation 产物新增 `group_stability_report.json`，任务中心同批次 artifact 导航新增“分组稳定性”，弹窗提供四维分组可视化预览。
- `sample_trades.csv` 新增分组字段，`leaderboard / strategy_metrics / strategy_manifest / reviewReportJson / auditHash` 均写入分组稳定性结果。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证分组稳定性 schema、四类维度和样本上下文字段；`npm run test:screener-service` 验证分组稳定性进入持久化回测报告。

## 2026-05-25 P4.22 分组元数据血缘记录

- 开始前复验 P4.21：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest` 和 `target-architecture-gap.drawio` 读取均通过。
- 独立评审结论：本节点不直接新增外部行业/市值 provider，先把当前启发式分组显式标注来源、方法、置信度和 warnings。
- 每笔回测样本新增 `groupMetadata`，schema 为 `fams.screener.group_metadata.v1`，覆盖市场板块、行业分组、市值/流动性代理和市场状态。
- `groupStabilityValidation` 的维度新增 `providerSummary / averageConfidence`，分组桶新增 `provider / method / confidence / warnings`。
- `sample_trades.csv` 新增分组 provider 和 `groupConfidence`，任务中心分组稳定性预览展示 provider 汇总、分组 provider 和置信度。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证样本 `groupMetadata`、维度 providerSummary、分组桶 provider/confidence；`npm run test:screener-service` 通过。

## 2026-05-25 P4.23 正式行业/市值缓存接入记录

- 开始前复验 P4.22：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。
- 独立评审结论：不在策略锦标赛回测主路径实时请求外部 provider，先使用已落库的 `StockFactSetCache` 东方财富事实，保证回测可复现和可降级。
- 全 A universe 增加股票事实集缓存补全：读取 `em_industry_board / em_total_market_cap / em_float_market_cap`，写入 `officialIndustryGroup / officialIndustryCode / totalMarketCap / floatMarketCap / metadataAsOf / metadataWarnings`。
- `groupMetadata` 的行业和市值分组优先使用 `eastmoney_fundamental_cache`，并写入 `asOf / sourceRefs`；缓存缺失时仍降级到资产元数据、名称关键词、成交额代理或占位规则，并保留 warning。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证东方财富缓存优先级、市值分组和 `sourceRefs`；`npm run test:screener-service` 通过。

## 2026-05-25 P4.24 批量事实集预热覆盖率记录

- 开始前复验 P4.23：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。
- 独立评审结论：先做覆盖率审计，不在回测主路径发起大规模外部 provider 预热。
- 全市场扫描新增 `factset.preheat_coverage` 任务，统计扫描样本和全 universe 的正式行业覆盖率、正式市值覆盖率、完整覆盖率、缺失行业/市值样本预览和 provider 分布。
- Operation 产物新增 `factset_preheat_coverage.json`，`data_quality_report.json` 同步嵌入该报告；任务中心 artifact 导航新增“事实集覆盖”预览。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:screener-service` 验证覆盖率 schema、完整覆盖率、缺失样本预览和 warning；`npm run test:strategy-tournament-backtest` 通过。

## 2026-05-25 P4.25 按缺口触发可取消事实集预热记录

- 开始前复验 P4.24：后端/前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。
- 独立评审结论：预热必须有上限、可取消、可审计，不能在全 A 扫描中无约束调用外部 provider。
- 全市场扫描先生成初始覆盖率；若扫描样本完整覆盖率低于阈值，进入 `factset.preheat_missing`，只对缺少行业或市值事实的扫描样本按上限刷新股票事实集。
- 默认预热上限 20、覆盖率阈值 80%；支持 `factsetPreheatLimit / 事实集预热上限 / 预热上限`、`factsetCoverageThreshold / 事实集覆盖阈值 / 覆盖率阈值`，也支持 `跳过事实集预热=1`。
- 预热后重新读取 `StockFactSetCache`，`factset_preheat_coverage.json` 记录 initial、preheat 和最终覆盖率。
- 验证：后端/前端 TypeScript 检查通过；`npm run test:screener-service` 验证 preheat 统计；`npm run test:strategy-tournament-backtest` 通过。

## 2026-05-28 P4.33.2 K线预热 Worker 验收同步

- 新增 `market_bar_cache_preheat` Operation 后，继续补齐可重复 worker 验收脚本：`npm run test:market-bar-cache-preheat-worker`。
- 验收覆盖 queued worker 领取、chunk `OperationTask`、`market_bar_cache_preheat_report.json` artifact、queued 取消和过期 lease 恢复。
- 修复验收发现的 result schema 缺失问题，`market_bar_cache_preheat` 现在写入 `schemaVersion=fams.market_bar.cache_preheat_result.v1`。
- 验收 Operation `4bc2e7bf-8e04-43bc-8da7-be2f23eb9023` completed，`requestedSymbols=4`、`attemptedSymbols=1`、`successCount=1`、`failureCount=0`、`fetchedBars=120`。
- 取消验收 Operation `209688b0-ece9-414a-9a31-6e3175ce9180` cancelled，`cancelRequested=true`。
- 恢复验收 Operation `69bf14eb-8bd3-4712-bfb2-24144ed1a2fc` completed，`recovery.reason=expired_lease_worker_recovery`。
- 后端/前端 TypeScript 检查通过；当前剩余阻断为 2000 样本 queued 预热压力验收和 SQLite provider health 写入 timeout 优化。

## 2026-05-28 P4.33.3 K线预热 queued 压力验收同步

- `MarketBarCacheService` 将 provider health 与 raw/canonical upsert 统一串行化，降低 SQLite 并发写 timeout 风险。
- 新增 `run:market-bar-cache-preheat-pressure`，用于创建 queued K 线预热 Operation、worker 执行，并校验 chunk、artifact、provider health、timeout 和 database locked。
- 修复压力验收发现的假成功：刷新后仍 stale 或仍缺 K 线时，写入 `coverageWarnings / coverageWarningCount`，Operation 标为 `partial`。
- 80 样本强制刷新 Operation `36ef53b1-ce33-4106-85a3-07efc29a8a76`：`requested=80`、`success=80`、`fetchedBars=9600`、`reportBytes=17600`、无 timeout/database locked。
- 4 样本校验 Operation `a06153c5-0f7a-4d80-b861-cf8b09616750`：正确返回 `partial`、`coverageWarningCount=1`。
- 40 样本压力 Operation `fbf8883f-1bfe-4c71-862b-da5bf0dfc6dc`：`status=partial`、`requested=40`、`success=40`、`fetchedBars=4800`、`coverageWarningCount=1`、`reportBytes=9448`、`sina healthy/closed`、无 timeout/database locked。
- 当前判断：SQLite 下稳定性改善，但性能不适合直接冲 2000 样本；下一步做 200/300 样本压力或先评审批量 upsert / PostgreSQL 迁移。

## 2026-05-28 P4.33.4 K线批量写入优化同步

- `MarketBarCacheService.upsertBars` 从逐条 raw/canonical upsert 改为单标的批量事务：tradeDate 去重、删除旧 raw/canonical、`createMany` raw、回查 raw id/hash、`createMany` canonical。
- 单只股票 120 日 K 线从约 240 次写操作降为 5 个批量操作；`sourceRefsJson` 保留 `rawId/symbol/tradeDate/provider/hash`。
- 4 样本 Operation `d36fad70-b439-440e-9ecd-4a1041c0dab6`：elapsedMs `6756`，上一轮约 `18032`。
- 40 样本 Operation `89868019-570d-4acd-bd2a-4fcfc32fa2d3`：elapsedMs `26681`，上一轮约 `87634`。
- 80 样本 Operation `8dc4706f-ebfb-4dfc-acf6-4d7c7536d2e0`：elapsedMs `49169`，上一轮约 `166912`。
- 三组均无 timeout/database locked，provider 为 `sina healthy/closed`。
- 下一步重点：实现只补缺失交易日，减少 force refresh 全量重拉。

## 2026-05-28 P4.34.1 选股扫描只读缓存边界同步

- 已整合 GPT 架构评审：后续目标不是继续把“边拉行情边扫描”做快，而是把行情同步独立成基础设施，AI 选股扫描只读本地 canonical / feature cache。
- `ScreenerOptions` 新增 `marketDataMode=cache_only|live_fetch`，默认 `cache_only`。
- 只有查询包含 `允许实时行情=1`、`allowLiveMarketFetch=1` 或环境变量 `FAMS_SCREENER_MARKET_DATA_MODE=live_fetch` 时，扫描中才允许实时拉 provider。
- `marketBarCacheService` 新增 `getCachedHistory`，只读 `market_bar_canonical`，不写 raw/canonical/provider health。
- `dataQuality / observability / chunkSummary` 写入 `marketDataMode`，便于审计。
- 验收 Operation `4d4ecc94-dfba-4da7-9083-1fc224815d41` completed，provider=`cache`、cacheHitRate=`100`、historySources=`cache:sina`、market data chunk duration=`17ms`。
- 当前未闭环：缓存不足时还未自动创建 warmup Operation；下一步补 `market_data_coverage` 与 `NEEDS_MARKET_DATA_WARMUP` blocker。

## 2026-05-28 P4.34.2-P4.34.3 coverage 与 warmup blocker 同步

- 新增 `MarketDataCoverage` 表，记录 canonical K 线覆盖状态、latest/complete_to、missing count/ranges、status 和 stale reason。
- `marketBarCacheService.getCoverageReport` 同步 upsert coverage。
- `stock_screener_full_scan` 新增 `market_data.coverage` task 和 `coverage_report.json` artifact。
- cache-only 模式下 coverage 不 sufficient 的标的不进入策略计算，failure code 为 `NEEDS_MARKET_DATA_WARMUP`。
- 父选股 Operation 会自动创建 queued `market_bar_cache_preheat` 子 Operation，并在 result.nextAction 写入 `warmupOperationId`。
- 常规验收 Operation `81e2e61d-d95f-4313-bf2a-71187b490434` completed，`marketDataWarmupRequired=false`，coverage 表中 `000001 / 000002` 均为 sufficient。
- blocker 验收 Operation `fff93efd-524b-4d65-9ac7-1678cfc2f161` partial，`000004` 返回 `NEEDS_MARKET_DATA_WARMUP`，子 warmup Operation `7bec65cc-ad5b-4619-9d26-906912db07eb` 已创建。
- 下一步：扫描前 coverage 判断改为优先 bulk 读 `market_data_coverage`，避免全 A 时逐标的扫 canonical 明细。

## 2026-05-29 P4.34.4-P4.34.5 coverage bulk 与 provider health 聚合同步

- `marketBarCacheService.getCoverageReport` 已改成优先 bulk 读 `market_data_coverage`，只对缺失摘要或 requested days 不足的标的回查 canonical 聚合。
- coverage 写回从逐行 upsert 改为分块 `deleteMany + createMany`。
- provider health 改为内存窗口聚合，`getHistory` 不再每只股票立即写健康表；K 线预热 chunk 完成后 flush。
- 验收：后端/前端 TypeScript 检查通过；coverage 4 标的直连验证 `79ms`，sufficient=`2`、insufficient=`2`、stale=`2`。
- 常规 worker Operation `2b63b43e-4f50-4386-bf01-3dcd01d63186` completed；恢复 Operation `fde6f401-afb2-4cfb-a644-c43a110819cf` completed。
- blocker Operation `074280dd-87cf-44b6-b30f-da78ac8d057c` partial，自动创建子 warmup `6dd2761a-54a8-4951-b5ab-ef8414292c23`，验收后已取消。
- K 线预热 worker Operation `31c68662-ca7f-4c70-b6fd-61d5552275b0` partial，chunk completed，recovery Operation `8ec89f3f-ad24-46b7-8210-1572438e32d9` completed。
- 下一步：新增 `market_feature_daily`，把 MA/RSI/ATR/量比/相对强弱等技术特征作为行情同步产物预计算。

## 2026-05-29 P4.34.6 market_feature_daily 同步

- 新增 `MarketFeatureDaily` Prisma 模型，保存 return、MA、斜率、量比、ATR、RSI、波动率、最大回撤、相对强弱、流动性/趋势/动量评分。
- 新增 `marketFeatureDailyService`，从 `market_bar_canonical` 生成日级特征，并支持读取最新特征。
- `market_bar_cache_preheat` afterCoverage 后新增 `market_feature.compute` task，预热 artifact 写入 `featureReport`。
- `stock_screener_full_scan` 新增 `market_feature.coverage` task 和 `market_feature_coverage.json` artifact，`dataQuality.marketFeatureCoverage` 同步展示覆盖率。
- 更新 `verify-market-bar-cache-preheat-worker`，验收新 feature task。
- 验收：Prisma `db push`、后端/前端 TypeScript 检查通过；K 线预热 Operation `50d663c5-126e-4f94-bb15-1e6ef7ba0d43` 生成 computedSymbols=`3`、featureRows=`324`；全市场扫描 Operation `f956fbe7-1c3a-4aad-a0bd-28e5cc87128a` completed，`market_feature.coverage` completed，feature coverage=`100%`。
- 下一步：把当前候选筛选迁移为 feature-first，避免用户筛选请求重复计算最新横截面指标。

## 2026-05-29 P4.34.7 feature-first 当前筛选同步

- `MarketFeatureDaily` 补充 `rollingHigh20 / rollingLow20 / rollingHigh60 / rollingLow60`。
- `marketFeatureDailyService` 已计算 rolling high/low，并用于平台振幅、支撑、压力和回撤判断。
- 当前候选筛选优先使用 `evaluateByFeatureStrategy` 读取最新 `market_feature_daily`。
- 缺少 feature 的标的才 fallback 到历史 K 线评分。
- `strategy.evaluate` metrics 写入 `featureFirst=true`、`featureFirstEvaluatedCount`、`historyFallbackEvaluatedCount`。
- `dataQuality.featureFirstScreening` 写入当前筛选与回测边界说明。
- `verify-operation-worker-readiness` 增加 feature-first 断言，要求候选来自 `feature:market_feature_daily`。
- 验收：Prisma `db push`、后端/前端 TypeScript 检查通过；特征重算 `000001/000002/000004` 生成 featureRows=`377`；Operation `5185878a-45eb-4f3f-ab9f-f30407112349` featureFirstEvaluatedCount=`2`、fallback=`0`，候选 20 日振幅正常；增强后的 worker 验收 Operation `667e4cf4-d6fd-46d0-abc0-84fa59b71b38` 通过。
- 下一步：拆分当前筛选与回测 evidence 引用，减少用户筛选请求中的即时回测成本。

## 2026-05-30 P4.34.8 全 A 完整扫描验收同步

- 全 A universe 强制刷新验证通过：`sina_hs_a_all_a_share`，`5524` 只。
- 全 A K 线预热 Operation `73057da6-b372-4fd0-b11c-70e8078e493d` 完成：
  - attempted=`2578`
  - success=`2517`
  - warning=`61`
  - failure=`0`
  - fetchedBars=`304316`
- 发现并修复 afterCoverage 摘要旧口径：`getCoverageReport` 新增 `forceRebuild`，预热后强制从 canonical 重建 coverage。
- coverage 重建结果：
  - sufficient=`5447`
  - insufficient=`77`
  - stale=`16`
  - estimatedCacheHitRate=`99.22%`
- 发现并修复 `getLatestFeatures` 大结果集问题：不再一次性读取约 55 万行 feature，而是分批 groupBy 最新 tradeDate 后读取最新特征。
- feature 补算完成：
  - requested=`5447`
  - computed=`5447`
  - failed=`0`
  - featureRows=`551019`
- 完整全 A 扫描 Operation `5757bc50-59ea-4826-a83b-886ca9118acf` 完成：
  - status=`partial`
  - universeSize=`5524`
  - evaluatedCount=`5447`
  - failureCount=`77`
  - providerSuccessRate=`98.61%`
  - cacheHitRate=`99.95%`
  - feature coverage=`100%`
  - featureFirstEvaluated=`5447`
  - fallback=`0`
  - artifactRefs=`19`
  - matchedCount=`3`
- 当前命中候选：
  - `002230 科大讯飞`
  - `600848 上海临港`
  - `600690 海尔智家`
- partial 原因：
  - `77` 只标的历史 K 线不足或过期。
  - 本次 `验证天数=5`，未满足 `>=60` 长窗高可信回测门槛。
  - factset coverage=`35.66%`，分组结论仍需降级。
- 下一步：做 60 日长窗 evidence 解耦和行业/市值事实集覆盖补齐。

## 下一步

执行 `docs/HIGH_RELIABILITY_CORRECTNESS_PLAN.md`。在该计划完成前，不启动新的开发主线，V3.0 harnessOS 多 Agent 编排暂缓。

2026-05-30 补充：完成 P4.34.9 策略证据异步化第一段。新增 `strategy_tournament_run` Operation 和 `POST /api/v1/operations/strategy-tournament-run`，将 60 日长窗策略 evidence 从用户当前筛选入口拆出为独立 queued 任务。worker、恢复、重试、高成本全 A 确认保护均已接入，结果写入 `operationKind=strategy_tournament_run`、`evidenceMode=async_strategy_evidence` 和 `evidenceRefs`。

验证：后端/前端 TypeScript 检查通过。Service 小样本 Operation `6a65f81e-8288-4676-b60c-79b20743b46c` 和 API 小样本 Operation `f04d3c65-1eb3-43b3-a96e-54499ad141e8` 均由 worker 执行到 `partial`，生成 `19` 个 artifact，`evidenceRefs.backtestDays=60`。首次验收发现 backtestDays 误取内部聚合窗口，已修复为以 long sample acceptance / input 为准。下一步：当前选股扫描引用最近有效 evidence，并继续补行业/市值事实集覆盖。

2026-05-30 补充：完成 P4.34.10 当前筛选引用异步 evidence。普通 AI 选股默认只做当前信号筛选，不再即时生成短窗 `strategyTournament`；结果新增 `asyncStrategyEvidence`，引用最近一次 `strategy_tournament_run` 的 Operation、batch、artifact、60 日窗口、验收状态、可信度和 blocker gate。前端新增“异步策略证据引用”区块。显式调试入口保留：查询中加入 `即时回测=1` 才运行旧内联回测。

验证：后端/前端 TypeScript 检查通过。默认普通选股 `扫描上限=5` 返回 `hasInlineTournament=false`、`asyncStrategyEvidence.status=referenced`、引用 Operation `f04d3c65-1eb3-43b3-a96e-54499ad141e8`、`backtestDays=60`、`artifactRefs=19`、`usableForTradingAdvice=false`。显式 `即时回测=1` 返回 `hasInlineTournament=true`，同时仍引用异步 evidence。下一步：执行受控全 A 60 日 evidence 或继续提高 factset coverage。

下一阶段优先级：

1. 将 AI 选股 universe 和资产导入链路接入 `Asset Identity Resolver`。
   - 2026-05-11 已完成：选股入口解析开放持仓资产后只保留 `stock/CN`；`excludedUniverse` 返回被排除 ETF/基金/债券/现金原因；导入新增 `resolveImportAssetIdentity`，创建/更新资产时写入 resolver 判定的 symbol、type、exchange、currency。
   - 验证：后端/前端 TypeScript 检查通过；`npm run test:import-resolver` 通过；重启 4000 后 `npm run test:screener-resolver` 通过，返回 `universeSource=asset_identity_resolver`、`universe=9`、`candidates=5`、`excluded=19`。历史 K 线 provider 仍有 502/空响应，后续纳入行情历史源治理。
   - 2026-05-11 继续完成历史行情可靠性补强：东方财富历史 K 线失败时走 Sina curl fallback；删除实时价伪造历史候选，历史不足只进入 failures；接口新增 `dataQuality`，候选新增 `historySource/historyDays`，前端展示 K 线质量。验证 `npm run test:screener-resolver` 从 `failures=9` 修复为 `failures=0`。
   - 2026-05-11 继续修复全市场覆盖：AI 选股默认通过 Sina `hs_a` 获取沪深北全 A 股样本，接口返回 `universeSource=sina_hs_a_all_a_share`、`universeTotal`、`scannedCount` 和覆盖率；前端显示“全A股样本池”和“已扫描/覆盖率”。验证 `npm run test:screener-resolver` 返回 `universe=5514`、`candidates=5`、`excluded=18`、`failures=0`，手工 `扫描上限=30` 验证全样本池不变。
   - 2026-05-11 修复黄金/现金手工总额资产：黄金编辑弹窗支持金价、成本、市值、收益率反推；现金保存为 `quantity=金额 / currentPrice=1 / marketValue=金额 / costBasis=金额`。刷新链路本地 `gold/cash` 类型优先，黄金不再被 `002611` 股票价污染。验证 `npm run test:manual-assets` 通过，现金 3 条、黄金 1 条口径正确。
   - 2026-05-11 新增 post-refresh validation：刷新写库前校验价格来源、异常跳变和持仓公式；黄金拒绝股票/基金行情源，现金只允许 manual，真实份额资产校验 `quantity × price`，手工总额资产保留用户市值。验证后端类型检查通过，`npm run test:manual-assets` 通过，手工刷新黄金和三条现金 `refreshed=4 / failed=0`。
   - 2026-05-11 补齐 validation 前端分类和基金手工校准保护：任务中心失败表展示“刷新校验阻断 / 阻断写库”；非场内基金/债基当前市值与 `quantity × price` 偏离超过 0.3% 时保留用户确认市值。验证 `npm run test:position-consistency` 与 `npm run test:manual-assets` 均通过。
   - 2026-05-11 收紧资产编辑口径：非现金资产允许录入份额/克重、当前总市值和收益率，净值/现价由系统查询且禁止人工修改；成本、每份/每克成本和盈亏自动计算展示。验证前端类型检查通过，3000 端口源码已更新。
   - 2026-05-11 确认前后端一致性：后端 `updatePosition` 保存时重新查询行情校验 `currentPrice`，防止客户端篡改净值/现价。验证 `019062` 净值 `1.053` 保存成功，错误净值 `9.99` 返回 HTTP 400。
   - 2026-05-11 修正基金/债基/黄金份额口径：份额/克重由总市值除以系统净值/金价反推，后端保存强制重算。009725 已修正为 `quantity=156516.1833668294`，前端将显示 `156516.1834`。
   - 2026-05-11 全量修复同类问题：扫描 14 个基金/债基/黄金持仓，修复 12 个历史 `quantity` 不一致项，保持总市值、成本、盈亏不变；新增并通过 `npm run test:derived-quantity`。
2. 补齐持仓成本/收益率反推编辑入口。
   - 2026-05-11 已完成：资产编辑弹窗支持输入当前市值和当前收益率，自动反推总成本和每份成本，覆盖股票、ETF、基金、债基。示例 `7571.34` 元、`-2.27%` 反推总成本 `7747.20` 元、浮亏 `-175.86` 元。
   - 验证：前端 TypeScript 检查通过；重启前端后确认 3000 端口实际提供的弹窗源码包含“当前收益率”和“按市值和收益率反推成本”；资产页新增显式“编辑”按钮，截图 `.verification/assets-edit-button-visible.png`。
2. 完善 AI 选股策略引擎和观测体系。

2026-05-30 补充：完成 P4.34.11-P4.34.12。修复 60 日长窗口径，`evaluateStrategyTournament` 不再最多只算 20 日；500 样本 60 日 evidence 在优化后 `backtest.aggregate=77637ms`，bestSampleSize=`281`、bestCredibility=`medium`。真实全 A 60 日 Operation `8c4f96d8-2352-4811-be5c-6de6a8ba3e07` 输入链路完成，5447 只 feature-ready，但 `backtest.aggregate` 触发 Node heap OOM，已收口 failed。下一步主线：backtest aggregate 分片/流式化。

2026-05-30 补充：完成 P4.34.13。全 A 60 日基础 evidence 已能完成，Operation `c3338ac1-0c8e-4e5d-8c38-bad4d257ccbb` scanned=`5524`、evaluated=`5447`、providerSuccessRate=`98.61%`、cacheHitRate=`99.95%`、signals=`243118`、rankedStrategies=`108`、bestSampleSize=`3766`、bestCredibility=`high`，但因 deep validation 未内联和 factset coverage=`35.66%`，status=`partial`，不可作为交易建议证据。同步修复 warmup result/artifact 过大和 feature 全量重算问题；复验 Operation `68630b63-1fc6-4ece-86be-a966e5104906` attempted=`77`、success=`16`、warnings=`61`、failures=`0`。下一步主线：top-N 深度验证子任务、provider warning 分类、factset coverage 补齐。

2026-05-30 补充：完成 P4.34.14。全 A top-3 深度验证补跑已接入，Operation `67d0ea3e-209f-4a2e-8fc5-d82cc0bc100d` scanned=`5524`、evaluated=`5447`、`backtest.aggregate=528100ms`。top-3 候选均补跑 out-of-sample、walk-forward、parameter sensitivity、group stability；其中 walk-forward、参数敏感性和分组稳定性均 passed，但 out-of-sample 均 failed，因此 `validation_evidence` 仍为 failed，系统继续阻断交易建议。下一步主线：诊断样本外失败原因，补 provider warning 分类和 factset coverage。

2026-05-30 补充：完成 P4.34.15。新增 `out_of_sample_diagnostics.json` artifact，并在 `data_quality_report.json` / Operation result 中写入 `outOfSampleDiagnostics`。受控 Operation `02a8d944-5795-4590-9acb-b53ef256f07b` 验证 artifactRefs=`20`、diagnosedCandidates=`3`、passedCount=`0`、failedCount=`3`。诊断结论：训练窗口正超额，样本外超额转负；walk-forward、参数敏感性、分组稳定性通过，优先怀疑时间切分窗口和近期市场状态变化。下一步主线：样本外窗口市场状态诊断，provider warning 分类。

2026-05-30 补充：完成 P4.34.16。新增 `out_of_sample_market_state.json` artifact，并在 `data_quality_report.json` / Operation result 中写入 `outOfSampleMarketStateDiagnostics`。受控 Operation `ddf2c8bd-6cf9-4327-aad8-665a0b2c8ab0` 验证 artifactRefs=`21`、diagnosedCandidates=`3`、`resultHasMarketDiag=true`、`dataQualityHasMarketDiag=true`。诊断结论：top-3 深验候选的训练窗口市场状态为 `弱势回撤`，样本外窗口切换为 `高波动震荡`；该结论用于解释样本外失败，系统继续阻断交易建议。下一步主线：provider warning 分类、coverage warning 去重、factset coverage 补齐。

2026-05-30 补充：完成 P4.34.17。完成 Provider / Coverage Warning 分类与去重：coverage item 新增 `warningCategory / warningSeverity / retryable / recommendedAction`，coverage report 新增 `retryableWarmupSymbols / nonRetryableWarningSymbols / warningSummary`。全 A coverage 验收 total=`5524`、sufficient=`5447`、insufficient=`77`，其中 `retryableWarmupCount=0`、`nonRetryableWarningCount=77`、`limited_listing_history=61`、`stale_after_preheat=16`。小样本 Operation `626ffe0b-dc47-49e1-9672-266c54d86b23` 验证 `nextAction=null`、无 warmup 子任务；预热 Operation `a9ccfe1a-e2e6-49ba-a66f-15b30d903628` 验证 attemptedSymbols=`0`、nonRetryableCoverageWarningCount=`1`。下一步主线：factset coverage 补齐。

2026-05-30 补充：完成 P4.34.18。接入 Factset Coverage 市值补齐子任务：扫描结果新增 `factsetNextAction=NEEDS_QUOTE_LIST_MARKET_CAP_WARMUP`，当行业覆盖达标但市值覆盖不足时，`OperationService` 自动创建 queued `quote_list_market_cap_warmup` 子任务。受控 40 标的 warmup `aaa81120-30f3-4876-ae8c-0a032850877c` 成功 `35/40`，canonical fullCoverageCount `1970 -> 2005`；500 样本扫描 `03205aaa-3afe-4dfa-9769-73058e83a783` factset coverage=`99.8%`；阈值 100% 验收自动创建并完成子任务 `f1a53cbe-1cba-48cb-8d9d-6573f15fe0f4`；500 标的批量 warmup `4b154e59-17ea-4460-b566-b3e0b56ce392` 成功 `500/500`，canonical fullCoverageCount `2010 -> 2510`，全 A screener factset coverage 提升到 `45.44%`。下一步主线：继续分批补齐市值，向 80% coverage gate 推进。

2026-05-30 补充：完成 P4.34.19。Factset Coverage 80% Gate 已达成：2000 标的 quote-list 市值补齐 Operation `d122fb49-a78e-4d8b-be5a-d1e860b7ae45` 完成，`requestedSymbols=2000`、`successCount=1992`、`failureCount=8`；canonical fullCoverageCount `2514 -> 4506`。全 A screener 事实集复检 `total=5524`、正式行业覆盖 `94.24%`、正式市值覆盖 `81.61%`、完整覆盖 `81.61%`。`test:quote-list-canonical` 和 `test:quote-list-market-cap-worker` 通过。下一步主线：重新跑策略 evidence 验收，确认 factset gate 解除后剩余 blocker 是否集中在 validation evidence / OOS 稳定性。

2026-05-30 补充：完成 P4.34.20。策略 evidence 复验确认 factset gate 已解除。500 样本 Operation `05c0c20d-c203-4411-878d-90d8fa5817ee` 样本内 factset coverage=`99.8%`，全 A factset coverage=`81.64%`，唯一失败 gate 是样本限制导致的 `universe_coverage=9.05%`。confirmed 全 A Operation `92bf373f-448c-4958-8456-d3583d5d415f` 完成，scanned=`5524`、evaluated=`5447`、providerSuccessRate=`98.61%`、cacheHitRate=`99.95%`、bestSampleSize=`3766`、bestCredibility=`high`、factsetCoverage=`81.64%`；唯一失败 gate 为 `validation_evidence`，OOS 诊断 `diagnosedCandidates=3 / passedCount=0 / failedCount=3`。下一步主线：P4.34.21 聚焦样本外失败原因和策略可信度规则，不新增选股策略。

2026-05-30 补充：完成 P4.34.21。新增 `validation_decision.json`，将策略 evidence 动作边界结构化：validation 未通过时 decision=`OBSERVE_ONLY`，允许 `RESEARCH / OBSERVE`，禁止 `ADD / REDUCE / AUTO_TRADE`；Operation result 和 `data_quality_report.json` 同步写入 `validationDecision`。异步 evidence 引用改为优先 full scan coverage、验收状态和可信度，不再简单按最新 Operation 选择，避免局部 500 样本覆盖 confirmed 全 A evidence。前端任务中心新增“验证决策”artifact 预览，分析页展示 scan coverage 和 validation decision 摘要。验证普通选股仍引用 confirmed 全 A Operation `92bf373f-448c-4958-8456-d3583d5d415f`；小样本 Operation `43cb6a65-6244-40a6-92c1-a8750f5c5424` 已生成 OBSERVE_ONLY 决策。下一步主线：P4.34.22 继续做 OOS 失败收益分布、日期分布和候选组合失败对比。

2026-05-31 补充：完成 P4.34.22。新增 `oos_failure_analysis.json`，将 OOS 失败原因拆成训练/样本外收益分布、超额/均值/中位数/胜率变化、signalDate 日期桶、failureTags 和候选组合对比；`validation_decision.json.evidenceRefs` 已引用该产物，Operation result 与 `data_quality_report.json` 同步写入 `oosFailureAnalysis`。前端任务中心新增“OOS失败分析”artifact 预览。验证后端/前端 TypeScript 通过，`test:screener-service` 和 `test:strategy-tournament-backtest` 通过。小样本 Operation `51de6890-c3df-486f-b9ae-ba4916507485` 验证 artifactCount=`23`、包含 `oos_failure_analysis.json`、validation decision 继续禁止 `ADD / REDUCE / AUTO_TRADE`。结论：OOS 失败已具备可审计解释，但 validation evidence 未通过前仍禁止 `ADD / REDUCE / AUTO_TRADE`。

2026-05-31 补充：完成 P4.34.23。新增 `infrastructure_readiness_report.json`，把 PostgreSQL/worker 性能验收前置边界机器可读化：记录数据库类型、执行模式、行情读取边界、分片规模、迁移前置项、SQLite 允许范围和 PostgreSQL 目标能力；Operation result 与 `data_quality_report.json` 同步写入 `infrastructureReadinessReport`。前端任务中心新增“基础设施就绪”artifact 预览。验证后端/前端 TypeScript 通过，`test:screener-service` 和 `test:strategy-tournament-backtest` 通过。小样本 Operation `123d8057-aa05-4e93-9e1b-503066fcca97` 验证 artifactCount=`24`、包含 `infrastructure_readiness_report.json`、当前 SQLite 环境 readinessStatus=`blocked`。结论：SQLite inline dry-run 不会被误标为生产级全 A ready；后续仍需 PostgreSQL/COPY/staging/worker 压力验收。

2026-05-31 补充：完成 P4.34.24。新增 `market_constraint_coverage_report.json`，把市场不可成交约束和正式 provider 缺口机器可读化：统计 executedSamples、blockedSamples、blockedRatioPercent、uniqueBlockedSymbols、blockedReasonSummary、providerGaps 和 nextActions；Operation result 与 `data_quality_report.json` 同步写入 `marketConstraintCoverageReport`。前端任务中心新增“市场约束覆盖”artifact 预览。验证后端/前端 TypeScript 通过，`test:screener-service` 和 `test:strategy-tournament-backtest` 通过。小样本 Operation `71bc0ab2-ca65-4e80-ae9a-56275a539e4f` 验证 artifactCount=`25`、包含 `market_constraint_coverage_report.json`、coverageStatus=`needs_official_status_provider`，providerGaps 包含正式证券状态、停复牌状态和涨跌停价字段缺口。结论：市场约束覆盖率和源缺口已可审计；正式 provider 接入未完成前不能把该约束体系标记为完全闭环，validation 未通过前继续禁止 `ADD / REDUCE / AUTO_TRADE`。

2026-05-31 补充：完成 P4.34.25。新增 `p4_closure_review.json`，把 P4 当前阶段的长样本验收、验证决策、OOS 失败分析、基础设施 readiness 和市场约束覆盖聚合为统一收口结论；Operation result 与 `data_quality_report.json` 同步写入 `p4ClosureReview`。前端任务中心新增“P4收口评审”artifact 预览。验证后端/前端 TypeScript 通过，`test:screener-service` 和 `test:strategy-tournament-backtest` 通过。小样本 Operation `7af9fa17-cdf2-443b-a78a-3019c22b926c` 验证 artifactCount=`26`、包含 `p4_closure_review.json`、status=`blocked_for_production`、decision=`CONTINUE_RESEARCH_ONLY`。结论：P4 当前可继续研究，但 validation 未通过、基础设施未生产 ready、正式 provider 未接入前，不得进入交易建议。

2026-05-31 补充：完成 P5.1 第一段生产阻断点审计产物。新增 `postgres_shadow_readiness_report.json`、`security_status_coverage_report.json`、`validation_failure_taxonomy.json`，分别审计 Shadow PostgreSQL/staging 前置项、正式证券状态/停复牌/涨跌停价 provider 覆盖、OOS/validation 失败分类；Operation result、`data_quality_report.json` 和 `p4_closure_review.json` 均已引用这些产物。前端任务中心新增 `PG Shadow / 证券状态覆盖 / 失败分类` 预览。验证后端/前端 TypeScript 通过，`test:screener-service` 和 `test:strategy-tournament-backtest` 通过。小样本 Operation `b54125e4-b4e7-4fd2-b8ec-5007688ac038` 验证 artifactCount=`29`、PG shadow status=`not_configured`、证券状态覆盖 status=`not_started`、失败分类 status=`blocked_for_trading`、decision=`OBSERVE_ONLY`。结论：这一步完成审计契约，不代表 PostgreSQL 或正式 provider 已上线；下一步继续实装 shadow/staging、正式状态源 canonical 和 OOS 分层复验。

2026-05-31 补充：完成 P5.2 证券状态 canonical 事实层第一段。Prisma 新增 `SecurityStatusDaily` 和 `MarketTradeabilityDaily`，新增 `securityStatusService` 负责从标的名称和最新 K 线生成 heuristic 证券状态与可交易性事实，记录 provider、confidence、sourceRefs 和 warnings。`stock_screener_full_scan / strategy_tournament_run` 新增 `security_status.canonicalize` task；`MarketConstraint` 第一段优先读取证券状态事实层，再 fallback 到旧启发式规则。`security_status_coverage_report.json` 新增 coverageSnapshot，当前有 canonical 行时从 `not_started` 推进为 `partial`，但 `official_provider_rows` 仍为 blocker。前端任务中心展示状态行、交易性行、正式源行、启发式行和字段覆盖率。验证 Prisma db push/generate、后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 均通过。小样本 Operation `0881de2a-0f65-449c-912d-d8ef40d1632e` 验证 security task completed、successCount=`4`、provider=`heuristic`，coverageSnapshot statusRows=`4`、tradeabilityRows=`4`、officialProviderRows=`0`、heuristicRows=`8`。结论：证券状态事实层已落地，但正式 provider 未接入前仍不能解除交易建议阻断。

2026-05-31 补充：完成 P5.3 quote-list canonical 多源身份升级。`securityStatusService` 优先读取 `a-share-quote-list-canonical`，将证券状态事实来源从纯 heuristic 升级为 `quote_list_canonical`，并写入 sourceProviders、sourceRefs、consensusScore、confidence 和 warnings；未命中时仍降级 heuristic。验证后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 均通过。小样本 Operation `85d6c35d-34bc-4f88-8e95-a6fe337a4ae0` 验证 `security_status.canonicalize` completed、provider=`quote_list_canonical`，coverageSnapshot requestedSymbols=`4`、statusRows=`4`、tradeabilityRows=`4`、officialProviderRows=`8`、heuristicRows=`0`。结论：证券身份事实可信度提升，但正式停复牌、涨跌停价和历史交易状态源仍未接入，交易建议阻断不解除。

2026-05-31 补充：完成 P5.4 / P5 收口评审。新增 `p5_closure_review.json`，聚合 `postgres_shadow_readiness_report.json`、`security_status_coverage_report.json`、`validation_failure_taxonomy.json` 和 `p4_closure_review.json`，Operation result 与 `data_quality_report.json` 同步写入 `p5ClosureReview`，前端任务中心新增“P5收口评审”预览。验证后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 均通过。小样本 Operation `4f4a6d31-3f7c-4993-818b-9256f9114843` 验证 status=`partial`、artifactCount=`30`、`p5_closure_review.json` schema=`fams.screener.p5_closure_review.v1`、status=`partial`、decision=`P5_COMPLETE_RESEARCH_ONLY`、productionReady=`false`。结论：P5 研究闭环完成；真实 PostgreSQL shadow/staging、正式交易状态 provider 和 OOS 分层复验仍是生产阻断项。

2026-05-31 补充：执行 P5.5 生产阻断项继续处理。新增 `oos_layered_validation.json`，按 market_regime / industry_group / market_cap_group 三维输出训练窗口与样本外窗口收益分布、变化和 bucket 状态；`postgres_shadow_readiness_report.json` 增加 verification 字段，明确当前缺少 shadow PostgreSQL URL 和 `psql`；证券状态 coverage 增加 `formalTradingStateRows` 和 `formal_trade_state_rows` gate，避免把 quote-list / baostock 身份源误判为正式停复牌/涨跌停状态源。前端任务中心新增“OOS分层复验”预览。验证后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 通过。小样本 Operation `b7f50f35-bf1a-4069-9d5c-66c14eccd51e` 验证 status=`partial`、artifactCount=`31`、PG shadow=`not_configured / psql_missing`、OOS layered=`insufficient`、P5 closure=`P5_COMPLETE_RESEARCH_ONLY / productionReady=false`。结论：审计产物链路补齐，但生产阻断不能在缺 PG/正式交易状态源/足够 OOS 样本的情况下解除。

2026-05-31 补充：完成 P5.6 生产阻断项自动转绿路径。针对“怎么才能改绿”，本节点没有降低 gate，而是补齐真实验收路径：新增 `pg` / `@types/pg`，`postgres_shadow_readiness_report.json` 在配置 `FAMS_POSTGRES_SHADOW_DATABASE_URL / POSTGRES_SHADOW_DATABASE_URL` 后可直接连接 PostgreSQL、创建 `fams_shadow` schema、创建 `staging_market_bar_raw / staging_quote_list / staging_security_status` 并执行事务内 smoke insert/count/rollback，全部通过才变为 `ready`；`securityStatusService` 新增可选 Tushare 正式交易状态 provider，配置 `FAMS_TUSHARE_TOKEN / TUSHARE_TOKEN` 后抓取 `stock_basic / suspend_d / stk_limit` 并写入 provider=`tushare` 的上市状态、停复牌和涨跌停价事实。当前本机未配置 PostgreSQL URL 和 Tushare token，Operation `b7b6e30c-dc9b-440d-929b-9fce9731c877` 仍为 `partial`，PG shadow=`not_configured`，证券状态覆盖=`partial`，P5 closure=`P5_COMPLETE_RESEARCH_ONLY / productionReady=false`。验证后端/前端 TypeScript、`test:screener-service`、`test:strategy-tournament-backtest` 通过。结论：真实转绿路径已完成；红灯来自外部依赖未配置，不能通过文档或代码常量绕过。

2026-05-31 补充：完成 P5.7 生产就绪自检脚本与正式状态口径收紧。新增 `backend/scripts/verify-production-readiness.ts` 与 `npm run test:production-readiness`，输出 `fams.production_readiness_check.v1`，直接检查 `postgres_shadow_ready`、`tushare_formal_trading_state`、`limit_price_coverage`；默认用于本地诊断，`--strict` 或 `FAMS_READINESS_STRICT=1` 时可作为 CI/发布门禁。Tushare `stock_basic` 从仅查 `L` 扩展为 `L/D/P`，分别映射在市、退市、暂停上市；`limit_price_coverage` 收紧为必须存在正式交易状态行，quote-list/heuristic 不再误导生产放行。验证后端 TypeScript、`test:screener-service`、`test:production-readiness` 通过。当前环境自检 `productionReady=false`，PG shadow 未配置、Tushare token 未配置、正式源涨跌停价缺失。结论：红灯原因可一键复现，下一步需要真实 PG/Tushare 环境后再跑 strict 验收。

2026-05-31 补充：完成 P5.8 PostgreSQL Shadow 本机配置与 GPT 优化核对。通过 winget 安装 Windows PostgreSQL 17，服务 `postgresql-x64-17` 已运行；创建 `fams_shadow` 数据库和用户，恢复 `pg_hba.conf` 为 `scram-sha-256`，并将 `FAMS_POSTGRES_SHADOW_DATABASE_URL` 写入 `backend/.env`。`npm run test:production-readiness` 现在显示 `postgres_shadow_ready=passed`，PG shadow report `status=ready`，connection/schema/staging/pressure 均 true；`npm run test:production-readiness -- --strict` 按预期失败，因为 `tushare_formal_trading_state` 与 `limit_price_coverage` 仍 failed。新增 `backend/scripts/verify-gpt-optimization-plan.ts` 和 `npm run test:gpt-optimization-plan`，12/12 项 passed，状态为 `implemented_with_external_blockers`。更新 `PRODUCTION_READINESS_RUNBOOK.md`、`.env.example` 和相关计划文档。验证后端 TypeScript、`test:screener-service`、`test:gpt-optimization-plan` 通过。结论：GPT 优化建议的架构和工程项已完成机器核对，PG shadow 已绿；交易建议仍不能输出 ADD/REDUCE，剩余阻断为 Tushare/正式交易状态和 OOS/validation gate。

2026-05-31 补充：完成 P5.9 免费信源分析建议放行与 Tushare 可选化。按用户要求，Tushare 仅保留为可选增强接口：配置 token 后可补 `stock_basic / suspend_d / stk_limit` 正式交易状态、停复牌和涨跌停价；不配置时不阻断免费来源分析建议。`security_status_coverage_report.json` 更新为 providerPolicy=`free_sources_primary_tushare_optional`，正式交易状态缺口从分析建议 blocker 调整为 warning。`test:production-readiness -- --strict` 现在输出 `analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`；`test:gpt-optimization-plan` 12/12 通过。结论：系统可以基于免费来源输出分析建议、候选池、观察建议和人工复核草案；`ADD / REDUCE / AUTO_TRADE` 仍被 OOS/validation 与执行级市场约束阻断，不能放行。

2026-05-31 补充：完成 P5.10 交易动作 readiness 动态门禁与验证覆盖增强。`verify-production-readiness.ts` 不再把 `tradeActionReady` 硬编码为 false，而是读取最新 `strategy_tournament_run` 长样本 evidence，输出 `fams.trade_action_readiness.v1`，包含 `full_a_strategy_evidence / validation_evidence / factset_coverage / manual_execution_review` gates。新增 `npm run test:trade-action-readiness`，当前按预期失败，报告选择全 A Operation `92bf373f-448c-4958-8456-d3583d5d415f`，全 A 证据和事实集覆盖通过，唯一交易动作 blocker 为 `validation_evidence`。全 A 深度验证从固定 top-3 改为 `FAMS_SCREENER_DEEP_VALIDATION_TOP_N`，默认 12，上限 20。验证：后端 TypeScript 通过，`test:production-readiness -- --strict` 通过，`test:production-readiness -- --strict-trade` 按预期失败。结论：工程假阻断已消除，剩余真实阻断是至少一个候选组合需要同时通过样本外、walk-forward、参数敏感性和分组稳定性验证。

2026-05-31 补充：完成 P5.11 全 A top-12 深度验证复跑与执行阻断闭环。首次复跑 Operation `49a1a805-6ddb-45fb-b34a-48284d18ba41` 在 `security_status.canonicalize` 因大事务超时失败；已将 `securityStatusService.upsertHeuristicFromRecords` 改为分批小事务，默认 `FAMS_SECURITY_STATUS_UPSERT_CHUNK_SIZE=250`，并设置事务 maxWait/timeout。复跑 Operation `52cfc9bf-ceb4-49cf-8f94-c56272117492` 完成 partial，`scannedCount=5524`、`evaluatedCount=5447`、`providerSuccessRate=98.61%`、`cacheHitRate=99.95%`、`bestSampleSize=3766`、`bestCredibility=high`；`security_status.canonicalize` 成功处理 5447 个标的，耗时约 7407ms。top-12 中 10 个候选组合完成深度验证，`passedCount=0 / failedCount=10`，失败集中在样本外超额收益不为正，市场状态从“弱势回撤”切换为“高波动震荡”。`verify-production-readiness` 已修正为同时读取 `stock_screener_full_scan` 和 `strategy_tournament_run` evidence，当前引用最新 Operation `52cfc9bf...`；`test:production-readiness -- --strict` 通过，`test:trade-action-readiness` 按预期失败，唯一 blocker=`validation_evidence`。结论：执行链路阻断已闭环；剩余为真实策略稳定性问题，不能放行 `ADD / REDUCE / AUTO_TRADE`。

2026-05-31 补充：完成 P1-P5 收口复验与前端选股策略验收。P1-P5 按“研究/分析建议链路”可以收口：Operation、行情 raw/canonical/cache、coverage/warmup、feature cache、策略 evidence、生产 readiness、自检脚本和前端展示均已闭环；按“交易动作可放行”不能收口，唯一真实 blocker 仍为 `validation_evidence`。前端 Playwright 验证 `http://localhost:3000/analysis` 的 AI 选股输入框分别提交 `A杀后横盘放量 / 放量突破平台 / 跌破后收复关键均线` 查询，三类策略均返回 200 并渲染策略定义、异步策略证据引用、样本/扫描/匹配数。当前 120 样本中：A杀横盘放量命中 0、放量突破平台命中 0、跌破后收复关键均线命中 4。截图 `.verification/frontend-screener-validation.png`。验证：后端/前端 TypeScript 通过；`test:production-readiness -- --strict` 通过；`test:gpt-optimization-plan` 12/12 通过；`test:trade-action-readiness` 按预期失败且唯一 blocker=`validation_evidence`。

2026-05-31 补充：完成持仓研究证据展示与 AI 选股前端闭环修复。`getHoldingsResearch` 改为批量读取 `PositionAdviceCache`，列表接口不再逐只触发完整建议引擎，真实验证 22 条持仓约 0.03 秒返回；现金类返回 `positionAdvice=null`，前端显示“现金类不生成仓位建议”。持仓卡片改为摘要 + 关键证据，点击“查看详情”显示完整仓位建议、评分、理由、风险、阻断原因、触发条件、反证条件、基本面/技术面/消息面。股票/ETF 展示层接入 `market_feature_daily`，`technical_factset_missing` 前端可见阻断清零；交易所 ETF 代码 `513770 / 159851` 在缺少 ETF feature cache 时用现价/成本做低强度展示参考，不再误用股票基本面缺失作为主阻断。AI 选股前端提交 `A杀后近20个交易日横盘，最近两个交易日成交量明显放大` 已返回全 A 样本 `5524`、扫描 `5524`、匹配 `18`、K 线有效 `5509`、provider 成功率 `99.73%`，并展示 `OBSERVE_ONLY / validation_evidence`。验证：后端/前端 TypeScript 通过；`test:production-readiness -- --strict` 通过；`test:gpt-optimization-plan` 通过；`test:trade-action-readiness` 按预期失败且唯一 blocker=`validation_evidence`。结论：研究阅读链路已闭环，交易动作仍不放行。

2026-05-31 补充：完成 Validation Evidence 矩阵闭环第一段。新增 `validation_evidence_matrix.json` artifact，schema=`fams.screener.validation_evidence_matrix.v1`，对 top 候选组合输出 OOS / walk-forward / 参数敏感性 / 分组稳定性四项矩阵，并给出 `failedChecks`、`blockerTags`、`actionClass` 和 `nextAction`。任务中心新增“验证矩阵”导航和预览；前端 AI 选股在显式 `即时回测=1` 时展示该矩阵，普通选股仍默认引用异步 full-A evidence。小样本即时回测验证 matrix=`fams.screener.validation_evidence_matrix.v1`、status=`blocked`、decision=`OBSERVE_ONLY`、primaryBlocker=`out_of_sample`、candidates=`20`。验证：后端/前端 TypeScript 通过；`npm run test:screener-service` 通过；`npm run test:production-readiness -- --strict` 通过；`npm run test:trade-action-readiness` 按预期失败且唯一 blocker=`validation_evidence`。下一步主线：优先处理 `actionClass=regime_retest` 候选，做市场状态分层 OOS、多窗口 OOS 和近期高波动窗口复验，不新增策略、不放宽 gate。

2026-05-31 补充：完成 OOS 多窗口与市场状态复验第一段。新增 `oos_multi_window_regime_retest.json` artifact，schema=`fams.screener.oos_multi_window_regime_retest.v1`，对 OOS 阻断候选执行 `60/40`、`70/30`、`80/20` 三个 chronological split，并按 `marketRegime` 输出训练/样本外收益分布、状态、失败原因、候选结论和下一步动作。Operation result 与 `data_quality_report.json` 同步写入 `oosMultiWindowRegimeRetest`；任务中心新增“多窗口OOS”导航和预览。该报告只用于解释和淘汰/观察分流，不替代原四项 validation gate，不解除 `ADD / REDUCE / AUTO_TRADE` 阻断。下一步主线：运行全量验收，若多窗口显示候选普遍失败，则将这些候选从交易建议候选池降级，只保留研究观察。

2026-05-31 补充：完成 AI 选股结果数量与手动条件第一段。当前支持 `A杀后横盘放量 / 放量突破平台 / 跌破后收复关键均线` 三个内置策略；同步选股结果从固定 `slice(0, 10)` 改为默认最多返回 200 个，可用 `返回数量 / 候选上限 / maxResults` 调整。新增手动过滤解析：`市盈率<20 / PE<=20 / 市值>100亿 / 行业:半导体` 等；前端候选卡片展示 PE、PB、市值和过滤命中/失败原因。验证：后端/前端 TypeScript 通过；无 PE 条件全 A 查询返回 `matched=18 / displayed=18`，修复“命中多于10但只显示10”的问题；PE 条件当前受 WSL 到东方财富估值接口 `curl: (52) Empty reply from server` 影响，因无法验证 PE 而返回 0 个候选，系统未伪造通过。生产 readiness strict 通过，trade-action-readiness 按预期失败且唯一 blocker=`validation_evidence`。

2026-05-31 补充：完成持仓建议解释层可读性修复。`holdings-research` 新增 `positionAdvice.explanation`，前端详情展示目标仓位公式、动作触发规则、风险惩罚原因和证据缺口；技术面展示 `market_feature_daily` 原始指标，基本面/消息面缺失时明确显示事实集缺口，不再用模板话术。修复百分比二次放大问题，`601127 赛里斯` 详情验证为 action=`REDUCE`、confidence=`low`，REDUCE 由趋势分 `0 < 30` 的确定性风控规则触发；公式为 `0.08 * 0.7 * 0.2 * 0.56 * 0.3 = 0.001882`，当前仓位约 `11.48%`；技术指标显示 `20日收益=-8.42%`、`60日收益=-23.29%`、`RSI14=35.971`、`20日波动率=2.50%`、`20日最大回撤=13.15%`。验证后端/前端 TypeScript 通过，`test:production-readiness -- --strict` 通过，`test:trade-action-readiness` 按预期失败且唯一 blocker=`validation_evidence`。前端截图验证仍被 WSL Chromium 依赖 `libnspr4.so` 缺失阻断，当前 WSL 无免密 sudo，未能自动补装。

2026-05-31 补充：完成价值评估模型第一段。新增 `valueAssessmentService` 和 `value.assessment.factset.v1`，新增 `/api/v1/analysis/value-assessments` 与单持仓接口；`holdings-research` 每条持仓返回 `valueAssessment`，前端持仓详情新增“价值评估模型”区块。股票第一段复用 `StockFactSetCache`、`quote-list-canonical` 和已缓存财报，输出估值分、质量分、成长分、财务安全分、综合分、可信度、仓位乘数、阻断原因和 evidenceRefs；基金/ETF/债基、黄金先输出专属估值缺口，现金返回不适用。新增并通过 `npm run test:value-assessment`，检查 22 个持仓、5 个股票、3 个现金。接口验证 `601127` 为 `partial / insufficient`，综合分 `47.96`、可信度 `low`、仓位乘数 `0.3`、阻断 `valuation_metrics_missing`，说明 PE/PB 缺失时不会伪造价值结论。后端/前端 TypeScript 通过，`test:production-readiness -- --strict` 通过，`test:trade-action-readiness` 按预期失败且唯一 blocker=`validation_evidence`。

2026-05-31 补充：完成 PE/PB 缺口修复与 blocker 复核。`valueAssessmentService` 新增基于总市值、归母净利润、ROE 和财报周期的 PE/PB 派生 fallback，facts 来源标记为 `derived_from_market_cap_financial_report`；`refresh-quote-list-canonical.ts` 与 `a_share_quote_sources.py` 补充 PE/PB 字段传递，后续 spot 源可用时 canonical 会保留原始字段。`601127` 复验为 `available / reasonable`，综合分 `46.74`、估值分 `41.5`、PE=`47.38`、PB=`3.47`、blockedReasons=`[]`；`holdings-research` 显示 `价值评分 46.74 / low`。`test:value-assessment` 增加 601127 PE/PB 回归断言并通过，后端/前端 TypeScript 通过，`test:production-readiness -- --strict` 通过。`test:trade-action-readiness` 仍按预期失败，唯一 blocker=`validation_evidence`；结论是 PE/PB 已闭环，剩余 blocker 是策略 evidence 的真实样本外/稳定性验证失败，不能通过降低 gate 解决。
