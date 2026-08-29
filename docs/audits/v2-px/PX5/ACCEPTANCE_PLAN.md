# V2-PX PX5 Router/at-most-once 验收计划

日期：2026-08-29

状态：FROZEN_BEFORE_IMPLEMENTATION

## 1. 自动验收场景

| ID | 前置 | 操作 | 量化门槛 | 原始证据 | 失败归属 |
| --- | --- | --- | --- | --- | --- |
| RI-01 3×3 路由 | target 合同与三个入口可运行 | 对每个入口执行 view_source/open_workspace/open_in_workspace，并覆盖五 intent 合法 payload | 9/9 target 正确；五 intent 5/5；非法 target/ask-question/Host command 全拒绝且副作用=0 | route matrix JSON、runtime response、lifecycle/state diff | Router/validator |
| RI-02 canonical | 同一 workspace 与真实 review/operation/source | 改变 route/correlation/time 后重复生成 key/URL | 同语义 key 相同且为 64 位 SHA；不同实体 key 不同；URL 参数集合严格为 workspaceId/view/ref，敏感字段=0 | canonical audit JSON、tab URLs | intentRouter |
| RI-03 tab 收敛 | 两个 Chrome window、无 tab/已有重复 tab 两种状态 | 串行 20 次、并发 20 次、跨窗口重复打开 | 每个 workspace tab=1；焦点窗口正确；另一 workspace 不被关闭；console error=0 | CDP Target/tab/window trace | tab manager |
| RI-04 同 key replay | 已授权、真实 Ask 数据可完成 | 同一 operation command 串行重放、20 次并发、worker reload 后重放 | `/external-brain/ask` POST 总数=1；resultRef 一致；同 key 不同 digest blocked | network trace、ledger、真实 FAMS conversation/result refs | idempotency registry |
| RI-05 fault 诚实性 | 可控制 LedgerStorage 及真实 Chrome storage fault | prepared/dispatched/completed write/readback、响应丢失、resultRef 漂移 | 副作用前 dispatch=0+failed；副作用后 dispatch=1+unknown；自动 retry=0；completed 假绿=0 | fault matrix、command results、lifecycle events | ledger/storage/runtime |
| RI-06 顺序与最小存储 | query 成功或 replay | 检查 ledger→recoveryIndex→session；注入 501 ledger/21 recovery/过期记录 | 顺序 100%；ledger≤500/24h；recovery≤20/30d；两库独立；question/answer/secret/cookie/token=0 | storage snapshot、write log、redaction report | chromeStorage/runtime |
| RI-07 真实业务同源 | 真实 SQLite 有 Operation、DailyReviewRun、Chat 结果 | 路由五视图并执行一次真实 Ask | ref 与 DB 对象一致；真实 API 非 mock；mutation endpoint=0 | DB query、API/network、Chrome DOM/截图 | Adapter/acceptance harness |
| RI-08 交易硬边界 | 全场景执行完成 | 扫描网络、UI、SQLite 差分和状态源 | broker/order request=0；Transaction/GridOrderDraft/ExternalOrderObservation 变化=0；四锁恒 false | trade boundary JSON | Policy/全阶段 |
| RI-09 防假绿 | 正例证据已生成 | 删除 artifact、改 hash、伪造 mock URL、让 injected fault 返回 success | 所有负例必须使验收器非 0；正例才 PASS | negative-run log、hash manifest | acceptance harness |

## 2. 必跑命令

1. Extension typecheck、全量 Vitest、production build。
2. Backend build、V2-PX API contract、semantic contract。
3. Frontend production build 和 Host Bridge 回归。
4. `verify:router-idempotency-chrome` 开发态失败—修复—重跑。
5. 生产实现 commit 后，在 in-scope clean commit 上再次运行同一真实 Chrome 验收并按 commit 重签。

## 3. 出门条件

```text
routerMatrixPassed=9/9
intentPayloadsPassed=5/5
sameWorkspaceTabCount=1
sequentialOpenCount=20
concurrentOpenCount=20
sameKeyConcurrentAskPostCount=1
sameKeyReloadAskPostCount=0
storageFaultFalseSuccessCount=0
questionOrSecretInExtensionStorage=0
brokerOrderRequestCount=0
tradingRelatedDatabaseMutationCount=0
consoleErrorCount=0
fatalAuditFindings=0
majorSpecificationFindings=0
```

上述全绿后，必须另行落盘 `ACCEPTANCE_AUDIT.md` 和 `PRD_SPEC_REVIEW.md`，才能进入 PX5 生命周期/恢复（产品计划 PX5-01/02）。自动验收不能替代 PX6 的最终人类 permission 点击和体验核查。
