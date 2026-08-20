# ADR-2026-07-16：在模块化单体内闭环 Formal Release Readiness

## Status

Accepted on 2026-08-20 for controlled FTR-0 through FTR-6 implementation. This acceptance does not authorize production trading.

## Context

FAMS 已实现 React/Vite 前端、Fastify 后端、SQLite/Prisma、本地数据缓存、组合回测、ChatBox、Operation 和 release audit 合同。当前正式 release 阻断来自数据授权、benchmark 资格、formal validation、人工签核和最终审批，而不是运行规模或服务部署边界。

当前 `PortfolioBacktestEngine` 同时负责回测计算和数据治理、benchmark、formal validation、人工签核、执行隔离、release gate 审计对象构建。继续堆叠会让计算正确性和 release 决策耦合，但立即迁移微服务、PostgreSQL、TimescaleDB 和消息队列会显著扩大本阶段风险。

## Decision

下一阶段继续使用模块化单体和现有 API，按职责从 `PortfolioBacktestEngine` 增量拆出：

```text
FormalDataProviderService
BenchmarkQualificationService
FormalValidationService
ManualSignoffService
ExecutionIsolationService
ReleaseGateService
```

服务之间通过显式 DTO 和 audit artifact 交互。`ReleaseGateService` 只消费各 gate 的结果，不重新计算收益或自行修改交易权限。

自动化开发最多产出 `formalTradingReleaseReviewReady=true` 和 `releaseApprovalStatus=pending_human_approval`。生产订单适配器启用和交易权限变更不属于自动化阶段。

## Alternatives

### A. 模块化单体增量拆分（采用）

优点：复用现有 API、数据和测试；改动可逆；可逐个 gate 验收。缺点：仍共享进程和数据库，服务边界依靠代码合同维护。

### B. 立即建设独立数据/验证/执行微服务（拒绝）

优点：隔离和独立扩展更强。缺点：需要同步解决部署、认证、事件一致性、数据库迁移和可观测性，无法直接消减当前 release blocker，且增加虚假验收面。

## Consequences

- 下一阶段架构图必须区分“引擎内嵌现状”和“待拆分服务”，不能把目标服务画成已存在。
- 新服务先在现有 Fastify 进程内运行，不新增网络调用。
- PostgreSQL、TimescaleDB、Redis、队列和生产订单系统保留为长期演进项，不进入 FTR-0 至 FTR-6。
- 若未来并发、隔离或组织边界要求独立部署，再通过新 ADR 拆分服务。
