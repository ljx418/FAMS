# RRG 多市场自选需求追踪矩阵

更新时间：2026-08-27

| 需求 | 主要实现 | 自动化证据 | 当前状态 |
| --- | --- | --- | --- |
| RRG-WL-001 | `normalizeRotationTarget`、新增表单 | 三市场规范化与非法代码断言 | implemented_and_automated_accepted |
| RRG-WL-002 | `targetsForUser`、页面默认可见集合 | 测试持仓自动进入 merged universe | implemented_and_automated_accepted |
| RRG-WL-003 | Watchlist Prisma 模型、30项门禁、合并去重 | 幂等、30/31边界、双来源单行断言 | implemented_and_automated_accepted |
| RRG-WL-004 | `hiddenTargetKeys` + localStorage、可见目标刷新门禁 | 浏览器显隐持久化；空 `targetKeys` 返回零刷新，禁止扩展为刷新全部 | implemented_and_automated_accepted |
| RRG-WL-005 | `freshness` 动态按基准日期重算 | API 响应含 freshness、lag、截止日与样本 | implemented_and_automated_accepted |
| RRG-WL-006 | Prisma Cascade、`deleteWatchlistItem` | 用户序列/点/运行删除，同行用户与共享bar保留断言 | implemented_and_automated_accepted |
| RRG-WL-007 | `marketPolicies`、市场页签 | CN/HK/US独立基准与真实公式复算 | implemented_and_automated_accepted |
| RRG-WL-008 | qfq/adjusted/index 三套 canonical 口径 | 标准行情版本、来源与告警校验 | implemented_and_automated_accepted |
| RRG-WL-009 | readiness/blockers 门禁 | 515070/512480 verified；688825 insufficient 且0点 | implemented_and_automated_accepted |
| RRG-WL-010 | 智能 CN、Yahoo 优先、腾讯/新浪兜底 | HK/US各1040条真实数据与RRG复算通过 | implemented_and_automated_accepted |
| RRG-WL-011 | 默认用户正式自选记录 | 默认自选精确集合断言 | implemented_and_automated_accepted |
| RRG-WL-012 | RRG 自选与显示管理、状态标签、确认删除 | TypeScript、生产构建、浏览器端到端检查 | implemented_and_automated_accepted |

自动化入口：

- `npm run test:relative-rotation-watchlist`：隔离用户上的领域规则和删除边界测试。
- `npm run test:relative-rotation-watchlist-real-data`：默认正式自选与 CN/HK/US 已持久化真实行情复算。
- `npm --prefix frontend run verify:relative-rotation-watchlist-runtime`：Playwright Chromium + Google Chrome CDP 的桌面/移动运行时验收。

总体状态：需求追踪覆盖 `12/12`。RRG 仍是研究证据，不构成交易指令；备用港美股源为单源，页面必须保留来源与复权限制警告。
