# PX6-01 可访问性验证器失败返工审计 01

日期：2026-08-31

结论：`CLOSED_NO_PRODUCT_SPEC_DEVIATION`

## 1. 未计入通过的失败

1. 首轮真实 Chrome 运行以 `sidepanel has a keyboard target without visible focus` 硬失败。诊断输出显示唯一失败元素为 `body`，它不在待验可交互控件集合中；原因是 Tab 序列从上一焦点位置开始并在末尾回到 body。
2. 引入 focus sentinel 后，Workspace 运行以 `6 !== 63` 硬失败。63 个控件中存在大量同名“查看详情/任务追踪/关系图谱”按钮，验证器错误地按 `tag:name` 去重，只得到 6 个名称组合。
3. 全量 collector 首轮执行在 CMD-09 启动前硬失败：旧 Router 验收脚本只检查 IPv4 `127.0.0.1:3000/4000` 并要求空闲，而当前项目的其他进程按用户要求正在使用这两个地址。脚本未启动或复用错误服务，CMD-01～08 的通过不被提升为 PX6-01 通过。
4. Router 切换到 Linux Chrome/IPv6 后，首次在 multi-window 收敛后立即读取到导航前的 `view=graph&ref=...`。`chrome.tabs.update()` 的 Promise 已返回，但 Linux Chrome 的可观察 URL 尚未切换；验证器没有按 PRD 已冻结的“1 秒内聚焦”门槛等待，属于时序假阴性。
5. 第二次全量 collector 的 CMD-01～14 全部通过，但 HTML smoke test 读到预览图片为 0。独立重放发现页面脚本实际以 `Invalid or unexpected token` 在启动时失败：generator 模板把 JSON 导出尾部的 `\\n` 错误渲染成 JavaScript 字符串中的真实换行。collector 在生成 manifest/report 前硬失败，未产生 PX6-01 总体通过。
6. 修复 HTML 后的第三次全量 collector 在 CMD-12 硬失败：生命周期恢复脚本重复使用固定证据目录下的 Chrome profile，而前一次成功运行会按验收场景在末尾故意留下 `v2-px-recovery-index/99`。下一次调用因此从污染状态启动，Side Panel 正确进入阻断态，不会出现正常摘要。该失败是验证器运行间隔离缺陷；前 11 个命令的通过未被提升为 PX6-01 通过。

上述三次运行均为 `failed`，未生成或登记正式 PASS。

## 2. 返工与边界

- 为每个真实 DOM 控件临时分配仅在审计期间存在的 `data-px-a11y-id`，用该 ID 核对 Tab 是否逐个到达；审计后立即移除。
- 在第一个真实控件前插入临时 focus sentinel，使每个视口的键盘序列从确定起点开始；审计后立即移除。
- 保留对可见名称、44×44、focus ring、4.5:1、根溢出、console、network 和交易副作用的原门槛，不降低阈值。
- 未修改 Side Panel、Workspace、Background、API、权限、投资计算或交易运行时代码。
- Router 验收脚本的隔离地址改为可配置；PX6 collector 固定使用 IPv6 loopback `::1`，同时在 `::1:3000/4000` 继续执行端口空闲断言。Chrome 仅在该模式把 localhost 映射到 `::1`，从而不停止、不复用、不信任其他 Agent 的 IPv4 项目服务。
- Router、Workspace、Side Panel 的 PX6 重跑统一优先使用同一官方 Linux Chrome for Testing 和 `::1`；Node 的直接 API 复核也指向 `[::1]:4000`。production manifest/origin 仍是冻结的 localhost/127.0.0.1，没有新增权限或生产地址。
- multi-window 收敛后以 25ms 间隔最多等待 1 秒，只有 tab=1、`view=source_library` 且 stale ref 已移除才继续；超过 1 秒仍 hard fail。该修改与 AC-PX-03 的量化门槛一致，没有放宽产品规格。
- generator 改为在 HTML 脚本中输出合法的 `\\n` 转义；HTML smoke test 同时在文件选择后最多等待 5 秒直到预览图片真实可见，并采集 `pageerror`/console error。脚本语法错、超时或任一页面异常均 hard fail。
- 生命周期恢复验证器的 extension 副本和 Chrome profile 改为每次调用新建的临时目录；同一次调用内的 Chrome 重启仍严格复用同一个 profile。这样保留真实重启持久化验证，同时避免上次运行末尾的 unknown-major 故障注入污染下一次运行；证据目录和门槛均未放宽。

## 3. 返工后开发态证据

- Chrome `152.0.7977.64`，extension `0.2.0`，真实 FAMS SQLite snapshot。
- 视口：360、420、768、1280；控件检查 132，键盘到达 132。
- 最低文本对比度 4.63；未命名控件、过小点击区、不可见焦点、根溢出、console error、failed request 均为 0。
- Operation 434、DailyReviewRun 28；broker/order 请求 0；Transaction 变更 0；四锁均 false。

该证据只证明验证器返工在开发态可运行；正式结论仍须在精确 clean 实现提交上由 `verify:acceptance` 全量重跑。
