# V2-PX PX6 生命周期消息合同重入决策

日期：2026-08-29

状态：`HUMAN_DECISION_REQUIRED_BEFORE_PRODUCTION_CODE`

## 1. 为什么必须选择

生命周期恢复需要容器打开/关闭、状态快照、恢复请求与 Background restart 的确定协议。当前权威 Markdown 与已经验收的生产 envelope 形状互斥，无法靠“兼容理解”同时满足；继续编码会扩大规格漂移并使历史证据不可复核。

## 2. LC-A：保留已实现命令 envelope，补独立生命周期端口（建议）

具体做法：

1. 将运行时合同页首版本状态和 §4.1 校正为当前已实现且已由 PX1～产品 PX4 重签的 `routeId/correlationId/idempotencyKey/messageType/payload` 命令 envelope，并让 semantic validator 校验其与 `current-stage-state.json` 一致。
2. route/operation command 不迁移，不重写 Host Bridge；保留现有 71 个扩展测试和真实 3×3/at-most-once 证据的语义锚点。
3. 新增内部专用长连接 `chrome.runtime.connect({name:'v2-px-lifecycle/1'})`：首次消息严格为 `state_subscribe`，包含 workspaceId、container、instanceId 和当前 route/correlation；Background 返回 `state_snapshot`。
4. port connect/disconnect 与显式 close 由 Background 写 container lease/lifecycle event；service worker 被终止后容器按有界退避重连并重新订阅。
5. `runtime.sendMessage` 的 command response 仍作为直接返回，不再把 `command_result` 伪装成一条未实现的反向 runtime message。
6. 错误码统一采用权威合同的 `PX_STORAGE_VERSION_UNSUPPORTED`，旧 `PX_STORAGE_VERSION_BLOCKED` 不再生成；在同一原子变更中更新 types、tests、UI 和负例。

影响：只新增生命周期协议，不重写已验收 route/command 主链；仍须重新回归 PX3/PX4A/PX4B/PX5，证明没有破坏历史阶段。

## 3. LC-B：把全部生产消息迁移到原 Markdown 通用 envelope

具体做法：

1. 把 route、operation、state subscribe/snapshot、command result 全部改为 `messageId + kind + payload`。
2. 重写 `types.ts`、`validation.ts`、`factories.ts`、runtime handler、runtime client、Host bridge 与所有 message fixtures/tests。
3. 重新生成 PX1、PX3、PX4A、PX4B、PX5 全部真实 Chrome 证据；旧证据只保留为历史基线。
4. 同样把 storage error 统一为 `PX_STORAGE_VERSION_UNSUPPORTED`。

影响：形式上最贴近原 Markdown，但会改写已验收消息主链，回归和伪绿风险显著更高；PRD 没有要求这种重写。

## 4. 建议结论

建议批准 `LC-A`。理由是 PRD 关心三入口一致、Background 单写、恢复可推导和无重复副作用，而不要求 envelope 必须使用 `messageId/kind` 命名。LC-A 保留真实已验证主链，用专用 port 建立生命周期所有权，变更范围更小、回滚更清楚，也更适合识别容器断开。

收到明确选择前：只允许审计与文档更正，不允许修改 `packages/fams-v2-px-extension`、frontend 或 backend 生产代码。
