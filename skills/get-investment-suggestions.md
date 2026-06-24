# Skill: get-investment-suggestions

获取每日或每周的投资建议，包括交易信号、调仓建议和风险提示。

## 使用方式

```
/skill:get-investment-suggestions userId=<用户ID> period=<daily|weekly>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | string | 是 | 用户ID |
| period | string | 是 | 建议周期: `daily` 或 `weekly` |

## 返回内容

### daily (每日建议)
```json
{
  "date": "2026-04-12",
  "actions": [
    {
      "type": "buy|sell|hold",
      "assetId": "uuid",
      "symbol": "AAPL",
      "reason": "基于RSI超卖信号",
      "confidence": 85,
      "quantity": 100,
      "price": 150.25,
      "estimatedAmount": 15025
    }
  ],
  "warnings": [
    {
      "level": "info|warning|danger",
      "message": "贵州茅台仓位已超过上限20%",
      "assetId": "uuid"
    }
  ]
}
```

### weekly (每周建议)
```json
{
  "week": "2026-W15",
  "rebalancing": {
    "needed": true,
    "actions": [
      {
        "assetId": "uuid",
        "symbol": "AAPL",
        "currentRatio": 25,
        "targetRatio": 20,
        "action": "reduce",
        "amount": 5000
      }
    ]
  },
  "performanceReview": {
    "totalReturn": 3.5,
    "benchmarkReturn": 2.8,
    "outperformance": 0.7,
    "topPerformer": "AAPL",
    "worstPerformer": "TSLA"
  }
}
```

## 示例调用

### Claude Code Agent调用
```
作为投资顾问Agent，我需要获取用户123的每日投资建议，以便为用户提供交易参考。
```

### MCP工具调用
```json
{
  "tool": "get-investment-suggestions",
  "parameters": {
    "userId": "user-123",
    "period": "daily"
  }
}
```

## 数据来源

- 实时价格数据 (通过 `get-real-time-price`)
- 用户仓位数据 (通过 `get-positions`)
- 历史价格分析 (技术指标计算)
- 预设止盈止损规则

## 置信度说明

| 置信度 | 含义 |
|--------|------|
| 90-100 | 高置信度信号，基于多个指标确认 |
| 70-89 | 中高置信度，基于主要指标 |
| 50-69 | 中等置信度，需要结合其他信息 |
| <50 | 低置信度，仅供参考 |

## 注意事项

- 建议仅供投资参考，不构成实际投资建议
- 请提醒用户注意投资风险
- 实际交易前请用户确认
