# ChatBox + PI AgentCore 集成开发与验收计划

更新时间：2026-06-30

## 1. 阶段定位

ChatBox 是 FAMS 的全局业务入口，用于把红利低波、组合回测、任务中心、审计包和人工计划草案串成一条可理解的用户路径。它不是交易执行入口。

当前状态：

```text
chatBoxV1Integrated=true
piAgentCoreRuntimeIntegrated=true
agentToolWhitelistEnabled=true
deterministicPlannerFallback=true
piLlmAgentLoopEnabled=false
chatSessionPersistenceReady=false
chatStreamingReady=false
formalTradingUnlocked=false
autoTradeUnlocked=false
```

解释：

- 已接入 `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`，并通过 `piAgentCoreAdapter` 暴露受控 runtime 状态和 PI-compatible 工具 manifest。
- 当前 ChatBox v1 使用 deterministic planner，能稳定识别核心意图并调用 FAMS 白名单工具。
- 还没有启用 PI 的真实 LLM agent loop、多轮会话持久化或 SSE/WebSocket 流式事件。
- ChatBox 不暴露 shell、文件系统或任意网络工具；所有能力必须经过 FAMS 工具白名单、二次确认和交易 gate。

## 2. 目标体验

普通用户可以直接用自然语言完成：

```text
帮我看红利低波前三只候选
当前组合情况如何
帮我进入策略回测
刷新红利低波扫描
生成红利低波人工计划草案
为什么现在不能下单
```

系统必须回答：

1. 当前能做什么。
2. 数据和结论是否可信。
3. 下一步需要点击什么。
4. 哪些动作仍被禁止。

专业用户可以通过 ChatBox 跳转到：

- `DividendLowVol.tsx`：候选、观察区间、数据可信、人工计划草案。
- `Backtest.tsx`：策略比较、收益曲线、数据等级、模型有效性。
- `Operations.tsx`：任务状态、artifactRefs、审计包。
- `acceptance-report.html`：阶段性验收报告。

## 3. 当前实现实体

| 层级 | 已实现实体 | 当前职责 |
| --- | --- | --- |
| 前端入口 | `FamsChatBox.tsx` | 全局右下角 ChatBox、快捷问题、行动卡、确认按钮。 |
| 前端挂载 | `AppLayout.tsx` | 在所有页面提供 ChatBox。 |
| API 路由 | `backend/src/routes/chat.ts` | 提供 capabilities、messages、sessions、tool-confirmations。 |
| 编排服务 | `famsChatService` | 意图识别、工具选择、确认流、交易阻断。 |
| AgentCore 适配 | `piAgentCoreAdapter` | PI runtime 检测、PI-compatible tool manifest、before/after tool gate。 |
| 验收脚本 | `verify-chat-agent-core.ts` | 验证 PI import、工具 manifest、确认 gate、交易阻断。 |

## 4. 后续开发计划

### CA-1 ChatBox 文档归档

目标：把 ChatBox 纳入 PRD、目标架构、drawio 和阶段验收。

验收标准：

- drawio 中出现 `FamsChatBox.tsx / chat.ts / famsChatService / piAgentCoreAdapter`。
- PRD 明确 ChatBox 是业务入口，不是交易执行入口。
- 交易边界字段保持 `formalTradingUnlocked=false / autoTradeUnlocked=false`。

### CA-2 会话持久化

目标：让 ChatBox 支持可审计会话。

开发方向：

- 新增 ChatSession / ChatMessage 持久化模型或复用 Operation artifact。
- 保存用户消息、系统回复、工具调用、确认记录、blockedReasons、artifactRefs。
- 会话记录不得保存 token、cookie、隐私凭证。

验收标准：

- 刷新页面后可恢复最近会话摘要。
- 每次工具确认都有审计记录。
- blocked trade action 能追溯原因。

### CA-3 PI LLM Agent Loop

目标：在配置通用 Chat LLM 后启用 PI 真正的多轮 tool-calling agent loop。

开发方向：

- 用 PI `Agent` 管理上下文、工具调用和事件。
- `beforeToolCall` 继续执行 FAMS 工具白名单、二次确认和交易 gate。
- `afterToolCall` 写入审计字段。
- 缺少 LLM key 时继续 fallback deterministic planner。

验收标准：

- 有 LLM key 时可多轮理解用户上下文。
- 无 LLM key 时 ChatBox 仍可执行核心 deterministic intents。
- 无论 LLM 如何输出，正式交易动作都被阻断。

### CA-4 流式事件与任务联动

目标：让用户看到 ChatBox 正在调用哪个工具、任务是否排队、artifact 在哪里。

开发方向：

- SSE 或 WebSocket 推送 Chat 事件。
- Operation 进度映射到 ChatBox 状态。
- Action card 支持“打开页面 / 查看任务 / 查看审计包 / 确认执行”。

验收标准：

- 启动扫描或回测后，ChatBox 展示 operationId。
- 用户能从 ChatBox 一键进入任务中心。
- 失败任务显示用户可理解的失败原因。

### CA-5 全业务工具覆盖

目标：把 FAMS 核心业务纳入 ChatBox。

工具分级：

| 类型 | 可直接执行 | 需确认 | 永久阻断 |
| --- | --- | --- | --- |
| 只读 | 持仓、组合、候选、任务、审计 artifact | 无 | 无 |
| 副作用 | 无 | 扫描、回测、刷新、生成草案 | 无 |
| 交易 | 无 | 无 | ADD / REDUCE / ORDER_CREATE / AUTO_TRADE |

验收标准：

- 所有工具有风险等级。
- 所有副作用工具有确认卡。
- 所有交易动作返回 blocked response。

## 5. 出门条件

完成 ChatBox/AgentCore 完整阶段后，才可以声明以下能力已经 ready：

```text
chatBoxBusinessEntryReady
piAgentCoreToolCallingReady
chatSessionAuditReady
chatOperationLinkageReady
formalTradingUnlocked=false
autoTradeUnlocked=false
```

仍不能声明：

```text
ChatBox 可以下单
ChatBox 可以自动交易
ChatBox 可以绕过人工复核
ChatBox 输出等同正式投资建议
```

## 6. 验收命令

```bash
cd backend
node node_modules/typescript/bin/tsc
npm run test:chat-agent-core
npm run test:fivd-r-trade-gate-contract
npm run test:trade-action-readiness

cd ../frontend
npm run build
```

后续 E2E 验收必须覆盖：

```text
红利低波前三候选查询
组合摘要查询
任务状态查询
红利低波扫描需确认
人工计划草案需确认
正式交易动作被阻断
```
