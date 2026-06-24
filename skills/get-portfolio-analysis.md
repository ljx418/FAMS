# Skill: get-portfolio-analysis

获取投资组合的详细分析，包括资产配置、风险指标、收益分析和改进建议。

## 使用方式

```
/skill:get-portfolio-analysis userId=<用户ID> portfolioId=<组合ID>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userId | string | 是 | 用户ID |
| portfolioId | string | 否 | 组合ID，不传则返回用户主组合 |

## 返回内容

```json
{
  "portfolio": {
    "id": "uuid",
    "name": "永久组合",
    "totalValue": 1000000,
    "cashBalance": 100000,
    "positionsCount": 8
  },
  "allocation": {
    "byAssetType": [
      { "type": "stock", "value": 400000, "ratio": 40, "target": 40 },
      { "type": "bond", "value": 300000, "ratio": 30, "target": 30 },
      { "type": "gold", "value": 100000, "ratio": 10, "target": 10 },
      { "type": "cash", "value": 200000, "ratio": 20, "target": 20 }
    ],
    "bySector": [
      { "sector": "科技", "value": 200000, "ratio": 20 },
      { "sector": "消费", "value": 150000, "ratio": 15 },
      { "sector": "金融", "value": 150000, "ratio": 15 }
    ],
    "byTag": [
      { "tag": "港股", "value": 300000, "ratio": 30 },
      { "tag": "A股", "value": 400000, "ratio": 40 },
      { "tag": "美股", "value": 300000, "ratio": 30 }
    ]
  },
  "performance": {
    "totalReturn": 8.5,
    "totalReturnPercent": 8.5,
    "annualizedReturn": 12.3,
    "benchmarkReturn": 10.5,
    "outperformance": 1.8,
    "bestPosition": {
      "symbol": "AAPL",
      "returnPercent": 25.3
    },
    "worstPosition": {
      "symbol": "TSLA",
      "returnPercent": -8.5
    }
  },
  "riskMetrics": {
    "volatility": 15.2,
    "sharpeRatio": 1.45,
    "maxDrawdown": -12.5,
    "beta": 0.85,
    "var95": -25000,
    "riskScore": 65
  },
  "suggestions": [
    {
      "type": "rebalance",
      "priority": "high",
      "message": "科技股仓位超过目标20%，建议减仓5%",
      "details": {
        "currentRatio": 25,
        "targetRatio": 20,
        "action": "reduce",
        "amount": 50000
      }
    },
    {
      "type": "diversification",
      "priority": "medium",
      "message": "组合集中度较高，建议增加港股配置",
      "details": {
        "currentConcentration": 45,
        "targetConcentration": 35
      }
    }
  ],
  "scores": {
    "overall": 82,
    "liquidity": 90,
    "risk": 75,
    "return": 85,
    "diversification": 78
  },
  "warnings": [
    {
      "level": "danger",
      "message": "贵州茅台仓位已触及单票上限30%",
      "assetId": "uuid"
    }
  ]
}
```

## 组合模板

### 永久组合 (Permanent Portfolio)
- 股票: 25%
- 债券: 25%
- 黄金: 25%
- 现金: 25%

### 全天候组合 (All Weather Portfolio)
- 美国股票: 30%
- 长期国债: 40%
- 中期国债: 15%
- 黄金: 7.5%
- 大宗商品: 7.5%

## 评分体系

| 维度 | 权重 | 评分标准 |
|------|------|----------|
| 流动性 | 20% | 现金比例、高流动性资产占比 |
| 风险 | 30% | 波动率、最大回撤、VaR |
| 收益 | 30% | 年化收益、相对基准超额收益 |
| 分散化 | 20% | 集中度、行业分布、资产类别分布 |

### 评分等级

| 分数 | 等级 | 说明 |
|------|------|------|
| 90-100 | 优秀 | 组合配置优秀 |
| 80-89 | 良好 | 组合配置合理 |
| 70-79 | 中等 | 有改进空间 |
| 60-69 | 较差 | 需要调整 |
| <60 | 差 | 建议大幅调整 |

## 示例调用

### 获取用户主组合分析
```
/skill:get-portfolio-analysis userId=user-123
```

### 获取特定组合分析
```
/skill:get-portfolio-analysis userId=user-123 portfolioId=portfolio-permanent
```

## MCP工具定义

```json
{
  "tool": "get-portfolio-analysis",
  "parameters": {
    "userId": "user-123",
    "portfolioId": "portfolio-permanent"
  }
}
```

## 分析维度

### 1. 资产配置分析
- 按资产类型分布 (股票、债券、黄金、现金)
- 按行业分布
- 按地域分布 (港股、A股、美股)
- 按标签分布

### 2. 风险分析
- 波动率 (Volatility)
- 夏普比率 (Sharpe Ratio)
- 最大回撤 (Max Drawdown)
- Beta值
- VaR (Value at Risk)

### 3. 收益分析
- 总收益率
- 年化收益率
- 相对基准超额收益
- 最佳/最差持仓

### 4. 调仓建议
- 再平衡需求
- 集中度风险提示
- 行业偏离提示
- 单票仓位超限警告

## 注意事项

- 分析基于历史数据和当前持仓
- 实际投资需考虑个人风险偏好
- 建议仅供参考，不构成投资建议
