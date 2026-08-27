# DRV1-13 开发计划：无头浏览器验收闭环

日期：2026-08-27（Asia/Shanghai）

1. 使用隔离的 SQLite 数据库副本启动后端和前端，不写入生产券商或正式交易接口。
2. 使用 Playwright Chromium 在桌面、紧凑桌面、平板和手机四个视口遍历每日复盘主路径。
3. 使用 Windows Google Chrome 的 CDP 接口在桌面和手机视口抽检真实 Chrome 行为。
4. 检查十节点 DAG、摘要、四重点标的、即时/条件网格、历史抽屉、审计导出、交易锁、控制台错误和根页面溢出。
5. 原始 JSON、截图和账户数据只写入 `.verification/private/`，Git 仅保存脱敏结论。

人工验收不在本阶段自动代签；四项交易权限必须始终为 false。
