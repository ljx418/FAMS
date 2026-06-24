/**
 * Position Service - 仓位服务
 *
 * 职责：
 * 1. 仓位CRUD操作
 * 2. 仓位汇总计算
 * 3. 止损止盈计算
 * 4. 仓位标签管理
 * 5. 自动标签系统
 */

import { prisma } from '../../db/prisma.js'
import { priceService } from '../price/priceService.js'
import { ensureUser } from '../../utils/user.js'
import { assetIdentityResolver } from '../asset/assetIdentityResolver.js'
import { transactionService } from '../transaction/transactionService.js'

interface PositionFilters {
  status?: 'open' | 'closed' | 'pending'
  assetType?: string
  tags?: string[] | string
  labels?: string[] | string
  sortBy?: 'created_at' | 'unrealized_pnl' | 'market_value'
  order?: 'asc' | 'desc'
  page?: number
  limit?: number
}

export interface PositionSummary {
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPercent: number
  positionsCount: number
  cashValue: number
  cashWeight: number
}

// 自动标签映射表
const ASSET_TYPE_TAGS: Record<string, string[]> = {
  stock: ['股票', '权益类'],
  fund: ['基金'],
  bond: ['债券', '固定收益'],
  gold: ['黄金', '贵金属'],
  cash: ['现金', '货币'],
  crypto: ['加密货币', '数字资产'],
  etf: ['ETF', '交易所交易基金'],
  reit: ['REIT', '房地产投资信托'],
}

const ASSET_TYPE_BY_TAG: Record<string, string> = {
  股票: 'stock',
  基金: 'fund',
  债券: 'bond',
  黄金: 'gold',
  现金: 'cash',
  ETF: 'etf',
  交易所交易基金: 'etf',
  REIT: 'reit',
}

class PositionService {
  getOpenPositionKey(userId: string, assetId: string) {
    return `${userId}:${assetId}`
  }

  private isBoardLotAssetType(type?: string | null) {
    return type === 'stock' || type === 'etf'
  }

  private normalizeManualQuantity(assetType: string, quantity: number) {
    if (!this.isBoardLotAssetType(assetType)) return quantity
    return Math.floor(quantity / 100) * 100
  }

  private assertClose(actual: number, expected: number, message: string, tolerance = 0.01) {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}: expected ${expected}, got ${actual}`)
    }
  }

  private async getSystemEditablePrice(asset: { symbol: string; type: string }, fallbackPrice?: number | null) {
    if (asset.type === 'cash') return 1

    try {
      const quote = await priceService.getRealTimePrice(asset.symbol, 'auto', asset.type)
      if (quote.isValid && quote.price > 0) {
        return quote.price
      }
    } catch {
      // 编辑保存不能静默改价；外部行情短暂失败时只允许沿用已有可信价。
    }

    if (fallbackPrice && fallbackPrice > 0) {
      return fallbackPrice
    }
    throw new Error('未获取到系统现价/净值，不能保存持仓编辑')
  }

  private isExchangeTradedFundCode(symbol: string): boolean {
    return /^(159|510|511|512|513|515|516|517|518|520|560|561|562|563|588|589)\d{3}$/.test(symbol)
  }

  private shouldPreserveManualMarketValue(
    position: {
      asset: { type: string; symbol: string }
      quantity: number
      costBasis: number | null
      marketValue: number | null
    },
    currentPrice: number,
  ): boolean {
    if (position.asset.type !== 'fund' && position.asset.type !== 'bond') {
      return false
    }
    if (this.isExchangeTradedFundCode(position.asset.symbol)) {
      return false
    }
    if (!position.marketValue || position.marketValue <= 0) {
      return false
    }

    const quantity = position.quantity || 0
    const expectedMarketValue = quantity * currentPrice
    const costBasis = position.costBasis || 0

    // 手工总额资产通常导入为 1 份，净值只作参考价，不能直接替代总市值。
    if (quantity <= 1) {
      return true
    }
    if (costBasis > 0 && expectedMarketValue > 0 && expectedMarketValue / costBasis < 0.05) {
      return true
    }

    return false
  }

  private inferAssetTypeFromTags(tags: string[]): string | null {
    for (const tag of [...tags].reverse()) {
      const assetType = ASSET_TYPE_BY_TAG[tag]
      if (assetType) return assetType
    }
    return null
  }

  private normalizeStringArray(input: unknown): string[] {
    if (Array.isArray(input)) {
      return [...new Set(input.flatMap((item) => this.normalizeStringArray(item)))]
    }

    if (typeof input !== 'string') {
      return []
    }

    const trimmed = input.trim()
    if (!trimmed) {
      return []
    }

    if (trimmed.startsWith('[')) {
      try {
        return this.normalizeStringArray(JSON.parse(trimmed))
      } catch {
        // Fall through to comma parsing for malformed legacy data.
      }
    }

    return [...new Set(trimmed.split(',').map((item) => item.trim()).filter(Boolean))]
  }

  private normalizeStopTrigger(value: number | null | undefined): number | null | undefined {
    if (value === undefined) return undefined
    // Fastify/AJV may coerce explicit JSON null to 0 for nullable numeric fields.
    // Stop/take thresholds are return percentages; keep negative stop-loss values,
    // but treat 0 as "not configured" until a dedicated AlertRule model exists.
    if (value === null || !Number.isFinite(value) || value === 0) return null
    return value
  }

  private parseJsonStringArray(input: unknown): string[] {
    if (Array.isArray(input)) {
      return this.normalizeStringArray(input)
    }
    if (typeof input !== 'string') {
      return []
    }

    try {
      return this.normalizeStringArray(JSON.parse(input || '[]'))
    } catch {
      return this.normalizeStringArray(input)
    }
  }

  private inferTagColor(tagName: string): string {
    const colorMap: Record<string, string> = {
      'A股': '#5470C6',
      '港股': '#95DE64',
      '美股': '#FF9F7F',
      '新能源': '#95DE64',
      '科技': '#5A6BFF',
      '医药': '#EE6666',
      '消费': '#FAC858',
      '金融': '#7262FD',
      '地产': '#D0D0D0',
      '黄金': '#FFD700',
      '基金': '#36CFC9',
      '债券': '#A0A0A0',
      '股票': '#5470C6',
      '现金': '#38BDF8',
      'ETF': '#36CFC9',
    }
    return colorMap[tagName] || '#5A6BFF'
  }

  private async syncAssetTags(assetId: string, tags: string[]) {
    const uniqueTags = this.normalizeStringArray(tags)
    await prisma.$transaction(async (tx) => {
      const retainedTagIds: string[] = []

      for (const tagName of uniqueTags) {
        const tag = await tx.tag.upsert({
          where: { name: tagName },
          create: {
            name: tagName,
            color: this.inferTagColor(tagName),
          },
          update: {},
        })
        retainedTagIds.push(tag.id)

        await tx.assetTag.upsert({
          where: { assetId_tagId: { assetId, tagId: tag.id } },
          create: { assetId, tagId: tag.id },
          update: {},
        })
      }

      await tx.assetTag.deleteMany({
        where: {
          assetId,
          tagId: retainedTagIds.length > 0 ? { notIn: retainedTagIds } : undefined,
        },
      })
    })
  }

  private async getUserSettings(userId: string) {
    const user = await ensureUser(prisma, userId)

    try {
      return JSON.parse(user.settings || '{}')
    } catch {
      return {}
    }
  }

  async getPositionTargets(userId: string) {
    const settings = await this.getUserSettings(userId)
    return settings.positionTargets || {}
  }

  async updatePositionTarget(userId: string, tag: string, targetValue: number) {
    if (!tag) {
      throw new Error('tag is required')
    }
    if (!Number.isFinite(targetValue) || targetValue < 0) {
      throw new Error('targetValue must be a non-negative number')
    }

    const settings = await this.getUserSettings(userId)
    const positionTargets = {
      ...(settings.positionTargets || {}),
      [tag]: {
        targetValue,
        setAt: new Date().toISOString(),
      },
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        settings: JSON.stringify({
          ...settings,
          positionTargets,
        }),
      },
    })

    return positionTargets[tag]
  }

  /**
   * 获取仓位列表
   */
  async getPositions(userId: string, filters: PositionFilters = {}) {
    const where: any = { userId }
    const tagFilters = this.normalizeStringArray(filters.tags)
    const labelFilters = this.normalizeStringArray(filters.labels)

    if (filters.status) {
      where.status = filters.status
    }

    if (filters.assetType) {
      where.asset = { type: filters.assetType }
    }

    // Map sortBy field names to Prisma field names
    const sortByField = filters.sortBy === 'unrealized_pnl' ? 'unrealizedPnl'
      : filters.sortBy === 'market_value' ? 'marketValue'
      : 'createdAt'

    const page = filters.page ? Number(filters.page) : 1
    const limit = filters.limit ? Number(filters.limit) : 20
    const skip = (page - 1) * limit

    const positions = await prisma.position.findMany({
      where,
      include: {
        asset: {
          include: {
            assetTags: { include: { tag: true } },
            priceHistory: { orderBy: { timestamp: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { [sortByField]: filters.order || 'desc' },
    })
    const filteredPositions = positions.filter((position) => {
      const positionTags = this.parseJsonStringArray(position.tags)
      const assetTags = position.asset.assetTags.map((assetTag) => assetTag.tag.name)
      const tags = new Set([...positionTags, ...assetTags])
      const labels = new Set(this.parseJsonStringArray(position.labels))

      const tagMatched = tagFilters.length === 0 || tagFilters.some((tag) => tags.has(tag))
      const labelMatched = labelFilters.length === 0 || labelFilters.some((label) => labels.has(label))
      return tagMatched && labelMatched
    })
    const total = filteredPositions.length
    const pagedPositions = filteredPositions.slice(skip, skip + limit)

    const summary = await this.getPositionSummary(userId)

    return {
      data: pagedPositions.map((p) => this.formatPosition(p, summary)),
      summary,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  /**
   * 获取单个仓位详情
   */
  async getPosition(positionId: string) {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: {
        asset: {
          include: {
            assetTags: { include: { tag: true } },
            priceHistory: { orderBy: { timestamp: 'desc' }, take: 1 },
          },
        },
        transactions: true,
      },
    })

    if (!position) {
      throw new Error('Position not found')
    }

    const summary = await this.getPositionSummary(position.userId)
    return this.formatPosition(position, summary)
  }

  /**
   * 创建仓位
   * 注意：统一使用"元"作为单位，marketValue 和 costBasis 都是元
   */
  async createPosition(userId: string, data: {
    assetId: string
    quantity: number
    avgCost: number
    currentPrice?: number
    marketValue?: number  // 持仓市值（元）
    positionType?: string
    tags?: string[]
    labels?: string[]
    stopLoss?: number | null
    takeProfit?: number | null
  }) {
    await ensureUser(prisma, userId)

    const asset = await prisma.asset.findUnique({ where: { id: data.assetId } })
    if (!asset) {
      throw new Error('Asset not found')
    }

    const costBasis = data.quantity * data.avgCost  // 成本合计（元）
    // 如果没有传入marketValue（持仓市值），默认等于成本
    const marketValue = data.marketValue ?? costBasis

    // 自动标签系统：根据asset.type添加标签
    const autoTags = ASSET_TYPE_TAGS[asset.type] || []
    const manualTags = this.normalizeStringArray(data.tags || [])
    const allTags = [...autoTags, ...manualTags].filter((tag, index, arr) => arr.indexOf(tag) === index) // 去重合并

    const position = await prisma.position.create({
      data: {
        userId,
        assetId: data.assetId,
        openKey: this.getOpenPositionKey(userId, data.assetId),
        quantity: data.quantity,
        avgCost: data.avgCost,
        currentPrice: data.currentPrice,
        costBasis,
        marketValue,
        unrealizedPnl: 0,
        positionType: data.positionType || 'long',
        status: 'open',
        tags: JSON.stringify(allTags),
        labels: JSON.stringify(data.labels || []),
        stopLoss: this.normalizeStopTrigger(data.stopLoss),
        takeProfit: this.normalizeStopTrigger(data.takeProfit),
        openedAt: new Date(),
      },
      include: { asset: { include: { assetTags: { include: { tag: true } } } } },
    })

    await this.syncAssetTags(data.assetId, allTags)

    const summary = await this.getPositionSummary(userId)
    return this.formatPosition(position, summary)
  }

  async createManualBuyPosition(userId: string, data: {
    input: string
    name?: string
    assetType?: string
    amount?: number
    quantity?: number
    price?: number
    fee?: number
    tags?: string[]
    notes?: string
    executedAt?: string
  }) {
    await ensureUser(prisma, userId)

    const rawInput = String(data.input || '').trim()
    if (!rawInput) {
      const error = new Error('请输入标的代码或名称') as Error & { statusCode?: number }
      error.statusCode = 400
      throw error
    }

    const identity = await assetIdentityResolver.resolve(rawInput)
    const assetType = data.assetType || (identity.assetType !== 'unknown' ? identity.assetType : undefined)
    const symbol = identity.matchedAsset?.symbol || identity.normalizedSymbol
    const name = data.name || identity.name || rawInput

    if (!assetType || assetType === 'unknown') {
      const error = new Error('无法识别资产类型，请手动选择类型后再新增持仓') as Error & { statusCode?: number }
      error.statusCode = 400
      throw error
    }

    let asset = identity.matchedAsset
      ? await prisma.asset.findUnique({ where: { id: identity.matchedAsset.id } })
      : await prisma.asset.findUnique({ where: { symbol } })

    if (!asset) {
      asset = await prisma.asset.create({
        data: {
          symbol,
          name,
          type: assetType,
          exchange: identity.exchange || undefined,
          currency: identity.currency || 'CNY',
        },
      })
    } else {
      const updateData: { name?: string; type?: string; exchange?: string | null; currency?: string } = {}
      if (name && asset.name !== name) updateData.name = name
      if (assetType && asset.type !== assetType) updateData.type = assetType
      if (identity.exchange && asset.exchange !== identity.exchange) updateData.exchange = identity.exchange
      if (identity.currency && asset.currency !== identity.currency) updateData.currency = identity.currency
      if (Object.keys(updateData).length > 0) {
        asset = await prisma.asset.update({ where: { id: asset.id }, data: updateData })
      }
    }

    let price = data.price || 0
    let priceSource = data.price ? 'manual' : 'external'
    if (!price || price <= 0) {
      try {
        const quote = await priceService.getRealTimePrice(asset.symbol, 'auto', asset.type)
        price = quote.price
        priceSource = quote.source
      } catch {
        const error = new Error('未获取到外部现价/净值，请手动填写成交价后再新增持仓') as Error & { statusCode?: number }
        error.statusCode = 400
        throw error
      }
    }

    if (!Number.isFinite(price) || price <= 0) {
      const error = new Error('成交价必须大于 0') as Error & { statusCode?: number }
      error.statusCode = 400
      throw error
    }

    const amount = data.amount || 0
    let quantity = data.quantity || 0
    if ((!quantity || quantity <= 0) && amount > 0) {
      quantity = amount / price
    }
    quantity = this.normalizeManualQuantity(asset.type, quantity)

    if (!Number.isFinite(quantity) || quantity <= 0) {
      const error = new Error(this.isBoardLotAssetType(asset.type)
        ? '股票/ETF按100股一手新增，买入金额不足一手或数量无效'
        : '请输入买入金额或持仓份额') as Error & { statusCode?: number }
      error.statusCode = 400
      throw error
    }

    const transaction = await transactionService.createTransaction({
      userId,
      assetId: asset.id,
      type: 'buy',
      quantity,
      price,
      fee: data.fee || 0,
      executedAt: data.executedAt ? new Date(data.executedAt) : new Date(),
      notes: data.notes || `手动新增持仓，价格来源：${priceSource}`,
    })

    const positionId = transaction.positionId
    const position = positionId ? await this.getPosition(positionId) : null

    if (data.tags?.length && positionId) {
      await this.updatePosition(positionId, { tags: data.tags })
      return {
        position: await this.getPosition(positionId),
        transaction,
        identity,
        priceSource,
      }
    }

    return { position, transaction, identity, priceSource }
  }

  /**
   * 删除单个仓位
   */
  async deletePosition(positionId: string) {
    const position = await prisma.position.findUnique({ where: { id: positionId } })
    if (!position) {
      const error = new Error('Position not found') as any
      error.statusCode = 404
      throw error
    }

    await prisma.position.delete({ where: { id: positionId } })
    return { success: true, id: positionId }
  }

  /**
   * 清空用户所有仓位
   */
  async clearAllPositions(userId: string) {
    const result = await prisma.position.deleteMany({ where: { userId } })
    return { success: true, deleted: result.count }
  }

  /**
   * 批量保存/导入仓位
   * 注意：marketValue 单位为元
   */
  async batchSavePositions(userId: string, positions: Array<{
    assetId: string
    quantity: number
    avgCost: number
    currentPrice?: number
    marketValue?: number  // 市值（元）
    tags?: string[]
    labels?: string[]
  }>) {
    const results: Array<{ assetId: string; success: boolean; positionId?: string; error?: string }> = []

    for (const pos of positions) {
      try {
        // 检查是否已存在该资产的仓位
        const existing = await prisma.position.findFirst({
          where: { userId, assetId: pos.assetId, status: 'open' },
        })

        if (existing) {
          // 更新已有仓位
          await this.updatePosition(existing.id, {
            quantity: pos.quantity,
            avgCost: pos.avgCost,
            currentPrice: pos.currentPrice,
            marketValue: pos.marketValue,
          })
          results.push({ assetId: pos.assetId, success: true, positionId: existing.id })
        } else {
          // 创建新仓位
          const position = await this.createPosition(userId, {
            assetId: pos.assetId,
            quantity: pos.quantity,
            avgCost: pos.avgCost,
            currentPrice: pos.currentPrice,
            marketValue: pos.marketValue,
            tags: pos.tags,
            labels: pos.labels,
          })
          results.push({ assetId: pos.assetId, success: true, positionId: position.id })
        }
      } catch (error) {
        results.push({
          assetId: pos.assetId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      total: positions.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    }
  }

  /**
   * 更新仓位
   * 注意：marketValue 单位为元
   * 对于基金类型，支持直接更新 costBasis 和 marketValue（用户提供的净值）
   */
  async updatePosition(positionId: string, data: {
    quantity?: number
    avgCost?: number
    currentPrice?: number
    costBasis?: number   // 持仓成本（元）- 基金类型可直接更新
    marketValue?: number  // 市值（元）- 基金类型可直接更新（用户提供的净值）
    unrealizedPnl?: number
    stopLoss?: number | null
    takeProfit?: number | null
    tags?: string[]
    labels?: string[]
  }) {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: { asset: true },
    })
    if (!position) {
      throw new Error('Position not found')
    }

    const asset = position.asset
    const supportsManualValueEdit = ['fund', 'bond', 'gold', 'cash'].includes(asset?.type)

    const updateData: any = {}
    if (data.quantity !== undefined) updateData.quantity = data.quantity
    if (data.avgCost !== undefined) updateData.avgCost = data.avgCost
    if (data.currentPrice !== undefined) {
      const systemPrice = await this.getSystemEditablePrice(asset, position.currentPrice)
      if (asset.type !== 'cash') {
        this.assertClose(data.currentPrice, systemPrice, `${asset.symbol} 提交的现价/净值必须与系统行情一致`, Math.max(0.01, systemPrice * 0.002))
      }
      updateData.currentPrice = systemPrice
    }
    if (data.unrealizedPnl !== undefined) updateData.unrealizedPnl = data.unrealizedPnl
    if (data.stopLoss !== undefined) updateData.stopLoss = this.normalizeStopTrigger(data.stopLoss)
    if (data.takeProfit !== undefined) updateData.takeProfit = this.normalizeStopTrigger(data.takeProfit)
    const normalizedTags = data.tags !== undefined ? this.normalizeStringArray(data.tags) : null
    if (normalizedTags !== null) updateData.tags = JSON.stringify(normalizedTags)
    if (data.labels !== undefined) updateData.labels = JSON.stringify(data.labels)

    // 基金/债基/黄金/现金：支持直接更新 costBasis 和 marketValue。
    // 这些资产经常以手工总额维护，不能强制用 quantity × avgCost 覆盖用户输入。
    if (supportsManualValueEdit) {
      if (data.costBasis !== undefined) {
        updateData.costBasis = data.costBasis
      }
      if (data.marketValue !== undefined) {
        updateData.marketValue = data.marketValue
      }
      if ((asset.type === 'fund' || asset.type === 'bond' || asset.type === 'gold') && data.marketValue !== undefined) {
        const price = updateData.currentPrice ?? data.currentPrice ?? position.currentPrice
        if (!price || price <= 0) {
          throw new Error(`${asset.symbol} 缺少系统现价/净值，无法由总市值反推份额`)
        }
        const derivedQuantity = data.marketValue / price
        updateData.quantity = derivedQuantity
        if (updateData.costBasis !== undefined) {
          updateData.avgCost = updateData.costBasis / derivedQuantity
        }
      }
      if (asset.type === 'cash' && data.marketValue !== undefined) {
        updateData.quantity = data.quantity ?? data.marketValue
        updateData.avgCost = data.avgCost ?? 1
        updateData.currentPrice = data.currentPrice ?? 1
        updateData.costBasis = data.costBasis ?? data.marketValue
      }
      if (asset.type === 'gold' && updateData.costBasis === undefined && (data.quantity !== undefined || data.avgCost !== undefined)) {
        const qty = data.quantity ?? position.quantity
        const cost = data.avgCost ?? position.avgCost
        updateData.costBasis = qty * cost
      }
      // 重算 unrealizedPnl = marketValue - costBasis
      updateData.unrealizedPnl = (updateData.marketValue ?? position.marketValue) - (updateData.costBasis ?? position.costBasis)
    } else {
      // 非基金类型：recalculate costBasis from quantity × avgCost
      if (data.quantity !== undefined || data.avgCost !== undefined) {
        const qty = data.quantity ?? position.quantity
        const cost = data.avgCost ?? position.avgCost
        updateData.costBasis = qty * cost
      }
      if (data.marketValue !== undefined) {
        updateData.marketValue = data.marketValue
      } else if ((data.quantity !== undefined || data.currentPrice !== undefined) && position.asset.type !== 'cash') {
        const qty = data.quantity ?? position.quantity
        const price = data.currentPrice ?? position.currentPrice
        if (price && price > 0) {
          updateData.marketValue = qty * price
        }
      }

      if (data.unrealizedPnl === undefined && (updateData.costBasis !== undefined || updateData.marketValue !== undefined)) {
        updateData.unrealizedPnl = (updateData.marketValue ?? position.marketValue) - (updateData.costBasis ?? position.costBasis)
      }
    }

    const updated = await prisma.position.update({
      where: { id: positionId },
      data: updateData,
      include: { asset: { include: { assetTags: { include: { tag: true } } } } },
    })

    if (normalizedTags !== null) {
      const inferredAssetType = this.inferAssetTypeFromTags(normalizedTags)
      if (inferredAssetType && inferredAssetType !== position.asset.type) {
        await prisma.asset.update({
          where: { id: position.assetId },
          data: { type: inferredAssetType },
        })
      }
      await this.syncAssetTags(position.assetId, normalizedTags)
    }

    const refreshed = await prisma.position.findUnique({
      where: { id: positionId },
      include: { asset: { include: { assetTags: { include: { tag: true } } } } },
    })

    const summary = await this.getPositionSummary(updated.userId)
    return this.formatPosition(refreshed || updated, summary)
  }

  /**
   * 平仓
   */
  async closePosition(positionId: string) {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: { asset: true },
    })

    if (!position) {
      throw new Error('Position not found')
    }

    if (position.status === 'closed') {
      throw new Error('Position already closed')
    }

    // 获取当前价格
    let currentPrice: number
    try {
      const priceData = await priceService.getRealTimePrice(position.asset.symbol)
      currentPrice = priceData.price
    } catch (error) {
      // 如果获取价格失败，使用成本价作为当前价格
      console.warn(`Failed to get real-time price for ${position.asset.symbol}, using avgCost`)
      currentPrice = position.avgCost
    }

    const marketValue = position.quantity * currentPrice
    const realizedPnl = marketValue - (position.costBasis || 0)

    const updated = await prisma.position.update({
      where: { id: positionId },
      data: {
        status: 'closed',
        openKey: null,
        currentPrice,
        marketValue,
        realizedPnl,
        closedAt: new Date(),
      },
      include: { asset: true },
    })

    const summary = await this.getPositionSummary(updated.userId)
    return this.formatPosition(updated, summary)
  }

  /**
   * 批量刷新用户所有仓位的当前价格
   * 注意：基金使用用户提供的持仓净值，不需要用API价格计算市值
   */
  async refreshPositionPrices(userId: string) {
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: { include: { assetTags: { include: { tag: true } } } } },
    })

    const results: Array<{ positionId: string; success: boolean; error?: string }> = []

    for (const position of positions) {
      try {
        let currentPrice: number

        if (position.asset.type === 'cash') {
          // 现金没有行情价格，金额就是市值。历史导入可能出现 quantity=1 / marketValue=1 / costBasis=实际金额，
          // 这里用最大可信金额自愈，避免刷新后现金资产被压成 1 元。
          const cashValue = Math.max(position.marketValue || 0, position.costBasis || 0, position.quantity || 0)
          await prisma.position.update({
            where: { id: position.id },
            data: {
              quantity: cashValue,
              avgCost: 1,
              currentPrice: 1,
              marketValue: cashValue,
              costBasis: cashValue,
              unrealizedPnl: 0,
            },
          })
        } else if (position.asset.type === 'gold') {
          // 黄金：使用专用金价API。不可用时不覆盖已有手工市值。
          const goldPrice = await priceService.getGoldPrice()
          if (!goldPrice.isValid || goldPrice.price <= 0) {
            throw new Error(goldPrice.error || 'Gold price unavailable')
          }
          currentPrice = goldPrice.price
          // 黄金：市值 = 克重 × 金价(元/克)
          const marketValue = position.quantity * currentPrice
          const unrealizedPnl = marketValue - (position.costBasis || 0)
          await prisma.position.update({
            where: { id: position.id },
            data: {
              currentPrice,
              marketValue,
              unrealizedPnl,
            },
          })
        } else {
          const price = await priceService.getRealTimePrice(position.asset.symbol, 'auto', position.asset.type)
          currentPrice = price.price

          // 普通基金和债券：真实份额基金用最新净值重算；手工总额资产保留导入市值。
          // 场内 ETF 虽然可能被归类为 fund，但应按交易所现价重算市值。
          if ((position.asset.type === 'fund' || position.asset.type === 'bond') && !this.isExchangeTradedFundCode(position.asset.symbol)) {
            const marketValue = this.shouldPreserveManualMarketValue(position, currentPrice)
              ? position.marketValue || 0
              : position.quantity * currentPrice
            const unrealizedPnl = marketValue - (position.costBasis || 0)
            await prisma.position.update({
              where: { id: position.id },
              data: {
                currentPrice,
                marketValue,
                unrealizedPnl,
              },
            })
          } else {
            // 股票/现金：用API价格计算市值
            // 市值(元) = 持股数 × 现价(元)
            const marketValue = position.quantity * currentPrice
            // costBasis 存储的是元，直接计算盈亏
            const unrealizedPnl = marketValue - (position.costBasis || 0)

            await prisma.position.update({
              where: { id: position.id },
              data: {
                currentPrice,
                marketValue,
                unrealizedPnl,
              },
            })
          }
        }

        results.push({ positionId: position.id, success: true })
      } catch (error) {
        console.error(`Failed to refresh price for position ${position.id}:`, error)
        results.push({
          positionId: position.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      refreshed: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    }
  }

  /**
   * 获取仓位汇总
   * 注意：marketValue 和 costBasis 都是元，计算时保持一致
   */
  async getPositionSummary(userId: string): Promise<PositionSummary> {
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: { include: { assetTags: { include: { tag: true } } } } },
    })

    const totalValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0)  // 元
    const totalCost = positions.reduce((sum, p) => sum + (p.costBasis || 0), 0)  // 元
    const totalPnl = totalValue - totalCost  // 元
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
    const cashValue = positions
      .filter((p) => p.asset.type === 'cash')
      .reduce((sum, p) => sum + (p.marketValue || 0), 0)

    return {
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPercent,
      positionsCount: positions.length,
      cashValue,
      cashWeight: totalValue > 0 ? (cashValue / totalValue) * 100 : 0,
    }
  }

  /**
   * 计算止损止盈
   */
  async calculateStopLossTakeProfit(positionId: string) {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: { asset: true },
    })

    if (!position) {
      throw new Error('Position not found')
    }

    // 获取历史波动率
    const history = await priceService.getPriceHistory(
      position.assetId,
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      new Date()
    )

    const historyData = history.data

    if (historyData.length < 2) {
      return {
        stopLoss: -5,
        takeProfit: 10,
        unit: 'return_percent',
        reason: 'Default -5% stop loss, 10% take profit',
      }
    }

    // 计算历史波动率
    const returns = historyData.map((h, i) =>
      i > 0 ? (h.closePrice - historyData[i - 1].closePrice) / historyData[i - 1].closePrice : 0
    )
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    const volatility = Math.sqrt(variance * 252) // 年化波动率

    // 基于波动率的止损止盈，返回收益率百分比阈值
    const stopLoss = -Math.max(3, 2 * volatility * 100)
    const takeProfit = Math.max(5, 2.5 * volatility * 100)

    return {
      stopLoss: Number(stopLoss.toFixed(2)),
      takeProfit: Number(takeProfit.toFixed(2)),
      volatility,
      unit: 'return_percent',
      reason: `Based on ${(volatility * 100).toFixed(2)}% annualized volatility`,
    }
  }

  /**
   * 格式化仓位数据
   */
  private formatPosition(position: any, summary?: PositionSummary) {
    const effectiveCostBasis = position.unrealizedPnl !== null && position.unrealizedPnl !== undefined
      ? (position.marketValue || 0) - position.unrealizedPnl
      : position.costBasis

    const unrealizedPnlPercent = effectiveCostBasis > 0 && position.status === 'open'
      ? (position.unrealizedPnl / effectiveCostBasis) * 100
      : 0

    const realizedPnlPercent = effectiveCostBasis > 0 && position.status === 'closed'
      ? (position.realizedPnl / effectiveCostBasis) * 100
      : 0

    const totalValue = summary?.totalValue || 0
    const totalCost = summary?.totalCost || 0

    return {
      id: position.id,
      userId: position.userId,
      asset: {
        id: position.asset.id,
        symbol: position.asset.symbol,
        name: position.asset.name,
        type: position.asset.type,
        currency: position.asset.currency,
        exchange: position.asset.exchange,
        lastPrice: position.asset.lastPrice,
        lastUpdated: position.asset.lastUpdated,
        lastPriceSource: position.asset.priceHistory?.[0]?.source || null,
        currentPrice: position.currentPrice,
      },
      quantity: position.quantity,
      avgCost: position.avgCost,
      currentPrice: position.currentPrice,
      marketValue: position.marketValue,
      costBasis: position.costBasis,
      unrealizedPnl: position.unrealizedPnl,
      unrealizedPnlPercent,
      currentWeight: totalValue > 0 ? ((position.marketValue || 0) / totalValue) * 100 : 0,
      costWeight: totalCost > 0 ? ((position.costBasis || 0) / totalCost) * 100 : 0,
      realizedPnl: position.realizedPnl,
      realizedPnlPercent,
      positionType: position.positionType,
      status: position.status,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      tags: [
        ...new Set([
          ...this.parseJsonStringArray(position.tags),
          ...((position.asset.assetTags || []).map((assetTag: any) => assetTag.tag.name)),
        ]),
      ],
      labels: this.parseJsonStringArray(position.labels),
      notes: position.notes,
      openedAt: position.openedAt,
      closedAt: position.closedAt,
      updatedAt: position.updatedAt,
    }
  }

  /**
   * 按标签分组获取仓位（用于粮仓可视化）
   *
   * 返回结构：
   * - 每个标签一个仓位桶
   * - 显示该标签下所有资产的当前市值、目标市值、填充率
   * - 每个资产显示占比和市值
   */
  async getPositionsByTag(userId: string): Promise<{
    bins: Array<{
      tag: string
      totalTarget: number   // 目标市值（万元）
      totalCurrent: number  // 当前市值（万元）
      fillPercent: number   // 填充率 %
      assets: Array<{
        symbol: string
        name: string
        proportion: number   // 占该仓位百分比
        value: number        // 市值（万元）
        change: number      // 涨跌幅 %
        pnl: number         // 盈亏（万元）
        pnlPercent: number  // 盈亏百分比 %
      }>
      totalPnl: number        // 总盈亏（万元）
      totalPnlPercent: number // 总盈亏百分比 %
    }>
    totalValue: number      // 总市值（万元）
  }> {
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: { include: { assetTags: { include: { tag: true } } } } },
    })

    // 按标签分组
    const tagGroups: Record<string, typeof positions> = {}

    for (const position of positions) {
      const tags: string[] = [
        ...new Set([
          ...this.parseJsonStringArray(position.tags),
          ...position.asset.assetTags.map((assetTag) => assetTag.tag.name),
        ]),
      ]

      if (tags.length === 0) {
        // 无标签的归入"未分类"
        if (!tagGroups['未分类']) tagGroups['未分类'] = []
        tagGroups['未分类'].push(position)
      } else {
        // 每个标签都出现（取第一个主要标签）
        const primaryTag = tags[0]
        if (!tagGroups[primaryTag]) tagGroups[primaryTag] = []
        tagGroups[primaryTag].push(position)
      }
    }

    // 计算每个标签桶的汇总
    const bins: Array<{
      tag: string
      totalTarget: number
      totalCurrent: number
      fillPercent: number
      totalPnl: number
      totalPnlPercent: number
      assets: Array<{
        symbol: string
        name: string
        proportion: number
        value: number
        change: number
        pnl: number
        pnlPercent: number
      }>
    }> = []

    for (const [tag, tagPositions] of Object.entries(tagGroups)) {
      let totalCurrent = 0  // 万元
      let totalTarget = 0   // 万元（假设目标=当前）
      let totalCost = 0     // 万元
      let totalPnl = 0      // 万元

      const assets: Array<{
        symbol: string
        name: string
        proportion: number
        value: number
        change: number
        pnl: number
        pnlPercent: number
      }> = []

      for (const p of tagPositions) {
        const valueInWan = (p.marketValue || 0) / 10000  // 转换为万元
        const pnlInWan = (p.unrealizedPnl !== null && p.unrealizedPnl !== undefined)
          ? p.unrealizedPnl / 10000
          : ((p.marketValue || 0) - (p.costBasis || 0)) / 10000
        const costInWan = valueInWan - pnlInWan
        const pnlPercent = costInWan > 0 ? (pnlInWan / costInWan) * 100 : 0
        const change = p.currentPrice && p.avgCost
          ? ((p.currentPrice - p.avgCost) / p.avgCost) * 100
          : 0

        assets.push({
          symbol: p.asset.symbol,
          name: p.asset.name,
          proportion: 0,  // 待计算
          value: valueInWan,
          change,
          pnl: pnlInWan,
          pnlPercent,
        })

        totalCurrent += valueInWan
        totalTarget += valueInWan  // 暂时目标=当前
        totalCost += costInWan
        totalPnl += pnlInWan
      }

      // 计算占比
      for (const asset of assets) {
        asset.proportion = totalCurrent > 0 ? (asset.value / totalCurrent) * 100 : 0
      }

      bins.push({
        tag,
        totalTarget,
        totalCurrent,
        fillPercent: totalTarget > 0 ? (totalCurrent / totalTarget) * 100 : 0,
        totalPnl,
        totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
        assets: assets.sort((a, b) => b.value - a.value),  // 按市值降序
      })
    }

    // 按总市值降序排列
    bins.sort((a, b) => b.totalCurrent - a.totalCurrent)

    const totalValue = bins.reduce((sum, b) => sum + b.totalCurrent, 0)

    return { bins, totalValue }
  }
}

export const positionService = new PositionService()
