# V2-PX 合同重入验收审计

日期：2026-08-28
当前结论：R0_PASS_R1_ENTRY_ALLOWED_PX2_BLOCKED

## R0 入场与反假绿检查

| 检查 | 结论 |
| --- | --- |
| 用户是否已批准修复 | PASS；当前请求明确要求 Implement the plan |
| 历史 PX1 Chrome 是否仍可证明目标合同 | NO；仅保留 shell feasibility 证据效力 |
| PX2 是否可以继续宣称入场 | NO；`px1TargetContractsImplemented=false`、`px2PlusAllowed=false` |
| 真实数据与通用 ID regex 冲突是否已登记 | PASS；blocking conflict=1 |
| 交易/权限/数据权威是否扩大 | NO |

## R0 出门门槛

1. 运行时合同必须冻结小写 UUID v4、`px-ws-UUIDv4`、两种 canonical sourceRef 及明确长度。
2. 决策文档必须把真实 UUID/sourceRef 归为正例，把 malformed/unknown/noncanonical/oversize/injection 归为负例。
3. 状态机和语义验证器必须诚实阻断 PX2 promotion，不得继续打印 `px2PlusProductionImplementationAllowed=true`。
4. R1 开发前再做一次 diff/规格检查，fatal=0、major=0 才能入场。

## R0 实施后结果

| 项目 | 结果 |
| --- | --- |
| 合同冻结 | PASS；UUID v4、保留 workspace、canonical sourceRef、contextRefs 联合约束和长度已冻结 |
| 决策纠错 | PASS；真实值归入正例，非法格式归入负例；用户后续授权状态已补记 |
| 机器状态 | PASS；`currentPhase=px1_contract_reentry`、blocking conflict=1、PX1=false、PX2+=false |
| 语义门禁 | PASS；输出 `px1SpikePassed=false`、`px2PlusProductionImplementationAllowed=false`、`promotionBlockedDuringReentry=true` |
| 权限/交易边界 | PASS；未修改 permission/intent，交易四锁仍为 false |

命令：`cd backend && npm run test:v2-px-semantic-contract`。R0 fatal=0、major=0；允许进入 R1，但 PX2 仍被阻断。
