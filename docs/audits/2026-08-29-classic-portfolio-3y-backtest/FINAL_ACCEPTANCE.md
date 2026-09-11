# 中国版经典组合三年回测最终验收

- 日期：2026-08-29
- 结论：全部已文档支撑的开发计划已顺序实现，最终验收通过
- 自动化开发停止原因：计划完成，无剩余致命或重大审计意见

## 交付范围

1. 五个中国大陆普通证券账户可交易的经典组合模板及代码/权重。
2. 六种调仓情景、显式现金账本、次日开盘、100份整数手、最低佣金、滑点和现金1%模型。
3. 官方分红登记与发放日再投资、真实三年数据核验、后12个月验证和频率偏好。
4. API 审计产物与策略回测页的净值图、情景矩阵、下一检查日和完整流水。
5. 保留研究/正式交易隔离；未创建订单、未写入持仓、未调用券商。

## 最终验证矩阵

| 命令/证据 | 结果 |
| --- | --- |
| `npm run build`（backend） | 通过 |
| `npm run build`（frontend） | 通过 |
| `npm run test:classic-portfolio-scenario-engine` | 通过 |
| `npm run run:classic-portfolio-three-year-study` | 通过，727日、7标的、5×6情景 |
| `npm run test:portfolio-strategy-backtest` | 通过 |
| `npm run test:portfolio-backtest-api-contract` | 通过 |
| `npm run test:portfolio-backtest-frontend-runtime` | 通过，控制台0错误 |
| `git diff --check` | 通过 |

## 证据位置

- 真实三年研究结果：`backend/data/gpt-audit/classic-portfolio-three-year-study/latest-study.json`
- 浏览器审计：`backend/data/gpt-audit/interactive-strategy-backtest/2026-08-29T15-16-35-753Z/03_frontend_runtime_and_operation_audit.json`
- 入口截图：`backend/data/gpt-audit/interactive-strategy-backtest/2026-08-29T15-16-35-753Z/screenshots/01-backtest-entry.png`
- 结果截图：`backend/data/gpt-audit/interactive-strategy-backtest/2026-08-29T15-16-35-753Z/screenshots/02-backtest-result.png`

## 最终审计意见

- 无新增致命或重大规格偏差。
- 非阻断风险：免费行情仍是研究级；官方分红静态登记只核验到2026-08-28；三年最优频率存在过拟合风险；研究响应体后续可分页减小。
- 下一次运行跨过2026-08-28时，必须先更新官方分红登记并重新通过数据真实性门禁。
