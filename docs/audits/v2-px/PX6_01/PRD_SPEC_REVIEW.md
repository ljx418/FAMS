# V2-PX PX6-01 PRD 规格检视

日期：2026-08-31

结论：`PASS_AUTOMATED_SCOPE_COMPLETE_HUMAN_GATE_REMAINS`

## 1. PRD 覆盖结论

| PRD 目标 | PX6-01 结果 | 剩余边界 |
| --- | --- | --- |
| PX-REQ-001～020 | manifest 恰好 20 项、全部绑定 stage/commit/hash 证据；独立复核 93 个引用 | 人类只复核目标体验，不补造自动证据 |
| AC-PX-01～10 | 自动证据 10/10；每项具备前置、操作、量化门槛、证据和截图位 | 人类状态仍为 `not_run`，0/10 |
| G1～G7 | 7 项恰好且全 PASS；14 个实际命令均执行 | 不允许用“命令存在”代替本次执行证据 |
| 四视口与可访问性 | 360/420/768/1280；132/132 键盘可达；对比度/点击区/焦点/溢出/console/network 达标 | 人类检查视觉理解、遮挡与操作感受 |
| 生命周期和恢复 | 返回、前进、刷新、关闭重开、Chrome 重启、断连、worker suspend、update、unknown-major 均恢复或诚实阻断 | 人类判断状态文案是否易懂 |
| 防重复与安全 | 20 次路由/并发幂等、at-most-once、unknown_result、12 个防假绿突变；交易请求和 Transaction 差分 0 | 不开放正式交易或自动交易 |

## 2. 规格偏移审计

- 没有新增生产权限、origin、远程依赖、业务 API、投资计算、订单入口或交易写入。
- headless 验收使用 IPv6 `::1` 隔离已有 IPv4 3000/4000 服务；production manifest/origin 仍是冻结的 localhost/127.0.0.1:4000。
- 人类 HTML 默认十项均 `not_run`；自动 smoke 只验证选择失败、截图预览、reload 持久化和 JSON 导出，不生成 reviewer 或人类 PASS。
- acceptance `/2` 将自动状态、人类状态、candidate 与交易四锁分离；人类未通过时 candidate 必为 false。
- 相比 PRD、目标架构和 LC-A，没有致命或重大规格偏移。

## 3. 剩余开发与验收边界

当前已被文档完整支撑的自动开发计划全部完成。剩余 PX6-02 是人类高风险/最终体验门槛：用户在真实 Chrome 中完成首次 permission 点击，并按 HTML 对 AC-PX-01～10 逐项选择通过或失败、附截图、导出 JSON。若任一项失败，再以该真实结果制定定向修复计划；在此之前不得继续新增自动化产品范围或声明 candidate。
