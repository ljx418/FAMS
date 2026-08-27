# DRV1-12 第二轮失败验收审计

日期：2026-08-25（Asia/Shanghai）

- reviewId：`23c9574c-9dd3-49a2-aa64-b5f87975d897`
- 结果：`failed`（强制门禁继续生效）
- 确定性状态：`completed`
- LLM：真实尝试一次，`llm_json_invalid`
- 安全诊断：`responseCharacters=0`，不存在 JSON fence

## 根因

启用 JSON mode 后，pi-ai 的流式兼容层没有提取到任何文本。供应商配置、请求动作和业务输入均已进入，但流式聚合结果为空；不能通过放宽本地 schema 解决。

## 开发计划修订

1. OpenAI / OpenAI-compatible / DeepSeek 使用标准非流式 `/chat/completions`，直接读取 `choices[0].message.content`。
2. 请求继续启用 `response_format=json_object`、零温度和单次超时；使用 Axios 单请求，不启用 SDK 或 curl 重试。
3. MiniMax 保持现有专用非流式接口。
4. 保留所有本地 schema、数值、标的和证据引用校验；仍用全新 reviewId 重跑。

## 再开发准入

修订只替换供应商传输适配层，不更改业务计算或校验门槛；无新增致命或重大风险，允许第三轮实现和验收。
