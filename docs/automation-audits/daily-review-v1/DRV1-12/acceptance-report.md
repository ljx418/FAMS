# DRV1-12 最终端到端验收报告

日期：2026-08-25（Asia/Shanghai）

## 结论

结论：**PASS_WITH_ENVIRONMENT_LIMITATION**。最终真实数据工作流、强制真实 LLM 门禁、持久化结果、执行隔离和宿主 Chrome 页面均通过；WSL 内 Playwright 因缺少系统浏览器依赖未执行多视口截图，未伪装为通过。人类验收状态为 `not_performed`。

## 最终验收对象

- DailyReviewRun：`78aa3f91-5594-4ea7-9533-4a570ecb723a`
- Operation：`44c53f6d-0ef3-48e3-a3c1-9cacbe62af86`
- 运行时间：2026-08-25 18:10:56 至 18:12:17
- 页面：`http://localhost:3100/daily-reviews/78aa3f91-5594-4ea7-9533-4a570ecb723a`
- 真实截图台账：`d57b82e4-5dcb-4068-96ad-64488fc21ba0`

## 真实行情与均线核验

六项非现金持仓均取自 `sina`，每项恰好展示 2026-07-15 至 2026-08-25 的 30 个唯一、升序、完整交易日收盘点。验收脚本从收盘点独立重算 MA5、MA10、MA30，与报告值完全一致。

| 标的 | 最新价 | MA5 | MA10 | MA30 | 技术锚 | 最终网格间距 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 601127 赛力斯 | 50.73 | 50.59 | 52.124 | 55.3977 | 52.124 | 2.2039% / 1.118 |
| 513770 港股互联网 | 0.352 | 0.3592 | 0.3625 | 0.3705 | 0.3625 | 1.8324% / 0.0065 |
| 159851 金科ETF | 0.613 | 0.6048 | 0.6175 | 0.6137 | 0.6175 | 2.1533% / 0.0132 |
| 600276 恒瑞医药 | 46.49 | 48.63 | 50.913 | 53.1803 | 50.913 | 2.9327% / 1.3634 |
| 000651 格力电器 | 41.62 | 41.41 | 40.737 | 40.6987 | 40.737 | 1.0709% / 0.4457 |
| 601318 中国平安 | 55.01 | 53.50 | 52.777 | 53.2447 | 52.777 | 1.1716% / 0.6445 |

技术锚仅用于可复算推导，不是收盘后的可下单价格。

## 真实 LLM 门禁

- `requireLlmSuccess=true`
- `llmGate.required=true`、`passed=true`
- `status=available`、`source=llm`、`model=MiniMax-M2.7`
- `attemptCount=1`、`failureCode=null`
- `transportNormalization=null`、`contentNormalizations=[]`
- 输出严格覆盖 601127、513770、159851、600276 四个重点标的，没有未知标的、未知证据或新增交易数字。
- 价格、均线、锚点、间距、数量和网格均由确定性代码计算；LLM 只负责可读关注摘要。

最终摘要为“四只标的维持观察，关注赛力斯和恒瑞医药重大变化”。确定性策略判断为 `needs_review`：赛力斯和恒瑞医药达到重大事实变化复核阈值，不能据此自动加仓。

## 网格与买回点

- 六项资产各持久化一份即时计划和一份条件买回计划，共 12 个 GridPlan。
- 运行发生在上海时间 15:00 后，12 个计划均为 `observe_only`，即时 GridOrderDraft 与条件 GridOrderDraft 均为 0。
- 601127、600276、159851、513770 均逐项显示最新价、上一轮比较及 `session_closed`；条件买回同时显示 `parent_sell_draft_unavailable`。
- 因此本轮不存在合法的“现在买点、卖点或卖出后买回点”。系统没有用观察锚、历史价格或过期价格冒充当日有效委托。
- 下一交易时段重新运行后，只有通过行情、事实、预算、整手、价格步长和父卖单门禁的档位才进入“现在可人工核对的买卖单”。

## 执行隔离与账户保护

- Position 共 7 项、Transaction 共 0 项、ExternalOrderObservation 共 0 项；真实 E2E 前后计数与哈希均不变。
- 截图账户摘要确认现金与六项证券；券商页眉与持仓明细的非零差异继续保留为 warning，没有反向修改明细。精确账户金额只保留在本地私有证据。
- `planDraftOnly=true`；`formalTradingUnlocked`、`autoTradeUnlocked`、`canCreateOrder`、`orderCreateAllowed` 均为 false。
- 没有连接券商，没有创建或提交真实订单。

## 自动化与页面验收

| 检查项 | 结果 |
| --- | --- |
| `backend npm run build` | PASS |
| `test:daily-review-v2-contract` | PASS |
| `test:daily-review-v3-grid-contract` | PASS |
| `test:daily-review-frontend-contract` | PASS |
| `test:daily-review-real-data-e2e`，强制真实 LLM | PASS |
| `frontend npm run build` | PASS，3730 modules transformed；仅既有大 chunk 告警 |
| 十节点 DAG | PASS，10 节点、17 边、拓扑无环 |
| 宿主 Chrome 真实页面 | PASS，1348×1038、80% 缩放；结论、四重点卡、双清单、推导、DAG、30 日走势图及 12 行台账可访问 |
| WSL Playwright 多视口 | BLOCKED，启动前缺 `libnspr4.so` / `libnss3.so` |

## 失败打回记录

强制模式曾分别拦截结构非法、流式空内容、DeepSeek 余额不足、供应商 token 上限、数值叙述越权和 JSON 语法非法。所有失败轮均保留独立审计文件或失败状态，未沿用为通过证据。首次内容通过轮存在中文歧义，也没有作为最终页面；修复后重新生成本报告对应的新 reviewId。

## 最终审计意见

未发现新增致命或重大规格偏差。自动功能验收通过；多视口浏览器自动化仍是环境限制，人工最终观感与投资决策确认仍由用户完成。
