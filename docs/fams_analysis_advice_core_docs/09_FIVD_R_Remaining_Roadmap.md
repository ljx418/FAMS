# FIVD-R 剩余开发总计划与阶段门禁

版本：v0.1  
日期：2026-06-01

## 1. 当前基线

已完成：

- Phase 0：FIVD-R 与 P4 合并，P4 内化为 `validation_tournament_agent`。
- Phase 1：统一 API `/api/v1/analysis/fivd-r`。
- Phase 2：内部 Agent Trace 可审计。
- Phase 2.5：阶段治理、验收、PRD 检视和审计门禁第一段。
- Phase 3：统一前端 FIVD-R portfolio 面板第一段。

当前硬边界：

- 研究/观察链路可用。
- `ADD / REDUCE / AUTO_TRADE` 仍被 `validation_evidence` 阻断。
- 后续所有阶段必须使用真实数据验收；mock 只能用于负向单元测试，不能作为端到端通过依据。

## 2. 每阶段强制流程

每个子阶段必须按以下顺序执行：

1. 从总 PRD 和模型架构中抽取本阶段目标。
2. 单独形成阶段开发计划。
3. 单独形成阶段验收计划。
4. 单独形成 PRD 规格检视。
5. 单独形成审计意见。
6. 致命/重大审计意见全部闭环后，才允许进入实质开发。
7. 开发后执行真实数据端到端验收。
8. 验收失败则打回计划阶段重新思考、修订、再执行。
9. 验收通过后更新 PRD 复检、审计结论和高可靠计划。

停止找用户确认的条件：

- 发现 PRD 与实现目标存在较大偏差。
- 真实数据无法支撑阶段验收。
- 存在虚假验收风险。
- 需要降低 validation gate 才能通过。
- Research-Only 被误包装成交易动作。
- 端到端验收无法复现。

## 3. 剩余阶段计划

### Phase 3.5：Position 级 FIVD-R 面板与性能审计

目标：

- 在统一前端面板中补齐单持仓 FIVD-R 详情。
- 审计 portfolio 级接口 30 秒以上耗时问题。

开发前产物：

- `Phase3.5 Development Plan`
- `Phase3.5 Acceptance Plan`
- `Phase3.5 PRD Spec Review`
- `Phase3.5 Audit Opinion`

实质开发范围：

- 从持仓卡进入 position 级 FIVD-R。
- 展示单持仓 valuation、expectedReturn 当前状态、tradingDiscipline、positionAdviceImpact 和 agentTrace。
- 记录 portfolio 级接口耗时、慢点和是否需要缓存/Operation 化。

真实数据验收：

- 使用当前真实非现金持仓至少 1 个。
- 页面必须显示真实 positionId、symbol、valuation、blockedReasons。
- 禁止动作仍包含 `ADD / REDUCE / AUTO_TRADE`。
- 截图留存。

打回条件：

- position 级结果用 portfolio 数据冒充。
- 不显示 validation blocker。
- 接口耗时导致页面不可用且无审计结论。

开发前计划状态：

- 已形成 `10_FIVD_R_Phase3_5_Development_Acceptance_Audit.md`。
- 开发前审计结论：无致命/重大意见，允许进入实质开发。
- 实质开发已完成。
- 真实数据 E2E 已通过：`009725 / 中期债（一年） / positionId=4d144dc4-953d-4ce6-aa40-26f9277023b7`。
- 截图：`.verification/fivd-r-phase3-5-position.png`。
- 性能审计：`.verification/fivd-r-phase3-5-performance-audit.json`。
- 剩余一般风险：portfolio/position FIVD-R 慢路径需要后续缓存化或 Operation 化。

### Phase 4：Expected Return Distribution 第一段

目标：

- 将 `expectedReturn` 从 placeholder 升级为真实历史数据计算。

开发前产物：

- `Phase4 Development Plan`
- `Phase4 Acceptance Plan`
- `Phase4 PRD Spec Review`
- `Phase4 Audit Opinion`

开发前计划状态：

- 已形成 `11_FIVD_R_Phase4_Expected_Return_Development_Acceptance_Audit.md`。
- 开发前审计结论：无致命/重大意见，允许进入实质开发。
- 实质开发已完成。
- 真实数据 E2E 已通过，产物 `.verification/fivd-r-phase4-expected-return-audit.json`。
- 真实样本：`601127` 为 available，`009725 / 013785` 为 insufficient。
- 无未来函数审计通过：`maxObservedTradeDate <= reviewDate`。

实质开发范围：

- 支持股票/ETF 的 `20d / 60d` 收益分布。
- 输出 `p05/p25/p50/p75/p95`、上涨/下跌概率、最大回撤、样本量、置信度、method、evidenceRefs。
- 数据不足时必须 `confidence=insufficient`。

真实数据验收：

- 至少 3 个真实持仓。
- 至少覆盖 1 个样本充分和 1 个样本不足案例。
- 验证不读取未来 K 线。

打回条件：

- 使用固定模板、随机数或默认乐观分布。
- 无 sampleSize 或 evidenceRefs。
- 无法证明无未来函数。

### Phase 5：Trading Discipline Engine 完整化

目标：

- 按核心仓、卫星仓、现金生成完整交易纪律。

开发前产物：

- `Phase5 Development Plan`
- `Phase5 Acceptance Plan`
- `Phase5 PRD Spec Review`
- `Phase5 Audit Opinion`

实质开发范围：

- 输出 bucket、disciplineType、validFrom、validUntil、reviewCadence、maxAllowedWeight、targetWeightMultiplier。
- 输出 add/reduce/stop/takeProfit/invalidation conditions。
- 现金只能 `NO_ACTION`。
- 卫星仓必须有有效期、止损、止盈和失效条件。

真实数据验收：

- 使用真实持仓覆盖股票、基金/ETF、黄金/现金中当前存在的类型。
- validation 未通过时 formalTradeActionAllowed 必须 false。

打回条件：

- 现金生成买卖建议。
- 卫星仓无退出纪律。
- validation gate 被绕过。

开发前计划状态：

- 已形成 `12_FIVD_R_Phase5_Trading_Discipline_Development_Acceptance_Audit.md`。
- 开发前审计结论：无致命/重大意见，允许进入实质开发。
- 实质开发已完成。
- 真实数据 E2E 已通过，产物 `.verification/fivd-r-phase5-trading-discipline-audit.json`。
- 前端截图：`.verification/fivd-r-phase5-trading-discipline.png`。
- 真实样本：`009725 / 中期债（一年）` 和 `现金-现金-银行卡 / 银行卡`。
- 现金 discipline 已验证为 `bucket=cash / disciplineType=no_action / formalTradeActionAllowed=false`。
- validation gate 已保留，正式交易动作仍未放行。

### Phase 6：PositionAdvice Adapter 深度接入

目标：

- 让 FIVD-R 输出真正影响仓位建议，而不是只并列展示。

开发前产物：

- `Phase6 Development Plan`
- `Phase6 Acceptance Plan`
- `Phase6 PRD Spec Review`
- `Phase6 Audit Opinion`

开发前计划状态：

- 已形成 `13_FIVD_R_Phase6_PositionAdvice_Adapter_Development_Acceptance_Audit.md`。
- 开发前审计结论：无致命/重大意见，允许进入实质开发。
- 实质开发已完成。
- 真实数据 E2E 已通过，产物 `.verification/fivd-r-phase6-position-advice-adapter-audit.json`。
- 真实样本：`601127 / 赛里斯 / positionId=5c775de8-4167-4ed9-ba3e-938536f5d57c`。
- PositionAdvice 已输出 `fivd.r.position_advice_adapter.v1`，并接入 valuation/risk/evidence/validation/combined multipliers。
- validation gate 已保留，`validation_evidence` 阻断时 action 降级为 `OBSERVE`，正式 ADD / REDUCE 未放行。

实质开发范围：

- 接入 valuationMultiplier、evidenceConfidenceMultiplier、riskPenaltyMultiplier、validationGateMultiplier。
- PositionAdvice evidenceRefs 必须引用 FIVD-R run。
- validation 未通过时 ADD/REDUCE 继续阻断。

真实数据验收：

- 对真实组合运行持仓建议。
- 验证价值评分变化会影响目标仓位区间。
- 验证 `validation_evidence` blocker 仍被保留。

打回条件：

- PositionAdvice 与 FIVD-R 输出冲突。
- 无法追溯 FIVD-R evidenceRefs。
- validation failed 时仍 formal ADD。

### Phase 7：Advice Replay & Validation

目标：

- 验证 FIVD-R 分析建议体系是否改善组合结果。

开发前产物：

- `Phase7 Development Plan`
- `Phase7 Acceptance Plan`
- `Phase7 PRD Spec Review`
- `Phase7 Audit Opinion`

实质开发范围：

- Fixed Start：3m / 2m / 1m。
- Rolling Start：最近半年每周。
- 模式：Gate-Strict、Research-Only、Buy & Hold、Benchmark。
- 输出 decision timeline、simulated trades、portfolio curve、action quality、risk budget report、no-future-leak audit。

真实数据验收：

- 使用真实历史行情、真实持仓或真实候选池。
- 验证 reviewDate 后数据不可被读取。
- Gate-Strict 不执行 validation failed 的 formal ADD/REDUCE。

打回条件：

- 使用未来行情、未来财报或未来新闻。
- Research-Only 动作进入正式模拟交易。
- replay 结果不可复现。

开发前计划状态：

- 已形成 `14_FIVD_R_Phase7_Advice_Replay_Validation_Development_Acceptance_Audit.md`。
- 开发前审计结论：无致命/重大意见，允许进入 Phase 7 第一段实质开发。
- 第一段范围限定为 Gate-Strict + Buy & Hold 的真实数据 replay 最小闭环。
- 第一段实质开发已完成。
- 真实数据 E2E 已通过，产物 `.verification/fivd-r-phase7-advice-replay-audit.json`。
- 真实样本：`009725`，reviewDate=`2026-05-11`，horizonEnd=`2026-05-29`。
- Gate-Strict 下 decisionAction=`OBSERVE`，simulatedTrades=`0`，noFutureLeakAudit.leaked=`false`。
- 第二段实质开发已完成：多模式、多窗口 replay。
- 真实样本：`002611`，priceHistoryRows=`36`。
- startPolicies=`fixed_3m / fixed_2m / fixed_1m / rolling_weekly`。
- modes=`gate_strict / research_only / buy_and_hold / benchmark_cash`。
- windowsChecked=`8`，noFutureLeakAudit.leaked=`false`。
- Gate-Strict 未执行 formal ADD / REDUCE。

### Phase 8：人工复核与干预记录

目标：

- 支持用户对 FIVD-R 结果人工复核，并保留 append-only 审计。

开发前产物：

- `Phase8 Development Plan`
- `Phase8 Acceptance Plan`
- `Phase8 PRD Spec Review`
- `Phase8 Audit Opinion`

实质开发范围：

- 记录 review decision、reason、runId、evidenceRefs、reviewer、createdAt。
- 支持 model-only vs human-override 后续 replay 对比。
- 人工复核只能进入交易计划草案，不开放自动交易。

真实数据验收：

- 对真实 FIVD-R run 创建人工复核记录。
- 验证历史记录不可覆盖。
- 验证 replay 可引用复核记录。

打回条件：

- 人工复核覆盖原始模型结果。
- reason 缺失且无配置说明。
- 人工复核绕过 validation gate。

开发前计划状态：

- 已形成 `15_FIVD_R_Phase8_Intervention_Review_Development_Acceptance_Audit.md`。
- 开发前审计结论：无致命/重大意见，允许进入实质开发。
- 实质开发已完成。
- 真实数据 E2E 已通过，产物 `.verification/fivd-r-phase8-intervention-review-audit.json`。
- 真实样本：runId=`fivd-r:default:1780398413513`，symbol=`009725`。
- append-only hash chain 验证通过，第一条记录未被覆盖，第二条记录链接第一条 hash。

### Phase 9：Calibration 与 Model Tuning

目标：

- 建立概率校准、动作质量和 Champion/Challenger 调优闭环。

开发前产物：

- `Phase9 Development Plan`
- `Phase9 Acceptance Plan`
- `Phase9 PRD Spec Review`
- `Phase9 Audit Opinion`

实质开发范围：

- 输出 ADD/REDUCE/HOLD/OBSERVE/AVOID 动作质量。
- 输出 p05-p95 覆盖率、p25-p75 覆盖率、上涨概率校准、止损/止盈概率误差、expectedReturnError。
- 支持 challenger trial 和 model comparison report。
- promote 必须人工确认。

真实数据验收：

- 使用 Phase 7 replay 产物生成 calibration report。
- 至少一个 challenger 生成 comparison report。
- 未通过 challenger 不得替换 champion。

打回条件：

- 调参结果未经过 replay。
- promote 无人工确认。
- 只看收益不看回撤、校准和风险违规。

开发前计划状态：

- 已形成 `16_FIVD_R_Phase9_Calibration_Model_Tuning_Development_Acceptance_Audit.md`。
- 开发前审计结论：无致命/重大意见，允许进入实质开发。
- 实质开发已完成。
- 真实数据 E2E 已通过，产物 `.verification/fivd-r-phase9-calibration-audit.json`。
- 来源 replay 产物：`.verification/fivd-r-phase7-advice-replay-audit.json`。
- windowsChecked=`8`，validationGateRespected=`true`。
- probabilityCalibration=`insufficient`，promoteStatus=`not_promoted`，requiresHumanConfirmation=`true`。

### Phase 10：交易动作 Readiness 收口

目标：

- 在真实 validation evidence 通过后，只开放人工交易计划草案，不开放自动交易。

开发前产物：

- `Phase10 Development Plan`
- `Phase10 Acceptance Plan`
- `Phase10 PRD Spec Review`
- `Phase10 Audit Opinion`

实质开发范围：

- 将 `candidateDisposition.status=ready_for_manual_review` 接入 readiness。
- `test:trade-action-readiness` 同时检查全 A evidence、validation evidence、factset coverage、candidate disposition、manual execution review。
- 通过后只允许 `MANUAL_REVIEW / PAPER_TRADE`。

真实数据验收：

- 使用最新全 A或明确等价的真实长样本 evidence。
- 若没有候选四项通过，不得强行放行。
- readiness 不通过则回到策略验证计划阶段。

打回条件：

- 降低 validation gate 来通过。
- 小样本覆盖全 A evidence。
- 自动交易入口出现。

开发前计划状态：

- 已形成 `17_FIVD_R_Phase10_Readiness_Closure_Development_Acceptance_Audit.md`。
- 开发前审计结论：当前 validation evidence 未通过，因此本阶段目标是 readiness blocked 收口，不允许强行放行。
- 实质开发已完成。
- 真实数据 E2E 已通过，产物 `.verification/fivd-r-phase10-readiness-closure-audit.json`。
- closureStatus=`blocked`，analysisAdviceReady=`true`，productionReady=`true`，tradeActionReady=`false`。
- blockerGateIds=`["validation_evidence"]`，autoTradeAllowed=`false`，allowedManualModes=`[]`。

## 4. 固定验收命令

每阶段必须至少执行：

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
backend: npm run test:trade-action-readiness
阶段专属真实数据端到端验收脚本
```

`test:trade-action-readiness` 在 validation 未通过前应失败，且 blocker 必须清晰指向 `validation_evidence`。如果它意外通过，必须停止并审计是否误放行。

## 5. 当前审计意见

审计时间：2026-06-01。

结论：允许进入 Phase 3.5 的开发前计划制定，不允许跳过计划审计直接开发。

致命风险：无。

重大风险：无。

一般风险：

- Portfolio 级 FIVD-R 真实数据接口耗时约 30-36 秒，Phase 3.5 必须评估缓存化或 Operation 化。
- Expected Return 仍为 placeholder，Phase 4 前不得声称已完成收益概率分布。
- 当前交易动作仍被 `validation_evidence` 阻断，后续所有阶段必须保留该事实。

## 6. 本阶段真实数据基线验收

验收时间：2026-06-01。

结果：通过。

验收命令：

```text
backend: node node_modules/typescript/bin/tsc --noEmit
frontend: node node_modules/typescript/bin/tsc --noEmit
backend: npm run test:fivd-r-core
backend: npm run test:production-readiness -- --strict
backend: npm run test:trade-action-readiness
```

验收结论：

- 后端 TypeScript 通过。
- 前端 TypeScript 通过。
- FIVD-R core 通过，validation source=`fivd_r_internal_validation_tournament`。
- production readiness 通过，`analysisAdviceReady=true`、`productionReady=true`。
- trade action readiness 按预期失败，`tradeActionReady=false`，唯一 blocker=`validation_evidence`。

审计判断：

- 本阶段只是剩余计划与门禁文档化，不进入实质模型开发。
- 未使用 mock 或模板冒充真实验收。
- 未降低交易 gate。
- 无新增致命或重大风险。
