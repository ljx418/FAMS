# V2-PX PX6-01 全量自动验收计划

日期：2026-08-31

## 1. 自动出门门槛

| 场景 | 操作 | 精确门槛 |
| --- | --- | --- |
| 合同迁移 | 编译 manifest/report `/2` schema，运行正负 fixture 与 consumer | 两个正例通过；全部负例失败；`/1` baseline 仍可读取；current/target metadata 更新一致 |
| G1～G7 | collector 执行计划中的实际命令 | gateId 恰为 G1～G7 且唯一；命令 exitCode 全 0；任一命令失败则整体 failed 且不生成 passed manifest |
| 20 requirements | 从追踪矩阵逐项聚合 PX-REQ-001～020 | 恰好 20 个唯一 ID；每项有 status、source stage、commit 和至少一个已验 hash 证据；缺一 hard fail |
| AC01～10 | 生成自动证据映射与人类清单 | 恰好 10 个唯一场景；自动证据可钻取；人工状态全部 `not_run`；步骤/门槛/截图槽/备注四要素齐全 |
| 当前真实 Chrome | 重跑四视口、Workspace、Side Panel、router、lifecycle、accessibility | Chrome 真实 extension URL/ID；360/420/768/1280；console/failed request/overflow=0；生命周期 5 秒门槛与轮询仍通过 |
| 隐私与交易 | 扫描 manifest、network、storage、HTML 和 JSON | secret-like=0；broker/order/Transaction 变更=0；四锁 false；HTML 不嵌原始私有图 |
| anti-false-green | 删除 artifact、改 hash/commit、重复 gate、缺 requirement、human 未验却 candidate=true | 每个负例必须失败并输出原因；不得以 Markdown 自述替代机器失败 |

## 2. 最终产物与声明

- 自动报告必须为 `automatedAcceptanceStatus=passed`、`humanAcceptanceStatus=not_performed`、`readyForHumanAcceptance=true`、`v2PxProductizationCandidate=false`。
- HTML 首屏必须直接告诉人类：“自动检查已完成；你的 10 项体验验收尚未开始；不会自动提交或解锁交易。”
- 所有证据路径和 SHA-256 必须能从 HTML/JSON 逐级定位；私有绝对路径不得写入提交的 HTML。

## 3. 失败回退

任一 schema、command、真实 Chrome、accessibility、hash、20/20、G1～G7 或声明边界失败，回到本计划修复并全量重跑。若需要新权限、真实交易、远程身份/服务、伪造人类签名或降低已冻结门槛，判定为高风险扩展并停止请求人类确认。
