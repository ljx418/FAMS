# V2-PX PX4-B Host Bridge 开发计划

日期：2026-08-29

状态：IMPLEMENTED_AUTOMATED_ACCEPTANCE_PASSED

## 完成后的目标体验

用户在原有 FAMS ChatBox、每日持仓复盘和任务中心中，都能用一个清晰按钮把当前工作上下文交给 External Brain。已安装并配置扩展时，点击后 1 秒内看到“已接收”反馈，并打开或聚焦同一个完整 Workspace，分别定位提问、真实复盘图谱或真实任务追踪；未配置、扩展未安装或超时时，按钮仍在原位，以普通话解释原因和恢复步骤，不展示浏览器原始异常。

## 实现实体与顺序

1. `frontend/src/services/pxExternalBrainBridge.ts`
   - 冻结并构造与 Extension 一致的 `intent-route/3` 和 `runtime-message/1` public DTO。
   - 只接受按 intent 穷举的 primitive payload；在发送前严格验证 workspaceId、UUID v4、sourceRef 和 exact keys。
   - 从 `VITE_FAMS_PX_EXTENSION_ID` 读取 32 位 `[a-p]` 扩展 ID；配置缺失/错误、API 不可用、扩展未安装、blocked、超时统一返回结构化中文结果。
   - 1000ms 后诚实超时；不泄露 `chrome.runtime.lastError`；不写 storage，不发网络请求。
2. `frontend/src/components/external-brain/OpenInExternalBrainButton.tsx`
   - 统一三个页面的按钮、pending、成功、阻断和恢复提示。
   - 按钮始终渲染；没有合法业务 ID 时明确禁用并说明要先选择/生成对象。
   - 暴露稳定 `data-testid` 和最后一次 route/correlation，供真实浏览器验收。
3. `frontend/src/components/chat/FamsChatBox.tsx`
   - 在 Drawer header 放置“在外部大脑打开”，发送 `ask + {workspaceId}`；绝不传当前输入或历史消息。
4. `frontend/src/pages/DailyReviews.tsx`
   - 在页首操作区放置“在外部大脑查看图谱”，只传当前真实 `reviewId`。
5. `frontend/src/pages/Operations.tsx`
   - 在页首操作区放置“在外部大脑追踪”，只传当前已选 Operation；未选时提示先选任务。
6. `frontend/scripts/verify-v2-px-host-bridge.mjs`
   - 用本地真实 SQLite、真实 4000 API、Vite 3000、unpacked Extension 和 headless Chrome 完成配置负例与三入口正例。
   - 对照 URL、WorkspaceState/lifecycle、DOM、tab 数、console、storage、网络和交易表计数；写入私有 hash/截图/JSON 证据。
7. `frontend/package.json`
   - 只增加 `verify:v2-px-host-bridge`；因文件含其他 Agent 未提交行，提交时只暂存本行。

## TDD 与静态门槛

- 先为 bridge DTO、exact-key、禁止 question/secret、配置与 lastError 清洗建立可执行测试，再接 UI。
- TypeScript build 必须通过；Extension 完整 contract/router/runtime 测试必须回归通过。
- 验收脚本必须扫描三处集成点和真实浏览器运行消息，不能只做源代码字符串检查。

## 失败处理

- Host API 不存在或扩展未安装：只显示中文配置说明，保持 FAMS 页面可用。
- Background 返回 blocked：展示其已清洗的 userMessage 和 route/correlation，不重试、不改发 operation command。
- 1 秒内没有 ack：返回超时和“检查扩展是否启用/ID 是否匹配”的动作；晚到 callback 不得改写已结束 UI。
- review/operation ID 非合法 UUID v4：本地阻断，不向扩展发送。
- 真实 Chrome 不支持外部消息：按入场停止条件记录证据，不构造绕过通道。

## 出门声明上限

本子阶段通过后最多声明 `hostBridgeAutomatedAccepted=true`、PX4 三入口自动化验收闭环。完整生命周期恢复、最终候选、人类 optional permission 手势和交易解锁仍保持未完成/false。

实现提交：`4b4d3a808382c7522c25be1d316889441bd8cf54`；真实边界负例补强提交：`a0758b4980b01739ead5abff0bc2029a66716964`。最终证据位于 `.verification/private/v2-px/a0758b4980b01739ead5abff0bc2029a66716964/PX4B`。
