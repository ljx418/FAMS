# V2-PX PX4-B Host Bridge 验收计划

日期：2026-08-29

## 真实自动验收场景

| ID | 用户场景与前置 | 操作 | 硬门槛 | 证据 |
| --- | --- | --- | --- | --- |
| HB-01 配置降级 | FAMS 3000 可用；不配置/配置非法/目标扩展不存在 | 打开 ChatBox 并点击入口 | 按钮始终可见；中文说明原因及配置步骤；原始 `runtime.lastError`、扩展内部异常、空白响应=0；不打开错误 tab | DOM、console、截图、发送计数 |
| HB-02 ChatBox | 真实 Extension 已加载，ID 注入 Host | 打开 ChatBox，输入框可含任意文本，再点击“在外部大脑打开” | ack <=1000ms；Workspace `view=ask`；消息中 question/answer/history=0；同 workspace tab=1 | runtime route、URL、storage、截图 |
| HB-03 每日复盘 | 数据库存在真实 DailyReview UUID v4 | 在每日复盘点击“在外部大脑查看图谱” | ack <=1000ms；`view=graph` 且 URL/ref、WorkspaceState.activeGraph.id、页面 reviewId 三者一致 | DB/API/DOM/URL/state 对照、截图 |
| HB-04 任务中心 | 数据库存在真实 Operation UUID v4，用户选择该任务 | 点击“在外部大脑追踪” | ack <=1000ms；`view=trace` 且 URL/ref、WorkspaceState.activeOperationId、页面 operationId 三者一致 | DB/API/DOM/URL/state 对照、截图 |
| HB-05 关联与幂等 | 依次完成 HB-02/03/04，再重复点击一次 | 检查三个动作的 ID、生命周期和 tab | workspaceId 相同；每次 routeId/correlationId 唯一且 envelope/payload 一致；route_intent 可追溯；同 workspace tab 始终=1 | lifecycle、WorkspaceState、tab trace |
| HB-06 边界负例 | 构造 3001/非本地 sender、Host operation command、ask 携 question、额外字段 | 逐一发送 | 全部 blocked；tab/storage/External Brain API 请求副作用=0；Host allowlist 不扩大 | Extension contract/runtime tests、负例 trace |
| HB-07 隐私与交易 | 完成三入口真实路径 | 扫描 runtime/storage/network/数据库 | secret-like=0；question/answer storage=0；broker/order request=0；Transaction/订单相关计数变化=0；四锁=false | storage/network/DB 差分、状态文件 |

所有正例必须来自本地真实数据库实体和真实 unpacked Chrome Extension；fixture/mock 只能补充负例，不能替代 HB-02/03/04/05。

## 必跑命令

```text
npm --prefix packages/fams-v2-px-extension run typecheck
npm --prefix packages/fams-v2-px-extension test -- --run
npm --prefix packages/fams-v2-px-extension run build
npm --prefix frontend run build
npm --prefix frontend run verify:v2-px-host-bridge
npm --prefix backend run test:v2-px-semantic-contract
```

## 证据与假绿防护

- 证据路径必须绑定实现提交 SHA：`.verification/private/v2-px/<sha>/PX4B/`。
- 记录 Chrome 版本、Extension ID、三页面 URL、真实 review/operation ID、route/correlation、ack 毫秒、Workspace URL/state、tab 数、console、storage、网络请求和交易表前后计数。
- 截图只是辅助；DOM、消息、state、DB、API 或 URL 任一不一致即失败。
- 缺配置场景不能通过 test double 替代；配置正例不能通过预写 WorkspaceState 或直接打开 extension URL 替代。
- `page.evaluate` 或 CDP 在 Workspace 导航中断时必须重试并记录，不能吞掉失败。

## PRD 规格复检与出门条件

实施后必须单独形成 `HOST_ACCEPTANCE_AUDIT.md` 和 `HOST_PRD_SPEC_REVIEW.md`，至少逐项核对 PX-REQ-001/002/009/013/015/016/017/018、API 运行时合同 §4.2/§4.3/§7.2 和目标架构 Host Bridge 实体。

只有以下条件全部成立才可进入下一子阶段：HB-01～07 PASS；真实数据与真实 Chrome 声明为 true；fatal=0、major=0、虚假验收风险=0；其他 Agent 改动未进入本提交；四项交易锁保持 false。否则停止并回到文档/开发计划阶段。
