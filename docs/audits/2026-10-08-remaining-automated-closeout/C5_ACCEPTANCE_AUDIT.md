# C5 全量自动验收审计

日期：2026-10-08

## 结论

```text
automatedScopeStatus=passed
fullPrdExitStatus=blocked
humanAcceptanceStatus=pending_batch_review
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
```

C1-C4 的性能、行情可靠性、LLM 运行态和 MCP OAuth resource-server 补强已纳入权威全系统 E2E。自动工程范围可以退出；完整 PRD 仍不得声明完成，因为集中人工验收、外部部署验证和正式交易 release 不属于自动化可代签范围。

## 权威证据

- 机器入口：`backend/data/gpt-audit/full-system-e2e/LATEST_RUN.json`
- HTML：由机器入口的 `reportPath` 定位
- JSON 总结：由机器入口的 `summaryPath` 定位
- 证据有效条件：`headCommit` 等于当前 HEAD，且 `workingTreeClean=true`

预收口通过样本为 `2026-10-08T12-49-21-949Z`，绑定 commit `f9ffdfad9d3419c208ecb826d83dbf3c00b1dec2`。最终提交后必须重跑并由 `LATEST_RUN.json` 覆盖为最终 commit 证据。

## 自动验收结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 文档一致性 | PASS | 当前状态源、PRD 和阶段合同一致 |
| 代码实体检视 | PASS | 页面、API、Service、Operation 和交易 gate 均有实现映射 |
| 自动命令 | PASS | 51 项中 50 项 exit 0；`trade action readiness` exit 1 为预期严格阻断 |
| API 交叉验证 | PASS | 11/11 通过 |
| Headless 浏览器 | PASS | 39/39 截图，桌面/平板/移动覆盖 |
| 浏览器运行态 | PASS | console/page error=0，HTTP 5xx=0 |
| SQLite | PASS | 真实 1.2GB 数据库 health=healthy |
| Operations 性能 | PASS | warm 读取低于 1.5 秒预算，完整详情保留 |
| 真实数据 | PASS_WITH_DISCLOSURE | Eastmoney 空响应被记录，使用本地 canonical 证据降级，未伪造实时成功 |
| LLM | PASS_WITH_DISCLOSURE | 配额失败显示 fallback/unavailable，不冒充真实 LLM 成功 |
| 视觉产品状态 | NEEDS_WORK | 截图足以审计布局；策略归属、曲线语义和最终视觉体验仍需人工确认 |

## 失败重规划闭环

1. Operations 完整 JSON 列表导致真实大库读取过慢：改为摘要投影并保留详情接口，增加读取索引和性能预算。
2. 每日复盘整页 Skeleton 导致桌面截图无法识别页面：改为页面 shell 常驻、局部 `aria-busy` 加载。
3. quote-list canonical 估值覆盖不足触发无界外部刷新：合并两份真实缓存，只读审计模式禁止联网刷新，并增加独立合同。
4. V2-PX sourceRef 负例随机修改错误 UUID 段：锚定第三段 version nibble，消除 1/16 测试波动。
5. E2E 服务器子进程清理不彻底：独立进程组，SIGTERM 后 3 秒 SIGKILL 兜底。

所有重规划均保留真实数据、负例、截图和交易阻断门槛，没有删除失败测试或降低阈值。

## 保留阻断

- 投资工作流 20 项中 19 项自动通过，最后 1 项为策略归属、截图纠正、曲线语义和移动体验集中人工确认。
- 每日复盘 30/30 工程实现完成，普通用户体验人工验收未执行。
- V2-PX 20/20 工程合同完成，PX6-02 真实 Chrome 人工体验 0/10。
- FTR provisional 链完成，8 类人工签核仍 pending，A7 final package 未生成。
- MCP 本地与 OAuth resource-server 代码通过，但公网 HTTPS、外部 IdP 和 ChatGPT 外部连接未验证。
- 生产订单适配器未启用，正式交易四项锁保持 false。

## 审计判断

本阶段自动化开发可以声明完成；完整 PRD、正式 release 和正式交易均不能声明完成。下一动作是集中人工验收，而不是继续由自动化代签。
