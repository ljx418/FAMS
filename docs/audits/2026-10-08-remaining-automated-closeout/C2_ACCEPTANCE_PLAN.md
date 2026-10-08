# C2 免费行情可靠性验收计划

日期：2026-10-08

## 自动门槛

1. 默认账户真实开放持仓数大于 0，并至少对一个真实持仓标的执行 provider 调用尝试。
2. reliability 快照包含 provider 状态、fallback、circuit、canonical freshness、数据日期、覆盖计数、blockers/warnings 和恢复动作。
3. `fresh + provider evidence` 才可为 `healthy`；`delayed/fallback/unknown provider` 至少为 `degraded`；`stale/unknown freshness` 必须为 `blocked`。
4. provider 原始错误、密钥和账户金额不得出现在快照或审计 artifact。
5. provider/source 中不得出现 mock、fixture 或 test。
6. 验收前后开放持仓、交易、Operation 数量完全一致。
7. `formalTradingUnlocked/autoTradeUnlocked/canCreateOrder/orderCreateAllowed` 全为 `false`。

## 命令

```text
cd backend
node node_modules/typescript/bin/tsc
npm run test:market-data-reliability-snapshot
```

## 产物

- `market_data_reliability_audit.json`
- `C2_ACCEPTANCE_AUDIT.md`
- `C2_PRD_SPEC_REVIEW.md`

## 打回条件

- fallback 或 stale 被标记为 healthy。
- 只使用 fixture，而没有真实默认账户和 provider 尝试。
- API 泄露原始 provider error、密钥或账户金额。
- 账户事实或交易锁发生变化。
