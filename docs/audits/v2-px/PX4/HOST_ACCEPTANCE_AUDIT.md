# V2-PX PX4-B Host Bridge 验收审计

日期：2026-08-29

结论：PASS_AUTOMATED_SCOPE_FINAL_HUMAN_PERMISSION_GESTURE_PENDING

## 自动验收结果

| ID | 结论 | 实际证据 |
| --- | --- | --- |
| HB-01 配置降级 | PASS | 真实 Chrome 以未配置 ID 启动 Host；按钮可见，中文配置步骤可见，Workspace tab=0，原始 `runtime.lastError`=0；缺失/非法/未安装与 timeout 另有 9 个 bridge 单测 |
| HB-02 ChatBox | PASS | 真实 Host 输入唯一问题标记后只发送 `ask + workspaceId`；ack=27ms；Workspace `view=ask`；抓取消息与 storage 均不含问题 |
| HB-03 每日复盘 | PASS | 页面、SQLite `DailyReviewRun`、route payload、Workspace URL/state 的 reviewId=`a39d4ba3-e272-46a7-ba5f-e3a495d499be`；ack=8ms |
| HB-04 任务中心 | PASS | 页面、SQLite `Operation`、route payload、Workspace URL/state 的 operationId=`cd46818b-4983-4df4-9975-e67fead6ade2`；ack=8ms |
| HB-05 关联与复用 | PASS | 4 次 Host 动作有 4 个唯一 route/correlation 与 4 条 `route_intent`；同一 workspaceId；重复 Operations 点击后 Workspace tab=1 |
| HB-06 边界负例 | PASS | 真实 Chrome 下 ask route 携 question、Host `operation_command` 均 blocked，storage/lifecycle/tab 变化=0；3001 origin 不获得 externally-connectable messaging |
| HB-07 隐私与交易 | PASS | secret/question storage=0；4000 mutation request=0；broker/order=0；Transaction/GridOrderDraft/ExternalOrderObservation 计数变化=0；四锁=false |

## 回归记录

- Extension `typecheck`：PASS。
- Extension 全量：10 文件、55/55 PASS；其中 Host Bridge 9/9。
- Extension production build：PASS；`host_permissions=[]`、3000 仅 externally-connectable 未改变。
- Frontend production build：PASS；3736 modules。
- Backend TypeScript build：PASS。
- V2-PX semantic contract：PASS；target schema 正例、负例、防假绿与真实 sourceRef round-trip 均通过。
- `frontend verify:v2-px-host-bridge`：PASS；真实 Chrome 152、unpacked Extension、SQLite、生产页面/route handler、Workspace state/lifecycle。

## 证据索引

- 生产实现 commit：`4b4d3a808382c7522c25be1d316889441bd8cf54`
- 最终验收 commit：`a0758b4980b01739ead5abff0bc2029a66716964`
- 证据目录：`.verification/private/v2-px/a0758b4980b01739ead5abff0bc2029a66716964/PX4B`
- Chrome：`152.0.7977.64`
- Extension ID：`gjnjnbmgoabdodpoaiifmceiibgllgmn`
- trace SHA-256：`8516c4eea112a87aa83652cf6ea52b15d35a303056a4774ed7b886efdf2ff9fe`
- 四张截图：缺配置、ChatBox accepted、Daily Review accepted、Operations accepted；各自 hash 见 evidence JSON。

## 失败—修复—重签记录

首轮验收没有被标绿：验收专用服务遗漏 `/api/v1/captures/vision/status`，产生真实 404；随后只读验收运行面注册生产 `captureRoutes` 并重跑到 console error=0。出门复核又发现 HB-06 仅有合同单测，于是新增真实 Chrome 的 question/command/3001 三类负例，最终按新 commit 重签。验收器还增加 3000/4000 独占检测，防止把其他进程的 200 响应误认为本次候选服务。

## 视觉复核

四张原始截图已逐张查看：ChatBox 顶部、每日复盘页首和任务中心页首的入口均清晰可见；accepted 状态紧邻按钮且不遮挡原功能；缺配置状态以中文给出原因和启动配置；页面根横向溢出=0。未看到订单、自动交易或交易解锁动作。

## 独立审计结论

- 产品规格审计：三入口分别到 ask/graph/trace，未复制 ChatBox 问题或业务对象；PASS。
- 架构边界审计：Host 只发 intent route，Background 单写 state，Workspace tab manager 复用；PASS。
- 现实性/假绿审计：真实 DB/API/Chrome/Extension、消息抓取、负例、副作用差分、截图与 trace 同时存在；PASS。
- fatal：0；major：0；未闭环假绿风险：0。

## 剩余门槛

- 正式候选的 optional 4000 permission 仍需最终人类点击；headless 只改写 Git 忽略的验收副本。
- 本 PASS 不覆盖 20 次/多窗口矩阵、dispatch ledger reload/storage fault 完整矩阵、生命周期恢复或 PX6 汇总。
- 四项交易锁继续为 false；本 PASS 不构成正式交易或自动交易批准。
