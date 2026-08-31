# V2-PX PX6-01 全量自动验收开发计划

日期：2026-08-31

状态：`APPROVED_FOR_IMPLEMENTATION_AFTER_ENTRY_AUDIT`

## 1. 用户结果

自动化结束后生成一个可复核的 PX6-01 证据包和一个普通用户可逐项操作的中文 HTML。系统必须明确区分“自动化已通过”和“人类尚未验收”：G1～G7 可由自动化全绿，但 AC-PX-01～10 的人工状态初始全部为 `not_run`，`v2PxProductizationCandidate=false`，交易四锁继续为 false。

## 2. 实现实体与顺序

1. 新增 `docs/schemas/v2-px-acceptance-manifest-v2.schema.json`：冻结 authority、branch/commit、7 个唯一 gate、20 个唯一 requirement、逐阶段 commit/evidence、真实命令/exit code、artifact hash、人工状态引用和四锁；保留 `/1` baseline 文件不改写。
2. 新增 `docs/schemas/v2-px-acceptance-report-v2.schema.json`：冻结 AC-PX-01～10、automated/human 双状态、known blockers、allowed/must-not claims、外部审计结论和 candidate=false 条件。
3. 新增四个 fixture：manifest/report `/2` 各一正一负；同步扩展 contract tests 和 backend semantic validator。负例至少覆盖 gate 重复/缺失、20 requirements 不唯一、hash/commit 不匹配、human not_run 却 candidate=true、交易锁变 true、缺截图/步骤和伪造 all-pass。
4. 新增 `scripts/verify-accessibility-chrome.mjs`：真实 Chrome、真实 FAMS SQLite backup 和 4000 服务，覆盖 360/420 Side Panel、768/1280 Workspace 的键盘焦点、可见名称、关键点击区、根溢出、正文/控件对比度和 console/network 错误。
5. 实现 `scripts/verify-acceptance.mjs`：在精确提交、V2-PX 范围 clean 条件下执行真实命令并记录 exit code；聚合既有 PX1～PX5 正式证据和本提交重跑证据，验证文件存在、非空、SHA-256、commit/stage/schema/状态一致。
6. collector 生成 `.verification/private/v2-px/<sha>/PX6-01/` 下的 `stage-manifest.json`、`v2_px_acceptance_manifest.json`、`v2_px_acceptance_report.json`、`g1_g7_gate_audit.json`、`requirement_coverage.json`、`ac_px_01_10.json`、`accessibility_audit.json` 和原始 command log。
7. collector 生成 `docs/generated/v2-px-human-acceptance.html`：十个场景均含前置条件、具体操作、可见门槛、通过/失败选择、截图选择与预览、备注、本地保存和 JSON 导出；默认全部 `not_run`，不生成虚构 reviewer，也不自动写“通过”。
8. package script 增加 `verify:accessibility-chrome`，补齐既有 `verify:acceptance` 的真实实现；不修改 FAMS 业务 API、投资计算、runtime 功能或交易能力。

## 3. G1～G7 真实命令

| Gate | 自动命令与证据 |
| --- | --- |
| G1 authority | Git branch/commit/clean-scope + authority baseline/current-stage/PRD 交叉断言 |
| G2 contracts | extension `typecheck`、`test:contracts` + backend `test:v2-px-semantic-contract` |
| G3 entry/router | extension `test:router` + `verify:router-idempotency-chrome` |
| G4 Workspace/API | backend `test:v2-px-api-contract` + extension `test:workspace`、`verify:workspace-chrome` |
| G5 Side Panel/Host | extension `test:sidepanel`、`verify:sidepanel-chrome`；复核 PX4B 正式 Host evidence/hash |
| G6 lifecycle | extension `test:lifecycle`、`verify:lifecycle-recovery-chrome`、`verify:lifecycle-interruption-chrome` |
| G7 anti-false-green | target `/2` 正负 fixture、20/20、AC01～10 初始人工状态、artifact/commit/hash、accessibility、声明边界 |

## 4. 不变项

- 私有浏览器 profile、数据库 snapshot 和原始 trace 只在 `.verification/private`；HTML 不嵌入账户原图、cookie、token 或问题/回答原文。
- 自动化只可声明 `automatedAcceptanceStatus=passed` 与 `readyForHumanAcceptance=true`；不得声明 human passed、candidate、商店发布、正式交易或生产身份完成。
- 正式 permission 弹窗点击与人类对十项体验的判断留 PX6-02；自动化验收使用可审计的临时 pregrant manifest，production manifest 仍保持 optional host permission。
