/**
 * Portfolio Service - 投资组合服务
 *
 * 职责：
 * 1. 组合分析（配置、风险、收益、建议、评分）
 * 2. 组合CRUD操作
 * 3. 预设模板支持（永久组合、全天候组合）
 */

import { prisma } from '../../db/prisma.js'

// 预设模板配置
const PORTFOLIO_TEMPLATES = {
  // 永久组合：股票25%, 债券25%, 黄金25%, 现金25%
  permanent: {
    name: '永久组合',
    type: 'permanent',
    description: '基于Ray Dalio永久组合策略，25%股票、25%债券、25%黄金、25%现金，追求稳定收益',
    allocations: [
      { assetType: 'stock', targetRatio: 25, minRatio: 15, maxRatio: 35 },
      { assetType: 'bond', targetRatio: 25, minRatio: 15, maxRatio: 35 },
      { assetType: 'gold', targetRatio: 25, minRatio: 15, maxRatio: 35 },
      { assetType: 'cash', targetRatio: 25, minRatio: 15, maxRatio: 35 },
    ],
  },
  // 全天候组合：美国股票30%, 长期国债40%, 中期国债15%, 黄金7.5%, 大宗商品7.5%
  all_weather: {
    name: '全天候组合',
    type: 'all_weather',
    description: '基于Ray Dalio全天候策略，适应各种经济环境',
    allocations: [
      { assetType: 'stock', targetRatio: 30, minRatio: 20, maxRatio: 40 },
      { assetType: 'bond', targetRatio: 55, minRatio: 45, maxRatio: 65 }, // 长期40% + 中期15%
      { assetType: 'gold', targetRatio: 7.5, minRatio: 2.5, maxRatio: 15 },
      { assetType: 'commodity', targetRatio: 7.5, minRatio: 2.5, maxRatio: 15 },
    ],
  },
}

interface CurrentAllocation {
  totalValue: number
  byType: Array<{ type: string; value: number; ratio: number }>
  bySector: Array<{ sector: string; value: number; ratio: number }>
  byTag: Array<{ tag: string; value: number; ratio: number }>
}

interface RiskMetrics {
  volatility: number
  sharpeRatio: number
  maxDrawdown: number
  beta: number
  var95: number
  riskScore: number
  maxConcentration: number
}

interface Performance {
  totalReturn: number
  totalReturnPercent: number
  annualizedReturn: number
  benchmarkReturn: number
  outperformance: number
  bestPosition: { symbol: string; returnPercent: number } | null
  worstPosition: { symbol: string; returnPercent: number } | null
}

interface Deviation {
  type: string
  currentRatio: number
  targetRatio: number
  deviation: number
  status: 'ok' | 'warning' | 'critical'
}

interface Score {
  overall: number
  liquidity: number
  risk: number
  return: number
  diversification: number
}

interface Suggestion {
  type: 'rebalance' | 'diversification' | 'risk'
  priority: 'low' | 'medium' | 'high'
  message: string
  details: Record<string, any>
}

class PortfolioService {
  /**
   * 获取组合分析
   */
  async getAnalysis(userId: string, portfolioId?: string) {
    const portfolios = await prisma.portfolio.findMany({
      where: { userId },
      include: { allocations: true },
    })

    const targetPortfolio = portfolioId
      ? portfolios.find((p) => p.id === portfolioId)
      : portfolios[0]

    if (!targetPortfolio) {
      return { error: 'Portfolio not found' }
    }

    // 获取当前仓位
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
    })

    // 计算当前配置
    const currentAllocation = this.calculateCurrentAllocation(positions)

    // 获取目标配置
    const targetAllocation = targetPortfolio.allocations.map((a) => ({
      type: a.assetType || 'unknown',
      tagId: a.tagId,
      targetRatio: a.targetRatio,
      minRatio: a.minRatio || a.targetRatio - 10,
      maxRatio: a.maxRatio || a.targetRatio + 10,
    }))

    // 计算偏差
    const deviations = this.calculateDeviations(currentAllocation, targetAllocation)

    // 风险指标
    const riskMetrics = await this.calculateRiskMetrics(positions, currentAllocation)

    // 收益指标
    const performance = await this.calculatePerformance(positions)

    // 生成建议
    const suggestions = this.generateSuggestions(currentAllocation, targetAllocation, deviations, riskMetrics)

    // 综合评分
    const scores = this.calculateScores(riskMetrics, performance, currentAllocation, targetAllocation)

    return {
      portfolio: {
        id: targetPortfolio.id,
        name: targetPortfolio.name,
        type: targetPortfolio.type,
        totalValue: currentAllocation.totalValue,
      },
      allocation: currentAllocation,
      targetAllocation,
      deviations,
      riskMetrics,
      performance,
      suggestions,
      scores,
    }
  }

  /**
   * 计算当前配置
   */
  calculateCurrentAllocation(positions: any[]): CurrentAllocation {
    const totalValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0)

    const byType: Record<string, number> = {}
    const bySector: Record<string, number> = {}
    const byTag: Record<string, number> = {}

    for (const position of positions) {
      const value = position.marketValue || 0
      if (value <= 0) continue

      // 按资产类型
      const assetType = position.asset?.type || 'unknown'
      byType[assetType] = (byType[assetType] || 0) + value

      // 按行业
      if (position.asset?.sector) {
        bySector[position.asset.sector] = (bySector[position.asset.sector] || 0) + value
      }

      // 按标签
      try {
        const tags = typeof position.tags === 'string' ? JSON.parse(position.tags || '[]') : (position.tags || [])
        for (const tag of tags) {
          byTag[tag] = (byTag[tag] || 0) + value
        }
      } catch {
        // ignore parse errors
      }
    }

    return {
      totalValue,
      byType: Object.entries(byType).map(([type, value]) => ({
        type,
        value,
        ratio: totalValue > 0 ? (value / totalValue) * 100 : 0,
      })),
      bySector: Object.entries(bySector).map(([sector, value]) => ({
        sector,
        value,
        ratio: totalValue > 0 ? (value / totalValue) * 100 : 0,
      })),
      byTag: Object.entries(byTag).map(([tag, value]) => ({
        tag,
        value,
        ratio: totalValue > 0 ? (value / totalValue) * 100 : 0,
      })),
    }
  }

  /**
   * 计算配置偏差
   */
  calculateDeviations(current: CurrentAllocation, target: any[]): Deviation[] {
    return target.map((t) => {
      const currentItem = current.byType.find((c) => c.type === t.type)
      const currentRatio = currentItem?.ratio || 0
      const deviation = currentRatio - t.targetRatio

      const threshold = t.maxRatio !== undefined
        ? t.maxRatio - t.targetRatio
        : 5

      let status: 'ok' | 'warning' | 'critical' = 'ok'
      if (Math.abs(deviation) > threshold * 1.5) {
        status = 'critical'
      } else if (Math.abs(deviation) > threshold) {
        status = 'warning'
      }

      return {
        type: t.type,
        currentRatio,
        targetRatio: t.targetRatio,
        deviation,
        status,
      }
    })
  }

  /**
   * 计算风险指标
   */
  async calculateRiskMetrics(positions: any[], currentAllocation: CurrentAllocation): Promise<RiskMetrics> {
    if (positions.length === 0) {
      return {
        volatility: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        beta: 1,
        var95: 0,
        riskScore: 0,
        maxConcentration: 0,
      }
    }

    const totalValue = currentAllocation.totalValue

    // 计算集中度风险
    const concentrations = positions
      .map((p) => ({
        symbol: p.asset?.symbol || p.asset?.name || 'unknown',
        ratio: totalValue > 0 ? ((p.marketValue || 0) / totalValue) * 100 : 0,
      }))
      .filter((c) => c.ratio > 0)
      .sort((a, b) => b.ratio - a.ratio)

    const maxConcentration = concentrations[0]?.ratio || 0

    // 计算波动率 - 基于各资产类型历史波动率估算
    const volatility = this.estimateVolatility(currentAllocation)

    // 计算最大回撤 - 基于波动率估算
    const maxDrawdown = this.estimateMaxDrawdown(volatility)

    // 计算VaR 95%
    const var95 = totalValue * volatility * 1.645 / Math.sqrt(252)

    // 计算夏普比率 - 简化估算
    const riskFreeRate = 0.03 // 3%无风险利率
    const expectedReturn = this.estimateExpectedReturn(currentAllocation)
    const sharpeRatio = volatility > 0
      ? (expectedReturn - riskFreeRate) / volatility
      : 0

    // 计算Beta - 简化估算
    const beta = this.estimateBeta(currentAllocation)

    // 风险评分
    const concentrationRisk = Math.min(maxConcentration * 2, 40)
    const volatilityRisk = Math.min(volatility * 2, 30)
    const diversificationRisk = Math.max(0, (positions.length < 5 ? (5 - positions.length) * 5 : 0))
    const riskScore = Math.min(100, concentrationRisk + volatilityRisk + diversificationRisk)

    return {
      volatility,
      sharpeRatio,
      maxDrawdown,
      beta,
      var95,
      riskScore,
      maxConcentration,
    }
  }

  /**
   * 估算波动率 - 基于资产类型权重
   */
  private estimateVolatility(allocation: CurrentAllocation): number {
    // 各资产类型的基础波动率
    const baseVolatility: Record<string, number> = {
      stock: 0.18,    // 股票 18%
      fund: 0.15,    // 基金 15%
      bond: 0.05,    // 债券 5%
      gold: 0.12,    // 黄金 12%
      cash: 0.01,    // 现金 1%
      crypto: 0.50,  // 加密货币 50%
      etf: 0.12,     // ETF 12%
      reit: 0.15,    // REITs 15%
      commodity: 0.20, // 大宗商品 20%
    }

    let weightedVol = 0
    for (const item of allocation.byType) {
      const vol = baseVolatility[item.type] || 0.15
      const weight = item.ratio / 100
      weightedVol += vol * weight
    }

    return weightedVol
  }

  /**
   * 估算最大回撤
   */
  private estimateMaxDrawdown(volatility: number): number {
    // 简化估算：最大回撤约为波动率的2.5倍
    return -volatility * 2.5 * 100
  }

  /**
   * 估算预期收益
   */
  private estimateExpectedReturn(allocation: CurrentAllocation): number {
    // 各资产类型的预期收益
    const expectedReturns: Record<string, number> = {
      stock: 0.10,    // 股票 10%
      fund: 0.08,    // 基金 8%
      bond: 0.04,    // 债券 4%
      gold: 0.05,    // 黄金 5%
      cash: 0.02,    // 现金 2%
      crypto: 0.15,  // 加密货币 15%
      etf: 0.07,     // ETF 7%
      reit: 0.06,    // REITs 6%
      commodity: 0.03, // 大宗商品 3%
    }

    let weightedReturn = 0
    for (const item of allocation.byType) {
      const ret = expectedReturns[item.type] || 0.06
      const weight = item.ratio / 100
      weightedReturn += ret * weight
    }

    return weightedReturn
  }

  /**
   * 估算Beta
   */
  private estimateBeta(allocation: CurrentAllocation): number {
    // 各资产类型的Beta
    const betas: Record<string, number> = {
      stock: 1.0,
      fund: 0.9,
      bond: 0.2,
      gold: 0.1,
      cash: 0,
      crypto: 1.5,
      etf: 0.95,
      reit: 0.7,
      commodity: 0.6,
    }

    let weightedBeta = 0
    for (const item of allocation.byType) {
      const beta = betas[item.type] || 0.5
      const weight = item.ratio / 100
      weightedBeta += beta * weight
    }

    return weightedBeta
  }

  /**
   * 计算收益指标
   */
  async calculatePerformance(positions: any[]): Promise<Performance> {
    const totalValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0)
    const totalCost = positions.reduce((sum, p) => sum + (p.costBasis || 0), 0)
    const totalPnl = totalValue - totalCost
    const totalReturnPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

    // 持仓时长估算（天）
    const avgDays = positions.length > 0
      ? positions.reduce((sum, p) => {
          const openedAt = p.openedAt ? new Date(p.openedAt).getTime() : Date.now()
          return sum + (Date.now() - openedAt)
        }, 0) / positions.length / (24 * 60 * 60 * 1000)
      : 0

    // 年化收益率
    const annualizedReturn = avgDays > 30
      ? totalReturnPercent * (365 / avgDays)
      : totalReturnPercent * 4 // 季度年化

    // 基准收益（简单使用沪深300年化约10%）
    const benchmarkReturn = 10.5
    const outperformance = annualizedReturn - benchmarkReturn

    // 最佳/最差持仓
    const withReturns = positions.map((p) => ({
      symbol: p.asset?.symbol || p.asset?.name || 'unknown',
      returnPercent: p.costBasis > 0
        ? (((p.marketValue || 0) - p.costBasis) / p.costBasis) * 100
        : 0,
    }))

    const sorted = [...withReturns].sort((a, b) => b.returnPercent - a.returnPercent)

    return {
      totalReturn: totalPnl,
      totalReturnPercent,
      annualizedReturn,
      benchmarkReturn,
      outperformance,
      bestPosition: sorted[0] || null,
      worstPosition: sorted[sorted.length - 1] || null,
    }
  }

  /**
   * 生成建议
   */
  generateSuggestions(
    current: CurrentAllocation,
    _target: any[],
    deviations: Deviation[],
    riskMetrics: RiskMetrics
  ): Suggestion[] {
    const suggestions: Suggestion[] = []

    // 再平衡建议
    for (const dev of deviations) {
      if (dev.status === 'warning' || dev.status === 'critical') {
        const priority = dev.status === 'critical' ? 'high' : 'medium'
        const action = dev.deviation > 0 ? '减仓' : '加仓'
        suggestions.push({
          type: 'rebalance',
          priority,
          message: `${dev.type}仓位偏离目标${Math.abs(dev.deviation).toFixed(1)}%，建议${action}`,
          details: {
            currentRatio: dev.currentRatio,
            targetRatio: dev.targetRatio,
            action: dev.deviation > 0 ? 'reduce' : 'add',
            amount: Math.abs(dev.deviation) / 100 * current.totalValue,
          },
        })
      }
    }

    // 集中度风险提示
    if (riskMetrics.maxConcentration > 30) {
      suggestions.push({
        type: 'diversification',
        priority: riskMetrics.maxConcentration > 50 ? 'high' : 'medium',
        message: `组合集中度较高，${riskMetrics.maxConcentration.toFixed(1)}%配置在单一资产`,
        details: {
          currentConcentration: riskMetrics.maxConcentration,
          targetConcentration: 30,
          action: '建议分散配置',
        },
      })
    }

    // 波动率风险提示
    if (riskMetrics.volatility > 0.25) {
      suggestions.push({
        type: 'risk',
        priority: 'medium',
        message: `组合波动率较高（${(riskMetrics.volatility * 100).toFixed(1)}%），建议增加低波动资产`,
        details: {
          currentVolatility: riskMetrics.volatility,
          targetVolatility: 0.15,
        },
      })
    }

    // VaR风险提示
    if (riskMetrics.var95 > current.totalValue * 0.1) {
      suggestions.push({
        type: 'risk',
        priority: 'high',
        message: `组合VaR（95%）较高，可能面临较大损失`,
        details: {
          var95: riskMetrics.var95,
          var95Percent: (riskMetrics.var95 / current.totalValue) * 100,
        },
      })
    }

    return suggestions
  }

  /**
   * 计算综合评分
   */
  calculateScores(
    riskMetrics: RiskMetrics,
    performance: Performance,
    current: CurrentAllocation,
    _target: any[]
  ): Score {
    // 流动性评分（基于现金比例）
    const cashRatio = current.byType.find((t) => t.type === 'cash')?.ratio || 0
    const liquidityScore = Math.min(100, cashRatio * 4 + 20)

    // 风险评分（基于风险指标）
    const volatilityScore = Math.max(0, 100 - riskMetrics.volatility * 400)
    const concentrationScore = Math.max(0, 100 - riskMetrics.maxConcentration * 2)
    const riskScore = Math.round(volatilityScore * 0.5 + concentrationScore * 0.5)

    // 收益评分
    const returnScore = Math.min(100, Math.max(0, (performance.annualizedReturn + 20) * 3))

    // 分散化评分
    const typeCount = current.byType.length
    const diversificationScore = Math.min(100, typeCount * 15 + 10)

    // 综合评分：流动性20%, 风险30%, 收益30%, 分散化20%
    const overall = Math.round(
      liquidityScore * 0.2 +
      riskScore * 0.3 +
      returnScore * 0.3 +
      diversificationScore * 0.2
    )

    return {
      overall,
      liquidity: Math.round(liquidityScore),
      risk: Math.round(riskScore),
      return: Math.round(returnScore),
      diversification: Math.round(diversificationScore),
    }
  }

  /**
   * 获取组合列表
   */
  async getPortfolios(userId: string) {
    const portfolios = await prisma.portfolio.findMany({
      where: { userId },
      include: { allocations: true },
    })

    // 获取每个组合的当前价值
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
    })

    const totalValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0)

    return portfolios.map((p) => ({
      ...p,
      currentValue: totalValue,
      allocationCount: p.allocations.length,
    }))
  }

  /**
   * 创建组合
   */
  async createPortfolio(
    userId: string,
    data: {
      name: string
      type: string
      description?: string
      template?: 'permanent' | 'all_weather' | 'custom'
      allocations?: Array<{
        assetType?: string
        tagId?: string
        targetRatio: number
        minRatio?: number
        maxRatio?: number
      }>
    }
  ) {
    // 如果指定了模板，使用模板配置
    if (data.template && PORTFOLIO_TEMPLATES[data.template as keyof typeof PORTFOLIO_TEMPLATES]) {
      const template = PORTFOLIO_TEMPLATES[data.template as keyof typeof PORTFOLIO_TEMPLATES]
      const portfolio = await prisma.portfolio.create({
        data: {
          userId,
          name: data.name || template.name,
          type: data.type || template.type,
          description: data.description || template.description,
          config: JSON.stringify({ template: data.template }),
          allocations: {
            create: template.allocations.map((a) => ({
              assetType: a.assetType,
              targetRatio: a.targetRatio,
              minRatio: a.minRatio,
              maxRatio: a.maxRatio,
            })),
          },
        },
        include: { allocations: true },
      })
      return portfolio
    }

    // 自定义组合
    if (!data.allocations || data.allocations.length === 0) {
      throw new Error('Custom portfolio requires allocations')
    }

    const totalRatio = data.allocations.reduce((sum, a) => sum + a.targetRatio, 0)
    if (Math.abs(totalRatio - 100) > 0.1) {
      throw new Error('Allocations must sum to 100%')
    }

    const portfolio = await prisma.portfolio.create({
      data: {
        userId,
        name: data.name,
        type: data.type || 'custom',
        description: data.description,
        config: JSON.stringify({ template: 'custom' }),
        allocations: {
          create: data.allocations.map((a) => ({
            assetType: a.assetType,
            tagId: a.tagId,
            targetRatio: a.targetRatio,
            minRatio: a.minRatio || a.targetRatio - 5,
            maxRatio: a.maxRatio || a.targetRatio + 5,
          })),
        },
      },
      include: { allocations: true },
    })

    return portfolio
  }

  /**
   * 更新组合
   */
  async updatePortfolio(
    portfolioId: string,
    data: {
      name?: string
      description?: string
      allocations?: Array<{
        assetType?: string
        tagId?: string
        targetRatio: number
        minRatio?: number
        maxRatio?: number
      }>
    }
  ) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
    })

    if (!portfolio) {
      throw new Error('Portfolio not found')
    }

    // 更新 allocations 需要先删除旧的
    if (data.allocations) {
      await prisma.portfolioAllocation.deleteMany({
        where: { portfolioId },
      })
    }

    const updated = await prisma.portfolio.update({
      where: { id: portfolioId },
      data: {
        name: data.name,
        description: data.description,
        allocations: data.allocations ? {
          create: data.allocations.map((a) => ({
            assetType: a.assetType,
            tagId: a.tagId,
            targetRatio: a.targetRatio,
            minRatio: a.minRatio,
            maxRatio: a.maxRatio,
          })),
        } : undefined,
      },
      include: { allocations: true },
    })

    return updated
  }

  /**
   * 删除组合
   */
  async deletePortfolio(portfolioId: string) {
    await prisma.portfolioAllocation.deleteMany({
      where: { portfolioId },
    })

    return prisma.portfolio.delete({
      where: { id: portfolioId },
    })
  }

  /**
   * 获取预设模板列表
   */
  getTemplates() {
    return Object.entries(PORTFOLIO_TEMPLATES).map(([key, value]) => ({
      id: key,
      name: value.name,
      type: value.type,
      description: value.description,
      allocations: value.allocations,
    }))
  }
}

export const portfolioService = new PortfolioService()
