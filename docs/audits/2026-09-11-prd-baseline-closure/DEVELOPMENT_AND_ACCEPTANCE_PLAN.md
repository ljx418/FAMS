# S0 PRD 基线闭环开发及验收计划

日期：2026-09-11

## 目标

在不修改业务算法和交易权限的前提下，将每日持仓复盘 PRD 1.4 的 `DPR-001` 至 `DPR-030`、唯一机器状态源、目标架构文档和自动化一致性合同同步到同一事实基线。

## 开发内容

1. 将 `DAILY_PORTFOLIO_REVIEW_TRACEABILITY_MATRIX.md` 从 19 项补齐到 30 项。
2. 将 `verify-current-stage-consistency.ts` 改为从 PRD 读取连续需求编号，不再硬编码 19 项。
3. 更新 `current-stage-state.json` 的生效时间、需求覆盖和本轮证据说明。
4. 更新 `ARCHITECTURE_CURRENT_TARGET.md`、`TARGET_ARCHITECTURE_GAP.md`、`target-architecture-gap.drawio`、摘要和解析输出。
5. 继续保持真实账户原始证据仅在 Git 忽略的本地私有目录；公开仓仅提交代码、合同和脱敏结论。

## 自动验收

```bash
cd backend
npm run build
npm run test:current-stage-consistency
npm run test:ftr-manifest-contract

cd ../frontend
npm run build

cd ..
node docs/read-drawio.mjs docs/target-architecture-gap.drawio
git diff --check
```

## 出门条件

- PRD 与矩阵均连续覆盖 `DPR-001` 至 `DPR-030`，覆盖率为 `30/30`。
- `current-stage-state.json` 是当前唯一机器状态源，四个交易权限字段均为 `false`。
- drawio 保持 8 页且能解析；目标服务标记为“工程已实现、业务 gate 待闭环”。
- 不公开真实持仓金额、成交明细、截图或账户专属断言。
- 人工验收继续如实记录为 `not_performed`。

失败时打回本阶段，不进入接口缺陷修复或真实数据全量回归。
