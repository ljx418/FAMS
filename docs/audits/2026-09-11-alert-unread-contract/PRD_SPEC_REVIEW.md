# S1 PRD 规格检视

日期：2026-09-11

```text
fatalSpecificationDeviationCount=0
majorSpecificationDeviationCount=0
alertBehaviorChanged=false
invalidInputNowExplicitlyRejected=true
existingRealDataAlertPathsPassed=true
tradeBoundaryChanged=false
prdReviewDecision=PASS
```

本轮只收紧 `GET /api/v1/alerts/unread` 的输入合同。合法调用仍返回同一未读提醒集合，默认上限仍为 10；差异仅在于无效 `limit` 不再透传到 Prisma，而是在 HTTP 边界返回 400。

市场回撤提醒和持仓止损提醒均使用既有真实数据路径回归通过。测试中的账户级信息只保留在本地运行输出，未进入公开 Git 证据。
