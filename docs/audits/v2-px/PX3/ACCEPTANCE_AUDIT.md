# V2-PX PX3 Workspace 与 Adapter 验收审计

日期：2026-08-29
当前结论：PASS_AUTOMATED_SCOPE_HUMAN_PERMISSION_GESTURE_PENDING

## 入场审计

| 检查 | 结论 |
| --- | --- |
| PX1 target 与 Chrome 重签 | PASS；`0e34a1f.../PX1` |
| PX2 API/policy/真实数据 | PASS；`246e09a.../PX2` |
| MV3 caller identity 合同 | 方案 A 已由用户批准；Markdown、draw.io、API、client 和验收矩阵同口径 |
| DTO/重试/状态/五视图唯一性 | PASS；由 PRD、目标架构和运行时合同冻结 |
| 未决 fatal/major | 0；原无 Origin blocker 已关闭 |

## 自动化出门结果

| 场景 | 结果 | 可复核事实 |
| --- | --- | --- |
| Client envelope | PASS | malformed success fail closed；GET 仅网络/503 有限重试；POST 不自动重试；conversationId 严格 UUIDv4 |
| 五视图 | PASS | source_library/source_detail/ask/trace/graph 5/5 使用真实 read model |
| at-most-once | PASS | 43 个扩展测试全部通过；真实 Ask POST=1；问题/回答未写 Chrome storage |
| 状态诚实性 | PASS（本切片） | 无路由不伪 ready；真实失败复盘仍显示 failed 事实；空/失败/阻断均保留下一步 |
| DB/API/DOM 同源 | PASS | Operation 与 DailyReviewRun 的 id/ref/status 在 DB、API、DOM 可关联；不存在人工替换对象 |
| Chrome 768/1280 | PASS | 5 个视图各 2 个视口；根横向溢出=0；console error=0；截图/hash/trace 齐全 |
| 方案 A caller | PASS | 所有真实 External Brain GET/POST header 都等于实际 extension ID；两正例、八负例通过 |
| 交易/隐私 | PASS | broker/order 请求=0；Transaction 变更=0；四锁=false；storage 泄漏=0 |

## 执行记录

- `npm run typecheck`：PASS。
- `npm test -- --run`：8 文件、43/43 PASS。
- `npm run test:workspace`：6/6 PASS。
- `npm run build`：PASS；正式 manifest 的 `host_permissions=[]`，4000 仅在 `optional_host_permissions`。
- `npm run test:v2-px-policy`：PASS；caller identity matrix 与交易边界通过。
- `npm run test:v2-px-api-contract`：PASS；真实 Operation=255、DailyReviewRun=28、Ask POST=1、八个 caller 负例=403、交易变更=0。
- `npm run verify:workspace-chrome`：PASS；Chrome 152、真实扩展 ID、真实 API/DB/LLM、10 张核心视口截图、console error=0。

代码提交与原始证据：

- commit：`6c8714ed6909342f1730746451a8b2aaebc754d4`
- API：`.verification/private/v2-px/6c8714ed6909342f1730746451a8b2aaebc754d4/PX2`
- Chrome：`.verification/private/v2-px/6c8714ed6909342f1730746451a8b2aaebc754d4/PX3`
- trace SHA-256：`afe0b3890af5fadd68e7a4aba4df9e477eeade8675df7c14b4f160ee72ea3b00`

## 视觉与反假绿复核

人工式截图审查覆盖来源库与 Ask 的 768/1280 原始截图：文本、主动作、摘要、时间、可信状态和下一步均可读，无遮挡或水平滚动；高级证据默认折叠。验收器同时查询真实 SQLite 成员、监测浏览器网络、扫描 storage、统计 POST/交易请求并保存 Playwright trace，不以 shell/root 存在或 mock DOM 作为通过条件。

## PRD 规格检视结论

本子阶段没有 fatal/major 规格偏移。PX-REQ-003/005/013/015/016/018 的本阶段目标已由真实证据支撑；PX-REQ-009 的 Ask at-most-once 路径已实现；PX-REQ-007/008/014/017 只完成本切片所需的状态与单写基础，完整 Back/Forward/关闭重开/reload/断连恢复仍属于后续阶段，未被提前声明完成。详细矩阵见 `PRD_SPEC_REVIEW.md`。

## 剩余人类门槛

Chrome headless 无法确认 `chrome.permissions.request` 弹窗，因此验收器只在 Git 忽略的私有构建副本预授予两个 4000 origin。正式构建没有预授予，也没有扩大权限。最终候选发布前，人类仍需在正式 unpacked 扩展中点击一次“连接本地 FAMS”并附图；这不阻断下一自动开发子阶段，但阻断 `v2PxComplete=true`。
