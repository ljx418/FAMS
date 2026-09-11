# 子阶段3：统计证据与前向影子验收

日期：2026-08-28
结论：统计状态机和前向时钟通过；当前真实证据正确判定为 `data_insufficient`

## 自动化验收

- `npm run test:overnight-evidence-statistics`：通过。
  - 固定种子的交易日分块Bootstrap重复运行完全一致。
  - 75个参数变体的Reality Check等价校正可计算。
  - `effective / ineffective / inconclusive / data_insufficient` 四条确定性路径均通过，且只有 `effective` 可得到 `promoted`。
- `npm run test:overnight-forward-shadow`：通过。
  - 30笔、3个月、成交率/滑点/缺口/置信区间门槛通过后只把“前向门禁”标成通过，不创建订单。
  - 同版本启动幂等复用；参数版本变化会把旧运行标成 `restarted` 并从零计时。
  - 首轮验收发现补录时错误使用服务器当前时间导致过早封存，修复为随观察事件时间推进后复测通过。
- `npm run test:overnight-strategy-backtest-real-data`：通过。
  - 本地真实2只样本5分钟覆盖0.1332%、股本0%、1分钟0根，结论为 `data_insufficient`。
  - 旧版单信号滚动结果已降为研究参考，不再拥有晋级权。
- `npm run test:overnight-strategy-api-e2e` 与 `npm run build`：通过。

## PRD规格检视

| 规格 | 结果 |
|---|---|
| 四态结论互斥 | 通过 |
| 300笔/24个月及全部交易决策级门槛 | 通过 |
| 预注册哈希、冻结区间与不可晋级边界 | 通过 |
| 规则/参数变化重启前向计时 | 通过 |
| 真实数据不足不评价策略有效/无效 | 通过 |
| 四个真实交易能力字段保持false | 通过 |

## 审计结论

未出现虚假收益验收。当前软件能力通过，但真实数据只足以检验拒绝路径；不构成策略有效或无效的证据。前向通过条件已在观察起始日前补充冻结。无新增致命或重大规格偏差，可进入API与前端证据工作台子阶段。
