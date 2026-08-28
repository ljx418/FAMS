# V2-PX 多轮独立文档审计与覆盖度结论

更新时间：2026-08-27

## 1. 最终结论

本轮不能沿用上一版“20/20 即 100/100”的结论。20/20 只代表 PRD requirement 都被提到，不能证明 API、状态、权限、错误和阶段执行无需开发者自行猜测。

本轮从权威 PRD/架构重新开始，按四个相互独立的审计视角检查。修订前结论为：`结构追踪 PASS，实施决策完整性 FAIL（23/40）`。内部修订后 40 个实现关键决策已有唯一落点；随后独立审计给出 `CONDITIONAL_PASS`，登记 BLK-01～03、HR-01～08 与三项 Draw.io 补强。本版已把这些意见写回目标合同、计划、ADR、状态源和图纸，当前结论是“定向修订完成，等待独立复审”，不是把原 CONDITIONAL_PASS 自动改成外部 PASS。

```text
structuralRequirementTraceability=20/20 PASS
decisionCompletenessBeforeThisAudit=23/40 FAIL
decisionCompletenessAfterRepair=40/40 PASS
knownBlockingCrossDocumentConflictsAfterRepair=0
documentationSupportsControlledPx1ToPx6=true
documentationSupportsUnattendedGatePromotion=false
runtimeImplementationProgress=0/20
realChromeEvidencePresent=false
implementationApprovalStatus=APPROVED_FOR_PX1_THROUGH_PX6_SEQUENTIAL_AUTOMATION_2026_08_28
externalIndependentAuditRecommended=true
externalIndependentAuditResult=CONDITIONAL_PASS
externalAuditRemediationStatus=APPLIED_PENDING_REAUDIT
```

“完整支撑”不等于路线已被 Chrome 事实证明可行。WXT/Chrome、optional permission/CORS 和五类 read model 的真实兼容性是 PX-1/PX-2 必须实测的架构风险，不是可以靠文档宣称通过的事项。

## 2. 独立审计方法

这里的“独立”指每一轮从不同验收目标重新阅读一手文档并重新列问题，不复用上一轮的通过结论；不是要求用户配置评审人员或组织角色。

| 轮次 | 审计视角 | 从零读取的主要对象 | 核心问题 |
| --- | --- | --- | --- |
| A | 产品与用户体验 | PRD、原型、用户场景 | 用户能否知道入口、结果、状态、下一步和非目标？ |
| B | 软件架构与实现决策 | ADR、目标架构、现有 routes/services/schema | 开发者是否仍需自行决定 API、消息、状态、权限或数据所有权？ |
| C | Reality Check / 反伪完成 | 计划、Gates、证据 schema、命令、当前 Git 事实 | 是否可能用计划命令、mock、空壳、错误状态或错误端口获得假绿？ |
| D | 修订后交叉一致性 | 所有权威文档、draw.io、current-stage-state | 相同概念是否只有一个口径，状态与当前代码事实是否一致？ |

使用的 40 项决策检查：产品/范围 8 项、入口与消息 7 项、API/read model 8 项、状态/恢复 7 项、权限/安全 5 项、开发/验收 5 项。每项只有“存在唯一决定且有阶段/测试/失败处置”才计 1；“将来实现时再决定”不计分。

### 2.1 40 项可复核决策清单

| Check | 唯一决定 | 权威落点 | 状态 |
| --- | --- | --- | --- |
| DEC-P01 | 产品问题、目标用户和使用时刻 | PRD §2～4 | PASS |
| DEC-P02 | Side Panel 是轻入口，不承载大型图/DAG | PRD §5；原型 §3 | PASS |
| DEC-P03 | Workspace 是五视图完整宿主 | PRD §5；原型 §4～5 | PASS |
| DEC-P04 | Host 查看来源可靠进入 Workspace | PRD §5；运行时合同 §4.2 | PASS |
| DEC-P05 | Ask 导航、ack、最终回答分别定义 | 原型 §3/5；运行时合同 §4/6 | PASS |
| DEC-P06 | 未连接/加载/空/失败/恢复/阻断六状态 | 原型 §6；计划 AC-PX-08 | PASS |
| DEC-P07 | 360/420/768/1280 与可访问性阈值 | PRD PX-REQ-011/019；原型 §8 | PASS |
| DEC-P08 | 非目标、研究边界和交易四锁 | PRD §10～11；运行时合同 §7 | PASS |
| DEC-M01 | workspace/route/correlation/command/idempotency/source 标识规则 | 运行时合同 §3 | PASS |
| DEC-M02 | canonical URL 与标签页身份规则 | 运行时合同 §3；ADR 打开/复用 | PASS |
| DEC-M03 | runtime message envelope 与处理顺序 | 运行时合同 §4.1 | PASS |
| DEC-M04 | 3×3 入口动作与目标容器矩阵 | 运行时合同 §4.2 | PASS |
| DEC-M05 | 五 intent route payload 严格字段 | 运行时合同 §4.2 | PASS |
| DEC-M06 | query/refresh/ingest command 语义与权限 | 运行时合同 §4.3 | PASS |
| DEC-M07 | CommandResult 状态、resultRef 与错误 | 运行时合同 §4.4/8 | PASS |
| DEC-A01 | API base、本地 default user、统一 response envelope | 运行时合同 §6.1 | PASS |
| DEC-A02 | Sources list 过滤、分页、排序与 empty | 运行时合同 §6.2 GET sources | PASS |
| DEC-A03 | Source detail 字段与失效来源行为 | 运行时合同 §6.2 GET source | PASS |
| DEC-A04 | Ask request/response、Read/Ask policy、200/202 | 运行时合同 §6.2 POST ask | PASS |
| DEC-A05 | Trace 的脱敏展示字段 | 运行时合同 §6.2 GET traces | PASS |
| DEC-A06 | Graph scope、nodes/edges 和现有服务映射 | 运行时合同 §6.2 GET graphs | PASS |
| DEC-A07 | 五 intent 到现有 Chat/Review/Operation/workflow 的所有权 | PRD §8；目标架构 §4.4 | PASS |
| DEC-A08 | health/GET/POST/Operation 的 timeout/retry/polling | 运行时合同 §6.3 | PASS |
| DEC-S01 | WorkspaceState v1 字段与 aggregate lifecycle status | 运行时合同 §5.1 | PASS |
| DEC-S02 | Background 状态和网络单写者 | 目标架构 §6；运行时合同 §4 | PASS |
| DEC-S03 | session 内容、20 workspace、1000 events | 运行时合同 §5.2 | PASS |
| DEC-S04 | local recovery index 20 条/30 天 | 运行时合同 §5.2 | PASS |
| DEC-S05 | dispatch ledger 500 条/24 小时、写入/回读顺序与副作用前后 storage 失败分流 | 运行时合同 §5.2～5.3 | PASS |
| DEC-S06 | lifecycle/3 封闭 eventType、用户/实现状态映射、5 秒恢复与 35 秒 Ask 口径 | 运行时合同 §5.4/6.3；目标架构 §6 | PASS |
| DEC-S07 | 已知版本显式迁移、未知 major blocked | 运行时合同 §5.4 | PASS |
| DEC-X01 | required/optional host/external connect/CSP 清单 | 运行时合同 §7.1 | PASS |
| DEC-X02 | Host bridge extension ID、sender、payload 与 fallback | 运行时合同 §7.2 | PASS |
| DEC-X03 | Backend extension origin allowlist、local identity 与全局 CORS 收紧顺序 | 运行时合同 §7.3 | PASS |
| DEC-X04 | secret/cookie/token/截图/问题的存储和证据禁区 | PRD §9～10；运行时合同 §5/7 | PASS |
| DEC-X05 | 禁止自动确认、订单请求=0、四锁 false | PRD PX-REQ-018；运行时合同 §6/7 | PASS |
| DEC-D01 | PX-1～PX-6 依赖、用户效果和停止规则 | 计划 §8～9/13 | PASS |
| DEC-D02 | backend/frontend/extension 计划命令归属 | 计划 §11；运行时合同 §9 | PASS |
| DEC-D03 | message/lifecycle/Chrome/acceptance target schema 分批迁移与八个 target fixture 文件 | 运行时合同 §10.1；计划 PX1/PX6 | PASS |
| DEC-D04 | AC-PX-01～10 的前置/操作/阈值/证据/失败归属，含 Ask 1 秒/35 秒双门槛 | 计划 §10；draw.io 第 8 页 | PASS |
| DEC-D05 | G1～G7、负例、stage manifest、外部/人工门禁 | 计划 §3～4/14；审计包 | PASS |

## 3. 修订前发现与关闭结果

| ID | 严重度 | 修订前问题 | 关闭方式 | 复审状态 |
| --- | --- | --- | --- | --- |
| AUD-GAP-01 | 阻断 | “只读聚合”与 Quick Ask 持久化 Chat/Operation 冲突 | 分为 Read Service 与 Ask Service，Ask 只允许 read/quick compute | CLOSED |
| AUD-GAP-02 | 阻断 | 当前 `intent-route/2` 强制所有 view_source→Side Panel，与原型冲突 | 冻结目标 v3 3×3 矩阵；Host/Workspace 均可靠进入 Workspace | CLOSED |
| AUD-GAP-03 | 阻断 | Ask route 同时代表进入页面和提交问题 | route 只导航；`operation-command/2 query` 才携带 question | CLOSED |
| AUD-GAP-04 | 高 | optional host permission 包含不需要的前端 3000 | 4000=optional host；3000=externally connect，仅发送 intent route | CLOSED |
| AUD-GAP-05 | 阻断 | 五个 API 只有 URL，无 DTO/分页/error/identity/policy | 新增 `V2_PX_API_RUNTIME_CONTRACT.md` | CLOSED |
| AUD-GAP-06 | 阻断 | WorkspaceState、TTL、LRU、迁移、未知版本无定义 | 冻结 state v1、20/30d、500/24h、unknown-major blocked | CLOSED |
| AUD-GAP-07 | 高 | 只在 session 去重无法覆盖 extension reload；POST 重试风险不明 | local dispatch ledger + at-most-once；POST dispatch 后 0 自动重试 | CLOSED |
| AUD-GAP-08 | 高 | Host extension ID、sender allowlist、缺扩展 fallback 不明确 | 冻结三个配置项、sender 校验和普通话降级 | CLOSED |
| AUD-GAP-09 | 高 | “5 秒恢复”和 LLM 完成时间可能被混淆 | 5 秒只约束状态可见；Ask 1 秒 ack，POST 35 秒且不自动重试 | CLOSED |
| AUD-GAP-10 | 高 | 计划命令默认在根目录运行，仓库事实不支持 | 命令按 backend/frontend/extension package 明确归属 | CLOSED |
| AUD-GAP-11 | 高 | PX-2 Workspace 先于数据合同，可能只验空壳却宣称可用 | PX-2 调整为 Bounded API + Workspace 垂直切片 | CLOSED |
| AUD-GAP-12 | 中 | 相同任务错误要求三入口 routeId 一致 | 冻结 workspace/canonical/correlation 一致；新动作 routeId 独立 | CLOSED |
| AUD-GAP-13 | 高 | current v2/v1 schema 与目标体验存在差异却被称为 ready | 明示历史基线；PX-1 必须原子迁移 schema/validator/fixtures/types | CLOSED |
| AUD-GAP-14 | 高 | current lifecycle/Chrome/acceptance schema 不足以单独证明四视口、网络、人工场景和 target 版本 | 冻结 lifecycle/3、Chrome evidence/2、acceptance manifest/report/2 的分批迁移 | CLOSED |
| AUD-GAP-15 | 中 | 没有给外部 ChatGPT 一个受控、小于 20 文件的审计入口 | 新增 `V2_PX_CHATGPT_AUDIT_PACKET.md`，固定 19 个文件 | CLOSED |

### 3.1 独立审计 CONDITIONAL_PASS 修订登记

| ID | 修订内容 | 权威落点 | 当前复审状态 |
| --- | --- | --- | --- |
| BLK-01 | target intent/3 不再继承 current `/2` 的全局 view_source→Side Panel；按三入口矩阵生成条件约束 | 运行时合同 §2/§4.2；plan PX1-02 | 文档 CLOSED，待 target 实现与外部复审 |
| BLK-02 | target intent ask 只允许 workspaceId/conversationId，question 仅属于 command/2 | 运行时合同 §4.2；validator plan §4 | 文档 CLOSED，待 target 实现与外部复审 |
| BLK-03 | 产品权威与架构路线分为 `productAuthorityStatus` / `routeAAdrStatus` | ADR、authority baseline、target architecture、状态源 | 文档 CLOSED，待外部复审 |
| HR-01 | evidence/2 恰好四视口，并补少项/重复/像素不符负例 | 运行时合同 §10.1；plan PX1-05；validator plan | 文档 CLOSED，待 PX-1 实现 |
| HR-02 | lifecycle/3 eventType 封闭集合与 state 字段分离 | 运行时合同 §5.4 | 文档 CLOSED，待 PX-1 实现 |
| HR-03 | Markdown 状态值显式服从 `current-stage-state.json` 的完整后缀格式 | 运行时合同 §1；状态源 | 文档 CLOSED |
| HR-04 | storage 失败按后端副作用前/后分流；结果后写失败为 unknown_result，禁止安全重试假象 | 运行时合同 §5.2/§5.3 | 文档 CLOSED，待 PX-4 故障注入 |
| HR-05 | `ackVisible<=1s`、`finalResultVisible<=35s`、`reconnectResultVisible<=5s` 分开计时 | 运行时合同 §6.3；AC-PX-02 | 文档 CLOSED，待 PX-2/3 验收 |
| HR-06 | 七个 UI 状态显式映射十个 lifecycle state；closed 不渲染活动 UI | 目标架构 §6 | 文档 CLOSED，待 UI/状态测试 |
| HR-07 | route pre-handler 测试通过后再收紧全局 CORS，保留切换证据与回退 | 运行时合同 §7.3；plan PX2-01 | 文档 CLOSED，待 PX-2 实施 |
| HR-08 | 四类 target contract 各固定 positive/negative fixture 文件 | 运行时合同 §10.1；plan PX1-02；validator plan §3 | 文档 CLOSED，待 PX-1 创建 |
| DRAWIO-01～03 | contract 失败回 ADR、storage 写入顺序、R3 修 facade/回合同路径 | draw.io 第 3/5/7 页与 summary | 文档 CLOSED，待人类查看 |

## 4. 第一轮：产品与用户体验审计

### 4.1 初审结论

`CONDITIONAL_FAIL`。Side Panel/Workspace 的信息层级、六状态和四视口基本明确，但以下用户行为不唯一：Host 查看来源落到哪里、进入 Ask 是否已经发送问题、ack 是否可以算最终回答、扩展缺失时看到什么。

### 4.2 修订后复审

`PASS_WITH_RUNTIME_EVIDENCE_PENDING`：

1. Host App 的查看来源固定进入/复用 Workspace 来源详情。
2. Intent Route 进入 Ask View；用户点击发送才产生 query command。
3. Side Panel 1 秒内显示 ack，最终摘要必须包含结论、依据、数据时间和下一步。
4. extension ID 未配置/扩展缺失/超时均显示普通话配置与恢复说明。
5. Side Panel 不承载大型图/DAG；Workspace 不得退化为跳转页。
6. AC-PX-01～10 均包含前置、操作、量化阈值、证据和失败归属。

运行时体验仍是 0% 实现，必须在真实 Chrome 人工核查，不能因本轮 PASS 把 UI 写成已完成。

## 5. 第二轮：架构与实现决策审计

### 5.1 初审结论

`FAIL`。目标实体名称较完整，但缺 API DTO、消息 envelope、route/command 分离、状态模型、幂等崩溃窗口、存储容量/迁移、CORS allowlist、错误 taxonomy。开发者至少需要代做 17 个关键产品/架构决定。

### 5.2 修订后复审

`PASS_FOR_CONTROLLED_IMPLEMENTATION`：

- PRD 决定体验，ADR 决定 Route A.1，运行时合同决定 API/message/state/security，目标架构决定实体/依赖，计划决定阶段/gate；冲突优先级已冻结。
- current `intent-route/2`、`operation-command/1` 与 target v3/v2 的差异被显式列为 PX1-02 原子迁移，不再隐藏冲突。
- External Brain API 的五端点、DTO、分页、统一 envelope、local `default` user、Read/Ask policy 与错误码已有唯一决定。
- Background 是状态/网络单写者；问题和业务结果不进入 extension 持久存储。
- 现有 `origin:true` 被正确标为当前事实而不是目标安全能力。

已知未验证风险全部有最早验证阶段和停止/回退条件，没有用“后续优化”替代关键架构决定。

## 6. 第三轮：Reality Check 与反伪完成审计

### 6.1 初审结论

`FAIL`。主要假绿路径包括：根目录计划命令实际不存在、空壳 M2 被描述成用户可用、mock URL/截图冒充 extension、同 key timeout 后自动重试、unknown result 被汇总成 success、将 3000 host permission 当成连接必需、把同一 correlation 错写成同一 routeId。

### 6.2 修订后复审

`PASS_WITH_HARD_GATES`：

- 未来命令都带 package 前缀；脚本与测试文件不存在时状态只能是 `PLANNED_NOT_IMPLEMENTED`。
- PX-2 是 API + Workspace 真实 read model 垂直切片，不接受纯 mock 外壳出门。
- at-most-once 明确 prepared/dispatched/completed/unknown；POST 自动重试=0。
- G7 增加合同版本漂移、unknown→success 和 3000 host permission 负例；current evidence schemas 不再冒充最终体验证明。
- 原始证据目录按 commit/stage 隔离，每个 artifact 需要 hash 和 stage manifest。
- PX-6 自动通过不替代 AC-PX-01～10 的人类体验结论。

## 7. 第四轮：修订后交叉一致性审计

| 检查 | 门槛 | 结果 |
| --- | --- | --- |
| PRD requirement | 唯一 PX-REQ-001～020 | PASS，20 项 |
| Requirement 追踪 | 实体、阶段、测试、证据、人类核查 | PASS，20/20 |
| 关键决策 | 40 项均有唯一口径、阶段和失败处置 | PASS，40/40 |
| Read/Ask 语义 | 所有权威文档均不再把 Ask 写成纯只读 | PASS |
| 入口动作 | Host/Workspace view_source 与 target v3 一致 | PASS |
| 权限 | optional host 仅 4000；3000 仅 external connect | PASS |
| 标识 | canonical/correlation 与 routeId 职责不混淆 | PASS |
| 存储/恢复 | session/local、TTL/LRU、迁移、unknown result 一致 | PASS |
| 计划命令 | backend/frontend/extension 归属明确且标为计划 | PASS |
| Evidence target | lifecycle/3、Chrome evidence/2、acceptance/2 的字段/迁移阶段唯一 | PASS，目标已冻结、代码未实现 |
| Draw.io | 8 页中文、目标实体/合同/阶段/验收均可见；第 3/5/7 页补失败/写入/回退路径 | PASS，待外部复审 |
| 当前状态 | 代码 0%、Chrome 0、PX-1 false、四交易锁 false | PASS |
| 本轮变更边界 | 无 frontend/src、backend/src、packages、schema/validator/fixture 变更 | PASS |

## 8. 覆盖度解释

| 指标 | 数值 | 能证明什么 | 不能证明什么 |
| --- | ---: | --- | --- |
| PRD 结构追踪 | 20/20 | 每项需求有实现和验收落点 | 代码已实现 |
| 实施决策完整性 | 40/40 | 关键选择不留给开发者猜测 | 浏览器/依赖真实可行 |
| 已知阻断文档冲突 | 0 | 当前审计没有发现未决冲突 | 外部审计不会发现新问题 |
| PX-1+ 实现 | 0/20 | 当前没有冒充开发进度 | 无 |
| 真实 Chrome evidence | 0 | 当前未冒充浏览器通过 | Route A 已技术验证 |

因此最终措辞必须是：`文档在批准范围内完整支撑受控 PX-1～PX-6 开发；实现与真实验收尚未开始`。不得简写成“V2-PX 100% 完成”。

## 9. 是否需要再次外部复审

结论：`有必要做一次定向复审；原独立审计已完成并给出 CONDITIONAL_PASS，本轮作者不能自行把修订结果升级为外部 PASS。`

理由：

1. 本轮修订者同时完成了意见映射和内部复核，仍存在同源偏差。
2. HR-04 的审计建议若把“后端结果已发生后的 storage 失败”也命名为 `failed_before_effect` 会造成错误安全重试；本版按副作用事实拆成两类，需要独立确认其正确性。
3. CORS 切换同时影响现有 FAMS Web 与 extension origin，需要复核是否仍有旁路或不可逆窗口。
4. Draw.io 的新增路径必须由人类实际打开确认可读，不能只依赖 XML 文本命中。

待 ChatGPT 审查的不是“代码是否完成”，而是：目标合同是否内部一致、开发顺序是否能关闭风险、验收是否能抓住假绿、draw.io 是否足以判断规格偏移与出门风险。具体问题和 19 个文件见 `docs/V2_PX_CHATGPT_AUDIT_PACKET.md`。

## 10. 当前门禁

```text
internalDocumentationAudit=PASS_AFTER_CONDITIONAL_PASS_REMEDIATION
externalIndependentAuditStatus=CONDITIONAL_PASS
externalAuditRemediationStatus=APPLIED_PENDING_REAUDIT
humanArchitectureReviewStatus=PENDING
implementationApprovalStatus=APPROVED_FOR_PX1_THROUGH_PX6_SEQUENTIAL_AUTOMATION_2026_08_28
px1FeasibilitySpikeAllowed=true
px2PlusAllowed=false
productionCodeChangedInThisPhase=false
```

外部审查若发现新的阻断级冲突，必须先回本文登记和关闭；外部审查通过也不会自动授权开发，仍需用户明确批准。
