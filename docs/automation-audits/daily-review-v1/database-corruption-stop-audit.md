# 每日复盘自动化开发停止审计：SQLite 主库完整性损坏

发现时间：2026-08-21 12:55～13:02（Asia/Shanghai）
停止等级：`MAJOR_DATA_INTEGRITY_RISK`
自动化开发状态：`RECOVERED_AND_CONTRACT_REVALIDATED`

## 受影响对象

- 原损坏主库：`backend/prisma/dev.db`
- 主库大小：560,144,384 bytes
- 主库 SHA-256：`04fb60717a6525b16fb593b92486079107cdd077203df802b85151bb8c5408853`
- 完整 integrity_check：失败，包含多个 `btreeInitPage() returns error code 11`；Operation 查询和服务启动恢复扫描可复现。
- 后端服务：已停止，避免继续写入。

## 采用的健康恢复源

- 路径：`.verification/daily-review-v1/DRV1-7/2026-08-21T04-54-34-405Z/pre-run.db`
- 生成时点：真实 E2E 第一次 API 调用之前。
- 大小：560,144,384 bytes
- SHA-256：`e81df0d2eea2dd09263b0a0ff47badd8103498ae59b5f89e2eb5dce239e212f3`
- 完整 `PRAGMA integrity_check`：`ok`
- 快照计数：Position 10、Operation 172、DailyReviewRun 12；最新复盘 `a41ad2e1-6f57-4b22-8d2e-8acda501a478` 状态 completed。

另外两份候选也通过完整校验：

- `backend/data/backups/dev.main-consolidation-20260821-1230.db`
- `backend/prisma/dev.pre-ftr-20260820T1334.db`

## 已采取的恢复动作

- 13:04 保持后端停止，将损坏主库及 WAL/SHM 侧文件完整移动到 `backend/data/backups/dev.corrupt-before-restore-20260821-1303.db*`，未删除取证副本。
- 从上述最新健康快照复制恢复 `backend/prisma/dev.db`；没有对损坏库执行 `.recover`、REINDEX 或 VACUUM。
- 恢复后主库 `PRAGMA quick_check` 为 `ok`；当前 SHA-256 为 `8b663a07aafb54741f0e49f8b64360d17c702ec00efbff392bbfe1474ff32288`。
- 恢复后计数：Position 10、Operation 172、DailyReviewRun 12；最新复盘仍为 `a41ad2e1-6f57-4b22-8d2e-8acda501a478`，状态 completed。
- 后端构建、DRV1-5 v2 契约、每日复盘工作流、十节点审计工作流、前端静态契约和 RRG 专项回归均通过；测试后再次执行 `quick_check = ok`。
- 会触发真实默认组合复盘的 E2E 与四视口浏览器验收仍未重跑，不用旧轮证据冒充新规格验收。

## 后续约束

- 禁止验收脚本在常驻后端持有 SQLite 连接时执行在线整库复制或替换；DRV1-7 真实 E2E 已移除在线 `.backup`。
- 真实默认组合 E2E 必须在单独维护窗口执行，并在运行前后分别校验主库；四视口浏览器验收只能读取已完成的 v2 复盘。
- 本次恢复和回归不授权任何交易、券商订单或自动执行动作。
