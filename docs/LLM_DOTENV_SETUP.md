# LLM 密钥配置说明

本项目使用后端 `dotenv` 管理 LLM 密钥。真实密钥只允许放在 `backend/.env`，不得写入前端、代码、审计包或 Git。

明确要求：

- 不要提交 `backend/.env`、真实 Key、cookie、token 或任何 provider 凭证。
- ChatBox LLM 只做意图识别和业务路由，不会自动下单，不会绕过 FAMS 交易 gate。
- 审计报告只能展示 `provider`、`model`、`keySource` 和 `secretsRedacted=true`，不能展示真实密钥。

## 推荐配置

复制示例文件：

```bash
cp backend/.env.example backend/.env
```

在 `backend/.env` 中填写：

```dotenv
FAMS_LLM_PROVIDER=openai
FAMS_LLM_API_KEY=你的真实Key
FAMS_LLM_MODEL=gpt-4o-mini
FAMS_LLM_BASE_URL=https://api.openai.com/v1
FAMS_LLM_TIMEOUT_MS=30000
```

如果使用 DeepSeek：

```dotenv
FAMS_LLM_PROVIDER=deepseek
FAMS_LLM_API_KEY=你的真实Key
FAMS_LLM_MODEL=deepseek-chat
FAMS_LLM_BASE_URL=https://api.deepseek.com
```

如果使用 OpenAI 兼容代理：

```dotenv
FAMS_LLM_PROVIDER=openai_compatible
FAMS_LLM_API_KEY=你的真实Key
FAMS_LLM_MODEL=你的模型名
FAMS_LLM_BASE_URL=https://你的兼容接口/v1
```

如果本地已经配置了旧变量：

```dotenv
DEEPSEEK_API_KEY=你的真实Key
MINIMAX_API_KEY=你的真实Key
```

后端会自动脱敏检测。若 `FAMS_LLM_API_KEY` 和 `OPENAI_API_KEY` 为空，但 `DEEPSEEK_API_KEY` 存在，系统会优先使用 DeepSeek；如果只有 `MINIMAX_API_KEY`，股票事实观察可继续使用 MiniMax，ChatBox LLM planner 会保持 deterministic fallback。

## ChatBox 开关

```dotenv
FAMS_CHAT_LLM_ENABLED=0
```

当前 ChatBox 仍通过 FAMS allowlisted tools、显式确认和交易 gate 执行业务动作。即使设置为 `1`，也不能绕过：

```text
ADD / REDUCE / ORDER_CREATE / AUTO_TRADE
```

启用后，ChatBox 的 LLM 只做 intent router，不直接调用任意工具、不创建订单、不释放正式交易动作。

## 验证命令

```bash
cd backend
npm run test:llm-dotenv-config
npm run test:chat-llm-planner
curl http://127.0.0.1:4000/api/v1/llm/status
curl http://127.0.0.1:4000/api/v1/chat/capabilities
```

返回结果只会展示 `configured`、`provider`、`model` 和 `keySource`，不会返回真实密钥。
