# C5 全量自动验收与集中人工入口计划

日期：2026-10-08

## 目标

将 C1-C4 纳入权威全系统 E2E，重新构建前后端并以真实默认账户、Headless 浏览器和现有 FTR/V2-PX 合同复验。自动化只更新工程状态与集中人工待办，不生成 A7 final 包、不代签人工结果。

## 编排

1. 全量 E2E 命令清单增加行情可靠性、LLM 运行态和 MCP OAuth resource-server 合同。
2. 后端启动后执行关键读取性能预算。
3. API 证据增加 `/prices/reliability`、动态 `/llm/status` 和 MCP public-release readiness。
4. 保留已有 3 视口用户路径截图、console/HTTP 失败检查和真实数据报告。
5. 更新唯一状态源、PRD 完成矩阵和架构文档，只把 C1-C4 标记为自动通过。
6. 运行状态/文档一致性、TypeScript、前端 build、核心专项和完整 E2E。

## 出门条件

- C1-C4 专项全部通过。
- full-system E2E `automatedScopeStatus=passed`。
- full PRD 仍因人工批次为 blocked，而不是 automated failed。
- 投资工作流人工 1 项、DPR 人工体验、V2-PX 10 项、A6 8 类仍明确 pending。
- A7 未生成；四项交易锁 false；MCP 公网 release false。

## 首轮失败与重规划（2026-10-08）

首轮全量 E2E 诚实返回 `failed`，不得作为 C5 通过证据。失败包含：

1. 代码检视仍匹配已经被动态运行态取代的旧 LLM status helper。
2. Operations 列表一次读取 50 条完整 `resultJson` 和 task input/output；在 1.2GB 真实 SQLite 与浏览器并发下出现 80-130 秒读延迟。
3. 响应式截图矩阵在每日复盘首个超时后整体中止，无法区分单页失败和未执行页面。

重规划保持原门槛、不删除真实数据步骤：

- 列表 API 改为数据库字段投影的轻量摘要，详情继续使用 `/operations/:id` 完整读取；为 1.2GB SQLite 增加 `Operation(userId, requestedAt)` 非破坏性索引及幂等迁移。
- C1 增加 Operations 列表并同时限制冷启动 `<=10s`、warm p95 `<=1.5s`、warm max `<=3s`。
- 静态审计改为验证动态 `llmRuntimeStatusService` 与密钥脱敏链。
- 24 张响应式截图逐页记录通过/失败，单页失败不得阻止后续证据采集。
- 修复后必须重新完整运行 C1 与 full-system E2E；不得复用首轮失败报告宣布通过。

## 产物

- 新版 `acceptance-report.html` 与 `LATEST_RUN.json`。
- `C5_ACCEPTANCE_AUDIT.md`。
- `C5_PRD_SPEC_REVIEW.md`。
- `FINAL_AUTOMATED_CLOSEOUT.md`。
