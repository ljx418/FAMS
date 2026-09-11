# S2 真实数据全量回归退出验收

日期：2026-09-12

## 结论

```text
stageId=S2
automatedAcceptanceStatus=PASS
realDataAcceptanceStatus=PASS
prdCoverageStatus=PASS
browserAcceptanceStatus=PASS
falseGreenRiskStatus=CLOSED_FOR_S2
humanProductAcceptanceStatus=NOT_PERFORMED
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
exitDecision=PASS_FOR_NEXT_HIGH_RISK_GATE
```

S2 的自动化范围已经完成。该结论只证明当前研究、复盘、回测、ChatBox、持久化审计和交易阻断路径在本轮真实数据上通过，不代表正式交易发布，也不替代 V2-PX 产品体验人工验收。

## 真实数据证据

| 路径 | 本轮结果 | 真实性与防伪断言 |
| --- | --- | --- |
| 当前行情新鲜度 | 提交前重验 active-strategy 范围共 300 个目标：46 个达到预期交易日、254 个延迟 1 个交易日，0 stale/unknown；范围最新交易日为 2026-09-11 | 新增 30 个无缓存目标使首次重验失败，定向真实刷新 30/30 后通过；未把基金净值混入股票 K 线门禁；未生成 mock 行情 |
| 全账户每日复盘 | 14/14 当前非现金持仓完成；10 节点、17 边；14 个 PositionSnapshot、14 个 MarketSnapshot、28 个 GridPlan | 每资产 30 个唯一升序真实收盘点；MA 独立重算；MiniMax-M2.7 严格 LLM 门禁通过；受保护表哈希不变 |
| 当前账户一键研究 | 最新已确认快照日期 2026-09-08，8 行精确对账；复盘覆盖 14 个资产，生成 6 个人工计划草案，持久化比较完成 | 公开输出不含金额、标的和内部 ID；复盘后再次声明变化但无新快照时正确阻断；受保护表计数不变 |
| 持久化组合研究 | 2023-09-11 至 2026-09-11，719 个共同交易日，10 个策略，252 日滚动窗口 | 压缩快照和 replay 哈希复验；并发幂等收敛；跨用户隔离；持仓和交易事实不变 |
| 相对轮动 | 三个基准研究目标全部存在，当前观察列表共四项；CN、HK、US canonical bars 按合同复算 | 允许用户新增观察项；33 根样本的目标明确 `insufficient`，未补造数据 |
| 组合长周期回测 | 1 年、3 年、5 年和自定义窗口覆盖六个可比较策略 | coverage 约 94%-96%；研究结果可重放；release gate 继续阻断 |
| ChatBox | 15/15 工具登记，覆盖率 100%；三年策略比较包含净值和回撤图；权限漂移与交易文案测试通过 | 未登记工具、交易动作、shell/filesystem/network 均阻断；LLM 摘要失败时显式 deterministic fallback |

## 全系统证据

权威本轮报告：

```text
backend/data/gpt-audit/full-system-e2e/2026-09-11T16-58-08-430Z/acceptance-report.html
backend/data/gpt-audit/full-system-e2e/2026-09-11T16-58-08-430Z/summary.json
```

- 17/17 命令满足阶段预期；`trade-action-readiness` 的非零退出是严格锁定预期，不是放行失败。
- 7/7 真实 API 检查通过。
- SQLite 状态 `healthy`。
- 红利低波审计包 42 个文件，来源 `latest_persisted`，未走 fixture fallback。
- 24 张 headless 截图通过，浏览器 console error 为 0。
- PRD 功能矩阵 10/10 通过。
- 浏览器实例和本轮专用 Vite 实例已清理。

## 失败、打回和修复

本轮没有隐藏失败。失败与重规划详见：

- `WAVE_A_FAILURE_AND_REPLAN.md`：提交前范围变化导致 30 个目标无 canonical bars，定向真实刷新后重验。
- `WAVE_B_FAILURE_AND_REPLAN.md`：固定持仓数、provider 余额、API 模式、旧快照、时间语义、LLM 数值/长度、字段所有权。
- `WAVE_C_FAILURE_AND_REPLAN.md`：轮动观察列表被错误建模为封闭集合。
- `WAVE_D_FAILURE_AND_REPLAN.md`：CORS、AntD 废弃 API、孤儿进程、SQLite 超时、旧页面文案和 provider 环境漂移。

所有修复均保持原业务门槛；没有删除真实数据、严格 LLM、保护表、交易隔离或浏览器 console 断言。

## 尚未完成的人工/外部门禁

1. 当前工作树包含本阶段尚待提交的改动和其他并发开发改动，因此 HTML 的“Git 工作树干净”人工审计项为失败；这不改变其自动化功能结果，但发布复核必须绑定后续提交。
2. `origin/main` 与本地提交不一致，现有 GitHub 凭据此前返回 403；推送仍需具备写权限的凭据。
3. V2-PX PX6-02 产品体验人工验收仍是 0/10。
4. 正式 provider、benchmark、formal validation、人工签核和生产 release gate 不在 S2 自动放行范围。

以上门禁不得被 S2 PASS 覆盖。
