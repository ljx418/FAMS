# FTR-0 开发与验收计划：当前基线冻结

日期：2026-08-21  
状态：已完成

## 目标

按 `FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json` 冻结当前已验收基线、当前已实现 FTR 工程服务、仍受阻的业务 gate 和交易边界，关闭 7 月文档与 8 月代码之间的状态漂移。

## 实施范围

1. 校验 `current-stage-state.json` 和 FTR manifest 可解析且符合合同。
2. 以代码和现有审计产物核对六类 FTR service 的真实实现状态；只更新状态文档，不重复实现。
3. 读取 8 页 drawio，保存原始输出与摘要，核对当前/目标、里程碑和禁止声明。
4. 更新 `CURRENT_STAGE_DOCUMENTATION_CONSISTENCY_AUDIT.md`，明确 FTR 工程已实现、业务 gate blocked、交易权限全 false。
5. 独立落盘验收审计与规格检视；通过后才可审查 FTR-1 入口条件。

## 验收标准

- `drawioPageCount=8`，所有页有名称，第 1/2/8 页可区分已完成基线、FTR 工程服务、业务 blocker 和交易禁止声明。
- `currentStageAndNextStageSeparated=true`；不得把 S0-S8 或 DRV1-0～4 标为待办。
- FTR-0～6 manifest 顺序、命令、artifact schema 和负向夹具合同全部通过。
- `formalTradingUnlocked`、`autoTradeUnlocked`、`canCreateOrder`、`orderCreateAllowed` 全 false。
- 文档承认已存在模块化服务，不宣称 FTR-1～6 业务 gate 已通过。
- 未关闭致命或重大文档偏差为 0。

## 正式命令

```text
node -e "JSON.parse(require('fs').readFileSync('docs/current-stage-state.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json','utf8'))"
cd backend && npm run test:ftr-manifest-contract
node docs/read-drawio.mjs docs/target-architecture-gap.drawio
```

本阶段不修改任何交易权限，不启用生产适配器。
