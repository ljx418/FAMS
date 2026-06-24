# Skill: get-real-time-price

获取资产的实时价格，支持多数据源获取和交叉验证。

## 使用方式

```
/skill:get-real-time-price symbol=<股票代码> source=<数据源>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| symbol | string | 是 | 资产代码，如 `AAPL`, `600519.SS` (茅台) |
| source | string | 否 | 数据源: `yahoo`, `eastmoney`, `sina`, `auto` (默认) |

## 返回内容

```json
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "price": 178.25,
  "priceChange": 2.35,
  "priceChangePercent": 1.34,
  "volume24h": 52340000,
  "high24h": 179.50,
  "low24h": 175.80,
  "openPrice": 176.00,
  "previousClose": 175.90,
  "timestamp": "2026-04-12T13:30:00Z",
  "source": "yahoo",
  "isValid": true,
  "crossValidation": [
    {
      "source": "eastmoney",
      "price": 178.22,
      "deviationPercent": 0.02
    },
    {
      "source": "sina",
      "price": 178.28,
      "deviationPercent": 0.02
    }
  ]
}
```

## 支持的股票代码格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 美股 | 纯代码 | `AAPL`, `TSLA`, `GOOGL` |
| A股 | 代码.交易所 | `600519.SS` (上海), `000001.SZ` (深圳) |
| 港股 | 代码.HK | `0700.HK`, `9988.HK` |
| 基金 | 代码 | `510310.SS` (沪深300ETF) |
| 黄金 | XAUUSD | `XAUUSD` |
| 白银 | XAGUSD | `XAGUSD` |

## 数据源说明

| 数据源 | 说明 | 覆盖范围 |
|--------|------|----------|
| yahoo | Yahoo Finance | 美股为主 |
| eastmoney | 东方财富 | A股、基金、港股 |
| sina | 新浪财经 | A股、港股 |

## 交叉验证

当使用 `source: "auto"` 时，系统会自动从多个数据源获取价格并进行交叉验证：

- 如果各数据源价格偏差 < 0.5%，返回 `isValid: true`
- 如果偏差 >= 0.5%，返回 `isValid: false` 并触发告警

## 示例调用

### 获取美股实时价格
```
/skill:get-real-time-price symbol=AAPL source=auto
```

### 获取A股实时价格
```
/skill:get-real-time-price symbol=600519.SS source=eastmoney
```

### 获取黄金价格
```
/skill:get-real-time-price symbol=XAUUSD source=yahoo
```

## MCP工具定义

```json
{
  "tool": "get-real-time-price",
  "parameters": {
    "symbol": "AAPL",
    "source": "auto"
  }
}
```

## 缓存策略

- 实时价格缓存时间: 5秒
- 盘后价格缓存时间: 5分钟
- 历史价格缓存时间: 1小时

## 错误处理

| 错误码 | 说明 | 处理方式 |
|--------|------|----------|
| SYMBOL_NOT_FOUND | 代码不存在 | 建议检查代码格式 |
| SOURCE_UNAVAILABLE | 数据源不可用 | 自动切换到其他数据源 |
| RATE_LIMITED | 请求频率超限 | 等待后重试 |
| INVALID_SYMBOL | 无效代码 | 返回错误信息 |

## 注意事项

- 价格为参考价格，实际成交价格可能有所不同
- 建议在交易时段获取价格
- 盘后交易时段价格可能不更新
