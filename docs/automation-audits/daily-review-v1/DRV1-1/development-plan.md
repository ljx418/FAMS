# DRV1-1 开发计划：十节点审计数据合同

日期：2026-08-20  
状态：已完成

## 目标

提供一个只读、可版本化、可由前端直接消费的十节点工作流 API，并修复关注标的缺少显式证据状态的问题。

## 接口

`GET /api/v1/daily-reviews/:id/workflow?userId=default`

响应版本为 `fams.daily-review-audit-workflow.v1`，包含运行摘要、快照计数、已确认截图摘要、十个有序节点和固定执行边界。节点只包含公开运行记录或明确标注的派生视图。

## 实施步骤

1. 新增只读 workflow service，从 DailyReviewRun、Operation、快照、网格、报告和已确认截图构建节点。
2. 在 daily review 路由中增加 workflow 端点，保持既有接口兼容。
3. 新生成的关注标的增加 `evidenceStatus` 与 `evidenceRefs`；旧报告由 workflow 派生兼容状态。
4. 新增使用当前真实复盘记录的合同校验脚本和 npm 命令。

## 出门标准

- 节点 ID、顺序、状态枚举、provenance 和执行边界通过合同测试。
- 每个节点均有输入、输出、证据数组和 blocker 数组。
- 当前真实复盘可生成 10 个节点，且没有 fixture/mock provider。
- 后端 TypeScript 构建通过，既有每日复盘专项测试通过。

执行结果：全部满足。

