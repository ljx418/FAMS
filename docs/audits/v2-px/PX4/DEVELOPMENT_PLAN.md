# V2-PX PX4-A 轻量 Side Panel 开发计划

日期：2026-08-29

状态：ENTRY_AUDIT_PASSED_READY_FOR_TDD

## 完成后的目标体验

用户打开 360/420px Side Panel 后，无需理解内部合同即可看到：是否连接、当前任务/来源、数据时间、简明结论、研究模式、最多 5 条最近任务、查看依据、打开完整工作台和 Quick Ask。点击发送后 1 秒内出现独立 ack，35 秒内显示真实简明摘要或明确终态；复杂详情继续进入 Workspace。

## 实现实体与顺序

1. `tests/sidepanel.test.ts`：先锁定当前任务、摘要、时间、最多 5 条、Quick Ask、ack/final 分离、状态文案、无交易动作等失败用例。
2. `entrypoints/sidepanel/SidePanelApp.tsx`：连接后先发送 Side Panel `source_library` intent 建立同一 workspace state，再由 `refresh_index` 读取真实 SourcePage；只渲染最近 5 条。
3. `SidePanelApp.tsx`：Quick Ask 使用现有 `operation-command/2 query`；问题、最终回答仅存 React memory；上下文只传当前受控 sourceRef。
4. `SidePanelApp.tsx`：提供简明依据折叠和“在完整工作台打开”；完整内容不挤入侧栏。
5. `src/styles.css`：只补 Side Panel 必需的 360/420 响应式、44px 点击区、focus-visible 和无溢出样式。
6. `scripts/verify-sidepanel-chrome.mjs` 与 package script：真实 unpacked Chrome、真实数据库、真实 API、真实 LLM，采集 360/420 截图、网络、storage、console、trace 与 hash。

## 失败处理

- Side Panel 不能通过受控 route+refresh 得到真实 SourcePage：回 Background/合同审查，不从 UI 直连 API。
- 真实 Ask 超过 35 秒：显示明确超时/unknown_result 与 FAMS 复核动作，不自动第二次 POST。
- headless 无法点击 optional permission：只允许与 PX3 相同的私有验收副本预授权；正式构建不得改写，最终人类点击保持 pending。
- Host Bridge 需要触碰其他 Agent 正在修改的共享前端文件时：PX4-A 仍可独立出门；PX4-B 等独立入场审计后处理，不混入本声明。

## 出门声明上限

本子阶段通过后最多声明 `sidePanelEntryAutomatedAccepted=true`。不得声明 Host 三入口、完整生命周期、最终候选、人类授权或交易能力完成。
