# C1-T forward collector — dormant authorization request

This file is a request template, not an authorization and not an executable prompt.

## Exact requested authorization

> 批准 hash-pinned `C1T-FORWARD-COLLECTOR-L3` C0；允许 Codex 在
> `scripts/research-sandbox.sh` 隔离环境和专用 shadow DB 中，按合同 127 从公开、免费、无凭证
> 来源采集授权后首次打开的前瞻事实：BaoStock 的交易日历、CSI 300 PIT 成分、证券主数据、
> PIT 行业、未复权 OHLC/amount/preclose/tradestatus/isST；东方财富公开数据中心的 PIT 财务、
> 现金流、分红和公司行动；中证官网的 H00300/H20269 全收益身份与序列。先冻结发现分母和
> request tranches，再生成首个不可回填的事前预测并累计真实影子 session。允许一个 C0、最多
> 一个集中 R1、无 R2、无 formal candidate。继续禁止历史调参、hold-out 复用、生产数据库、
> 生产服务/scheduler、MCP、前端、券商、外部订单和资金。来源缺失或日期越界必须返回
> BLOCKED_DATA/BLOCKED_EXTERNAL，不得用旧值、fallback 或当前标签填补。

Authorization becomes effective only after the checkpoint pins the SHA-256 of contract 127, the
authorization receipt, activation record, exact dates, request tranches, owner and output root.

