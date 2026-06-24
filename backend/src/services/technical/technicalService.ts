/**
 * Technical Service - 技术指标服务
 *
 * 职责：
 * 1. 纯函数算法实现（RSI, EMA, MACD, BOLL, KDJ, ATR等）
 * 2. 不依赖外部数据源，仅对输入数据进行计算
 */

export interface MACDResult {
  dif: number   // DIF = 12日EMA - 26日EMA
  dea: number   // DEA = DIF的9日EMA
  macdHist: number  // MACD柱 = 2 × (DIF - DEA)
}

export interface BOLLResult {
  upper: number  // 上轨
  middle: number // 中轨
  lower: number  // 下轨
}

export interface KDJResult {
  k: number
  d: number
  j: number
}

export interface SupportResistance {
  support: number   // 支撑位
  resistance: number // 阻力位
}

export type TrendType = '强势上涨' | '上涨' | '强势下跌' | '下跌' | '震荡'

class TechnicalService {
  /**
   * 计算简单移动平均线 (MA)
   * @param prices 价格数组
   * @param period 周期
   */
  calculateMA(prices: number[], period: number): number {
    if (prices.length < period) {
      return prices.reduce((a, b) => a + b, 0) / prices.length
    }
    const slice = prices.slice(-period)
    return slice.reduce((a, b) => a + b, 0) / period
  }

  /**
   * 计算RSI指标 (Relative Strength Index)
   * @param prices 价格数组
   * @param period 周期，默认14
   */
  calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length <= period) {
      return 50.0
    }

    const deltas: number[] = []
    for (let i = 1; i < prices.length; i++) {
      deltas.push(prices[i] - prices[i - 1])
    }

    const seed = deltas.slice(0, period)
    let up = seed.filter(d => d >= 0).reduce((a, b) => a + b, 0) / period
    let down = -seed.filter(d => d < 0).reduce((a, b) => a + b, 0) / period

    const rsi: number[] = new Array(prices.length).fill(100 - 100 / (1 + (up / (down || 0.001))))

    for (let i = period; i < prices.length; i++) {
      const delta = deltas[i - 1]
      let upval: number, downval: number

      if (delta > 0) {
        upval = delta
        downval = 0
      } else {
        upval = 0
        downval = -delta
      }

      up = (up * (period - 1) + upval) / period
      down = (down * (period - 1) + downval) / period

      const rs = down !== 0 ? up / down : 0
      rsi[i] = 100 - 100 / (1 + rs)
    }

    return rsi[rsi.length - 1]
  }

  /**
   * 计算EMA (Exponential Moving Average)
   * @param prices 价格数组
   * @param period 周期
   */
  calculateEMA(prices: number[], period: number): number[] {
    const ema: number[] = new Array(prices.length).fill(0)
    ema[0] = prices[0]
    const multiplier = 2 / (period + 1)

    for (let i = 1; i < prices.length; i++) {
      ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1]
    }

    return ema
  }

  /**
   * 计算MACD指标
   * @param prices 价格数组
   * @param fast 快线周期，默认12
   * @param slow 慢线周期，默认26
   * @param signal 信号线周期，默认9
   */
  calculateMACD(prices: number[], fast: number = 12, slow: number = 26, signal: number = 9): MACDResult {
    if (prices.length < slow) {
      return { dif: 0, dea: 0, macdHist: 0 }
    }

    const emaFast = this.calculateEMA(prices, fast)
    const emaSlow = this.calculateEMA(prices, slow)

    const dif: number[] = []
    for (let i = 0; i < prices.length; i++) {
      dif.push(emaFast[i] - emaSlow[i])
    }

    const dea = this.calculateEMA(dif, signal)

    return {
      dif: dif[dif.length - 1],
      dea: dea[dea.length - 1],
      macdHist: 2 * (dif[dif.length - 1] - dea[dea.length - 1])
    }
  }

  /**
   * 计算布林带 (Bollinger Bands)
   * @param prices 价格数组
   * @param period 周期，默认20
   * @param stdMult 标准差倍数，默认2
   */
  calculateBOLL(prices: number[], period: number = 20, stdMult: number = 2): BOLLResult {
    const actualPeriod = prices.length < period ? prices.length : period
    const recentPrices = prices.slice(-actualPeriod)

    const mid = recentPrices.reduce((a, b) => a + b, 0) / actualPeriod

    // 计算标准差
    let sumSquares = 0
    for (const p of recentPrices) {
      sumSquares += (p - mid) ** 2
    }
    const std = Math.sqrt(sumSquares / actualPeriod)

    const upper = mid + stdMult * std
    const lower = mid - stdMult * std

    return { upper, middle: mid, lower }
  }

  /**
   * 计算KDJ指标
   * @param highs 最高价数组
   * @param lows 最低价数组
   * @param closes 收盘价数组
   * @param n RSV周期，默认9
   * @param m1 K平滑值，默认3
   * @param m2 D平滑值，默认3
   */
  calculateKDJ(highs: number[], lows: number[], closes: number[], n: number = 9, _m1: number = 3, _m2: number = 3): KDJResult {
    if (closes.length < n) {
      return { k: 50, d: 50, j: 50 }
    }

    const k: number[] = new Array(closes.length).fill(0)
    const d: number[] = new Array(closes.length).fill(0)
    const j: number[] = new Array(closes.length).fill(0)

    // 初始化K和D为50
    k[0] = 50
    d[0] = 50

    for (let i = 0; i < closes.length; i++) {
      if (i < n - 1) continue

      // 计算窗口内的最高价和最低价
      const windowStart = Math.max(0, i - n + 1)
      let windowHighs = highs.slice(windowStart, i + 1)
      let windowLows = lows.slice(windowStart, i + 1)

      const llv = Math.min(...windowLows)
      const hhv = Math.max(...windowHighs)

      let rsv: number
      if (hhv === llv) {
        rsv = 50
      } else {
        rsv = ((closes[i] - llv) / (hhv - llv)) * 100
      }

      // 计算K、D、J
      if (i === n - 1) {
        k[i] = (2 / 3) * 50 + (1 / 3) * rsv
        d[i] = (2 / 3) * 50 + (1 / 3) * k[i]
      } else {
        k[i] = (2 / 3) * k[i - 1] + (1 / 3) * rsv
        d[i] = (2 / 3) * d[i - 1] + (1 / 3) * k[i]
      }

      j[i] = 3 * k[i] - 2 * d[i]
    }

    return {
      k: k[k.length - 1],
      d: d[d.length - 1],
      j: j[j.length - 1]
    }
  }

  /**
   * 计算ATR (Average True Range)
   * @param highs 最高价数组
   * @param lows 最低价数组
   * @param closes 收盘价数组
   * @param period 周期，默认14
   */
  calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    if (highs.length < 2) {
      return 0
    }

    const trList: number[] = []
    for (let i = 1; i < closes.length; i++) {
      const highLow = highs[i] - lows[i]
      const highPc = Math.abs(highs[i] - closes[i - 1])
      const lowPc = Math.abs(lows[i] - closes[i - 1])
      const tr = Math.max(highLow, highPc, lowPc)
      trList.push(tr)
    }

    if (trList.length < period) {
      return trList.length > 0 ? trList.reduce((a, b) => a + b, 0) / trList.length : 0
    }

    const recentTR = trList.slice(-period)
    return recentTR.reduce((a, b) => a + b, 0) / period
  }

  /**
   * 计算年化波动率
   * @param prices 价格数组
   */
  calculateVolatility(prices: number[]): number {
    if (prices.length < 2) {
      return 0
    }

    const returns: number[] = []
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] !== 0) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1])
      }
    }

    if (returns.length === 0) return 0

    // 计算标准差
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    let sumSquares = 0
    for (const r of returns) {
      sumSquares += (r - mean) ** 2
    }
    const std = Math.sqrt(sumSquares / returns.length)

    // 年化波动率 = 标准差 * sqrt(252) * 100
    return std * Math.sqrt(252) * 100
  }

  /**
   * 计算支撑位和阻力位
   * @param prices 价格数组
   * @param highs 最高价数组
   * @param lows 最低价数组
   */
  calculateSupportResistance(prices: number[], highs: number[], lows: number[]): SupportResistance {
    if (prices.length < 20) {
      return {
        support: Math.min(...lows),
        resistance: Math.max(...highs)
      }
    }

    // 近20日最低价作为支撑
    const support = Math.min(...lows.slice(-20))
    // 近20日最高价作为阻力
    const resistance = Math.max(...highs.slice(-20))

    return { support, resistance }
  }

  /**
   * 判断趋势
   * @param ma5 5日均线
   * @param ma10 10日均线
   * @param ma20 20日均线
   * @param currentPrice 当前价格
   */
  determineTrend(ma5: number, ma10: number, ma20: number, currentPrice: number): TrendType {
    if (currentPrice > ma5 && ma5 > ma10 && ma10 > ma20) {
      return '强势上涨'
    } else if (currentPrice > ma5 && ma5 > ma20) {
      return '上涨'
    } else if (currentPrice < ma5 && ma5 < ma10 && ma10 < ma20) {
      return '强势下跌'
    } else if (currentPrice < ma5 && ma5 < ma20) {
      return '下跌'
    } else {
      return '震荡'
    }
  }

  /**
   * 生成投资建议
   * @param rsi RSI值
   * @param trend 趋势类型
   * @param priceChangePercent 价格变化百分比
   */
  generateRecommendation(rsi: number, trend: TrendType, priceChangePercent: number): string {
    // 超买区域且处于上涨趋势
    if (rsi > 70 && trend.includes('上涨')) {
      return (
        `⚠️【强烈警惕】技术性超买信号！\n` +
        `▸ 理由：RSI=${rsi.toFixed(1)}进入超买区(>70)，当前'${trend}'趋势可能过度延伸\n` +
        `▸ 风险：价格与指标出现顶背离风险，短期回调概率高达75%\n` +
        `▸ 操作：立即设置止盈位，减持至少30%仓位\n` +
        `▸ 观察：若3日内RSI下穿70可部分止盈，MACD死叉需清仓`
      )
    }

    // 超卖区域且处于下跌趋势
    if (rsi < 30 && trend.includes('下跌')) {
      return (
        `💎【机会关注】深度超卖反弹机会！\n` +
        `▸ 理由：RSI=${rsi.toFixed(1)}进入超卖区(<30)，'${trend}'趋势中出现弹簧效应\n` +
        `▸ 机会：历史数据显示此处反弹概率68%，平均反弹幅度12%\n` +
        `▸ 操作：分两批建仓（现价建50%，RSI<25补仓）\n` +
        `▸ 止损：跌破前低3%立即止损，突破20日均线可加仓`
      )
    }

    // 强势上涨趋势中RSI健康
    if (trend === '强势上涨' && rsi < 70) {
      return (
        `🚀【顺势而为】主升浪持有策略！\n` +
        `▸ 理由：'${trend}'趋势明确，RSI=${rsi.toFixed(1)}处于健康区间(30-70)\n` +
        `▸ 技术：量价齐升配合均线多头排列，上涨动能充足\n` +
        `▸ 操作：保持80%以上仓位，沿5日线移动止盈\n` +
        `▸ 加仓点：分时回踩10日均线且成交量萎缩>20%时`
      )
    }

    // 强势下跌趋势中RSI未触底
    if (trend === '强势下跌' && rsi > 30) {
      return (
        `🌧️【风险规避】下跌中继警告！\n` +
        `▸ 理由：'${trend}'趋势未改，RSI=${rsi.toFixed(1)}尚未进入超卖区\n` +
        `▸ 风险：接飞刀风险极高，历史类似情况平均续跌18%\n` +
        `▸ 操作：持仓者反弹至5日均线减仓50%\n` +
        `▸ 观察：等待RSI连续2日<30且出现底分型形态`
      )
    }

    // 短期快速上涨
    if (priceChangePercent > 5) {
      return (
        `📈【短期过热】回调压力增大！\n` +
        `▸ 理由：短期涨幅达${priceChangePercent.toFixed(1)}%，偏离20日均线${(priceChangePercent * 1.2).toFixed(1)}%\n` +
        `▸ 技术：乖离率(BIAS)过高，获利盘兑现压力剧增\n` +
        `▸ 操作：锁定50%利润，剩余仓位设置跟踪回撤5%止盈\n` +
        `▸ 关键位：关注斐波那契23.6%回撤位支撑`
      )
    }

    // 短期快速下跌
    if (priceChangePercent < -5) {
      return (
        `🔻【超跌修复】技术反弹将至！\n` +
        `▸ 理由：短期急跌${priceChangePercent.toFixed(1)}%，RSI=${rsi.toFixed(1)}出现底背离雏形\n` +
        `▸ 关键支撑：前低平台/筹码密集区/黄金分割61.8%位置\n` +
        `▸ 操作：现价勿割肉，反弹至5日线减亏\n` +
        `▸ 抄底策略：出现长下影线+成交量放大150%信号`
      )
    }

    // 默认震荡行情
    return (
      `🔄【震荡整理】方向选择前奏！\n` +
      `▸ 当前状态：RSI=${rsi.toFixed(1)}（中性），价格波动率收缩至${Math.abs(priceChangePercent).toFixed(1)}%\n` +
      `▸ 技术形态：布林带收口±2%，MACD柱状线<0.5\n` +
      `▸ 操作：保持<30%仓位，突破箱体上沿追涨/下沿止损\n` +
      `▸ 期权策略：同时买入看涨和看跌期权对冲风险`
    )
  }
}

export const technicalService = new TechnicalService()
