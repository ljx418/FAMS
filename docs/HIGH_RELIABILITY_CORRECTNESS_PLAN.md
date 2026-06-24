# FAMS 高可靠与高正确开发计划

更新时间：2026-06-02

最新同步 2026-06-02：FIVD-R Phase 12-15 可信研究工作台收口已完成第一轮落地。新增 `DataGapSummary`、`FivdRCapabilityState`、候选 `signalScore/researchScore/evidenceAdjustedScore`、前端 Research-only / Trade-blocked Banner、Trade Gate Contract Tests、`fivd.r.validation_failure_taxonomy.v1` 和 `GET /api/v1/analysis/fivd-r/validation-report/latest`。真实验证显示 validation taxonomy 状态为 `blocked_for_trading`，失败类别包括 `validation_evidence / out_of_sample / parameter_sensitivity / market_regime / sample_size`；`test:fivd-r-core`、`test:production-readiness`、`test:fivd-r-trade-gate-contract`、`test:fivd-r-validation-taxonomy`、前端 build 通过；`test:trade-action-readiness` 按预期失败，交易动作仍由 `validation_evidence` 阻断，manual trade draft 继续 blocked，AUTO_TRADE 继续 out of scope。

最新同步 2026-06-02：FIVD-R DataGap Remediation 第一段完成。新增 `dataGapRemediationService`、`POST /api/v1/analysis/fivd-r/data-gap-remediation-plan`、`POST /api/v1/analysis/fivd-r/data-gap-remediation-operation`、前端 Data Gap Remediation 面板和 `test:fivd-r-data-gap-remediation`。当前可执行动作包括股票事实集刷新 `batch_factset_refresh scope=stock_factset` 与 validation retest audit；`asset_identity` 仍为 planned，`fund_factset` 和 `gold_macro` 明确为 unsupported。验证通过：后端 TypeScript、前端 build、`test:fivd-r-data-gap-remediation`、`test:fivd-r-core`、`test:fivd-r-trade-gate-contract`、`test:fivd-r-validation-taxonomy`、`test:production-readiness`；`test:trade-action-readiness` 继续按预期失败，交易动作仍未放行。

最新同步 2026-06-02：FIVD-R Phase 5 Trading Discipline Engine 完整化完成并通过真实数据验收。`tradingDiscipline` 升级为 `fivd.r.trading_discipline.v2`，新增 bucket、disciplineType、有效期、复核频率、仓位边界和 add/reduce/stop/takeProfit/invalidation 条件组；现金资产固定为 `no_action`，不生成买卖纪律。真实样本 `009725 / 中期债（一年）` 与 `现金-现金-银行卡 / 银行卡` 验收通过，产物为 `.verification/fivd-r-phase5-trading-discipline-audit.json` 和 `.verification/fivd-r-phase5-trading-discipline.png`。Validation Evidence gate 未被绕过，Production readiness 仍显示 `tradeActionReady=false`，交易动作继续由 `validation_evidence` 阻断。Phase 6 PositionAdvice Adapter 开发前计划与审计已形成，允许在不开放交易动作的前提下进入实质开发。

最新同步 2026-06-02：FIVD-R Phase 6 PositionAdvice Adapter 深度接入完成并通过真实数据验收。PositionAdvice FactSet/Advice 新增 `fivd.r.position_advice_adapter.v1`，接入 valuation、risk、evidence、validation 和 combined multipliers，目标仓位公式新增 `fivdRCombinedMultiplier`。真实样本 `601127 / 赛里斯` 验收通过，`validationGateMultiplier=0`、`combinedMultiplier=0`、action=`OBSERVE`，未输出 ADD / REDUCE；产物为 `.verification/fivd-r-phase6-position-advice-adapter-audit.json`。固定门禁复验：后端/前端 TypeScript、`test:fivd-r-core`、`test:production-readiness -- --strict` 通过；`test:trade-action-readiness` 按预期失败，唯一 blocker 为 `validation_evidence`。

最新同步 2026-06-02：FIVD-R Phase 7 Advice Replay & Validation 第一段完成并通过真实数据验收。新增 `backend/scripts/verify-fivd-r-phase7-advice-replay.ts`，使用真实持仓和真实 PriceHistory 执行 Gate-Strict + Buy & Hold 最小 replay。真实样本 `009725`，reviewDate=`2026-05-11`、horizonEnd=`2026-05-29`，decisionAction=`OBSERVE`，simulatedTrades=0，noFutureLeakAudit.leaked=false；validation evidence 在历史 reviewDate 不可用且当前仍未通过，因此正确阻断 formal ADD / REDUCE。产物为 `.verification/fivd-r-phase7-advice-replay-audit.json`。

最新同步 2026-06-02：FIVD-R Phase 7 第二段完成并通过真实数据验收。Replay 脚本扩展为 fixed/rolling 多窗口和四模式输出，真实样本 `002611`，priceHistoryRows=36，startPolicies=`fixed_3m / fixed_2m / fixed_1m / rolling_weekly`，windowsChecked=8，modes=`gate_strict / research_only / buy_and_hold / benchmark_cash`，noFutureLeakAudit.leaked=false。Gate-Strict 未执行 formal ADD / REDUCE，Research-Only 未进入 formal simulated trades；`benchmark_cash` 明确为现金 benchmark，不冒充宽基指数。

最新同步 2026-06-02：FIVD-R Phase 8 人工复核与干预记录完成并通过真实数据验收。新增 `FivdRInterventionReview`、`fivdRInterventionService` 和 `/api/v1/analysis/fivd-r/interventions` 追加/查询/审计接口；记录使用 previousHash/recordHash hash chain，服务层只提供 create/list/verify，不提供覆盖更新。真实样本 runId=`fivd-r:default:1780398413513`、symbol=`009725`，追加两条复核记录，chainOk=true，firstUnchanged=true，secondLinksFirst=true；人工复核未绕过 `validation_evidence`。

最新同步 2026-06-02：FIVD-R Phase 9 Calibration 与 Model Tuning 完成并通过真实 replay 产物验收。新增 `backend/scripts/verify-fivd-r-phase9-calibration.ts`，读取 Phase 7 replay 产物生成 actionQuality、probabilityCalibration 和 modelComparison。验收结果 windowsChecked=8，validationGateRespected=true，probabilityCalibration=insufficient，promoteStatus=not_promoted，requiresHumanConfirmation=true。该阶段未伪造概率校准指标，未自动 promote challenger，未弱化 `validation_evidence` gate。

最新同步 2026-06-02：FIVD-R Phase 10 Readiness Closure 完成并通过真实 readiness 验收。新增 `backend/scripts/verify-fivd-r-phase10-readiness-closure.ts`，串行执行 production strict 与 strict-trade readiness，并输出 `.verification/fivd-r-phase10-readiness-closure-audit.json`。当前真实状态 closureStatus=blocked，analysisAdviceReady=true，productionReady=true，tradeActionReady=false，blockerGateIds=`validation_evidence`，autoTradeAllowed=false，allowedManualModes=[]。该结果确认 FIVD-R 剩余主线在当前 validation evidence 未通过前正确收口为研究/观察，不开放人工交易草案或自动交易。

最新同步 2026-05-31：P5/P4.34 全 A 证据链复验与性能闭环完成，交易动作仍因 `validation_evidence` 正确阻断。进入本节点前复验：后端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 通过；已确认旧的未完成全 A Operation 均取消，避免重复 worker 抢占。

实现：`strategy_tournament_run` 的全 A 聚合新增三项优化：同一 `SignalStrategy + holdingDays + symbol` 的历史信号命中缓存，避免 42 个执行策略重复计算同一批历史信号；基础排名阶段改为流式计算 benchmark summary，不再为每个候选构造完整 benchmark outcomes 数组；全 A top-N 深度验证增加审计短路，只有候选先通过 OOS 和 walk-forward 后才继续执行高成本参数敏感性，未运行时写入明确 `insufficient/skipped` warning，不能通过 `validation_evidence`。该优化不放宽任何交易建议阈值。

实际验收：全 A queued Operation `15fae43c-c208-47b7-9596-90dedc99377b` 完成，状态 `partial`，生成 33 个 artifactRefs。全 A universe `5524`，扫描覆盖 `100%`，实际评估 `5447`，失败 `77`，provider 成功率 `98.61%`，cache hit rate `99.95%`，回测窗口 `60` 日，ranked candidates `126`，best sample size `3766`，best credibility `high`。`backtest.aggregate` 用时约 `3m43s`，较上一轮 14 分钟仍未结束的实现明显改善，且未发生 OOM。

验证结论：`npm run test:production-readiness -- --strict` 通过，`analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。`npm run test:trade-action-readiness` 按预期失败，唯一 blocker 为 `validation_evidence`。最新 `validation_decision.json` 为 `OBSERVE_ONLY`，禁止 `ADD / REDUCE / AUTO_TRADE`；10/10 深度验证候选样本外失败，`validation_evidence_matrix.primaryBlocker=out_of_sample`。P4 closure 仍为 `CONTINUE_RESEARCH_ONLY`，P5 summary 显示 PostgreSQL shadow 和免费源证券状态覆盖达标，但生产交易建议不可放行。

状态：P1-P5 的分析建议、缓存、Operation、全 A 样本获取、产物、生产分析 gate 可收口；交易动作输出不能收口。下一步必须继续处理 `validation_evidence`，但不得通过降低 OOS、walk-forward、参数敏感性或分组稳定性阈值来“改绿”。允许的下一步是增加更长历史窗口、正式市场状态分层、行业/市值分层样本外诊断、候选执行策略独立分片验证，并把 `artifact.generate` 显式拆为可查询任务，减少 88% 之后的不可见同步段。

最新同步 2026-05-25：P4.31 事实集覆盖补齐第一段完成但未达全量准入。进入本节点前复验 P4.30：后端 TypeScript、`test:operation-worker-readiness` 和 `test:operation-recovery` 均通过。独立评审结论：P4.31 不新增策略，不直接触发全量扫描，先把扫描样本的行业、市值事实集预热从回测主路径中拆出来，形成可单独运行、可审计的覆盖率报告。

实现：`StockScreenerService` 新增 `preheatScreenerFactsets`，输出 `fams.screener.factset_preheat_run.v1`，包含 universe 来源、请求样本、计划/尝试/成功/失败数量、before/after 覆盖率、失败标的和 warnings；新增 `npm run run:screener-factset-preheat` 和 `npm run test:screener-factset-preheat`。预热成功标准从“调用分析服务不报错”收紧为“同时拿到东方财富行业板块和总市值/流通市值”，否则计入失败，避免生成虚假覆盖率。

实际验收：`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:screener-factset-preheat` 通过，指定 `601127` 的已缓存事实集覆盖率为 `100%`，证明覆盖率口径和成功路径可用。受控 20 样本预热 `FAMS_FACTSET_PREHEAT_MAX_SCAN=20 FAMS_FACTSET_PREHEAT_LIMIT=20 FAMS_FACTSET_PREHEAT_CONCURRENCY=2 npm run run:screener-factset-preheat` 完成，`universeSource=sina_hs_a_all_a_share`、`universeTotal=5521`、`attemptedSymbols=20`、`successSymbols=0`、`failureSymbols=20`、`initialFullCoverage=0`、`finalFullCoverage=0`，期间多个前排标的 provider 返回 `curl: (52) Empty reply from server`，并且缓存中缺少正式行业或市值事实。

状态：部分完成且阻断 P4.32。该节点已填补“事实集预热缺少独立验收入口、成功/失败口径不严格”的缺口，但真实扫描样本覆盖率仍未达标。下一步不得执行全 A 长样本正式扫描；必须先修复基础事实集 provider 对深市和前排样本的行业/市值覆盖，或接入独立批量行业/市值 provider，再重新运行 P4.31 覆盖率验收。

最新同步 2026-05-25：P4.30 PostgreSQL / worker 性能验收与全量扫描前置评审第一段完成。进入本节点前复验 P4.29：后端 TypeScript、前端 TypeScript、`npm run test:screener-service`、`npm run test:strategy-tournament-backtest` 和 `target-architecture-gap.drawio` 读取均通过。独立评审结论：不能直接进入真实全 A 全量扫描，必须先证明 `stock_screener_full_scan` 能脱离 API 进程内立即执行，具备队列领取、过期租约恢复、任务产物和租约释放的可审计闭环。

实现：`stock_screener_full_scan` 新增 `executionMode=queued` 入队模式；`OperationService` 新增 `runNextQueuedOperation` 与 `executeQueuedOperation`，支持 worker 领取 queued 或过期 lease 的 `stock_screener_full_scan / batch_factset_refresh`；服务启动恢复范围扩展到 `stock_screener_full_scan`；新增 `npm run run:operation-worker-once` 单次 worker 入口和 `npm run test:operation-worker-readiness` 专项验收脚本。恢复策略明确写入 `recoveryJson`，选股扫描采用 `rerun_operation_with_idempotent_task_upserts`，批量事实集刷新继续采用 `skip_completed_phase_tasks`。

实际验收：`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:operation-worker-readiness` 通过，排队小样本 Operation `2cacf6d0-9ac5-4afd-aa15-ea9f1559baca` 被 worker 领取并 completed，耗时约 `9492ms`，生成 6 个任务记录和 17 个 artifactRefs；过期 lease Operation `2a766ac2-055a-4c38-ac30-afb15aaaed99` 被 worker 恢复并 completed，`recovery.reason=expired_lease_worker_recovery`。`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:operation-recovery` 通过，原 batch factset 启动恢复仍能完成并释放 lease。

状态：部分完成。该节点已填补 `GAP-7 异步任务骨架` 中“选股扫描只能 API 进程内执行，缺少 worker 领取与过期租约恢复验收”的缺口。当前仍未迁移 PostgreSQL，真实全 A 长样本仍不得执行为投资结论；下一步进入 P4.31 事实集覆盖补齐，目标先把 120 样本 factset coverage 从 0% 提升到可审计水平。

最新同步 2026-05-25：P4.29 market bar 缓存预热与 universe 来源防误判完成第一段。进入本节点前复验 P4.28：`long_sample_dry_run` 可完成并生成 17 个 artifact，但缓存命中率只有 `7.42%`，且后续复跑发现全 A universe provider 偶发失败时会降级到 9 个默认标的，存在把 fallback 小样本误读为长样本验收的风险。独立评审结论：本节点先补缓存覆盖审计、预热脚本和 universe 来源硬 gate，不扩大策略结论。

实现：`MarketBarCacheService` 新增 `getCoverageReport`，可按 symbol/day 输出 canonical K 线覆盖率、缺口、过期标的和估算 cache hit rate；新增 `npm run run:market-bar-cache-preheat`，扫描前先按缺口预热，只拉缺失或过期 K 线；全 A 股票池新增本地持久缓存，live provider 成功时写入快照，provider 临时失败时优先使用已验证的全 A 快照；`long_sample_acceptance.json` 新增 `universeSource / universeTotal`，并增加 `universe_source` blocker gate，fallback 股票池不得通过长样本验收。

实际验收：全 A provider 重新拉取成功，`count=5521`。预热脚本使用 `sina_hs_a_all_a_share`、`universeTotal=5521`、`limit=120`、`days=120` 运行，预热前 120 样本 `sufficientSymbols=119`、估算命中率 `100%`，只补 1 个缺口标的，provider 无 warning。复跑 Operation `29dbb2f3-f238-45c4-92ca-8b551a8ed011` 完成，`universeSize=5521`、`universeSource=sina_hs_a_all_a_share`、`scannedCount=120`、`evaluatedCount=120`、`failureCount=0`、`providerSuccessRate=100%`、`cacheHitRate=100%`、`bestSampleSize=83`、`bestCredibility=low`。

状态：部分完成。该节点已填补 `P4 策略锦标赛升级` 中“长样本 dry-run 缓存命中低、universe provider fallback 可能误导验收”的缺口。验收仍为 `insufficient` 是正确结果，剩余阻断为全 A 覆盖率 `2.17% < 80%`、最佳成交样本 `83 < 100`、无候选组合四项稳定性全部通过、事实集覆盖 `0% < 80%`。下一步进入 PostgreSQL/worker 性能验收和全量扫描前置评审，不能把 120 样本 dry-run 解释成可用投资结论。

最新同步 2026-05-25：P4.28 长样本 dry-run 实际运行与产物沉淀完成。进入本节点前复验 P4.27：后端 TypeScript、前端 TypeScript、`npm run test:screener-service`、`npm run test:strategy-tournament-backtest`、前端 Vite build 和 `target-architecture-gap.drawio` 读取均通过。独立评审结论：本节点先执行受控 dry-run，不直接触发真实全 A 全量长样本，目标是拿到真实 provider/cache/产物链路证据。新增 `npm run run:long-sample-dry-run`，脚本会提交 `mode=long_sample_dry_run` Operation、轮询状态、读取 `long_sample_acceptance.json` 并输出失败 gate 摘要。

实际验收：Operation `65a36d22-c4cc-400b-8755-0cf2a62a2618` 完成，耗时约 `155479ms`，生成 17 个 artifact。配置为 `扫描上限=120；验证天数=60；持有天数=3；跳过事实集预热=1`。结果：`universeSize=5521`，`scannedCount=120`，`evaluatedCount=120`，`failureCount=0`，`providerSuccessRate=100%`，`cacheHitRate=7.42%`，`rankedCandidates=108`，`bestSampleSize=83`，`bestCredibility=low`。`long_sample_acceptance.status=insufficient`，失败 gate 为全 A 覆盖率 `2.17% < 80%`、缓存命中率 `7.42% < 80%`、最佳成交样本 `83 < 100`、无候选组合四项稳定性全部通过、事实集覆盖 `0% < 80%`。

验证：dry-run Operation 状态 `completed`；`market_data.warmup` 两个分片均 completed，成功数分别为 100 和 20，失败数 0；`strategy.evaluate` 成功数 120；`backtest.aggregate` 成功信号数 4776；`artifact.generate` 成功数 17。该节点填补 `P4 策略锦标赛升级` 中“只有验收入口但没有真实运行证据”的缺口。

状态：部分完成。当前长样本链路可执行且 provider 在 120 样本 dry-run 中稳定；剩余 P4 缺口集中到缓存命中率、事实集覆盖、样本覆盖率和 worker/PostgreSQL 性能。下一步优先做 market bar 缓存预热计划与性能验收，而不是扩大策略结论。

最新同步 2026-05-25：P4.27 长样本验收受控入口第一段完成。进入本节点前复验 P4.26：后端 TypeScript、前端 TypeScript、`npm run test:screener-service`、`npm run test:strategy-tournament-backtest`、前端 Vite build 和 `target-architecture-gap.drawio` 读取均通过。独立评审结论：长样本验收不能继续依赖人工手写 query，否则容易漏掉 `验证天数`、`扫描上限`、预热开关或误触发真实全 A 高成本任务。实现后 `stock_screener_full_scan` 支持 `mode=default / long_sample_dry_run / long_sample_full`；`long_sample_dry_run` 使用固定预设 `扫描上限=120；验证天数=60；持有天数=3；跳过事实集预热=1`，用于低成本验证长样本闸门和前端产物链路；`long_sample_full` 默认真实全 A 60 日窗口，必须显式传入 `confirmedFullScan=true`，否则在任何数据库准备动作之前拒绝。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 验证真实全 A 长样本未确认时会被阻断；`npm run test:strategy-tournament-backtest` 验证策略锦标赛回归仍通过。前端任务中心新增“长样本验收”按钮，默认提交 dry-run 模式，真实全量入口只保留在后端受保护契约中，避免误点。

状态：部分完成。当前已具备受控验收入口和高成本任务保护；剩余 P4 缺口是运行一次真实长窗口 dry-run/全量样本并记录产物结果、做 PostgreSQL/worker 性能验收、把通过闸门的候选证据联动到持仓建议 `strategyEvidence`。

最新同步 2026-05-25：P4.26 全 A 长样本验收闸门第一段完成。进入本节点前复验 P4.25：后端 TypeScript、前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service`、前端 Vite build 和 `target-architecture-gap.drawio` 读取均通过。独立评审结论：下一步不能继续新增策略，应先防止短窗口、小样本或 provider 失败的扫描结果被误读为高可信全 A 结论。实现后全市场扫描新增 `long_sample_acceptance.json` artifact，并嵌入 `data_quality_report.json`；验收闸门覆盖全 A 扫描覆盖率、provider 成功率、缓存命中率、长窗口回测天数、成交样本量、样本外/walk-forward/参数敏感性/分组稳定性证据，以及事实集覆盖率。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 验证短窗 fixture 会被长样本闸门标记为 `insufficient` 并输出阻断建议；`npm run test:strategy-tournament-backtest` 验证策略锦标赛核心回归仍通过。前端任务中心新增“长样本验收”产物预览，可查看每个闸门的 actual、required、severity 和候选组合摘要。该节点填补 `P4 策略锦标赛升级` 中“已有长期样本入口，但缺少明确验收闸门，短窗结果容易被误用”的缺口。

状态：部分完成。当前已能在每次扫描产物中判断是否具备长样本可信资格；剩余 P4 缺口是执行真实全 A 长窗口样本、做 PostgreSQL/worker 性能验收，并把通过闸门的候选证据联动到持仓建议 `strategyEvidence`。

最新同步 2026-05-25：P4.25 按覆盖缺口触发可取消事实集预热第一段完成。进入本节点前复验 P4.24：后端 TypeScript、前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。独立评审结论：预热必须有上限、可取消、可审计，不能在全 A 扫描中无约束调用外部 provider。实现后全市场扫描会先生成初始覆盖率；若扫描样本完整覆盖率低于阈值，则进入 `factset.preheat_missing` 任务，只对缺少行业或市值事实的扫描样本按 `factsetPreheatLimit / 事实集预热上限 / 预热上限` 执行刷新，默认上限 20，阈值默认 80%。任务每个标的前检查取消状态；预热完成后重新读取 `StockFactSetCache`，并在 `factset_preheat_coverage.json` 中记录 initial、preheat 和最终覆盖率。可通过 `跳过事实集预热=1` 或 `skipFactsetPreheat=true` 跳过。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 验证覆盖率报告携带 preheat 成功/失败统计；`npm run test:strategy-tournament-backtest` 验证策略锦标赛回归仍通过。该节点填补 `P4 策略锦标赛升级` 中“覆盖率缺口只能被观察，不能触发受控补齐”的缺口。

状态：部分完成。当前预热已可取消、限量并写入产物；剩余 P4 缺口是对真实全 A 长窗口样本做性能验收、把预热任务迁入独立 worker/PostgreSQL 队列，并把分组结论联动到持仓建议证据链。

最新同步 2026-05-25：P4.24 批量事实集预热覆盖率第一段完成。进入本节点前复验 P4.23：后端 TypeScript、前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。独立评审结论：本节点先做可审计覆盖率，不直接发起大规模外部 provider 预热，避免把真实全 A 网络成本和失败率引入当前回测路径。实现后全市场扫描在 `universe.snapshot` 后新增 `factset.preheat_coverage` 任务，统计扫描样本和全 universe 的正式行业覆盖率、正式市值覆盖率、完整覆盖率、缺失行业/市值样本预览和 provider 分布。Operation 新增 `factset_preheat_coverage.json` artifact，`data_quality_report.json` 同步嵌入该报告；任务中心 artifact 导航新增“事实集覆盖”并可视化展示覆盖率、缺失样本和 warning。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 验证覆盖率 schema、完整覆盖率、缺失样本预览和 warning；`npm run test:strategy-tournament-backtest` 验证策略锦标赛回归仍通过。该节点填补 `P4 策略锦标赛升级` 中“正式行业/市值缓存接入后，扫描前不知道覆盖率是否足以支撑可信分组”的缺口。

状态：部分完成。当前已具备覆盖率审计和前端查看能力；剩余 P4 缺口是按覆盖率缺口触发可取消的批量事实集预热、真实全 A 长窗口样本、PostgreSQL/worker 性能验收和持仓建议证据联动。

最新同步 2026-05-25：P4.23 正式行业/市值缓存接入第一段完成。进入本节点前复验 P4.22：后端 TypeScript、前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。独立评审结论：本节点不把实时外部网络调用放进回测主路径，而是优先读取已经由股票事实集缓存沉淀的东方财富行业板块、总市值和流通市值，保证策略锦标赛仍可复现、可降级。实现后全 A universe 会通过 `StockFactSetCache` 补充 `officialIndustryGroup / officialIndustryCode / totalMarketCap / floatMarketCap / metadataAsOf / metadataWarnings`；分组稳定性优先使用 `eastmoney_fundamental_cache`，并在 `groupMetadata` 中记录 `asOf` 和 `sourceRefs`。缺少缓存时继续降级到资产元数据、名称关键词、成交额代理或占位规则，并保留 warning。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证正式行业/市值缓存优先于启发式分组，且 `sourceRefs` 指向 `em_industry_board / em_total_market_cap`；`npm run test:screener-service` 验证持久化回测报告链路仍通过。该节点填补 `P4 策略锦标赛升级` 中“分组血缘已有，但正式行业/市值事实尚未进入选股回测分组”的缺口。

状态：部分完成。当前已经支持使用本地股票事实集缓存中的东方财富行业和市值事实；仍需补齐批量事实集预热覆盖率、真实全 A 长窗口样本、正式 PostgreSQL/worker 性能验收，以及把分组通过/失败结论联动到持仓建议 `strategyEvidence`。

最新同步 2026-05-25：P4.22 分组元数据血缘第一段完成。进入本节点前复验 P4.21：后端 TypeScript、前端 TypeScript、`npm run test:strategy-tournament-backtest` 和 `target-architecture-gap.drawio` 读取均通过。独立评审结论：当前不直接接入新的外部行业/市值 provider，避免把网络不稳定带入核心回测；先把现有分组结果显式标注为可审计元数据，防止启发式行业/市值代理被误读为正式数据源。实现后每笔样本新增 `groupMetadata`，包含 `schemaVersion=fams.screener.group_metadata.v1`，并为市场板块、行业分组、市值/流动性代理、市场状态分别记录 `value / provider / method / confidence / warnings`。`groupStabilityValidation` 的每个维度新增 `providerSummary / averageConfidence`，每个分组桶新增 `provider / method / confidence / warnings`；`sample_trades.csv` 同步新增 provider 与分组置信度字段；任务中心分组稳定性预览展示 provider 汇总和置信度。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证样本 `groupMetadata`、分组维度 providerSummary、分组桶 provider/confidence；`npm run test:screener-service` 验证持久化回测报告仍包含分组稳定性。该节点填补 `P4 策略锦标赛升级` 中“分组稳定性有结果但缺少来源、方法和可信度说明”的缺口。

状态：部分完成。当前行业分组仍可能来自名称关键词或占位规则，市值分组仍使用成交额代理；这些字段现在已明确 warnings。后续 P4 继续接入正式行业分类、总市值/流通市值数据源，并做真实全 A 长窗口样本与 worker/PostgreSQL 性能验收。

最新同步 2026-05-24：P4.19-P4.21 分组稳定性、长期样本验收入口和产物链路收口完成。进入本节点前复验 P4.18：后端 TypeScript、前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过。统一评审 P4 剩余开发计划后确认：未来 P4 不新增选股策略，优先补齐策略可信度的横截面审计、长期样本门槛和任务中心验收产物。实现后每笔回测样本记录 `marketSegment / industryGroup / marketCapGroup / marketRegime`，每个 `TournamentCandidate` 新增 `groupStabilityValidation`，按市场状态、市场板块、行业分组、市值/流动性代理四个维度输出分组样本、胜率、平均收益、超额收益、最大回撤、状态和 warnings。Operation 产物新增 `group_stability_report.json`，`leaderboard / strategy_metrics / strategy_manifest / reviewReportJson / auditHash` 均写入该验证结果；`sample_trades.csv` 新增分组上下文字段，任务中心新增“分组稳定性”产物导航和可视化预览。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证分组稳定性 schema、四类维度、样本分组上下文字段和分组 warnings；`npm run test:screener-service` 验证分组稳定性进入持久化回测报告；任务中心前端类型检查通过。该节点填补 `P4 策略锦标赛升级` 中“策略只按总体样本排名，无法判断是否只在单一市场状态、板块、行业或流动性分组有效”的缺口。

状态：部分完成。P4 主体证据链已经覆盖可信回测、版本审计、样本外、walk-forward、参数敏感性、执行矩阵和分组稳定性。P4 剩余工作不再扩大策略数量，集中在真实全 A 长窗口样本、PostgreSQL/worker 性能验收、真实行业与市值数据源替代当前启发式分组、以及把通过/失败结论进一步联动到持仓建议 `strategyEvidence`。

最新同步 2026-05-24：P4.16-P4.18 移动止盈、仓位策略矩阵和执行矩阵收口完成。进入 P4.16 前复验 P4.15：后端 TypeScript、前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `target-architecture-gap.drawio` 读取均通过，未发现阻塞或重要问题。P4.16 独立评审后只新增固定 `8%` 移动止盈退出策略，P4.17 独立评审后只新增保守 `volatility_scaled_notional` 仓位策略，第一段不做组合再平衡、不放大仓位。实现后 `executionMatrix` 扩展为三类信号策略 × 2 个入场策略 × 3 个持有周期 × 3 个退出策略 × 2 个仓位策略，默认 108 个 `TournamentCandidate`。`versionBundle.exitPolicy` 新增 `exit.trailing_stop.v1`，`versionBundle.positionSizingPolicy` 新增 `sizing.volatility_scaled_notional.v1`，样本交易记录 `entryReason / exitReason / positionSizingReason / notional / positionSizeMultiplier`，任务中心策略卡、执行矩阵和样本交易表展示入场、退出和仓位三类执行口径。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 36 个执行策略、108 个候选组合、移动止盈提前退出、波动率缩放本金不超过基准本金、版本束和样本原因字段；`npm run test:screener-service` 验证候选组合持久化、`candidateId`、`executionMatrix` 和回测报告链路。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“退出策略缺少移动止盈、仓位策略只有等额本金、执行矩阵未完整呈现入场/退出/仓位组合”的缺口；P4 仍需更长期样本、按市场状态/行业/市值分组和 PostgreSQL/worker 级别性能验收。

最新同步 2026-05-24：P4.15 入场策略矩阵第一段完成。进入本节点前先复验 P4.14：后端 TypeScript、前端 TypeScript、`npm run test:strategy-tournament-backtest`、`npm run test:screener-service` 和 `docs/target-architecture-gap.drawio` 读取均通过，未发现阻塞或重要问题；P4.15 独立评审结论是只补 `T+1开盘买入 / T+1收盘买入` 两个可审计入场口径，暂不引入突破价和回踩价，避免扩大策略变量。实现后 `executionMatrix` 从 18 个候选组合扩展为三类信号策略 × 2 个入场策略 × 6 个退出策略，默认 36 个 `TournamentCandidate`。`versionBundle.entryPolicy` 可区分 `entry.t1_open.v1` 与 `entry.t1_close.v1`，止损止盈阈值按实际入场价计算，`sample_trades.csv` 新增 `entryReason`，任务中心策略卡、执行矩阵和样本交易表展示入场策略。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；前端 Vite 构建通过；`npm run test:strategy-tournament-backtest` 验证 12 个入场/退出执行策略、36 个候选组合、T+1 开盘/收盘入场版本、不同入场价和样本 `entryReason`；`npm run test:screener-service` 验证候选组合持久化、`candidateId`、`executionMatrix`、`entryReason` 和回测报告链路。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“入场策略只有 T+1 开盘价，无法比较收盘确认入场口径”的缺口；下一步补移动止盈、仓位策略和完整执行策略版本矩阵。

最新同步 2026-05-24：P4.14 止损止盈退出策略矩阵第一段完成。在 P4.13 的策略 × 执行策略矩阵上继续扩展退出策略：每个持有周期同时生成固定持有版本和 `止损5% / 止盈10%` 版本，三类内置信号策略 × 6 个执行策略默认形成 18 个 `TournamentCandidate`。止盈止损不是标签，而是在回测样本中逐日扫描入场后的 K 线，高点触发止盈、低点触发止损时提前退出，并记录 `exitReason`；同日同时触发时按保守顺序先止损。`versionBundle.exitPolicy` 可区分 `exit.hold_n.close.v1` 与 `exit.stop_take_profit.v1`，`sample_trades.csv` 新增退出原因，任务中心样本交易表展示执行策略与退出原因。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 6 个执行策略、18 个候选组合、固定持有口径不变、止盈样本提前退出并记录止盈原因；`npm run test:screener-service` 验证候选组合持久化、`candidateId`、`executionMatrix`、`StrategyVersion` 和回测报告链路。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“退出策略只有固定持有，无法比较止损止盈执行方式”的缺口；下一步补入场策略、移动止盈、仓位策略和完整执行策略版本矩阵。

最新同步 2026-05-24：P4.13 策略 × 执行策略组合矩阵第一段完成。`strategyTournament` 不再只按“每个信号策略一种执行假设”排名，而是生成 `executionMatrix`：三类内置信号策略分别与 3 个退出持有周期组合，默认形成 9 个 `TournamentCandidate`。第一段保持入场策略、成本模型和市场约束不变，只比较 `基准持有N日 / 短持有N-1日 / 长持有N+2日` 三种退出策略，避免同时扩大过多变量。每个排名项新增 `candidateId` 和 `executionPolicy`，`auditHash / versionBundle / StrategyVersion / BacktestResult.reviewReportJson / leaderboard.json / strategy_manifest.json` 均可追溯到具体候选组合；Operation 产物新增 `execution_matrix.json`，任务中心 artifact 导航和可视化补充“执行矩阵”入口。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 `executionMatrix` schema、3 个执行策略、9 个候选组合、基准候选 `a_flush_sideways_volume__exit_h3` 和 T+1/持有 3 日口径仍正确；`npm run test:screener-service` 验证候选组合持久化、`candidateId`、`executionMatrix`、`StrategyVersion` 和回测报告链路。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“策略与执行策略没有拆开比较，排行榜无法说明收益来自信号还是持有周期”的缺口；下一步继续补入场策略、止损止盈/移动止盈退出策略、仓位策略和完整执行策略版本矩阵。

最新同步 2026-05-22：P4.12 更大参数网格第一段完成。`strategyTournament` 的参数敏感性从 `local_threshold_grid_v1` 升级为 `local_threshold_grid_v2`，不新增策略类型，只扩大现有策略阈值组合验证：A 杀/平台突破按 `lastTwoVolumeRatio × sidewaysRangePercent` 生成 3×3 网格，均线收复按 `reclaimVolumeRatio × drawdownPercent` 生成 3×3 网格，base 变体固定作为对照，并按阈值去重。每个策略默认输出 9 个参数组合，继续沿用同一批 K 线、同一 T+1 执行、同一成本模型和同一市场约束，避免把参数扫描误当成新策略开发。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 `local_threshold_grid_v2`、9 个组合变体、base 变体和二维组合 id；`npm run test:screener-service` 验证持久化锦标赛结果仍通过。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“参数敏感性网格太小、主要是一维扰动，难以观察两个关键阈值组合稳定性”的缺口；下一步进入策略 × 执行策略组合矩阵。

最新同步 2026-05-22：P4.11 正式策略版本表第一段完成。新增 `StrategyVersion` 表，把原来只保存在 JSON 里的 `SignalStrategy / EntryPolicy / ExitPolicy / PositionSizingPolicy / PortfolioPolicy / CostModel / MarketConstraint / Engine` 版本束落库，并用 `strategyId + auditHash` 做唯一约束。策略锦标赛持久化时会创建或复用对应 `StrategyVersion`，`BacktestResult.reviewReportJson`、`strategy_manifest.json`、`leaderboard.json` 和 `Strategy.parameters` 均写入 `strategyVersionId` 或 latest 版本引用，为后续策略 × 执行策略组合矩阵提供稳定主键。

验证：Prisma `db push/generate` 完成；后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 验证每个排名项都有 `persistedStrategyVersionId`，并能查到 `StrategyVersion.auditHash / versionBundleJson`；`npm run test:strategy-tournament-backtest` 通过。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“版本束只有 JSON 审计字段、没有正式版本表和稳定主键”的缺口；仍需更大参数网格和策略 × 执行策略组合矩阵。

最新同步 2026-05-22：P4.10 artifact 交叉跳转第一段完成。任务中心打开任一 `operation_artifact` 后，弹窗顶部新增“同批次产物导航”，从当前 `operation_artifact:<operationId>:<filename>` 中解析同一批次 operationId，并生成 `leaderboard / strategy_metrics / sample_trades / equity_curve / drawdown_curve / out_of_sample / walk_forward / parameter_sensitivity / strategy_manifest` 的快捷跳转。深链打开单个产物时也能直接跳转到同批次相关产物，当前产物会高亮。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过。该节点不改变后端回测计算口径和 artifact 格式，只增强任务中心 artifact 之间的导航体验。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“产物之间需要手动返回任务详情再查找，证据链验收割裂”的缺口；仍需正式策略版本表、更大参数网格和策略 × 执行策略组合矩阵。

最新同步 2026-05-22：P4.9 参数敏感性二维热力图第一段完成。任务中心 `parameter_sensitivity.json` artifact 在原有变体列表基础上增加参数热力图：自动从各变体 `thresholds` 中识别相对 base 发生变化的参数，选择前两个变化参数作为 X/Y 轴；每个格子展示该参数组合的超额收益、成交数和变体 ID，颜色按超额收益分层。若只有一个参数变化，则降级为单轴热力条。该视图用于快速识别策略是否只依赖单一阈值。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过。该节点不改变后端回测计算口径和 artifact 格式，只增强 `parameter_sensitivity.json` 的前端验收视图。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“参数敏感性只有列表，无法直观看阈值组合稳定性”的缺口；仍需 artifact 之间的交叉跳转、正式策略版本表和更大参数网格。

最新同步 2026-05-22：P4.8 样本交易结构化验收第一段完成。任务中心的 `sample_trades.csv` artifact 不再只展示原始文本，而是解析为结构化表格：按策略、标的、信号日、入场日、退出日、入场价、退出价、毛收益、净收益、成本、盈利状态和阻断原因展示；顶部汇总记录数、可执行样本、阻断样本和盈利样本。原始 CSV 仍保留在表格下方，便于审计和排查解析差异。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过。该节点不改变后端回测计算口径和 artifact 格式，只增强 `sample_trades.csv` 的前端验收视图。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“样本交易只能读 CSV 文本，无法快速核对可执行/阻断样本、收益和成本”的缺口；仍需二维参数热力图、artifact 之间的交叉跳转和正式策略版本表。

最新同步 2026-05-22：P4.7 策略锦标赛 artifact 深链路可视化第一段完成。任务中心的 `operation_artifact` 弹窗可按产物类型识别并渲染可读预览：`leaderboard.json / strategy_metrics.json` 展示策略排行、可信度、成交数、胜率、超额收益、最大回撤和权益/回撤曲线；`equity_curve.json / drawdown_curve.json` 展示多策略曲线；`out_of_sample_validation.json / walk_forward_validation.json` 展示验证状态、样本外超额收益、通过窗口和 warnings；`parameter_sensitivity.json` 展示稳定变体、基准超额收益和前三个参数变体；`strategy_manifest.json` 展示策略/执行/成本/约束版本；`sample_trades.csv` 展示样本交易行数和前几条记录。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过。该节点不改变后端回测计算口径，只增强已生成 artifact 的前端验收视图。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“任务中心 artifact 只能查看原始 JSON，无法直接验收策略排行、曲线、样本外、walk-forward、参数敏感性和样本交易”的缺口；仍需更完整的交互式曲线、二维参数热力图、样本交易结构化表格和 artifact 之间的交叉跳转。

最新同步 2026-05-22：P4.6 回测曲线前端可视化第一段完成。`strategyTournament.ranked` 直接返回 `equityCurve`，包含权益值和回撤百分比；持久化回测报告和 `leaderboard.json` 同步写入该曲线。前端 AI 选股策略卡新增轻量 SVG 迷你曲线，用绿色展示权益变化、红色展示回撤变化；参数敏感性区域补充前三个参数变体的成交数和超额收益，便于快速识别结果是否依赖某个阈值。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证 `equityCurve` 和 `drawdownPercent` 字段；`npm run test:screener-service` 验证三策略回归和持久化仍通过。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“前端只能看离散数字，无法直观看权益/回撤形态和参数变体”的缺口；仍需更完整的交互式曲线、参数热力图、样本交易明细展开和 artifact 深链路可视化。

最新同步 2026-05-21：P4.5 参数敏感性审计第一段完成。`strategyTournament` 每个策略排名项新增 `parameterSensitivity`，采用 `local_threshold_grid_v1`，对现有策略关键阈值做小范围扰动，不新增策略类型：A杀/平台突破扰动成交量阈值和横盘振幅阈值，均线收复扰动修复量比和回撤阈值。每个变体在同一批 K 线、同一 T+1 执行、同一成本模型和同一市场约束下重新回测，输出样本数、可执行交易数、胜率、平均收益、超额收益、最大回撤和状态，并汇总 `stableVariantCount / totalVariants`。持久化回测报告、`leaderboard.json`、`strategy_manifest.json` 新增该字段，Operation 产物新增 `parameter_sensitivity.json`；前端策略卡展示参数稳健/敏感/样本不足状态、稳定变体数和 base 超额收益。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证参数敏感性 schema、5 个参数变体和 base 变体；`npm run test:screener-service` 验证持久化报告包含 `parameterSensitivity`。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“策略结果是否依赖单一阈值不可见”的缺口；仍需更大的参数网格、二维热力图、参数不敏感性评分和前端可视化矩阵。

最新同步 2026-05-21：P4.4 walk-forward 稳定性审计第一段完成。`strategyTournament` 每个策略排名项新增 `walkForwardValidation`，采用 `chronological_3_window_split` 将可执行样本按信号日期切成 3 个连续窗口，每个窗口独立输出样本数、胜率、平均收益、基准收益、超额收益和窗口状态，并汇总 `passedWindows / totalWindows`。样本不足 30、可用窗口少于 2 或通过窗口不足时返回 warnings，仍不提升策略可信度。持久化回测报告、`leaderboard.json`、`strategy_manifest.json` 新增该字段，Operation 产物新增 `walk_forward_validation.json`；前端策略卡展示滚动窗口状态、通过窗口数、最近窗口超额收益和 warnings。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证单样本不足、3 窗口结构和 5 样本窗口切分；`npm run test:screener-service` 验证持久化报告包含 `walkForwardValidation`。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“策略跨时间窗口稳定性不可见”的缺口；仍需更长周期 walk-forward、窗口参数可配置、按市场状态/行业/市值分组、参数敏感性热力图和前端曲线可视化。

最新同步 2026-05-21：P4.3 样本外验证第一段完成。`strategyTournament` 每个策略排名项新增 `outOfSampleValidation`，采用按信号日期排序的 `chronological_70_30_split`：前 70% 可执行样本作为训练窗口，后 30% 作为样本外窗口，分别输出样本数、胜率、平均收益、基准收益和超额收益。样本不足 30 或样本外窗口不足 10 时明确标记 `insufficient` 并写入 warnings，避免把短窗样本包装成稳定策略。持久化回测报告、`leaderboard.json`、`strategy_manifest.json` 新增该字段，Operation 产物新增 `out_of_sample_validation.json`；前端策略卡展示样本外状态、样本外交易数、样本外超额收益和 warnings。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证单样本为 `insufficient`、5 样本窗口产生训练/样本外切分；`npm run test:screener-service` 验证持久化报告包含 `outOfSampleValidation`。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“策略只在同一短窗内评价，没有样本外稳定性审计”的缺口；仍需真正的多窗口 walk-forward、样本外日期区间可配置、按市场状态/行业/市值分组稳定性和参数敏感性热力图。

最新同步 2026-05-21：P4.2 策略锦标赛版本化审计第一段完成。每个 `strategyTournament` 排名项新增 `versionBundle` 与 `auditHash`，把 `SignalStrategy / EntryPolicy / ExitPolicy / PositionSizingPolicy / PortfolioPolicy / CostModel / MarketConstraint / Engine` 绑定到同一候选组合，避免后续比较不同成交假设时污染结论。`Strategy.parameters`、`BacktestResult.reviewReportJson`、`leaderboard.json`、`backtest_assumptions.json` 均写入版本束和审计哈希；Operation 产物新增 `strategy_manifest.json`，用于批次级复核每个策略候选的版本、关键指标和可信度。前端策略排行展示策略版本、执行版本和审计哈希前缀。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:strategy-tournament-backtest` 验证版本束 schema、T+1 入场版本、退出版本、成本模型版本和 64 位 sha256 审计哈希；`npm run test:screener-service` 验证持久化回测报告包含 `versionBundle` 与 `auditHash`。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“回测结果缺少策略/执行/成本/约束版本绑定，难以复现同一批次结论”的缺口；仍未完成正式策略版本表、策略 × 执行策略组合矩阵、样本外验证、walk-forward、参数敏感性和前端曲线可视化。

最新同步 2026-05-21：P4.1 策略锦标赛可信回测第一段完成。AI 选股内置三类策略不新增策略类型，先把回测口径从“短窗胜率”升级为可审计执行假设：T 日收盘后生成信号、T+1 开盘买入、持有 N 个交易日后按收盘退出；回测扣除佣金、最低佣金、印花税和滑点；市场约束阻断 ST/退市风险、上市天数不足、停牌、成交额不足、T+1 涨停不可买、退出日跌停不可卖。`strategyTournament` 新增 `sampleSize / tradeCount / medianReturn / profitFactor / maxDrawdown / Sharpe / Sortino / Calmar / turnover / tailLossP95 / tailLossP99 / blockedSamples / assumptions`，Operation artifactRefs 扩展为 `sample_trades.csv / equity_curve.json / drawdown_curve.json / backtest_assumptions.json`。前端 AI 选股策略排行展示新增指标和“低可信策略仅进入观察池，不进入加仓建议”提示。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:screener-service` 通过，验证三类策略、T+1 样本、成本字段、持久化 Backtest/BacktestResult 和 assumptions；新增 `npm run test:strategy-tournament-backtest`、`npm run test:backtest-market-constraints`、`npm run test:backtest-cost-model`，覆盖 T+1 入场/退出日期、净收益低于毛收益、ST 排除、成交额不足、T+1 涨停不可买和单样本可信度必须为 `insufficient`。

状态：部分完成。该节点填补 `P4 策略锦标赛升级` 中“回测未扣费、未体现市场不可成交约束、缺少可审计执行假设和风险指标”的缺口；剩余缺口是 `SignalStrategy / EntryPolicy / ExitPolicy / PositionSizingPolicy / PortfolioPolicy / CostModel / MarketConstraint` 的正式版本化表、策略 × 执行策略组合锦标赛、样本外验证、walk-forward、参数敏感性和前端曲线可视化。

最新同步 2026-05-21：P5 调度状态可视化第一段完成。新增 `GET /api/v1/operations/schedulers/factset-refresh`，返回 `factsetRefreshScheduler` 当前配置、进程内运行状态、`SchedulerLease` 租约状态、`lastRunAt` 和 `lastResult`；任务中心新增“事实集后台调度”状态卡，展示启用状态、cron/时区、提前窗口、单批上限、是否避开交易时段、租约持有者、上次运行时间和上次结果。

验证：后端/前端 TypeScript 检查通过；HTTP 验证接口返回 `enabled=true / cron=*/15 * * * * / taskStarted=true / lease.locked=false / lastResult.operationId=c323ce70-d0fa-4db1-8edd-0a9ad3bd224c`；SQLite 完整性检查 `ok`。前端截图验证尝试被本机 Playwright 依赖缺失阻断：`libnspr4.so: cannot open shared object file`，本节点前端以 TypeScript 和运行态 API 校验为准。

状态：部分完成。该节点填补 `P5` 中“后台调度是否健康不可见”的缺口；仍缺前端截图复验、调度租约抢占审计明细、刷新策略配置页面、节假日交易日历、独立 worker 和 PostgreSQL 并发验收。

最新同步 2026-05-21：P5 调度租约第一段完成。新增 `SchedulerLease` 表，`factsetRefreshScheduler` 每次 tick 前先抢占 `factset_refresh` 租约，写入 `leaseOwner / leaseExpiresAt / heartbeatAt`；抢不到租约时返回 `scheduler_lease_not_acquired` 并跳过，tick 完成后释放租约并记录 `lastRunAt / lastResultJson`。该机制防止多后端实例同时扫描并提交重复的到期事实集刷新任务。

验证：Prisma `db push/generate` 完成；后端 TypeScript 检查通过；`npm run test:factset-refresh-scheduler` 通过，覆盖交易时段跳过、有效调度租约阻止 tick、租约释放后盘后提交 Operation `c323ce70-d0fa-4db1-8edd-0a9ad3bd224c` 并完成。后端重启后运行在 `http://localhost:4000`，日志显示 `Factset refresh scheduler started`；前端仍运行在 `http://localhost:3000`。

状态：部分完成。该节点填补 `P5` 与 `GAP-7` 中“cron 多实例重复 tick”的缺口；仍缺独立 worker 进程、调度租约抢占审计页面、节假日交易日历、刷新窗口策略配置页面、item 级断点续跑和 PostgreSQL 并发验收。

最新同步 2026-05-21：P5 到期事实集 cron 调度器第一段完成。新增 `factsetRefreshScheduler`，服务启动后按 `FAMS_FACTSET_SCHEDULER_CRON` 定时调用到期事实集扫描，默认每 15 分钟运行一次，`timezone=Asia/Shanghai`，默认用户 `default`，提前窗口 60 分钟，单批上限 20。调度器默认避开 A 股交易时段 `09:15-15:30`，只提交 `createdBy=scheduler` 的 `batch_factset_refresh` Operation，不直接刷新数据，因此继续复用 Operation 租约、心跳、恢复、取消和任务中心展示。

验证：后端 TypeScript 检查通过；新增 `npm run test:factset-refresh-scheduler`，验证北京时间交易时段会返回 `trading_window` 跳过，盘后会提交 scheduler Operation `3bccf010-841c-47d1-ba70-6ebcb4bd7b90` 并完成。后端重启后运行在 `http://localhost:4000`，日志显示 `Factset refresh scheduler started`，配置为 `*/15 * * * * / Asia/Shanghai / limit=20 / allowTradingHours=false`。

状态：部分完成。该节点填补 `P5` 中“只有手动触发到期刷新、没有后台定时器”的缺口；仍缺独立 worker 进程、调度租约防多实例重复 tick、节假日交易日历、刷新窗口策略配置页面和 PostgreSQL 并发验收。

最新同步 2026-05-21：P5 到期事实集刷新调度第一段完成。新增 `scheduleDueFactsetRefresh` 和 `POST /api/v1/operations/refresh-due-factsets`，可扫描 `PositionAdviceCache / StockFactSetCache` 中缺失、stale、failed、partial、`nextRefreshAfter` 到期或持仓更新时间晚于缓存生成时间的事实集；支持 `scope`、`horizonMinutes`、`limit`、`submit=false` 只预览、`force=true` 强制绕过活跃任务检查。若存在到期事实集且没有活跃刷新任务，系统会提交 `createdBy=scheduler` 的 `batch_factset_refresh`。任务中心新增“刷新到期事实集”按钮。

验证：后端/前端 TypeScript 检查通过；新增 `npm run test:due-factset-refresh`，把一条持仓建议缓存置为过期后成功提交 Operation `dd94ce24-ba34-4f00-be08-55308db95a9a`，`createdBy=scheduler`，`position_advice.refresh successCount=1 / failureCount=0`。后端重启后运行在 `http://localhost:4000`，HTTP 预览验证 `/refresh-due-factsets submit=false` 返回到期持仓建议 `009725 / reason=refresh_due` 且不提交任务；SQLite 完整性检查 `ok`。

状态：部分完成。该节点填补 `P5 持仓研究面板缓存化` 中“缓存到期后只能被动刷新、缺少调度入口和预览能力”的缺口；仍缺真正的 cron/worker 定时器、刷新窗口策略、item 级断点续跑、前端到期清单明细展示和 PostgreSQL 并发验收。

最新同步 2026-05-21：P5 Operation 租约与心跳第一段完成。`Operation` 新增 `leaseOwner / leaseExpiresAt / heartbeatAt`，`batch_factset_refresh` 执行时必须先获取租约，进度更新会续租并刷新心跳；完成、失败或取消时释放租约。服务启动恢复只接管 `queued`、无租约或租约已过期的事实集刷新任务，有效租约任务会跳过，避免多进程重复恢复同一个任务。

验证：Prisma `db push/generate` 完成；后端 TypeScript 检查通过；`npm run test:operation-recovery` 通过，验证过期租约任务可恢复、有效租约任务不会被接管、恢复完成后租约释放。运行态 HTTP 新建 Operation `b5656d4f-d29b-4730-843a-9b5d09b1e12c`，最终 `status=completed / progress=100 / position_advice.refresh success=1 / failed=0`，`leaseOwner=null / leaseExpiresAt=null / heartbeatAt` 保留最后心跳；SQLite 完整性检查 `ok`。

状态：部分完成。该节点填补 `P0 Operation 状态机` 与 `GAP-7 异步任务骨架` 中“多进程恢复缺少互斥、running 任务缺少心跳”的缺口；仍缺独立 worker 进程、租约抢占审计、item 级断点续跑、定时刷新调度和 PostgreSQL 正式并发验收。

最新同步 2026-05-21：P5 Operation 恢复第一段完成。`batch_factset_refresh` 支持服务启动后恢复 `queued/running` 状态的未完成任务，写入 `recoveryJson`，并按 `skip_completed_phase_tasks` 策略跳过已经完成的阶段任务，继续执行未完成的 `position_advice.refresh / stock_factset.refresh`。当前恢复范围只覆盖事实集批量刷新，避免价格刷新、交易影响类任务在重启后产生重复副作用。

验证：后端 TypeScript 检查通过；新增 `npm run test:operation-recovery`，模拟一个 `running` 的 `batch_factset_refresh` 后调用恢复逻辑，Operation `d7a71d5e-d3bc-4dca-bdea-1f1efd8f3d4a` 恢复并完成，`position_advice.refresh successCount=1 / failureCount=0`，`recovery.reason=server_startup`。后端重启后运行在 `http://localhost:4000`，接口查询该 Operation 返回 `status=completed / progress=100 / recovery.resumePolicy=skip_completed_phase_tasks`；前端仍运行在 `http://localhost:3000`。

状态：部分完成。该节点填补 `P0 Operation 状态机` 与 `P5 持仓研究面板缓存化` 中“进程重启后 running 任务无法接回”的缺口；跨进程 worker、并发租约、心跳超时、定时刷新和 item 级断点续跑仍待后续完成。

最新同步 2026-05-20：P5 批量事实集刷新 Operation 第一段完成。新增 `batch_factset_refresh` Operation 和 `/api/v1/operations/refresh-factsets`，支持 `scope=all / position_advice / stock_factset`、`symbols` 过滤和 `limit` 控制；子任务分为 `position_advice.refresh` 与 `stock_factset.refresh`，逐项记录成功数、失败数、耗时、provider、warnings 和失败详情。任务中心新增“刷新事实集”入口，前端可查看进度、取消、partial success、失败原因和结果入口；股票事实集刷新增加单标的 60 秒超时，防止慢 provider 长时间占用任务。

验证：后端/前端 TypeScript 检查通过；HTTP 端到端验证 Operation `b2959557-bea6-41e7-87b2-71a77eafb856` 以 `scope=position_advice / limit=3` 完成，`successCount=3 / failureCount=0`；Operation `521b8b6c-a1d0-4707-b2e1-2ab1bf5dac62` 以 `scope=stock_factset / symbols=601127` 完成，`successCount=1 / failureCount=0`。截图 `.verification/operations-factset-refresh-button.png` 验证任务中心“刷新事实集”按钮和完成记录可见。

状态：部分完成。该节点填补 `P5` 与 `GAP-7` 中“事实集只能同步或进程内后台刷新、用户无法看到批量刷新进度和失败原因”的缺口；跨进程 worker、定时刷新策略、任务恢复后的继续执行和更细粒度 artifact 文件仍待后续完成。

最新同步 2026-05-20：P5 持仓建议缓存第一段完成。新增 `PositionAdviceCache`，缓存 `position.advice.factset.v1`、确定性建议、证据引用、provider trace、warnings、`fresh/stale/failed/partial` 状态和 `nextRefreshAfter`；`/api/v1/analysis/position-advice` 与 `/api/v1/analysis/holdings-research` 默认优先读取缓存，支持 `forceRefresh=true` 强制刷新。前端持仓研究面板展示缓存状态和下次刷新时间。

验证：Prisma `db push/generate` 完成；后端和前端 `node node_modules/typescript/bin/tsc --noEmit` 均通过；`npm run test:position-advice` 通过。HTTP 首次 `forceRefresh=true` 返回 22 条建议且 `cache.refreshed=true`，随后普通查询返回 `cache.status=fresh / refreshed=false`；持仓研究接口返回 22 条并带缓存信息。Windows Chrome 截图 `.verification/analysis-position-advice-cache-restarted.png` 验证前端显示“缓存新鲜”，无明显文字重叠。

异常与恢复：验证时发现 SQLite 当前 `dev.db` 返回 `database disk image is malformed`。已先备份到 `backend/prisma/backups/`，再新建干净 Prisma 数据库并逐表迁移可读数据。恢复结果保留 `User=1 / Asset=29 / Position=22 / Transaction=7 / BacktestResult=33 / MarketBarRaw=2869 / MarketBarCanonical=2861`，`MarketSnapshot` 有 14 条损坏快照未恢复；新库 `PRAGMA integrity_check=ok`。该问题再次证明后续正式验收前应迁移 PostgreSQL/队列 worker，SQLite 仅适合当前本地开发。

状态：部分完成。该节点填补 `P5 持仓研究面板缓存化` 中“持仓页实时生成建议、无法标记数据新鲜度和失败状态”的缺口；`stock_factset_cache`、后台 stale-while-revalidate、事实集批处理 Operation、market regime/行业集中度和 P4 可审计策略证据仍待后续完成。

最新同步 2026-05-20：P5 股票事实集缓存第一段完成。新增 `StockFactSetCache`，缓存个股 full analysis、`stock.analysis.factset.v1`、三面汇总、evidenceRefs、providerTrace、warnings、fresh/failed 状态和下次刷新时间。`GET /api/v1/stocks/:code` 默认读取 fresh cache，支持 `forceRefresh=true` 强制刷新；前端个股分析页在事实集区展示“缓存新鲜/刚刷新”和下次刷新时间。新增 `npm run test:stock-factset-cache`，验证首次刷新写入缓存、第二次查询命中缓存，并保留技术面/基本面/消息面 facts。

验证：Prisma `db push/generate` 完成；后端和前端 TypeScript 检查通过；`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary`、`npm run test:fundamental-factset`、`npm run test:stock-factset-cache` 均通过。HTTP 验证 `601127 forceRefresh=true` 返回 `cache.refreshed=true`，后续普通查询返回 `cache.refreshed=false`，事实集数量为技术面 13、基本面 36、消息面 6。截图 `.verification/stock-analysis-factset-cache.png` 验证个股分析页显示“缓存新鲜”，无明显重叠。

状态：部分完成。该节点填补 `P5 持仓研究面板缓存化` 中“技术/基本面/消息面事实集不能复用缓存、个股页每次实时抓取外部数据源”的缺口；后台 stale-while-revalidate、批量事实集 Operation、缓存失效策略和持仓建议深度分析复用该缓存仍待后续完成。

最新同步 2026-05-20：P5 stale-while-revalidate 第一段完成。`PositionAdviceCache` 和 `StockFactSetCache` 在缓存过期但内容可解析时，不再阻塞页面等待外部 provider；接口会立即返回 `cache.status=stale` 的旧结果，并在后台触发一次去重刷新，刷新成功后恢复 `fresh`。该机制先用进程内去重队列实现，后续再升级为可查询、可取消的批量事实集 Operation。

验证：后端/前端 TypeScript 检查通过；`npm run test:position-advice` 覆盖持仓建议缓存从 `stale` 后台刷新回 `fresh`；`npm run test:stock-factset-cache` 覆盖 601127 股票事实集从 `stale` 后台刷新回 `fresh`，facts 仍为 13/36/6；SQLite 完整性检查 `ok`，缓存状态为 `StockFactSetCache fresh=1`、`PositionAdviceCache fresh=22`。

状态：部分完成。该节点填补 `P5` 中“过期缓存导致页面同步等待外部数据源”的缺口；Operation 化批量刷新第一段已完成，仍缺少跨进程 worker、定时刷新策略和更细粒度 artifact 文件。

最新同步 2026-05-19：全 A 选股异步化与历史行情缓存第一段完成。新增 `OperationTask`、`MarketBarRaw`、`MarketBarCanonical`、`ProviderHealth` 数据模型；全 A 扫描改为 `stock_screener_full_scan` Operation，并拆分为 `universe.snapshot / market_data.warmup / strategy.evaluate / backtest.aggregate / artifact.generate`。历史 K 线先查 canonical 缓存，不足时再拉 provider，raw 层保存原始 OHLCV、复权类型、抓取时间、质量 flags 和 payload hash，canonical 层保存策略/告警使用的标准 K 线、sourceRefs 和 dataVersion。

验证：后端与前端 `node node_modules/typescript/bin/tsc --noEmit` 均通过；Prisma `db push/generate` 完成。端到端小样本 Operation `07f2582e-cb22-4f13-98ec-79f14ac51535` 使用 `扫描上限=10；分片大小=5` 跑通，状态 `completed`，子任务全部落库，生成 5 个 artifactRefs：`leaderboard.json`、`candidate_list.json`、`strategy_metrics.json`、`data_quality_report.json`、`provider_health_report.json`。缓存表验证 `market_bar_raw=2209`、`market_bar_canonical=2200`；任务中心前端已新增全 A 选股扫描按钮、分片表、取消按钮、partial success、失败原因和产物入口。

状态：部分完成。该节点填补 `GAP-5 市场数据可靠性` 中“历史 K 线无本地缓存、provider 健康不可见”和 `GAP-7 异步任务骨架` 中“全 A 扫描不可取消、不可恢复、不可查询进度、无产物引用”的缺口。验证过程中发现 SQLite 并发写缓存会导致查询锁等待，已增加 WAL/busy_timeout、缓存写入串行队列和扫描并发上限；全量 5500 只扫描仍建议后续迁移 PostgreSQL/队列 worker 后再作为正式验收。

最新同步 2026-05-19：P0-P2 兼容增强第一段完成。Operation 增加 `progressCurrent / progressTotal / progressMessage / cancelRequested / errorSummary / recoveryJson`，前端支持 `succeeded / partial / cancelling` 兼容状态；OperationTask 增加 `taskType / attempt / maxAttempts / idempotencyKey / inputJson / outputJson`。`market_bar_raw` 与 `market_bar_canonical` 补充 `assetId / exchange / providerSymbol / timeframe / tradeTime / adjFactor / validationStatus / confidence / primaryProvider` 等审计字段；`provider_health` 补充 `endpoint / circuitState / cooldownUntil / window / request/error/badData/latency` 字段。

验证：Prisma `db push/generate` 通过；后端和前端 TypeScript 检查通过。端到端小样本 Operation `1cf3e0b6-e92f-4865-b868-4af12e24512f` 完成，返回 `progressCurrent=100`、`progressTotal=100`、`progressMessage=任务已完成`，5 个 task 均写入 `idempotencyKey`，`market_data.warmup` 记录 `cacheHitRate=31.14`；最新 raw/canonical K 线记录包含 `providerSymbol=000010`、`timeframe=1d`、`exchange=SZ`、`validationStatus=valid`、`primaryProvider=sina`、`confidence=1`。

状态：部分完成。该节点补齐了 P0-P2 的可审计字段和前端兼容展示，但正式 `partial/cancelling` 状态机、日期级增量缺口、endpoint 级 provider 统计、p95 latency、half-open 探测、PostgreSQL/worker 仍需后续完成。

## 约束

在本计划完成前，不启动新的开发主线。后续所有开发必须优先服务于“查询正确性、行情可靠性、账本一致性、分析可追溯性”。

如果新需求不属于本计划范围，必须先判断是否会影响查询正确性；不会提升正确性或可靠性的需求暂缓。

## 总目标

FAMS 必须先成为一个高正确、高可靠的资产查询与分析系统，再继续扩展更复杂的 Agent 编排和自动化能力。

## 核心定位与不可突破边界

FAMS 的正式定位是：

> 一个有数据血缘、有任务产物、有回测审计、有持仓约束的个人投资研究与决策系统。

FAMS 不是“AI 直接告诉用户买什么、卖什么”的系统。系统必须按以下链路工作：

```text
资产与持仓账本
  -> 行情与事实数据
  -> 技术面 / 基本面 / 消息面事实集
  -> 策略信号与回测证据
  -> 仓位管理引擎
  -> AI 解释与交易计划草案
  -> 人工确认
```

硬边界：

- LLM 不直接决定买卖。
- LLM 只解释结构化事实集、规则引擎、回测系统和仓位引擎给出的结论。
- 没有 `evidenceRefs` 的建议不得进入交易计划。
- 数据不足、provider 冲突、策略可信度 `low / insufficient` 时，不允许输出 `ADD`，只能输出 `OBSERVE / HOLD / NO_ACTION`。
- 交易影响动作必须进入人工确认节点，FAMS 当前阶段不开放自动交易。

核心目标：

- 查询结果正确：标的、类型、价格、持仓、盈亏、标签、建议引用的数据都能追溯。
- 错误可见：外部数据源失败时不能静默给错数据，必须明确显示来源、失败原因和置信度。
- 关键链路可验证：每个阶段都执行端到端验证，并同步更新 `target-architecture-gap`。
- AI 只能辅助：AI 分析必须基于已验证的数据快照，不能替代确定性数据校验。

## 四条主线

后续开发必须围绕四条主线推进，任何新增需求都要先归入其中之一，否则暂缓：

1. 仓位管理：判断当前组合风险是否合理，以及每个持仓应加仓、减仓、持有还是观察。
2. 已有持仓分析建议：解释每只持仓的建议依据、风险、触发条件、反证条件和证据引用。
3. AI 选股：从全市场筛出候选标的，但候选不得直接变成买入建议。
4. 策略回测：验证选股逻辑和执行逻辑过去是否有效，输出胜率、收益、回撤、样本量和可信度。

这四条线必须联动。例如：股票策略信号不错，但组合已重仓同一行业时，仓位引擎应阻止继续加仓；技术面走弱但仓位低、基本面未恶化时，建议可以是观察而不是立刻卖出。

## 后续阶段优先级锁定

在本计划完成前，后续开发按以下优先级推进：

### P0：Operation 状态机落库

目标：所有长任务都可持久化、可查询、可取消、可恢复、可审计。

范围：

- 完善 `operations / operation_tasks`。
- Operation 状态覆盖 `queued / running / succeeded / failed / cancelling / cancelled / partial`。当前系统已有 `queued / running / completed / failed / cancelled`，后续需要补齐 `cancelling / partial` 或建立兼容映射。
- 增加 `progress_current / progress_total / progress_message / cancel_requested / error_summary`。
- 所有长任务必须返回 `operation_id` 和 `artifactRefs`。
- 支持失败重试、partial success、分片任务幂等键和恢复。

优先 Operation 化：

- AI 选股全 A 扫描。
- `strategyTournament`。
- `market_data.warmup`。
- 批量事实集生成。
- 持仓建议批处理。

当前状态 2026-05-19：部分完成。AI 选股全 A 扫描已改为 `stock_screener_full_scan` 父 Operation + 子任务分片；任务中心可查看分片、取消、失败原因和产物。剩余缺口是正式状态枚举、恢复语义、幂等键、partial 状态、后台 worker 和数据库并发能力。

### P1：历史 K 线缓存和增量更新

目标：全 A 扫描不再每次实时拉全量外部 K 线，策略和告警只读标准行情层。

必须使用两层模型：

- `market_bar_raw`：保存 provider 原始数据，用于血缘和审计。
- `market_bar_canonical`：保存策略、告警和分析使用的标准行情。

raw 层字段目标：

- `asset_id / market / exchange / symbol / provider / provider_symbol`
- `timeframe / trade_date / trade_time`
- `open / high / low / close / volume / amount`
- `turnover_rate / adj_factor / adjustment_type`
- `currency / timezone`
- `is_suspended / limit_up / limit_down`
- `source_timestamp / fetched_at / http_status / request_id`
- `raw_payload_hash / raw_payload_ref`
- `quality_flags / validation_status`

canonical 层字段目标：

- `asset_id / timeframe / trade_date / trade_time`
- `open / high / low / close / volume / amount`
- `adj_factor / adjustment_type`
- `primary_provider / source_refs`
- `consensus_score / confidence`
- `quality_flags / validation_status`
- `data_version`

要求：

- 扫描前检查缓存缺口，只拉缺失 K 线。
- 支持增量更新和 `data_version`。
- 记录 cache hit rate。
- provider 冲突不得静默覆盖 canonical。
- 停牌、涨跌停、缺失成交量必须进入质量 flags。

当前状态 2026-05-19：部分完成。已落地 raw/canonical 基础表、sourceRefs、dataVersion、payload hash、质量 flags、缓存命中率统计。剩余缺口是 `asset_id/timeframe/provider_symbol/adj_factor/停牌涨跌停/http_status/request_id/raw_payload_ref/consensus_score/confidence/validation_status` 的完整字段、真正“只拉缺口”的日期级增量、以及多 provider consensus。

### P2：Provider 健康、限速、熔断

目标：外部数据源失败时系统不崩、不假成功、不污染数据库。

范围：

- `provider_health`
- `provider_rate_limit`
- circuit breaker
- timeout / backoff / jitter
- provider 失败报告
- curl / axios 统一封装

provider 健康字段目标：

- `provider / endpoint / window_start / window_end`
- `request_count / success_count / timeout_count / error_4xx_count / error_5xx_count / bad_data_count`
- `avg_latency_ms / p95_latency_ms`
- `circuit_state / cooldown_until`

熔断规则：

- `closed`：正常调用。
- `open`：最近 2 分钟失败率超过 50%、或 p95 latency 超过 8 秒、或 bad data 超阈值，暂停该 provider 30-120 秒。
- `half_open`：冷却结束后只放少量探测请求，成功恢复 `closed`，失败继续 `open`。

多源验证原则：

- A 股日线主源可用 Sina / Eastmoney，复核源可用 Baostock / Tushare / AkShare。
- 收盘价差异超过 0.5% 标记 conflict。
- 成交量差异大但价格一致时降级为 warning。
- 基金官方净值优先，估值只能作为参考，不能覆盖正式 NAV。
- 黄金必须走独立资产类型，不能走股票行情 provider。
- 同一厂商不同接口只能算同厂复核，不能等同真正独立来源。

当前状态 2026-05-19：部分完成。已有 provider health、连续失败、退避、熔断和限速第一版。剩余缺口是按 endpoint 窗口统计、p95 latency、half_open、错误分类、统一 HTTP 封装和多源 canonical consensus。

### P3：PositionAdviceFactSet + PositionAdviceEngine

目标：解决“持仓建议依据是什么”，并把 AI 从决策者降级为解释者。

新增 `PositionAdviceFactSet`，schemaVersion 为 `position.advice.factset.v1`。

事实集结构目标：

```ts
type PositionAdviceFactSet = {
  schemaVersion: 'position.advice.factset.v1'
  portfolio: {
    totalMarketValue: number
    cashRatio: number
    stockRatio: number
    fundRatio: number
    goldRatio: number
    maxSinglePositionRatio: number
    targetCashRatio: number
    riskProfile: 'conservative' | 'balanced' | 'aggressive'
  }
  position: {
    assetId: string
    symbol: string
    name: string
    assetType: 'stock' | 'etf' | 'fund' | 'bond_fund' | 'gold' | 'cash'
    marketValue: number
    currentWeight: number
    targetWeight?: number
    costBasis: number
    currentPrice: number
    unrealizedPnl: number
    unrealizedPnlPct: number
    holdingDays?: number
  }
  market: {
    price: number
    priceTime: string
    provider: string
    confidence: number
    fallbackUsed: boolean
    warnings: string[]
  }
  technical: {
    trendScore: number
    momentumScore: number
    relativeStrengthScore: number
    volatilityScore: number
    liquidityScore: number
    supportResistance: { support: number[]; resistance: number[] }
    indicators: Record<string, unknown>
  }
  fundamental?: {
    valuationScore?: number
    qualityScore?: number
    growthScore?: number
    financialRiskScore?: number
    industryRank?: Record<string, number>
    warnings: string[]
  }
  news?: {
    sentimentScore: number
    eventRiskScore: number
    recentEvents: Array<{
      title: string
      eventType: string
      impact: 'positive' | 'neutral' | 'negative' | 'unknown'
      publishedAt: string
      evidenceRef: string
    }>
  }
  strategyEvidence: {
    matchedStrategies: string[]
    backtestSummary: Array<{
      strategyId: string
      sampleSize: number
      winRate: number
      avgReturn: number
      benchmarkReturn: number
      excessReturn: number
      confidence: 'high' | 'medium' | 'low' | 'insufficient'
    }>
  }
  blockedReasons: string[]
  evidenceRefs: string[]
}
```

`PositionAdviceEngine` 输出：

```ts
type PositionAdvice = {
  action: 'ADD' | 'REDUCE' | 'HOLD' | 'OBSERVE' | 'NO_ACTION'
  currentWeight: number
  targetWeightRange: [number, number]
  suggestedTradeRatio?: number
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
  reasons: string[]
  risks: string[]
  triggerConditions: string[]
  invalidationConditions: string[]
  evidenceRefs: string[]
  blockedReasons: string[]
}
```

决策公式：

```text
targetWeight =
  baseTargetWeight
  * marketRegimeMultiplier
  * signalMultiplier
  * riskPenaltyMultiplier
  * confidenceMultiplier
```

动作规则：

```text
delta = targetWeight - currentWeight

if blockedReasons.length > 0 -> NO_ACTION
else if confidence is low/insufficient -> OBSERVE
else if delta > minTradeWeightDiff -> ADD
else if delta < -minTradeWeightDiff -> REDUCE
else -> HOLD
```

硬规则：

- 数据不足、provider 冲突、策略可信度 `low / insufficient` 时，不允许输出 `ADD`。
- 单票仓位超上限、趋势破位、事件风险高时，可以输出 `REDUCE`。
- 没有足够证据时输出 `OBSERVE`，不得输出模板建议。

当前状态 2026-05-20：部分完成。已新增 `positionAdviceService` 和确定性 `PositionAdviceEngine`，支持批量和单持仓生成 `position.advice.factset.v1`，并通过 `/api/v1/analysis/position-advice` 查询。第一段已覆盖组合权重、持仓成本/收益、行情来源、技术评分、基本面/消息面边界、策略证据、`blockedReasons`、`evidenceRefs`、目标仓位区间和建议动作。持仓研究面板已接入该引擎，`/api/v1/analysis/holdings-research` 每条持仓返回 `positionAdvice`，前端展示动作、可信度、当前仓位、目标区间、交易幅度、策略证据、评分、阻断原因、风险和证据数量。

验证：后端 TypeScript 检查通过；前端 TypeScript 检查通过；`npm run test:position-advice` 验证 22 个持仓事实集，所有建议均包含证据引用，低可信或证据不足时不输出 `ADD`。运行态 HTTP 验证 `GET /api/v1/analysis/holdings-research?userId=default` 返回 22 条结果并带 `positionAdvice`，现金为 `NO_ACTION`，非现金样例 `009725` 因缺少策略证据返回 `OBSERVE / insufficient`。前端截图 `.verification/analysis-position-advice-holdings-layout-final.png` 验证持仓研究分区可见仓位建议引擎，证据不足时显示“证据不足”而不是 0% 目标仓位，卡片未出现明显文字重叠。

剩余缺口：策略证据仍依赖既有短窗回测结果，尚未达到 P4 的可审计策略锦标赛要求；持仓事实集已落入 `position_advice_cache` 第一段，但后台批量刷新、stale-while-revalidate、market regime、行业集中度和多源 provider 冲突仍需进一步结构化。

### P4：策略锦标赛升级

目标：从“规则策略短窗验证”升级为“可审计策略研究系统”。

策略必须拆分为：

- `SignalStrategy`
- `EntryPolicy`
- `ExitPolicy`
- `PositionSizingPolicy`
- `PortfolioPolicy`
- `CostModel`
- `MarketConstraint`

锦标赛候选定义：

```text
TournamentCandidate =
  SignalStrategyVersion
  + EntryPolicyVersion
  + ExitPolicyVersion
  + PositionSizingPolicyVersion
  + PortfolioPolicyVersion
  + CostModelVersion
  + MarketConstraintVersion
```

每次回测必须绑定：

- `strategy_version`
- `execution_policy_version`
- `universe_snapshot_id`
- `market_data_snapshot_id`
- `cost_model_version`
- `engine_version`
- `batch_id`

回测约束：

- 手续费、印花税、滑点、冲击成本。
- 涨停不能买，跌停不能卖，停牌不能交易。
- ST 过滤、成交额过滤、上市未满 N 天过滤。
- t 日收盘后生成信号，t+1 日才能买入，禁止未来函数。
- 回测日期必须使用当时 universe，禁止幸存者偏差。
- 记录所有参数组合，做样本外验证和 walk-forward，不能只展示第一名。

指标要求：

- `sampleSize / winRate / Wilson CI`
- `avgReturn / medianReturn / benchmarkReturn / excessReturn`
- `profitFactor / maxDrawdown / Sharpe / Sortino / Calmar`
- `turnover / tailLossP95 / tailLossP99`
- 按月份、市场状态、行业、市值、滚动窗口和参数敏感性输出稳定性分析。

可信度评级：

- `insufficient`：样本数小于 30、有效交易太少、数据缺失严重或没有基准。
- `low`：样本数 30-100、胜率置信区间很宽、超额收益不稳定、未扣费滑点或只在短窗口有效。
- `medium`：样本数大于 100、扣费滑点后超额收益为正、最大回撤可控、不同市场阶段不完全失效。
- `high`：样本数大于 300，多年份和样本外有效，walk-forward 有效，参数不敏感，扣费滑点后仍有超额收益，回撤和尾部亏损可接受。

硬规则：策略可信度 `low / insufficient` 时，不得进入加仓建议，只能进入候选观察。

当前状态 2026-05-24：部分完成。已有 `strategyTournament`、基准、Wilson CI、样本充分度、BacktestResult 持久化，并已完成可信回测第一段：T 日信号、T+1 开盘入场、持有 N 日收盘退出、佣金/最低佣金/印花税/滑点、ST/低流动性/停牌/涨跌停阻断、`sample_trades / equity_curve / drawdown_curve / assumptions` 产物和前端新增风险指标展示。P4.2 已把每个排名项绑定 `versionBundle` 和 `auditHash`，并生成 `strategy_manifest.json`；P4.3 已新增 70/30 时间顺序样本外验证和 `out_of_sample_validation.json`；P4.4 已新增 3 窗口 walk-forward 稳定性审计和 `walk_forward_validation.json`；P4.5 已新增本地阈值网格参数敏感性和 `parameter_sensitivity.json`；P4.6 已在前端展示权益/回撤迷你曲线和参数变体摘要；P4.7 已在任务中心 artifact 弹窗补充策略排行、曲线、验证、参数敏感性、版本清单和样本交易预览；P4.8 已把样本交易 CSV 转为结构化表格验收；P4.9 已把参数敏感性变体渲染为二维热力图；P4.10 已补充同批次 artifact 交叉跳转；P4.11 已新增正式 `StrategyVersion` 表并写入持久化回测；P4.12 已把参数敏感性升级为 3×3 二维组合网格；P4.13 已新增策略 × 执行策略组合矩阵第一段和 `execution_matrix.json`；P4.14 已补充止损止盈退出策略，矩阵扩展到 18 个候选组合，并在样本交易中记录 `exitReason`；P4.15 已补充 T+1 开盘/收盘入场策略矩阵，矩阵扩展到 36 个候选组合，并在样本交易中记录 `entryReason`；P4.16-P4.18 已补充移动止盈、波动率缩放仓位和完整执行矩阵第一段，矩阵扩展到 108 个候选组合。尚未完成更长期样本、按市场状态/行业/市值分组稳定性和 PostgreSQL/worker 级别性能验收。

### P5：持仓研究面板缓存化

目标：持仓页快速、稳定、可解释，不在页面实时生成完整三面分析。

新增缓存：

- `stock_factset_cache`
- `position_advice_cache`

字段目标：

- `asset_id`
- `factset_schema_version`
- `factset_type`
- `status`: `fresh / stale / generating / failed / partial`
- `summary_json`
- `facts_json`
- `evidence_refs_json`
- `provider_trace_json`
- `warnings_json`
- `generated_at`
- `stale_at`
- `next_refresh_after`

TTL：

- 技术面：每个交易日收盘后刷新，或行情变化后刷新。
- 基本面：财报、公告更新后刷新。
- 消息面：每 1-6 小时刷新，视 provider 成本而定。
- 组合建议：持仓变化、行情大幅变化、事实集更新后刷新。

当前状态 2026-05-20：部分完成。已新增 `PositionAdviceCache`，缓存 `position.advice.factset.v1`、确定性建议、summary、evidenceRefs、providerTrace、warnings、`generatedAt/staleAt/nextRefreshAfter` 和 `fresh/failed` 状态。已新增 `StockFactSetCache`，缓存个股 full analysis、`stock.analysis.factset.v1`、三面汇总、evidenceRefs、providerTrace、warnings 和刷新时间。`positionAdviceService` 与 `stockAnalysisService` 默认读取新鲜缓存，`forceRefresh=true` 强制重建；`holdings-research` 和个股分析页透出缓存状态，前端显示“缓存新鲜/刚刷新”和下次刷新时间。

验证：Prisma 同步和客户端生成通过；后端/前端 TypeScript 检查通过；`npm run test:position-advice` 与 `npm run test:stock-factset-cache` 通过；HTTP 验证 `forceRefresh=true` 后 22 条持仓建议写入缓存，后续普通查询返回 `cache.refreshed=false`；HTTP 验证 `601127` 股票分析第二次查询命中缓存；截图 `.verification/analysis-position-advice-cache-restarted.png` 与 `.verification/stock-analysis-factset-cache.png` 验证前端可见缓存状态。

剩余缺口：stale-while-revalidate、批量事实集生成 Operation、服务启动恢复、租约心跳、到期事实集调度入口、cron 定时器、调度租约和调度状态可视化均已完成第一段；仍缺少独立 worker、调度租约抢占审计明细、节假日交易日历、刷新窗口策略页面、item 级断点续跑和前端 partial/failed 细粒度状态。

前端逻辑：

- `fresh`：直接展示。
- `stale`：展示旧结果和“数据可能过期”，后台触发刷新。
- `missing`：展示正在生成。
- `failed / partial`：展示 warnings，不生成假结论。

任务优先级：

1. 当前持仓，按市值从高到低。
2. 自选 / watchlist。
3. AI 选股候选。
4. 全市场低优先级预热。

当前状态：待启动。

### P6：AI Agent 接入

目标：Agent 只能基于持仓和事实集生成交易计划草案。

未来 Agent 只能调用：

- `getPortfolioState`
- `getPositionAdviceFactSet`
- `getStockAnalysisFactSet`
- `runStrategyBacktest`
- `simulateRebalance`
- `generateTradePlan`
- `explainAdvice`

权限分级：

- Level 1：只读分析。
- Level 2：生成调仓计划草案。
- Level 3：生成待确认交易清单。
- Level 4：人工确认后写入交易记录。
- Level 5：自动交易，暂不开放。

当前阶段最多做到 Level 2 或 Level 3。Agent 可以生成建议计划、触发条件、风险说明、反证条件和待确认交易单，但不能自动下单。

当前状态：暂缓。必须等待 P0-P5 的事实集、任务产物、回测审计和仓位引擎稳定后再推进。

## 技术指标使用分层

技术指标不按“神奇指标”使用，而按用途分层。

高可信，主要用于仓位和风险控制：

- 市场状态：指数 MA60 / MA120 / MA250、指数回撤、市场宽度。
- 趋势：MA20 / MA60 / MA120、均线斜率、价格相对长期均线。
- 相对强弱：个股相对沪深300、中证全指、行业指数收益。
- 波动风险：ATR、历史波动率、最大回撤、下跌斜率。
- 流动性：成交额、换手率、量能稳定性。

中可信，主要用于择时和确认：

- MACD：趋势确认，但滞后明显。
- RSI：超买超卖和反弹观察，不能单独决定买卖。
- 布林带：波动区间和突破确认，趋势市容易连续失效。
- 成交量放大：突破确认或恐慌确认，需要区分放量突破和放量出货。
- 支撑压力：用于止损、止盈和分批计划，不做绝对预测。

低可信，只做弱参考：

- 单根 K 线形态。
- 孤立金叉/死叉。
- 短周期 KDJ。
- 没有成交量确认的突破。
- 没有基本面或消息面支持的概念热点。
- 单条新闻情绪。
- LLM 自己总结出的市场感觉。

## 加仓、减仓、持有、观察规则

加仓必须同时满足：

- 当前仓位低于目标仓位。
- 组合整体风险允许。
- 个股趋势没有破坏。
- 相对行业或指数仍然较强。
- 波动率和回撤可接受。
- 没有重大负面公告、财务风险或事件风险。
- 匹配策略历史回测至少达到 `medium` 可信。
- 加仓后不会导致单票或行业集中度过高。

减仓触发：

- 当前仓位超过目标仓位。
- 单票或行业集中度过高。
- 跌破关键趋势位。
- 相对行业或指数明显转弱。
- 波动率突然放大。
- 持仓收益回撤超过承受范围。
- 基本面或消息面出现重大负面变化。
- 回测显示当前形态后续收益较差。

持有条件：

- 仓位接近目标。
- 趋势未破坏。
- 风险可控。
- 没有更强动作依据。
- 策略证据中性或略正面。

观察条件：

- 数据不足。
- provider 冲突。
- 回测样本不足。
- 消息面不明确。
- 策略可信度 `low / insufficient`。
- 短期波动大但趋势未确认破坏。

`OBSERVE` 是正式动作，不是失败。系统必须敢于输出“当前没有足够证据支持加仓或减仓”。

## 暂缓事项

以下事项在 P0-P5 完成前不得作为主线：

- 更多花哨 LLM 分析。
- 更多未经回测的短线策略。
- 公告 PDF 深度抽取。
- 自动交易。
- 复杂 MCP / Agent 扩展。
- 纯新闻情绪选股。
- LLM 自主选股。

## 当前最高优先级

查询正确性优先于功能数量、响应花哨程度和 Agent 自动化。

当前最重要的问题不是继续扩展新工作流，而是把以下基础链路做稳：

- 标的识别是否正确。
- 价格是否来自正确 provider。
- 查询失败是否明确暴露。
- 旧价格、缓存价、实时价是否清楚区分。
- 前端展示是否和后端计算一致。
- AI 分析是否引用了正确标的和正确数据。

## 阶段 1：查询正确性基线

目标：所有查询先可信。

范围：

- 建立 `Asset Identity Resolver`。
- 统一标的识别规则：股票、ETF、基金、债券、黄金、现金不能混淆。
- 标准化代码、市场、类型、名称、本地资产匹配和外部 provider 校验。
- 查询结果必须返回可追溯字段：
  - `symbol`
  - `name`
  - `assetType`
  - `market`
  - `price`
  - `source`
  - `sourceTime`
  - `confidenceScore`
  - `warnings`
- 禁止“查不到就猜”。查不到必须返回失败或低置信度。

验收：

- 验证 `513770`、`601888`、`600276`、`000651`、现金类、基金类、债券类。
- 前端显示价格三位小数、来源、更新时间、失败原因。
- 每个查询结果能说明为什么识别成这个类型。

进度 2026-05-11：完成 `Asset Identity Resolver` 最小闭环。新增 `/api/v1/assets/resolve`，返回 `normalizedSymbol`、`assetType`、`market`、`exchange`、`currency`、`confidenceScore`、本地匹配、候选、识别证据和 warnings。`/api/v1/prices/realtime` 在未传 `assetType` 时先调用 resolver，并在外部行情超时时返回结构化失败、identity 和本地最近价兜底，禁止静默按股票处理。

验证：后端 `node node_modules/typescript/bin/tsc` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`/api/v1/assets/resolve` 验证 `513770=etf` 且提示本地 `stock` 类型冲突、`601888=stock/SH`、`600276=stock/SH`、`000651=stock/SZ`、`现金-现金-银行卡=cash/LOCAL`、`015311=fund/CN`、`009725=bond/CN`；`/api/v1/prices/realtime?symbol=513770` 返回 `assetType=etf`、`price=0.421`、`source=local_last_price`、实时超时 warning 和本地最近价兜底说明；`601888` 在无本地最近价时返回 `price=null` 与明确失败 warning。

状态：部分完成。基础 resolver 已落地，下一步需要把资产导入、分析建议、AI 选股和批量刷新全部接入同一 resolver，并补充自动化测试。

## 阶段 2：行情数据可靠性

目标：价格查询正确优先于速度。

范围：

- 建立 provider 优先级：
  - A 股 / ETF：Sina + Eastmoney 交叉校验。
  - 基金：Eastmoney / 天天基金。
  - 港股 ETF：独立通道。
  - 现金：本地固定值。
  - 债券 / 黄金：单独 provider 或手动价。
- 建立价格校验规则：
  - 多源价格偏差超过阈值时标记为 `degraded`。
  - 单源失败不覆盖旧正确价格。
  - 新价格异常跳变时要求人工确认或标记异常。
- 增加本地行情缓存：
  - 最新有效价。
  - provider 响应缓存。
  - 失败时可回退到“最近可信价”，但必须标明。

验收：

- `refresh-prices` 不再因为 provider 超时导致任务失败或长期 running。
- 价格失败项清楚显示 provider、错误类别、是否使用缓存。
- `513770` 当前价能显示 `0.421`，保留三位小数。

进度 2026-05-11：价格刷新接入“最近可信价兜底”，并修正刷新成功口径。`MarketDataService.refreshAssetMarketData` 在外部 provider 超时或空数据时，如果资产有 `lastPrice`，或持仓已有 `currentPrice / avgCost`，会保留本地价格用于页面展示，返回 `source=local_last_price`、`stale=true`、`fallbackUsed=true` 和明确 warning；但本地兜底不再计入刷新成功，只有外部实时行情命中才计入 `refreshed / realtimeRefreshed`。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`/api/v1/prices/realtime?symbol=513770` 返回 `price=0.429`、`source=sina`、`fallbackUsed=false`、行情时间 `2026-05-11 15:00:03` 北京时间；`POST /api/v1/operations/refresh-prices` 创建 Operation `ffccccac-58fd-4337-bed5-a76a855b8690`，轮询结果 `status=completed`、`progress=100`、`refreshed=9`、`failed=15`、`realtimeRefreshed=9`、`retainedLocalPrices=15`；单标的刷新 Operation `8aeba2a8-caa6-4a86-bc6c-8cb57c31b286` 验证 `513770` 持仓同步为 `currentPrice=0.429`、`lastPrice=0.429`。前端资产页、持仓页、任务页提示改为“实时成功 / 未刷新 / 保留旧价”，失败明细表显示保留旧价和三位小数价格。

状态：部分完成。A 股、场内 ETF 与现金刷新已明显改善；场外基金和债基仍有 15 个标的走本地最近可信价，下一步需要补强基金/债券 provider、缓存和 Akshare 通道。

进度 2026-05-11：完成基金/债基外部行情源补强。天天基金实时估值接口改为 curl 通道，规避 Node axios 在当前 WSL 代理环境下的 400、ECONNRESET 和 timeout；非交易所 ETF 前缀的本地 fund/bond 类型优先于名称中的 ETF 字样，避免 ETF 联接基金误走股票/场内 ETF 路径；天天基金实时估值为空时，回退到东方财富最新官方净值 `eastmoney_nav`，但保留 provider 行情日期，不再使用本地旧价冒充刷新成功。前端刷新结果口径从“实时成功”调整为“外部成功”，避免把官方净值误称为盘中实时价。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`015311` 返回 `price=1.146`、`source=tiantian`、`fallbackUsed=false`；`009725` 返回 `price=1.0449`、`source=tiantian`；`007467`、`019062`、`012857` 识别为 `fund` 并走天天基金；`006476` 返回 `price=1.776`、`source=eastmoney_nav`、行情日期 `2026-05-08`；`021634` 返回 `price=1.4228`、`source=eastmoney_nav`、行情日期 `2026-05-11`。全量刷新 Operation `6041c162-867b-4128-814e-d0d45b307909` 验证 `status=completed`、`progress=100`、`refreshed=24`、`failed=0`、`externalRefreshed=24`、`retainedLocalPrices=0`，外部源覆盖 `sina / tiantian / eastmoney_nav / manual`。

状态：部分完成。价格刷新不再依赖本地旧价兜底；后续仍需要补 provider 单元测试、行情时间展示和异常净值跳变校验。

进度 2026-05-11：补充行情可靠性自动回归脚本。新增 `backend/scripts/verify-market-data-reliability.ts` 和 `npm run test:market-data`，使用本地后端 HTTP 接口验证 resolver、单标的行情和全量刷新结果，覆盖 `513770` 场内 ETF、`007467/019062/012857` ETF 联接基金、`015311` 基金、`009725` 债基、`006476/021634` 东方财富官方净值兜底，防止后续 provider 顺序或类型识别回退。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:market-data` 通过。脚本验证 `513770=etf`、`007467/019062/012857=fund`；行情验证 `513770` 来源 `sina`、`015311/009725/007467` 来源 `tiantian`、`006476/021634` 来源 `eastmoney_nav`，且全部 `fallbackUsed=false`；全量刷新 Operation `bf146b0e-a45a-4c05-97e5-b68c4c952f78` 验证 `external=24`、`failed=0`、`retained=0`。

状态：部分完成。已具备最小自动回归能力；后续需要把脚本扩展为更细的 provider 单元测试，并加入异常价格跳变校验。

进度 2026-05-11：完成异常价格跳变提示和行情来源展示。`refreshAssetMarketData` 在外部行情命中后计算相对上一可信价的变化幅度，返回 `previousPrice`、`priceChangeFromPreviousPercent`、`abnormalPriceJump`，并在超过阈值时写入 warning；刷新 summary 会汇总异常跳变数量。持仓 DTO 新增 `asset.lastPriceSource`，资产页新增“来源”列，任务中心和刷新提示显示异常跳变数量。自动回归脚本扩展为验证基线样例不应触发异常跳变，并验证 `513770` 持仓来源为 `sina`。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:market-data` 通过，Operation `b09a55a5-f2f6-4c15-84b6-3522f29e906e` 验证 `external=24`、`failed=0`、`retained=0`，且关键样例 `abnormalPriceJump=false`；`GET /api/v1/positions?userId=default&limit=100` 验证 `513770 source=sina`、`006476/021634 source=eastmoney_nav`。前端服务已恢复监听 `http://localhost:3000`。

状态：部分完成。该节点已完成“跳变可见”和“来源可见”；下一步需要把资产导入、分析建议、AI 选股全部接入 `Asset Identity Resolver`，并把行情来源/时间带入分析快照。

进度 2026-05-12：新增行情监控模块，先落地“宽基回撤监控 + 默认 10% 建仓提醒”。后端复用 `AlertRule` 保存可配置监控标的、回撤阈值和观察窗口，默认创建上证指数、沪深300、中证500、中证1000、创业板指、科创50 六个宽基，全部启用 250 个交易日窗口和 10% 建仓提醒阈值。行情计算使用 Sina 指数日 K，按 `阶段高点 - 最新收盘价` 计算回撤；数据失败时返回 `dataStatus=error`，不生成成功提醒。触发结果写入现有 `Alert` 列表，类型为 `market`。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；新增 `backend/scripts/verify-market-watch-alerts.ts` 和 `npm run test:market-watch`，验证默认规则数 `6`、包含 `000001.SH` 上证指数 10% 规则、全部评估结果结构有效。接口验证 `/api/v1/alerts/market-watch/rules` 返回 6 条规则，`/api/v1/alerts/market-watch/evaluations` 返回当前上证指数 `latestDate=2026-05-12`、`latestPrice=4214.489`、`peakPrice=4230.184`、`drawdownPercent=0.37`、`triggered=false`，`POST /api/v1/alerts/market-watch/check` 返回 `alertCount=0`。前端 `http://localhost:3000/alerts` 已接入“宽基回撤监控”和“宽基监控配置”模块；Playwright 截图 `.verification/market-watch-alerts-page.png` 验证页面存在宽基监控、配置表、上证指数、沪深300 和 10% 阈值，且无前端错误日志；页面点击“检查宽基”确认 POST `/api/v1/alerts/market-watch/check` 返回 200，并联动刷新规则、评估和告警列表。

状态：部分完成。该节点填补 `GAP-3 领域服务边界`、`GAP-4 数据模型骨架`、`GAP-5 市场数据可靠性` 中“市场机会提醒缺少规则模型、宽基回撤不可配置、告警只能围绕持仓”的缺口；后续继续补前端截图验证和更细的规则去重、通知节流。

进度 2026-05-11：目标研究和 AI 股票分析入口接入 `Asset Identity Resolver`。`analyzeTarget` 不再对 6 位代码走股票快捷行情源，而是先 resolver，再通过 `MarketDataService` 获取行情；输入快照和建议参数带入 `identity`、行情 `source`、`sourceTime`、`fallbackUsed` 和可靠性信息。独立 `/api/v1/llm/stock-advice` 只允许 resolver 确认为 `stock/CN` 的标的进入 AI 股票分析，ETF、基金、债券会返回 400 和 identity，提示改走统一标的研究入口。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:market-data` 通过，Operation `de3d3de1-c706-47b9-9220-6392c26973ca` 验证 `external=24`、`failed=0`、`retained=0`；`POST /api/v1/analysis/target-research` 输入 `513770` 返回 `identity.assetType=etf`、`quote.source=sina`、`quote.timestamp=2026-05-11T07:00:03.000Z`、`fallbackUsed=false`，建议参数带 `sourceTime`；`POST /api/v1/llm/stock-advice` 输入 `513770` 返回 400，并携带 `identity.assetType=etf` 与“请使用统一标的研究入口”的提示。

状态：部分完成。目标研究和独立 AI 股票分析已接入 resolver；下一步继续把 AI 选股 universe 和资产导入链路接入 resolver，并把分析建议快照中的行情来源/时间在前端展示出来。

进度 2026-05-11：修正基金刷新后的市值计算口径。真实份额基金在刷新外部净值后，`marketValue` 改为按 `quantity × currentPrice` 重算，`unrealizedPnl` 同步按 `marketValue - costBasis` 计算；债券/类固收中 `quantity=1` 的手工总金额资产继续保留导入市值，避免把十几万元资产误算成 `1 × NAV`。`PositionService.refreshPositionPrices` 与 `MarketDataService` 批量刷新两条路径均使用同一判断逻辑。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；重启后端后 `npm run test:market-data` 通过，Operation `735eb249-276f-43b0-bb93-dc5d29869014` 验证 `external=23`、`failed=0`、`retained=0`，并新增基金估值断言：`019062`、`011613`、`014064`、`021634`、`015311`、`007467`、`014674`、`015916`、`013597`、`012857`、`501008` 的市值均等于 `份额 × 最新净值`；`013785`、`009725`、`014086` 保持手工总额市值。接口复核所有上述基金 `mvDiff=0.0000`，债券手工总额 `pnlDiff=0.0000`。

状态：部分完成。真实份额基金的现价、市值和浮盈口径已一致；后续仍需把前端显示中的“基金净值日期/来源”暴露得更清楚，并继续检查 Dashboard 聚合与资产页显示一致性。

## 阶段 3：持仓与账本正确性

目标：持仓、市值、成本、盈亏必须一致。

范围：

- 统一资产页、仓位页、Dashboard 的计算来源。
- 明确持仓计算公式：
  - 当前市值 = 数量 × 当前价。
  - 成本 = 数量 × 平均成本。
  - 浮盈亏 = 当前市值 - 成本。
  - 收益率 = 浮盈亏 / 成本。
- 标签修改后必须同步：
  - `asset.type`
  - 持仓标签
  - 行情刷新路径
  - 左侧类型聚合
- 删除标签必须同步所有关联。

验收：

- 修改 ETF 标签为股票后，左侧类型、价格刷新、列表显示同步变化。
- Dashboard、Assets、Positions 同一资产数值一致。
- 删除标签后刷新页面不再出现旧标签。

进度 2026-05-11：修正股票/ETF 卖出后的持仓成本计算口径。`TransactionService` 的部分卖出从“会计移动平均成本不变 + 单独 realizedPnl”改为同花顺持仓成本口径：买入增加持仓成本，部分卖出用卖出净回款冲减剩余持仓成本，并按剩余数量重新计算 `avgCost`；open 持仓不再把该笔部分卖出盈亏单独累加到 `realizedPnl`，避免和剩余持仓成本重复计算。回滚买入/卖出也同步使用交易实际买入成本和卖出净回款。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；已定向修复当前 `601127` 已发生的 100 股卖出数据，将该笔卖出亏损滚入剩余持仓成本。接口 `GET /api/v1/positions?userId=default&limit=100` 验证 `601127`：`quantity=1900`、`avgCost=136.4541052631579`、`costBasis=259262.8`、`currentPrice=89.19`、`marketValue=169461`、`unrealizedPnl=-89801.8`、`realizedPnl=0`。追加核验 2026-05-11 新卖出的两笔交易：`513770` 卖出 12000 份后 `quantity=82800`、`avgCost=0.5068309178743962`、`costBasis=41965.6`、`realizedPnl=0`；`159851` 卖出 13100 份后 `quantity=38100`、`avgCost=0.8120026246719159`、`costBasis=30937.3`、`realizedPnl=0`。

状态：部分完成。股票/ETF 部分卖出成本口径已修复；下一步需要补交易成本自动回归，并检查 Dashboard、Assets、Positions 同一资产数值一致性。

进度 2026-05-11：补充交易成本自动回归和跨接口一致性验证。新增 `backend/scripts/verify-transaction-cost-model.ts` 和 `npm run test:transaction-cost`，覆盖 `513770`、`159851`、`601127` 三个真实部分卖出案例，以及“卖出后再买入”的合成案例，锁定同花顺成本公式。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:transaction-cost` 通过，验证 `513770 avgCost=0.5068309178743962 / costBasis=41965.6`、`159851 avgCost=0.8120026246719159 / costBasis=30937.3`、`601127 avgCost=136.45410526315789 / costBasis=259262.8`。接口一致性验证：`GET /api/v1/positions?userId=default&limit=100` 与 `GET /api/v1/positions/by-tag/default` 对 `513770`、`159851`、`601127` 的盈亏和收益率一致。

状态：部分完成。成本公式已具备自动回归；下一步继续检查 Dashboard 聚合与资产页显示一致性，并处理股票/ETF 类型标签同步。

进度 2026-05-11：复核基金成本、现价、市值和浮盈一致性。当前基金 `costBasis = quantity × avgCost` 口径正确；本次修复前，部分基金刷新净值后仍保留导入时的手工 `marketValue`，导致现价已更新但市值/浮盈没有按现价重算。已将真实份额基金统一改为 `marketValue = quantity × currentPrice`，并保留债券/类固收手工总额资产的特殊口径。

验证：`npm run test:market-data` 通过并覆盖基金估值断言；`npm run test:transaction-cost` 通过，确认本次估值口径修复没有破坏 `513770`、`159851`、`601127` 的同花顺成本模型。

状态：部分完成。基金账本口径已完成后端验证；下一步继续做 Dashboard、Assets、Positions 同一资产数值一致性和前端展示验收。

进度 2026-05-11：补齐持仓、标签和页面聚合一致性回归。新增 `backend/scripts/verify-position-consistency.ts` 和 `npm run test:position-consistency`，验证后端 summary、持仓列表、按标签分组三条接口的总市值、总成本、总盈亏和持仓数量一致；同时验证每个持仓的 `costBasis / marketValue / unrealizedPnl` 公式、每个持仓标签都存在于标签注册表。修复 `syncAssetTags` 只增不删的问题，标签修改后资产标签会与持仓标签精确同步；`GET /api/v1/tags` 会把历史持仓 JSON 标签补进标签注册表，修复“管理标签比所有标签少”的缺口；按标签分组同时合并 `position.tags` 与 `asset.assetTags`。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`GET /api/v1/tags` 验证历史标签 `赛里斯` 已进入标签注册表；`npm run test:position-consistency` 通过，返回 `positions=23, totalValue=713046.64, bins=5`；`npm run test:transaction-cost` 通过。Windows Chrome headless 截图 `.verification/position-consistency-dashboard-loaded.png` 与 `.verification/position-consistency-assets-loaded.png` 验证总览和资产页加载正常，核心总市值均为 `71.30万`。

状态：部分完成。Dashboard、Assets、Positions 的后端数据口径已被自动回归锁定，标签注册表缺失问题已修复；下一步进入分析建议快照的行情来源/时间前端展示与 AI 选股 universe 接入 resolver。

进度 2026-05-11：补齐持仓编辑中的成本/收益率反推能力。资产编辑弹窗新增“当前市值 + 当前收益率”反推持仓成本入口，支持股票、ETF、基金和债基；输入当前市值与收益率后自动计算 `costBasis = marketValue / (1 + returnPercent / 100)`，并在有份额时同步反推 `avgCost = costBasis / quantity`。基金/债基保存时同步写入份额、每份成本、总成本、市值和浮盈，避免只有份额时无法按券商展示的收益率修正账本。

验证：前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；按示例 `marketValue=7571.34`、`returnPercent=-2.27%` 计算得到 `costBasis=7747.20`、`unrealizedPnl=-175.86`；重启前端后确认 3000 端口实际提供的 `EditAssetModal.tsx` 包含“当前收益率”和“按市值和收益率反推成本”；资产页操作列新增显式“编辑”按钮，截图 `.verification/assets-edit-button-visible.png` 验证入口可见。

状态：部分完成。该节点填补 `GAP-1 用户交互边界` 和 `GAP-3 领域服务边界` 中“用户只有份额和收益率时无法可靠修正成本”的缺口；后续仍需增加端到端表单自动化，直接验证弹窗输入和保存后的持仓公式。

进度 2026-05-17：持仓编辑新增止盈止损收益率阈值设置。后端统一 `Position.stopLoss / takeProfit` 语义为收益率百分比，例如 `-5` 表示亏损 5% 止损、`5` 表示盈利 5% 止盈；`AlertService` 和分析建议均按当前持仓收益率触发，不再按价格触发。前端资产管理表格新增“收益率止盈/止损”列，编辑弹窗允许非现金持仓录入止盈收益率和止损收益率。保存后立即调用 `/api/v1/alerts/risk-check`，使用当前持仓收益率检查是否已触发，触发时生成风险告警并提示用户到风险告警页面查看。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`backend/scripts/verify-stop-alerts.ts` 与 `npm run test:stop-alerts` 已改为收益率阈值验证，脚本通过 API 为 `601127` 设置止损收益率 `-38.97%`、执行 `risk-check refreshPrices=false`，验证当前收益率 `-38.98%` 返回 `alertedSymbols=["601127"]` 且生成包含“收益率”的“触及止损线”风险告警，并在验证后恢复原阈值、清理本次测试告警；Playwright 截图 `.verification/assets-return-percent-stop-alerts.png` 和 `.verification/assets-return-percent-stop-alerts-modal.png` 验证资产页表格和编辑弹窗均展示收益率阈值字段，且无前端错误日志。

状态：已完成。该节点填补 `GAP-1 用户交互边界`、`GAP-3 领域服务边界` 和 `GAP-7 异步任务骨架` 中“持仓级止盈止损只能由后端规则隐式存在、前端不可维护、保存后不能即时检查提醒”的缺口，并修正“止盈止损字段含义在前端、告警、分析建议之间不一致”的可靠性缺口。

## 阶段 4：分析建议正确性

目标：分析建议必须基于可靠数据快照。

进度 2026-05-17：修正技术指标输入口径。`AnalysisService.getTradingSignals` 读取 `PriceHistory` 后先按交易日去重，同一交易日多次刷新只保留最后一条，避免重复刷新记录被当成多个交易日并扭曲 RSI / MACD / 均线信号。以 `014064` 银华农业为例，数据库最近 30 天原始刷新记录 21 条，但有效交易日只有 3 天；去重后样本不足 20 天，因此不再输出 RSI 信号，而不是给出由重复记录计算出的 `RSI=0`。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；数据库核验 `014064` 最近 30 天记录为 `2026-04-30 tiantian 1.294`、`2026-05-11 tiantian 1.2931`、`2026-05-15 eastmoney_nav 1.2438` 三个有效交易日；`npm run test:stop-alerts` 复跑通过，确认止盈止损收益率修正未受影响。

进度 2026-05-18：完成 `TechnicalIndicatorService` 保护性第一段落地。后端新增统一技术指标审计服务，所有本地指标先对行情按交易日去重，再输出均线、RSI、MACD、BOLL、ATR、量比、支撑压力位；每个快照都包含 `schemaVersion`、`source`、`sourceLabel`、`sampleCount`、`rawSampleCount`、`asOf`、`quality` 和 `warnings`。本地指标只用于审计、对账和 fallback，不再生成买卖信号；正式技术面必须接入成熟外部 K 线/指标源和可靠技术建议模型。股票分析链路同步切断“用实时价伪造历史 K 线”的低可靠路径，真实历史 K 线不足时直接返回数据不足，不再生成模板化技术建议。

验证：新增 `npm run test:technical-indicators` 并通过，覆盖同日重复行情去重、样本不足阻断信号、80 个交易日指标输出、RSI/MACD 范围校验，以及本地指标不产生交易建议；后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:analysis-trace` 通过，确认分析建议行情快照仍可追溯；`npm run test:stop-alerts` 通过，确认止盈止损收益率链路未受影响。

进度 2026-05-18：股票分析技术面接入外部技术指标展示。新增 `ExternalTechnicalDataProvider`，通过 TradingView Scanner 获取 A 股外部技术评级和指标，股票分析 API 返回 `externalTechnical`，前端技术指标面板展示外部来源、TradingView 标的、综合/均线/振荡器评级、RSI、MACD、ATR、SMA 和更新时间；本地指标明确为复核区，不能生成交易建议。

验证：`npm run test:external-technical` 通过，`601127` 返回 `SSE:601127`、TradingView 综合评级、RSI14、SMA20；后端/前端 TypeScript 检查通过；接口 `GET /api/v1/stocks/601127?market=A股&days=80` 返回 `externalTechnical.quality=ok` 且 recommendation 首行引用外部技术评级。

进度 2026-05-18：外部技术指标新增多源可信度评分。`externalTechnical.confidence` 输出 `score`、`level`、`sourceCount` 和逐项校验结果；TradingView 作为外部技术评级主源，Eastmoney/Sina K 线作为独立复核源，交叉校验收盘价、SMA20、RSI14 和 MACD 方向。后续只有高可信或中可信且模型审核通过的指标，才能进入建议模型。

验证：`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `confidence.score=95`、`level=high`、`sourceCount=2`；收盘价、SMA20、RSI14 和 MACD 方向校验均通过。

进度 2026-05-18：技术指标到分析建议的模型边界落地。新增 `TechnicalAdviceModelRegistry` 和 `tradingview_ratings_interpretation_v1`，把外部技术评级解释为结构化技术面观察结论；模型执行前检查外部指标质量、Technical Ratings 是否存在、多源可信度是否达到 `80`、是否存在失败校验。未达标时只返回阻断原因，不生成建议。

验证：`npm run test:technical-advice-model` 通过；`GET /api/v1/stocks/601127?market=A股&days=80` 返回 `technicalAdvice.status=available`、`stance=defensive`、`summary=技术面偏防守`、证据数 `5`。

进度 2026-05-18：股票分析事实集第一段落地。新增 `StockAnalysisFactSet`，股票分析 API 返回 `factSet`，包含技术面、基本面、消息面三个分区。技术面已接入外部指标、可信度、交叉校验、本地复核和模型输出 facts；基本面与消息面明确标记为 `insufficient_data`，防止生成没有 provider 支撑的空话。`technicalAdvice.evidenceRefs` 必须全部指向 factSet 中存在的事实。

验证：`npm run test:stock-analysis-factset` 通过；`601127` 接口返回技术 facts `13` 条、技术面 `ok`、基本面/消息面 `insufficient_data`，所有 `evidenceRefs` 均可解析。

进度 2026-05-18：基本面估值事实第一段落地。新增 `FundamentalDataProvider`，通过东方财富获取 A 股动态 PE、PB、总市值和流通市值，并写入 `factSet.fundamental`；股票分析响应同步返回 `peRatio`、`pbRatio` 和 `fundamentalSnapshot`。当前只允许展示估值与市值事实，成长、盈利质量、现金流和行业分位未接入前不得生成完整基本面结论。

验证：`npm run test:fundamental-factset` 通过；`601127` 接口返回 `peRatio=47.22`、`pbRatio=3.45`、基本面 facts `4` 条、`factSet.fundamental.quality=ok`。

进度 2026-05-18：消息面事件流第一段落地。新增 `NewsDataProvider`，通过东方财富搜索获取个股相关新闻，输出标题、摘要、媒体、发布时间、链接、事件类型、规则情绪和相关性，并写入 `factSet.news`。当前消息面只允许展示事件事实和规则分类，公告全文、权威公告源、影响强度和 LLM 情绪复核未接入前不得生成完整消息面结论。

验证：`npm run test:news-factset` 通过；`601127` 接口返回新闻事件 `8` 条、消息面 facts `6` 条、`factSet.news.quality=ok`，首条新闻来源为证券日报。

进度 2026-05-18：三面分析汇总第一段落地。新增 `StockAnalysisSummary`，从事实集生成技术面、基本面、消息面的结构化摘要，并明确每个分区是 `available`、`partial` 还是 `blocked`；摘要必须带 `evidenceRefs` 或 `blockedReasons`。当前技术面可用，基本面和消息面因数据维度不足只允许 partial。

验证：`npm run test:stock-analysis-summary` 通过；`601127` 接口返回 `analysisSummary.overallStatus=partial`，技术面 `available`，基本面和消息面均为 `partial` 且保留阻断原因。

进度 2026-05-18：基本面财报主指标第一段落地。东方财富 F10 财务主指标接入 `FundamentalDataProvider`，与估值快照一起形成基本面事实：最新财报期、营业收入、营收同比、归母净利润、归母净利同比、ROE、毛利率、资产负债率、经营现金流和 EPS。股票分析事实集基本面 facts 从 4 条扩展到 13 条，摘要层引用这些 facts，仍明确行业分位、多源财报复核和完整三表未接入。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:fundamental-factset`、`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；运行态接口 `GET /api/v1/stocks/601127?market=A股&days=80` 返回基本面 facts `13` 条和 `2026一季报` 财务主指标。

进度 2026-05-18：基本面行业分位第一段落地。东方财富行业板块和成分股接入 `FundamentalDataProvider`，`601127` 当前映射到 `乘用车(BK1262)`；系统用板块成分股计算 PE/PB/总市值分位，并逐只拉取 F10 财务主指标计算 ROE 和资产负债率分位。无法识别行业板块时只返回 warning，不允许输出“估值合理/偏低/偏高”。

验证：后端和前端 TypeScript 检查通过；`npm run test:fundamental-factset` 通过并验证 `sampleSize=9`、PE 低估分位 `11.11`、PB 低估分位 `44.44`、ROE 分位 `100`、资产负债率低位分位 `33.33`；`npm run test:stock-analysis-factset` 验证基本面 facts `20` 条；`npm run test:stock-analysis-summary` 验证摘要包含同业对比。

进度 2026-05-18：财报主指标同厂不同接口复核第一段落地。新增 `financialCrossCheck`，用东方财富 F10 主指标接口与东方财富数据中心业绩报表接口交叉校验营业收入、归母净利润、基本 EPS、ROE 和毛利率；复核状态、逐项差异和警告写入事实集。当前仍标明“同厂不同接口”，不能替代交易所公告全文或独立第三方来源。

验证：后端和前端 TypeScript 检查通过；`npm run test:fundamental-factset` 验证 `601127` 五项复核全部 `pass`、差异 `0%`；`npm run test:stock-analysis-factset` 验证基本面 facts `26` 条；`npm run test:stock-analysis-summary` 和运行态接口验证摘要包含 `财报复核：ok / RPT_LICO_FN_CPD`。

进度 2026-05-19：独立来源财报复核第一段落地。新增搜狐证券重要财务指标页解析，作为独立于东方财富的数据源；系统读取 `SOHU_CWZB` 最近报告期，按万元换算为元后复核主营业务收入、净利润、每股收益、ROE 和资产负债率。复核状态、来源、报告期和逐项差异写入事实集；如果搜狐报告期与主源不一致则阻断该复核，不参与结论。

验证：后端和前端 TypeScript 检查通过；`npm run test:fundamental-factset` 验证 `601127` 搜狐 5 项复核全部 `pass`；`npm run test:stock-analysis-factset` 验证基本面 facts `32` 条；`npm run test:stock-analysis-summary` 与运行态接口验证摘要包含 `独立来源复核：ok / SOHU_CWZB`，营收和净利润复核均 `pass / 差异 0%`。

进度 2026-05-19：公告原文定位第一段落地。新增 `officialAnnouncement`，通过搜狐证券重大事项备忘页定位对应报告期公告原文，并抽取公告标题、披露日期和上交所官方 PDF 链接。该信息写入基本面事实集和摘要，确保所有财报事实至少能追溯到公司公告原文入口；PDF 表格字段抽取仍作为下一阶段，不把定位等同于原文指标复核。

验证：后端和前端 TypeScript 检查通过；`npm run test:fundamental-factset` 验证 `601127` 定位到 `2026年第一季度报告`、披露日期 `2026-04-30` 和上交所 PDF；`npm run test:stock-analysis-factset`、`npm run test:stock-analysis-summary` 通过；运行态接口返回基本面 facts `36` 条和 `公告原文：located / PDF`。

进度 2026-05-17：补齐持仓页新增持仓能力。新增后端 `POST /api/v1/positions/manual-buy` 和前端“新增持仓”弹窗，支持输入标的、金额或份额、成交价、手续费、资产类型和标签；后端通过 resolver 识别/创建资产，取外部价格或要求人工成交价，再创建买入交易并更新持仓。

验证：后端/前端 TypeScript 检查通过；新增 `npm run test:manual-buy-position`，用临时标的验证 8000 元 / 1.25 元新增持仓后份额为 6400、市值为 8000、交易类型为 buy，并自动清理测试数据；Playwright 截图 `.verification/positions-manual-buy-modal.png` 验证持仓页新增入口可见。

进度 2026-05-17：新增 `docs/AI_INVESTMENT_ANALYSIS_MODEL_PLAN.md`。后续分析建议主线改为“外部可信指标 + 可回测策略模型 + LLM 解释 + 人工微调”，不再把本地规则引擎输出包装成 AI 投资建议。

进度 2026-05-17：将股票分析基本面、消息面、技术面空泛问题加入高正确计划。后续股票分析必须先生成 `StockAnalysisFactSet`：基本面有财务、估值、成长、质量和行业分位证据；消息面有新闻/公告来源、时间、事件分类、情绪和影响方向；技术面有外部或可审计指标、样本数量、来源和更新时间。LLM 输出必须引用事实 evidenceRefs；数据不足时必须明确显示不足，不能输出模板化结论。

进度 2026-05-17：将外部策略发现、批量模拟买入和策略胜率对比加入高正确计划。新增目标是把外部策略先解析为结构化草稿，经过来源、许可证、适用市场、数据字段和未来函数风险审核后，再组合选股策略与投资执行策略进行批量回测；结果必须展示胜率、收益、最大回撤、夏普、盈亏比、交易次数、换手率、样本覆盖率和费用滑点假设，并能追溯到策略版本、参数、行情快照和回测批次。

范围：

- 分析建议输入固定为 `AdviceInputSnapshot`：
  - 持仓快照。
  - 行情快照。
  - 价格来源。
  - 置信度。
  - 失败项。
- 建议输出拆分：
  - 消息面。
  - 基本面。
  - 技术面。
  - 支撑压力位。
  - 结合持仓的买入区间。
  - 风险提示。
- AI 只能在 snapshot 完成后运行。
- 如果行情数据不可靠，AI 结果必须降级或阻断。

验收：

- 搜索任意标的或板块，前端能看到数据来源和分析结构。
- AI 分析不能使用错误标的。
- Dashboard AI 股票分析与分析建议页保持一个统一入口。

进度 2026-05-11：分析建议快照前端可追溯。`generateInvestmentSuggestions` 返回 `marketDataTrace`，直接暴露每个纳入建议的标的行情来源、来源标签、价格、涨跌幅、置信度、行情时间、是否 fallback 和 warnings；分析建议页新增“行情取数快照”面板，日常建议和单标的研究都能看到来源、时间、回退和警告数量。标的研究行情卡片新增“行情时间”，避免只看到价格但无法判断是否是最新来源。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；新增 `backend/scripts/verify-analysis-trace.ts` 和 `npm run test:analysis-trace`，验证日常建议 `marketDataTrace=23` 且与 `matchedPositions` 对齐，`513770` 标的研究返回 `quote.source=sina`、`timestamp=2026-05-11T07:00:03.000Z`、`fallbackUsed=false`；Windows Chrome headless 截图 `.verification/analysis-market-trace-visible.png` 确认分析页展示“行情取数快照”、来源、价格、置信度和时间。

状态：部分完成。分析建议输入快照已经可在前端看到关键行情来源与时间；下一步把 AI 选股 universe 和资产导入链路接入 `Asset Identity Resolver`，并继续增强选股策略可复现性。

进度 2026-05-11：AI 选股 universe 与资产导入身份解析接入 `Asset Identity Resolver`。`screenStocks` 不再按本地 `asset.type=stock` 直接选样本，而是先解析所有开放持仓资产，只保留 `stock/CN` 进入 A 股选股样本池；ETF、基金、债券、现金和非 A 股股票会返回 `excludedUniverse` 诊断，避免标签错误把 513770、159851 等 ETF 混入股票策略。资产导入新增 `resolveImportAssetIdentity` 预览链路，导入创建或更新资产时写入 resolver 判定的标准代码、资产类型、交易所和币种，旧 Excel 分类规则只作为兜底。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；新增 `backend/scripts/verify-screener-resolver.ts` 与 `npm run test:screener-resolver`，验证选股结果 `universeSource=asset_identity_resolver`、`universe=9`、`candidates=5`、`excluded=19`，若本地存在 `513770` 则必须以 `resolvedType=etf` 排除出股票选股样本；新增 `backend/scripts/verify-import-identity-resolver.ts` 与 `npm run test:import-resolver`，验证 `601127=stock`、`513770=etf`、`159851=etf`、`007467=fund`、`009725=bond`、现金复合键为 `cash`。验证中发现当前外部历史 K 线 provider 多个标的返回 502 或空响应，选股链路能完成但 `failures=9`，后续阶段需要继续治理 provider/cache。

状态：部分完成。该节点已填补“AI 选股样本池被错误标签污染”和“资产导入绕过统一身份解析”的缺口；下一步进入 `StockScreenerService` 策略结构化和可复现测试，尤其要解决历史 K 线 provider 成功率和数据不足不强行入选的问题。

## 阶段 5：AI 选股正确性

目标：选股策略可解释、可复现。

范围：

- 建立 `StockScreenerService`。
- 每个策略必须结构化：
  - 输入条件。
  - 数据范围。
  - 计算指标。
  - 阈值。
  - 命中原因。
  - 未命中原因。
- 第一批策略：
  - A杀后横盘放量。
  - 近 20 日横盘。
  - 近 2 日成交量放大。
  - 跌破后收复关键均线。
  - 放量突破平台。
- 返回结果必须包含：
  - 股票代码。
  - 名称。
  - 命中条件。
  - 关键指标。
  - 支撑压力位。
  - 买入区间。
  - 风险说明。

验收：

- 相同条件多次查询结果稳定。
- 每只股票都能解释为什么入选。
- 数据不足的股票不能强行入选。

进度 2026-05-11：完成 AI 选股样本池正确性底座。当前策略仍保留在 AnalysisService 中，但样本池已由 `Asset Identity Resolver` 统一控制，并把被排除标的返回前端展示，作为后续抽离 `StockScreenerService` 和策略复现测试的前置能力。

验证：`npm run test:screener-resolver` 通过，接口返回 `universeSource=asset_identity_resolver`，候选只允许 6 位 A 股股票，ETF 513770 被排除；前端类型检查通过，分析建议页 AI 选股结果增加“身份解析样本池”和“已排除非A股股票”的可见提示。

状态：部分完成。策略服务拆分、更多选股策略、数据不足阻断和稳定性对照测试仍待执行。

进度 2026-05-11：补强 AI 选股历史 K 线数据可靠性。`getChinaStockHistory` 在东方财富历史接口失败后新增 Sina 历史 K 线 curl fallback；选股历史数据超时从 6 秒调整到 12 秒，避免 fallback 尚未完成就被截断。`screenStocks` 删除“历史不足时用实时价伪造 22 天 K 线”的低置信度候选逻辑，历史数据少于 22 个交易日时直接排除该标的并写入 failures。返回结果新增 `dataQuality`、候选 `historySource` 和 `historyDays`，前端展示 K 线有效数量、历史不足数量、数据源和 K 线条数。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-resolver` 从上一轮 `failures=9` 修复为 `universe=9`、`candidates=5`、`excluded=19`、`failures=0`，并新增断言：基线选股不得存在历史不足失败、不得把 failures 中的标的放入候选、必须返回历史 provider sources；`npm run test:import-resolver` 继续通过。Windows Chrome headless 截图 `.verification/analysis-screener-history-reliability.png` 验证分析页加载正常。

状态：部分完成。该节点填补 `阶段 5` 中“数据不足的股票不能强行入选”和 `GAP-5` 中“历史行情 provider 失败不可见、fallback 不可靠”的缺口；下一步继续拆分 `StockScreenerService`，把策略定义、阈值、未命中原因和缓存/观测指标独立出来。

进度 2026-05-11：修复 AI 选股样本池覆盖范围。`screenStocks` 默认不再只扫描持仓或本地默认股票，而是通过 Sina `hs_a` 拉取全 A 股股票池，覆盖沪深北 A 股样本并缓存 6 小时；持仓中的 A 股股票会合并进样本池，ETF、基金、债券、现金等继续通过 resolver 排除。接口返回 `universeSource=sina_hs_a_all_a_share`、`universeTotal`、`scannedCount` 和覆盖率，前端结果区显示“全A股样本池”和“已扫描/覆盖率”。为调试和快速验收保留自然语言参数 `扫描上限=数字`，不填写时按全样本扫描。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-resolver` 通过，返回 `universe=5514`、`candidates=5`、`excluded=18`、`failures=0`，断言样本池来源必须为 `sina_hs_a_all_a_share` 且样本数不少于 3000；手工调用 `POST /api/v1/analysis/stock-screener` 并设置 `扫描上限=30` 返回 `universeTotal=5514`、`scannedCount=30`、`historySources=["sina"]`，候选包含非持仓 A 股样本；3000 端口已重启并确认前端源码包含“全A股样本池”和“已扫描/覆盖率”。

状态：部分完成。该节点填补 `阶段 5` 中“AI 选股没有纳入所有 A 股样本”的缺口；下一步继续抽离 `StockScreenerService`，完善策略阈值、未命中原因、缓存命中率、provider 成功率和全量扫描性能观测。

进度 2026-05-12：抽离 `StockScreenerService`，将 AI 选股从 `AnalysisService` 中拆出为独立领域服务。服务返回结构化 `strategyDefinition`、可配置阈值、每只候选的 `matchedRules / unmatchedReasons`、`observability` 指标和数据质量统计；查询文本支持 `扫描上限`、`回撤阈值`、`横盘振幅`、`量比阈值`、`最少K线` 等参数。前端分析页展示策略定义、provider 成功率、命中和未命中原因，避免只给候选列表但无法复核策略判断。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；新增 `backend/scripts/verify-stock-screener-service.ts` 和 `npm run test:screener-service`，用合成 K 线验证命中样例 `score=100` 且三条规则全部命中、未命中样例返回明确 `unmatchedReasons`，并验证自然语言阈值解析；`npm run test:screener-resolver` 通过，返回 `universe=5514`、`candidates=8`、`excluded=18`、`failures=0`，并断言 `strategyDefinition.id=a_flush_sideways_volume`、默认回撤阈值 `18`、`observability.failureCount` 与 failures 一致；Playwright 截图 `.verification/analysis-screener-service-structured.png` 验证分析页展示“策略定义”、`provider成功率`、命中/未命中原因和全 A 股样本池，且无前端错误日志。

状态：部分完成。该节点填补 `阶段 5` 中“策略逻辑混在 AnalysisService、阈值不可追溯、未命中原因不可见、provider 成功率缺少观测”的缺口；下一步继续扩展第二批策略和缓存/全量扫描性能治理。

进度 2026-05-12：扩展 AI 选股第二批确定性策略。`StockScreenerService` 支持根据查询文本选择 `A杀后横盘放量`、`放量突破平台`、`跌破后收复关键均线` 三类策略；新增 `evaluateVolumePlatformBreakout` 和 `evaluateMaReclaim`，返回同一候选结构，并明确每只股票命中的规则或未命中的原因。查询示例 `放量突破平台；扫描上限=30` 会返回 `strategyDefinition.id=volume_platform_breakout`，`跌破后收复关键均线；扫描上限=30` 会返回 `strategyDefinition.id=ma_reclaim`。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-service` 通过，合成 K 线覆盖三类策略，平台突破和均线收复样例均 `score=100` 且返回命中规则；`npm run test:screener-resolver` 通过，默认 A 杀策略仍返回 `universe=5514`、`candidates=8`、`excluded=18`、`failures=0`；接口手工验证 `放量突破平台；扫描上限=30` 返回 `strategy=放量突破平台`、`id=volume_platform_breakout`、`scanned=30`，`跌破后收复关键均线；扫描上限=30` 返回 `strategy=跌破后收复关键均线`、`id=ma_reclaim`、`scanned=30`；Playwright 截图 `.verification/analysis-screener-multistrategy-platform.png` 验证前端展示“AI选股结果 - 放量突破平台”、策略定义、provider 成功率和突破规则说明，且无前端错误日志。

状态：部分完成。该节点填补 `阶段 5` 中“只有单一 A杀策略、其他选股语言无法落到确定性策略”的缺口；下一步继续做全量扫描缓存、provider 成功率趋势和更多策略参数化。

进度 2026-05-19：完成 AI 选股多策略短窗胜率评估第一段。`StockScreenerService` 在同一批全 A 股样本 K 线上同时运行 `A杀后横盘放量`、`放量突破平台`、`跌破后收复关键均线` 三类策略，并新增 `strategyTournament` 返回最近可验证交易日信号、持有 N 日后的胜率、平均收益、最好/最差收益、当前命中数和样本候选。查询文本支持 `验证天数`、`持有天数` 参数；前端 AI 选股结果新增“多策略短窗胜率”区块，展示策略排行和样本数，避免只看单一候选列表。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-service` 通过，合成 K 线验证短窗回测能识别 A 杀横盘放量信号并计算 3 日后胜率。运行态接口验证 `POST /api/v1/analysis/stock-screener`，输入 `多策略胜率；扫描上限=30；验证天数=5；持有天数=3` 返回 `strategyTournament`：A杀策略 `signals=5 / wins=0 / winRate=0 / avg=-6.06`，均线收复 `signals=1 / wins=0 / winRate=0 / avg=-8.54`，平台突破 `signals=0`；样本池仍为全 A 股，扫描上限只限制本轮扫描数量。

状态：部分完成。该节点填补 `阶段 5` 中“多策略无法横向比较、策略胜率不可见、近期有效性无法复核”的缺口；下一步进入策略参数版本化、回测批次持久化、费用滑点假设和可视化曲线。

进度 2026-05-19：完成 AI 选股短窗胜率回测批次持久化。`strategyTournament` 现在会生成统一 `batchId`，并把每个内置选股策略保存为一条 `Backtest` 和一条 `BacktestResult`；`reviewReportJson` 保存原始查询、策略版本、阈值、样本池、数据质量、观测指标、胜率、收益、信号样本和当前候选。前端多策略区块展示批次号和每个策略的 Backtest ID，后续可以通过回测详情接口追溯。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-service` 通过，验证持久化写入 Backtest/BacktestResult 后清理测试数据。运行态 `POST /api/v1/analysis/stock-screener` 输入 `多策略胜率；扫描上限=20；验证天数=5；持有天数=3` 返回 `batchId=13529910-0c3a-424a-9ae4-af490e2f48a7`、三条策略 `persistenceStatus=persisted`；`GET /api/v1/backtest/results/57a4eb9d-6859-4615-b507-3e384b76ca18` 返回 `status=completed`、`progress=100`、`reviewReport.kind=stock_screener_strategy_tournament`、`query` 与原始输入一致。

状态：部分完成。该节点填补 `阶段 5` 中“短窗胜率只能看即时结果、不能追溯到回测批次和策略参数”的缺口；下一步进入费用/滑点假设、投资执行策略组合和胜率/收益曲线可视化。

进度 2026-05-19：优化分析页持仓研究面板的基本面、技术面和消息面展示。后端 `getHoldingsResearch` 不再返回“估值数据待接入 / 未接入实时新闻源”等过期泛化文案，改为按股票、基金/ETF/债基、黄金、现金分别说明研究边界、证据入口和风险关注点；股票持仓明确指向已落地的个股分析事实集，基金类强调官方净值、底层资产和流动性，现金按金额口径处理。前端持仓研究卡片改为市值、现价/成本、支撑/压力、止盈止损四个指标块，并将基本面、技术面、消息面拆成三栏，便于扫描。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；运行态 `GET /api/v1/analysis/holdings-research?userId=default` 返回 22 条持仓研究。样例 `601127` 返回“基本面证据已在股票分析事实集落地”“单股研究可追溯估值、财报、行业分位、复核和公告原文”，消息面明确重大公告以公告原文为准；现金持仓返回“无基本面分析需求，主要校验金额口径和可用性”。

进度 2026-05-19：提高 AI 选股胜率结论可信度。`strategyTournament` 新增同窗口全样本基准收益、策略超额收益、样本充分度、95% Wilson 胜率置信区间和可信度评级，前端多策略卡片展示基准、超额、可信分和样本充分度。可信度会惩罚小样本、低覆盖率和相对基准无超额收益，避免把短窗 0% 或 100% 胜率误读成可交易结论。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:screener-service` 通过。运行态 `多策略胜率；扫描上限=50；验证天数=5；持有天数=3` 返回基准样本 `250`、基准平均收益 `-2.95%`、基准胜率 `21.2%`；三类策略均为 `low` 可信，A杀策略 `signals=11 / winRate=0 / avg=-6.09 / excess=-3.14 / score=48`，放量突破 `signals=1 / score=36`，均线收复 `signals=2 / score=37`。

进度 2026-05-11：修复手工总额资产编辑和刷新口径。黄金编辑弹窗不再只能修改克重，新增当前金价、持仓成本、每克成本、当前市值、收益率和“按市值和收益率反推成本”，实时金价不可用时允许手工填写市值保存；现金保存改为 `quantity=金额 / currentPrice=1 / marketValue=金额 / costBasis=金额 / unrealizedPnl=0`，避免三条现金持仓保存后仍显示 1 元。后端 `PositionService` 允许基金、债基、黄金、现金直接保存 `costBasis/marketValue`；刷新链路修复本地黄金资产被 resolver 误判成股票后取到 19.33 的问题，黄金优先按元/克金价刷新，现金刷新按金额口径自愈。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；新增 `npm run test:manual-assets`，验证现金 3 条持仓均为金额口径，黄金刷新价 `1036.14` 元/克且来源 `goldFund`，不再使用 `sina` 股票价；手工接口验证刷新黄金和三条现金 `refreshed=4 / failed=0`，黄金市值 `15542.10`、成本 `16574.81`、浮亏 `-1032.71`，三条现金分别为 `120000`、`79300`、`288000`，浮盈亏均为 0。

状态：已完成。该节点填补 `阶段 3` 和 `阶段 4` 中“手工总额资产编辑不完整、刷新覆盖用户金额口径、黄金现价来源错误”的缺口；后续继续把该脚本纳入综合回归。

进度 2026-05-11：新增统一 `post-refresh validation`。行情刷新在写入 `Asset.lastPrice` 和 `Position` 前先校验价格、来源和资产类型是否匹配，并按资产类型生成持仓更新值；股票/ETF/真实份额基金必须满足 `quantity × price` 市值公式，手工总额基金/债基保留手工市值，黄金必须是元/克口径且不能使用股票/基金行情源，现金只能使用 `manual` 且价格必须为 1。价格相对上一可信价超过阈值时不再写库，结果计为失败并返回 `POST_REFRESH_VALIDATION_FAILED`。

进度 2026-05-11：补齐 post-refresh validation 的任务中心可见性和手工校准基金保护。刷新失败分类新增 `validation_failed`，前端失败表显示“刷新校验阻断”和“阻断写库”，可与网络失败、无数据、源失败区分。非场内基金/债基如果已有市值与 `quantity × price` 偏离超过 0.3%，视为用户手工校准市值，刷新时保留用户确认过的总市值，避免 019062、007467 等已校准资产被净值公式覆盖。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`npm run test:position-consistency` 通过，验证 `positions=22`、`totalValue=1337784.39`、`bins=5`；`npm run test:manual-assets` 通过；手工刷新黄金和三条现金返回 `refreshed=4 / failed=0 / retainedLocalPrices=0`，黄金 `price=1033.15`、`source=goldFund`，三条现金 `price=1`、`source=manual`，均无 warning。

状态：已完成。该节点填补 `阶段 4` 中“刷新后缺少统一正确性校验、错误行情可能污染主数据、任务中心无法区分校验阻断”的缺口；后续可以进一步把校验规则版本号和刷新前后快照写入 Operation artifact。

进度 2026-05-11：收紧资产编辑口径。非现金资产的人工编辑允许录入持仓数量/份额/克重、当前总市值和当前收益率；现价、基金净值、黄金金价由系统调用 `/api/v1/prices/realtime` 查询并只读展示，禁止人工修改。保存时用 `成本 = 当前总市值 / (1 + 收益率)` 反推成本合计和每份/每克成本，盈亏由总市值与成本计算。现金资产仍按金额维护。

验证：前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；3000 端口实际源码确认包含“当前总市值(元)”“按基金 App / 券商 App 当前总金额录入”“当前收益率(%，保存时自动反推成本)”，且现价/净值只读展示；接口验证 `019062` 最新净值返回 `price=1.053`、`source=tiantian`、`fallbackUsed=false`。

进度 2026-05-11：确认资产编辑前后端一致性，并在后端增加防篡改校验。前端保存非现金资产时提交数量、系统查询得到的 `currentPrice`、人工总市值、由收益率反推的成本和盈亏；后端 `updatePosition` 收到 `currentPrice` 后会重新调用系统行情查询并校验一致，防止客户端或旧前端篡改现价/净值。

验证：后端/前端 TypeScript 检查通过；用 `019062` 当前净值 `1.053` 保存现有持仓返回 HTTP 200；故意提交错误净值 `9.99` 返回 HTTP 400，错误信息为“提交的现价/净值必须与系统行情一致”。

进度 2026-05-11：修正基金/债基/黄金的份额口径。对于基金、债基和黄金，前端不再让用户直接编辑份额/克重，而是由 `当前总市值 / 系统净值或金价` 只读反推；后端保存时也强制用 `marketValue/currentPrice` 重算 `quantity`，保证前后端一致。

验证：009725 当前 `marketValue=163543.76`、`currentPrice=1.0449`，保存后后端返回 `quantity=156516.1833668294`，等于 `marketValue/currentPrice`；3000 端口源码确认包含 `shouldDeriveQuantity` 与 `calculatedValues.quantity`，前端将展示 `156516.1834`。

进度 2026-05-11：全量修复基金/债基/黄金历史份额。扫描 14 个开放的基金、债基和黄金持仓，发现除已修复的 009725 外还有 12 个 `quantity` 与 `marketValue/currentPrice` 不一致；已批量按当前市值和当前净值/金价重算 `quantity`，并同步重算 `avgCost=costBasis/quantity`，保持总市值、成本和盈亏不变。

验证：全量复扫 `mismatchCount=0`；新增 `npm run test:derived-quantity`，验证 14 个基金/债基/黄金持仓均满足 `quantity=marketValue/currentPrice` 和 `avgCost=costBasis/quantity`；`npm run test:position-consistency` 继续通过。

进度 2026-05-17：修正基金/债基刷新后的市值和收益率更新口径，并把场外基金/债基净值源切换为官方净值优先。人工录入“当前总市值 + 收益率”只用于当时反推份额和成本；之后刷新净值时份额和成本固定，`marketValue = quantity × official NAV`，收益率按新市值重新计算。天天基金 `gsz` 明确降级为盘中估值，不再作为“最新净值”主源；东方财富 `eastmoney_nav` 官方单位净值成为基金/债基刷新主源，天天基金仅作为估值/名称参考和兜底。

验证：后端 `node node_modules/typescript/bin/tsc --noEmit` 通过，前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；刷新 Operation `b5952ee2-a61f-4588-9130-8b54c2ed82d7` 完成，`externalRefreshed=22`、`failed=0`、`retainedLocalPrices=0`。`npm run test:market-data`、`npm run test:position-consistency`、`npm run test:derived-quantity` 均通过。新增 `backend/scripts/verify-fund-nav-sources.ts` 与 `npm run test:fund-nav-sources`，逐只验证 13 个基金/债基当前净值等于东方财富官方净值，并输出天天基金官方旧净值和盘中估值对照；例如 `019062` 系统净值从天天基金估值 `0.9858` 修正为东方财富官方净值 `0.9871`，`009725` 从 `1.0433` 修正为 `1.0425`，`013597` 从 `1.1092` 修正为 `1.1107`。前端截图 `.verification/assets-fund-nav-official-refresh.png` 验证资产页显示 019062 官方净值和 `eastmoney_nav` 来源，无前端错误日志。

状态：已完成。该节点填补 `GAP-3 领域服务边界` 和 `GAP-5 市场数据可靠性` 中“人工校准后的基金市值被错误保护、净值估值和官方净值混用、刷新后收益率不随净值更新”的缺口。

## 阶段 6：高可靠工程化

目标：让系统长期可维护、可回归。

范围：

- 增加自动化测试：
  - asset identity 测试。
  - price provider 测试。
  - position calculation 测试。
  - tag sync 测试。
  - analysis snapshot 测试。
  - screener strategy 测试。
- 增加端到端测试：
  - 刷新价格。
  - 修改标签。
  - 查询标的。
  - 生成分析建议。
  - AI 选股。
- 增加观测能力：
  - provider 成功率。
  - 查询耗时。
  - 失败分类。
  - 缓存命中率。
  - AI 调用状态。

验收：

- 每次开发节点都跑：
  - 后端类型检查。
  - 前端类型检查。
  - 核心接口验证。
  - Chrome 截图验证。
  - 更新 gap 文档。

状态：待执行。

进度 2026-05-21：完成一次架构设计、代码实现、需求偏移三方向全量检视后的第一批并行修复。重点修复四类高风险问题：

- Operation 可靠性：`Operation` 增加 `leaseToken` fencing，运行、进度、任务更新、完成、失败、取消均校验 `leaseOwner + leaseToken`；有效租约取消先进入 `cancelling`，由当前 owner 终结；`idempotencyKey` 唯一冲突返回已有任务，避免 500 和重复执行。
- LLM 边界：股票 AI 分析只返回事实观察、证据引用、数据缺口和风险提示；禁止并兜底拦截 `BUY/SELL/HOLD`、买入/卖出、目标价、止损、止盈、仓位等交易决策字段。前端股票详情旧“投资建议”改为“技术事实观察”，不再把指标映射成买卖动作。
- 股票事实集缓存：`StockFactSetCache` 唯一键加入 `lookbackDays` 和 `timeframe`，避免 30/60/80 日窗口互相污染；到期事实集调度改为扫描全部开放持仓，并将 position advice 与 stock factset 分开提交，避免混合 scope 被 `limit` 截断。
- 契约与验证保护：MCP Operation status schema 补齐 `succeeded / partial / cancelling`；资产页和持仓页轮询把 `succeeded / partial` 作为终态处理，`partial` 以部分成功展示；会改写 dev 数据库的验证脚本新增 `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1` 显式确认。

验证：Prisma `validate/generate` 通过；后端 `node node_modules/typescript/bin/tsc --noEmit` 通过；前端 `node node_modules/typescript/bin/tsc --noEmit` 通过；`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 node node_modules/tsx/dist/cli.mjs scripts/verify-operation-recovery.ts`、`verify-due-factset-refresh.ts`、`verify-factset-refresh-scheduler.ts` 通过；`node node_modules/tsx/dist/cli.mjs scripts/verify-stock-factset-cache.ts` 通过。直接搜索确认股票 AI 前端展示中不再残留买入/卖出、目标价、止损、止盈等交易决策展示；相关词仅保留在 LLM 禁止词和拦截逻辑中。

状态：已完成。该节点填补 `GAP-7 异步任务骨架` 的租约 fencing、幂等冲突和部分成功契约缺口，补强 `GAP-5 市场数据可靠性` 的缓存窗口污染与到期调度漏扫问题，并补齐 `GAP-6 Connect 与 MCP 成熟度` 中 Operation 状态 schema 与前端终态不一致的问题。

进度 2026-05-21：继续执行数据可靠性优先计划，完成用户边界与开放持仓唯一性修复。

- 用户边界：`ensureUser` 不再静默创建任意 `userId`。默认只兼容当前单用户 UI 的 `default` 本地用户；非 default 用户必须已存在，或显式设置 `FAMS_ALLOW_DYNAMIC_LOCAL_USERS=1` 用于受控验证/迁移。`AnalysisService` 内部自建用户逻辑已改为复用统一 `ensureUser`。
- 开放持仓唯一性：`Position` 新增 `openKey` 唯一键，开放持仓写入 `userId:assetId`，平仓后置空；同一用户同一资产只能存在一个 `open` 持仓，closed 历史持仓不受影响。
- 交易合并保护：买入创建新持仓时写入 `openKey`；若并发写入触发唯一冲突，会重新读取已有开放持仓并合并数量与成本，避免重复 open position。现金持仓创建也按同一规则保护。
- 错误契约：Fastify 错误处理中补充 Prisma `P2002` 到 `409 CONFLICT`、`P2025` 到 `404 NOT_FOUND`，避免唯一约束和并发冲突被包装成 500。
- 验证脚本：新增 `test:open-position-uniqueness`，执行现有开放持仓 `openKey` 回填、重复开放持仓扫描、交易合并验证和非 default 动态用户阻断验证。

验证：Prisma `db push --accept-data-loss / generate` 通过；`FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 node node_modules/tsx/dist/cli.mjs scripts/verify-open-position-uniqueness.ts` 通过，当前 `openCount=22 / missingOpenKey=0`；后端/前端 TypeScript 检查通过；SQLite `PRAGMA integrity_check=ok`；`verify-transaction-cost-model` 和 `verify-position-consistency` 通过。

状态：已完成。该节点填补 `GAP-2 API 边界硬化` 中任意 userId 静默创建的问题，以及 `GAP-3 领域服务边界` 中开放持仓账本缺少唯一性约束、并发买入可能破坏成本计算的问题。

## 执行顺序

1. `Asset Identity Resolver`，先保证查的是正确标的。
2. `MarketData Reliability Layer`，保证价格正确、失败透明。
3. 持仓 / 标签 / 类型同步正确性。
4. 分析建议 snapshot 化。
5. AI 选股策略引擎。
6. 测试和观测体系。

## 暂缓事项

在本计划完成前，以下事项不得作为新的开发主线：

- 新的 harnessOS 多 Agent 编排能力。
- 新的非正确性 UI 大改版。
- 新的自动交易能力。
- 新的复杂工作流注册。
- 与查询正确性、行情可靠性、账本一致性无关的扩展功能。

允许例外：

- 修复阻碍本计划执行的基础设施问题。
- 修复导致数据错误、页面错误或任务不可完成的问题。
- 增加验证、测试、监控和文档。

## 2026-05-25 P4.31.1 事实集预热可靠性修复

阶段规则复验：P4.31 的独立事实集预热入口可运行，但 20 样本验证发现 `stockAnalysisService.getFullAnalysis` 会触发历史行情、实时行情、技术面、消息面和完整基本面链路；当东方财富单股/列表接口短时 `curl: (52) Empty reply from server` 时，强制刷新会把原本完整的行业/市值缓存覆盖为缺失事实。该问题会污染 P4 分组稳定性审计，属于 P4.32 前阻断项。

本次修复：

- `FundamentalDataProvider` 增加东方财富全 A 列表快照兜底能力，基础行业/总市值/流通市值从“行业分位增强”中拆出。
- `StockAnalysisFactSet` 在没有行业分位时也写入基础 `em_industry_board`，避免行业分位失败导致基础分组事实缺失。
- `StockScreenerService.preheatScreenerFactsets` 改为轻量预热，只写入选股审计需要的行业/市值基础事实，不再调用完整股票分析链路。
- 预热拿不到有效行业/市值时不写空缓存；读取缓存时优先选择已有完整行业/市值事实的旧缓存，避免“最新但缺失”的缓存覆盖可用证据。
- 强制刷新结果如果过程失败但最终缓存仍有完整覆盖，报告为 recovered warning，不再把可用缓存误判为失败。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:screener-factset-preheat` 通过：`universeSource=sina_hs_a_all_a_share`、`requestedSymbols=1`、`successSymbols=1`、`failureSymbols=0`、`finalFullCoverage=100`。

检视意见：

- 已闭环：预热不会再因为 provider 空回复把完整缓存覆盖成空事实；选股预热路径不再被实时行情接口拖慢。
- 未闭环：东方财富全 A 列表接口当前仍存在短时空回复，20 样本全新覆盖不能作为 P4.32 准入证据。
- 下一步：P4.32 前必须补一个独立 provider 或本地持久化 quote-list 快照，保证全新样本行业/市值覆盖不依赖单一东方财富实时可用性。

## 2026-05-25 P4.31.2 本地 Quote-list 快照缓存

阶段规则复验：P4.31.1 已防止空事实污染缓存，但默认 20 样本仍受东方财富列表接口短时不可用影响，无法证明“全新样本行业/市值覆盖”达标。

本次修复：

- 新增 `backend/data/a-share-quote-list-cache.json`，保存 A 股 quote-list 的行业、总市值、流通市值、抓取时间和来源。
- `FundamentalDataProvider.getEastmoneyQuoteListSnapshots()` 改为优先读取本地持久化快照；仅在设置 `FAMS_REFRESH_QUOTE_LIST_CACHE=1` 时强制刷新外部 provider。
- provider 成功返回非空快照时自动写回本地缓存；provider 失败时读取旧快照，不写空结果。
- 新增 `npm run test:quote-list-cache`，验证 provider 不可用时本地快照仍可支撑行业/市值预热。
- 新增 `npm run run:quote-list-cache-refresh`，用于 provider 恢复后显式刷新全量 quote-list 快照。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:screener-factset-preheat` 通过：`finalFullCoverage=100`、`failureSymbols=0`。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-cache` 通过：缓存样本 10 只，`finalFullCoverage=100`，耗时约 2.1 秒。
- 受控 20 样本预热在当前缓存种子下 `successSymbols=15 / failureSymbols=5 / finalFullCoverage=75%`，未达到 P4.32 准入线。

检视意见：

- 已闭环：本地持久化 quote-list 快照机制已可用，provider 短时失败不会阻断已缓存样本预热。
- 未闭环：当前本地快照只有种子样本，不是完整全 A 快照；P4.32 前必须在 provider 恢复时运行 `npm run run:quote-list-cache-refresh` 或接入第二来源补齐全量行业/市值。

## 2026-05-25 P4.31.3 Quote-list 缓存验收与回退报告修正

阶段规则复验：P4.31.2 已新增本地 quote-list 快照，但刷新脚本在外部 provider 失败后会回退本地缓存，原输出仍可能被误读为“外部刷新成功”。此外需要确认现有 `StockFactSetCache` 是否能反向补齐 quote-list。

本次修复：

- `npm run run:quote-list-cache-refresh` 输出改为区分：
  - `quote_list_cache_refreshed`：外部 provider 返回并写入新快照。
  - `quote_list_cache_refresh_fell_back_to_local_cache`：外部 provider 失败或无有效快照，仅使用本地缓存。
- 新增 `npm run run:quote-list-cache-merge-factsets`，从已有 `StockFactSetCache` 中提取完整 `em_industry_board + em_total_market_cap / em_float_market_cap`，合并到本地 quote-list 缓存。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `npm run run:quote-list-cache-merge-factsets` 通过：`previousItems=16 / mergedItems=0 / finalItems=16`，说明当前 DB 中没有额外可合并的完整行业+市值样本。
- `npm run run:quote-list-cache-refresh` 返回 `quote_list_cache_refresh_fell_back_to_local_cache`、`externalSnapshots=0`，没有误报外部刷新成功。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-cache` 通过，10 个缓存样本 `finalFullCoverage=100`。
- 20 样本预热仍为 `successSymbols=15 / failureSymbols=5 / finalFullCoverage=75%`。

检视意见：

- 已闭环：刷新脚本不会误报，DB 反向合并入口已具备，缓存验收稳定。
- 未闭环：本地 quote-list 样本仍不足，P4.32 准入仍阻断。
- 下一步：接入第二来源生成行业/市值快照，或等待东方财富列表接口恢复后刷新全量 quote-list；未达到 20 样本 >= 80% 前不得进入 P4.32 全量扫描。

## 2026-05-25 P4.31.4 多信源 Quote-list Canonical 与交叉验证

阶段规则复验：P4.31.3 已能避免东方财富失败时误报刷新成功，但行业/市值事实仍依赖单一来源或种子缓存，20 样本覆盖率为 75%，不能支撑 P4.32 全 A 长样本正式扫描。

独立评审结论：本节点不新增选股策略，也不绕过事实集覆盖闸门；先建立至少两个免费来源的 quote-list canonical 层。行业/list status 以 BaoStock 为稳定补充，代码/名称以 AKShare 补充，市值优先走 AKShare spot，其次使用东方财富本地缓存，所有字段保留 sourceRefs、confidence、warnings 和 providerReports。若 AKShare spot 因上游 Eastmoney/proxy 失败，系统必须显式记录 warning，不得把单源市值伪装为多源验证成功。

本次修复：

- 新增 `backend/scripts/providers/a_share_quote_sources.py`，统一抓取 `akshare` 与 `baostock` 免费信源，并输出 `fams.a_share_quote_sources.v1`。BaoStock 负责全 A 基础信息、上市状态和证监会行业；AKShare 负责全 A 代码/名称，并尽力抓取 spot 市值。
- 新增 `backend/scripts/refresh-quote-list-canonical.ts`，合成 `backend/data/a-share-quote-list-canonical.json`。canonical 层合并 `baostock`、`akshare` 和 `eastmoney_local_cache`，记录字段来源、provider 报告、覆盖率、confidence 和 warnings。
- 新增 `backend/scripts/verify-quote-list-canonical.ts` 与 `npm run test:quote-list-canonical`，验证 canonical 文件至少包含 5000 只 A 股、包含三类来源记录，并用 10 个完整样本端到端预热事实集。
- `FundamentalDataProvider` 优先读取 `a-share-quote-list-canonical.json`，缺失时再回退旧的 `a-share-quote-list-cache.json`。
- `preheatScreenerFundamentalFacts` 支持写入“仅行业可用”的部分事实集，避免市值缺失时把 BaoStock 行业覆盖误判为整体失败。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `npm run run:quote-list-canonical-refresh` 通过：`itemCount=5846`；`baostock itemCount=5531`；`akshare itemCount=5522`；`eastmoney_local_cache itemCount=16`；AKShare `stock_zh_a_spot_em` 当前因 Eastmoney/proxy 上游失败，已记录 warning。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过：canonical 10 个完整样本 `finalFullCoverage=100`。
- 受控 20 样本预热通过本阶段最低准入：`attemptedSymbols=20`、`successSymbols=16`、`failureSymbols=4`、`finalFullCoverage=80%`，并报告 1 个过程失败但最终缓存复核已覆盖。

检视意见：

- 已闭环：quote-list canonical 框架已落地；行业/list status 不再依赖东方财富单点；provider 失败会进入 warning 和 providerReports；20 样本达到当前 P4.31 覆盖阈值。
- 未闭环：市值多源覆盖仍不足，完整行业+市值 `fullCoverageCount=16 / 5846`。原因是 BaoStock 不直接提供市值，AKShare 市值接口当前受 Eastmoney/proxy 上游失败影响，现阶段仍主要依赖东方财富本地种子缓存。
- 下一步：P4.32 前继续补市值第二来源，优先方案是用 BaoStock 总股本/流通股本结合可靠实时或收盘价推导总市值/流通市值，并与东方财富/AKShare 恢复后的市值做差异校验；未完成前，真实全 A 长样本只能作为受控 dry-run，不能标记高可信验收。

## 2026-05-26 P4.31.5 BaoStock 派生流通市值第二来源

阶段规则复验：P4.31.4 已有 BaoStock + AKShare + 东方财富本地缓存的 canonical 框架，但市值完整覆盖只有 `16 / 5846`，20 样本虽然达到 80%，仍不足以支撑下一阶段全 A 长样本正式验收。

独立评审结论：BaoStock 不直接给总市值/流通市值，但日线字段提供 `close / volume / turn`。其中 `turn` 是换手率百分比，可用 `close * volume * 100 / turnover_rate_percent` 推导流通市值。该值与东方财富市值字段来自不同接口链路，适合作为当前市值第二来源。由于 BaoStock 日线需要逐标的查询，本节点只做默认 120 只受控补齐，后续全量补齐必须迁入 Operation/worker 或显式设置全量上限，不能在前端同步触发。

本次修复：

- `a_share_quote_sources.py` 的 BaoStock provider 新增流通市值派生逻辑，默认按股票代码顺序补齐前 120 个已上市标的。
- 新增环境变量 `FAMS_BAOSTOCK_FLOAT_CAP_LIMIT`：默认 `120`；设置为 `0` 可尝试全量派生，后续应交给后台任务执行。
- canonical refresh 保留 BaoStock 派生市值的 `sourceRefs` 和 provider warning，便于审计本轮覆盖范围。
- `test:quote-list-canonical` 门槛收紧：canonical 必须至少有 100 个行业+市值完整样本，且至少 100 个为多 provider 完整样本。

验证：

- `npm run run:quote-list-canonical-refresh` 通过：`itemCount=5846`，`fullCoverageCount=121`，`multiProviderFullCoverageCount=121`；BaoStock 报告 `derived float market cap count=119, failed=0`；AKShare spot 市值接口仍因 Eastmoney/proxy 上游失败进入 warning。
- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过：10 个完整样本 `finalFullCoverage=100`，且新门槛 `multiProviderFullCoverageCount >= 100` 通过。
- 受控 20 样本事实集预热通过：`attemptedSymbols=20`、`successSymbols=20`、`failureSymbols=0`、`finalFullCoverage=100%`、无 warning。

检视意见：

- 已闭环：市值第二来源已接入，默认 20 样本事实集覆盖从 80% 提升到 100%；P4.31 事实集覆盖补齐可进入收口状态。
- 未闭环：多源完整覆盖仍只有 121 只，不足以代表真实全 A。下一步不能直接跑高可信 P4.32，而应先把 BaoStock 派生市值补齐迁入可恢复、可取消、可限速的 Operation/worker，并做全量耗时与 provider health 验收。

## 2026-05-26 P4.31.6 市值补齐 Operation 化第一段

阶段规则复验：P4.31.5 已证明 BaoStock 派生流通市值可用，但同步 canonical refresh 默认 120 只耗时约 90 秒，不能直接扩展为前端同步全量刷新。

独立评审结论：本节点只把市值补齐从“同步脚本逻辑”推进到“Operation + chunk task + artifact”的可审计形态；先做小样本端到端验证，不直接跑 5500 只全量，避免长时间占用外部 provider。

本次修复：

- `a_share_quote_sources.py` 新增 `--provider baostock_market_cap --symbols ...`，只查询指定标的日线并派生流通市值，不再每个 chunk 重拉全量基础表。
- 新增 `run:quote-list-market-cap-warmup`，创建 `quote_list_market_cap_warmup` Operation，按 chunk 写入 `OperationTask`，支持跳过已完成 chunk、检查 `cancelRequested`、增量写回 canonical，并生成 `quote_list_market_cap_warmup_report.json` artifact。
- 脚本参数：
  - `FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_LIMIT`：本轮最多补齐多少只，默认 40。
  - `FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_CHUNK_SIZE`：每个 chunk 的标的数，默认 10。
  - `FAMS_OPERATION_ID`：指定已有 Operation 以恢复执行。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 小样本 Operation `2ea5e944-f57d-4b0d-8a32-900291dee293`：`requestedSymbols=5`、`successCount=5`、`failureCount=0`，canonical 覆盖从 `121` 提升到 `126`。
- 数据库复核：Operation 状态 `completed`，`progressCurrent=5 / progressTotal=5`，2 个 `OperationTask` 均为 `completed`，artifactRefs 包含 `quote_list_market_cap_warmup_report.json`。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过：`fullCoverageCount=126`、`multiProviderFullCoverageCount=126`、验证样本 `finalFullCoverage=100`。
- 20 样本事实集预热通过：`successSymbols=20`、`failureSymbols=0`、`initialFullCoverage=100`、`finalFullCoverage=100`。

检视意见：

- 已闭环：市值补齐具备 Operation / task / artifact 形态，小样本可查询、可恢复、可审计。
- 未闭环：该 Operation 仍是脚本入口，尚未接入任务中心按钮和长期 worker 类型白名单；provider health 尚未按 chunk 写入统一健康表。P4.32 前应继续补前端任务中心入口、worker `runNextQueuedOperation` 支持和全量限速验收。

## 2026-05-26 P4.31.7 市值补齐任务中心与 Worker 接入

阶段规则复验：P4.31.6 已有小样本脚本 Operation，但正式 `OperationService.runNextQueuedOperation` 白名单和任务中心入口尚未覆盖 `quote_list_market_cap_warmup`，前端用户无法从任务中心提交该任务。

独立评审结论：本节点只补正式任务入口和 worker 领取能力，不做全量 5500 只市值补齐；默认任务中心提交 `limit=40 / chunkSize=10 / executionMode=queued`，先保证任务可排队、可取消、可恢复、可查看 artifact。

本次修复：

- `OperationService` 新增 `startQuoteListMarketCapWarmupOperation`，支持 inline/queued、idempotencyKey、retry、server startup recovery 和 `runNextQueuedOperation` worker 领取。
- `OperationService.executeQueuedOperation`、`recoverInterruptedOperations`、`retryOperation` 均加入 `quote_list_market_cap_warmup`。
- 后端新增 `POST /api/v1/operations/quote-list-market-cap-warmup`。
- 前端任务中心新增“补齐市值”按钮，提交 queued 市值补齐任务；任务类型展示为“市值补齐”，摘要展示请求数、成功数、失败数和完整覆盖数。
- 新增 `npm run test:quote-list-market-cap-worker`，验证 queued Operation 被正式 worker 领取、chunk task 写入、artifact 可读取。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 手工 worker 验证 Operation `aa1965d1-5c35-4fec-9955-94f5bb058930`：queued 后被 `runNextQueuedOperation` 领取，状态 `completed`，2 个 task 均 `completed`。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-market-cap-worker` 通过：Operation `bc363972-b4fc-43b5-9f08-846bc87d0983`，2 个 chunk task 均成功，artifactRefs 包含 `quote_list_market_cap_warmup_report.json`。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过：`fullCoverageCount=130`、`multiProviderFullCoverageCount=130`、验证样本 `finalFullCoverage=100`。
- 20 样本事实集预热通过：`successSymbols=20`、`failureSymbols=0`、`initialFullCoverage=100`、`finalFullCoverage=100`。

检视意见：

- 已闭环：市值补齐已从脚本推进到正式任务中心入口和 worker 领取链路，可查询、可取消、可恢复、可查看 artifact。
- 未闭环：provider health 尚未统一写入 `provider_health`；全量 5500 只市值补齐仍未做限速耗时验收。P4.32 前下一步先补 provider health 上报和 200-500 只受控样本限速验收。

## 2026-05-26 P4.31.8 Provider Health 与受控样本限速验收

阶段规则复验：P4.31.7 已完成任务中心入口和 worker 领取，但 `baostock_market_cap` 的调用结果没有写入统一 `provider_health`，任务产物缺少数据源健康快照。

独立评审结论：本节点先完成 provider health 统一上报，并以任务中心默认规模 `limit=40 / chunkSize=10` 做受控样本限速验收；暂不直接跑 5500 只全量。

本次修复：

- `quote_list_market_cap_warmup` 每个 chunk 完成后写入 `provider_health`：
  - provider: `baostock_market_cap`
  - endpoint: `quote_list_market_cap`
  - requestCount / successCount / failureCount / badDataCount
  - avgLatencyMs / p95LatencyMs
  - status / circuitState / cooldownUntil / consecutiveFailures
  - metricsJson 保存最近 chunk 的 symbolCount、成功失败、耗时和 warnings。
- `quote_list_market_cap_warmup_report.json` artifact 增加最终 provider health 快照。
- `npm run test:quote-list-market-cap-worker` 增加 provider health 断言，防止 worker 链路绕过健康上报。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-market-cap-worker` 通过：provider health `status=healthy`、`endpoint=quote_list_market_cap`、`successCount>=4`。
- 受控 40 样本 worker 验收 Operation `c61f3a33-e2d4-42f4-8169-86690ea6b8f7`：`requestedSymbols=40`、`successCount=40`、`failureCount=0`、耗时约 `11904ms`，4 个 chunk 均完成。
- provider health 复核：`requestCount=8`、`successCount=48`、`failureCount=0`、`badDataCount=0`、`status=healthy`、`circuitState=closed`。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过：`fullCoverageCount=182`、`multiProviderFullCoverageCount=182`、验证样本 `finalFullCoverage=100`。
- 20 样本事实集预热通过：`successSymbols=20`、`failureSymbols=0`、`initialFullCoverage=100`、`finalFullCoverage=100`。

检视意见：

- 已闭环：市值补齐具备任务中心入口、worker 执行、chunk task、artifact、provider health 和 40 样本限速验收。
- 未闭环：尚未做 200-500 只中样本验收，也未证明 5500 只全量在当前 SQLite/WSL/外部 provider 下可接受。P4.32 前下一步建议跑 200 只受控样本并记录耗时、失败率和 provider health；若稳定，再进入 P4.32 长样本扫描。

## 2026-05-27 P4.31.9 200 样本市值补齐验收与 Task Partial 修正

阶段规则复验：P4.31.8 已完成 40 样本限速验收，但仍需更接近 P4.32 前置规模的中样本验证。

本次修复：

- 运行 200 只市值补齐中样本 Operation。
- 修正 `OperationTask` 状态语义：chunk 部分成功时标记为 `partial`，不再误标为 `failed`。
- 修正 `OperationTask.inputJson`：最终更新 task 时保留首次写入的 symbols，便于任务中心准确展示失败标的。

验证：

- 200 样本 Operation `3573fc2e-44cb-43e6-a583-cf91ed7f203b`：`requestedSymbols=200`、`successCount=199`、`failureCount=1`、耗时约 `40202ms`，状态为 `partial`。
- 唯一失败标的：`000638`，原因是 BaoStock 日线缺少可用于推导市值的 `close / volume / turn`。
- provider health：`status=healthy`、`circuitState=closed`、`requestCount=18`、`successCount=247`、`failureCount=1`、`badDataCount=1`。
- 修正后复测 Operation `d628f7bd-7111-4d4a-a057-2433ac577c9b`：chunk 状态正确为 `partial`，input 保留 `["000638","000952"]`。
- 后端和前端 TypeScript 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过：`fullCoverageCount=382`、`multiProviderFullCoverageCount=382`。
- 20 样本事实集预热通过：`successSymbols=20`、`failureSymbols=0`、`finalFullCoverage=100`。

检视意见：

- 已闭环：中样本市值补齐成功率 `99.5%`，单标的坏数据被正确保留为 partial，不污染整体结果。
- 未闭环：全 A 级别仍不能直接假设可跑通；但 P4.31 的行业/市值覆盖、provider health、任务中心和 worker 链路已满足进入 P4.32 受控长样本 dry-run 的条件。

## 2026-05-27 P4.32.1 长样本 Dry-run 与 Canonical Factset 口径修正

阶段规则复验：进入 P4.32 前复验 P4.31.9，200 样本市值补齐稳定，provider health 仍为 healthy / closed。

本次修复：

- `StockScreenerService.enrichUniverseWithCachedFundamentals` 在 `StockFactSetCache` 缺失或不完整时，继续读取 canonical quote-list 的行业和市值。
- `factset_preheat_coverage` 的正式来源口径加入 `fams_quote_list_canonical / eastmoney_quote_list_cache / eastmoney_quote_list`，不再只把 `eastmoney_fundamental_cache` 计为正式事实来源。
- 修正后 P4.32 dry-run 的 factset coverage gate 能反映 canonical quote-list 的实际覆盖。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过。
- 首次 P4.32 dry-run Operation `a3172c20-e456-46d7-8c79-01f081e5338d`：`factset_coverage=16.67%`，暴露扫描口径未使用 canonical 的问题。
- 修正后复跑 P4.32 dry-run Operation `f88fb593-229a-4241-984a-9789fea4db58`：`factset_coverage=100%` 并通过 warning gate；`providerSuccessRate=100%`、`cacheHitRate=100%`、`backtestDays=60` 均通过。
- 当前仍未通过的 blocker：`universe_coverage=2.17% < 80%`、`trade_sample_size=83 < 100`、`validation_evidence=0`。

检视意见：

- 已闭环：P4.32 的事实集覆盖阻断解除，行业/市值事实链路与 canonical 数据源一致。
- 未闭环：P4.32 不能标记通过。下一步应扩大扫描覆盖和成交样本量，先做 500-1000 只受控长样本，再评估是否进入真实全 A 长样本。

## 2026-05-27 P4.32.2 500 样本受控长样本验收与缺口闭环

阶段规则复验：复跑 P4.31/P4.32 验收链路。后端和前端 TypeScript 均通过；`test:quote-list-canonical` 通过；事实集 20 样本预热 `finalFullCoverage=100`；120 样本 dry-run 仍可完成并保持 `providerSuccessRate=100% / cacheHitRate=100%`。

独立评审结论：P4.32.1 的主要问题不是策略逻辑，而是验收入口固定 120 样本，无法按 300/500/1000 逐级扩大覆盖。直接跑真实全 A 仍不合适，先新增受控长样本入口，并把 500 样本作为下一道分阶段验收。

本次修复：

- `run-long-sample-dry-run.ts` 支持环境变量配置：
  - `FAMS_LONG_SAMPLE_SCAN_LIMIT`
  - `FAMS_LONG_SAMPLE_BACKTEST_DAYS`
  - `FAMS_LONG_SAMPLE_HOLDING_DAYS`
  - `FAMS_LONG_SAMPLE_CHUNK_SIZE`
  - `FAMS_LONG_SAMPLE_SKIP_FACTSET_PREHEAT`
  - `FAMS_LONG_SAMPLE_QUERY`
- 新增 `npm run run:long-sample-controlled`，默认以 500 样本、100 分片运行同一套 Operation 和 `long_sample_acceptance.json` gate。
- `quote_list_market_cap_warmup` 对 BaoStock 无法派生市值的标的写入结构化 `failedSymbols`，artifact 可直接定位失败标的和原因。
- 对已确认无法派生流通市值的 canonical 标的写入 `BaoStock 派生流通市值缺失` warning，后续 warmup 默认跳过，避免同一个坏数据反复占用补齐名额。
- `test:quote-list-market-cap-worker` 验收口径改为允许 `partial`，但必须断言成功数、失败数、失败原因、artifact 和 provider health，防止把坏数据误报为成功。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过，canonical 覆盖从 `382` 提升到 `437`，`finalFullCoverage=100`。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-market-cap-worker` 首次验证遇到坏数据时返回 `partial`，`totalSuccess=3 / totalFailure=1`，provider health 为 `healthy`；再次验证跳过已确认坏数据后返回 `completed`，`totalSuccess=4 / totalFailure=0`。
- 500 样本首次受控 dry-run Operation `6956dd1c-3a7b-4787-a919-e94c66bf21e4`：`scannedCount=500`、`evaluatedCount=499`、`providerSuccessRate=99.8%`、`cacheHitRate=24.2%`、`bestSampleSize=234`、`bestCredibility=medium`；失败项为全 A 覆盖、缓存命中率和事实集覆盖。
- 补齐市值后，500 样本事实集预热复验：`requestedSymbols=500`、`initialFullCoverage=87.2%`、`finalFullCoverage=87.2%`，factset warning gate 已解除。
- 500 样本复跑 Operation `d772c4ae-91bb-45fd-a140-a1c385c1f104`：`scannedCount=500`、`evaluatedCount=499`、`failureCount=1`、`providerSuccessRate=99.8%`、`cacheHitRate=99.43%`、`backtestDays=60`、`bestSampleSize=234`、`bestCredibility=medium`。
- 500 样本复跑后唯一未通过 blocker：`universe_coverage=9.05% < 80%`。该 blocker 符合当前分阶段策略，不能标记 P4.32 全量通过。

检视意见：

- 已闭环：P4.32 在 500 样本受控规模下，行情 provider、缓存命中率、事实集覆盖、成交样本量和 medium 可信度均达到阶段性要求。
- 未闭环：真实全 A 覆盖仍未通过。下一阶段不能新增策略，应继续做 1000 样本和更高覆盖的预热/扫描验收，并观察 SQLite/WSL 下耗时、失败率和 artifact 体积；达到稳定后再评估 80% 全 A 覆盖 gate。

## 2026-05-27 P4.32.3 1000 样本受控长样本验收

阶段规则复验：P4.32.2 已在 500 样本下闭环 provider、缓存、事实集和成交样本量，但 1000 样本准入前必须重新检查缓存缺口和事实集覆盖，不能直接扩大扫描。

独立评审结论：1000 样本可作为下一阶段验收，但必须先做两类预热：

- `market_bar_canonical` 覆盖预热，目标缓存命中率大于 80%。
- quote-list canonical 市值补齐，目标扫描样本事实集覆盖大于 80%。

本次执行：

- 1000 样本事实集预检：`initialFullCoverage=43.6%`，不满足准入。
- 1000 样本行情缓存预热：补齐 506 个缓存缺口，耗时 `655210ms`，拉取 `60105` 条 K 线。
- 市值补齐：先误用旧环境变量触发默认 40 样本，后使用 `FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_LIMIT=500` 正确补齐 500 样本。
- quote-list canonical 完整覆盖从 `437` 提升到 `975`。

验证：

- `FAMS_MARKET_BAR_PREHEAT_LIMIT=1000 FAMS_MARKET_BAR_PREHEAT_DAYS=120 npm run run:market-bar-cache-preheat` 完成：
  - before：`sufficientSymbols=494`、`insufficientSymbols=506`、`estimatedCacheHitRate=49.69%`
  - after：`sufficientSymbols=992`、`insufficientSymbols=8`、`estimatedCacheHitRate=99.47%`
  - warning 样本主要为上市时间不足导致返回天数少，不作为 provider 失败处理。
- `FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_LIMIT=500 FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_CHUNK_SIZE=20 npm run run:quote-list-market-cap-warmup` 完成：
  - `requestedSymbols=500`
  - `successCount=499`
  - `failureCount=1`
  - final canonical coverage：`fullCoverageCount=975`、`multiProviderFullCoverageCount=975`
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过，`finalFullCoverage=100`。
- 1000 样本事实集复检：`requestedSymbols=1000`、`initialFullCoverage=97.4%`、`finalFullCoverage=97.4%`。
- 1000 样本受控长样本 Operation `f0bd05f5-2c61-47cd-973f-bbe07b9d954e`：
  - status：`partial`
  - `scannedCount=1000`
  - `evaluatedCount=997`
  - `failureCount=3`
  - `scanCoveragePercent=18.11%`
  - `providerSuccessRate=99.7%`
  - `cacheHitRate=99.52%`
  - `backtestDays=60`
  - `rankedCandidates=108`
  - `bestSampleSize=488`
  - `bestCredibility=medium`
- 唯一未通过 blocker：`universe_coverage=18.11% < 80%`。

检视意见：

- 已闭环：1000 样本下 provider 成功率、缓存命中率、事实集覆盖率和成交样本量全部达到阶段要求，策略证据保持 medium。
- 未闭环：P4.32 仍不能标记为全 A 长样本通过，因为扫描覆盖仅 `18.11%`。下一步应继续分阶段推进 2000 样本前置预热，或先把长样本 worker/数据库性能与 artifact 体积做专项验收，避免一次性冲击 80% 全 A 覆盖。

## 2026-05-27 P4.32.4 2000 样本受控长样本验收

阶段规则复验：P4.32.3 已证明 1000 样本可达到 medium 证据，但继续扩大前需要重新做缓存和事实集准入。首次 2000 样本事实集预检暴露 `preheatScreenerFactsets` 内部 `maxScan` 被硬限制为 1000，不能真实检查 2000 样本。

独立评审结论：

- 先修复事实集预热上限，再做 2000 样本准入。
- 2000 样本预热耗时预计显著增加，必须记录耗时和 SQLite 风险。
- 若准入满足，再运行 2000 样本 long-sample；若 SQLite/worker 出现阻断，则停止扩大样本，转入性能专项。

本次修复：

- `StockScreenerService.preheatScreenerFactsets` 的 `maxScan` 上限从 `1000` 放宽到 `6000`，使 2000 样本和后续全 A 分阶段验收可以真实执行。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 2000 样本 market bar 预热：
  - `requestedSymbols=2000`
  - `attemptedSymbols=1008`
  - `elapsedMs=1648185`
  - `fetchedBars=120275`
  - before：`sufficientSymbols=992`、`insufficientSymbols=1008`、`estimatedCacheHitRate=49.83%`
  - after：`sufficientSymbols=1987`、`insufficientSymbols=13`、`estimatedCacheHitRate=99.68%`
  - warning：`300534` 在 provider health upsert 时触发 SQLite timeout，标记为数据库性能风险。
- 2000 样本 quote-list 市值补齐：
  - Operation `739a33b0-6da9-4a09-a402-2364f4839b16`
  - `requestedSymbols=1000`
  - `successCount=995`
  - `failureCount=5`
  - canonical coverage：`975 -> 1970`
- 2000 样本事实集复检：
  - `requestedSymbols=2000`
  - `initialFullCoverage=98.45%`
  - `finalFullCoverage=98.45%`
- 2000 样本受控长样本 Operation `f9cfc6b9-874a-41f5-b9bd-5aa1def19ede`：
  - status：`partial`
  - elapsed：约 `7分23秒`
  - artifactRefs：`17`
  - `scannedCount=2000`
  - `evaluatedCount=1997`
  - `failureCount=3`
  - `scanCoveragePercent=36.21%`
  - `providerSuccessRate=99.85%`
  - `cacheHitRate=99.71%`
  - `backtestDays=60`
  - `rankedCandidates=108`
  - `bestSampleSize=828`
  - `bestCredibility=high`
- 唯一未通过 blocker：`universe_coverage=36.21% < 80%`。

检视意见：

- 已闭环：2000 样本阶段 provider、缓存、事实集、成交样本量全部达到阶段要求，并首次产生 `high` 级最佳策略证据。
- 未闭环：P4.32 仍不能标记为全 A 长样本通过，因为扫描覆盖只有 `36.21%`。
- 新增阻断风险：SQLite 在 2000 样本预热中出现 provider health 写入超时。下一步不应盲目直接冲 80% 覆盖，应先把 market bar 预热和 quote-list 市值补齐迁入正式 Operation/worker，并做 SQLite 写入压力、artifact 体积和恢复能力专项验收；之后再推进 3000/4500 样本。

## 2026-05-28 P4.33.1 Market Bar 预热 Operation 化第一段

阶段规则复验：P4.32.4 暴露 2000 样本 market bar 预热耗时 `1648185ms`，并出现一次 SQLite `providerHealth.upsert` timeout。继续扩大样本前，不能再依赖同步脚本黑盒长跑，必须迁入 Operation/worker。

本次修复：

- 新增 Operation 类型 `market_bar_cache_preheat`。
- 新增 `startMarketBarCachePreheatOperation` 和 worker 执行路径，支持：
  - `limit`
  - `days`
  - `chunkSize`
  - `concurrency`
  - `forceRefresh`
  - `executionMode=inline/queued`
- 执行流程：
  - 通过全 A universe 取前 N 个标的。
  - 调用 `marketBarCacheService.getCoverageReport` 生成 before coverage。
  - 只对缺口或 stale 标的分片预热。
  - 每个 chunk 写入 `OperationTask`，记录 success/failure/warning/cacheHitRate/fetchedBars/provider。
  - 完成后生成 `market_bar_cache_preheat_report.json` artifact。
- `runNextQueuedOperation / executeQueuedOperation / recoverInterruptedOperations / retryOperation` 均支持 `market_bar_cache_preheat`。
- 后端新增 `POST /api/v1/operations/market-bar-cache-preheat`。
- 前端任务中心新增：
  - 类型标签 `K线预热`
  - 列表摘要：样本、预热数、成功数、警告数、命中率
  - 顶部按钮 `预热K线`

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前后端已启动：
  - frontend: `http://localhost:3000/`
  - backend: `http://localhost:4000/`
- 前端代理访问 Operation API 成功。
- 提交小样本 queued Operation `c2bb9772-d05f-4793-9e8f-16f81687fe27`：
  - `POST /api/v1/operations/market-bar-cache-preheat`
  - `limit=4`
  - `days=120`
  - `chunkSize=2`
  - `concurrency=2`
  - `executionMode=queued`
- `npm run run:operation-worker-once` 成功领取并执行：
  - status：`completed`
  - type：`market_bar_cache_preheat`
  - artifactRefs：`market_bar_cache_preheat_report.json`
- 前端代理读取详情成功：
  - `requestedSymbols=4`
  - `attemptedSymbols=1`
  - `successCount=1`
  - `warningCount=0`
  - `failureCount=0`
  - `fetchedBars=120`
  - before/after coverage 均可读。
- artifact 读取成功：`operation_artifact:c2bb9772-d05f-4793-9e8f-16f81687fe27:market_bar_cache_preheat_report.json`。

检视意见：

- 已闭环：market bar 预热已具备 Operation 状态持久化、queued worker 领取、chunk task、artifact 和前端入口。
- 未闭环：仍需做取消/恢复专项、2000 样本 queued 验收、SQLite timeout 复现与写入压力优化；完成前不继续冲 80% 全 A 覆盖。

## 2026-05-28 P4.33.2 Market Bar 预热 Worker 验收脚本与恢复闭环

阶段规则复验：P4.33.1 已完成 K 线预热 Operation 化，但取消、过期 lease 恢复和 artifact schema 还没有独立脚本持续验收。本阶段先补验收工具，不扩大样本。

本次修复：

- 新增 `backend/scripts/verify-market-bar-cache-preheat-worker.ts`。
- 新增 npm script：`npm run test:market-bar-cache-preheat-worker`。
- 验收覆盖：
  - 创建 `market_bar_cache_preheat` queued Operation。
  - worker 按类型白名单领取并执行。
  - 断言 Operation 完成后释放 `leaseOwner / leaseToken / leaseExpiresAt`。
  - 断言 chunk `OperationTask` 写入 `taskType=market_bar.cache_preheat`、`cacheHitRate`、成功/失败计数。
  - 断言 `market_bar_cache_preheat_report.json` artifact 可读取，且包含 before/after coverage 与 chunkReports。
  - 断言 queued 任务可立即取消，并设置 `cancelRequested=true`。
  - 构造过期 lease 的 running 任务，验证 worker 可恢复并记录 `recovery.reason=expired_lease_worker_recovery`。
- 修复验收发现的问题：`market_bar_cache_preheat` 的 `resultJson` 缺少 schemaVersion。现已补充 `schemaVersion=fams.market_bar.cache_preheat_result.v1`，便于任务中心和审计脚本稳定识别产物结构。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:market-bar-cache-preheat-worker` 通过。
- 验收 Operation `4bc2e7bf-8e04-43bc-8da7-be2f23eb9023`：
  - status：`completed`
  - `requestedSymbols=4`
  - `attemptedSymbols=1`
  - `successCount=1`
  - `failureCount=0`
  - `fetchedBars=120`
  - artifactRefs：`market_bar_cache_preheat_report.json`
- 取消验收 Operation `209688b0-ece9-414a-9a31-6e3175ce9180`：
  - status：`cancelled`
  - `cancelRequested=true`
- 过期 lease 恢复验收 Operation `69bf14eb-8bd3-4712-bfb2-24144ed1a2fc`：
  - status：`completed`
  - recovery reason：`expired_lease_worker_recovery`

检视意见：

- 已闭环：market bar 预热现在具备可重复的 worker、取消、恢复、产物 schema 验收。
- 仍未闭环：尚未做 2000 样本 queued 预热压力验收，也未复现/优化 SQLite provider health 写入 timeout。下一步进入 P4.33.3：小到中样本 queued 预热压力验证，记录耗时、cache hit、任务体积、provider health 写入表现，再决定是否直接跑 2000 或先做 SQLite 写入节流。

## 2026-05-28 P4.33.3 Market Bar 预热 queued 压力验收第一段

阶段规则复验：P4.33.2 的 `test:market-bar-cache-preheat-worker` 复跑通过，确认 queued worker、取消和过期 lease 恢复仍可用。独立评审结论：本阶段不直接跑 2000 样本，先补压力脚本和 SQLite 写入节流，再用 40/80 样本验证。

本次修复：

- `MarketBarCacheService` 新增统一写入队列，把以下写操作串行化：
  - `providerHealth.upsert/update`
  - `marketBarRaw.upsert`
  - `marketBarCanonical.upsert`
- 目的：降低 SQLite 下 provider health 与 raw/canonical 大量 upsert 并发写导致的 `timeout / database is locked` 风险。
- 新增压力脚本 `backend/scripts/run-market-bar-cache-preheat-pressure.ts`。
- 新增 npm script：`npm run run:market-bar-cache-preheat-pressure`。
- 压力脚本能力：
  - 创建 `market_bar_cache_preheat` queued Operation。
  - 由 worker 按类型领取并执行。
  - 输出耗时、requested/attempted/success/failure/fetchedBars。
  - 输出 chunk 数、失败 chunk、平均 cache hit、最大 chunk duration。
  - 输出 artifact 体积和 chunkReports 数。
  - 输出 `sina` provider health 快照。
  - 若出现 failed chunk、timeout 或 database locked，脚本直接失败。
- 修复压力验收发现的正确性问题：刷新后仍 stale 或仍缺 K 线时，Operation 不能标为 completed。现在完成后会检查 `afterCoverage.items`：
  - 若仍有 `!sufficient` 标的，写入 `coverageWarnings`。
  - `result.coverageWarningCount > 0`。
  - Operation 状态变为 `partial`。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- P4.33.2 复验脚本通过：
  - Operation `e2a30f09-81ee-4763-8703-805774f459bd` completed。
  - 取消 Operation `3264e161-d334-4731-811a-0a492f75ec61` cancelled。
  - 恢复 Operation `2ec254f2-1b87-4cfb-a441-f418eb2ec3be` completed。
- 80 样本强制刷新压力验收通过：
  - Operation `36ef53b1-ce33-4106-85a3-07efc29a8a76`
  - status：`completed`
  - elapsedMs：`166912`
  - requested/attempted：`80/80`
  - success/failure：`80/0`
  - fetchedBars：`9600`
  - chunkReports：`4`
  - reportBytes：`17600`
  - provider：`sina healthy / closed`
  - 未出现 timeout 或 database locked。
- 4 样本 post-coverage 验证通过：
  - Operation `a06153c5-0f7a-4d80-b861-cf8b09616750`
  - status：`partial`
  - `coverageWarningCount=1`
  - 说明刷新后仍 stale 的标的已不再假成功。
- 40 样本强制刷新压力验收通过：
  - Operation `fbf8883f-1bfe-4c71-862b-da5bf0dfc6dc`
  - status：`partial`
  - elapsedMs：`87634`
  - requested/attempted：`40/40`
  - success/failure：`40/0`
  - `coverageWarningCount=1`
  - fetchedBars：`4800`
  - chunkReports：`2`
  - reportBytes：`9448`
  - provider：`sina healthy / closed`
  - 未出现 timeout 或 database locked。

检视意见：

- 已闭环：K 线预热已具备 queued 压力脚本、SQLite 写入节流、post-coverage partial 判定和中样本验收数据。
- 重要发现：缓存命中率为 100% 不等于覆盖充分；stale 标的必须通过 afterCoverage 单独判断。本节点已修正假成功。
- 性能结论：串行写入在 SQLite 下更稳定，但 40 样本约 87 秒，80 样本约 167 秒，按线性估算 2000 样本约 70 分钟，不适合继续靠 SQLite 长跑。
- 下一步 P4.33.4：先做 200/300 样本 queued 压力或增加批量 upsert/PG 迁移评审；若继续用 SQLite，必须保持受控限速，不应直接冲全 A 80% 覆盖。

## 2026-05-28 P4.33.4 Market Bar 批量写入优化

阶段规则复验：P4.33.3 已证明写库串行化可以避免 SQLite timeout，但性能仍偏慢。独立评审结论：下一步优先减少 SQL 写操作数量，而不是继续调大外部 provider 并发。

本次修复：

- `MarketBarCacheService.upsertBars` 从逐条 upsert 改为批量写入：
  - 先按 tradeDate 去重。
  - 删除当前 `symbol + provider + tradeDate` 范围内旧 raw。
  - 删除当前 `symbol + tradeDate + canonical.v1` 范围内旧 canonical。
  - `createMany` 批量写入 raw。
  - 批量查询 raw id/hash。
  - `createMany` 批量写入 canonical。
- 单只股票 120 日 K 线从约 240 次 raw/canonical upsert，降为一个事务内 5 个批量操作。
- `sourceRefsJson` 仍保留：
  - `rawId`
  - `symbol`
  - `tradeDate`
  - `provider`
  - `hash`

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 4 样本强制刷新：
  - Operation `d36fad70-b439-440e-9ecd-4a1041c0dab6`
  - elapsedMs：`6756`
  - 上一轮同口径约 `18032`
  - 最大 chunk duration：`2643`
  - 上一轮同口径约 `14051`
  - status：`partial`
  - `coverageWarningCount=1`
  - 无 timeout/database locked。
- 40 样本强制刷新：
  - Operation `89868019-570d-4acd-bd2a-4fcfc32fa2d3`
  - elapsedMs：`26681`
  - 上一轮同口径约 `87634`
  - 最大 chunk duration：`12706`
  - 上一轮同口径约 `42481`
  - success/failure：`40/0`
  - `coverageWarningCount=1`
  - 无 timeout/database locked。
- 80 样本强制刷新：
  - Operation `8dc4706f-ebfb-4dfc-acf6-4d7c7536d2e0`
  - elapsedMs：`49169`
  - 上一轮同口径约 `166912`
  - maxDurationMs：`12624`
  - success/failure：`80/0`
  - fetchedBars：`9600`
  - reportBytes：`17741`
  - provider：`sina healthy / closed`
  - 无 timeout/database locked。

检视意见：

- 已闭环：SQLite 下 K 线预热写入吞吐明显改善，40/80 样本耗时约下降 69%-71%，且没有牺牲 raw/canonical 血缘。
- 仍未闭环：全 A 级别仍受外部 provider 网络速度和 SQLite 单写事务限制。按 80 样本 49 秒粗估，2000 样本仍可能在 20 分钟量级；继续全量推进前，应补 200/300 样本压力和增量缺口拉取，不应默认 force refresh。
- 下一步 P4.33.5：实现“只补缺失交易日”的增量拉取，避免 stale/少量缺口标的每次重拉 120 日。

## 2026-05-28 P4.34 GPT 架构评审整合：扫描读缓存，行情同步独立化

评审结论：

- P4.33 的批量写入、串行 DB writer、压力脚本方向正确，但还只是优化当前实现。
- FAMS 的目标架构必须从“选股扫描边拉行情边算策略”升级为“行情同步是基础设施，选股扫描只读本地 canonical / feature cache”。
- SQLite 短期可继续承载本地开发，但不能依赖多 writer 并发写；Prisma `createMany(skipDuplicates)` 不作为 SQLite 方案前提，后续若需要冲突合并应实现数据库 adapter：
  - SQLite：raw SQL multi-row `INSERT ... ON CONFLICT DO UPDATE / DO NOTHING`。
  - PostgreSQL：COPY/staging + `INSERT ... ON CONFLICT`。
- 中期要建设：
  - `market_data_coverage`
  - fetch / validate / persist pipeline
  - provider health chunk 级聚合写
  - `market_feature_daily`
  - `stock_screening.run` 与 `strategy_tournament.run` 解耦。

新的主线规则：

1. `stock_screening.run` 默认只读本地 canonical / feature cache。
2. 缓存不足时，不在扫描任务内实时拉全量外部 K 线；应返回 warmup blocker 或关联 `market_data.warmup` Operation。
3. `market_data.warmup / market_data.sync_daily` 负责拉外部 provider、写 raw/canonical、更新 coverage、刷新 feature cache。
4. 用户触发 AI 选股时，系统应主要做本地读和策略计算。
5. 回测证据应复用已有批次，不应每次用户筛选都重复全量回测。

后续分阶段计划：

- P4.34.1：禁用扫描默认实时拉 K 线，只读 canonical cache；保留显式 `允许实时行情=1` 开关用于人工诊断。
- P4.34.2：新增 `market_data_coverage` 表和 coverage service，替代每次扫描临时查 5500 × N 根 K 线。
- P4.34.3：把缓存不足改为 `NEEDS_MARKET_DATA_WARMUP`，并自动创建/关联 `market_bar_cache_preheat` 或新的 `market_data.warmup` Operation。
- P4.34.4：provider health 改为 chunk/Operation 聚合写，禁止每个 symbol 写一次。
- P4.34.5：新增 `market_feature_daily`，把常用 MA/RSI/ATR/量比/相对强弱预计算。
- P4.34.6：拆分当前选股扫描与策略回测，扫描只引用最近有效 backtest evidence。
- P4.34.7：评审 PostgreSQL 迁移和 COPY/staging/分区索引方案。

## 2026-05-28 P4.34.1 stock_screener 默认只读 canonical cache

本次修复：

- `ScreenerOptions` 新增 `marketDataMode: cache_only | live_fetch`。
- 默认模式为 `cache_only`。
- 只有满足以下任一条件才允许扫描中实时拉 provider：
  - 查询文本包含 `允许实时行情=1`。
  - 查询文本包含 `allowLiveMarketFetch=1`。
  - 环境变量 `FAMS_SCREENER_MARKET_DATA_MODE=live_fetch`。
- `StockScreenerService.getHistoryForScreeningWithStats` 在 `cache_only` 下调用 `marketBarCacheService.getCachedHistory`，不触发外部 provider。
- `marketBarCacheService` 新增 `getCachedHistory`：
  - 只读 `market_bar_canonical`。
  - 返回 cache hit / missing / stale warnings。
  - 不写 raw/canonical，不写 provider health。
- `dataQuality / observability / chunkSummary` 写入 `marketDataMode`，用于审计扫描是否只读缓存。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 node node_modules/tsx/dist/cli.mjs scripts/verify-operation-worker-readiness.ts` 通过。
- 验收 Operation `4d4ecc94-dfba-4da7-9083-1fc224815d41`：
  - status：`completed`
  - scanned：`2`
  - provider：`cache`
  - cacheHitRate：`100`
  - historySources：`cache:sina`
  - market data chunk duration：`17ms`
  - artifactRefs：`17`
- 恢复验收 Operation `448ec1a2-79d3-45a4-9203-01a8508da121` completed，恢复原因 `expired_lease_worker_recovery`。

检视意见：

- 已闭环：选股扫描默认不再承担外部 K 线抓取职责，主链路开始向“只读本地数据资产”收敛。
- 未闭环：缓存不足时当前仍表现为 insufficient history / partial，而不是自动创建 warmup Operation。下一步 P4.34.2/P4.34.3 必须补 coverage 表和 warmup blocker。

## 2026-05-28 P4.34.2-P4.34.3 market_data_coverage 与 warmup blocker

阶段规则复验：P4.34.1 已将 `stock_screener` 默认切为 `cache_only`，验证扫描时 provider=`cache`。本阶段继续完成 GPT 评审要求的两步：新增 coverage 摘要表，并在缓存不足时返回明确 blocker / 关联 warmup Operation。

本次修复：

- 新增 Prisma 模型 `MarketDataCoverage`，字段覆盖：
  - `symbol / market / timeframe / adjustType / dataVersion`
  - `firstTradeDate / lastTradeDate / completeFrom / completeTo`
  - `expectedBarCount / actualBarCount / missingCount / missingRangesJson`
  - `lastProvider / lastFetchAt / lastValidateAt`
  - `status: sufficient / partial / stale / failed / unknown`
  - `staleReason`
- `marketBarCacheService.getCoverageReport` 会同步 upsert `market_data_coverage`。
- `stock_screener_full_scan` 新增 `market_data.coverage` task。
- Operation artifacts 新增 `coverage_report.json`。
- `dataQuality.marketDataCoverage` 写入本次扫描所需 K 线覆盖摘要。
- cache-only 模式下，如果 coverage 不 sufficient：
  - 该标的不进入策略计算。
  - failure code 为 `NEEDS_MARKET_DATA_WARMUP`。
  - Operation `partialSuccess=true`，最终 status 为 `partial`。
  - `result.nextAction` 指向 `market_bar_cache_preheat`。
- `OperationService` 在发现 `NEEDS_MARKET_DATA_WARMUP` 时自动创建 queued 子 Operation：
  - type：`market_bar_cache_preheat`
  - parentOperationId：父选股 Operation
  - result 写入 `warmupOperationId`

验证：

- `node node_modules/prisma/build/index.js db push` 已同步 SQLite dev schema，并生成 Prisma Client。
- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 常规小样本 worker 验收通过：
  - Operation `81e2e61d-d95f-4313-bf2a-71187b490434`
  - status：`completed`
  - tasks：`7`
  - artifactRefs：`18`
  - 新增 artifact：`coverage_report.json`
  - `dataQuality.marketDataMode=cache_only`
  - `marketDataWarmupRequired=false`
  - `market_data.coverage` task：`sufficientSymbols=2 / insufficientSymbols=0`
  - coverage 表写入 `000001 / 000002`，status 均为 `sufficient`。
- blocker 验收通过：
  - 父 Operation `fff93efd-524b-4d65-9ac7-1678cfc2f161`
  - status：`partial`
  - `partialSuccess=true`
  - `dataQuality.marketDataWarmupRequired=true`
  - stale 标的：`000004`
  - failure code：`NEEDS_MARKET_DATA_WARMUP`
  - 自动创建子 warmup Operation `7bec65cc-ad5b-4619-9d26-906912db07eb`
  - 子任务 type：`market_bar_cache_preheat`
  - parentOperationId 指向父选股 Operation。

检视意见：

- 已闭环：扫描链路现在能明确区分“本地缓存足够，可计算”和“缓存不足，需要 warmup”，不会在选股扫描里隐式拉外部全量 K 线。
- 未闭环：`getCoverageReport` 当前仍会通过 canonical 明细计算覆盖率并回写 coverage 表，P4.34.4 需要改成扫描前优先 bulk 查询 `market_data_coverage`，避免全 A 时逐标的查 K 线明细。
- 下一步：实现 coverage store bulk query 与增量 gap 计算，减少扫描前 coverage 判断成本。

## 2026-05-29 P4.34.4-P4.34.5 coverage bulk query 与 provider health 聚合写

阶段规则复验：P4.34.2-P4.34.3 已证明 cache-only 扫描可以在缓存不足时返回 `NEEDS_MARKET_DATA_WARMUP` 并创建 warmup 子任务。本阶段独立评审结论：继续降低 SQLite 写锁和全 A 扫描前置查询成本，先做 coverage 摘要读取和 provider health 聚合写；`market_feature_daily` 仍作为下一小阶段单独实施。

本次修复：

- `marketBarCacheService.getCoverageReport` 改为先批量读取 `market_data_coverage`。
- 仅当 coverage 摘要缺失、requested days 不足或状态不可用时，才回查 `market_bar_canonical` 聚合结果。
- coverage 写回从逐行 upsert 改为分块 `deleteMany + createMany`，每批最多 1000 个 symbol。
- `provider_health` 改为内存窗口聚合：
  - `getHistory` 不再每只股票立即写 provider health。
  - 每 50 次请求、60 秒窗口、K 线预热 chunk 结束或健康报告读取时统一 flush。
  - 保留 request/success/failure、timeout、4xx/5xx、badData、consecutiveFailures、open_circuit 退避字段。
- `market_bar_cache_preheat` 每个 chunk 完成后 flush provider health，避免 Operation 结束前健康状态丢失。

验证：

- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- coverage 直连验证：
  - 输入 `000001 / 000002 / 000004 / 600519`
  - durationMs：`79`
  - sufficient：`2`
  - insufficient：`2`
  - stale：`2`
- 常规 worker 验收通过：
  - Operation `2b63b43e-4f50-4386-bf01-3dcd01d63186`
  - status：`completed`
  - tasks：`7`
  - artifactRefs：`18`
  - recovery Operation `fde6f401-afb2-4cfb-a644-c43a110819cf` completed。
- blocker 验收通过：
  - 父 Operation `074280dd-87cf-44b6-b30f-da78ac8d057c`
  - status：`partial`
  - `nextAction=NEEDS_MARKET_DATA_WARMUP`
  - 自动创建子 warmup Operation `6dd2761a-54a8-4951-b5ab-ef8414292c23`
  - 验收后子任务已取消，避免后台误跑。
- K 线预热 worker 验收通过：
  - Operation `31c68662-ca7f-4c70-b6fd-61d5552275b0`
  - status：`partial`
  - chunk task：`completed`
  - `fetchedBars=120`
  - recovery Operation `8ec89f3f-ad24-46b7-8210-1572438e32d9` completed。

检视意见：

- 已闭环：扫描前 coverage 判断不再默认逐标的扫 canonical 明细；provider health 写入频率从 symbol 级降为窗口/chunk 级，直接对应 GPT 评审指出的 SQLite 写锁热点。
- 未闭环：选股策略仍需要读取 canonical K 线计算 MA/RSI/ATR/量比/相对强弱。下一阶段必须新增 `market_feature_daily`，把常用技术特征作为行情同步产物预计算。
- 下一步：P4.34.6 实施 `market_feature_daily` schema、计算服务和选股读取路径，先覆盖趋势、动量、量比、波动率和相对强弱。

## 2026-05-29 P4.34.6 market_feature_daily 特征缓存第一段

阶段规则复验：P4.34.4-P4.34.5 已把扫描前 coverage 判断和 provider health 写入热点收口。本阶段独立评审结论：先把技术特征作为行情同步后的派生产物落库，暂不新增选股策略；选股扫描先展示并审计 feature cache 覆盖率，下一阶段再把策略计算迁移到 feature-first。

本次修复：

- 新增 Prisma 模型 `MarketFeatureDaily`，唯一键为 `symbol / market / tradeDate / adjustType / dataVersion`。
- 字段覆盖：
  - 收益：`return1d / return5d / return20d / return60d`
  - 均线：`ma5 / ma10 / ma20 / ma60 / ma120 / ma250`
  - 斜率：`ma20Slope / ma60Slope`
  - 量能：`volumeMa5 / volumeMa20 / volumeRatio20`
  - 风险：`atr14 / volatility20 / volatility60 / maxDrawdown20 / maxDrawdown60`
  - 动量：`rsi14 / relativeStrength20 / relativeStrength60`
  - 评分：`liquidityScore / trendScore / momentumScore`
  - 血缘：`qualityFlagsJson / computedAt / dataVersion`
- 新增 `marketFeatureDailyService`：
  - 从 `market_bar_canonical` 读取 K 线。
  - 生成日级特征。
  - 对目标 symbol 执行分 symbol 事务更新。
  - 提供 `getLatestFeatures` 给选股扫描读取最新特征覆盖。
- `market_bar_cache_preheat` 在 afterCoverage 后新增 `market_feature.compute` task。
- 预热 artifact 增加 `featureReport`。
- `stock_screener_full_scan` 新增 `market_feature.coverage` task 和 `market_feature_coverage.json` artifact。
- `dataQuality.marketFeatureCoverage` 同步写入特征覆盖率、缺失 symbol 和样本特征值。
- 更新 `verify-market-bar-cache-preheat-worker`，明确验收 `market_feature.compute`。

验证：

- `node node_modules/prisma/build/index.js db push` 通过，并生成 Prisma Client。
- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- K 线预热 worker 验收通过：
  - Operation `50d663c5-126e-4f94-bb15-1e6ef7ba0d43`
  - `market_feature.compute` status=`completed`
  - computedSymbols=`3`
  - featureRows=`324`
  - recovery Operation `ac37fa38-a828-4c26-8eb8-fbfea4920a2b` completed。
- 全市场扫描 worker 验收通过：
  - Operation `f956fbe7-1c3a-4aad-a0bd-28e5cc87128a`
  - tasks=`8`
  - artifactRefs=`19`
  - `market_feature.coverage` status=`completed`
  - feature coverage=`100%`
  - `market_feature_coverage.json` artifact 存在。

检视意见：

- 已闭环：行情预热可以同步产出可审计的技术特征缓存，选股 Operation 可以展示 feature cache 覆盖情况。
- 未闭环：当前策略评分仍以 history 数组为主，尚未改为 feature-first；回测仍需要历史窗口。下一阶段应先迁移“当前候选筛选”到 feature cache，回测继续读取 canonical 历史，避免用户筛选请求重复计算最新横截面指标。
- 下一步：P4.34.7 将当前选股扫描拆成“feature-first 当前筛选 + cached backtest evidence 引用”的第一段。

## 2026-05-29 P4.34.7 feature-first 当前候选筛选

阶段规则复验：P4.34.6 已完成 `market_feature_daily` 表、计算服务、预热后特征生成和扫描内 feature coverage artifact。本阶段独立评审结论：只迁移“当前候选筛选”到 feature-first；策略锦标赛、历史回测、样本交易仍使用 canonical K 线窗口，避免改变回测语义。

本次修复：

- `MarketFeatureDaily` 补充 rolling high/low 字段：
  - `rollingHigh20 / rollingLow20`
  - `rollingHigh60 / rollingLow60`
- `marketFeatureDailyService` 计算 rolling high/low，用于 feature-first 的振幅、支撑、压力和平台判断。
- `StockScreenerService` 新增 `evaluateByFeatureStrategy`：
  - `a_flush_sideways_volume` 使用 `maxDrawdown60 / rollingHigh20 / rollingLow20 / volumeRatio20`。
  - `volume_platform_breakout` 使用 `rollingHigh20 / rollingLow20 / closePrice / volumeRatio20`。
  - `ma_reclaim` 使用 `ma20 / ma20Slope / maxDrawdown / volumeRatio20`。
- `strategy.evaluate` 当前候选评分优先使用 `market_feature_daily` 最新特征。
- 缺少 feature 的标的才 fallback 到历史 K 线评分。
- `dataQuality.featureFirstScreening` 写入：
  - enabled
  - evaluatedCount
  - fallbackCount
  - source
  - 说明“当前候选筛选使用 feature cache；回测仍使用 canonical K 线”。
- `strategy.evaluate` task metrics 写入：
  - `featureFirst=true`
  - `featureFirstEvaluatedCount`
  - `historyFallbackEvaluatedCount`
- `verify-operation-worker-readiness` 新增断言，要求当前候选来自 `feature:market_feature_daily`，防止后续回退。

验证：

- `node node_modules/prisma/build/index.js db push` 通过，并生成 Prisma Client。
- 后端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 特征重算验证：
  - `000001 / 000002 / 000004`
  - computedSymbols=`3`
  - featureRows=`377`
  - `rollingHigh20 / rollingLow20` 已写入。
- feature-first 扫描验收：
  - Operation `5185878a-45eb-4f3f-ab9f-f30407112349`
  - `strategy.evaluate.metrics.featureFirst=true`
  - `featureFirstEvaluatedCount=2`
  - `historyFallbackEvaluatedCount=0`
  - candidates 的 `historySource=feature:market_feature_daily`
  - 候选原因已显示正常 20 日振幅：`000001` 为 `9.1%`，`000002` 为 `27.6%`。
- 更新后的 worker 验收脚本通过：
  - Operation `667e4cf4-d6fd-46d0-abc0-84fa59b71b38`
  - tasks=`8`
  - artifactRefs=`19`
  - recovery Operation `b487fbf2-6b56-46b1-85df-5b8579ef5c09` completed。

检视意见：

- 已闭环：用户发起当前选股扫描时，候选初筛已不再重复计算最新横截面技术指标，而是读取 `market_feature_daily`。
- 未闭环：策略锦标赛仍会即时回测并保存 evidence，用户筛选和历史回测尚未彻底解耦。下一阶段应做“当前筛选引用最近有效 backtest evidence”，没有有效 evidence 时返回低可信或触发异步 `strategy_tournament.run`。
- 下一步：P4.34.8 拆分当前筛选与回测证据引用，减少用户请求中的重回测成本。

## 2026-05-30 P4.34.8 全 A 完整扫描验收第一段

阶段规则复验：P4.34.7 已证明当前候选筛选可使用 feature-first，回测仍使用 canonical K 线。本阶段目标是跑通真实全 A 样本的完整 Operation 链路：universe、coverage、feature-first 当前筛选、回测聚合和 artifacts。

本次执行：

- 强制刷新全 A universe：
  - source：`sina_hs_a_all_a_share`
  - universeTotal：`5524`
  - duration：约 `5.1s`
- 执行全 A K 线预热：
  - Operation `73057da6-b372-4fd0-b11c-70e8078e493d`
  - requestedSymbols：`5524`
  - attemptedSymbols：`2578`
  - success：`2517`
  - warning：`61`
  - failure：`0`
  - fetchedBars：`304316`
- 修复预热后 coverage 摘要旧口径：
  - `getCoverageReport` 新增 `forceRebuild`
  - `market_bar_cache_preheat` afterCoverage 强制从 canonical 重建 coverage
- 强制重建 coverage 后：
  - sufficientSymbols：`5447`
  - insufficientSymbols：`77`
  - staleSymbols：`16`
  - estimatedCacheHitRate：`99.22%`
- 修复全 A feature 最新值读取：
  - 原问题：`getLatestFeatures` 一次性读取约 55 万行 feature 明细，SQLite/Prisma 大结果集触发 napi string 转换错误。
  - 修复：按 symbol 分批 groupBy 最大 tradeDate，再按 symbol/date 批量读取最新特征。
  - 验证：全 A `5524` 只读取最新 feature 用时约 `2024ms`，返回 `5448` 个 feature。
- 补算 feature cache：
  - requested：`5447`
  - computed：`5447`
  - failed：`0`
  - featureRows：`551019`
- 执行完整全 A 扫描：
  - Operation `5757bc50-59ea-4826-a83b-886ca9118acf`
  - status：`partial`
  - artifactRefs：`19`

验收结果：

- Universe：
  - universeSize：`5524`
  - universeSource：`sina_hs_a_all_a_share`
  - universe coverage gate：passed
- Market data：
  - evaluatedCount：`5447`
  - failureCount：`77`
  - providerSuccessRate：`98.61%`
  - cacheHitRate：`99.95%`
  - feature coverage：`5447 / 5447 = 100%`
- Current screening：
  - featureFirstEvaluatedCount：`5447`
  - historyFallbackEvaluatedCount：`0`
  - matchedCount：`3`
  - 当前命中候选：
    - `002230 科大讯飞`
    - `600848 上海临港`
    - `600690 海尔智家`
- Artifacts：
  - `leaderboard.json`
  - `candidate_list.json`
  - `strategy_metrics.json`
  - `execution_matrix.json`
  - `sample_trades.csv`
  - `equity_curve.json`
  - `drawdown_curve.json`
  - `backtest_assumptions.json`
  - `strategy_manifest.json`
  - `out_of_sample_validation.json`
  - `walk_forward_validation.json`
  - `parameter_sensitivity.json`
  - `group_stability_report.json`
  - `long_sample_acceptance.json`
  - `factset_preheat_coverage.json`
  - `coverage_report.json`
  - `market_feature_coverage.json`
  - `data_quality_report.json`
  - `provider_health_report.json`

检视意见：

- 已闭环：真实全 A 样本可完整进入 Operation 链路，当前筛选读取本地 feature cache，行情读取接近全 cache 命中，artifacts 完整生成。
- partial 原因不是系统崩溃：
  - `77` 只标的 K 线不足或过期，多为新股、ST/停复牌或 provider 无法返回足够 120 日 K 线。
  - 本次使用 `验证天数=5`，`long_sample_acceptance.backtest_window` 不满足 `>=60` 的高可信回测门槛，只能作为功能验收。
  - factset coverage 为 `35.66%`，行业/市值分组结论仍需降级。
- 未闭环：下一步需要把 `strategy_tournament.run` 拆成独立异步 evidence 任务，并跑 60 日长窗全 A 验收；同时继续补 quote-list 市值/行业事实集覆盖。

## 2026-05-30 P4.34.9 策略证据异步化第一段

目标：把 60 日长窗策略 evidence 从用户触发的当前选股扫描中拆出来，作为独立可查询、可取消、可恢复的 Operation，为后续“当前筛选只引用最近有效回测证据”做准备。

已完成：

- 新增 Operation 类型：`strategy_tournament_run`。
- 新增后端 API：`POST /api/v1/operations/strategy-tournament-run`。
- 队列 worker 支持：
  - `runNextQueuedOperation`
  - `executeQueuedOperation`
  - `recoverInterruptedOperations`
  - `retryOperation`
- 默认 query：
  - `多策略胜率；全A样本；扫描上限={maxScan}；分片大小={chunkSize}；验证天数={backtestDays}；持有天数={holdingDays}；跳过事实集预热=1`
- 全 A 高成本保护：
  - `maxScan > 1000` 时必须显式传入 `confirmedFullScan=true`。
- 结果中新增：
  - `operationKind=strategy_tournament_run`
  - `evidenceMode=async_strategy_evidence`
  - `evidenceRefs.batchId`
  - `evidenceRefs.artifactRefs`
  - `evidenceRefs.backtestDays`

验收：

- 后端 TypeScript：`node node_modules/typescript/lib/tsc.js --noEmit` 通过。
- 前端 TypeScript：`node node_modules/typescript/lib/tsc.js --noEmit` 通过。
- Service 直连创建小样本 60 日任务：
  - Operation `6a65f81e-8288-4676-b60c-79b20743b46c`
  - status：`partial`
  - scannedCount：`10`
  - artifactRefs：`19`
  - `operationKind=strategy_tournament_run`
  - `evidenceMode=async_strategy_evidence`
  - `evidenceRefs.backtestDays=60`
  - `longSampleAcceptance.summary.backtestDays=60`
  - tasks：`universe.snapshot / factset.preheat_coverage / market_data.coverage / market_feature.coverage / market_data.warmup / strategy.evaluate / backtest.aggregate / artifact.generate`
- API 路由验收：
  - `POST /api/v1/operations/strategy-tournament-run`
  - Operation `f04d3c65-1eb3-43b3-a96e-54499ad141e8`
  - worker 执行后 status：`partial`
  - artifactRefs：`19`

检视意见：

- 已闭环：长窗策略 evidence 已能脱离普通选股入口，以独立 Operation 运行、持久化状态、生成可审计 artifact，并支持 queued worker 执行。
- 已修复：首次验收发现 `evidenceRefs.backtestDays` 误取聚合内部窗口，已改为以 long sample acceptance / input backtestDays 为准。
- partial 是验收预期：
  - 小样本 `maxScan=5/10/20` 不能代表全 A 长窗结论。
  - 该节点只验证任务形态、产物契约和 60 日参数传递。
- 未闭环：
  - 当前选股结果尚未引用最近一次 `strategy_tournament_run` evidence。
  - 全 A 60 日 evidence 尚未正式执行，需在确认成本后以 `confirmedFullScan=true` 触发。
  - 行业/市值事实集覆盖仍需继续补齐。

## 2026-05-30 P4.34.10 当前筛选引用异步 evidence

目标：普通 AI 选股只做当前信号筛选，策略胜率和长窗回测证据引用最近一次 `strategy_tournament_run` 产物，避免用户每次筛选都即时跑回测。

已完成：

- `StockScreenerService` 新增 `asyncStrategyEvidence` 引用结构：
  - `schemaVersion=fams.screener.async_strategy_evidence_ref.v1`
  - `status=referenced|missing`
  - `evidenceMode=async_strategy_evidence`
  - `evidenceOperationId`
  - `batchId`
  - `backtestDays`
  - `artifactRefs`
  - `acceptanceStatus`
  - `bestCredibility`
  - `bestSampleSize`
  - `gateSummary`
  - `usableForTradingAdvice`
  - `blockedReasons`
- 普通 `POST /api/v1/analysis/stock-screener` 默认不再即时生成 `strategyTournament`。
- 如需调试旧路径，可显式传入 `即时回测=1` 或 `inlineBacktest=true`。
- 前端 AI 选股结果新增“异步策略证据引用”区块，展示：
  - 是否已引用
  - 证据批次
  - 长窗天数
  - 验收状态
  - 最佳可信度
  - 产物数量
  - 是否可进入交易建议
  - 阻断原因

验收：

- 后端 TypeScript：`node node_modules/typescript/lib/tsc.js --noEmit` 通过。
- 前端 TypeScript：`node node_modules/typescript/lib/tsc.js --noEmit` 通过。
- 默认普通选股接口：
  - query：`多策略胜率；扫描上限=5；验证天数=5；持有天数=3`
  - `hasInlineTournament=false`
  - `hasLongSampleAcceptance=false`
  - `asyncStrategyEvidence.status=referenced`
  - 引用 Operation：`f04d3c65-1eb3-43b3-a96e-54499ad141e8`
  - `backtestDays=60`
  - `artifactRefs=19`
  - `usableForTradingAdvice=false`
  - 阻断原因：长样本验收 insufficient、最佳可信度 insufficient、4 个 blocker gate 未通过。
- 显式即时回测接口：
  - query：`多策略胜率；扫描上限=5；验证天数=5；持有天数=3；即时回测=1`
  - `hasInlineTournament=true`
  - `strategyTournament.batchId=f9280fab-5563-41f4-8dca-6f430847b256`
  - `asyncStrategyEvidence.status=referenced`

检视意见：

- 已闭环：用户当前筛选链路不再默认承担策略锦标赛/回测成本，默认只引用已有异步 evidence。
- 风控边界正确：当前引用的 evidence 由于样本覆盖和可信度不足，明确标记为“仅观察引用”，不得进入交易建议。
- 未闭环：
  - 需要执行受控全 A 60 日 `strategy_tournament_run`，生成更有代表性的 evidence。
  - 需要继续补行业/市值事实集覆盖，降低 `factset coverage` 阻断。

## 2026-05-30 P4.34.11 60 日长窗口径修复与 500 样本验收

目标：修复策略证据报告口径与实际计算窗口不一致的问题，并用受控样本验证 60 日 evidence 的质量和成本。

已完成：

- 修复 `evaluateStrategyTournament` 内部 `evaluationDays` 上限：从最多 `20` 日改为最多 `120` 日。
- `longSampleAcceptance.summary.backtestDays` 改为读取实际 `tournament.evaluationDays`，避免报告显示 60 日但实际只算 20 日。
- 普通 AI 选股仍默认只引用异步 evidence，不内联回测。

验收：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:screener-service` 通过。
- 小样本 Operation `8e4d9677-d42b-4860-b81d-7d32a4232c4a`：
  - `strategyTournament.evaluationDays=60`
  - `longSampleAcceptance.summary.backtestDays=60`
  - `backtest_window` gate passed
  - artifactRefs=`19`
- 500 样本 Operation `8bda3186-fa76-4b45-84e7-8ffae0f48e52`：
  - scanned=`500`
  - evaluated=`494`
  - failures=`6`
  - `backtestDays=60`
  - bestSampleSize=`281`
  - bestCredibility=`medium`
  - providerSuccessRate=`98.8%`
  - cacheHitRate=`99.96%`
  - factset coverage=`99.8%`
  - `backtest.aggregate=211572ms`
  - blocker only remaining：universe coverage `9.05%`

检视意见：

- 已闭环：60 日 evidence 的报告口径和实际计算口径一致。
- 已闭环：500 样本可形成 medium 可信策略证据，但不能代表全 A。
- 风险：500 样本 60 日聚合超过 3 分钟，直接全 A 会是长任务。

## 2026-05-30 P4.34.12 全 A 60 日 evidence 性能优化与 OOM 验收

目标：在放大全 A 前优化 `backtest.aggregate`，并验证全 A 60 日证据任务是否可在当前单进程模型下完成。

已完成：

- 第一层优化：缓存同一标的、策略、持有期、offset 的信号计算结果，减少执行策略之间的重复信号计算。
- 第二层优化：深度稳定性验证增加准入条件。长窗下，只有成交样本 `>=100` 且扣费滑点后超额收益为正的组合才运行样本外、walk-forward、参数敏感性和分组稳定性；其余组合记录 `insufficient`，不做昂贵深验。

验收：

- 后端 TypeScript 通过。
- `npm run test:screener-service` 通过。
- 500 样本优化前：
  - Operation `8bda3186-fa76-4b45-84e7-8ffae0f48e52`
  - `backtest.aggregate=211572ms`
- 仅信号缓存后：
  - Operation `ab54fa42-e04c-4293-8975-da607df7f28e`
  - `backtest.aggregate=244337ms`
  - 结论：信号缓存不是主瓶颈。
- 深度验证准入优化后：
  - Operation `c4723855-0e0b-4461-b043-716a15ad53d8`
  - `backtest.aggregate=77637ms`
  - `elapsedMs=83348`
  - `backtestDays=60`
  - bestSampleSize=`281`
  - bestCredibility=`medium`
  - 质量 gate 与上一轮保持一致。
- 真实全 A 60 日 Operation `8c4f96d8-2352-4811-be5c-6de6a8ba3e07`：
  - universe=`5524`
  - market data sufficient=`5447`
  - feature coverage=`5447/5447`
  - 读取阶段约 `10s`
  - 在 `backtest.aggregate` 阶段触发 Node heap OOM
  - Operation 已收口为 `failed`，error=`WORKER_OOM`

检视意见：

- 已闭环：全 A 数据读取、coverage、feature-first 输入链路可支撑真实全 A。
- 未闭环：`backtest.aggregate` 仍把全 A 的策略矩阵、样本、验证和 artifact 一次性放入内存，无法完成全 A 60 日。
- 下一步必须做 `backtest.aggregate` 分片/流式化：按 strategy candidate 或 symbol chunk 聚合中间统计，限制样本明细保留 top N，artifact 分阶段写入，避免单进程内存持有全量 outcome。

## 2026-05-30 P4.34.13 全 A 60 日基础 evidence 验收与 warmup 可靠性修复

目标：先让真实全 A 60 日策略 evidence 任务可完成、可审计，不把未完成的深度稳定性验证包装成高可信结论。

已完成：

- 移除全 A 聚合中的 `signalMetricCache`，避免按 `strategy/symbol/holding/offset` 持有大规模 `ScreenerMetric` 对象。
- `auditHash` 输入从全量 outcomes 改为统计摘要和前 20 条样本，减少哈希阶段内存放大。
- 全 A 基础聚合阶段不再内联深度验证；样本外、walk-forward、参数敏感性、分组稳定性改为 `insufficient` 并写明需要后续 top-N 深度验证子任务补齐。
- `market_bar_cache_preheat` 的 operation result 和 artifact 改为 coverage/feature 摘要，避免把 5524 条 coverage 明细直接写入 `resultJson`。
- `market_bar_cache_preheat` 补缺口后只重算本次尝试过的 symbols 的 feature，不再对所有 sufficient 标的重算。

验收：

- 后端 TypeScript 通过。
- `npm run test:screener-service` 通过。
- 500 样本 60 日复验 Operation `1a201fc3-d657-4bdc-bfb0-88ff4d937ab3`：
  - status=`partial`，原因仅为扫描覆盖 `9.05%`。
  - `backtest.aggregate=75208ms`
  - `backtestDays=60`
  - bestSampleSize=`281`
  - bestCredibility=`medium`
- 全 A 60 日基础 evidence Operation `c3338ac1-0c8e-4e5d-8c38-bad4d257ccbb`：
  - status=`partial`
  - elapsedMs=`446769`
  - universe=`5524`
  - scanned=`5524`
  - evaluated=`5447`
  - failures=`77`
  - providerSuccessRate=`98.61%`
  - cacheHitRate=`99.95%`
  - `backtest.aggregate=429886ms`
  - signals=`243118`
  - rankedStrategies=`108`
  - bestSampleSize=`3766`
  - bestCredibility=`high`
  - 通过 gates：universe source、universe coverage、provider success、cache hit、backtest window、trade sample size。
  - 未通过 gates：validation evidence=`0`，factset coverage=`35.66%`。
- K 线缺口 warmup 修复后 Operation `68630b63-1fc6-4ece-86be-a966e5104906`：
  - status=`partial`
  - attempted=`77`
  - success=`16`
  - warnings=`61`
  - failures=`0`
  - artifact 可读取，coverage 明细已截断为摘要。

检视意见：

- 已闭环：真实全 A 60 日基础策略 evidence 能完成，不再 OOM。
- 已闭环：全 A 任务不会被错误标记为可交易高可信；缺失深度验证时 `validation_evidence` 明确失败。
- 已闭环：warmup 结果写入不会再因为全量 coverage 明细导致最终化卡住。
- 未闭环：`backtest.aggregate` 仍是单任务，429886ms 过长且阶段内进度不足；下一步必须拆成 top-N 深度验证子任务和可观测聚合阶段。
- 未闭环：77 只标的仍无法补齐到 sufficient，多数为 provider warning，需要在 provider 报告中分类为新股/北交所/停牌/源缺失等原因。
- 未闭环：factset coverage 只有 `35.66%`，行业/市值分组稳定性不能作为强证据。

## 2026-05-30 P4.34.14 全 A top-3 深度验证补跑

目标：在不放松可信度标准的前提下，为全 A 60 日基础 evidence 补齐受控范围内的深度验证。

已完成：

- `evaluateStrategyTournament` 在全 A 规模下先完成基础矩阵排序，再对 top-3 候选组合补跑：
  - out-of-sample
  - walk-forward
  - parameter sensitivity
  - group stability
- 深度验证结果写回对应候选的 leaderboard、strategy_metrics、validation artifacts 和 auditHash。
- 保持硬规则：四项深度验证未全部通过时，`validation_evidence` gate 不放行。

验收：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:screener-service` 通过。
- 全 A 60 日 Operation `67d0ea3e-209f-4a2e-8fc5-d82cc0bc100d`：
  - status=`partial`
  - elapsedMs=`549549`
  - `backtest.aggregate=528100ms`
  - scanned=`5524`
  - evaluated=`5447`
  - providerSuccessRate=`98.61%`
  - cacheHitRate=`99.95%`
  - bestSampleSize=`3766`
  - bestCredibility=`high`
  - top-3 深度验证候选：
    - `ma_reclaim__entry_t1_open__exit_h3__size_equal_notional`
    - `ma_reclaim__entry_t1_open__exit_h3__size_volatility_scaled`
    - `ma_reclaim__entry_t1_open__exit_h2__size_equal_notional`
  - top-3 验证结果：
    - `walk_forward=passed`
    - `parameter_sensitivity=passed`
    - `group_stability=passed`
    - `out_of_sample=failed`
  - `validation_evidence` gate 仍为 failed，actual=`0`。

检视意见：

- 已闭环：全 A top-3 深度验证可在单 worker 中完成，不 OOM，结果可审计。
- 已闭环：系统没有因为样本量和 bestCredibility 高而放行交易建议；样本外失败时仍阻断。
- 未闭环：top-3 均样本外失败，说明当前策略在最近 60 日内存在时间切分不稳定，不能进入加仓建议。
- 下一步不应继续扩大 top-N，而应诊断样本外失败原因：窗口划分、市场状态切换、参数过拟合、行业/市值事实覆盖不足。

## 2026-05-30 P4.34.15 样本外失败诊断 artifact

目标：把 top 深验候选的样本外失败原因结构化产出，避免只看到 `out_of_sample=failed` 而无法定位问题。

已完成：

- 新增 `out_of_sample_diagnostics.json` artifact。
- `data_quality_report.json` 和 Operation result 同步写入 `outOfSampleDiagnostics`。
- 诊断内容包括：
  - 训练窗口与样本外窗口样本数、胜率、平均收益、基准收益、超额收益。
  - 样本外超额收益衰减。
  - 平均收益衰减。
  - failedReasons。
  - 全局诊断 findings。
- 保持决策边界：诊断只解释失败原因，不改变 `validation_evidence` gate。

验收：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:screener-service` 通过。
- 受控 1200 样本 Operation `02a8d944-5795-4590-9acb-b53ef256f07b`：
  - status=`partial`
  - `backtest.aggregate=95517ms`
  - artifactRefs 从 19 增加到 `20`
  - 新增 `operation_artifact:02a8d944-5795-4590-9acb-b53ef256f07b:out_of_sample_diagnostics.json`
  - `diagnosedCandidates=3`
  - `passedCount=0`
  - `failedCount=3`
  - 全局 findings：
    - 已深度验证候选均未通过样本外验证，当前策略证据不得进入交易建议。
    - walk-forward、参数敏感性、分组稳定性通过但样本外失败，优先诊断时间切分窗口和近期市场状态变化。

检视意见：

- 已闭环：样本外失败不再只是一个状态，可以看到训练窗口正超额、样本外超额转负的具体数据。
- 已闭环：诊断 artifact 可通过 Operation artifact API 读取。
- 未闭环：还没有把样本外失败映射到更细的市场状态窗口，需要下一步补“样本外窗口市场状态诊断”。
- 未闭环：coverage warning 仍会派生 warmup 后续任务，已临时取消；下一步应做 provider warning 分类，避免重复尝试不可补齐标的。

## 2026-05-30 P4.34.16 样本外窗口市场状态诊断 artifact

目标：把样本外失败进一步映射到训练窗口与样本外窗口的全市场状态，解释策略从训练窗口正超额转为样本外负超额时，是否伴随市场环境切换。

已完成：

- 新增 `out_of_sample_market_state.json` artifact。
- `data_quality_report.json` 和 Operation result 同步写入 `outOfSampleMarketStateDiagnostics`。
- `out_of_sample_diagnostics` 中的训练/样本外信号日期区间已补充 `startSignalDate/endSignalDate`。
- 基于 `market_feature_daily` 对训练窗口和样本外窗口做横截面聚合：
  - 20/60 日平均收益。
  - 20/60 日平均最大回撤。
  - 20/60 日平均波动率。
  - 趋势、动量、流动性均值。
  - 强趋势与弱趋势市场宽度。
  - 市场状态分类：`弱势回撤 / 高波动震荡 / 强趋势 / 震荡`。
- 产物写入每个候选的 market state delta 和 findings；诊断只解释失败背景，不改变 `validation_evidence` gate。

验收：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:screener-service` 通过。
- 受控 1200 样本 Operation `ddf2c8bd-6cf9-4327-aad8-665a0b2c8ab0`：
  - status=`partial`
  - progress=`100/100`
  - artifactRefs 从 20 增加到 `21`
  - 新增 `operation_artifact:ddf2c8bd-6cf9-4327-aad8-665a0b2c8ab0:out_of_sample_market_state.json`
  - `schemaVersion=fams.screener.oos_market_state_diagnostics.v1`
  - `diagnosedCandidates=3`
  - `resultHasMarketDiag=true`
  - `dataQualityHasMarketDiag=true`
  - 全局 findings：
    - 市场状态从弱势回撤切换为高波动震荡。
  - top-3 候选均显示：
    - `trainRegime=弱势回撤`
    - `oosRegime=高波动震荡`
    - `return20dDelta=6.94`
    - `drawdown20Delta=-2.46`
    - `weakBreadthDelta=-9.06`

检视意见：

- 已闭环：样本外失败已从收益衰减扩展到市场状态解释，能说明当前 top-3 策略并非可以直接放行的稳定证据。
- 已闭环：市场状态诊断产物可通过 Operation artifact API 读取，并嵌入 `data_quality_report.json`。
- 未闭环：该诊断仍是解释层，不能替代更长期样本、行业/市值真实分组和策略样本外通过。
- 下一步主线：provider warning 分类与 factset coverage 补齐，避免 77 只 coverage warning 重复派生 warmup，并提升持仓/候选事实集覆盖。

## 2026-05-30 P4.34.17 Provider / Coverage Warning 分类与去重

目标：把全 A coverage warning 拆成“可重试 warmup 缺口”和“不可即时补齐的数据事实”，避免每次全 A 扫描都因为新股、停牌或 provider 停更标的重复派生 `market_bar_cache_preheat`。

已完成：

- `MarketBarCoverageItem` 新增：
  - `warningCategory`
  - `warningSeverity`
  - `retryable`
  - `recommendedAction`
- `MarketBarCoverageReport` 新增：
  - `retryableWarmupSymbols`
  - `nonRetryableWarningSymbols`
  - `warningSummary.byCategory`
- warning 分类规则：
  - `limited_listing_history`：最新 K 线正常但历史条数不足，通常为上市时间不足；不可即时重试。
  - `stale_after_preheat`：本地有历史但最新 K 线超过 7 天，可能停牌、退市、provider 不更新；不可在扫描中重复重试。
  - `no_local_history / insufficient_history / unknown`：保留为可重试 warmup 缺口。
- `stock_screener_full_scan / strategy_tournament_run` 只有存在 `retryableWarmupSymbols` 时才返回 `NEEDS_MARKET_DATA_WARMUP` 并创建 warmup 子任务。
- `market_bar_cache_preheat` 默认只尝试 retryable 缺口；非 retryable warning 仍写入 report/result，但不重复拉取。
- `coverage_report.json`、`data_quality_report.json`、preheat artifact/result 均写入分类汇总。
- 更新 `verify-market-bar-cache-preheat-worker`：worker 链路验证显式使用 `forceRefresh=true`，避免被不可重试去重逻辑跳过。

验收：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:screener-service` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:market-bar-cache-preheat-worker` 通过。
- 全 A coverage 分类验收：
  - total=`5524`
  - sufficient=`5447`
  - insufficient=`77`
  - `retryableWarmupCount=0`
  - `nonRetryableWarningCount=77`
  - `limited_listing_history=61`
  - `stale_after_preheat=16`
- 小样本 Operation `626ffe0b-dc47-49e1-9672-266c54d86b23`：
  - status=`partial`
  - `000004` 分类为 `stale_after_preheat`
  - `nextAction=null`
  - `warmupOperationId=null`
  - 未创建 warmup 子任务。
- 预热 Operation `a9ccfe1a-e2e6-49ba-a66f-15b30d903628`：
  - requestedSymbols=`5`
  - attemptedSymbols=`0`
  - coverageWarningCount=`1`
  - retryableCoverageWarningCount=`0`
  - nonRetryableCoverageWarningCount=`1`
  - warning 分类完整写入 artifact。

检视意见：

- 已闭环：全 A 的 77 个 coverage warning 不再触发重复 warmup，扫描不会因为不可即时补齐的数据事实派生无效子任务。
- 已闭环：preheat 仍支持 `forceRefresh=true` 的人工强制刷新和 worker 回归验证。
- 未闭环：`stale_after_preheat` 仍需要更可靠的停牌/退市/上市状态事实源，不能长期只靠 K 线日期启发式判断。
- 下一步主线：提升 factset coverage，尤其是行业、市值和持仓事实集覆盖，减少 `factset coverage 35.66%` 对交易建议证据链的阻断。

## 2026-05-30 P4.34.18 Factset Coverage 市值补齐子任务接入

目标：把 factset coverage 的主要阻断从“只能看见缺口”推进到“可自动派生可审计补齐任务”。本阶段优先解决 quote-list canonical 中行业覆盖较高、市值覆盖不足的问题。

已完成：

- `stock_screener_full_scan / strategy_tournament_run` 新增 `factsetNextAction`。
- 当满足以下条件时，扫描结果生成 `NEEDS_QUOTE_LIST_MARKET_CAP_WARMUP`：
  - `fullOfficialCoveragePercent < factsetCoverageThreshold`
  - `officialIndustryCoveragePercent >= factsetCoverageThreshold`
  - `officialMarketCapCoveragePercent < factsetCoverageThreshold`
  - `市值补齐上限 / quoteListMarketCapWarmupLimit > 0`
- `OperationService` 在发现 `factsetNextAction.code=NEEDS_QUOTE_LIST_MARKET_CAP_WARMUP` 时，自动创建 queued `quote_list_market_cap_warmup` 子 Operation。
- 新增查询参数 / 环境变量：
  - `市值补齐上限`
  - `quoteListMarketCapWarmupLimit`
  - `FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_LIMIT`
- `coverage_report.json` 和 `data_quality_report.json` 均写入 `factsetNextAction`。

验收：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:screener-service` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-market-cap-worker` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过。
- 受控 40 标的市值补齐 Operation `aaa81120-30f3-4876-ae8c-0a032850877c`：
  - requestedSymbols=`40`
  - successCount=`35`
  - failureCount=`5`
  - canonical fullCoverageCount `1970 -> 2005`
  - canonical fullCoveragePercent `33.70 -> 34.30`
  - 全 A screener coverage 提升到 `36.30%`
- 500 样本扫描 Operation `03205aaa-3afe-4dfa-9769-73058e83a783`：
  - scanned=`500`
  - factset fullOfficialCoveragePercent=`99.8%`
  - officialIndustryCoveragePercent=`100%`
  - officialMarketCapCoveragePercent=`99.8%`
- 阈值 100% 派生子任务验收 Operation `4dbfbace-55f0-4678-8cfb-8f6197f0ae67`：
  - `factsetNextAction.code=NEEDS_QUOTE_LIST_MARKET_CAP_WARMUP`
  - 自动创建子 Operation `f1a53cbe-1cba-48cb-8d9d-6573f15fe0f4`
  - 子任务 completed，successCount=`5`、failureCount=`0`
- 受控 500 标的批量市值补齐 Operation `4b154e59-17ea-4460-b566-b3e0b56ce392`：
  - requestedSymbols=`500`
  - successCount=`500`
  - failureCount=`0`
  - canonical fullCoverageCount `2010 -> 2510`
  - canonical fullCoveragePercent `34.38 -> 42.94`
  - 全 A screener factset coverage 提升到 `45.44%`
  - 全 A 行业覆盖 `94.24%`
  - 全 A 市值覆盖 `45.44%`

检视意见：

- 已闭环：factset coverage 不再停留在报告缺口，扫描任务能把“市值事实缺失”转成可查询、可取消、可恢复的 quote-list warmup 子任务。
- 已闭环：BaoStock 推导流通市值在 500 标的批量补齐中成功率为 100%，provider health 保持可观测。
- 未闭环：全 A factset coverage 仍只有 `45.44%`，距离 80% gate 仍有明显差距。
- 下一步主线：继续分批执行 quote-list market-cap warmup，或评审是否引入更高吞吐的免费市值源；达到 80% 前，策略分组稳定性仍不能作为强交易证据。

## 2026-05-30 P4.34.19 Factset Coverage 80% Gate 达成

目标：在不新增策略、不放松证据门槛的前提下，继续补齐 quote-list 市值事实，把全 A screener factset coverage 推过 `80%` gate，使行业/市值分组稳定性具备进入后续策略证据链的基础条件。

已完成：

- 开始前复验：
  - active Operation：发现一个 scheduler 触发的 `batch_factset_refresh` 正在运行。
  - 该任务完成后状态为 `partial`，`stock_factset.refresh` 成功 `4/5`，失败项为 `513770` 技术分析历史 K 线不足，不影响 quote-list 市值补齐主线。
  - 当前全 A screener factset coverage=`45.51%`。
- 执行 2000 标的 quote-list 市值补齐 Operation `d122fb49-a78e-4d8b-be5a-d1e860b7ae45`：
  - requestedSymbols=`2000`
  - successCount=`1992`
  - failureCount=`8`
  - status=`partial`
  - canonical fullCoverageCount `2514 -> 4506`
  - canonical fullCoveragePercent `43.00 -> 77.08`
  - failedSymbols：
    - `301096`
    - `600193`
    - `600421`
    - `600599`
    - `600608`
    - `600636`
    - `600696`
    - `605081`
  - 失败原因均为 BaoStock 无法提供可推导市值所需的 `close / volume / turn`。
- 全 A screener 合并事实口径验收：
  - universeTotal=`5524`
  - officialIndustryCoveragePercent=`94.24%`
  - officialMarketCapCoveragePercent=`81.61%`
  - fullOfficialCoveragePercent=`81.61%`
  - providerSummary：
    - `eastmoney_fundamental_cache=310`
    - `fams_quote_list_canonical=4896`
    - `missing=318`
- 说明：canonical 文件自身 coverage 为 `77.08%`；screener 口径为 `81.61%`，是因为 screener 同时合并 `StockFactSetCache` 中已有的正式行业/市值事实。

验收：

- 后端 TypeScript 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-canonical` 通过。
- `FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run test:quote-list-market-cap-worker` 通过。
- 轻量全 A factset 覆盖验收通过：
  - `preheatScreenerFactsets(maxScan=5524, limit=0)` 不触发外部刷新，仅计算当前覆盖。
  - final fullOfficialCoveragePercent=`81.61%`。
- 当前无 queued/running/cancelling Operation 遗留。

检视意见：

- 已闭环：全 A screener factset coverage 首次超过 `80%` gate，`GAP-6` 中“行业/市值分组稳定性事实覆盖不足”的核心阻断解除。
- 已闭环：市值补齐仍保持 Operation/task/artifact/provider health 可审计链路。
- 未闭环：canonical 文件本身仍低于 80%，依赖 `StockFactSetCache` 合并后才超过 gate；后续应继续补 canonical 或把该差异明确展示在 artifact 中。
- 未闭环：北交所与部分 ST / 特殊状态标的仍缺少行业或市值事实，仍需更可靠的上市状态、停牌退市和北交所数据源。
- 下一步主线：重新跑 500/全 A 级别策略 evidence 检查 factset gate 是否解除；若 validation evidence 仍阻断，则回到样本外稳定性和策略可信度，而不是继续堆数据源。

## 2026-05-30 P4.34.20 策略 Evidence 复验与剩余 Blocker 收口

阶段规则复验：P4.34.19 已把全 A screener factset coverage 推到 `81.61%`，因此本阶段只验证 evidence gate，不新增策略、不放松可信度规则。

独立评审结论：

- 先跑 500 样本复验，确认 factset gate 是否已从 blocker 中移除。
- 500 样本只用于低成本判断，不作为全 A 验收结论。
- 若 500 样本显示 factset 已通过，再跑 confirmed 全 A `strategy_tournament_run`。

执行结果：

- 500 样本 Operation `05c0c20d-c203-4411-878d-90d8fa5817ee`：
  - status=`partial`
  - scannedCount=`500`
  - evaluatedCount=`494`
  - providerSuccessRate=`98.8%`
  - cacheHitRate=`99.96%`
  - bestSampleSize=`281`
  - bestCredibility=`medium`
  - scanned factset coverage=`99.8%`
  - universe factset coverage=`81.64%`
  - 唯一失败 gate 为 `universe_coverage=9.05%`，这是 500 样本限制导致，非事实集 blocker。
- confirmed 全 A Operation `92bf373f-448c-4958-8456-d3583d5d415f`：
  - status=`partial`
  - scannedCount=`5524`
  - evaluatedCount=`5447`
  - failureCount=`77`
  - scanCoveragePercent=`100%`
  - providerSuccessRate=`98.61%`
  - cacheHitRate=`99.95%`
  - backtestDays=`60`
  - rankedCandidates=`108`
  - bestSampleSize=`3766`
  - bestCredibility=`high`
  - factsetUniverseCoverage=`81.64%`
  - factsetScannedCoverage=`81.64%`
  - artifactCount=`21`
  - 唯一失败 gate：`validation_evidence`，actual=`0`，required=`>= 1 个候选组合四项验证全部通过`
  - OOS 诊断：diagnosedCandidates=`3`、passedCount=`0`、failedCount=`3`

验收结论：

- 已闭环：factset coverage gate 已解除，系统不再因为行业/市值事实覆盖不足阻断全 A evidence。
- 已闭环：全 A confirmed 复验可完成，scan coverage、provider success、cache hit、样本量和最佳可信度均达到基础门槛。
- 仍未闭环：top-N 候选的样本外验证全部失败，系统继续阻断交易建议是正确行为。
- 下一步主线：进入 P4.34.21，聚焦样本外失败原因和策略可信度，不新增选股策略。优先检查时间切分、近期市场状态、候选组合参数过拟合、OOS 窗口收益分布；必要时将可信度规则从“总样本 high”收紧为“validation evidence 未通过则只允许 OBSERVE”。

## 2026-05-30 P4.34.21 Validation Decision 与 Evidence 引用收口

阶段规则复验：P4.34.20 已确认事实集覆盖、全 A 扫描覆盖、provider 成功率、缓存命中率和样本量均达标，唯一 blocker 是 `validation_evidence`。本阶段不得新增选股策略，只把“为什么不能进入交易建议”结构化，并防止局部样本 evidence 被误引用为主证据。

独立评审结论：

- 当前 500 样本 evidence 存在 validation 通过但 universe coverage 不足的情况；confirmed 全 A evidence universe coverage 充分，但 OOS 失败。
- 异步 evidence 引用不能只按“最近完成”选择，否则后续一个 500 样本任务可能覆盖全 A 证据。
- 必须把最终动作边界写成机器可读产物：validation 未通过时只允许 `RESEARCH / OBSERVE`，禁止 `ADD / REDUCE / AUTO_TRADE`。

实现：

- 新增 `ScreenerValidationDecision`：
  - schemaVersion=`fams.screener.validation_decision.v1`
  - decision=`TRADING_RESEARCH_ALLOWED / OBSERVE_ONLY / INSUFFICIENT_DATA`
  - allowedActions / prohibitedActions
  - usableForTradingAdvice
  - confidence
  - primaryBlocker / blockerGateIds
  - reasons / requiredNextChecks
  - oosSummary / marketStateFindings
- `stock_screener_full_scan / strategy_tournament_run` 新增 artifact：
  - `validation_decision.json`
- `data_quality_report.json` 和 Operation result 写入 `validationDecision`。
- `getLatestAsyncStrategyEvidence` 改为打分选择证据：
  - 优先 full scan coverage；
  - 优先 `acceptanceStatus=passed`；
  - 优先 high/medium credibility；
  - 不再简单使用最近完成 Operation；
  - 500 样本局部 evidence 不会覆盖 confirmed 全 A evidence。
- 前端任务中心新增“验证决策”artifact 导航和预览。
- 分析页异步策略证据区块展示 scan coverage 和 validation decision 摘要。

验收：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:screener-service` 通过，新增断言：
  - `validation_decision.v1`
  - decision=`OBSERVE_ONLY`
  - 禁止 `ADD / REDUCE`
  - reasons 包含样本外阻断。
- `npm run test:strategy-tournament-backtest` 通过。
- 运行态验证：
  - 普通选股 `扫描上限=5` 引用 confirmed 全 A Operation `92bf373f-448c-4958-8456-d3583d5d415f`，而不是 500 样本 Operation。
  - 小样本 Operation `43cb6a65-6244-40a6-92c1-a8750f5c5424` 生成 `validation_decision.json`，decision=`OBSERVE_ONLY`，prohibitedActions=`ADD / REDUCE / AUTO_TRADE`。
  - 新增小样本 Operation 后再次运行普通选股，仍引用 confirmed 全 A Operation `92bf373f-448c-4958-8456-d3583d5d415f`。

检视意见：

- 已闭环：策略 evidence 的动作边界已结构化，validation 未通过时不会进入加仓/减仓建议。
- 已闭环：局部样本 evidence 不会覆盖全 A evidence，前端会显示 scan coverage 和验证决策。
- 仍未闭环：策略本身的 OOS 失败尚未被修正；下一步不能直接放宽 OOS gate。
- 下一步主线：P4.34.22 做 OOS 失败专项分析，输出更细的收益分布、日期分布和候选组合失败对比；仍不新增策略。

## 2026-05-31 P4.34.22 OOS 失败收益分布与候选组合对比

阶段规则复验：P4.34.21 已把 validation 未通过时的动作边界收口为 `OBSERVE_ONLY`，并确认普通选股引用 confirmed 全 A evidence，而不是局部样本 evidence。本阶段继续围绕唯一 blocker `validation_evidence` 做原因分析，不新增选股策略、不放宽 OOS gate。

独立评审结论：

- 现有 `out_of_sample_diagnostics.json` 能说明 OOS 失败，但缺少可审计的收益分布、日期桶和候选组合之间的失败标签对比。
- 必须把“为什么继续阻断交易建议”落到机器可读 artifact，避免后续前端或 AI 解释层只引用总样本 high credibility。
- OOS 分析只服务诊断和研究观察，不改变交易建议 gate。

实现：

- 新增 `ScreenerOosFailureAnalysis`，schemaVersion=`fams.screener.oos_failure_analysis.v1`。
- 新增 artifact：
  - `oos_failure_analysis.json`
- 每个候选组合输出：
  - train / outOfSample 窗口摘要；
  - 训练窗口和样本外窗口收益分布：样本数、胜率、均值、中位数、P25/P75、尾部亏损、最大/最小收益；
  - OOS 相对训练窗口的超额收益、平均收益、中位收益、胜率变化；
  - 训练窗口和样本外窗口 signalDate 分布；
  - failureTags：`validation_failed / oos_excess_non_positive / oos_average_return_decay / oos_median_return_decay / oos_win_rate_decay / market_regime_shift / oos_tail_loss`。
- `validation_decision.json` 的 `evidenceRefs` 新增 `oos_failure_analysis.json`。
- `data_quality_report.json` 和 Operation result 写入 `oosFailureAnalysis`。
- 前端任务中心新增“OOS失败分析”artifact 导航和预览，展示全局结论、失败标签、收益分布、变化指标和日期桶。

验收计划：

- 后端 TypeScript：验证新增类型、artifact 生成和 evidenceRefs。
- 前端 TypeScript：验证任务中心 OOS 失败分析预览可编译。
- `npm run test:screener-service`：新增断言 `oos_failure_analysis.v1`、候选收益分布、日期分布和 `market_regime_shift` 标签。
- `npm run test:strategy-tournament-backtest`：回归策略锦标赛核心指标。
- 运行态 smoke：生成小样本 Operation，确认 artifactRefs 包含 `oos_failure_analysis.json`，并确认 `validation_decision.json` 继续禁止 `ADD / REDUCE / AUTO_TRADE`。

验收结论：

- 后端 TypeScript 通过：`node node_modules/typescript/bin/tsc --noEmit`。
- 前端 TypeScript 通过：`node node_modules/typescript/bin/tsc --noEmit`。
- `npm run test:screener-service` 通过，已验证：
  - `validationDecision.evidenceRefs` 包含 `oos_failure_analysis.json`；
  - `oos_failure_analysis.v1` schema；
  - 候选收益分布、日期分布和 `market_regime_shift` 失败标签。
- `npm run test:strategy-tournament-backtest` 通过，策略锦标赛核心回测约束无回归。
- 小样本 Operation smoke 通过：
  - operationId=`51de6890-c3df-486f-b9ae-ba4916507485`
  - status=`partial`，符合 5 标的小样本无法通过长样本 gate 的预期；
  - artifactCount=`23`
  - `oos_failure_analysis.json` 存在，schema=`fams.screener.oos_failure_analysis.v1`，候选数=`10`
  - `validation_decision.json` decision=`OBSERVE_ONLY`，prohibitedActions=`ADD / REDUCE / AUTO_TRADE`，evidenceRefs 包含 `oos_failure_analysis.json`。
- 已闭环：P4.34.22 将 OOS 失败从“总览结论”扩展为可审计 artifact，前端可查看候选组合的训练/样本外收益分布、衰减指标和日期分布。
- 仍保持：在 validation evidence 未通过前，系统不得输出 `ADD / REDUCE / AUTO_TRADE`，只能进入研究观察。

## 2026-05-31 P4.34.23 PostgreSQL / Worker 基础设施就绪评审产物

阶段规则复验：P4.34.22 已把 OOS 失败分析做成可审计 artifact，当前仍不能放行交易建议。本阶段处理 P4 剩余的基础设施阻断：PostgreSQL / worker 性能验收不能只停留在文档描述，必须进入每次长样本 Operation 的产物链。

文档审计：

- P4.34 GPT 评审明确要求后续评审 PostgreSQL 迁移和 COPY/staging/分区索引方案。
- P4 总计划仍标注“尚未完成 PostgreSQL/worker 级别性能验收”。
- 历史验收多次出现 SQLite 写入压力、artifact 体积和 worker 恢复风险，因此正式全 A 长样本不得只凭 SQLite dry-run 标记为生产级通过。

设计审计：

- 本阶段不直接切换数据库，不改变 Prisma schema，不引入迁移风险。
- 先新增机器可读 `infrastructure_readiness_report.json`，让每个长样本 Operation 明确说明：当前数据库、执行模式、行情读取边界、分片规模、迁移前置项和 SQLite 允许范围。
- 该报告只作为基础设施 gate 和审计证据，不改变策略分数、不改变 validation evidence、不放宽交易建议 gate。

实现：

- 新增 `ScreenerInfrastructureReadinessReport`，schemaVersion=`fams.screener.infrastructure_readiness.v1`。
- `stock_screener_full_scan / strategy_tournament_run` 产物新增：
  - `infrastructure_readiness_report.json`
- 报告包含：
  - database provider：`sqlite / postgresql / unknown`
  - executionMode：`inline / queued / unknown`
  - marketDataMode、chunkSize、concurrency、scanned/evaluated/artifactCount
  - gates：`database_provider / execution_mode / market_data_mode / chunk_size`
  - migrationPlan：正式全 A 前置项、SQLite 允许范围、PostgreSQL 目标能力。
- `data_quality_report.json` 和 Operation result 写入 `infrastructureReadinessReport`。
- 前端任务中心新增“基础设施就绪”artifact 导航和预览。

验收计划：

- 后端 TypeScript。
- 前端 TypeScript。
- `npm run test:screener-service`：断言 infrastructure readiness schema、database gate、market data gate 和 PostgreSQL 前置项。
- `npm run test:strategy-tournament-backtest`：策略锦标赛回归。
- 小样本 Operation smoke：确认 artifactRefs 包含 `infrastructure_readiness_report.json`，并确认当前 SQLite 环境下报告状态不是生产 ready。

验收结论：

- 后端 TypeScript 通过：`node node_modules/typescript/bin/tsc --noEmit`。
- 前端 TypeScript 通过：`node node_modules/typescript/bin/tsc --noEmit`。
- `npm run test:screener-service` 通过，新增断言：
  - `infrastructure_readiness.v1`
  - `database_provider` gate 存在
  - `market_data_mode` gate 在 cache-only 下 passed
  - PostgreSQL 正式全 A 前置项存在。
- `npm run test:strategy-tournament-backtest` 通过。
- 小样本 Operation smoke 通过：
  - operationId=`123d8057-aa05-4e93-9e1b-503066fcca97`
  - artifactCount=`24`
  - `infrastructure_readiness_report.json` 存在
  - schema=`fams.screener.infrastructure_readiness.v1`
  - readinessStatus=`blocked`
  - database=`sqlite / file / development_local`
  - gates=`database_provider warning/blocker`、`execution_mode warning`、`market_data_mode passed`、`chunk_size passed`
- 已闭环：P4 的 PostgreSQL/worker 性能验收前置边界已机器可读；当前 SQLite 环境不会被误判为生产级全 A ready。
- 仍未闭环：尚未实际完成 PostgreSQL 迁移、COPY/staging、分区索引和 queued 全 A 压力验收。

## 2026-05-31 P4.34.24 市场约束覆盖报告

阶段规则复验：P4.34.23 已把 PostgreSQL/worker 前置条件做成 readiness artifact，当前 P4 剩余阻断中仍有“停牌/退市事实源不足”。本阶段继续补证据链，不新增策略、不改变交易建议 gate。

文档审计：

- P4 回测约束要求：涨停不能买、跌停不能卖、停牌不能交易、ST 过滤、成交额过滤、上市未满 N 天过滤。
- 现有实现已经阻断这些情况，但文档多次指出：停牌/退市/上市状态仍缺正式事实源，不能长期只靠 K 线和名称启发式。

设计审计：

- 市场约束本身仍由确定性回测引擎执行。
- 新增报告只统计 blockedSamples 的原因、证据类型、可靠性和正式 provider 缺口。
- 该报告不改变样本收益、不改变 `validation_evidence` gate，不放行任何交易动作。

实现：

- 新增 `ScreenerMarketConstraintCoverageReport`，schemaVersion=`fams.screener.market_constraint_coverage.v1`。
- `stock_screener_full_scan / strategy_tournament_run` 产物新增：
  - `market_constraint_coverage_report.json`
- 报告包含：
  - constraintVersion=`constraint.cn_a_share_tradeability.v1`
  - executedSamples / blockedSamples / blockedRatioPercent / uniqueBlockedSymbols
  - blockedReasonSummary：reason、count、symbols、evidenceType、reliability、requiresOfficialProvider
  - providerGaps：ST/退市、上市日期、停复牌、涨跌停价字段等正式源缺口
  - nextActions：接入正式证券状态 provider、涨跌停价字段落库、迁移后按日期/provider 追溯。
- `data_quality_report.json` 和 Operation result 写入 `marketConstraintCoverageReport`。
- 前端任务中心新增“市场约束覆盖”artifact 导航和预览。

验收计划：

- 后端 TypeScript。
- 前端 TypeScript。
- `npm run test:screener-service`：断言 market constraint coverage schema、版本、候选组合和证券状态 next action。
- `npm run test:strategy-tournament-backtest`：回归市场约束、成本和策略锦标赛。
- 小样本 Operation smoke：确认 artifactRefs 包含 `market_constraint_coverage_report.json`。

验收结论：

- 已通过本节点验收。
- 后端 TypeScript：通过。
- 前端 TypeScript：通过。
- `npm run test:screener-service`：通过，已断言 `market_constraint_coverage_report.json` schema、版本、候选组合和证券状态 next action。
- `npm run test:strategy-tournament-backtest`：通过，市场约束、成本模型和策略锦标赛回归无新增失败。
- 小样本 Operation `71bc0ab2-ca65-4e80-ae9a-56275a539e4f`：status=`partial`、artifactCount=`25`、包含 `market_constraint_coverage_report.json`，schemaVersion=`fams.screener.market_constraint_coverage.v1`，status=`needs_official_status_provider`。
- 该报告在小样本 blockedSamples=0 时仍明确输出 providerGaps：缺少正式证券状态源、缺少正式停复牌状态源、缺少正式涨跌停价字段。
- 已闭环：市场约束执行结果和正式 provider 缺口可被前端、Operation result 和数据质量报告审计。
- 仍未闭环：正式证券状态、停复牌和涨跌停价 provider 尚未接入；validation evidence 未通过前继续禁止 `ADD / REDUCE / AUTO_TRADE`。

## 2026-05-31 P4.34.25 P4 收口评审产物

阶段规则复验：P4.34.24 已把市场约束执行与正式源缺口做成 artifact。当前 P4 的核心风险是证据分散在多个产物中：长样本验收、验证决策、基础设施 readiness、市场约束覆盖各自有 gate，前端和后续 AI 解释层可能只引用单个局部结论。本阶段只做收口评审，不新增策略、不改变回测结果、不放宽交易建议 gate。

文档审计：

- P4 主线目标是“策略回测可信度体系”，不是让 LLM 或单个策略直接给买卖动作。
- 当前计划已完成行情缓存、全 A 扫描、异步 evidence、OOS 失败分析、基础设施 readiness、市场约束覆盖，但 validation evidence 仍未通过。
- 文档仍要求每个阶段有验收节点，并同步 gap 文档，不能把分散的 artifact 当作已整体闭环。

设计审计：

- 新增统一 `p4_closure_review.json`，只聚合已有 gate，不重新计算策略、不修改评分。
- 该报告必须清楚区分：研究可继续、交易建议仍阻断、生产级全 A 仍阻断。
- 报告必须引用关键 artifact，便于前端、人工复核和后续 Agent 解释层追溯。

实现：

- 新增 `ScreenerP4ClosureReviewReport`，schemaVersion=`fams.screener.p4_closure_review.v1`。
- `stock_screener_full_scan / strategy_tournament_run` 产物新增：
  - `p4_closure_review.json`
- 报告聚合：
  - `long_sample_acceptance.json`
  - `validation_decision.json`
  - `oos_failure_analysis.json`
  - `infrastructure_readiness_report.json`
  - `market_constraint_coverage_report.json`
- 输出：
  - phase=`P4.34`
  - status=`research_ready / blocked_for_trading / blocked_for_production`
  - decision=`CONTINUE_RESEARCH_ONLY / READY_FOR_MANUAL_REVIEW`
  - acceptance / validation / infrastructure / market constraint 摘要
  - gate 列表、已完成证据、剩余阻断、下一步动作和关联产物。
- `data_quality_report.json` 和 Operation result 写入 `p4ClosureReview`。
- 前端任务中心新增“P4收口评审”artifact 导航和预览。

验收结论：

- 后端 TypeScript：通过。
- 前端 TypeScript：通过。
- `npm run test:screener-service`：通过，已断言 `p4_closure_review.v1`、P4.34 phase、`CONTINUE_RESEARCH_ONLY`、交易建议阻断和关联产物。
- `npm run test:strategy-tournament-backtest`：通过。
- 小样本 Operation `7af9fa17-cdf2-443b-a78a-3019c22b926c`：status=`partial`、artifactCount=`26`、包含 `p4_closure_review.json`。
- `p4_closure_review.json` 验证结果：schema=`fams.screener.p4_closure_review.v1`、phase=`P4.34`、status=`blocked_for_production`、decision=`CONTINUE_RESEARCH_ONLY`、summary.validationDecision=`OBSERVE_ONLY`、summary.usableForTradingAdvice=`false`、summary.productionReady=`false`。
- 已闭环：P4 当前阶段已有统一机器可读收口结论，能明确告诉前端和后续 AI 解释层：可继续研究，不得进入交易建议，不得标记生产 ready。
- 仍未闭环：OOS validation evidence、PostgreSQL/worker 生产验收、正式证券状态/停复牌/涨跌停价 provider。

## 2026-05-31 P5.1 Shadow PG / 正式状态源 / OOS 失败分类审计产物

阶段规则复验：P4.34.25 已完成 P4 收口评审，结论为 `blocked_for_production` 和 `CONTINUE_RESEARCH_ONLY`。本阶段开始前复核该结论，确认不能通过新增策略或话术绕过 validation gate；下一步必须围绕生产级基础设施、正式证券状态源和样本外失败分类继续收敛。

文档审计：

- GPT 架构评审要求不要把全 A 扫描做成“边拉行情边算策略”，后续主线应转向本地 canonical / feature cache、Shadow PostgreSQL、staging/COPY/ON CONFLICT、正式证券状态源和可解释验证失败分类。
- 当前 P4 closure 已指出三个未闭环 blocker：OOS validation evidence、PostgreSQL/worker 生产验收、正式证券状态/停复牌/涨跌停价 provider。
- 现有文档缺口是：这些 blocker 尚未形成独立 artifact，前端和后续 Agent 只能看到 P4 聚合结论，不能分别审计 PostgreSQL readiness、证券状态 provider 覆盖和 OOS 失败类型。

设计审计：

- 新增 P5 第一段只做审计契约，不伪装成实际 PostgreSQL 迁移或正式 provider 接入。
- `postgres_shadow_readiness_report.json` 必须明确当前 shadow 配置状态、staging 表、promotion gate 和下一步，不允许把 SQLite inline dry-run 标记为生产 ready。
- `security_status_coverage_report.json` 必须明确混合免费源 + Tushare 预留策略、必需字段、当前 heuristic fallback 和正式源缺口。
- `validation_failure_taxonomy.json` 必须把 validation 阻断拆成机器可读失败类，并保持 `OBSERVE_ONLY`，不得输出 `ADD / REDUCE / AUTO_TRADE`。

实现：

- 新增 `postgres_shadow_readiness_report.json`，schemaVersion=`fams.infrastructure.postgres_shadow_readiness.v1`。
  - 输出 `status=not_configured / configured_not_verified / ready`、`mode=shadow_only`、当前数据库 provider、shadow URL 配置状态、staging 表、copy/promote 计划、pressure targets 和 nextActions。
- 新增 `security_status_coverage_report.json`，schemaVersion=`fams.market.security_status_coverage.v1`。
  - 输出 providerPolicy=`mixed_free_sources_with_tushare_ready`、canonical 表、必需字段、AKShare/BaoStock/Eastmoney/交易所公开源/Tushare 候选、当前 heuristic fallback、provider gaps 和 nextActions。
- 新增 `validation_failure_taxonomy.json`，schemaVersion=`fams.screener.validation_failure_taxonomy.v1`。
  - 输出 validation gate、OOS return decay、sample insufficient、market regime shift 等失败类，候选组合失败标签和下一步诊断动作。
- `p4_closure_review.json` 现在引用上述三个 P5 artifact，并把相关 gate 和 nextActions 纳入统一收口结论。
- `data_quality_report.json` 和 Operation result 写入 `postgresShadowReadinessReport / securityStatusCoverageReport / validationFailureTaxonomy`。
- 前端任务中心新增 `PG Shadow / 证券状态覆盖 / 失败分类` artifact 导航和预览。

验收结论：

- 后端 TypeScript：通过。
- 前端 TypeScript：通过。
- `npm run test:screener-service`：通过，已断言三个 P5 report 的 schema、关键字段、P4 closure artifactRefs 和 security status gate。
- `npm run test:strategy-tournament-backtest`：通过。
- 小样本 Operation `b54125e4-b4e7-4fd2-b8ec-5007688ac038`：status=`partial`、artifactCount=`29`。
- artifact 验证：
  - `postgres_shadow_readiness_report.json`：schema=`fams.infrastructure.postgres_shadow_readiness.v1`、status=`not_configured`。
  - `security_status_coverage_report.json`：schema=`fams.market.security_status_coverage.v1`、status=`not_started`。
  - `validation_failure_taxonomy.json`：schema=`fams.screener.validation_failure_taxonomy.v1`、status=`blocked_for_trading`、decision=`OBSERVE_ONLY`。
  - `p4_closure_review.json`：status=`blocked_for_production`、decision=`CONTINUE_RESEARCH_ONLY`，继续禁止交易建议。
- 已闭环：P5 第一段把 Shadow PG readiness、正式证券状态源缺口和 OOS 失败分类纳入 Operation artifact、前端预览、data quality 和 P4 closure。
- 仍未闭环：尚未真正接入 PostgreSQL shadow/staging、尚未落库正式证券状态 canonical 表、尚未把 OOS 失败分类扩展为分层 OOS / regime bucket / walk-forward 矩阵复验。

## 2026-05-31 P5.2 证券状态 canonical 事实层第一段

阶段规则复验：P5.1 已将正式证券状态源缺口做成 `security_status_coverage_report.json`，状态为 `not_started`。当前阶段只允许把事实层从“报告计划”推进为“可落库、可审计、可被市场约束读取的 canonical 第一段”；由于数据仍来自 heuristic provider，不允许解除正式 provider blocker。

文档审计：

- P4 市场约束覆盖报告指出缺少正式证券状态源、停复牌状态源和涨跌停价字段。
- GPT 评审要求策略和告警只读 canonical 事实层，启发式 fallback 必须降级 confidence。
- 当前缺口是没有 `SecurityStatusDaily / MarketTradeabilityDaily` 表，导致 `security_status_coverage_report.json` 只能展示计划，不能展示实际 coverage。

设计审计：

- 新增两张 canonical 表，但第一段只写 heuristic provider 行，明确保留 `provider=heuristic`、`confidence`、`sourceRefsJson` 和 `warningsJson`。
- 市场约束优先读取资产上挂载的证券状态事实；当事实层显示 ST、退市或停牌时，阻断理由必须写明事实层 provider 和 confidence。
- `security_status_coverage_report.json` 从 `not_started` 推进为 `partial` 时，仍必须保留 `official_provider_rows` blocker，防止把启发式状态误当正式源。

实现：

- Prisma 新增：
  - `SecurityStatusDaily`
  - `MarketTradeabilityDaily`
- 新增 `securityStatusService`：
  - `upsertHeuristicFromRecords(records)`：从标的名称和最新 K 线生成证券状态与可交易性过渡事实。
  - `getLatestFacts(symbols)`：读取最新证券状态和交易性事实。
  - `getCoverageSnapshot(symbols)`：输出覆盖快照，统计 statusRows、tradeabilityRows、officialProviderRows、heuristicRows、字段覆盖率和 providerSummary。
- `stock_screener_full_scan / strategy_tournament_run` 新增 `security_status.canonicalize` 子任务。
- `MarketConstraint` 第一段接入事实层：ST/退市/停牌先读 `securityStatusFact / tradeabilityFact`，再 fallback 到名称、成交量和价格形态规则。
- `security_status_coverage_report.json` 新增 `coverageSnapshot`，状态逻辑调整为：
  - 无 canonical 行：`not_started`
  - 有 canonical heuristic 行但无正式源：`partial`
  - 有正式源且 provider gap 清空：`sufficient`
- 前端任务中心“证券状态覆盖”预览新增状态行、交易性行、正式源行、启发式行和字段覆盖率。

验收结论：

- Prisma `db push` 与 client generate：通过。
- 后端 TypeScript：通过。
- 前端 TypeScript：通过。
- `npm run test:screener-service`：通过，已断言 `SecurityStatusDaily / MarketTradeabilityDaily` heuristic 行写入、coverage snapshot schema、`riskFlag=st` 和 report status=`partial`。
- `npm run test:strategy-tournament-backtest`：通过。
- 小样本 Operation `0881de2a-0f65-449c-912d-d8ef40d1632e`：status=`partial`、artifactCount=`29`。
- E2E 产物验证：
  - `security_status.canonicalize` task completed，successCount=`4`，provider=`heuristic`。
  - `security_status_coverage_report.json` status=`partial`。
  - coverageSnapshot：requestedSymbols=`4`、statusRows=`4`、tradeabilityRows=`4`、symbolsWithStatus=`4`、symbolsWithTradeability=`4`、officialProviderRows=`0`、heuristicRows=`8`、latestTradeDate=`2026-05-29`。
  - gates 保留 `official_provider_rows=failed/blocker`，说明 heuristic 行没有被误判为正式源。
- 已闭环：证券状态 canonical 表和 Operation coverage 已落地，前端可见，市场约束可读取第一段事实层。
- 仍未闭环：AKShare/BaoStock/Eastmoney/Tushare/交易所公开源的正式 provider 尚未接入；涨跌停价仍为前收盘 10% 启发式；历史日级停复牌和 ST 状态尚未按 provider 回溯验证。

## 2026-05-31 P5.3 quote-list canonical 多源身份升级

阶段规则复验：P5.2 已完成 `SecurityStatusDaily / MarketTradeabilityDaily` 与 `security_status.canonicalize` task，但 coverage 仍主要来自 `heuristic`。当前阶段只允许把证券身份来源升级为已有 quote-list canonical 多源事实，不允许把它误标为正式停复牌或涨跌停状态源。

设计审计：

- `quote-list canonical` 已包含多源股票池、名称、交易所和列表状态，可替代纯名称启发式作为证券状态事实的上游身份依据。
- 该来源仍不是正式交易状态源，因此只能提升身份可信度，不能解除 `provider_gaps` 中的停复牌、涨跌停价和历史状态缺口。
- coverage 报告必须继续保留 `partial`，防止前端或后续 AI 解释层误以为 P5 已生产 ready。

实现：

- `securityStatusService` 优先读取 `backend/data/a-share-quote-list-canonical.json`。
- `SecurityStatusDaily / MarketTradeabilityDaily` 的 provider 从 `heuristic` 升级为 `quote_list_canonical`，并记录 `sourceProviders`、`sourceRefs`、`consensusScore`、`confidence` 和 warnings。
- 未命中 quote-list canonical 时继续降级到 heuristic fallback，保证任务可恢复、可审计。
- `security_status_coverage_report.json` 展示 quote-list canonical 覆盖行、交易性行和字段覆盖率。

验收结论：

- 后端 TypeScript：通过。
- 前端 TypeScript：通过。
- `npm run test:screener-service`：通过。
- `npm run test:strategy-tournament-backtest`：通过。
- 小样本 Operation `85d6c35d-34bc-4f88-8e95-a6fe337a4ae0`：status=`partial`。
- `security_status.canonicalize` task：completed，successCount=`4`，provider=`quote_list_canonical`。
- `security_status_coverage_report.json`：status=`partial`，requestedSymbols=`4`、statusRows=`4`、tradeabilityRows=`4`、officialProviderRows=`8`、heuristicRows=`0`、latestTradeDate=`2026-05-29`。
- 已闭环：证券身份事实从纯启发式升级为多源 quote-list canonical 引用。
- 仍未闭环：正式停复牌、涨跌停价和历史日级证券状态 provider 尚未接入，交易建议阻断不解除。

## 2026-05-31 P5.4 / P5 收口评审

阶段规则复验：P5.1-P5.3 已分别完成生产阻断点审计、证券状态 canonical 表和 quote-list canonical 身份升级。当前阶段只做 P5 收口评审，不新增策略、不解除 P4 validation gate、不把研究闭环标记为生产可用。

设计审计：

- P5 必须给出统一机器可读结论，避免后续只引用单个局部 artifact。
- 生产 ready 必须同时满足：PostgreSQL shadow/staging ready、证券状态覆盖 sufficient、validation failure taxonomy 不再 `blocked_for_trading`、P4 closure 不再 `CONTINUE_RESEARCH_ONLY`。
- 只要任一 gate 失败，系统仍保持 `RESEARCH / OBSERVE`，不得输出交易动作。

实现：

- 新增 `p5_closure_review.json`，schemaVersion=`fams.screener.p5_closure_review.v1`。
- 产物聚合：
  - `postgres_shadow_readiness_report.json`
  - `security_status_coverage_report.json`
  - `validation_failure_taxonomy.json`
  - `p4_closure_review.json`
- 输出 phase、status、decision、summary、gates、completedEvidence、remainingBlockers、nextActions 和 artifactRefs。
- Operation result 与 `data_quality_report.json` 同步写入 `p5ClosureReview`。
- 前端任务中心新增“P5收口评审”预览。

验收结论：

- Prisma db push/generate：通过。
- 后端 TypeScript：通过。
- 前端 TypeScript：通过。
- `npm run test:screener-service`：通过，已断言 `p5_closure_review.v1`、P5 phase、PG shadow gate、artifactRefs 和 productionReady=false。
- `npm run test:strategy-tournament-backtest`：通过。
- 小样本 Operation `4f4a6d31-3f7c-4993-818b-9256f9114843`：status=`partial`、artifactCount=`30`。
- `p5_closure_review.json`：schema=`fams.screener.p5_closure_review.v1`、status=`partial`、decision=`P5_COMPLETE_RESEARCH_ONLY`。
- summary：postgresShadowStatus=`not_configured`、securityStatusCoverageStatus=`partial`、validationFailureTaxonomyStatus=`blocked_for_trading`、p4Decision=`CONTINUE_RESEARCH_ONLY`、productionReady=`false`。
- 已闭环：P5 全部研究侧任务已形成统一收口结论，后续 Agent 或前端不能绕过 P4/P5 gate。
- 仍未闭环：真实 PostgreSQL shadow/staging、正式交易状态 provider、OOS 分层/市场状态 bucket 复验仍是生产阻断项。

## 2026-05-31 P5.5 生产阻断项继续执行

阶段规则复验：P5.4 已完成统一收口评审，结论为 `partial / P5_COMPLETE_RESEARCH_ONLY`。本阶段按用户要求继续处理剩余三项阻断：PostgreSQL shadow/staging、正式交易状态 provider、OOS 分层复验。原则不变：没有真实连接、正式 provider 或足够样本时，不允许把 gate 改绿。

实现：

- PostgreSQL shadow readiness：
  - `postgres_shadow_readiness_report.json` 新增 `verification` 字段。
  - 记录 `clientTool`、connection/schema/staging/pressure 是否已检查，以及当前阻断说明。
  - 当前 WSL 未配置 `FAMS_POSTGRES_SHADOW_DATABASE_URL / POSTGRES_SHADOW_DATABASE_URL`，也没有 `psql` 客户端，因此只能输出 `not_configured`，不能伪造 ready。
- 证券状态 provider 分级：
  - `SecurityStatusDaily` 对 quote-list canonical 中含 `baostock` 的身份数据优先标记 provider=`baostock`，降低纯 heuristic 使用面。
  - `SecurityStatusCoverageSnapshot` 新增 `formalTradingStateRows`，用于区分“证券身份多源”与“正式停复牌/涨跌停交易状态”。
  - `security_status_coverage_report.json` 新增 `formal_trade_state_rows` gate；quote-list / baostock 身份源不能替代交易所或 Tushare 的正式交易状态源。
- OOS 分层复验：
  - 新增 `oos_layered_validation.json`，schemaVersion=`fams.screener.oos_layered_validation.v1`。
  - 按 `market_regime / industry_group / market_cap_group` 三个维度复验训练窗口与样本外窗口的收益分布、均值变化、中位数变化和胜率变化。
  - `validation_failure_taxonomy.json` 可引用分层复验状态；分层不足或失败时继续输出 `OBSERVE_ONLY`。
- 前端任务中心新增“OOS分层复验”artifact 导航和预览，并在“证券状态覆盖”中展示正式交易状态行数。

验收结论：

- 后端 TypeScript：通过。
- 前端 TypeScript：通过。
- `npm run test:screener-service`：通过。
- `npm run test:strategy-tournament-backtest`：通过。
- 小样本 Operation `b7f50f35-bf1a-4069-9d5c-66c14eccd51e`：status=`partial`、artifactCount=`31`。
- `postgres_shadow_readiness_report.json`：status=`not_configured`，verification.clientTool=`psql_missing`，connection/schema/staging/pressure 均未检查。
- `oos_layered_validation.json`：status=`insufficient`，dimensions=`3`，buckets=`0`。
- `security_status_coverage_report.json`：status=`partial`，正式交易状态 gate 仍未通过。
- `p5_closure_review.json`：decision=`P5_COMPLETE_RESEARCH_ONLY`、productionReady=`false`。
- 已闭环：OOS 分层复验产物已落地，证券身份 provider 已分级，PG shadow readiness 已能明确报告真实执行条件。
- 仍未闭环：由于本机缺 PostgreSQL shadow 连接和 psql，PG/staging 不能实测；由于没有交易所/Tushare 正式停复牌/涨跌停 provider，正式交易状态不能 sufficient；由于小样本 OOS 分层样本不足，不能解除 P4/P5 交易建议阻断。

## 2026-05-31 P5.6 生产阻断项自动转绿路径

阶段规则复验：P5.5 已把 PG shadow、正式交易状态和 OOS 分层复验拆成独立 gate。用户追问“怎么才能改绿”后，本阶段只实现真实检测和正式源接入路径，不通过修改报告阈值伪造 green。

设计审计：

- PG shadow gate 必须连接真实 PostgreSQL，并执行 schema/staging/批量写入烟测后才能 `ready`。
- WSL 缺 `psql` 时不能直接判失败；如果项目依赖里有 Node PostgreSQL client，可以用 `pg` 执行等价验收。
- 正式交易状态 gate 不能由 quote-list 身份源替代；必须有停复牌、上市状态或涨跌停价格等正式交易状态行。
- 当前环境未配置 PostgreSQL shadow URL 和 Tushare token 时，P5 仍应保持 `partial / P5_COMPLETE_RESEARCH_ONLY`。

实现：

- 新增后端依赖 `pg` 与 `@types/pg`。
- `postgres_shadow_readiness_report.json` 的构建逻辑从静态审计升级为真实验证：
  - 优先读取 `FAMS_POSTGRES_SHADOW_DATABASE_URL`，其次读取 `POSTGRES_SHADOW_DATABASE_URL`。
  - 连接 PostgreSQL 后创建 `fams_shadow` schema。
  - 创建 staging 表：`staging_market_bar_raw`、`staging_quote_list`、`staging_security_status`。
  - 在事务中插入 smoke rows、查询计数、回滚，验证连接、schema、staging 和 pressure smoke。
  - 全部通过时自动输出 `status=ready`；连接失败时记录 `verification.error`，不放行。
  - 未配置 URL 时继续输出 `not_configured`，并说明 Node `pg` client 已可用。
- `securityStatusService` 新增可选 Tushare 正式交易状态 provider：
  - 配置 `FAMS_TUSHARE_TOKEN` 或 `TUSHARE_TOKEN` 后启用。
  - 调用 `stock_basic` 写入上市状态。
  - 调用 `suspend_d` 写入停复牌状态。
  - 调用 `stk_limit` 写入涨跌停价格。
  - 输出 provider=`tushare` 的 `SecurityStatusDaily / MarketTradeabilityDaily`，使 `formalTradingStateRows` 有真实来源。
- `stock_screener_full_scan / strategy_tournament_run` 在证券状态 canonical 化阶段自动尝试 Tushare 正式交易状态补齐；无 token 时保持原 canonical/heuristic 行，不伪造正式状态。

验收结论：

- 后端 TypeScript：通过。
- 前端 TypeScript：通过。
- `npm run test:screener-service`：通过。
- `npm run test:strategy-tournament-backtest`：通过。
- 小样本 Operation `b7b6e30c-dc9b-440d-929b-9fce9731c877`：status=`partial`、artifactCount=`31`。
- `postgres_shadow_readiness_report.json`：status=`not_configured`，verification.clientTool=`psql_missing`，但 Node `pg` client 验收路径已可用；当前环境未配置 shadow URL，因此不能转绿。
- `security_status_coverage_report.json`：status=`partial`，正式交易状态仍缺 token 产出的 Tushare 行。
- `p5_closure_review.json`：decision=`P5_COMPLETE_RESEARCH_ONLY`、productionReady=`false`。

改绿条件：

- 配置可连接 PostgreSQL：`FAMS_POSTGRES_SHADOW_DATABASE_URL=postgresql://...`。下一次 Operation 会自动执行 `fams_shadow` schema/staging/smoke 验证，全部通过后 PG shadow gate 变为 `ready`。
- 配置正式交易状态源：`FAMS_TUSHARE_TOKEN` 或 `TUSHARE_TOKEN`。下一次 Operation 会抓取 `stock_basic / suspend_d / stk_limit`，产生 `formalTradingStateRows > 0` 后证券状态 gate 才可能推进。
- 运行足够样本的 OOS 分层复验；小样本仍会按设计输出 `insufficient`。

当前结论：本阶段完成“真实转绿路径”，但本机未提供 PostgreSQL shadow 和 Tushare token，所以生产 gate 继续保持红灯；这是正确阻断，不是代码缺陷。

## 2026-05-31 P5.7 生产就绪自检脚本与正式状态口径收紧

阶段规则复验：P5.6 已实现真实转绿路径，但日常验收仍依赖查看 Operation artifact。继续开发的目标是提供一个直接可运行的 production readiness 自检入口，并修正 Tushare 上市状态覆盖口径。

设计审计：

- 自检脚本必须可在未配置外部依赖时正常完成，并输出失败 gate；只有显式 `--strict` 时才用非零退出码阻断 CI。
- 涨跌停价覆盖不能在没有正式交易状态行时通过；quote-list、baostock 身份源或 heuristic limit 只能作为过渡事实，不能让生产门禁变绿。
- Tushare `stock_basic` 不能只查询 `list_status=L`；否则退市、暂停上市或缺失标的容易被误判。

实现：

- 新增 `backend/scripts/verify-production-readiness.ts`。
- 新增 npm script：`npm run test:production-readiness`。
- 自检输出 `fams.production_readiness_check.v1`，包含：
  - `postgres_shadow_ready`
  - `tushare_formal_trading_state`
  - `limit_price_coverage`
  - PG shadow readiness 原始报告
  - security status coverage 原始快照
  - nextActions
- `--strict` 或 `FAMS_READINESS_STRICT=1` 时，如果未全部通过则返回非零退出码，供 CI 或发布前 gate 使用。
- Tushare `stock_basic` 查询扩展为 `L / D / P` 三类上市状态。
- Tushare 状态写入时区分：
  - `L -> listed`
  - `D -> delisted`
  - `P -> suspended_listing`
  - 缺失 -> `unknown`
- `limit_price_coverage` gate 收紧为：必须同时满足 `formalTradingStateRows > 0` 且正式源涨跌停价覆盖非零。

验收结论：

- 后端 TypeScript：通过。
- `npm run test:screener-service`：通过。
- `npm run test:production-readiness`：通过命令执行，报告 `productionReady=false`。
- 当前环境自检结果：
  - `postgres_shadow_ready=failed`，原因是未配置 shadow PostgreSQL URL。
  - `tushare_formal_trading_state=failed`，原因是未配置 Tushare token。
  - `limit_price_coverage=failed`，原因是没有正式源涨跌停价覆盖。

当前结论：P5 的“怎么改绿”已经具备脚本化验证入口；当前红灯可以被稳定复现和解释，但不能绕过。下一步若继续推进，应在提供 PG URL 与 Tushare token 后跑 `npm run test:production-readiness -- --strict`，再执行完整 Operation 验收。

## 2026-05-31 P5.8 PostgreSQL Shadow 本机配置与 GPT 优化核对

阶段规则复验：P5.7 已提供 production readiness 自检。用户要求“继续完成这些配置，确保能输出交易建议，并确认 GPT 优化建议完全完成”。本阶段先尝试完成可由本机自动化完成的配置；对需要外部 token 或策略证据通过的部分不做伪造。

实现：

- 使用 winget 安装 Windows PostgreSQL 17。
- 服务 `postgresql-x64-17` 已运行，`127.0.0.1:5432` 可连接。
- 创建专用 shadow 用户与数据库：`fams_shadow`。
- 将 `FAMS_POSTGRES_SHADOW_DATABASE_URL` 写入 `backend/.env`。
- 恢复 `pg_hba.conf` 为 `scram-sha-256` 密码认证。
- `verify-production-readiness.ts` 已加载 `.env`，可读取本机 shadow URL。
- 新增 `backend/scripts/verify-gpt-optimization-plan.ts` 与 `npm run test:gpt-optimization-plan`，机器核对 GPT 优化建议是否落地。
- 新增 [PRODUCTION_READINESS_RUNBOOK.md](/mnt/c/workSpace/financial-asset-manager/docs/PRODUCTION_READINESS_RUNBOOK.md)，记录生产放行条件、当前本机状态和剩余阻断。
- `backend/.env.example` 增加 PG shadow、Tushare 和 readiness strict 配置模板。

验收结论：

- 后端 TypeScript：通过。
- `npm run test:production-readiness`：通过命令执行，报告 `postgres_shadow_ready=passed`、`productionReady=false`。
- `npm run test:production-readiness -- --strict`：按预期失败，因为 `tushare_formal_trading_state` 与 `limit_price_coverage` 仍 failed。
- `npm run test:gpt-optimization-plan`：通过，12/12 项 passed，状态为 `implemented_with_external_blockers`。
- `npm run test:screener-service`：通过；测试已更新为允许 PG shadow gate 从 failed 变为 passed，同时继续断言 security status provider 是 blocker。

当前结论：

- GPT 优化建议中的架构与工程项已完成机器核对。
- PostgreSQL shadow 已从阻断项变为 passed。
- 交易建议仍不能输出 `ADD / REDUCE`，因为正式交易状态源和 OOS/validation gate 仍未通过。
- 当前唯一可继续自动化的下一步是配置 `FAMS_TUSHARE_TOKEN` 后复跑 strict readiness；没有 token 时不能把正式交易状态伪造成绿色。

## 2026-05-31 P5.9 免费信源分析建议放行与 Tushare 可选化

阶段规则复验：P5.8 已让 PostgreSQL shadow 通过真实连接、schema、staging 和 smoke 验证；GPT 优化建议 12/12 项已完成机器核对。用户明确要求：Tushare 只需要预留接口，用户可以选择接入或不接入；系统分析建议可以基于免费来源输出。因此本阶段调整的是“分析建议 readiness”和“交易动作 readiness”的边界，不降低交易动作 gate。

设计审计：

- Tushare 保持为可选增强 provider：接口保留 `stock_basic / suspend_d / stk_limit`，配置 token 后可补正式交易状态、停复牌和涨跌停价。
- 免费来源第一段使用 `quote_list_canonical / baostock / canonical feature cache` 支撑分析建议、候选池、观察建议和人工复核草案。
- `ADD / REDUCE / AUTO_TRADE` 仍由 OOS/validation、正式市场约束、人工确认边界控制；免费源分析建议不能绕过交易动作 gate。
- readiness 拆分为 `analysisAdviceReady` 与 `tradeActionReady`：前者允许免费源通过，后者仍保持 false。

实现：

- `security_status_coverage_report.json` 的 provider policy 更新为 `free_sources_primary_tushare_optional`。
- `formal_trade_state_rows` 与正式涨跌停价缺口从分析建议 blocker 调整为 warning；缺失时降低置信度并提示人工复核。
- `test:production-readiness -- --strict` 改为检查分析建议 readiness：PG shadow + 免费源证券状态覆盖通过即可 strict 通过。
- `verify-gpt-optimization-plan` 的外部 blocker 更新为：Tushare token 可选，OOS 分层验证仍阻断 `ADD / REDUCE`。
- Runbook 明确区分“分析建议放行条件”和“交易动作放行条件”。

验收结论：

- 后端 TypeScript：通过。
- `npm run test:screener-service`：通过。
- `npm run test:production-readiness -- --strict`：通过；输出 `analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。
- `npm run test:gpt-optimization-plan`：通过；12/12 项 passed，状态 `implemented_with_external_blockers`。

当前结论：

- 系统现在可以基于免费来源输出分析建议、候选池、观察建议和人工复核草案。
- Tushare 已降级为用户可选增强接口，不再阻断分析建议 readiness。
- 交易动作仍不能输出 `ADD / REDUCE`；剩余阻断是 OOS/validation 需要足够样本通过，以及执行级交易状态/涨跌停复核需要正式源或人工确认。

## 2026-05-31 P5.10 交易动作 Readiness 动态门禁与验证覆盖增强

阶段规则复验：P5.9 已确认分析建议 readiness 可以基于免费来源放行，但交易动作仍显示 `tradeActionReady=false`。本阶段先消除工程层面的假阻断：不能再把 `tradeActionReady` 写死为 false；同时扩大全 A 深度验证覆盖，减少只验证 top-3 候选导致的稳定组合漏检。

设计审计：

- 交易动作 readiness 必须读取最新可审计的 `strategy_tournament_run` 长样本 evidence，而不是只看环境配置。
- readiness 必须拆出 `full_a_strategy_evidence / validation_evidence / factset_coverage / manual_execution_review` gate。
- `--strict` 继续只检查分析建议 readiness；新增 `--strict-trade` / `test:trade-action-readiness` 检查交易动作 readiness。
- 不新增策略、不降低 OOS、walk-forward、参数敏感性或分组稳定性标准。
- 全 A 深度验证从固定 top-3 改为可配置 top-N，默认 12，上限 20，降低漏检但控制耗时。

实现：

- `verify-production-readiness.ts` 新增 `tradeActionReadiness` 报告，自动读取最近 `strategy_tournament_run`，优先选择覆盖率、窗口、样本量、可信度和 validation 质量最高的 evidence。
- `tradeActionReady` 改为动态计算：`analysisAdviceReady && tradeActionReadiness.readyForManualTradeDraft`。
- 新增 npm script：`npm run test:trade-action-readiness`。
- `stockScreenerService` 全 A 深度验证 top-N 改为 `FAMS_SCREENER_DEEP_VALIDATION_TOP_N`，默认 12，上限 20。
- `.env.example` 与 Runbook 增加 `FAMS_SCREENER_DEEP_VALIDATION_TOP_N` 和 `FAMS_TRADE_READINESS_STRICT`。

验收结论：

- 后端 TypeScript：通过。
- `npm run test:production-readiness -- --strict`：通过；分析建议 readiness 仍为 green。
- `npm run test:production-readiness -- --strict-trade`：按预期失败；报告选择全 A Operation `92bf373f-448c-4958-8456-d3583d5d415f`，`full_a_strategy_evidence=passed`、`factset_coverage=passed`，唯一交易动作 blocker 为 `validation_evidence`。

当前结论：

- 已消除“交易 readiness 永远硬编码 false”的工程阻断。
- 当前剩余真实阻断是策略稳定性：至少一个候选组合必须同时通过样本外、walk-forward、参数敏感性和分组稳定性验证。
- 下一步应在不新增策略、不降低 gate 的前提下，使用扩大后的 top-N 深度验证重新跑全 A 60 日 evidence；若仍失败，继续做 OOS 时间窗口和市场状态分层诊断。

## 2026-05-31 P5.11 全 A top-12 深度验证复跑与执行阻断闭环

阶段规则复验：P5.10 已新增动态交易动作 readiness，但还需要真实复跑扩大 top-N 后的全 A 60 日 evidence。本阶段先执行复跑；首次复跑暴露 `security_status.canonicalize` 长事务超时，随后修复并复验。

实现：

- `securityStatusService.upsertHeuristicFromRecords` 从单个大事务改为分批小事务，默认每 `250` 条提交一次，可用 `FAMS_SECURITY_STATUS_UPSERT_CHUNK_SIZE` 调整。
- 分批事务设置 `maxWait=10000`、`timeout=20000`，避免 5000+ 标的证券状态 canonicalize 时 Prisma 事务过期。
- `verify-production-readiness.ts` 的 trade action evidence 查询范围从仅 `strategy_tournament_run` 扩展为 `strategy_tournament_run / stock_screener_full_scan`，确保全 A dry-run 产物能进入 readiness。

验收结论：

- 后端 TypeScript：通过。
- `npm run test:screener-service`：通过。
- 全 A 60 日 top-12 复跑 Operation `52cfc9bf-ceb4-49cf-8f94-c56272117492` 完成 `partial`：
  - `scannedCount=5524`
  - `evaluatedCount=5447`
  - `providerSuccessRate=98.61%`
  - `cacheHitRate=99.95%`
  - `backtestDays=60`
  - `bestSampleSize=3766`
  - `bestCredibility=high`
  - `security_status.canonicalize` 完成，`successCount=5447`，耗时约 `7407ms`
  - `full_a_strategy_evidence=passed`
  - `factset_coverage=passed`
  - 唯一失败 gate：`validation_evidence`
- `npm run test:production-readiness -- --strict`：通过，`tradeActionReadiness.latestEvidence.operationId=52cfc9bf-ceb4-49cf-8f94-c56272117492`。
- `npm run test:trade-action-readiness`：按预期失败，退出码非零，唯一 blocker 为 `validation_evidence`。

验证发现：

- top-12 深度验证中已诊断 `10` 个候选组合，`passedCount=0 / failedCount=10`。
- 主要失败点不是样本量、覆盖率、缓存或 provider，而是样本外窗口：
  - 多数候选 `walk_forward / parameter_sensitivity / group_stability` 通过。
  - `outOfSampleValidation` 全部失败。
  - 样本外超额收益不为正，样本外平均收益显著低于训练窗口。
  - 市场状态从“弱势回撤”切换为“高波动震荡”。

当前结论：

- 已消除执行链路阻断：证券状态 canonicalize 不再因大事务失败。
- 已消除 readiness 引用旧证据的问题。
- 剩余 blocker 是真实策略稳定性问题，不能通过工程手段改绿。
- 下一步不得为了放行交易动作而降低 gate；应进入 OOS 市场状态适配、时间窗口复验和候选策略降级逻辑，明确当前策略只允许 `OBSERVE`。

## 2026-05-31 P1-P5 收口复验与前端选股策略验收

阶段规则复验：P5.11 已完成全 A top-12 深度验证复跑，工程链路剩余 blocker 已收敛为 `validation_evidence`。本阶段不新增策略、不降低 OOS / walk-forward / 参数敏感性 / 分组稳定性 gate，只做 P1-P5 收口判断、前端策略路径验证和人工验收清单固化。

收口判断：

- P1-P5 的数据基础设施、异步 Operation、行情缓存、provider 治理、feature cache、策略 evidence、事实集缓存、生产 readiness 自检和前端任务中心/分析页展示可以按“研究与分析建议链路”收口。
- 系统现在允许输出：分析建议、候选池、观察建议、异步 evidence 引用、人工复核草案。
- 系统仍禁止输出或放行：`ADD / REDUCE / AUTO_TRADE`。唯一真实阻断为 `validation_evidence`，即当前 top-12 深验候选没有通过样本外稳定性验证。
- Tushare 保持可选增强接口；未配置时不阻断免费源分析建议，但交易执行前仍需人工复核停牌、涨跌停和正式交易状态。

前端策略验收：

- 后端直连验证三类策略均返回 HTTP 200 和结构化结果：
  - `A杀后横盘放量`：`strategyId=a_flush_sideways_volume`，全 A universe=`5524`，扫描=`120`，当前严格条件命中=`0`，返回候选排序和未命中原因。
  - `放量突破平台`：`strategyId=volume_platform_breakout`，全 A universe=`5524`，扫描=`120`，当前严格条件命中=`0`，返回候选排序和未命中原因。
  - `跌破后收复关键均线`：`strategyId=ma_reclaim`，全 A universe=`5524`，扫描=`120`，当前命中=`4`，候选包含 `000409 云鼎科技`、`000151 中成股份`、`000063 中兴通讯`。
- 前端 Playwright 验证通过，页面 `http://localhost:3000/analysis` 的 AI 选股输入框分别提交三类查询后，均能渲染：
  - `AI选股结果 - ...`
  - `策略定义`
  - `异步策略证据引用`
  - 样本数、扫描数、匹配数和 `仅可观察引用` 边界。
- 截图产物：`.verification/frontend-screener-validation.png`。

机器验收：

- 后端 TypeScript：`node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 TypeScript：`node node_modules/typescript/bin/tsc --noEmit` 通过。
- `npm run test:production-readiness -- --strict`：通过；`analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。
- `npm run test:gpt-optimization-plan`：通过；12/12 项 passed。
- `npm run test:trade-action-readiness`：按预期失败；唯一 blocker=`validation_evidence`。

当前结论：

- P1-P5 可以按“研究/分析建议可用、交易动作阻断正确”的标准收口。
- 不能按“可输出加仓/减仓交易建议”的标准收口。
- 下一主线不得继续堆新策略；应先处理 `validation_evidence`：做市场状态分层策略适配、样本外窗口复验、或把当前失败策略明确降级为观察池。

## 2026-05-31 持仓研究证据展示与 AI 选股前端闭环修复

阶段规则复验：上一轮 P1-P5 收口确认研究链路可用，但前端持仓研究仍有较多 `missing / insufficient` 可见内容，且用户侧 AI 选股入口存在“看不到结果”的体验问题。本阶段只优化证据呈现、列表性能和前端闭环，不解除 `validation_evidence` 交易动作 gate。

实现内容：

- `getHoldingsResearch` 改为批量读取 `PositionAdviceCache`，不再在列表接口逐只触发完整 `PositionAdviceService`，避免股票/ETF 外部分析和 SQLite 写锁导致页面长时间无响应。
- 现金类持仓在持仓研究中明确返回 `positionAdvice=null`，卡片展示“现金类不生成仓位建议”，只作为流动性和待建仓资金池管理。
- 持仓卡片改为摘要模式：展示市值、收益率、现价/成本、证据数量和关键 evidence 标签；点击“查看详情”后再展示仓位建议、评分、理由、风险、阻断原因、触发条件、反证条件、基本面、技术面和消息面。
- 股票/ETF 的展示证据接入 `market_feature_daily`：外部技术评级未缓存时，列表页补充 canonical 行情预计算特征，包括趋势、动量、相对强弱、波动、流动性、支撑压力和特征日期。
- 对交易所 ETF 代码（如 `513770 / 159851`）增加展示层 ETF 口径：不再把“缺少股票基本面模型”作为前端主要阻断；当 ETF feature cache 缺失时，使用持仓现价/成本生成低强度展示参考，并保留“需补 ETF canonical 特征”的风险边界。
- 同步 AI 选股入口验证：前端提交 `A杀后近20个交易日横盘，最近两个交易日成交量明显放大` 可返回全 A 结果，显示策略定义、异步 evidence、样本数、扫描数、匹配数、provider 成功率、`OBSERVE_ONLY` 和 `validation_evidence` blocker。

验证：

- 后端 TypeScript：`node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 TypeScript：`node node_modules/typescript/bin/tsc --noEmit` 通过。
- `GET /api/v1/analysis/holdings-research?userId=default`：22 条持仓约 0.03 秒返回；现金持仓无 `positionAdvice`；`technical_factset_missing` 前端可见阻断为 0；剩余股票基本面缺口集中在 `601127 / 600276 / 000651`，仍作为真实基本面事实集缺口保留。
- Playwright：`/analysis?section=holdings` 可见持仓摘要、现金不生成建议、22 个“查看详情”按钮；点击赛里斯详情后可见完整仓位建议、评分、理由、风险、触发条件、反证条件和三面分析内容。
- Playwright：`/analysis?section=overview` 提交 AI 选股查询后渲染 `AI选股结果 - A杀后横盘放量`，全 A 样本 `5524`、扫描 `5524`、匹配 `18`、K 线有效 `5509`、provider 成功率 `99.73%`，并显示 `OBSERVE_ONLY / validation_evidence` 阻断。
- `npm run test:production-readiness -- --strict`：通过，`analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。
- `npm run test:gpt-optimization-plan`：通过，12/12 项 passed。
- `npm run test:trade-action-readiness`：按预期失败，唯一 blocker=`validation_evidence`。

结论：

- 前端研究阅读价值和响应速度已闭环：列表展示摘要，详情展示完整证据，现金类不再生成无意义建议。
- AI 选股前端结果链路已闭环，可返回全 A 当前筛选结果和异步策略 evidence。
- 交易动作仍不放行。`validation_evidence` 继续保持红灯，下一步只能围绕样本外稳定性、市场状态分层和候选组合降级处理。

## 2026-05-31 Validation Evidence 矩阵闭环第一段

阶段规则复验：上一阶段已经确认 `validation_evidence` 是唯一交易动作 blocker。当前阶段继续闭环，但不新增选股策略、不降低 OOS / walk-forward / 参数敏感性 / 分组稳定性标准。

实现内容：

- 新增 `validation_evidence_matrix.json` artifact，schema=`fams.screener.validation_evidence_matrix.v1`。
- 对 top 候选组合输出四项验证矩阵：
  - 样本外 OOS；
  - walk-forward；
  - 参数敏感性；
  - 分组稳定性。
- 每个候选新增：
  - `failedChecks`；
  - `blockerTags`；
  - `actionClass`；
  - `nextAction`；
  - OOS 训练/样本外超额收益、平均收益、样本量和变化量。
- `actionClass` 用于后续闭环分流：
  - `eligible_manual_review`：四项通过，可进入人工复核；
  - `regime_retest`：主要卡在 OOS，应做市场状态分层和多窗口 OOS；
  - `parameter_retest`：参数敏感，应验证参数邻域；
  - `group_retest`：分组不稳，应限制行业/市值/市场状态适用范围；
  - `needs_more_samples`：样本不足；
  - `observe_only`：保留观察；
  - `retire_candidate`：多项失败，从交易建议候选中淘汰。
- 任务中心新增“验证矩阵”导航和可视化预览。
- 前端 AI 选股在显式 `即时回测=1` 时展示 Validation Evidence 矩阵；普通 AI 选股仍默认引用异步 full-A evidence，不即时跑回测。

验证：

- 后端 TypeScript：`node node_modules/typescript/bin/tsc --noEmit` 通过。
- 前端 TypeScript：`node node_modules/typescript/bin/tsc --noEmit` 通过。
- `npm run test:screener-service` 通过，已断言 `validation_evidence_matrix.v1`、候选矩阵、失败检查和闭环计划。
- 小样本即时回测 `A杀后横盘放量；扫描上限=30；验证天数=10；持有天数=3；即时回测=1` 返回：
  - matrix=`fams.screener.validation_evidence_matrix.v1`
  - status=`blocked`
  - decision=`OBSERVE_ONLY`
  - primaryBlocker=`out_of_sample`
  - candidates=`20`
- `npm run test:production-readiness -- --strict` 通过，`analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。
- `npm run test:trade-action-readiness` 按预期失败，唯一 blocker 仍为 `validation_evidence`。

结论：

- `validation_evidence` 不再只是一个红灯，而是可以拆到候选组合级别看清楚是哪一项失败。
- 当前主阻断已明确为 `out_of_sample`，下一步应优先处理 `actionClass=regime_retest` 的候选，做市场状态分层 OOS、多窗口 OOS 和近期高波动窗口复验。
- 交易动作继续保持阻断；没有四项同时通过的候选前，不允许输出 `ADD / REDUCE / AUTO_TRADE`。

## 2026-05-31 OOS 多窗口与市场状态复验第一段

阶段规则复验：上一阶段已把 `validation_evidence` 拆成候选级四项矩阵，并确认当前主阻断为 `out_of_sample`。本阶段继续处理 OOS 阻断，但不新增选股策略、不调整阈值、不用复验报告替代原有四项 gate。

实现内容：

- 新增 `oos_multi_window_regime_retest.json` artifact，schema=`fams.screener.oos_multi_window_regime_retest.v1`。
- 对 `actionClass=regime_retest` 或 OOS 未通过的 top 候选执行多窗口复验：
  - `train_60_oos_40`；
  - `train_70_oos_30`；
  - `train_80_oos_20`。
- 每个窗口输出训练窗口/样本外收益分布、样本量、胜率、均值、中位数、均值变化和状态。
- 增加市场状态桶复验，按 `marketRegime` 比较训练窗口和样本外窗口收益分布。
- 每个候选输出 `conclusion` 与 `nextAction`：
  - `eligible_manual_review`：仅当原四项矩阵已通过；
  - `regime_limited_candidate`：多窗口与市场状态存在局部研究价值，但仍不能交易放行；
  - `needs_more_samples`：样本不足；
  - `observe_only`：继续观察；
  - `retire_candidate`：多窗口或市场状态复验失败，应从交易建议候选中淘汰。
- 任务中心新增“多窗口OOS”导航和可视化预览。

验收要求：

- `validation_evidence` 原 gate 不得因该报告降低标准。
- `ADD / REDUCE / AUTO_TRADE` 仍只能在 OOS、walk-forward、参数敏感性、分组稳定性全部通过后进入人工复核。
- 多窗口失败和市场状态桶失败必须显示为候选淘汰或观察依据，而不是被 AI 包装成买卖建议。

## 2026-05-31 AI 选股结果数量与手动条件第一段

阶段规则复验：本阶段只修复当前选股产品可用性，不新增未经回测的新策略，也不解除 `validation_evidence` 交易动作 gate。

实现内容：

- 当前 AI 选股支持 3 个内置策略：
  - `a_flush_sideways_volume`：A杀后横盘放量；
  - `volume_platform_breakout`：放量突破平台；
  - `ma_reclaim`：跌破后收复关键均线。
- 同步选股结果不再固定截断为 10 个。默认最多返回 200 个候选，可通过 `返回数量=80`、`候选上限=300`、`maxResults=100` 调整。
- 前端 AI 选股结果新增“当前显示 N”标签，并展示候选的 PE、PB、总市值、手动过滤命中/失败原因。
- 新增手动条件解析：
  - `市盈率<20`、`PE<=20`、`市盈率在20以下`；
  - `市盈率>5`、`PE>=5`；
  - `市值>100亿`、`市值<500亿`；
  - `行业:半导体` 或 `板块:银行`。
- PE/PB/市值优先来自 quote-list canonical / 本地事实集；当当前技术候选缺少 PE 且用户显式设置 PE 条件时，系统只对技术命中的候选补拉轻量估值快照，不对全 A 逐只拉完整基本面。

可靠性边界：

- PE 条件是硬过滤。若免费源无法返回 PE，相关候选不得假装通过 PE 条件。
- 当前 WSL 环境访问东方财富估值接口出现 `curl: (52) Empty reply from server`，因此 PE 条件可能因外部源不可用而返回 0 个候选；这属于数据可验证性阻断，不应伪造估值。
- 后续应把 PE/PB 纳入 quote-list canonical 的多源缓存，避免同步查询依赖实时外部接口。

## 2026-05-31 持仓建议解释层可读性修复

阶段规则复验：上一阶段已确认分析建议链路可用，但用户指出持仓分析建议详情“可读性差”，且基本面、技术面、消息面有效信息不足。本阶段只修复解释层、证据缺口和前端可读性，不解除 `validation_evidence` 交易动作 gate。

实现内容：

- `getHoldingsResearch` 的持仓详情接入 `PositionAdviceFactSet` 中的解释字段，新增 `positionAdvice.explanation`。
- 解释层明确展示确定性仓位公式：
  - `targetWeight = baseTargetWeight * marketRegimeMultiplier * signalMultiplier * riskPenaltyMultiplier * confidenceMultiplier`。
  - 前端展示基础目标仓位、市场系数、信号系数、风险惩罚、可信度系数、计算目标仓位、当前仓位和差额。
- 解释层明确展示动作触发规则和风险惩罚原因。
  - 例如 `601127 赛里斯` 当前 `REDUCE` 来自趋势分 `< 30` 的风控规则；综合可信度为 `low` 时加仓会降级为观察。
  - 该动作不是 LLM 输出，也不是基本面或消息面直接给出的交易结论。
- 技术面详情展示 `market_feature_daily` 的原始指标：MA20、MA60、MA120、20/60 日收益、RSI14、相对强弱、20 日波动率、20 日最大回撤、ATR14、量比和支撑/压力。
- 修复技术指标百分比显示错误：`market_feature_daily` 中收益率、波动率和回撤本身已经是百分数，前端解释层不再二次乘以 100。
- 基本面和消息面不再使用“已落地”类模板文案；当事实集缺失时，明确显示 `fundamental_factset_insufficient`、`news_factset_missing_or_empty` 等证据缺口。
- 前端详情页新增“证据缺口”区块，技术面卡片改为展示现价、成本、浮盈亏、支撑和压力，避免把基本面风险文案混入技术面。

验证：

- 后端 TypeScript 检查通过。
- 前端 TypeScript 检查通过。
- `GET /api/v1/analysis/holdings-research?userId=default` 验证 `601127`：
  - action=`REDUCE`、confidence=`low`；
  - 目标仓位公式输出 `baseTargetWeight=0.08`、`marketRegimeMultiplier=0.7`、`signalMultiplier=0.2`、`riskPenaltyMultiplier=0.56`、`confidenceMultiplier=0.3`、`finalTargetWeight=0.001882`、当前仓位约 `11.48%`；
  - 动作触发包含 `趋势分 0 < 30` 和 `综合可信度为 low`；
  - 技术详情显示 `20日收益=-8.42%`、`60日收益=-23.29%`、`20日波动率=2.50%`、`20日最大回撤=13.15%`；
  - 基本面显示事实集未生成，消息面显示无可引用事件。
- `npm run test:production-readiness -- --strict` 通过，`analysisAdviceReady=true`、`tradeActionReady=false`。
- `npm run test:trade-action-readiness` 按预期失败，唯一 blocker 仍为 `validation_evidence`。

未完成/阻断：

- WSL Playwright 截图仍被 Linux Chromium 依赖缺失阻断：`libnspr4.so: cannot open shared object file`；当前环境无免密 sudo，无法自动安装依赖。
- 基本面和消息面事实集本身仍需后续补齐；本阶段只是避免用模板话术伪装为已具备事实。

## 2026-05-31 价值评估模型第一段

阶段规则复验：上一阶段已完成持仓建议解释层，但“投资标的到底值多少钱/是否高估低估”的模型仍缺失。本阶段只实现结构化价值评估事实集和前端展示，不把价值评分直接转成 `ADD / REDUCE / AUTO_TRADE`。

实现内容：

- 新增 `valueAssessmentService`，输出 `value.assessment.factset.v1`。
- 新增接口：
  - `GET /api/v1/analysis/value-assessments?userId=default`
  - `GET /api/v1/analysis/value-assessments/:positionId`
- `holdings-research` 每条持仓新增 `valueAssessment`，前端持仓详情新增“价值评估模型”区块。
- 股票价值评估第一段复用本地缓存，不默认触发重外部请求：
  - `StockFactSetCache`；
  - `quote-list-canonical`；
  - 已缓存的东方财富财务报告、行业、总市值等事实。
- 股票评分拆为：
  - `valuationScore`：PE/PB 与行业分位；
  - `qualityScore`：ROE、毛利率、净利率、经营现金流/营收；
  - `growthScore`：营收同比、归母净利同比；
  - `financialRiskScore`：资产负债率、现金流、净利润正负；
  - `compositeScore`：估值 35%、质量 30%、成长 20%、财务安全 15%。
- 输出 `confidence`、`targetWeightMultiplier`、`blockedReasons`、`warnings`、`evidenceRefs` 和 `providerTrace`。
- 基金/ETF/债基第一段只输出专属估值缺口，不生成确定性高估/低估：
  - 底层指数估值分位；
  - 跟踪误差；
  - 费率；
  - 规模；
  - 折溢价；
  - 流动性。
- 黄金第一段只输出商品资产估值缺口，不套股票估值：
  - 实际利率；
  - 美元指数；
  - 央行购金；
  - 避险需求；
  - 组合对冲价值。
- 现金返回 `not_applicable`，不做价值评估。
- 新增 `npm run test:value-assessment`，锁定 schema、现金不适用、股票事实、evidenceRefs 和 insufficient 时仓位乘数降级。

验证：

- 后端 TypeScript 检查通过。
- 前端 TypeScript 检查通过。
- `npm run test:value-assessment` 通过，检查 22 个持仓、5 个股票、3 个现金。
- `GET /api/v1/analysis/value-assessments?userId=default` 验证返回 22 条。
- `601127` 验证结果：
  - status=`partial`；
  - conclusion=`insufficient`；
  - compositeScore=`47.96`；
  - confidence=`low`；
  - targetWeightMultiplier=`0.3`；
  - blockedReasons=`valuation_metrics_missing`；
  - evidenceRefs 包含 `stock-factset-cache:601127:stock_full_analysis`、`quote-list-canonical:601127`、`financial-report:601127:2026-03-31 00:00:00`。
- `GET /api/v1/analysis/holdings-research?userId=default` 验证 `601127` 的 `keyEvidence` 已包含 `价值评分 47.96 / low`，详情可展示价值评估事实。
- `npm run test:production-readiness -- --strict` 通过。
- `npm run test:trade-action-readiness` 按预期失败，唯一 blocker 仍是 `validation_evidence`。

当前结论：

- FAMS 已具备价值评估模型第一段的事实集契约、接口、前端展示和自动验收。
- 当前模型可用于研究和解释，不允许直接生成交易动作。
- 股票估值仍依赖 PE/PB 和财报 provider 覆盖；当 PE/PB 缺失时必须输出 `insufficient`，并将 `targetWeightMultiplier` 降到 `0.3`。
- 下一步应补齐 ETF/基金/债基的底层指数估值、费用、规模、折溢价和跟踪误差事实集，再把 `valueAssessment` 以只读证据形式接入 `PositionAdviceFactSet.fundamental`。

## 2026-05-31 PE/PB 缺口修复与 validation blocker 复核

阶段规则复验：用户指出 PE/PB 不应缺失，并询问唯一 blocker 是否可以解决。本阶段先修复可审计数据缺口，再复核交易动作 blocker；不通过放松 `validation_evidence` 闸门来“改绿”。

实现内容：

- `valueAssessmentService` 新增 PE/PB 派生 fallback：
  - 当 provider 未直接返回 PE/PB，但本地已有总市值、归母净利润、ROE 和财报周期时，PE/PB 可由可审计事实派生。
  - PE = 总市值 / 年化归母净利润。
  - PB = 总市值 / 由归母净利润与 ROE 反推的净资产。
  - 一季报、半年报、三季报分别使用 4、2、4/3 的年化系数；年报使用 1。
  - facts 中将来源标记为 `derived_from_market_cap_financial_report`，避免误认为是外部 provider 原始字段。
- `refresh-quote-list-canonical.ts` 和 `a_share_quote_sources.py` 已补充 PE/PB 字段传递能力，后续若 AkShare/Eastmoney spot 可用，canonical 会保留原始 PE/PB。
- `test:value-assessment` 增加 601127 回归断言：PE/PB 必须可用或可由已审计事实派生，且不得再出现 `valuation_metrics_missing`。

验证：

- 后端 TypeScript 检查通过。
- 前端 TypeScript 检查通过。
- `npm run test:value-assessment` 通过。
- `601127` 价值评估复验：
  - status=`available`；
  - conclusion=`reasonable`；
  - compositeScore=`46.74`；
  - valuationScore=`41.5`；
  - PE=`47.38`，source=`derived_from_market_cap_financial_report`；
  - PB=`3.47`，source=`derived_from_market_cap_financial_report`；
  - blockedReasons=`[]`。
- `holdings-research` 复验：601127 keyEvidence 显示 `价值评分 46.74 / low`。
- `npm run test:production-readiness -- --strict` 通过，分析建议 readiness 仍为 green。
- `npm run test:trade-action-readiness` 按预期失败，唯一 blocker 仍为 `validation_evidence`。

结论：

- PE/PB 缺口已经闭环。
- 当前唯一 blocker 不是 PE/PB 或价值评估模型缺失，而是策略 evidence 的真实验证失败：至少一个候选组合仍需要同时通过样本外、walk-forward、参数敏感性和分组稳定性。
- 在高可靠规则下不能直接删除或降低 `validation_evidence` gate；下一步应优化策略验证体系或策略组合，让候选在真实样本外验证中通过。

## 2026-06-01 P4.35-P4.40 剩余计划落地：候选处置与收口复验

阶段规则复验：P4 剩余计划重制后，主线不再新增选股策略，也不降低 OOS、walk-forward、参数敏感性和分组稳定性 gate。本阶段把 P4.35-P4.40 中缺少机器契约的“候选处置”和“收口复验”补入 Operation artifact 链。

实现内容：

- 新增 `validation_candidate_disposition.json` artifact，schema=`fams.screener.validation_candidate_disposition.v1`。
- 候选组合根据验证矩阵和 OOS 多窗口复验输出最终处置：
  - `eligible_manual_review`：四项 validation evidence 全部通过，只允许进入人工复核；
  - `regime_limited_candidate`：仅局部市场状态有研究价值；
  - `observe_only`：保留观察；
  - `retire_candidate`：多项或多窗口失败，从交易建议候选池移除；
  - `needs_more_samples`：样本不足，等待补样本复验。
- 所有非 `eligible_manual_review` 候选继续禁止 `ADD / REDUCE / AUTO_TRADE`。
- `p4_closure_review.json` 新增 `candidate_disposition` gate，并引用 `validation_candidate_disposition.json`。
- `data_quality_report.json` 同步写入 `validationCandidateDisposition`，前端任务中心新增“候选处置”artifact 导航和预览。
- 普通 AI 选股即时回测结果也返回 `validationCandidateDisposition`，用于调试查看候选最终处置，但不覆盖异步 full-A evidence。

验证目标：

- 后端 TypeScript、前端 TypeScript 通过。
- `npm run test:screener-service` 断言候选处置 schema、禁止自动交易、P4 closure 引用候选处置 artifact。
- `npm run test:strategy-tournament-backtest` 回归策略锦标赛核心口径。
- `npm run test:production-readiness -- --strict` 仍应通过分析建议 readiness。
- `npm run test:trade-action-readiness` 在无候选四项通过时仍应按预期失败，唯一 blocker=`validation_evidence`。

结论：

- P4 剩余计划的工程契约已收口为“验证矩阵 -> 多窗口复验 -> 候选处置 -> P4 closure”。
- 没有候选四项同时通过前，P4 只能输出研究观察和人工复核草案，不允许交易动作放行。

## 2026-06-01 FIVD-R / P4 合并开发计划第一段

实现内容：

- 产品口径调整：P4 竞标赛机制与 FIVD-R Core 价值评估/验证链路属于同一决策系统。P4 不再作为独立外部入口，而是内化为 FIVD-R 多 Agent 编排中的 `validation_tournament_agent`。
- 新增统一后端入口 `GET /api/v1/analysis/fivd-r`，输出 `fivd.r.analysis.result.v1`，聚合持仓研究、价值评估、PositionAdvice、最新策略验证 Operation、候选处置和 `agentTrace`。
- 前端服务新增 `getFivdRAnalysis` 类型与调用函数，后续统一面板可直接消费该结果。
- 新增 `npm run test:fivd-r-core`，验证组合级和持仓级 FIVD-R 输出结构、动作边界、内部验证来源和 Agent trace。
- 文档包 `docs/fams_analysis_advice_core_docs` 更新为 v0.2，PRD 与开发计划均明确“对外 FIVD-R 一套出入口，P4 仅作为内部验证锦标赛”。

结论：

- FIVD-R 与 P4 可以合并开发，且当前第一段已落到接口、类型、脚本和文档。
- 交易边界不变：`validation_evidence` 未通过前，FIVD-R 只能输出研究、观察和人工复核草案，不能放行 formal `ADD / REDUCE / AUTO_TRADE`。

## 2026-06-01 FIVD-R Phase 2 内部 Agent Trace 第一段

实现内容：

- `fivd.r.agent_trace.v1` 从描述性文本升级为可审计编排契约。
- 顶层新增 `scope / status / blockedReasons / evidenceRefs`，用于判断本次 FIVD-R run 是 completed、partial 还是 blocked。
- 五个内部 Agent 固化为 `evidence_agent / valuation_agent / validation_tournament_agent / discipline_agent / explanation_agent`，每个 Agent 输出 `sequence / status / inputRefs / evidenceRefs / blockedReasons / producedArtifacts / output`。
- `validation_tournament_agent` 继续消费原 P4 artifacts：`validation_evidence_matrix.json`、`oos_multi_window_regime_retest.json`、`validation_candidate_disposition.json`、`p4_closure_review.json`。
- `test:fivd-r-core` 增加 Agent trace 结构断言，防止后续退回不可审计文本。

验证：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:fivd-r-core` 通过。

结论：

- FIVD-R 内部多 Agent 编排已经具备第一段机器可读审计能力。
- 当前交易动作边界不变；validation evidence 未通过前仍只允许研究和观察。

## 2026-06-01 FIVD-R Phase 2.5 / Phase 3 统一面板第一段

实现内容：

- 新增 `07_FIVD_R_Stage_Governance.md`，固化 FIVD-R 后续阶段的开发计划、验收计划、PRD 检视和审计门禁流程。
- 新增 `08_FIVD_R_Phase3_Development_Acceptance_Audit.md`，记录 Phase 3 开发计划、验收计划、开发前审计、开发后 PRD 复检和真实数据端到端验收。
- 分析页新增 `FIVD-R` 分区，消费真实 `/api/v1/analysis/fivd-r?userId=default&scope=portfolio`。
- 面板展示 summary、允许/禁止动作、Evidence Gate、内部验证锦标赛、candidateDisposition、evidenceRefs 和五个内部 Agent Trace。
- 新增 `scripts/verify-fivd-r-phase3-panel.mjs`，启动真实后端和前端，用 Playwright 打开 `/analysis?section=fivdr` 并保存截图。

验证：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:fivd-r-core` 通过。
- `npm run test:production-readiness -- --strict` 通过。
- `npm run test:trade-action-readiness` 按预期失败，唯一 blocker=`validation_evidence`。
- `node scripts/verify-fivd-r-phase3-panel.mjs` 通过，截图 `.verification/fivd-r-phase3-panel.png`。

审计结论：

- 致命风险：无。
- 重大风险：无。
- 一般风险：真实 portfolio FIVD-R 接口耗时约 30-36 秒，position 级详情和 Expected Return 分布仍待后续阶段。
- 交易边界不变：`ADD / REDUCE / AUTO_TRADE` 仍禁止。

## 2026-06-01 FIVD-R 剩余开发总计划与门禁同步

实现内容：

- 新增 `09_FIVD_R_Remaining_Roadmap.md`，列出 FIVD-R 从 Phase 3.5 到 Phase 10 的剩余开发计划。
- 每个剩余阶段均明确开发前产物、实质开发范围、真实数据验收要求和打回条件。
- 固化阶段顺序：Position 级面板与性能审计、Expected Return Distribution、Trading Discipline 完整化、PositionAdvice 深接入、Advice Replay、人工复核、Calibration/Tuning、交易动作 Readiness 收口。
- 明确每阶段必须先完成开发计划、验收计划、PRD 规格检视和审计意见；无新增致命或重大风险后才能进入实质开发。
- 明确发现 PRD 偏差、虚假验收风险、真实数据不足、需要降低 gate 才能通过时必须停下来找用户确认。

审计结论：

- 允许进入 Phase 3.5 的开发前计划制定。
- 不允许跳过开发前审计直接实现 Phase 3.5。
- 当前交易边界不变：`validation_evidence` 未通过前，正式 `ADD / REDUCE / AUTO_TRADE` 仍禁止。

验证：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:fivd-r-core` 通过，validation source=`fivd_r_internal_validation_tournament`。
- `npm run test:production-readiness -- --strict` 通过。
- `npm run test:trade-action-readiness` 按预期失败，唯一 blocker=`validation_evidence`。

## 2026-06-01 FIVD-R Phase 3.5 开发前计划与审计同步

实现内容：

- 新增 `10_FIVD_R_Phase3_5_Development_Acceptance_Audit.md`。
- Phase 3.5 开发目标限定为：补齐单持仓 FIVD-R 详情，并审计 portfolio 级 FIVD-R 接口耗时。
- 开发计划明确 position 级详情必须展示真实 `positionId / symbol / valuation / tradingDiscipline / positionAdviceImpact / blockedReasons / agentTrace`。
- 验收计划要求使用真实非现金持仓，前端截图留存，并记录 portfolio 与 position 接口耗时。
- PRD 检视确认本阶段不开发 Expected Return Distribution，不开放交易动作，不新增 P4 独立入口。

开发前审计：

- 致命风险：无。
- 重大风险：无。
- 一般风险：portfolio 接口耗时高、Expected Return 仍为 placeholder、position 详情可能与持仓研究卡重复；均已设置开发与验收闭环约束。
- 结论：允许进入 Phase 3.5 实质开发；若真实 position 数据不足、接口性能无法支撑验收或存在虚假验收风险，必须停止并打回计划阶段。

基线复验：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `npm run test:fivd-r-core` 通过，validation source=`fivd_r_internal_validation_tournament`。
- `npm run test:production-readiness -- --strict` 通过，`analysisAdviceReady=true`、`productionReady=true`、`tradeActionReady=false`。
- `npm run test:trade-action-readiness` 按预期失败，唯一 blocker=`validation_evidence`。
- 审计结论：Phase 3.5 只允许进入 position 级详情和性能审计开发，不允许借此开放 `ADD / REDUCE / AUTO_TRADE`。

## 2026-06-01 FIVD-R Phase 3.5 实现与真实数据验收同步

实现内容：

- 分析页持仓研究面板新增 `查看 FIVD-R` 入口。
- position 级 FIVD-R 详情消费真实 `/api/v1/analysis/fivd-r?scope=position&positionId=...`。
- 详情展示真实 positionId、symbol、价值评估、Expected Return 当前状态、交易纪律、PositionAdvice Impact、禁止动作、blockedReasons 和 Agent Trace。
- 新增 `scripts/verify-fivd-r-phase3-5-position.mjs`，自动启动真实前后端，选择真实非现金持仓并完成 UI 验收。

真实数据验收：

- 持仓：`009725 / 中期债（一年） / positionId=4d144dc4-953d-4ce6-aa40-26f9277023b7`。
- 截图：`.verification/fivd-r-phase3-5-position.png`。
- 性能审计：`.verification/fivd-r-phase3-5-performance-audit.json`。
- portfolioLatencyMs=`33869`，positionLatencyMs=`16764`。
- 禁止动作仍包含 `ADD / REDUCE / AUTO_TRADE`，blockedReasons 包含 `validation_evidence`。

固定门禁：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `test:fivd-r-core` 通过。
- `test:production-readiness -- --strict` 通过。
- `test:trade-action-readiness` 按预期失败，唯一 blocker=`validation_evidence`。

审计结论：

- Phase 3.5 完成。
- 无致命或重大规格偏差。
- portfolio/position 接口耗时构成一般性能风险，后续应缓存化或 Operation 化；不允许因此放宽验收或交易 gate。

## 2026-06-01 FIVD-R Phase 4 开发前计划与审计同步

实现内容：

- 新增 `11_FIVD_R_Phase4_Expected_Return_Development_Acceptance_Audit.md`。
- Phase 4 目标限定为：把 `expectedReturn` 从 placeholder 升级为基于真实历史行情的收益分布。
- 开发计划要求输出 `p05/p25/p50/p75/p95`、上涨/下跌概率、最大回撤、样本量、置信度、method、reviewDate、maxObservedTradeDate 和 evidenceRefs。
- 验收计划要求使用真实持仓/真实资产，覆盖样本充分和样本不足场景，并验证 `maxObservedTradeDate <= reviewDate`。

开发前审计：

- 致命风险：无。
- 重大风险：无。
- 一般风险：资产类型行情来源不一致、样本不足案例可能需要受控 lookback、Phase 3.5 已有慢路径；均已设置开发和验收约束。
- 结论：允许进入 Phase 4 实质开发；若只能依赖 mock、随机数、未来行情或无法证明真实数据来源，必须停止并打回计划阶段。

## 2026-06-01 FIVD-R Phase 4 实现与真实数据验收同步

实现内容：

- position 级 FIVD-R 的 `expectedReturn` 升级为 `fivd.r.expected_return.distribution.v1`。
- 只读取真实本地历史行情：`market_bar_canonical` 和 `price_history`。
- 输出 20d/60d 的 historical holding-period return distribution。
- 前端 position 详情展示 expectedReturn 的 p05-p95、上涨/下跌概率、最大回撤、样本量或 insufficient 阻断原因。
- 新增 `scripts/verify-fivd-r-phase4-expected-return.mjs`。

真实数据验收：

- 产物：`.verification/fivd-r-phase4-expected-return-audit.json`。
- 截图：`.verification/fivd-r-phase4-expected-return.png`。
- `601127 / 赛里斯`：available，sampleSize=`110`，20d/60d 分布可用。
- `009725 / 013785`：insufficient，blockedReasons=`20d_sample_insufficient / 60d_sample_insufficient`。
- noFutureLeak=`true`，所有 `maxObservedTradeDate <= reviewDate`。

固定门禁：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- `test:fivd-r-core` 通过。
- `test:production-readiness -- --strict` 通过。
- `test:trade-action-readiness` 按预期失败，唯一 blocker=`validation_evidence`。

审计结论：

- Phase 4 完成。
- 无致命或重大规格偏差。
- 未使用 mock、随机数、未来行情或乐观模板。
- 交易边界不变：`validation_evidence` 未通过前，正式 `ADD / REDUCE / AUTO_TRADE` 仍禁止。

## 2026-06-01 FIVD-R Phase 5 开发前计划与审计同步

实现内容：

- 新增 `12_FIVD_R_Phase5_Trading_Discipline_Development_Acceptance_Audit.md`。
- Phase 5 目标限定为：把 `tradingDiscipline` 升级为完整纪律结构，不开放交易执行。
- 开发计划要求输出 bucket、disciplineType、有效期、复核频率、最大权重、目标权重乘数和 add/reduce/stop/takeProfit/invalidation 条件组。
- 验收计划要求真实持仓覆盖非现金和现金边界，validation failed 时 `formalTradeActionAllowed=false`。

开发前审计：

- 致命风险：无。
- 重大风险：无。
- 一般风险：资产类型覆盖、债券/基金 expectedReturn insufficient、validation evidence 未通过；均已设置开发和验收约束。
- 结论：允许进入 Phase 5 实质开发；若现金生成买卖建议、validation gate 被绕过或纪律被包装为正式交易动作，必须停止并打回计划阶段。

## 2026-06-02 FIVD-R Phase 16 Asset Identity Remediation 同步

实现内容：

- 新增 `POST /api/v1/analysis/fivd-r/asset-identity-resolution`。
- DataGap remediation 中 `asset_identity_missing` 已从 planned 升级为 executable。
- `resolve_asset_identity` 会生成 `fivd.r.asset_identity_resolution_report.v1` Operation artifact。
- 报告区分本地正式资产命中、lightweight research identity 和 unresolved symbol。
- 本阶段不写正式 `Asset` 表，不补齐估值/基本面事实集，不改变交易 gate。

真实数据验收：

- `601127` 可解析为已识别标的。
- `NOT_A_REAL_ASSET_123` 保持 unresolved。
- 正式 `Asset` 表记录数在解析前后保持不变。
- `allowedActions=["RESEARCH","OBSERVE"]`。
- `prohibitedActions` 包含 `ADD / REDUCE / AUTO_TRADE`。

固定门禁：

- 后端 TypeScript 通过。
- 前端生产构建通过。
- `test:fivd-r-asset-identity-remediation` 通过。
- `test:fivd-r-data-gap-remediation` 通过。
- `test:fivd-r-core` 通过。
- `test:fivd-r-trade-gate-contract` 通过。
- `test:production-readiness` 通过。
- `test:trade-action-readiness` 按预期失败，blocker=`validation_evidence`。

审计结论：

- Phase 16 完成。
- 无致命或重大规格偏差。
- asset identity remediation 只提升研究/观察链路可信度，不构成资产入账、交易草案或正式交易动作放行。

## 2026-06-02 FIVD-R Phase 17 Market Data Remediation 同步

实现内容：

- `market_bar_cache_preheat` Operation 支持 symbol 级输入。
- queued worker 和 retry replay 已保留 `symbols`，避免回退到默认全 A universe。
- DataGap remediation 中 `market_data` / `provider_health` with symbol 已升级为 executable。
- `refresh_market_data_cache` 启动 `market_bar_cache_preheat` queued Operation。

真实数据验收：

- fixture symbols：`601127`、`600000`。
- `requestedSymbols=2`。
- `universeSource=provided_symbols`。
- 本地缓存已足够，`attemptedSymbols=0`、`afterSufficientSymbols=2`。
- 产物：`market_bar_cache_preheat_report.json`。

审计结论：

- Phase 17 完成。
- 首次验收发现 worker replay 丢失 `symbols` 并回退默认 universe，已打回实现阶段修复。
- 修复后重新验收通过。
- 无致命或重大规格偏差。
- 本阶段只补行情缓存/技术特征，不补基金、黄金宏观、估值、基本面或财报事实集，不改变交易 gate。

## 2026-06-02 FIVD-R Phase 18.1-18.3 Fund/Gold Local FactSet 同步

实现内容：

- 新增 alternative asset factset service。
- 基金/债基输出 `fivd.r.fund_like_factset.v1`。
- 黄金输出 `fivd.r.gold_macro_factset.v1`。
- `valueAssessmentService` 对 fund/bond/gold 接入本地真实历史指标。
- 黄金新增 `priceScaleCheck`，单日涨跌超过 20% 即阻断为 `gold_price_scale_inconsistent`。

真实验收：

- `009725 / 中期债（一年）`：本地历史 6 条，status=`insufficient`。
- `002611 / 黄金`：本地历史 132 条，但发现价格尺度混用，status=`insufficient`。
- 黄金异常源：`market_bar_canonical:sina` 约 17-19，与 `price_history:goldFund` 约 974-1013 混入同一序列。
- 修复后黄金窗口收益/波动/回撤全部置空，不再输出 5000%+ 异常收益。

审计结论：

- 首次验收出现重大虚假验收风险，已按流程停下并采用保守方案修复。
- 修复后无新增致命或重大规格偏差。
- fund/gold factset 仍不宣称 available。
- 交易 gate 不变。

## 2026-06-02 FIVD-R Phase 18.4 Gold Source Scale Modeling 同步

实现内容：

- 黄金历史数据按 source family 分层。
- `physical_gold_price_proxy` 优先服务实物金价/克尺度。
- `fund_or_etf_trade_price` 保留为审计参考，不混入实物金价历史。
- `GoldMacroFactSet.sourceSelection` 记录选中源和排除源。

真实验收：

- `002611 / 黄金` 当前价格 `986.49`。
- 选中源：`price_history:goldFund`。
- 排除源：`market_bar_canonical:sina`、`market_bar_canonical:canonical`。
- `priceScaleCheck.status=passed`。
- `maxAbsDailyReturnPct=2.7999`。
- 去重后样本数 6，仍为 `insufficient`。

审计结论：

- 黄金混合尺度风险已闭环。
- 未伪造历史样本。
- 未做未授权 conversion rule。
- 未放行交易动作。

## 2026-06-02 FIVD-R Phase 18.5 Alternative History Backfill 同步

实现内容：

- 新增 alternative history backfill service。
- 基金/债基使用东方财富 `lsjz` 历史净值。
- 黄金使用 `goldFund` 历史净值乘以既有 factor 生成金价/克代理历史。
- 写入 `priceHistory`，不改持仓、不改交易 gate。

验收过程：

- 首次 provider axios 路径失败，打回并改为 curl-only。
- 第二次发现 `pageSize=260` 返回空，打回并改为 `pageSize=20` 分页。
- 第三次发现黄金 source selection 被跨 source 日期覆盖影响，打回并改为 unmerged source history。
- 第四次真实验收通过。

真实结果：

- `009725` 样本数 117，20d window available。
- `002611` goldFund 样本数 121，20d window available。
- 黄金仍只选 `price_history:goldFund`，排除 `market_bar_canonical:sina`。
- `priceScaleCheck.status=passed`。

审计结论：

- 无新增致命或重大规格偏差。
- fund/gold 从 insufficient 推进到 partial。
- 不宣称 full factset complete。
- 不放行 `ADD / REDUCE / AUTO_TRADE`。

## 2026-06-02 FIVD-R Phase 18.6 Fund Holdings FactSet 同步

实现内容：

- `FundLikeFactSet` 新增 `holdings` 子事实集。
- 使用真实东方财富 F10 `FundArchivesDatas.aspx?type=jjcc` 获取前十大持仓。
- 解析 `reportDate`、`topHoldings`、`top10ConcentrationPct`。
- 推导 research-only `holdingsStyle`。
- holdings 可用时只移除 `fund_holdings_factset_missing`，不移除 profile/fee 缺口。

真实结果：

- 检查真实 open fund/bond/ETF 持仓 13 个。
- `availableHoldingsCount=8`。
- `unavailableHoldingsCount=5`。
- 样本 `009725 / 中期债（一年）`：
  - `holdings.status=available`
  - `reportDate=2026-03-31`
  - `top10ConcentrationPct=3.11`
  - `holdingsStyle=low_equity_or_bond_like`
  - 当前 blocker 仅剩 `fund_profile_factset_missing`、`fund_fee_factset_missing`。

审计结论：

- Phase 18.6 完成。
- holdings 可审计来源已接入 providerTrace/evidenceRefs/sourceRefs。
- provider 空返回的基金继续保留 `fund_holdings_factset_missing`。
- 基金事实集仍为 partial，不宣称 profile/fee/久期/信用风险完成。
- validation evidence gate 不变。
- 不放行 `ADD / REDUCE / AUTO_TRADE`。

## 2026-06-02 FIVD-R Phase 18.7 Fund Profile / Fee FactSet 同步

实现内容：

- `FundLikeFactSet` 新增 `profile` 子事实集。
- `FundLikeFactSet` 新增 `fee` 子事实集。
- 使用真实东方财富 F10 `jbgk_*.html` 获取基金类型、经理、管理人、托管人、规模和 benchmark。
- 使用真实东方财富 F10 `jjfl_*.html` 获取管理费、托管费和销售服务费。
- 新增 `fund_risk_level_missing` 和 `bond_duration_credit_proxy_missing`，避免 profile/fee 补齐后出现空 blocker。
- 新增 DataGapSummary 映射。

验收过程：

- 首次验收发现 fee 页 label 是 `<td class="th">` 而不是 `<th>`，解析失败，已打回并修复。
- 回归脚本仍按旧 blocker 断言，已按 Phase 18.7 规格修正为检查剩余真实缺口。
- 第二轮发现 `missingFields` 有剩余缺口但 `blockedReasons` 为空，已打回并新增结构化 blocker。

真实结果：

- 检查真实 open fund/bond/ETF 持仓 13 个。
- `profileAvailableCount=13`。
- `feeAvailableCount=13`。
- 样本 `009725 / 中期债（一年）`：
  - `profile.status=available`
  - `fundCategory=混合型-偏债`
  - `managerNames=["王佳骏"]`
  - `managementCompany=东方红资产管理`
  - `fee.managementFeePct=0.4`
  - `fee.custodianFeePct=0.1`
  - `fee.salesServiceFeePct=0`
  - 当前 blocker：`fund_risk_level_missing`、`bond_duration_credit_proxy_missing`。

审计结论：

- Phase 18.7 完成。
- profile/fee 可审计来源已接入 providerTrace/evidenceRefs/sourceRefs。
- `fund_profile_factset_missing` 和 `fund_fee_factset_missing` 已对可用样本移除。
- 风险等级、债基久期/信用风险仍未完成，继续以结构化 DataGap 暴露。
- validation evidence gate 不变。
- 不放行 `ADD / REDUCE / AUTO_TRADE`。

## 2026-06-02 FIVD-R Phase 18.8 Bond Fund Holding / Credit Proxy 同步

实现内容：

- `FundLikeFactSet` 新增 `bondRiskProxy` 子事实集。
- 使用真实东方财富 F10 `zcpz_*.html` 获取资产配置。
- 使用真实东方财富 F10 `FundArchivesDatas.aspx?type=zqcc` 获取债券持仓。
- 将旧的 `bond_duration_credit_proxy_missing` 拆为更准确的缺口：
  - `bond_duration_proxy_missing`
  - `bond_credit_risk_proxy_missing`
- 信用 proxy 可用时移除 `bond_credit_risk_proxy_missing`，但继续保留久期 blocker。

真实结果：

- 样本 `009725 / 中期债（一年）`：
  - `bondRiskProxy.status=available`
  - `reportDate=2026-03-31`
  - `bondPct=92.68`
  - `topBondHoldings=5`
  - `topBondConcentrationPct=14.2`
  - `creditRiskFlags=["subordinated_or_capital_bond_exposure","bank_credit_exposure","brokerage_credit_exposure"]`
  - 当前 blocker：`fund_risk_level_missing`、`bond_duration_proxy_missing`。

审计结论：

- Phase 18.8 完成。
- 债券持仓和信用风险 proxy 只用于 research-only，不替代正式评级。
- 没有伪造久期。
- validation evidence gate 不变。
- 不放行 `ADD / REDUCE / AUTO_TRADE`。

## 2026-06-03 FIVD-R Phase 18.9 Gold USD Trend Proxy 同步

实现内容：

- `GoldMacroFactSet.macroProxies` 新增 `usdTrendProxy`。
- 使用真实 Yahoo chart `DX-Y.NYB` 获取 DXY 6 个月日线。
- 计算 DXY 20d / 60d return 和美元趋势。
- 将黄金宏观 broad blocker 拆细：
  - `gold_usd_trend_proxy_missing`
  - `gold_real_rate_proxy_missing`
  - `gold_inflation_expectation_proxy_missing`
- DXY 可用时移除 `usdTrend` missing field 和 `gold_usd_trend_proxy_missing`。

Provider 探测：

- Yahoo `DX-Y.NYB` 可用。
- Nasdaq UUP 可用但属于 ETF 代理，未优先采用。
- FRED `DFII10` / `T10YIE` / `DTWEXBGS` 当前网络 15s 超时。
- Stooq CSV 要求 apikey，不适合自动验收。

真实结果：

- 样本 `002611 / 黄金`：
  - `usdTrendProxy.status=available`
  - `sampleSize=125`
  - `latestDate=2026-06-03`
  - `latestValue=99.32`
  - `return20dPct=1.3263`
  - `return60dPct=0.4958`
  - `trend=flat`
  - 当前 blocker：`gold_real_rate_proxy_missing`、`gold_inflation_expectation_proxy_missing`。

审计结论：

- Phase 18.9 完成。
- DXY 只作为美元趋势代理，不替代实际利率或通胀预期。
- 黄金事实集仍为 partial，不宣称完整宏观模型。
- validation evidence gate 不变。
- 不放行 `ADD / REDUCE / AUTO_TRADE`。

## 2026-06-03 FIVD-R Phase 18.10 Gold TIPS / Inflation Proxy 同步

实现内容：

- `GoldMacroFactSet.macroProxies.realRateProxy` 接入 Nasdaq TIP ETF 历史。
- `GoldMacroFactSet.macroProxies.inflationExpectationProxy` 接入 Nasdaq TIP/IEF 相对表现。
- 新增 `test:fivd-r-gold-tips-inflation-proxy-factset`。
- 更新黄金回归验收，黄金自身宏观缺口闭环后仍保持 research-only partial。

Provider 探测：

- Nasdaq `TIP` historical 可用，返回 126 条真实 ETF 日线。
- Nasdaq `IEF` historical 可用，返回 126 条真实 ETF 日线。
- Treasury real yield XML 当前无结果。
- FRED 仍存在超时风险，暂不作为硬验收源。

真实结果：

- 样本 `002611 / 黄金`：
  - `realRateProxy.status=available`
  - `realRateProxy.method=tips_etf_price_pressure_proxy_v1`
  - `TIP return60dPct=-1.4694`
  - `pressure=real_rate_pressure_up`
  - `inflationExpectationProxy.status=available`
  - `inflationExpectationProxy.method=tips_vs_treasury_etf_relative_proxy_v1`
  - `TIP/IEF relativeReturn60dPct=1.1549`
  - `signal=inflation_expectation_up`
  - 当前黄金自身 `blockedReasons=[]`。

审计结论：

- Phase 18.10 完成。
- TIP/IEF 是 research-only ETF 市场代理，不替代官方实际利率或官方通胀预期。
- 黄金事实集仍为 `partial`，`valuation.conclusion=insufficient`。
- validation evidence gate 不变。
- 不放行 `ADD / REDUCE / AUTO_TRADE`。
