# C1 PRD 规格复核

日期：2026-10-08

## 结论

性能优化只作用于组合回测只读路径，与“再次进入策略回测不应重复等待重计算”的用户体验目标一致。没有减少模板、历史记录、artifact refs、策略结果或真实数据字段。

```text
prdDeviation=false
architectureDeviation=false
responseShapePreserved=true
readOnlySideEffectCount=0
tradeBoundaryChanged=false
```

## 实体对应

- `portfolioBacktestRoutes`：模板、历史、最新兼容结果短 TTL read-through cache。
- 最新兼容查询：先读取轻量候选元数据，只对匹配记录加载大型 `resultJson`。
- `verify-critical-read-performance.ts`：真实账户、八条关键路径、性能预算和账户事实不变性。

首次大结果仍需传输完整图表数据，这是规格所需，不通过删减返回内容规避。C1 无新增 Fatal/Major，可进入 C2。
