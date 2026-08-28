# V2-PX PX2 规格回退审计

日期：2026-08-28
结论：`STOP_REQUIRES_HUMAN_CONFIRMATION`
阶段状态：PX2 未通过；PX1 target contract 需要原子回退修订

## 停止原因

真实 API 垂直切片实施中发现冻结合同存在会制造假验收的字段类型冲突：

1. `V2_PX_API_RUNTIME_CONTRACT.md` 规定 `sourceRef` 形如 `op-artifact:<operationId>:<base64url(ref)>` 或 `review-evidence:<reviewId>:<base64url(ref)>`，并规定 `contextRefs` 可以携带 sourceRef/reviewId/operationId。
2. `v2-px-intent-route-v3.schema.json` 与 `v2-px-operation-command-v2.schema.json` 却把 `sourceRef`、`operationId`、`graphId`、`contextRefs[]` 全部绑定到 `^[a-z][a-z0-9_-]{2,80}$`。
3. 该正则拒绝带冒号的目标 sourceRef、可能以数字开头的真实 FAMS UUID，也拒绝部分 base64url 大小写字符。
4. 扩展运行时 validator 与 schema 使用同一错误约束；若继续实施，只能用人工构造的小写测试 ID 获得 green，真实来源/任务跳转会失败。

这属于用户规则中的“较大规格偏差和虚假验收风险”，因此停止，而不是通过放宽测试或改用 mock 绕过。

## 本轮已完成且未声明通过的工作

- External Brain Policy/Read/Ask/route 首轮代码已在工作树中形成，后端 TypeScript build 通过。
- 首轮真实数据库 API 验证已读取 205 个默认用户 Operation、28 个 DailyReviewRun，并完成 1 次真实 Chat Ask；业务 Operation/Review/Transaction 计数未因只读请求变化。
- 上述验证只证明 facade 能访问真实服务，不证明 DTO 已符合最终合同；其结果不得作为 PX2 出门证据。

## 同时发现的实现偏差

首轮 facade 返回了直接 DTO，并以 Operation/Review 为来源项；权威合同要求 common envelope，来源项必须是 `operation_artifact` / `daily_review_evidence`。这部分属于未验收的开发草稿，恢复后必须重做，不保留错误完成声明。

## 推荐的原子修订方案

若用户批准，按以下顺序回退并闭环：

1. 在两个 target schema 中拆分 `workspaceId`、真实 FAMS entity ID、opaque sourceRef 三类定义，不再复用单一 `$defs.id`。
2. sourceRef 保持运行时合同规定的 opaque 结构；对路径段继续使用 `encodeURIComponent`，后端解码后解析，UI 不解析业务正文。
3. `contextRefs[]` 使用联合约束，允许 sourceRef、reviewId、operationId；继续拒绝任意对象、question 外泄和 secret-like 字段。
4. 同步修改 runtime validator、四个 target fixtures、语义验证器和 PX1 单测；重跑 PX1 target contract、20 次 tab 复用、真实 Chrome 四视口，重新签发 PX1 acceptance commit/evidence。
5. PX1 重验通过后，重做 PX2 facade common envelope、artifact/evidence 来源映射、扩展 Adapter/五视图和真实 DOM 同源 E2E。

## 恢复开发前硬门槛

- 用户明确批准“重新打开 PX1 target contract 并按推荐方案原子修订”。
- schema、validator、fixtures、tests、Markdown 合同不得只改单点。
- PX1 重新验收无新增 fatal/major 后，才能恢复 PX2 实质开发。

## 自动化开发停止原因（机器可读）

```text
STOP_REASON=PX2_DISCOVERED_PX1_TARGET_IDENTIFIER_CONTRACT_CONFLICT
RISK=REAL_FAMS_SOURCE_REF_AND_UUID_REJECTED_WHILE_SYNTHETIC_FIXTURES_PASS
CURRENT_STAGE=PX2_NOT_ACCEPTED
REENTRY_STAGE=PX1_TARGET_CONTRACT
HUMAN_DECISION_REQUIRED=APPROVE_OR_REJECT_ATOMIC_CONTRACT_REOPEN
```
