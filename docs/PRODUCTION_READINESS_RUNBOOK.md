# FAMS 生产就绪与交易建议放行 Runbook

更新时间：2026-05-31

## 当前结论

当前系统可以基于免费来源输出分析建议、观察建议和人工复核草案，但不能直接输出买入/卖出交易动作。

原因不是前端按钮或文案问题，而是生产 gate 仍为红灯：

- PostgreSQL shadow 已配置并通过 schema/staging/smoke 验证。
- Tushare 或交易所级正式交易状态源未配置时，停复牌和涨跌停价不能作为交易执行级证据；Tushare 是可选增强接口，不阻断免费源分析建议。
- OOS 分层验证仍需要足够样本通过后，才能解除策略证据阻断。

系统允许继续输出：

- 研究结论
- 观察建议
- 候选池
- 风险解释
- 人工复核前的证据报告

系统禁止输出：

- `ADD`
- `REDUCE`
- `AUTO_TRADE`
- 没有 evidenceRefs 的确定性交易动作

## 必需配置

在 `backend/.env` 中配置：

```bash
FAMS_POSTGRES_SHADOW_DATABASE_URL="postgresql://fams_shadow:change-me@127.0.0.1:5432/fams_shadow"
```

可选配置：

```bash
FAMS_TUSHARE_TOKEN="your-token"
FAMS_SCREENER_DEEP_VALIDATION_TOP_N=12
FAMS_POSTGRES_SHADOW_TIMEOUT_MS=5000
FAMS_POSTGRES_SHADOW_STATEMENT_TIMEOUT_MS=10000
FAMS_READINESS_SYMBOLS="000001,600000"
```

## 一键自检

普通诊断：

```bash
cd backend
npm run test:production-readiness
```

发布或 CI 门禁：

```bash
cd backend
npm run test:production-readiness -- --strict
```

交易动作门禁：

```bash
cd backend
npm run test:trade-action-readiness
```

`--strict` 模式检查分析建议 readiness；`--strict-trade` 或 `test:trade-action-readiness` 检查交易动作是否可进入人工确认草案。

## 放行条件

分析建议放行必须满足：

- `postgres_shadow_ready=passed`
- `free_source_security_coverage=passed`

交易动作放行必须额外满足：

- `tushare_formal_trading_state=passed` 或等价交易所级正式交易状态源通过
- `limit_price_coverage=passed` 或等价正式源涨跌停价覆盖通过
- 最新全 A 长样本 Operation 的 `validation_decision.json.usableForTradingAdvice=true`
- `p4_closure_review.json.decision=READY_FOR_MANUAL_REVIEW`
- `p5_closure_review.json.decision=READY_FOR_P6_REVIEW`

满足后，系统只允许进入：

- `RESEARCH`
- `OBSERVE`
- `PAPER_TRADE`
- 人工确认交易计划草案

仍然禁止：

- 自动下单
- LLM 直接决定买卖
- 无证据引用的交易动作

## 当前本机状态

本机尝试过：

- Docker CLI：WSL 集成不可用。
- winget PostgreSQL 17：已安装并运行 `postgresql-x64-17` 服务。
- 已创建 `fams_shadow` 专用数据库和用户。
- `npm run test:production-readiness` 显示 `postgres_shadow_ready=passed`。
- `npm run test:production-readiness -- --strict` 已通过分析建议 readiness：`analysisAdviceReady=true`、`productionReady=true`。
- `tradeActionReady=false`，因为 OOS/validation 仍未放行交易动作；Tushare/正式交易状态和正式源涨跌停价只是可选增强或交易执行前复核条件。
- `npm run test:trade-action-readiness` 会失败并输出当前唯一交易动作 blocker：`validation_evidence`。

因此当前保持：

```text
analysisAdviceReady=true
tradeActionReady=false
productionReady=true
P5 decision=P5_COMPLETE_RESEARCH_ONLY / analysis advice ready
```

这是正确边界：免费源可输出分析建议；未通过 OOS/validation 前，不能输出 `ADD / REDUCE / AUTO_TRADE`。

## GPT 优化建议完成情况

已完成：

- 行情同步和 AI 选股扫描解耦。
- `stock_screening.run` 默认只读 canonical / feature cache。
- 缓存不足返回 warmup blocker。
- `market_data_coverage`。
- provider health 聚合写。
- raw/canonical 批量写入优化。
- `market_feature_daily`。
- 当前筛选和策略回测解耦。
- 全 A 60 日 evidence 可完成。
- validation decision、OOS 失败分析、OOS 分层复验。
- P4/P5 收口 artifact。
- PG shadow readiness 实测路径。
- Tushare 正式交易状态接入路径。
- `test:production-readiness` 自检脚本。

未完成或仍阻断：

- Tushare token 未配置，正式交易状态行缺失；该项只作为可选增强和交易执行级复核，不阻断分析建议。
- OOS 分层需要足够样本通过，当前小样本仍为 `insufficient`。
- 全 A 深度验证从固定 top-3 改为 `FAMS_SCREENER_DEEP_VALIDATION_TOP_N`，默认 12，上限 20；这会减少漏掉稳定候选组合的风险，但不会降低 OOS gate。
- 自动交易不在当前阶段开放。
