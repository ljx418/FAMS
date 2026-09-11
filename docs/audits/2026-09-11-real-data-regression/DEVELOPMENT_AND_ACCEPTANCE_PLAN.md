# S2 真实数据全量回归开发及验收计划

日期：2026-09-11

## 目标

在不导入模拟行情、不修改账户事实、不解锁交易动作的前提下，重新验证当前 PRD 已实现的主要用户路径，并区分“真实数据通过”“降级但可审计”“业务门禁阻断”三类结果。

## 隐私与副作用边界

- 真实账户原始金额、持仓、成交、截图、账户 ID 和账户专属断言只允许出现在 Git 忽略的本地脚本、数据库和证据目录。
- 公开审计只记录 schema、状态、数据日期、覆盖数量、哈希或脱敏 blocker。
- 允许生成 DailyReview、Operation、Audit artifact 等研究记录；禁止创建外部订单，禁止修改成交事实。
- 带临时 fixture 的测试必须自行清理；保护表哈希不一致即硬失败。

## 回归波次

### Wave A：运行时与数据健康

```bash
cd backend
npm run build
npm run test:sqlite-writer-lock
npm run check:sqlite-health
npm run test:market-data-freshness-gate
npm run test:current-market-data-freshness
```

`test:market-data-freshness-gate` 使用固定历史时点验证调度分支；`test:current-market-data-freshness` 必须使用执行时真实时钟，前者不得替代后者作为当前数据证据。

若当前时点测试失败，只允许执行以下定向修复后重验：

```bash
FAMS_ALLOW_DEV_DB_TEST_MUTATION=1 npm run run:current-market-data-freshness-remediation
npm run test:current-market-data-freshness
```

定向修复只抓取当前 active-strategy 集合中超过 1 个交易日或无本地数据的股票/ETF/REIT。基金累计净值由基金工作流验证，不得混入 canonical 股票 K 线门禁。

### Wave B：真实账户研究路径

```bash
npm run test:daily-review-real-data-e2e
npm run test:current-account-research-contract
node node_modules/tsx/dist/cli.mjs scripts/verify-alipay-persistent-research-workflow.ts
```

每日复盘以 `FAMS_REAL_E2E_REQUIRE_LLM=1` 执行，要求真实 LLM 汇总通过；`test:current-account-research-contract` 从最新已确认账户快照动态取数，公开输出只保留脱敏汇总。包含金额和标的断言的历史账户专属脚本仍是本地私有证据，不得重新加入 public package script。

### Wave C：组合、轮动与交易边界

```bash
npm run test:relative-rotation-watchlist-real-data
npm run test:portfolio-backtest-long-horizon
npm run test:chatbox-first-class
npm run test:trade-action-readiness
```

### Wave D：前端运行态与系统回归

```bash
npm run test:portfolio-backtest-frontend-runtime
npm run test:ux-f7-frontend-runtime
npm run run:full-system-e2e-acceptance
cd ../frontend
npm run build
```

## 出门条件

1. SQLite 健康与单写锁合同通过。
2. 每日复盘至少一个真实资产成功，全部真实资产都有成功结果或明确 blocker，保护表哈希不变。
3. 私有账户一键复盘、持久化工作流和组合比较通过，且没有外部订单或自动交易。
4. 轮动真实 canonical bars、组合长周期 materialized replay 均通过；数据不足必须明确阻断，不得补 mock。
5. ChatBox 结构化结果、确认、权限漂移和交易边界测试通过。
6. 前端运行态和全系统 E2E 通过；如需要浏览器证据，只使用 headless 实例并在测试后关闭。
7. 四个交易解锁字段保持 `false`。

完整 SQLite 检查基于当前约 833MB 数据库可能超过 120 秒。全系统编排对独立健康检查使用 360 秒上限，对包含健康检查和 42 文件生成的红利低波审计包使用 480 秒上限；不得以轻量检查替代正式审计包健康证据。

任一关键真实数据路径失败时，本阶段不得 PASS；先记录失败证据，回到对应路径的修复计划，再重新执行该波和后续波次。
