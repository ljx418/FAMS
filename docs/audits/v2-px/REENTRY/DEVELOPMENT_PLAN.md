# V2-PX 合同重入与 PX2/PX3 修复开发计划

日期：2026-08-28
状态：APPROVED_IN_PROGRESS

## 目标与边界

本轮只修复已批准且被 PRD、目标架构和运行时合同完整支撑的 PX1 合同、PX2 External Brain 与 PX3 Workspace 垂直切片。FAMS/Prisma 仍是唯一业务事实源；扩展不得建立第二业务库，不扩大 host permission、route intent 或交易权限。交易四锁始终为 false，订单/broker 请求必须为 0。

## 子阶段顺序与入场门槛

| 阶段 | 开发内容 | 入场门槛 | 出门证据 |
| --- | --- | --- | --- |
| R0 | 冻结 UUID/workspace/sourceRef 合同，纠正 state 与假绿 validator | 用户已批准修复；确认真实冲突 | 状态明确阻断 PX2；文档、审计、validator 同口径 |
| R1 | schema/types/validator/fixtures/storage/lifecycle 原子迁移 | R0 无 fatal/major | 真实 Prisma ref 往返、非法边界、typecheck/build/tests、3×3、20 tab、四视口 Chrome |
| R2 | common envelope、artifact/evidence、cursor、freshness、policy、Ask | R1 重签通过 | 独立 policy、真实 DB/API、单次 Ask、业务计数不变、订单 0 |
| R3 | Background Adapter、at-most-once、五视图 Workspace、七状态 | R2 无 fatal/major | `test:workspace`、故障注入、768/1280 Chrome、DB/service/API/DOM 同源 |
| R4 | PRD 复核、全量回归、证据与状态重签 | R3 全绿 | 独立审计结论；只有证据完整才开启后续阶段 |

## 自动停止规则

- 真实 FAMS 数据与冻结 schema 再次冲突。
- 测试只能依赖 mock/synthetic 才能通过，或证据无法绑定 commit/hash/真实 Chrome。
- 需要扩大权限、改变 PRD intent、修改数据权威或触碰订单/自动交易。
- 任一阶段仍有 fatal/major，或业务计数发生非预期变化。

上述情况不得用降级断言或宽松正则绕过，必须在验收审计写明停止原因。
