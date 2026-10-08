# 剩余自动化开发收尾计划

日期：2026-10-08

## 1. 目标与边界

在不代替人工签核、不解锁正式交易的前提下，完成当前项目仍可由自动化闭环的工程收尾，并把所有人工体验、真实 Chrome permission、授权签核和最终 release 决策集中到最后一次人工审查。

始终保持：

```text
formalTradingUnlocked=false
autoTradeUnlocked=false
canCreateOrder=false
orderCreateAllowed=false
productionAdapterEnabled=false
```

## 2. 已有基础，不重复开发

- `MarketDataService` 已有多 provider 顺序、fallback、运行态 health 和熔断。
- `MarketDataFreshnessService` 已有 canonical 行情 freshness、coverage 和恢复动作。
- ChatBox 已有确定性 planner/summary 降级和交易工具白名单。
- MCP 已有官方 SDK、stdio、loopback Streamable HTTP、受保护 Portfolio HTTP、Bearer scope、Origin 白名单和限流。
- WF-0..WF-8、FTR-0..FTR-6 provisional 和 V2-PX 自动范围已经通过，不得重新画成待开发。

## 3. 子阶段顺序

### C0 远端与权威状态基线

- 确认本地分支、远端功能分支和工作树状态。
- 读取 `current-stage-state.json` 和 PRD 追踪矩阵。
- 输出准入审计；不得以历史 Markdown 覆盖唯一状态源。

验收：本地与远端功能分支 commit 一致，工作树干净，Fatal/Major=0。

### C1 关键读取性能预算

- 为关键只读 API 建立可复跑的真实账户性能基线与预算。
- 覆盖 readiness、持仓轮动、回测模板/历史、每日复盘列表等首屏读取，不把显式刷新、扫描或回测计算混入读取预算。
- 增加后端结构化性能快照，至少包含 count、p50、p95、max、预算和超限项。
- 优化实际超限的重复读取或串行请求，并保留数据完整性。

最低门槛：HTTP 5xx=0；warm read p95 <= 1500ms；单项 max <= 3000ms；返回结构与真实记录数量不因优化减少；交易副作用=0。

### C2 免费行情可靠性闭环

- 暴露不含密钥和账户金额的行情可靠性快照：provider 运行状态、fallback/circuit、canonical freshness、覆盖状态和恢复动作。
- 真实 provider 不可用时必须返回 `degraded/stale/blocked`，不得冒充实时成功。
- 本地 canonical 数据可以作为研究降级，但必须携带日期、provider、freshness 和限制。

最低门槛：至少一个真实持仓范围快照；失败分类、fallback、freshness 和恢复动作完整；无 mock 行情；四锁 false。

### C3 LLM 运行态可观测与降级

- 在静态“已配置”之外记录最近 planner/summary 的真实尝试、成功、失败分类、连续失败、降级模式和恢复状态。
- 对 401/402/429/timeout/provider error 做脱敏分类，不返回原始密钥或完整 provider 错误。
- ChatBox 技术状态折叠区展示“增强可用/降级”，普通用户主结果继续使用确定性业务证据。

最低门槛：真实或受控 provider 失败后运行态不再显示 available；确定性结果仍可用；密钥泄漏=0；交易工具不增加。

### C4 远程 MCP 发布准备

- 保留现有本地 token，不把它冒充 OAuth。
- 增加 OAuth protected-resource metadata、外部 issuer/JWKS JWT access token 校验和 scope/user 映射。
- 增加 HTTPS public base URL、issuer、audience、Origin、rate limit 和默认关闭的发布前置检查。
- 没有真实 HTTPS/OAuth 部署时，只能声明 code-ready/preflight-ready，不能声明 public release ready。

最低门槛：metadata 合同通过；合法 JWT 可调用只读工具；错误 issuer/audience/scope/token 被拒绝；本地 token 兼容；明文公网 URL 和缺配置时 preflight 失败；交易工具仍不暴露。

### C5 全量自动验收与集中人工入口

- 运行 TypeScript、前端构建、C1-C4 专项合同、现有核心合同和全量 Headless E2E。
- 生成自动验收审计、PRD 规格复核、HTML 报告和集中人工待办清单。
- 自动化在人工门前停止，不生成 A7 final 包，不改变人工状态。

## 4. 集中人工审查范围

全部自动开发完成后，一次性执行：

1. 投资工作流策略归属、截图纠正、曲线语义和移动端体验。
2. 每日复盘普通用户体验。
3. V2-PX PX6-02 十项真实 Chrome 体验和 permission。
4. A6 八类授权签核。
5. A6 全通过后才允许 A7 按原 artifact 哈希生成最终评审包。

## 5. 打回规则

- C1 超预算：回到慢路径分析，不降低预算或删数据。
- C2 把 stale/fallback 写成 fresh：重大规格偏差，停止后续阶段。
- C3 把 deterministic fallback 写成 LLM 成功：重大假绿，停止后续阶段。
- C4 未验证 OAuth/HTTPS 却声明公网发布：重大安全偏差，停止后续阶段。
- 任一阶段改变账户事实或交易锁：立即停止。
