# V2-PX PX5 Router/at-most-once 入场审计

日期：2026-08-29

阶段映射：自动化子阶段 `PX5` = 产品计划 `PX4-01 Router 完整集成 + PX4-02 at-most-once + PX4-03 边界集成`。

结论：PASS_FOR_CONTROLLED_IMPLEMENTATION

## 1. 审计范围与权威输入

本审计逐项读取并比对：

- `docs/V2_PX_PRD.md` 的 PX-REQ-001/002/003/006/009/012/013/014/018/020；
- `docs/V2_PX_API_RUNTIME_CONTRACT.md` 的 3×3 入口动作矩阵、canonical key/URL、Background 顺序、§5.2/§5.3 存储与 at-most-once；
- `docs/V2_PX_TARGET_ARCHITECTURE.md` 的 Background 单写、tab manager、ledger、recoveryIndex 和交易硬边界；
- `docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md` 的 PX4-01～03 工作包与 AC-PX-02/03/04/05/09；
- PX4-B 出门审计与 commit `60027fd`；
- 当前真实实现 `intentRouter.ts`、`workspaceTabManager.ts`、`runtimeHandler.ts`、`chromeStorage.ts`、`idempotencyRegistry.ts` 及其测试。

## 2. 前置条件

| 条件 | 结果 | 证据 |
| --- | --- | --- |
| 用户批准方案 A 顺序实施 | PASS | `current-stage-state.json` 中 implementation approval 已批准 |
| PX1～PX4-B 自动验收完成 | PASS | PX1/PX2/PX3/PX4A/PX4B 私有证据与阶段审计；Host Bridge 出门 commit `60027fd` |
| 目标合同无版本双真相 | PASS | intent/3、command/2、lifecycle/3、real-chrome-evidence/2 已实现；semantic contract PASS |
| PRD 对本阶段行为给出唯一答案 | PASS | 3×3 target、canonical URL、500/24h、20/30d、storage fault、unknown_result、POST retry=0 均已冻结 |
| 交易边界可保持 | PASS | 本阶段不新增订单 endpoint、券商 adapter 或交易 UI；四锁继续 false |
| 真实验收条件可用 | PASS | Windows Chrome 152、unpacked WXT、真实 SQLite、生产 External Brain route handler 已在前序阶段实证 |

## 3. 当前实现差距（本阶段开发内容，不是放行后的遗留风险）

| ID | 当前事实 | 本阶段唯一修复目标 | 失败门槛 |
| --- | --- | --- | --- |
| DEV-PX5-01 | `buildWorkspacePath` 仍把 routeId/correlationId 放入 URL；没有合同定义的 SHA-256 canonicalRouteKey | canonical key 只取稳定业务字段；URL 只保留 workspaceId/view/ref | key 受 route/time/question 影响或 URL 泄露关联 token 即 fail |
| DEV-PX5-02 | 20 次 tab 单测是串行；多窗口已有重复 tab 时不会收敛；并发 query/create 有竞态 | 同 workspace 的串行、并发、跨窗口都收敛到一个 tab并聚焦其窗口 | 任一路径 tab≠1 或焦点窗口错误即 fail |
| DEV-PX5-03 | ledger 有 prepared/dispatched/completed 基础，但同一 storage 的并发命令可能在空读后双 dispatch | 对同一 storage 的 cleanup/read/write/dispatch 串行化；同 key 并发 POST=1 | 同 key/digest dispatch>1 即 hard fail |
| DEV-PX5-04 | completed 回读只比 key/digest/state，没有核对 resultStatus/resultRef/时间字段 | 完整核对持久记录；任何回读漂移进入 unknown_result，不显示可恢复 completed | 缺 resultRef 仍显示 completed 即 fail |
| DEV-PX5-05 | 命令成功后未形成最小 recoveryIndex→session 顺序；storage fault 事件覆盖不足 | ledger 成功后写/回读 20 条/30 天最小索引，再由 Background 写 session state/event；不保存 question/answer | 顺序漂移、敏感正文入 storage、结果后写失败诱导安全重试即 fail |
| DEV-PX5-06 | 3×3 目前主要由 validator 单测证明，缺本阶段完整路由/压力证据 | 锁定 9 个入口动作、五 intent 合法 payload、非法组合、20 次/并发/多窗口与真实 Chrome trace | 只验 helper、mock DOM 或静态 HTML 不得出门 |

## 4. 架构风险复核

- 后端 `externalBrainAskService` 不新增第二套业务计算或订单路径；at-most-once 所有权仍在 Extension Background local ledger。
- `ingest_source` 继续受 `PX_NOT_IMPLEMENTED` 阻断，不因本阶段补幂等而创建第二索引。
- 公开 extension ID 只用于本地调用方 allowlist，不提升为生产身份认证。
- 浏览器故障负例允许注入真实 storage/network fault，但正例必须读取真实 FAMS SQLite/API，禁止用 fixture 结果出门。
- 其他 Agent 的 overnight strategy 未提交文件和运行进程不属于本阶段，不得被暂存、修改或作为 PX5 证据。

## 5. 入场审计结论

```text
fatalFindings=0
majorSpecificationFindings=0
openArchitectureDecisions=0
knownImplementationGaps=6
productionImplementationAllowed=true
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

六项差距均有已批准合同中的唯一目标行为，可直接进入失败用例与最小实现；不存在需要人类选择的重大规格分叉。任何新发现的合同冲突、真实 POST 重复、交易请求或证据假绿必须停止并回到本审计。
