/**
 * Alert Service - 告警服务
 *
 * 职责：
 * 1. 告警 CRUD 操作
 * 2. 风险告警检查与生成
 * 3. 仓位限制检查
 * 4. 通知发送（预留接口）
 * 5. 自动风险检查调度
 */

import { prisma } from '../../db/prisma.js'
import { positionService } from '../position/positionService.js'
import { ensureUser } from '../../utils/user.js'
import { getChinaIndexHistory, resolveChinaIndexIdentity, StockHistoryData } from '../../utils/stockUtils.js'

// 告警类型
export type AlertType = 'price' | 'risk' | 'rebalance' | 'market'

// 告警严重级别
export type AlertSeverity = 'info' | 'warning' | 'danger'

// 告警状态
export type AlertStatus = 'active' | 'acknowledged' | 'resolved'

// 告警筛选条件
export interface AlertFilters {
  status?: AlertStatus
  severity?: AlertSeverity
  type?: AlertType
}

// 告警数据
export interface AlertData {
  userId: string
  type: AlertType
  title: string
  message: string
  severity: AlertSeverity
  assetSymbol?: string
}

export interface MarketWatchRuleInput {
  id?: string
  symbol: string
  name?: string
  thresholdPercent: number
  windowDays?: number
  enabled?: boolean
}

export interface MarketWatchRuleDto {
  id: string
  symbol: string
  name: string
  thresholdPercent: number
  windowDays: number
  enabled: boolean
  updatedAt: Date
  lastTriggeredAt?: Date | null
}

export interface MarketWatchEvaluation {
  ruleId: string
  symbol: string
  name: string
  thresholdPercent: number
  windowDays: number
  enabled: boolean
  latestPrice: number | null
  latestDate: string | null
  peakPrice: number | null
  peakDate: string | null
  drawdownPercent: number | null
  triggered: boolean
  severity: AlertSeverity
  source: string
  dataStatus: 'ok' | 'error'
  message: string
}

// 仓位数据（用于风险检查）
export interface RiskCheckPosition {
  asset: {
    symbol: string
    name?: string
  }
  marketValue?: number
  costBasis?: number | null
  unrealizedPnl?: number | null
  currentPrice?: number
  avgCost?: number
  stopLoss?: number | null
  takeProfit?: number | null
}

// VaR 配置
interface VaRConfig {
  confidenceLevel: number  // 置信度，如 0.95
  timeHorizon: number      // 时间范围（天）
}

class AlertService {
  // 默认 VaR 配置
  private defaultVaRConfig: VaRConfig = {
    confidenceLevel: 0.95,
    timeHorizon: 1,
  }

  private getPositionReturnPercent(position: RiskCheckPosition) {
    const costBasis = position.costBasis || 0
    if (costBasis > 0 && position.unrealizedPnl !== null && position.unrealizedPnl !== undefined) {
      return (position.unrealizedPnl / costBasis) * 100
    }
    if (costBasis > 0 && position.marketValue !== null && position.marketValue !== undefined) {
      return ((position.marketValue - costBasis) / costBasis) * 100
    }
    if ((position.avgCost || 0) > 0 && (position.currentPrice || 0) > 0) {
      return ((position.currentPrice! - position.avgCost!) / position.avgCost!) * 100
    }
    return 0
  }

  // 仓位集中度警告阈值（%）
  private positionConcentrationLimit = 30

  private marketDrawdownRuleType = 'market_drawdown'

  private defaultMarketWatchRules: MarketWatchRuleInput[] = [
    { symbol: '000001.SH', name: '上证指数', thresholdPercent: 10, windowDays: 250, enabled: true },
    { symbol: '000300.SH', name: '沪深300', thresholdPercent: 10, windowDays: 250, enabled: true },
    { symbol: '000905.SH', name: '中证500', thresholdPercent: 10, windowDays: 250, enabled: true },
    { symbol: '000852.SH', name: '中证1000', thresholdPercent: 10, windowDays: 250, enabled: true },
    { symbol: '399006.SZ', name: '创业板指', thresholdPercent: 10, windowDays: 250, enabled: true },
    { symbol: '000688.SH', name: '科创50', thresholdPercent: 10, windowDays: 250, enabled: true },
  ]

  private parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  private buildMarketWatchRuleConfig(input: MarketWatchRuleInput) {
    const identity = resolveChinaIndexIdentity(input.symbol, input.name)
    if (!identity) {
      throw new Error(`暂不支持的宽基指数代码：${input.symbol}`)
    }

    const thresholdPercent = Number(input.thresholdPercent)
    if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0 || thresholdPercent > 80) {
      throw new Error('回撤阈值必须在 0 到 80 之间')
    }

    const windowDays = Math.round(Number(input.windowDays || 250))
    if (!Number.isFinite(windowDays) || windowDays < 30 || windowDays > 1000) {
      throw new Error('观察窗口必须在 30 到 1000 个交易日之间')
    }

    return {
      symbol: identity.symbol,
      name: input.name || identity.name,
      sinaSymbol: identity.sinaSymbol,
      exchange: identity.exchange,
      thresholdPercent,
      windowDays,
      enabled: input.enabled !== false,
    }
  }

  private toMarketWatchRuleDto(rule: {
    id: string
    thresholdValue: number | null
    enabled: boolean
    lastTriggeredAt: Date | null
    updatedAt: Date
    comparisonConfigJson: string
  }): MarketWatchRuleDto {
    const config = this.parseJson<Record<string, any>>(rule.comparisonConfigJson, {})
    return {
      id: rule.id,
      symbol: String(config.symbol || ''),
      name: String(config.name || config.symbol || ''),
      thresholdPercent: Number(rule.thresholdValue ?? config.thresholdPercent ?? 10),
      windowDays: Number(config.windowDays || 250),
      enabled: rule.enabled,
      updatedAt: rule.updatedAt,
      lastTriggeredAt: rule.lastTriggeredAt,
    }
  }

  private computeDrawdown(rule: MarketWatchRuleDto, history: StockHistoryData[]): MarketWatchEvaluation {
    const rows = history
      .filter((row) => row.close > 0 && row.high > 0 && row.date)
      .slice(-rule.windowDays)

    if (rows.length < Math.min(20, rule.windowDays)) {
      return {
        ruleId: rule.id,
        symbol: rule.symbol,
        name: rule.name,
        thresholdPercent: rule.thresholdPercent,
        windowDays: rule.windowDays,
        enabled: rule.enabled,
        latestPrice: null,
        latestDate: null,
        peakPrice: null,
        peakDate: null,
        drawdownPercent: null,
        triggered: false,
        severity: 'info',
        source: 'sina',
        dataStatus: 'error',
        message: `历史行情不足，无法计算 ${rule.windowDays} 日回撤`,
      }
    }

    const latest = rows[rows.length - 1]
    const peak = rows.reduce((best, row) => row.high > best.high ? row : best, rows[0])
    const drawdownPercent = peak.high > 0 ? ((peak.high - latest.close) / peak.high) * 100 : 0
    const triggered = rule.enabled && drawdownPercent >= rule.thresholdPercent
    const severity: AlertSeverity = drawdownPercent >= Math.max(rule.thresholdPercent + 10, 20)
      ? 'danger'
      : triggered
        ? 'warning'
        : 'info'

    return {
      ruleId: rule.id,
      symbol: rule.symbol,
      name: rule.name,
      thresholdPercent: rule.thresholdPercent,
      windowDays: rule.windowDays,
      enabled: rule.enabled,
      latestPrice: Number(latest.close.toFixed(3)),
      latestDate: latest.date,
      peakPrice: Number(peak.high.toFixed(3)),
      peakDate: peak.date,
      drawdownPercent: Number(drawdownPercent.toFixed(2)),
      triggered,
      severity,
      source: 'sina',
      dataStatus: 'ok',
      message: triggered
        ? `${rule.name}从${rule.windowDays}日高点回撤${drawdownPercent.toFixed(2)}%，达到${rule.thresholdPercent.toFixed(2)}%建仓提醒阈值`
        : `${rule.name}当前回撤${drawdownPercent.toFixed(2)}%，未达到${rule.thresholdPercent.toFixed(2)}%阈值`,
    }
  }

  private async ensureDefaultMarketWatchRules(userId: string) {
    await ensureUser(prisma, userId)

    const count = await prisma.alertRule.count({
      where: { userId, ruleType: this.marketDrawdownRuleType },
    })

    if (count > 0) return

    await prisma.alertRule.createMany({
      data: this.defaultMarketWatchRules.map((input) => {
        const config = this.buildMarketWatchRuleConfig(input)
        return {
          userId,
          ruleType: this.marketDrawdownRuleType,
          thresholdValue: config.thresholdPercent,
          comparisonConfigJson: JSON.stringify(config),
          enabled: config.enabled,
        }
      }),
    })
  }

  /**
   * 获取告警列表
   * 支持按 status/severity/type 筛选，按时间倒序返回
   */
  async getAlerts(userId: string, filters: AlertFilters = {}) {
    const where: any = { userId }

    if (filters.status) where.status = filters.status
    if (filters.severity) where.severity = filters.severity
    if (filters.type) where.type = filters.type

    return prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
  }

  async getMarketWatchRules(userId: string): Promise<MarketWatchRuleDto[]> {
    await this.ensureDefaultMarketWatchRules(userId)

    const rules = await prisma.alertRule.findMany({
      where: { userId, ruleType: this.marketDrawdownRuleType },
      orderBy: { createdAt: 'asc' },
    })

    return rules.map((rule) => this.toMarketWatchRuleDto(rule))
  }

  async replaceMarketWatchRules(userId: string, inputs: MarketWatchRuleInput[]): Promise<MarketWatchRuleDto[]> {
    await ensureUser(prisma, userId)

    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new Error('至少需要配置一个监控标的')
    }

    const configs = inputs.map((input) => this.buildMarketWatchRuleConfig(input))
    const uniqueSymbols = new Set(configs.map((config) => config.symbol))
    if (uniqueSymbols.size !== configs.length) {
      throw new Error('监控标的不能重复')
    }

    await prisma.$transaction(async (tx) => {
      await tx.alertRule.deleteMany({
        where: { userId, ruleType: this.marketDrawdownRuleType },
      })

      await tx.alertRule.createMany({
        data: configs.map((config) => ({
          userId,
          ruleType: this.marketDrawdownRuleType,
          thresholdValue: config.thresholdPercent,
          comparisonConfigJson: JSON.stringify(config),
          enabled: config.enabled,
        })),
      })
    })

    return this.getMarketWatchRules(userId)
  }

  async evaluateMarketWatch(userId: string): Promise<MarketWatchEvaluation[]> {
    const rules = await this.getMarketWatchRules(userId)
    const enabledRules = rules.filter((rule) => rule.enabled)

    return Promise.all(enabledRules.map(async (rule) => {
      try {
        const history = await getChinaIndexHistory(rule.symbol, rule.windowDays)
        return this.computeDrawdown(rule, history)
      } catch (error) {
        return {
          ruleId: rule.id,
          symbol: rule.symbol,
          name: rule.name,
          thresholdPercent: rule.thresholdPercent,
          windowDays: rule.windowDays,
          enabled: rule.enabled,
          latestPrice: null,
          latestDate: null,
          peakPrice: null,
          peakDate: null,
          drawdownPercent: null,
          triggered: false,
          severity: 'info',
          source: 'sina',
          dataStatus: 'error',
          message: error instanceof Error ? error.message : '宽基行情获取失败',
        } satisfies MarketWatchEvaluation
      }
    }))
  }

  async checkAndGenerateMarketWatchAlerts(userId: string): Promise<string[]> {
    const evaluations = await this.evaluateMarketWatch(userId)
    const triggeredSymbols: string[] = []

    for (const item of evaluations) {
      if (!item.triggered || item.drawdownPercent === null) continue

      const alert = await this.createAlert({
        userId,
        type: 'market',
        title: `${item.name}回撤触发建仓提醒`,
        message: `${item.message}。当前点位${item.latestPrice}，${item.windowDays}日高点${item.peakPrice}（${item.peakDate}）。`,
        severity: item.severity,
        assetSymbol: item.symbol,
      })

      await prisma.alertRule.update({
        where: { id: item.ruleId },
        data: { lastTriggeredAt: new Date() },
      })

      const existingEvent = await prisma.alertEvent.findFirst({
        where: {
          alertRuleId: item.ruleId,
          status: 'unread',
          message: item.message,
        },
      })

      if (!existingEvent) {
        await prisma.alertEvent.create({
          data: {
            alertRuleId: item.ruleId,
            userId,
            message: item.message,
            severity: item.severity,
            status: 'unread',
          },
        })
      }

      triggeredSymbols.push(alert.assetSymbol || item.symbol)
    }

    return [...new Set(triggeredSymbols)]
  }

  /**
   * 获取单个告警详情
   */
  async getAlert(alertId: string) {
    return prisma.alert.findUnique({
      where: { id: alertId },
    })
  }

  /**
   * 创建告警
   * 自动设置 triggeredAt
   * 支持关联资产 symbol
   */
  async createAlert(data: AlertData) {
    await ensureUser(prisma, data.userId)

    const existingActiveAlert = await prisma.alert.findFirst({
      where: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        assetSymbol: data.assetSymbol || null,
        status: 'active',
      },
    })

    if (existingActiveAlert) {
      return existingActiveAlert
    }

    const alert = await prisma.alert.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        severity: data.severity,
        assetSymbol: data.assetSymbol,
        status: 'active',
        triggeredAt: new Date(),
      },
    })

    // 触发通知
    await this.sendNotification(alert)

    return alert
  }

  /**
   * 确认告警
   * 设置 acknowledgedAt
   */
  async acknowledgeAlert(alertId: string) {
    return prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
      },
    })
  }

  /**
   * 解决告警
   * 设置 status 为 resolved
   */
  async resolveAlert(alertId: string) {
    return prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'resolved',
      },
    })
  }

  /**
   * 删除告警
   */
  async deleteAlert(alertId: string) {
    return prisma.alert.delete({
      where: { id: alertId },
    })
  }

  /**
   * 检查仓位限制
   * 检查仓位占比是否超限
   * @returns 警告信息，如果正常返回 null
   */
  checkPositionLimits(position: RiskCheckPosition, totalValue: number): string | null {
    if (!position.marketValue || totalValue <= 0) {
      return null
    }

    const ratio = (position.marketValue / totalValue) * 100

    if (ratio > this.positionConcentrationLimit) {
      return `${position.asset.symbol}仓位占比${ratio.toFixed(1)}%，超过${this.positionConcentrationLimit}%上限`
    }

    return null
  }

  /**
   * 检查并生成风险告警
   * 检查：
   * 1. 单票仓位限制（默认30%上限）
   * 2. 止损触发
   * 3. 止盈触发
   * 4. VaR 风险
   */
  async checkAndGenerateRiskAlerts(
    userId: string,
    positions: RiskCheckPosition[],
    varConfig?: VaRConfig
  ): Promise<string[]> {
    const alertedSymbols: string[] = []
    const config = { ...this.defaultVaRConfig, ...varConfig }

    // 计算总市值
    const totalValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0)

    for (const position of positions) {
      // 1. 检查单票仓位限制
      const concentrationWarning = this.checkPositionLimits(position, totalValue)
      if (concentrationWarning) {
        await this.createAlert({
          userId,
          type: 'risk',
          title: '仓位集中度过高',
          message: concentrationWarning,
          severity: 'danger',
          assetSymbol: position.asset.symbol,
        })
        alertedSymbols.push(position.asset.symbol)
      }

      const returnPercent = this.getPositionReturnPercent(position)

      // 2. 检查止损触发：stopLoss 存储收益率阈值，例如 -5 表示亏损 5%。
      if (
        position.stopLoss !== null &&
        position.stopLoss !== undefined &&
        returnPercent <= position.stopLoss
      ) {
        await this.createAlert({
          userId,
          type: 'risk',
          title: '触及止损线',
          message: `${position.asset.symbol}当前收益率${returnPercent.toFixed(2)}%低于止损阈值${position.stopLoss.toFixed(2)}%`,
          severity: 'danger',
          assetSymbol: position.asset.symbol,
        })
        alertedSymbols.push(position.asset.symbol)
      }

      // 3. 检查止盈触发：takeProfit 存储收益率阈值，例如 5 表示盈利 5%。
      if (
        position.takeProfit !== null &&
        position.takeProfit !== undefined &&
        returnPercent >= position.takeProfit
      ) {
        await this.createAlert({
          userId,
          type: 'risk',
          title: '触及止盈线',
          message: `${position.asset.symbol}当前收益率${returnPercent.toFixed(2)}%高于止盈阈值${position.takeProfit.toFixed(2)}%`,
          severity: 'warning',
          assetSymbol: position.asset.symbol,
        })
        alertedSymbols.push(position.asset.symbol)
      }

      // 4. 检查 VaR 风险（简化版）
      if (position.marketValue && position.avgCost && totalValue > 0) {
        const varResult = this.calculateSimpleVaR(
          position.avgCost,
          position.currentPrice || position.avgCost,
          position.marketValue,
          config
        )
        if (varResult.riskLevel === 'high') {
          await this.createAlert({
            userId,
            type: 'risk',
            title: 'VaR 风险警告',
            message: `${position.asset.symbol}持仓风险较高，预计日内最大损失${varResult.lossPercent.toFixed(2)}%`,
            severity: 'warning',
            assetSymbol: position.asset.symbol,
          })
          alertedSymbols.push(position.asset.symbol)
        }
      }
    }

    return [...new Set(alertedSymbols)] // 去重
  }

  /**
   * 简化 VaR 计算
   * 基于持仓波动率估算日内最大损失
   */
  private calculateSimpleVaR(
    avgCost: number,
    currentPrice: number,
    _marketValue: number,
    _config: VaRConfig
  ): { riskLevel: 'low' | 'medium' | 'high'; lossPercent: number } {
    // 简化假设：日波动率约为 (当前价 - 成本价) / 成本价的绝对值
    const priceChangeRatio = Math.abs((currentPrice - avgCost) / avgCost)

    // 假设波动率与持仓规模成正比（简化模型）
    // 实际应使用历史波动率
    const dailyVolatility = Math.max(priceChangeRatio, 0.02) // 最小 2% 波动率

    // 简化 VaR 计算
    const varPercent = dailyVolatility * 1.65 // 95% 置信度对应 1.65 个标准差

    let riskLevel: 'low' | 'medium' | 'high' = 'low'
    if (varPercent > 5) {
      riskLevel = 'high'
    } else if (varPercent > 3) {
      riskLevel = 'medium'
    }

    return {
      riskLevel,
      lossPercent: varPercent,
    }
  }

  /**
   * 发送通知
   * 预留接口，可扩展为邮件/WebSocket/Push
   */
  async sendNotification(alert: any): Promise<void> {
    // TODO: 实现通知发送逻辑
    // 1. 邮件通知
    // 2. WebSocket 实时推送
    // 3. Push 推送
    // 4. 短信通知

    console.log(`[Alert Notification] ${alert.severity.toUpperCase()}: ${alert.title} - ${alert.message}`)

    // 预留：实际实现时可以根据 alert.severity 选择通知渠道
    // if (alert.severity === 'danger') {
    //   await this.sendEmailNotification(alert)
    //   await this.sendPushNotification(alert)
    // }
  }

  /**
   * 执行自动风险检查
   * 与 positionService 集成，定期检查用户仓位风险
   */
  async runAutoRiskCheck(userId: string, options: { refreshPrices?: boolean } = {}): Promise<string[]> {
    // 1. 默认刷新仓位价格；交易后可跳过，直接检查刚写入的成交价/持仓价。
    if (options.refreshPrices !== false) {
      await positionService.refreshPositionPrices(userId)
    }

    // 2. 获取当前仓位
    const positionsResult = await positionService.getPositions(userId, { status: 'open' })
    const positions = positionsResult.data

    // 3. 执行持仓风险检查与市场机会提醒
    const alertedSymbols = await this.checkAndGenerateRiskAlerts(userId, positions)
    const marketAlertedSymbols = await this.checkAndGenerateMarketWatchAlerts(userId)

    return [...new Set([...alertedSymbols, ...marketAlertedSymbols])]
  }

  /**
   * 获取活跃告警数量
   */
  async getActiveAlertCount(userId: string): Promise<number> {
    return prisma.alert.count({
      where: {
        userId,
        status: 'active',
      },
    })
  }

  /**
   * 获取未读告警（活跃告警）
   */
  async getUnreadAlerts(userId: string, limit: number = 10) {
    return prisma.alert.findMany({
      where: {
        userId,
        status: 'active',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  /**
   * 批量确认告警
   */
  async acknowledgeAlerts(alertIds: string[]) {
    return prisma.alert.updateMany({
      where: { id: { in: alertIds } },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
      },
    })
  }

  /**
   * 批量解决告警
   */
  async resolveAlerts(alertIds: string[]) {
    return prisma.alert.updateMany({
      where: { id: { in: alertIds } },
      data: {
        status: 'resolved',
      },
    })
  }
}

export const alertService = new AlertService()
