# S2 Wave D 失败与重规划

日期：2026-09-12

## Headless 前端运行态 CORS 失败

```text
command=npm run test:portfolio-backtest-frontend-runtime
result=FAIL
screenshotChecks=PASS_2_OF_2
runtimeConsoleErrors=4
failureCategory=local_frontend_origin_not_allowlisted
```

Headless 浏览器从 `http://127.0.0.1:3100` 加载前端，前端通知请求访问 `http://localhost:4000`。后端只允许 3000 端口的本地 Web origin，导致 unread alerts 请求被浏览器 CORS 拒绝。页面主体和回测交互虽然可见，但存在运行态错误，不能验收为通过。

## 修复与安全边界

1. 全局 CORS 本地受信列表增加 `localhost:3100` 和 `127.0.0.1:3100`。
2. External Brain 身份校验不复用 Web origin 白名单；3100 Web 页面仍不能冒充扩展调用者。
3. 安全合同新增正向 CORS 和反向扩展身份断言。
4. 重启后端并重新执行完整 Headless 路径；控制台错误必须为零。

```text
replanDecision=APPROVED_FOR_RETRY
formalTradingUnlocked=false
autoTradeUnlocked=false
```

## 第二次 Headless 失败：废弃通知 API

```text
corsErrors=0
screenshotChecks=PASS_2_OF_2
runtimeConsoleErrors=1
failureCategory=deprecated_antd_notification_api
```

CORS 修复复验生效，剩余错误来自 Ant Design Notification 已废弃的 `btn` 属性。修复为当前 `actions` 属性，不在测试层过滤 console error；修复后必须再次执行完整页面交互与历史运行下钻。

## 全系统 E2E 编排器超时清理失败

```text
command=npm run run:full-system-e2e-acceptance
result=INTERRUPTED_AFTER_TIMEOUT_CLEANUP_FAILURE
businessAssertionFailure=false
failureCategory=orphaned_child_process_after_timeout
```

SQLite 健康子命令超过配置时限后，编排器只终止 npm 父进程，实际 Node 子进程继续存活，主流程无法收到 close 事件。已人工终止本轮测试进程组；没有终止其他终端或项目进程。

修复为非 Windows 环境使用独立进程组，超时先向整个组发送 `SIGTERM`，三秒后仍存活再发送 `SIGKILL`。复验使用单命令并发，避免健康检查与其他 SQLite 密集测试互相争用；任何超时仍应生成 failed 结果而非挂死。

## 完整 SQLite 检查超时合同不足

低并发复验确认当前约 833MB SQLite 数据库完整检查结果为 `healthy`，但实际耗时超过原全系统 180 秒上限和红利低波审计包内部 120 秒上限。原编排因此先终止健康命令，再由审计包报告子进程 signal 143。

修复后：

- 独立健康命令上限为 360 秒；
- 红利低波审计包外层上限为 480 秒；
- 审计包内部完整健康检查上限为 360 秒；
- runtime disclosure 将命令 failed/not_run 视为数据风险，不再仅凭缺失 JSON 默认为 `ok`。

独立复验结果为 `healthy`；审计包生成 42 个文件，`candidateSource=latest_persisted`，未使用 fixture fallback。

## 浏览器定位与 provider 环境漂移

第一轮全系统复验发现浏览器脚本仍匹配历史按钮文案 `运行组合回测`，并把条件渲染的 `草案 Gate` 当成固定首屏文本。修订后定位现行 `运行并保存固定规则回测`，红利低波则验证稳定存在的“生成观察草案”入口和“不会生成正式买入、卖出或自动交易动作”边界；没有删除草案 Gate 业务断言。

随后一次复验人为强制 `FAMS_LLM_PROVIDER=minimax`，但现行配置合同明确 MiniMax 不属于 ChatBox planner 支持集合，导致 planner 测试正确失败。默认 DeepSeek 配置下独立合同和全量编排均通过；DeepSeek 摘要余额不足时保留工具结果并显式使用 deterministic summary，不冒充 LLM 摘要成功。DailyReview 的严格真实 LLM 证据仍由 MiniMax 独立全账户测试提供。

## 最终复验

```text
fullSystemE2eStatus=passed
fullSystemReport=backend/data/gpt-audit/full-system-e2e/2026-09-11T16-58-08-430Z/acceptance-report.html
commandMatrix=17_of_17_stage_expectations_passed
apiChecks=7_of_7_passed
browserScreenshots=24
browserConsoleErrors=0
sqliteHealth=healthy
dividendAuditCandidateSource=latest_persisted
formalTradingUnlocked=false
autoTradeUnlocked=false
```
