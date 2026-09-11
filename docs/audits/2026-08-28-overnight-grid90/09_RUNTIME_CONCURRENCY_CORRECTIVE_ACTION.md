# 90 日网格实验：运行时并发缺陷纠正审计

- 状态：已闭环
- 发现阶段：真实浏览器端到端验收
- 风险等级：重大（修复前存在虚假验收风险）

## 发现事实

真实浏览器同时读取概览、数据就绪、最新实验、参数明细和热力图时，Prisma 间歇返回 `SQLite extended_code 14: unable to open database file`。页面结论摘要可以先返回，但 1,620 组明细或 18 个热力图单元可能为空。此前串行 Fastify 注入测试没有稳定触发，因此前端阶段立即回退，未签署通过意见。

运行环境为 WSL Linux 进程访问 `/mnt/c` DrvFS 上约 535MB 的 SQLite 数据库。修复前数据库 URL 允许 4 个 Prisma SQLite 连接；路径又可能以 `workSpace` 或 `workspace` 两种大小写进入。SQLite 的 WAL/SHM 身份与连接级 `busy_timeout` 在该组合下存在不稳定风险。

## 纠正措施

1. Windows 挂载路径统一为小写绝对路径，阻止不同大小写别名形成不同 SQLite/WAL 身份。
2. DrvFS 上默认 `connection_limit=1`，让并发请求由 Prisma 排队，并使启动阶段设置的连接级 `busy_timeout=30000` 对全部请求生效。
3. 非 DrvFS 默认仍为4连接；显式 `FAMS_SQLITE_CONNECTION_LIMIT` 继续保留人工覆盖能力。
4. 新增只读并发回归：20轮，每轮同时读取5个真实端点，共100个请求；逐项拒绝非200响应和数据库打开错误。
5. 同步修正既有数据库路径测试，使其验证确定性的规范路径和 DrvFS 单连接策略。

## 验收结果

- `npm run build`：通过。
- `npm run test:sqlite-concurrent-read-stability`：100/100 请求返回200；`filledVariantCount=1620`；`heatmapCells=18`。
- `npm run test:fivd-r-portfolio-runtime`：通过；解析路径为 `/mnt/c/workspace/financial-asset-manager/backend/prisma/dev.db`。
- 修复后真实浏览器同时加载全部接口：无错误告警，热力图画布1个，分页器1个，5,832/1,620/0.9525均显示。

## 审计意见

重大虚假验收风险已闭环。单连接会降低 SQLite 并行吞吐，但本地单用户研究系统优先保证正确性；若未来进入多人或生产负载，应迁移 PostgreSQL，而不是在 DrvFS SQLite 上提高连接数。本意见不改变策略证据结论和交易权限。
