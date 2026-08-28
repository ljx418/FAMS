# V2-PX SPEC_REENTRY 独立决策意见

> **决策者**: Claude (MiniMax-M3)，作为外部独立视角
> **决策时间**: 2026-08-28
> **决策对象**: Codex 团队提交的 PX2 → PX1 target contract 回退请求
> **基础**: SPEC_REENTRY_AUDIT.md（Codex 自审）+ 6 个 target schema + 4 个 target fixture + runtime contract §3

---

## 一句话结论

```text
verdict=CONDITIONAL_APPROVE_ATOMIC_REVISION
rubber_stamp=NO（不直接复读"批准按建议修订并继续"）
core_claim=PX1_target_id_regex_rejects_real_fams_data=CONFIRMED
synthetic_fixture_green_is_false_acceptance=CONFIRMED
recommendation=APPROVE with three additive conditions below
implementationApprovalStatus 在本意见形成时仍由用户决定；用户随后已明确批准实施修复
```

---

## 1. Codex 关键证据独立复核

> **检索声明**: 我对比了 `docs/V2_PX_API_RUNTIME_CONTRACT.md` 第 78 行、`docs/schemas/v2-px-intent-route-v3.schema.json` 第 48 行、`docs/schemas/v2-px-operation-command-v2.schema.json` 第 29 行，以及 4 个 target fixture 的 `routePayload` / `payload` 字段。

### 1.1 运行时合同定义的 sourceRef 格式

`docs/V2_PX_API_RUNTIME_CONTRACT.md:78`：
```text
sourceRef: op-artifact:<operationId>:<base64url(ref)>
         或 review-evidence:<reviewId>:<base64url(ref)>
```

关键字符特征：
- 包含冒号 `:`（两处）
- 第二段 `<operationId>` / `<reviewId>` 实际业务中是 UUID v4（hex + `-`），可能以数字开头（如 `123e4567-e89b-...`）
- 第三段是 RFC 4648 base64url，包含 `A-Z` / `a-z` / `0-9` / `-` / `_`，允许大写

### 1.2 intent-route-v3 schema 的 id 正则

`docs/schemas/v2-px-intent-route-v3.schema.json:48`：
```json
"id": { "type": "string", "pattern": "^[a-z][a-z0-9_-]{2,80}$" }
```

被绑定到 `id` 的字段：`workspaceId, sourceRef, operationId, graphId, focusNodeId, conversationId`。

正则冲突点：
- `[a-z]` 起首 → 拒绝 UUID v4 第一字符为数字的真实值（如 `123e4567-e89b-12d3-...`）
- `[a-z0-9_-]` → 拒绝 `:` 与大写字母 → 拒绝 `op-artifact:...`、拒绝 base64url 中的大写字符

### 1.3 operation-command-v2 schema 的 id 正则

`docs/schemas/v2-px-operation-command-v2.schema.json:29`：完全相同的 pattern `^[a-z][a-z0-9_-]{2,80}$`。

被绑定到 `id` 的字段：`workspaceId, sourceRef, contextRefs[] items, conversationId`。

同样的冲突。

### 1.4 Fixture 是否真实

读取的 4 个 target fixture：

| fixture | workspaceId / sourceRef / contextRefs 取值 | 是否真实 |
| --- | --- | --- |
| `intent-route-v3.positive.json` | `"workspaceId": "default_workspace"`, `"sourceRef": "source_example"` | 全部为人工小写测试串 |
| `intent-route-v3.negative.json` | `"workspaceId": "default_workspace"` + 携带非法 `question` 字段 | 测试非法 payload，未测试 ID 格式 |
| `operation-command-v2.positive.json` | `"workspaceId": "default_workspace"`, `"contextRefs": ["review_example"]` | 全部人工 |
| `operation-command-v2.negative.json` | 同上 | 测非法 permissionType，不是测 ID 格式 |

结论：**没有任何一个 target fixture 包含真实 FAMS UUID 或运行时合同 §3 规定的 sourceRef 结构。** 正例全部用人工构造的小写串，全部能通过当前 regex。负例只测了非法字段注入，没有测"真实 UUID 因首字符为数字被拒"或"真实 sourceRef 因含冒号被拒"。

---

## 2. Codex 团队的两个核心声明

### 2.1 STOP_REASON=PX2_DISCOVERED_PX1_TARGET_IDENTIFIER_CONTRACT_CONFLICT → **CONFIRMED**

证据：runtime contract §3 + target schema `id` 正则 + fixture 三方交叉对比，冲突真实存在。Codex 没有为了"继续通过"而放宽测试，是合规暂停。

### 2.2 RISK=REAL_FAMS_SOURCE_REF_AND_UUID_REJECTED_WHILE_SYNTHETIC_FIXTURES_PASS → **CONFIRMED**

证据：
- runtime contract §6.2 sourceList / sourceDetail 端点返回的 `sourceRef` 来自 Query Facade，格式 `op-artifact:...` 或 `review-evidence:...`，被 schema 直接拒绝。
- runtime contract §6.4 `contextRefs: string[]` 允许 sourceRef/reviewId/operationId，其中后两者是真实 FAMS UUID（可能数字开头），被 schema 直接拒绝。
- `verify-v2-px-semantic-contract.ts` + 4 个 fixture 都通过，并不证明 contract 接受真实数据，只证明它接受测试串。

**Codex 的诊断成立，停止符合"用户规则中的较大规格偏差和虚假验收风险"判断。**

---

## 3. 推荐方案是否可接受

> Codex 推荐方案（来自 SPEC_REENTRY_AUDIT.md §"推荐的原子修订方案"）：
> 1. 拆分 `$defs.id` 为 workspaceId / 真实 FAMS entity ID / opaque sourceRef 三类
> 2. sourceRef 保持 opaque；对路径段使用 `encodeURIComponent`，后端解码
> 3. `contextRefs[]` 用联合约束
> 4. 同步修改 validator、fixtures、语义验证器、PX1 单测
> 5. 重跑 PX1 合同、20 次 tab 复用、四视口真实 Chrome

### 3.1 方向上接受

- 拆分三类 ID 定义 → 正确做法
- opaque sourceRef + URL encode → 与 runtime contract §3 一致
- 同步修改 validator/fixtures/tests → 满足"原子迁移"原则

### 3.2 必须补充的三项硬约束（Codex 未显式列入）

| 编号 | 内容 | 理由 |
| --- | --- | --- |
| **COND-01** | 拆分后的格式先在运行时合同冻结，再原子更新 schema：workspace 只接受 `px-ws-<lowercase UUID v4>`；FAMS entity ID 只接受小写 RFC 4122 UUID v4；sourceRef 只接受合同 §3 的两种 prefix、UUID v4 与 canonical base64url 三段式 | 避免实现阶段再次选择错误正则；不允许模糊备选正则 |
| **COND-02** | 必须新增真实数据**正例**：数字起首的 FAMS UUID、真实 Operation artifactRef 编码成 sourceRef、真实 Review evidenceRef 编码成 sourceRef，以及包含 UUID/sourceRef 的 contextRefs。负例必须覆盖 malformed UUID、未知 prefix、非 canonical base64url、空/超长 ref 和字段注入 | 纠正原意见把合法真实值误称“负例”的错误，真正验证真实数据可通过且非法边界被拒绝 |
| **COND-03** | 必须新增 1 条正向 E2E：从真实 Prisma 读 Operation/Review → Query Facade 生成 sourceRef → 反向经过 schema 校验 → 通过；产出真实 sourceRef 的 SHA-256 evidence，记录到 `.verification/private/v2-px/<commit>/PX1/` | 把"运行时合同 §3 定义能被运行时使用"做成可复核事实 |

### 3.3 不应做的事

| 编号 | 内容 | 理由 |
| --- | --- | --- |
| **ANTI-01** | 不得为了"快速通过"把 sourceRef 正则放宽为接受任意字符串；必须保持 opaque 三段式以满足 UI 不解析业务正文 | §3 明确"opaque；UI 不解析业务内容"，放宽会让 secret / token / question 借此逃逸 |
| **ANTI-02** | 不得只改 schema 而不改 fixture / validator / runtime types / Markdown；违反"原子迁移"原则 | 会重蹈"current validator 通过 ≠ target runtime 通过"的覆辙 |
| **ANTI-03** | 不得借此机会扩大权限、放宽 host permission、改 route intent 名称 | 文档冻结过的范围不可借机扩张 |

---

## 4. 与之前独立审计的衔接

`docs/V2_PX_INDEPENDENT_AUDIT_REPORT.md`（2026-08-27）登记的 BLK-01 / BLK-02 / HR-01～HR-08 当时基于"target schema 是 PLANNED_NOT_IMPLEMENTED"的假设。该报告 §3 提到的"PX-REQ-010 / 011 / 020 的 schema 字段不闭合"已经被本次 PX-1/PX-2 实施暴露：

- **本 SPEC_REENTRY 发现 = 原 BLK 类风险的实施具象化**。原报告 §7.1 提出的"必须把 schema 字段定义草案列入 PX-1 启动条件"恰好对应今天的真实失败。
- **未登记的新风险**：`$defs.id` 单一正则被复用到 6 个语义不同的字段。这属于**架构层 risk**，不是字段层 risk，原审计未察觉，原因正是"文档阶段无法触达运行时 validator"。

后续应在新一轮独立审计（计划文档 §10 的人类核查清单）中追加一条：所有 schema 中单一 `$defs` 必须按语义拆分，禁止单一 pattern 跨多用途字段复用。

---

## 5. 仓库实际状态确认

> **检索声明**: 列出了仓库实际创建的文件，不依赖 Codex 自述。

| 路径 | 是否存在 | 备注 |
| --- | --- | --- |
| `backend/src/services/external-brain/externalBrainAskService.ts` | ✓ | PX2 facade 已建 |
| `backend/src/services/external-brain/externalBrainPolicyService.ts` | ✓ | 同上 |
| `backend/src/services/external-brain/externalBrainReadService.ts` | ✓ | 同上 |
| `backend/src/services/external-brain/externalBrainTypes.ts` | ✓ | 同上 |
| `backend/src/routes/externalBrain.ts` | ✓ | 同上 |
| `backend/scripts/verify-v2-px-api-contract.ts` | ✓ | 验证脚本 |
| `backend/scripts/verify-v2-px-semantic-contract.ts` | ✓ | 语义验证器 |
| `packages/fams-v2-px-extension/` | ✓ | WXT 包，含 `.output/chrome-mv3/manifest.json` |
| `docs/schemas/v2-px-intent-route-v3.schema.json` | ✓ | target v3 |
| `docs/schemas/v2-px-operation-command-v2.schema.json` | ✓ | target v2 |
| `docs/schemas/v2-px-dual-container-lifecycle-v3.schema.json` | ✓ | target v3 |
| `docs/schemas/v2-px-real-chrome-evidence-v2.schema.json` | ✓ | target v2 |
| `docs/prototypes/v2-px/fixtures/intent-route-v3.{positive,negative}.json` | ✓ | synthetic |
| `docs/prototypes/v2-px/fixtures/operation-command-v2.{positive,negative}.json` | ✓ | synthetic |
| `docs/prototypes/v2-px/fixtures/dual-container-lifecycle-v3.{positive,negative}.json` | ✓ | synthetic |
| `docs/prototypes/v2-px/fixtures/real-chrome-evidence-v2.{positive,negative}.json` | ✓ | synthetic |

确认事实：
1. 后端 facade / route / types 已建，TS 编译通过（Codex 自述属实）
2. extension package 已建，已产出 `.output/chrome-mv3/` 构建产物（Codex 自述属实）
3. 6 个 schema 文件齐全：4 个 target + 2 个 acceptance（acceptance 未触动，符合 runtime contract §10.1 PX-6 迁移计划）
4. 4 个 target fixture 齐全，但**全部是 synthetic**

---

## 6. 风险评估

| 风险 | 可能性 | 影响 | 当前状态 | 缓解 |
| --- | --- | --- | --- | --- |
| R-RENTRY-01 修订后再次因其他未察觉的 regex 失败 | 中 | 中 | 未发生 | 修订前先冻结三类 ID 正则到文档，避免开发者现场决策（COND-01） |
| R-RENTRY-02 修订中扩大 intent 名称 / permission 边界 | 中 | 高 | 未发生 | 列入 ANTI-03；新增 review gate |
| R-RENTRY-03 修订耗时导致错过窗口 | 低 | 低 | 未发生 | 仅 schema+fixture+validator+单测+E2E，约 1-2 天 |
| R-RENTRY-04 用户跳过本次修订直接要求 PX-2 出门 | 中 | 高 | 未发生 | 本意见 §3.2 列出硬约束；若用户绕过，本意见保留为审计 trail |
| R-RENTRY-05 历史真实数据从 Operation/Review 拉出的 sourceRef 仍被前端某处 regex 二次拦截 | 中 | 中 | 未排查 | 修订时必须 grep 全部 codebase 的 `^[a-z]` 与 `^[a-f0-9]{40}$` 类 pattern，确认是否还有遗留字段约束 |

---

## 7. 最终独立审计建议

```text
recommendation=APPROVE
rubber_stamp=NO
verbatim_to_user="已确认 Codex 报告的 STOP_REASON 真实、fixture 全部 synthetic、风险属'较大规格偏差和虚假验收风险'。
支持按 SPEC_REENTRY_AUDIT.md §推荐的原子修订方案回退 PX1 target contract，并补充三项硬约束
（COND-01 三类 ID 正则先冻结到文档；COND-02 新增真实数据正例与非法边界负例；COND-03 新增真实 Prisma→sourceRef→schema E2E）。
不得借机扩大权限、改名 route intent 或放宽 sourceRef opaque 三段式。
修订完成后必须重跑 PX1 contract、20 次 tab 复用、四视口真实 Chrome，重新签发 PX1 acceptance commit/evidence。
本意见本身不修改 implementationApprovalStatus；后续用户指令已经给出实施授权。"
```

---

## 8. 不替用户决定的事项

按 CLAUDE.md §"团队成员使用优先级"和"数据真实性要求"：

1. 本报告形成时不替代用户门禁；此后用户已明确要求实施修复，因此 `implementationApprovalStatus` 维持已批准的总体开发授权。
2. 合同重入期间 `px1TargetContractsImplemented=false`、`px2PlusAllowed=false`；只有 PX1 重签验收通过后才能重新开启 PX2+。
3. 历史 Chrome 证据只证明 Extension shell 可运行，不再证明当前 target contract 已通过。

---

> **审计签名**: MiniMax-M3，2026-08-28，独立视角（与 Codex 团队修订/自审不同源）
> **后续状态补记**: 用户已批准实施；当前按 PX1 target contract 原子重入执行，PX1 重签前禁止进入 PX2+。
