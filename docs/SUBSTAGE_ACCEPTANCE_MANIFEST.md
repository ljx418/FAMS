# S0-S8 子阶段验收 Manifest 合同

更新时间：2026-07-16

## 1. 目的

每个子阶段开始前必须生成 `substage_acceptance_manifest.json`，避免只凭自然语言判断“做完”。该 manifest 是开发 Agent 和审计者的共同输入。

## 2. Manifest 结构

```json
{
  "schemaVersion": "fams.substage_acceptance_manifest.v1",
  "stageId": "S2",
  "entryCriteria": [],
  "commands": [],
  "requiredArtifacts": [],
  "artifactSchemas": [],
  "automatedGates": [],
  "manualGates": [],
  "rollbackConditions": [],
  "exitCodePolicy": {
    "allCommandsMustExitZero": true,
    "blockedGateExitCode": 2,
    "failedGateExitCode": 1
  }
}
```

## 3. S0-S8 最小 manifest 要求

| Stage | 必须包含的自动化命令类别 | 必须产物 | 人工 gate |
| --- | --- | --- | --- |
| S0 | 文档状态、drawio、当前状态源、误放行扫描 | `current-stage-state.json`、文档审计 | 是否批准进入开发 |
| S1 | 资产 Excel 导入/导出、Dashboard 更新、回测输入构建 | asset sample audit | 真实用户工作簿确认 |
| S2 | provider contract、freshness、coverage、secret redaction | data governance audit | provider 授权确认 |
| S3 | benchmark enum、qualification、proxy downgrade | benchmark qualification audit | benchmark 资格确认 |
| S4 | formal validation 指标、OOS、walk-forward、分组稳定 | formal validation audit | 统计口径复核 |
| S5 | manual signoff workflow、draft lock | manual signoff audit | 授权人员签核 |
| S6 | paper/sandbox、order blocker、ChatBox/API 阻断 | execution isolation audit | 是否继续保持实盘关闭 |
| S7 | release gate 汇总、HTML 报告、SUMMARY | release gate audit | 人工 release review |
| S8 | multi-turn agent、权限漂移、跨会话污染 | agent loop audit | agent 权限复核 |

## 4. 禁止

```text
没有 manifest 不得进入子阶段开发
没有 requiredArtifacts 不得声明子阶段验收通过
manualGates 未完成不得声明 release 出门
rg 文本扫描不得替代 AST/JSON/运行态合同测试
```

