# C2 免费行情可靠性验收审计

日期：2026-10-08

## 结论

```text
C2=PASS
realAccountData=true
liveProviderAttempted=true
semanticNegativeCases=7/7
protectedAccountFactsChanged=false
fatalFindingCount=0
majorFindingCount=0
```

## 真实数据结果

- 默认账户开放持仓：16。
- 实测持仓标的：`513770`。
- provider 调用：Sina 成功，未使用 fallback。
- canonical freshness：`fresh`，最新交易日 `2026-10-08`。
- 同进程综合可靠性：`healthy`。
- 新进程尚无 provider runtime 证据时：API 返回 `degraded/provider_runtime_not_observed`，未伪报 healthy。
- 验收前后持仓/交易/Operation：`16/141/1240`，完全不变。

审计产物：`backend/data/gpt-audit/market-data-reliability/2026-10-08T10-33-50-673Z/market_data_reliability_audit.json`。

## 反假绿

以下七项分类均通过：fresh+healthy、delayed、fallback、provider failing、provider unobserved、stale、unknown。stale/unknown 固定 blocked；fallback、失败、无 runtime 证据固定不高于 degraded。

报告不包含 provider 原始错误、密钥或账户金额，四项交易锁保持 false。
