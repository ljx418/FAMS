# V2-PX PX4-A Side Panel 入场审计

日期：2026-08-29

结论：PASS_FOR_CONTROLLED_IMPLEMENTATION

## 审计范围

本子阶段只实现产品计划 PX3-01 的轻量 Side Panel。Host Bridge 属于后续 PX4-B，必须另做入场审计；本阶段不修改 FAMS Host 页面，不扩大 API、权限、交易或生命周期合同。

## 当前事实

| 项目 | 当前状态 | 入场判断 |
| --- | --- | --- |
| PX3 Workspace/Adapter | commit `6c8714e` 真实 Chrome/DB/API/LLM 自动验收 PASS | 可复用 Background、FamsDomainAdapter、Ask 与 Workspace tab manager |
| 当前 Side Panel | 只有连接说明和“打开完整工作台”，没有当前摘要、数据时间、Quick Ask、最近任务 | 目标差距明确，不可把现有 shell 计为产品通过 |
| 数据路径 | `intent_route(source_library)` 可建立 workspace state，`refresh_index` 可读取真实 SourcePage，`query` 可受控 Ask | 无需新增后端端点或复制业务计算 |
| 方案 A caller | 已实现并由真实 Chrome 重签 | Side Panel 继续只经 Background 访问后端 |
| 文档支撑 | PRD PX-REQ-004/011/016/017、原型 §3/§6/§8、运行时合同 Quick Ask 35 秒门槛明确 | 足以指导本子阶段 |
| fatal/major 审计意见 | 0 | 允许进入 TDD |

## 不得越界

- 不在 Side Panel 展示完整 K 线、DAG、大表格或原始 refs 常驻列表。
- 不从 UI 直接 fetch；不把 question/answer 写 storage。
- 不增加 `<all_urls>`、安装时 host permission 或 3000 host permission。
- 不创建订单、自动交易或交易解锁入口。
- 不把 ack、loading、shell/root 存在记作最终回答通过。

## 入场决定

可以按 `DEVELOPMENT_PLAN.md` 开始 PX4-A；任一真实 Chrome 路径只能靠 mock 数据通过、Ask POST 超过 1、出现交易请求或 360/420 溢出时，立即退回计划阶段。
