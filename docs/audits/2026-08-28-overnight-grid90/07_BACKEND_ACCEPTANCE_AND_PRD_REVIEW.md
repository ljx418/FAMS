# 90 日网格实验：后端 E2E 验收与 PRD 复核

- 验收时间：2026-08-29（Asia/Shanghai）
- 真实实验记录：`b570a9f4-6fe1-479d-8eb6-72a7fad96b4a`
- 输入指纹：`232cd6af32c64dbc2234e3dceaeb2d8c59e48ea75fc5f9d268848bd4a7daea7c`
- 结果：通过

## 数据库与恢复性验收

- 主库迁移前 `PRAGMA quick_check`：`ok`。
- 一致性备份：`backend/prisma/dev.pre-grid90-20260829.db`，约535MB。
- 备份库 `PRAGMA quick_check`：`ok`。
- 迁移后主库 `PRAGMA quick_check`：`ok`。
- 新表 `OvernightBacktestGridVariant`：34列，唯一键为回测ID+参数哈希。
- Prisma Client生成和TypeScript构建：通过。

## 真实 API E2E

命令：`npm run test:overnight-grid90-api-e2e`

| 项目 | 结果 |
|---|---:|
| 持久化参数组 | 5,832 |
| 唯一参数哈希 | 5,832 |
| 有成交参数组分页总数 | 1,620 |
| 默认热力图单元格 | 18（3个涨幅区间×6个第8步版本） |
| 训练候选 | 0 |
| 经济结论 | `no_supported_variant` |
| 总结论 | `data_insufficient` |
| 正式回测ID（实验前后） | `970c77c7-b6a9-409e-8e96-1d7a323a2c5f`，保持不变 |
| Transaction数量（实验前后） | 0 / 0 |
| 人工草案数量（实验前后） | 0 / 0 |

默认热力图明确固定其余维度为原始基线，不在一个单元格内对多组参数取最大值。API响应同时返回固定参数和“仅训练集”说明。

## 既有工作流回归

以下回归全部通过：

- `npm run test:overnight-strategy-rules`
- `npm run test:overnight-strategy-drafts`
- `npm run test:overnight-strategy-backtest`
- `npm run test:overnight-strategy-api-e2e`
- `npm run build`

既有API E2E使用真实持久化数据完成：实时扫描2只、当前严格5分钟覆盖率0.133156%、股本覆盖率0%、正式结论仍为 `data_insufficient`，没有因新增实验而晋级。

## PRD 规格复核

| 规格 | 结果 |
|---|---|
| 独立 `evidenceMode=grid_experiment_90d` | 通过 |
| 概览只读 `trading_decision` | 通过 |
| 草案参数源只读 `trading_decision` | 通过 |
| 启动/最新/详情/分页/热力图API | 通过 |
| 后台指纹校验和中断恢复 | 通过 |
| 失败不使用演示数据 | 通过 |
| 交易、草案和正式回测隔离 | 通过 |
| 四项交易权限持续false | 通过 |

## 子阶段结论

后端持久化与API子阶段通过，可以进入前端开发。API交付的是完整否证/不足证据，不提供“推荐参数”或买卖委托入口。
