# DRV1-7 失败打回与恢复后复验计划

日期：2026-08-21
状态：`RECOVERY_COMPLETED_REAL_ACCEPTANCE_PENDING`

## 失败点

1. 第一次真实 E2E 在复盘执行/失败标记期间收到 SQLite extended code 11。
2. 移除在线整库复制并重试后，第一条 Operation 幂等查询再次收到相同错误。
3. 重建后端进程后，启动恢复扫描仍收到相同错误。
4. 完整 `PRAGMA integrity_check` 确认当前主库有多个损坏 B-tree；后端已停止，不再写入。

## 已排除

- 不是 TypeScript/Prisma schema 构建错误：后端构建通过。
- 不是单一 API 业务断言：服务启动扫描和不同查询均可复现。
- 不是验收夹具问题：故障发生在真实 SQLite Operation 表/索引。
- 不是所有副本均损坏：三份候选备份完整校验均为 `ok`。

## 已完成的恢复闭环

1. 保持后端停止，把损坏主库及 WAL/SHM 移入带时间戳的取证副本。
2. 以最新且完整性为 `ok` 的验收前副本恢复主库，恢复后 `quick_check = ok`。
3. 核对 Position、Operation、DailyReviewRun 数量与最新复盘记录。
4. 重新执行 DRV1-5 v2 契约、每日复盘工作流、审计工作流、前端契约、RRG 回归和前后端构建，全部通过。

## 仍需复验

1. 启动后端并验证启动扫描、latest/detail/workflow API。
2. 在单独维护窗口生成真实默认组合 v2 复盘，验证一次性 LLM/fallback 持久化和六资产可复算推导。
3. 以该 v2 reviewId 执行四视口 Playwright；完成前 DRV1-5～DRV1-7 不升级为完整真实验收 PASS。
