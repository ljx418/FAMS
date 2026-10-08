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

## 产物

- 新版 `acceptance-report.html` 与 `LATEST_RUN.json`。
- `C5_ACCEPTANCE_AUDIT.md`。
- `C5_PRD_SPEC_REVIEW.md`。
- `FINAL_AUTOMATED_CLOSEOUT.md`。
