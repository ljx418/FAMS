# V2-PX PX5 Router/at-most-once 验收审计

日期：2026-08-29

阶段映射：自动化子阶段 `PX5` = 产品计划 `PX4-01 Router 完整集成 + PX4-02 at-most-once + PX4-03 边界集成`。

审计结论：`PASS_FOR_PRODUCT_PX5_LIFECYCLE_ENTRY_DOCUMENTATION`

代码锚点：`4e752a652afb63cacc89f42638e66307b2ca13be`

私有证据根：`.verification/private/v2-px/4e752a652afb63cacc89f42638e66307b2ca13be/PX5`

## 1. 出门判定

| 验收项 | 真实操作与证据 | 结果 | 判定 |
| --- | --- | --- | --- |
| RI-01 3×3 路由 | 真实 Side Panel、Workspace、3000 Host 各执行三动作；五 intent 全覆盖 | 9/9；intent 5/5 | PASS |
| RI-02 canonical | 对 route/correlation/time 变化后的稳定业务字段计算 SHA-256，并检查真实 tab URL | key 64 位且稳定；URL 仅 `workspaceId/view/ref` | PASS |
| RI-03 tab 收敛 | 真实 Chrome 依次打开 20 次、并发打开 20 次，并制造跨窗口重复 tab | 三组最终均为 1 个 tab；保留窗口被聚焦 | PASS |
| RI-04 at-most-once | 同 key 并发发送 20 条真实 runtime 消息，再重放 | Ask POST=1；重放新增 POST=0 | PASS |
| RI-05 restart/unknown | 通过 CDP 关闭 Background service worker 后重放；注入 dispatched ledger | worker 重启重放 POST=0；dispatched unknown POST=0 | PASS |
| RI-06 storage fault | 真实结果返回后注入未知 recovery schema，再复核 UI/ledger/重放 | 首次 POST=1；返回 `PX_RESULT_NOT_PERSISTED/unknown_result`；重放新增 POST=0 | PASS |
| RI-07 固定写序与最小存储 | 检查 local/session 原始元数据与 lifecycle events | ledger→recoveryIndex→session 可推导；正文 question/answer=0；ledger=3≤500，recovery=1≤20 | PASS |
| RI-08 真实数据与交易边界 | 真实 SQLite operation/review/conversation + network/DB 差分 | broker/order=0；非 Ask 后端 mutation=0；三个交易表差分=0；四锁=false | PASS |
| RI-09 可观察性与构建 | Chrome trace/screenshot/console + 全量单测/类型/production build | console error=0；11 files/71 tests；typecheck/build PASS | PASS |

真实数据锚点：operation `7a787789-c190-482f-9b10-a8849bd9af26`、review `a39d4ba3-e272-46a7-ba5f-e3a495d499be`、conversation `chat-1ac2c8dd-a9db-4bf4-82d4-c5444a33c763`。浏览器为 Windows Google Chrome `152.0.7977.64`，unpacked extension ID 为 `bboljkcemodfkaalmanmopnefadnjofe`。

## 2. 证据完整性

- 主报告：`router-idempotency-evidence.json`
- 阶段清单：`stage-manifest.json`
- 网络记录：`network.json`
- 原始存储元数据：`storage-metadata.json`
- 控制台记录：`console.json`
- 1280 截图：`router-idempotency-workspace-1280.png`，SHA-256 `b39c76eea60d30cc7193436dcf8d0072fc9c4dc62796b2eb8f67fcdb8c628bf4`
- Chrome trace：`router-idempotency-trace.zip`，SHA-256 `10eda20334378a94b54ca62032e54c35baa03af1cad9b6dbf56c1e3862b310b5`
- 同 commit Host Bridge 回归：`.verification/private/v2-px/4e752a652afb63cacc89f42638e66307b2ca13be/PX4B`，边界负例、零 tab/storage 副作用、零 DB mutation、console error=0。

证据目录仍遵守私有、Git 忽略策略；公开文档只登记路径、计数和 hash，不复制账户正文。

## 3. 失败—修复—重签记录

本阶段没有把失败运行登记为通过：

1. 首轮真实查询未在通用前 20 条中取得 review source，验收器正确失败；改为独立真实 review query 后重跑。
2. Side Panel 自动 load 与 3×3 route 并发造成 lifecycle previous state 漂移；将 Background 的 route/load/query 状态写入按 workspace 串行化，并新增 runtime handler 回归测试。
3. 真实 Chrome 在并发 tab 导航中返回 `Navigation rejected`；为 tab GET 导航增加 0/40/160ms 有界重试，POST Ask 路径没有重试，并新增单测。
4. `chrome.runtime.reload()` 在该 headless 环境会卸载 unpacked extension，不能证明 restart；改用 CDP `Target.closeTarget` 终止 service worker，再由真实消息唤醒，随后重放 POST=0。
5. 调整多窗口优先保留 sender tab 后再次遇到真实 navigation reject；修复后以干净 commit 重新生成全部 PX5 与 PX4B 证据。

## 4. 独立审计视角

- 产品规格审计：三入口、三动作、五 intent、标签复用和诚实 unknown 行为符合 PRD；没有把导航提升为交易动作。
- 架构审计：Background 是 route/lifecycle/session 的唯一写入者；ledger、recoveryIndex、session 顺序具备代码实体和真实事件证据。
- 现实性审计：真实 Chrome、真实生产 build、真实 3000/4000、真实 SQLite；未用静态 HTML、mock DOM 或复用不明端口出门。
- 虚假验收审计：致命问题 0、重大规格偏差 0、伪成功 0；可继续下一阶段文档准入。

## 5. 明确不在本次通过范围

本次通过不代表完整生命周期已完成，也不代表 V2-PX 最终候选出门。以下仍必须在产品 PX5/PX6 独立验收：Back/Forward/Refresh、关闭重开、FAMS 断连重连、extension update/migration、完整 TTL/LRU 启动清理、closed UI、四视口统一证据、可访问性和最终人类 permission/体验核查。
