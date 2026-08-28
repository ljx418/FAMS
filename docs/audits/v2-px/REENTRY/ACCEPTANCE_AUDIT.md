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

## R1 实施前 PRD 规格检视与验收标准

R1 只修复 PX-REQ-006/010/015/020 的合同与运行时基座，不提前宣称五视图业务完成。

| 场景 | 操作 | 出门门槛 |
| --- | --- | --- |
| 真实 ID/ref 往返 | 从实际 Prisma Operation/Review 各取一个 UUID 与原始 ref，生成并反解 sourceRef | 数字起首 UUID 可通过；反解值逐字节一致；SHA-256 证据落盘 |
| 严格边界 | 输入 malformed/non-v4/uppercase UUID、unknown prefix、padding/noncanonical/empty/oversize sourceRef、任意字段 | 全部拒绝；不得以 `.+` 或任意 string 代替 |
| 默认工作区迁移 | 读取含 `default_workspace` 的旧状态并启动 | 原子迁移到保留 ID，产生 `state_migrated`；未知版本进入 blocked |
| 多工作区 lifecycle | 交错写入两个 workspace event stream | sequence 各自从 1 连续；gap、mixed workspace、previous-state drift 全部拒绝 |
| 编译与合同 | 跑 extension typecheck/build/test 与 backend semantic test | 0 TypeScript 错误；target 正负 fixture、3×3、20 tab 全绿 |
| 真实 Chrome | 真实 unpacked extension 四视口运行 | 360/420/768/1280、真实 extension URL、PNG/hash/overflow 可复核 |
| 边界复核 | 扫描 manifest/network/state | 不增权限、不传正文/secret、broker/order=0、四锁=false |

实施前独立规格检查：fatal=0、major=0；R0 已冻结全部开发者不能自行决定的格式，允许进入 R1 实质开发。
