# C2 免费行情可靠性开发计划

日期：2026-10-08

## 目标

在现有多 provider、fallback、熔断和 canonical 日线 freshness 基础上，提供一个普通用户和审计工具都能读取的脱敏可靠性快照。该快照只说明研究数据是否可用，不把免费源、本地缓存或 fallback 表述成正式实时行情。

## 实现实体

1. `MarketDataService.getProviderReliabilitySnapshot()`：暴露成功/失败、连续失败、fallback、熔断和最近成功/失败时间，不暴露原始错误或凭据。
2. `MarketDataReliabilityService`：组合 provider runtime 与 `MarketDataFreshnessService`，输出 `healthy/degraded/blocked`、恢复动作和硬交易边界。
3. `GET /api/v1/prices/reliability`：按 `userId/scope/limit` 返回只读快照。
4. `verify-market-data-reliability-snapshot.ts`：使用默认账户真实持仓范围和真实 provider 尝试验证合同、负例与账户保护。

## 非目标

- 不刷新、覆盖或修正账户持仓价格。
- 不承诺逐笔、盘口或交易所级实时性。
- 不把免费源使用事实解释为生产商业授权。
- 不解锁任何交易动作。

## 顺序

1. 冻结结构化状态和分类函数。
2. 增加脱敏 provider runtime。
3. 增加 reliability service 与 API。
4. 运行真实数据验收和 TypeScript 编译。
5. 落盘验收审计与 PRD 规格复核后进入 C3。
