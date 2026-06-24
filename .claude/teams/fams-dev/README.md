# FAMS 开发团队

## 团队成员

| Agent | 角色 | 身份描述 |
|-------|------|----------|
| team-lead | 进度管控 | 监控团队进度，向用户汇报 |
| frontend-developer-v2 | 前端开发 | engineering-frontend-developer |
| senior-developer | 高级开发 | engineering-senior-developer |
| backend-architect | 后端架构 | engineering-backend-architect |
| ai-engineer | AI工程师 | engineering-ai-engineer |
| finance-financial-analyst | 金融分析师 | finance-financial-analyst |
| code-reviewer-new | 代码审查 | engineering-code-reviewer |

## 启动团队

当用户说"启动团队"时，执行以下步骤：

1. 读取本目录下的 `config.json` 获取团队成员配置
2. 使用 Agent tool 依次启动各成员 agent
3. 各 agent 读取 `~/.claude/teams/fams-dev/config.json` 了解团队结构
4. 各 agent 向 team-lead 发送消息确认已加入

## 启动命令示例

```bash
# 启动前端开发
agent --name frontend-developer-v2 \
  --prompt "你是前端开发专家 agent，使用 engineering-frontend-developer 身份..." \
  --cwd /Users/Zhuanz/Desktop/xiaoli/financial-asset-manager/frontend

# 启动后端架构师
agent --name backend-architect \
  --prompt "你是后端架构师 agent，使用 engineering-backend-architect 身份..." \
  --cwd /Users/Zhuanz/Desktop/xiaoli/financial-asset-manager/backend
```

## 团队配置文件

- `config.json` - 完整的团队成员配置（与 `~/.claude/teams/fams-dev/config.json` 同步）
