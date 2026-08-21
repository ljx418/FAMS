# DRV1-0 开发计划：权威基线与规格冻结

日期：2026-08-20  
状态：已完成

## 目标

把已获用户批准的每日持仓复盘 v1 原型登记为正式产品化实现基线，并在任何产品代码变更前冻结需求、真实数据、交易边界和后续子阶段顺序。

## 输入依据

- `docs/DAILY_PORTFOLIO_REVIEW_PRD.md`
- `docs/DAILY_PORTFOLIO_REVIEW_TRACEABILITY_MATRIX.md`
- `docs/current-stage-state.json`
- `.verification/daily-review-agent-workflow-prototype/v1/`
- `docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`

## 实施内容

1. 在 PRD 中登记十节点产品工作台、真实数据自动验收和“公开审计记录不等于私密思维链”的边界。
2. 在追踪矩阵中增加正式路由、组件和真实数据证据映射，但不虚增 DPR-001～DPR-010 完成率。
3. 在机器状态源中登记原型批准、产品化 UI 待开发和自动化验收字段。
4. 固定 DRV1-0～DRV1-4 与 FTR 顺序复核的阶段门。

## 验收标准

- 原型四个核心文件 SHA-256 已记录，批准只代表设计和实施授权。
- PRD、追踪矩阵和状态源对当前实现、待开发 UI、自动验收和人工验收的表述无冲突。
- `formalTradingUnlocked`、`autoTradeUnlocked`、`canCreateOrder`、`orderCreateAllowed` 全部保持 `false`。
- V2-PX 因权威基线未冻结而明确排除。

执行结果：全部满足。

