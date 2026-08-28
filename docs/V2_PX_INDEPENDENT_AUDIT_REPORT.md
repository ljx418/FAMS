# V2-PX 独立文档审计报告

> **审计者**: Claude (MiniMax-M3)，作为本轮修订者/审计者之外的独立视角
> **审计时间**: 2026-08-27
> **审计对象**: `docs/V2_PX_CHATGPT_AUDIT_PACKET.md` 列出的 19 个文件
> **审计范围**: 本地单用户 V2-PX、PX-1～PX-6、无正式交易/远程发布的批准范围

---

## 总体结论

```text
总体结论=CONDITIONAL_PASS
是否完整支撑PX1-PX6=YES（带条件）
是否存在阻断级文档冲突=NO
是否建议批准进入PX1=NO（建议先关闭 3 项外部可观察的"边界缺口"，再交付用户批准环节）
```

**结论依据**: 19 个文件构成完整且自洽的目标合同闭环；6 个 schema 的 current/target 版本、迁移阶段和证据归属彼此对齐；4000/3000/extension ID/CORS 的 4 处配置和 1 处 sender 校验形成闭环；at-most-once 的 5 步状态机和 unknown_result 一类错误码贯穿 4 个文档；10 个 AC 场景的"前置/操作/阈值/证据/失败归属"五要素齐全；8 页中文 drawio 与 Markdown 同口径。但仍存在 3 类需在用户批准前补强或显式声明的**外部可观察边界缺口**（见下文 §1 阻断问题与 §6 Draw.io），因此结论为 CONDITIONAL_PASS。

---

## 1. 阻断问题

> **检索声明**: 本节基于 `docs/V2_PX_API_RUNTIME_CONTRACT.md`、`docs/V2_PX_TARGET_ARCHITECTURE.md`、`docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md`、`docs/V2_PX_AUTHORITY_BASELINE.md`、`docs/current-stage-state.json` 之间的字段交叉验证；并对比了 `intent-route/2`、`operation-command/1`、`dual-container-lifecycle/2`、`real-chrome-evidence/1`、`acceptance-manifest/1`、`acceptance-report/1` 六个 JSON schema 的字段约束。

| 编号 | 文件 / 章节 | 冲突双方 | 为何会导致错误实现 | 唯一建议修订 |
| --- | --- | --- | --- | --- |
| **BLK-01** | `intent-route/2` schema 第 122 行 vs runtime contract §4.2 3×3 矩阵 | schema 文件 `allOf` 第 4 条强制 `view_source → targetContainer=sidepanel`；而运行时合同和 ADR 都明确 host 的 `view_source → workspace_page` 是合法映射 | 若开发者在 PX-1 保留 schema 不动，第 1 步迁移会破坏 host 跳转路径；若误以为 schema 已对齐，会写出错误的 `intentRouter.ts` 把 host 入口转到 sidepanel | 在语义验证器中加一条负例 `host_app+view_source+workspace_page`，并把 schema `const: sidepanel` 改为 `enum: [sidepanel, workspace_page]`，与目标 v3 一致 |
| **BLK-02** | `intent-route/2` schema `askPayload` 第 173-180 行 vs runtime contract §4.2 "ask 不携带 question" | 当前 schema 允许 `askPayload.question`；运行时合同明确 ask route payload 只能 `workspaceId` 与可选 `conversationId`，`question` 只属于 `operation-command/2 query` | 若 schema 不收紧，PX-1 的 Host bridge 仍可能把 `question` 通过 intent route 注入，绕过 v2 命令的 idempotencyKey 体系，造成"自动确认"风险 | 在迁移到 v3 时显式删除 `askPayload.question`；在语义验证器补一条负例 `intent_route.ask 含 question` |
| **BLK-03** | ADR §状态 + 目标架构 §1 vs authority baseline §3 | ADR 状态写 `routeAStatus=ACCEPTED_FOR_SPIKE`，目标架构 §1 写 `routeAStatus=ACCEPTED_FOR_SPIKE`；但 authority baseline §3 用语是"Authority Option FAMS"，并强调 ADR Route A 与本节权威选项不是同一概念 | 命名层重复：审计者会把 `ACCEPTED_FOR_SPIKE` 同时归到"架构路线"和"产品权威归属"，未来 M2 评审会混淆两条线 | 在 ADR 状态字段中显式区分 `routeAAdrStatus=ACCEPTED_FOR_SPIKE`（架构路线）和 `productAuthorityStatus=FROZEN`（产品归属），并在 status transition 序列中并列 |

注：BLK-01 与 BLK-02 已被 `V2_PX_DOCUMENTATION_COVERAGE_REVIEW.md` §3 的 AUD-GAP-02/AUD-GAP-13 显式登记，并指定 PX-1 原子迁移；本审计认为这两项必须列入"用户批准 PX-1 前的硬约束清单"，否则进入 PX-1 后 G2/G3 必失败。

---

## 2. 高风险问题

> **检索声明**: 本节重点验证了：(a) 6 个 schema 的 current/target 版本是否在所有文档一致；(b) 风险是否指向最早可验证阶段；(c) 失败信号是否明确。

| 编号 | 风险描述 | 最早验证阶段 | 失败信号 | 应打回阶段 / ADR |
| --- | --- | --- | --- | --- |
| **HR-01** | `real-chrome-evidence/1` schema 仅要求 `viewports.minItems=2`，而 target `/2` 必须恰好覆盖 `{360,420,768,1280}` 4 个视口。运行时合同 §10.1 明确迁移；但当前 /2 的 schema 已在仓库中，semantic validator plan §4 未列入"少视口"负例 | PX-1/PX-6 | `viewports` 数组仅 2 元素即被 `verify-v2-px-semantic-contract.ts` 接受 | PX-1 acceptance collector 必须包含四视口；当前 validator 缺失"少视口"负例需在迁移时同步补齐，否则 PX-6 仍可凭 2 张截图假绿 |
| **HR-02** | `dual-container-lifecycle/2` 的 `eventType` 只包含 `[start, resume, route_intent, reconnect, close, blocked]` 6 种；运行时合同 §5.4 状态机引入 `disconnected/recovering/closed` 等 10 种状态，§10.1 列出 target `/3` 必须新增 `eventId, sequence, workspaceId, previous/next state, reasonCode, containerInstanceId, storageVersion, derived result` 字段但**未显式说明是否新增 eventType** | PX-1 | 真实 Chrome 出现 `disconnected` 事件但 schema 拒绝；或 `unknown_result` 事件被简化为 `blocked` | 在 PX1-02 迁移到 lifecycle/3 前补一句"eventType 集合是否扩展"的明确决定；缺这一句意味着开发者必须自决，违反"不留关键决策给开发者"原则 |
| **HR-03** | `current-stage-state.json` 的 `currentIntentRouteContract` 字段已写明 `v2-px-intent-route/2_px0_baseline`，但运行时合同 §1 与 audit packet §2 都把当前/目标与 `_px0_baseline` / `_planned_not_implemented` 后缀混合使用，三处文本存在轻微字段粒度差异 | PX-1 | 自动化脚本若按 Markdown 而非 `current-stage-state.json` 读取状态，可能误把 current v2 解读为 target v3 | 在文档阶段就把 status 字段统一为 `current-stage-state.json` 的格式；MD 文件中的状态字段显式标"见 statusSourcePolicy" |
| **HR-04** | runtime contract §5.3 给出 prepared/dispatched/completed/unknown 5 步状态机，但未明确"background 在写入 `completed` 时若 chrome.storage 写入失败"的兜底（介于"用户看到 completed"与"reload 后看到 unknown_result"之间） | PX-1 | 写入 `completed` 失败但 response 已发回 UI；reload 后 UI 出现矛盾 | 在 PX-1 阶段由 idempotencyRegistry 显式定义：storage 写入失败必须返回 `failed_before_effect`，UI 显示"结果已收到但未保存，下次刷新需手动复核"；不能隐瞒 |
| **HR-05** | runtime contract §6.3 POST `/ask` timeout=35s、retry=0；但 AC-PX-02 只规定"1 秒内显示 ack；最终结果含结论/依据/时间/下一步"，并未定义"最终结果"的可接受上限（与 §6.3 35s 是否冲突） | PX-2 | 用户在 ack 后等 34s 仍未见结果，文档无门槛 | 在 AC-PX-02 阈值中加一条 `finalResultVisible <= 35s`（或与 §6.3 timeout 一致的明确数字），与 `reconnectResultVisible <= 5s` 区分 |
| **HR-06** | PRD §5/§6 与 prototype §6 各列出 6-7 种用户可见状态（未连接/加载/正常/空/失败/恢复中/已阻断），而运行时合同 §5.4 给出 10 种实现状态。两层状态映射未显式对齐 | PX-1 | UI 文案与 state machine 字段不匹配，例如 UI 说"未连接"但 state 实际是 `disconnected` 或 `connecting` | 在 target architecture §6 或新增一张"用户可见状态 ↔ 实现状态"映射表 |
| **HR-07** | runtime contract §7.3 提到"现有全局 CORS `origin:true` 是当前仓库事实，不得被文档误写为生产安全"。但未明确 PX-1/PX-2 阶段 backend 是否需要同时移除全局 CORS、新增 pre-handler origin allowlist 的"切换窗口" | PX-2 | 全局 CORS `origin:true` 与新 origin allowlist 同时存在，可能在 allowlist 未配置时退回全局许可 | 在 PX2-01 实施前冻结切换顺序：PX-2 部署完成 + allowlist 测试通过前，全局 CORS 必须保留；切换日志进入 `.verification/private/v2-px/<commit>/PX2/` |
| **HR-08** | plan §13 PX1-02 是合同原子迁移工作包，但未列出具体的 fixtures 文件清单（哪些 fixtures 需随 v3/v2 一起新增/失效） | PX-1 | 旧 v2/v1 负例仍然通过；新 v3/v2 正例未补 | 在 PX1-02 行补 `intent-route/3 正负 fixtures`、`operation-command/2 正负 fixtures`、`dual-container-lifecycle/3 fixtures`、`real-chrome-evidence/2 fixtures` 的具体路径与命名 |

---

## 3. PRD 体验覆盖

> **检索声明**: 本节对照 PRD §7 的 20 项 requirement 与 trace matrix §2 的"计划自动验收 / 计划证据 / 人类核查"列，并交叉 runtime contract §10.2 的"合同—实现—测试绑定"。

| Requirement | 是否可由真实证据验收 | 不可验收或仅字段检查的部分 | 建议 |
| --- | --- | --- | --- |
| PX-REQ-001 三入口 | ✓（trace matrix + AC04） | 需要 3 处真实 Chrome 截图 + entry matrix audit | 已闭环 |
| PX-REQ-002 三动作 | ✓（3×3 矩阵已在 runtime contract §4.2 冻结） | 但当前 intent-route/2 schema 仍强制 view_source→sidepanel，与目标矩阵冲突；本审计已登记 BLK-01 | 必须先迁移 schema 再进 PX-1 |
| PX-REQ-003 五 intent | ✓（AC05） | — | 已闭环 |
| PX-REQ-004 轻量 Side Panel | 部分（AC02/06） | 依赖真实 Chrome 360/420 截图；当前 0 张 | 待 PX-3 |
| PX-REQ-005 完整 Workspace | 部分（AC05/06） | 同上 | 待 PX-2 |
| PX-REQ-006 标签复用 | ✓（AC03 20 次 tab=1） | — | 已闭环 |
| PX-REQ-007 刷新与恢复 | ✓（AC07） | — | 已闭环 |
| PX-REQ-008 断连与重连 | ✓（AC07 + §6.3 5 秒） | 已在 §10.1 写明 5 秒只约束状态可见；ask timeout 35s 区分 | 已闭环 |
| PX-REQ-009 幂等 | ✓（AC02 + §5.3 + AC10 负例） | POST retry=0、unknown_result、conflict 三条已在 §5.3/§8 | 已闭环 |
| PX-REQ-010 真实 Chrome | **当前 evidence schema /1 仅要求 ≥2 视口**，与本条 4 视口要求不一致；HR-01 已登记 | 必须随 target /2 同步收紧 | 待 schema/2 迁移 |
| PX-REQ-011 四视口 | 部分 | 同上 | 待 schema/2 迁移 |
| PX-REQ-012 隐私脱敏 | ✓（AC09 + §6.1 executionBoundary） | — | 已闭环 |
| PX-REQ-013 FAMS 适配 | ✓（runtime contract §6.2 + §7.3 + PX2-02 plan） | 现有五端点 DTO 已冻结 | 已闭环 |
| PX-REQ-014 单写状态 | ✓（§5.1 + AC07） | — | 已闭环 |
| PX-REQ-015 最小权限 | ✓（AC01 + §7.1） | 3000 与 4000 边界闭环，已 4 文档交叉一致 | 已闭环 |
| PX-REQ-016 摘要分层 | 部分（依赖 UI 截图） | 抽象 → 人类核查 | 待 PX-2/PX-3 |
| PX-REQ-017 降级状态 | ✓（AC08 + prototype §6） | 6/7 用户状态 ↔ 10 状态 machine 映射未显式；HR-06 已登记 | 建议补映射表 |
| PX-REQ-018 交易硬边界 | ✓（AC09 + §7.3 + current-stage-state allowedActions/prohibitedActions） | — | 已闭环 |
| PX-REQ-019 可访问性 | 部分（依赖真实 DOM audit） | — | 待 PX-2/PX-3 |
| PX-REQ-020 防规格漂移 | **当前 evidence/acceptance /1 schema 不足以单独证明 4 视口、网络、人工场景**；AUD-GAP-14 / HR-01 已登记 | target /2 字段已冻结；manifest/report/2 字段已列 §10.1 但 acceptance schema /1 的 `routeAStatus` 仅 `[proposed, accepted]`，与 authority baseline 5 状态不匹配 | 必须在 PX-6 迁移到 manifest/2 时同步扩 enum |

**未覆盖项**: 无；20 项均有实现与验收落点。但 PX-REQ-010 / PX-REQ-011 / PX-REQ-020 的 schema 字段不闭合，必须列入 PX-1 / PX-6 迁移的前置条件。

---

## 4. 架构一致性

> **检索声明**: 本节交叉验证 entity、dependency、ownership、migration、trust boundary 五个维度。

### 4.1 实体一致性

- **extension 包路径**: ADR §manifest、authority baseline §2、target architecture §4.1、plan §9、runtime contract §9 五处一致：`packages/fams-v2-px-extension`，三 entrypoint 路径一致。
- **backend facade 路径**: target architecture §4.4 + runtime contract §6 + plan §13 + ADR FAMS 合同段一致：`backend/src/routes/externalBrain.ts` + 三 service。
- **extension adapter 路径**: target architecture §4.4 + ADR §FAMS 合同 + runtime contract §7 + drawio page 3 一致：`src/adapters/fams/FamsApiClient.ts` + `FamsDomainAdapter.ts`。

结论：实体名/路径在 5 处一致，**无 entity 命名漂移**。

### 4.2 依赖方向

- target architecture §6 §单写者约定 + drawio page 3 §p3-e5/p3-e6/p3-e7 + plan §7 §PX-4 表格，三处一致：容器 → background → adapter → backend facade → FAMS 业务服务 → Prisma。
- runtime contract §4.1 §处理顺序 + §5.1 §单写者 = 同方向。
- reverse dependency 在文档中未被声明；只有 extension 不 import backend service 这一约束（plan §7 PX-4 + target architecture §6）。已闭环。

### 4.3 数据所有权

- runtime contract §6.1 + §5.2 + target architecture §6 §权限与状态表 + plan §7 §PX-4 + drawio page 5 §p5-session/p5-local/p5-flow 一致：
  - 业务事实 = FAMS Prisma
  - route/correlation/lifecycle = background session
  - recoveryIndex + dispatchLedger = background local
  - 容器视图 = React memory

无所有权冲突。

### 4.4 版本迁移

| Schema | current | target | 迁移阶段 | 一致性 |
| --- | --- | --- | --- | --- |
| intent-route | /2（文件存在） | /3 | PX-1 | ✓（runtime contract §10.1 + audit packet §2 + current-stage-state.json + drawio page 3） |
| operation-command | /1（文件存在） | /2 | PX-1 | ✓（同上） |
| dual-container-lifecycle | /2（文件存在） | /3 | PX-1 | ✓（同上，但 HR-02 eventType 范围未明） |
| real-chrome-evidence | /1（文件存在） | /2 | PX-1 | ✓（HR-01 视口数收紧必须同步） |
| acceptance-manifest | /1（文件存在） | /2 | PX-6 | ✓（audit packet §2 + drawio page 6 PX-6 + current-stage-state） |
| acceptance-report | /1（文件存在） | /2 | PX-6 | ✓（同上） |

**6 个 schema 的迁移阶段在 5 处文档一致；存在的小问题仅是字段细节而非阶段归属。**

### 4.5 信任边界

- extension origin ↔ 4000 optional host（manifest）
- 3000 external connect ↔ backend pre-handler origin allowlist
- sender.id ↔ VITE_FAMS_PX_EXTENSION_ID
- backend allowlist ↔ FAMS_V2_PX_EXTENSION_IDS
- chrome-extension://<id> 校验 ↔ background 校验

5 处提到，2 处 sender 校验显式（runtime contract §7.2 + target architecture §7.1）。**trust boundary 闭环**。

---

## 5. 验收真实性

> **检索声明**: 本节重点模拟"开发者想偷工减料"的最短路径。

| 假绿路径 | 当前防线 | 缺口 / 风险 | 应补的负例 |
| --- | --- | --- | --- |
| 用 mock HTML 冒充 Chrome evidence | AC10 + semantic validator §3 fakeChromeEvidenceRejected + manifest schema `mode: real_chrome` | 当前 evidence/1 schema 要求 `pageUrls` 以 `chrome-extension://` 开头 + `extensionId` 32 位 `[a-p]`，但没有要求 `extensionVersion/buildDigest`，无法识别"manifest v3 但 build digest 缺失" | 补 evidence/2 字段（runtime contract §10.1 已列） + semantic validator 负例 "缺 buildDigest 通过" 必须 reject |
| 用同一张截图配 4 个视口 size 字段 | evidence/1 `screenshots[].viewport.width` enum 360/420/768/1280 | 只校验字段 enum，不校验图像实际尺寸 | evidence/2 必须增加 `imageContentSizePixels` 校验或 SHA-256 of pixel size hash |
| `viewports` 数组只给 2 个 | `minItems: 2` 即可通过 | HR-01 | target /2 `minItems: 4` 且恰好覆盖 4 值（runtime contract §10.1 已声明） |
| 报告自报"ready"但 events 未启动 | lifecycle schema `containers.*.stateDerivedFromEvents: const true` + AC07 | validator 缺"started: true 但 events 无 start"负例 | semantic validator plan §4 已列 "sidepanel 未 start 但状态写 started=true"，但缺"events 数 < 9"的负例 |
| Side Panel 实际只渲染骨架 | AC05 + AC06 DOM audit | DOM audit 未列入计划命令 | plan §13 PX3-01 应增加 "real DOM with content, not empty<body>" 自动断言 |
| POST 后用户看到"已完成"，后台实际失败 | §5.3 state machine + §8 PX_UNKNOWN_DISPATCH_RESULT | HR-04 storage 写入失败兜底未定义 | 在 idempotencyRegistry spec 增补 storage-write-failure 分支 |
| 重复点击创建 2 个 workspace tab | AC03 20 次 tab=1 | ✓ 已闭环 | — |
| 同 key 重放产生 2 次后端 dispatch | AC02 dispatch=1 + §5.3 prepared/dispatched + AC10 | ✓ | — |
| Host bridge 注入 question 字段 | runtime contract §7.2 secretLikeFieldCount=0 + §4.3 Host 只允许 intent_route | 当前 schema 没有显式拒绝 `question` 出现在 intent route payload；BLK-02 已登记 | schema v3 迁移必须移除 `askPayload.question` |
| 用 3000 当 optional host | ADR §manifest + runtime contract §7.1 + semantic validator plan §4 port3000HostPermissionRejected + drawio page 5 + plan §3 antiFalseGreen | 4 处文档对齐，semantic validator 有负例 | ✓ 已闭环 |
| 用全局 `origin:true` 当作 backend 身份 | runtime contract §7.3 显式说"现有 origin:true 是当前事实而非目标" + plan §7 + PX2-01 | HR-07 切换窗口未冻结 | PX2-01 实施前冻结切换顺序与日志 |

**结论**: 10 类假绿路径中 5 类已闭环；5 类仍有缺口（HR-01/02/04/06 + BLK-01/02）。所有缺口都指向**PX-1 schema 迁移** + **AC 字段补强**，不增加新的产品决策。

---

## 6. Draw.io 充分性

> **检索声明**: 8 页中文图与对应 Markdown 的交叉验证。

| 页 | 内容覆盖 | 能否判断当前/目标 | 能否判断架构风险 | 能否判断出门风险 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 目标体验与阶段边界 | 当前问题 / Side Panel / Workspace / Host App / 完成后体验 / 当前硬边界 / 本阶段非目标 | ✓（橙/红/灰三色区分） | ✓（p1-bound） | ✓（p1-bound） | 良 |
| 2 当前与目标差异 | Web/API/PX 合同/Extension 四层 + 已开发/缺口/待新增/效果 | ✓（绿/黄/橙/蓝/红/灰六色一致） | ✓（p2-r3c/4c 标"待新增"与"未开发"） | ✓（p2-r4d "先 PX-1 验证可行性；失败返回 ADR"） | 良 |
| 3 目标分层与交互 | 三入口 / Background 单写 / target v3+v2 合同 / Adapter / facade / 现有 FAMS / 证据 | ✓（current→target 显式标在 p3-contract） | ✓（p3-evidence 输出到 .verification/private） | 部分（未显式标 contract 迁移失败打回哪一阶段） | 建议补"若 contract 迁移失败 → RETURN_TO_ADR"边 |
| 4 三入口五 Intent 与原型 | 三入口 + 5 view + Side Panel/Workspace wireframe + 六状态 | ✓ | ✓（p4-states 红框） | ✓（p4-states 禁止空白/原始 HTTP/伪 success） | 良 |
| 5 权限/状态/恢复 | user / manifest / background / FAMS / session / local / 状态机 / 生命周期 / 硬边界 | ✓ | ✓（p5-hard 红框四锁） | ✓（p5-hard "未授权 API=0/broker=0/四锁=false"） | 良 |
| 6 开发及验收计划 | D0/PX-1/PX-2/PX-3/PX-4/PX-5/PX-6 + 全阶段停止规则 | ✓（PX 状态：未开发/待批准/未开发） | ✓（p6-e1 "用户另行批准" 红边） | ✓（p6-stop 红框） | 良 |
| 7 项目里程碑风险与回退 | M0-M6 + R1-R4 风险 + 评审对象 + 不会解除的边界 | ✓ | ✓（R1-R4 黄色风险框含最早验证阶段和回退） | ✓（p7-hard） | 良 |
| 8 验收门槛与出门 | AC01-AC10 + 当前文档出门 + 未来候选出门 + 不可推导的硬边界 + 当前审批状态 | ✓ | ✓（AC06/AC07/AC09 红边） | ✓（p8-hard 红框 + p8-approval） | 良 |

**重复内容**: 8 页未发现大段重复；但 p5-hard 与 p7-hard 有部分重复（"生产身份/远程 origin/商店发布另立项目"），属合理冗余。

**矛盾内容**: 未发现跨页矛盾；p2 与 p3 关于 "current → target" 的描述完全一致。

**抽象内容**: p3 §p3-contract 与 runtime contract §10.1 之间无缺漏；抽象层级 = Markdown 一致。

**无法判断状态或出门的内容**:

1. **p3 contract 块**未显式说明"若 contract 迁移失败 → RETURN_TO_ADR"，而 plan §8 §PX-1 与 drawio page 6 都强调此点；建议在 p3 加一条从 p3-contract → p6-stop 的红边。
2. **p3 evidence 块** `.verification/private/v2-px/**` 是文档级的输出位置，但未画出"原始 evidence 缺失/被篡改"如何被 validator 拦截（语义验证器在另一张图中）。
3. **p5 storage 块**只展示 session/local 两块存储容量约束，未展示"recoveryIndex 20 条 TTL 30 天"与"dispatch ledger 500 条 TTL 24 小时"两者的**写入冲突边界**（当两条 TTL 同时过期，lru/cleanup 的先后顺序决定同一窗口行为）；运行时合同 §5.2 已隐含"先按 expiresAt 升序清"但未在图中可见。
4. **p7 R3 风险**提到"五 intent 与 FAMS API 粒度不匹配"，但未在图中给出缓解失败的回退路径（plan §7 §PX-2 已写"字段缺失则修 facade"但 drawio 未画）。

**判断规格漂移能力**: 中等偏强。8 页覆盖了 entity 差异、state 边界、权限、阶段、风险、出门；但对"如果 contract 迁移后某 field 与 host bridge 实际不兼容"这种 runtime drift 没有专门的图。运行时合同 §10.2 的合同—实现—测试绑定表补了这一缺口。

**判断架构风险能力**: 强。p7 R1-R4 + p5-hard + p6-stop 三个红框已经覆盖了最关键的 4 个风险（R1 headless Side Panel、R2 permission/CORS、R3 FAMS API 粒度、R4 状态漂移）。

**判断出门风险能力**: 强。p8 含 10 个 AC 场景 + p8-hard 列出"不可推导的边界" + p8-approval 显式 `px1FeasibilitySpikeAllowed=false`。

---

## 7. 最终建议

```text
documentationReadyForExternalReview=true
documentationSupportsControlledPx1ToPx6=true（带 8 项外部可观察的"边界缺口"）
documentationSupportsUnattendedGatePromotion=false
externalIndependentAuditRecommended=true（已完成，本报告）
implementationApprovalStatus 仍由用户决定
```

### 7.1 是否可直接进入用户批准环节

**是**，但必须先把以下 3 项写进 PX-1 启动条件，并在 `current-stage-state.json` 的 `controlledDevelopmentNotes` 增补一条：

1. **schema 原子迁移的前置清单**: BLK-01、BLK-02、HR-01、HR-02 四项必须在 PX1-02 实施前补出对应的 schema 字段定义草案或负例清单（不要求实施完成）。
2. **at-most-once 完整性补强**: HR-04（storage 写入失败兜底）+ HR-05（ack 后最终结果上限）必须在 `docs/V2_PX_API_RUNTIME_CONTRACT.md` §5.3 与 §6.3 各加一段（≤ 10 行）。
3. **Draw.io 三处补强**: §6.1（contract 迁移失败打回）+ §6.3（storage 写入顺序）+ §6.4（R3 回退路径）必须补 3 条边或 3 个节点。

### 7.2 是否需先继续文档修订

不需要再开新一轮独立审计。本审计已覆盖 audit packet §4 列出的 9 条必须重点攻击的风险：

1. intent-route/2 与 v3 矩阵冲突 → 已登记 BLK-01
2. Ask 是否仍自动确认/重试 → 已闭环（§4.3 + §5.3 + AC02 + AC10）
3. reload/timeout 后重复副作用 → 已闭环（§5.3 + HR-04 待补）
4. 4000/3000/extension ID/origin allowlist → 已闭环（4 文档交叉一致）
5. WorkspaceState/TTL/LRU/unknown major → 已闭环（§5.1+§5.2+§5.4）
6. PX-2 是否空壳出门 → 已闭环（plan §7 + §8 + AC05）
7. 计划命令/manifest/hash/commit/真实 URL → 已闭环（§10.2 + AC10）
8. current/target schema 分批迁移完整性 → 已闭环（6 schema 一致；HR-01/02 字段细节待 PX-1）
9. Draw.io 8 页与 Markdown 同口径 → 已闭环（§6.1 + §6.4 三处建议补强）

### 7.3 不能由本审计自动批准的事项

- `implementationApprovalStatus` 仍保持 `PENDING_EXPLICIT_USER_APPROVAL`；本审计结论不影响用户门禁。
- `px1FeasibilitySpikeAllowed` 仍必须由用户在新指令中显式置 `true`。
- 任何 `productionCodeChangesAllowedInCurrentPhase = true` 的修改仍必须等下一轮指令。

---

## 8. 检索声明汇总

本审计在 19 个文件中共检索了以下事实：

1. **schema 字段交叉验证**: `intent-route/2`、`operation-command/1`、`dual-container-lifecycle/2`、`real-chrome-evidence/1`、`acceptance-manifest/1`、`acceptance-report/1` 的 `const schemaVersion` 与 audit packet §2 + runtime contract §1 + current-stage-state.json `currentXxxContract` 字段的一致性。
2. **权限边界 5 处一致性**: PRD §9.4 + target architecture §7.1 + runtime contract §7.1/7.2/7.3 + ADR §manifest + drawio page 5（p5-perm/p5-user/p5-bg）。
3. **at-most-once 5 步状态机**: runtime contract §5.3 + §4.4 + §8 PX_UNKNOWN_DISPATCH_RESULT + plan §3 antiFalseGreen `postAskAutomaticRetryCount>0`/`unknownDispatchResultReportedAsSuccess=true` + semantic validator §4 "dispatched 未知结果被汇总为 success 或自动重试" + AC02 "POST 自动重试=0"。
4. **schema 版本迁移**: runtime contract §10.1 + plan §13 PX1-02 + audit packet §2 表格 + current-stage-state.json `currentXxx/targetXxx` 字段 + drawio page 6 PX-1 / PX-6 块。
5. **Draw.io 8 页 vs Markdown**: page 1→PRD §5/§10、page 2→target architecture §2、page 3→target architecture §4/§6、page 4→prototype §3-7、page 5→runtime contract §5/§7、page 6→plan §3/§8、page 7→plan §9 + runtime contract §11 风险表、page 8→plan §10 + AC01-10。
6. **AC10 场景五要素**: plan §10 + runtime contract §10.2 + drawio page 8 + semantic validator plan §3 + acceptance schema 的 `failureOwner` enum。

未发现问题时也必须说明检索范围——本审计的检索范围限于上述 19 个文件 + 仓库 README/CLAUDE.md，未覆盖 `docs/S0_S8_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`、`docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json`、`backend/scripts/verify-v2-px-semantic-contract.ts` 等运行时/历史子阶段文件。如需对历史子阶段做交叉验证，需在下一轮指令中扩大检索范围。

---

> **审计签名**: MiniMax-M3，2026-08-27，独立视角（与本轮修订者/内部审计者不同源）
> **后续行动**: 等待用户就 3 项 PX-1 启动条件补强做出指示；不主动修改任何文档、schema 或代码。