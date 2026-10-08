# C1 关键读取性能验收审计

日期：2026-10-08

## 结论

```text
C1=PASS
realAccountData=true
criticalReadP95BudgetMs=1500
criticalReadMaxBudgetMs=3000
protectedAccountFactsChanged=false
fatalFindingCount=0
majorFindingCount=0
```

## 基线与结果

| 路径 | 修改前稳定响应 | 修改后 warm p95 | 结果 |
| --- | ---: | ---: | --- |
| 组合回测模板 | 约 1,200ms | 0.76ms | PASS |
| 组合回测历史 | 约 2,100ms | 1.42ms | PASS |
| 最新兼容回测 | 未建立门禁 | 64.59ms | PASS |
| 持仓轮动 | 约 290ms | 293.10ms | PASS |
| 每日复盘列表 | 约 500ms | 545.35ms | PASS |
| 建议摘要 | 约 175ms | 200.77ms | PASS |
| point-in-time 来源 | 约 104ms | 117.81ms | PASS |

真实默认账户保护计数前后均为：open positions=16、transactions=141、operations=1239。

审计产物：`backend/data/gpt-audit/critical-read-performance/2026-10-08T10-29-12-678Z/critical_read_performance_audit.json`。

## 诚实限制

- 本门槛针对再次进入页面的 warm read；历史列表首次读取仍约 2.2 秒。
- 最新兼容回测首次读取仍约 2.4 秒，响应约 4.8MB；缓存避免重复读取和解析几十条大型结果，但没有宣称网络传输或前端图表渲染已低于 1 秒。
- 缓存 TTL 为 60 秒；新回测写入后按用户失效历史和兼容结果缓存。
- 缓存不改变策略、回测 artifact、账户事实或交易权限。
