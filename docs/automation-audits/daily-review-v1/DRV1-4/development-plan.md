# DRV1-4 开发与验收计划：真实数据全链封板

日期：2026-08-20  
状态：已完成

## 目标

在不使用 mock/fixture 行情的前提下，触发且仅触发一次 `default` 账户真实每日复盘，校验数据库写入边界、行情与均线数学、十节点 API、正式页面全路线和交易隔离，并更新 PRD/追踪矩阵/状态源。

## 执行顺序

1. 使用 SQLite online backup 保存验收前数据库，并记录 Position、Transaction、ExternalOrderObservation 的行数和内容哈希。
2. 通过正式 HTTP API 和唯一幂等键运行一次 manual/inline 复盘；记录 reviewId、operationId、开始/完成时间。
3. 对每个非现金持仓核对：成功或明确错误、真实 provider、30 个严格递增且唯一的交易日、收盘值、MA5/10/30 重算一致。
4. 核对事实变化、策略结论、关注项来源/理由/证据、网格计划和订单草案。
5. 核对真实写入仅发生于 Operation、DailyReviewRun、PositionSnapshot、MarketSnapshot、GridPlan、GridOrderDraft、AdviceInputSnapshot、Advice、Alert；三张受保护业务表零漂移。
6. 浏览器覆盖 1440/1024/768/390：十节点、节点审阅、资产切换、证据抽屉、历史、截图面板、JSON 导出和执行锁。
7. 执行相关回归、PRD 规格检视，更新权威状态源。人工验收保持 `not_performed`。

## 验收标准

- 6 个当前非现金持仓全部被计入，至少 1 个成功；失败必须有错误码，不能静默遗漏。
- 成功资产 provider 不含 mock/fixture/workflow_test；图表恰好 30 点，日期严格递增且唯一。
- 重算 MA5/10/30 后按服务合同保留 4 位小数，与报告末值精确一致。
- 关注项均有 source、reason、evidenceStatus、evidenceRefs。
- Position/Transaction/ExternalOrderObservation 验收前后行数与规范化内容哈希完全相同。
- 四项交易权限恒 false，无 BrokerOrder/订单创建副作用。
- 四档视口根页面无横向溢出，浏览器 console/page errors 为 0，关键交互全部成功。
- 所有相关自动化测试通过；失败则返回计划阶段修复并重验。

## 输出

- `.verification/daily-review-v1/DRV1-4/` 机器证据与截图（忽略提交）。
- `docs/automation-audits/daily-review-v1/DRV1-4/` 开发前、验收、PRD 检视和状态审计（提交）。
- `backend/data/gpt-audit/daily-portfolio-review-v1/` 运行时审计包（按仓库策略忽略）。
