# DRV1-12 第三轮失败验收审计

日期：2026-08-25（Asia/Shanghai）

- reviewId：`f1189708-89f7-4cf2-96e7-d7da146388cb`
- 结果：`failed`，确定性状态仍为 `completed`
- LLM：单次非流式请求失败
- 最小脱敏探针：HTTP 400，供应商消息为 `The plain http request was sent to https port`

## 根因

脱敏复核确认 LLM Base URL 本身为 HTTPS；错误来自 Axios 自动继承本机 HTTP 代理后，代理链把明文请求送到 TLS 端口。之前的流式适配层没有暴露该响应正文，表现为空文本。

## 开发计划修订

保留 URL 的无歧义正规化，同时让该单次 Axios 请求不自动继承进程代理，直接按已配置 HTTPS Base URL 连接；主机、路径、模型和凭据保持不变。先以最小白名单请求验证，再运行完整工作流。

## 再开发准入

这是确定性的传输配置修复，不改变业务或校验边界；无新增致命或重大风险，允许进入第四轮验收。
