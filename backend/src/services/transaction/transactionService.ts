/**
 * Transaction Service - 交易服务
 *
 * 职责：
 * 1. 交易CRUD操作
 * 2. 仓位自动管理（买入创建/更新仓位，卖出减少/平仓）
 * 3. 成本计算（同花顺持仓成本口径：买入增加成本，部分卖出用卖出净回款冲减剩余持仓成本）
 * 4. 批量导入交易
 */

import { prisma } from '../../db/prisma.js'
import { priceService } from '../price/priceService.js'
import { ensureUser } from '../../utils/user.js'
import * as XLSX from 'xlsx'

const getOpenPositionKey = (userId: string, assetId: string) => `${userId}:${assetId}`

export type CostMethod = 'weighted_average' | 'fifo' | 'lifo'

export interface CreateTransactionParams {
  userId: string
  assetId: string
  type: 'buy' | 'sell' | 'dividend' | 'fee' | 'deposit' | 'withdraw'
  quantity: number
  price: number
  fee?: number
  broker?: string
  confirmationNo?: string
  executedAt?: Date
  notes?: string
  adviceActionId?: string
}

export interface TransactionFilters {
  assetId?: string
  type?: string
  startDate?: Date
  endDate?: Date
  status?: string
  page?: number
  limit?: number
}

export interface ImportMapping {
  date: string
  symbol: string
  type: string
  quantity: string
  price: string
  amount?: string
  fee?: string
  broker?: string
  confirmationNo?: string
}

class TransactionService {
  private estimateOpenMarketValue(quantity: number, currentPrice?: number | null, fallbackPrice?: number) {
    const price = currentPrice && currentPrice > 0 ? currentPrice : fallbackPrice || 0
    return quantity * price
  }

  private getBuyCost(quantity: number, price: number, fee: number) {
    return quantity * price + fee
  }

  private getSellProceeds(quantity: number, price: number, fee: number) {
    return quantity * price - fee
  }

  private getAverageCost(costBasis: number, quantity: number) {
    return quantity > 0 ? costBasis / quantity : 0
  }

  /**
   * 创建交易
   * 使用事务确保数据一致性
   */
  async createTransaction(params: CreateTransactionParams) {
    await ensureUser(prisma, params.userId)

    const amount = params.quantity * params.price
    const fee = params.fee || 0

    return prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: params.assetId } })
      if (!asset) {
        throw new Error('Asset not found')
      }

      if (
        (asset.type === 'stock' || asset.type === 'etf') &&
        (params.type === 'buy' || params.type === 'sell') &&
        params.quantity % 100 !== 0
      ) {
        const error = new Error('股票/ETF交易数量必须是100股的整数倍') as Error & { statusCode?: number }
        error.statusCode = 400
        throw error
      }

      // 创建交易记录
      const transaction = await tx.transaction.create({
        data: {
          userId: params.userId,
          assetId: params.assetId,
          type: params.type,
          quantity: params.quantity,
          price: params.price,
          fee,
          amount: this.calculateSignedAmount(params.type, amount, fee),
          broker: params.broker,
          confirmationNo: params.confirmationNo,
          executedAt: params.executedAt || new Date(),
          notes: params.notes,
          adviceActionId: params.adviceActionId,
        },
        include: { asset: true },
      })

      const position = params.type === 'buy' || params.type === 'sell'
        ? await this.updatePositionFromTransaction(tx, transaction)
        : await this.updateCashPositionFromTransaction(tx, transaction, asset.type)

      // 更新交易的positionId
      if (position) {
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { positionId: position.id },
        })
        transaction.positionId = position.id
      }

      return transaction
    })
  }

  private calculateSignedAmount(type: string, grossAmount: number, fee: number): number {
    switch (type) {
      case 'buy':
      case 'fee':
      case 'withdraw':
        return -(grossAmount + fee)
      case 'sell':
        return grossAmount - fee
      case 'dividend':
      case 'deposit':
        return grossAmount - fee
      default:
        return grossAmount - fee
    }
  }

  /**
   * 根据交易更新仓位
   * 买入: 创建新仓位或更新现有仓位
   * 卖出: 减少仓位数量或平仓，计算已实现盈亏
   */
  async updatePositionFromTransaction(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    transaction: {
      id: string
      userId: string
      assetId: string
      type: string
      quantity: number
      price: number
      fee: number
    }
  ) {
    const existingPosition = await tx.position.findFirst({
      where: {
        userId: transaction.userId,
        assetId: transaction.assetId,
        status: 'open',
      },
    })

    if (transaction.type === 'buy') {
      if (existingPosition) {
        // 更新现有仓位 - 加权平均法
        const totalQty = existingPosition.quantity + transaction.quantity
        const totalCost = (existingPosition.costBasis || 0) + this.getBuyCost(transaction.quantity, transaction.price, transaction.fee)
        const newAvgCost = this.getAverageCost(totalCost, totalQty)
        const newMarketValue = this.estimateOpenMarketValue(
          totalQty,
          existingPosition.currentPrice,
          transaction.price
        )

        return tx.position.update({
          where: { id: existingPosition.id },
          data: {
            quantity: totalQty,
            avgCost: newAvgCost,
            costBasis: totalCost,
            currentPrice: existingPosition.currentPrice || transaction.price,
            marketValue: newMarketValue,
            unrealizedPnl: newMarketValue - totalCost,
          },
        })
      } else {
        // 创建新仓位
        const costBasis = transaction.quantity * transaction.price + transaction.fee
        const marketValue = transaction.quantity * transaction.price
        try {
          return await tx.position.create({
            data: {
              userId: transaction.userId,
              assetId: transaction.assetId,
              openKey: getOpenPositionKey(transaction.userId, transaction.assetId),
              quantity: transaction.quantity,
              avgCost: transaction.price,
              currentPrice: transaction.price,
              costBasis,
              marketValue,
              unrealizedPnl: marketValue - costBasis,
              realizedPnl: 0,
              source: 'manual',
            },
          })
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') throw error
          const racedPosition = await tx.position.findFirst({
            where: {
              userId: transaction.userId,
              assetId: transaction.assetId,
              status: 'open',
            },
          })
          if (!racedPosition) throw error

          const totalQty = racedPosition.quantity + transaction.quantity
          const totalCost = (racedPosition.costBasis || 0) + costBasis
          const newAvgCost = this.getAverageCost(totalCost, totalQty)
          const newMarketValue = this.estimateOpenMarketValue(totalQty, racedPosition.currentPrice, transaction.price)

          return tx.position.update({
            where: { id: racedPosition.id },
            data: {
              quantity: totalQty,
              avgCost: newAvgCost,
              costBasis: totalCost,
              currentPrice: racedPosition.currentPrice || transaction.price,
              marketValue: newMarketValue,
              unrealizedPnl: newMarketValue - totalCost,
            },
          })
        }
      }
    } else if (transaction.type === 'sell') {
      if (!existingPosition) {
        throw new Error('No open position to sell')
      }

      const remainingQty = existingPosition.quantity - transaction.quantity
      const sellValue = this.getSellProceeds(transaction.quantity, transaction.price, transaction.fee)

      if (remainingQty <= 0) {
        // 平仓 - 计算已实现盈亏
        const totalRealizedPnl = existingPosition.realizedPnl + sellValue - (existingPosition.costBasis || 0)
        return tx.position.update({
          where: { id: existingPosition.id },
          data: {
            quantity: 0,
            costBasis: 0,
            status: 'closed',
            openKey: null,
            closedAt: new Date(),
            marketValue: 0,
            unrealizedPnl: 0,
            realizedPnl: totalRealizedPnl,
          },
        })
      } else {
        // 同花顺持仓成本口径：部分卖出时用卖出净回款冲减剩余持仓成本。
        // 盈亏被体现在剩余持仓成本价中，不再单独累加到 open position.realizedPnl。
        const newCostBasis = (existingPosition.costBasis || 0) - sellValue
        const newAvgCost = this.getAverageCost(newCostBasis, remainingQty)
        const newMarketValue = this.estimateOpenMarketValue(
          remainingQty,
          existingPosition.currentPrice,
          transaction.price
        )
        return tx.position.update({
          where: { id: existingPosition.id },
          data: {
            quantity: remainingQty,
            avgCost: newAvgCost,
            costBasis: newCostBasis,
            currentPrice: existingPosition.currentPrice || transaction.price,
            marketValue: newMarketValue,
            unrealizedPnl: newMarketValue - newCostBasis,
            realizedPnl: existingPosition.realizedPnl,
          },
        })
      }
    }

    return null
  }

  private async updateCashPositionFromTransaction(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    transaction: {
      userId: string
      assetId: string
      type: string
      quantity: number
      price: number
      fee: number
    },
    assetType: string
  ) {
    if (assetType !== 'cash') {
      return null
    }

    const signedAmount = this.calculateSignedAmount(
      transaction.type,
      transaction.quantity * transaction.price,
      transaction.fee
    )
    const existingPosition = await tx.position.findFirst({
      where: {
        userId: transaction.userId,
        assetId: transaction.assetId,
        status: 'open',
      },
    })

    if (existingPosition) {
      const marketValue = Math.max(0, (existingPosition.marketValue || 0) + signedAmount)
      return tx.position.update({
        where: { id: existingPosition.id },
        data: {
          quantity: marketValue,
          avgCost: 1,
          currentPrice: 1,
          marketValue,
          costBasis: marketValue,
          unrealizedPnl: 0,
        },
      })
    }

    const openingValue = Math.max(0, signedAmount)
    try {
      return await tx.position.create({
        data: {
          userId: transaction.userId,
          assetId: transaction.assetId,
          openKey: getOpenPositionKey(transaction.userId, transaction.assetId),
          quantity: openingValue,
          avgCost: 1,
          currentPrice: 1,
          costBasis: openingValue,
          marketValue: openingValue,
          unrealizedPnl: 0,
          realizedPnl: 0,
          source: 'manual',
        },
      })
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
      const racedPosition = await tx.position.findFirst({
        where: {
          userId: transaction.userId,
          assetId: transaction.assetId,
          status: 'open',
        },
      })
      if (!racedPosition) throw error
      const marketValue = Math.max(0, (racedPosition.marketValue || 0) + signedAmount)
      return tx.position.update({
        where: { id: racedPosition.id },
        data: {
          quantity: marketValue,
          avgCost: 1,
          currentPrice: 1,
          marketValue,
          costBasis: marketValue,
          unrealizedPnl: 0,
        },
      })
    }
  }

  /**
   * 获取交易列表
   * 支持按资产/类型/时间范围筛选，分页返回
   */
  async getTransactions(userId: string, filters: TransactionFilters = {}) {
    const where: any = { userId }

    if (filters.assetId) where.assetId = filters.assetId
    if (filters.type) where.type = filters.type
    if (filters.status) where.status = filters.status
    if (filters.startDate || filters.endDate) {
      where.executedAt = {}
      if (filters.startDate) where.executedAt.gte = filters.startDate
      if (filters.endDate) where.executedAt.lte = filters.endDate
    }

    const page = filters.page || 1
    const limit = filters.limit || 20
    const skip = (page - 1) * limit

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { asset: true, position: true },
        orderBy: { executedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ])

    return {
      data: transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  /**
   * 批量导入交易
   * 解析Excel/CSV文件，支持自定义字段映射
   */
  async importTransactions(
    userId: string,
    file: Buffer,
    mapping: ImportMapping
  ): Promise<{
    success: number
    failed: number
    total: number
    errors: Array<{ row: number; message: string }>
  }> {
    const workbook = XLSX.read(file)
    const sheetName = workbook.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]) as any[]

    const results = {
      success: 0,
      failed: 0,
      total: rows.length,
      errors: [] as Array<{ row: number; message: string }>,
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]

      try {
        // 获取标的代码
        const symbol = String(row[mapping.symbol] || '').trim()
        if (!symbol) {
          throw new Error('Symbol is required')
        }

        // 查找资产
        const asset = await prisma.asset.findUnique({ where: { symbol } })
        if (!asset) {
          throw new Error(`Asset "${symbol}" not found`)
        }

        // 解析交易类型
        const typeValue = String(row[mapping.type] || '').toLowerCase().trim()
        const type = typeValue === 'buy' || typeValue === 'b' || typeValue === '买入'
          ? 'buy'
          : typeValue === 'sell' || typeValue === 's' || typeValue === '卖出'
          ? 'sell'
          : typeValue === 'dividend' || typeValue === '分红'
          ? 'dividend'
          : typeValue === 'fee' || typeValue === '费用' || typeValue === '手续费'
          ? 'fee'
          : typeValue === 'deposit' || typeValue === '存入' || typeValue === '入金'
          ? 'deposit'
          : typeValue === 'withdraw' || typeValue === '取出' || typeValue === '出金'
          ? 'withdraw'
          : typeValue === 'split' || typeValue === 'split'
          ? 'split'
          : null

        if (!type) {
          throw new Error(`Invalid transaction type: ${typeValue}`)
        }

        // 解析数值字段
        const quantity = parseFloat(row[mapping.quantity])
        if (isNaN(quantity) || quantity <= 0) {
          throw new Error(`Invalid quantity: ${row[mapping.quantity]}`)
        }

        let price = parseFloat(row[mapping.price])
        if (isNaN(price) || price < 0) {
          throw new Error(`Invalid price: ${row[mapping.price]}`)
        }

        // 黄金资产：根据实时金价计算克重
        // quantity 在黄金导入时为净值（金额），需要换算为克重
        let importQuantity = quantity
        if (asset.type === 'gold' && price === 0) {
          const goldPriceResult = await priceService.getGoldPrice()
          if (goldPriceResult.isValid && goldPriceResult.price > 0) {
            importQuantity = quantity / goldPriceResult.price
            price = goldPriceResult.price // 记录金价
            console.log(`黄金克重计算: 净值=${quantity}, 金价=${goldPriceResult.price}, 克重=${importQuantity.toFixed(2)}g`)
          } else {
            throw new Error(`无法获取实时金价，请手动输入金价`)
          }
        }

        const fee = mapping.fee
          ? parseFloat(row[mapping.fee]) || 0
          : 0

        // 解析日期
        let executedAt: Date
        const dateValue = row[mapping.date]
        if (!dateValue) {
          throw new Error('Date is required')
        }

        if (typeof dateValue === 'number') {
          // Excel日期序列号
          executedAt = new Date((dateValue - 25569) * 86400 * 1000)
        } else if (typeof dateValue === 'string') {
          executedAt = new Date(dateValue)
        } else {
          executedAt = dateValue as Date
        }

        if (isNaN(executedAt.getTime())) {
          throw new Error(`Invalid date: ${dateValue}`)
        }

        if (type === 'buy' || type === 'sell' || type === 'dividend' || type === 'fee' || type === 'deposit' || type === 'withdraw') {
          await this.createTransaction({
            userId,
            assetId: asset.id,
            type,
            quantity: importQuantity,
            price,
            fee,
            broker: mapping.broker ? String(row[mapping.broker] || '') : undefined,
            confirmationNo: mapping.confirmationNo
              ? String(row[mapping.confirmationNo] || '')
              : undefined,
            executedAt,
          })
        } else {
          // 非买入/卖出交易，只创建记录
          const amount = quantity * price
          await prisma.transaction.create({
            data: {
              userId,
              assetId: asset.id,
              type,
              quantity,
              price,
              fee,
              amount: -amount,
              broker: mapping.broker ? String(row[mapping.broker] || '') : undefined,
              confirmationNo: mapping.confirmationNo
                ? String(row[mapping.confirmationNo] || '')
                : undefined,
              executedAt,
            },
          })
        }

        results.success++
      } catch (error) {
        results.failed++
        results.errors.push({
          row: i + 2, // Excel行号从1开始，且有表头
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return results
  }

  /**
   * 更新交易信息
   * 注意：修改数量/价格会影响关联仓位，需要重新计算
   */
  async updateTransaction(
    transactionId: string,
    data: {
      quantity?: number
      price?: number
      fee?: number
      broker?: string
      confirmationNo?: string
      notes?: string
    }
  ) {
    return prisma.$transaction(async (tx) => {
      // 获取原交易
      const original = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: { position: true },
      })

      if (!original) {
        throw new Error('Transaction not found')
      }

      // 回滚原交易对仓位的影响
      if (original.type === 'buy' || original.type === 'sell') {
        await this.reversePositionFromTransaction(tx, original)
      }

      // 计算新金额
      const newQuantity = data.quantity ?? original.quantity
      const newPrice = data.price ?? original.price
      const newFee = data.fee ?? original.fee
      const newAmount = newQuantity * newPrice

      // 更新交易
      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: {
          quantity: newQuantity,
          price: newPrice,
          fee: newFee,
          amount: this.calculateSignedAmount(original.type, newAmount, newFee),
          broker: data.broker ?? original.broker,
          confirmationNo: data.confirmationNo ?? original.confirmationNo,
          notes: data.notes ?? original.notes,
        },
        include: { asset: true },
      })

      // 重新应用新交易对仓位的影响
      if (original.type === 'buy' || original.type === 'sell') {
        const position = await this.updatePositionFromTransaction(tx, {
          ...updated,
          fee: newFee,
        })
        if (position) {
          await tx.transaction.update({
            where: { id: transactionId },
            data: { positionId: position.id },
          })
        }
      }

      return updated
    })
  }

  /**
   * 回滚交易对仓位的影响
   * 买入 -> 减少仓位
   * 卖出 -> 增加仓位
   */
  private async reversePositionFromTransaction(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    transaction: {
      id: string
      userId: string
      assetId: string
      type: string
      quantity: number
      price: number
      fee: number
    }
  ) {
    const existingPosition = await tx.position.findFirst({
      where: {
        userId: transaction.userId,
        assetId: transaction.assetId,
        status: 'open',
      },
    })

    if (!existingPosition) return

    if (transaction.type === 'buy') {
      // 回滚买入 -> 减少仓位
      const remainingQty = existingPosition.quantity - transaction.quantity
      if (remainingQty <= 0) {
        await tx.position.update({
          where: { id: existingPosition.id },
          data: {
            quantity: 0,
            status: 'closed',
            openKey: null,
            closedAt: new Date(),
            marketValue: 0,
            unrealizedPnl: 0,
          },
        })
      } else {
        const costReduction = this.getBuyCost(transaction.quantity, transaction.price, transaction.fee)
        const newCostBasis = (existingPosition.costBasis || 0) - costReduction
        const newAvgCost = this.getAverageCost(newCostBasis, remainingQty)
        const newMarketValue = this.estimateOpenMarketValue(
          remainingQty,
          existingPosition.currentPrice,
          transaction.price
        )
        await tx.position.update({
          where: { id: existingPosition.id },
          data: {
            quantity: remainingQty,
            avgCost: newAvgCost,
            costBasis: newCostBasis,
            currentPrice: existingPosition.currentPrice || transaction.price,
            marketValue: newMarketValue,
            unrealizedPnl: newMarketValue - newCostBasis,
          },
        })
      }
    } else if (transaction.type === 'sell') {
      // 回滚卖出 -> 增加仓位
      const newQty = existingPosition.quantity + transaction.quantity
      const costAddition = this.getSellProceeds(transaction.quantity, transaction.price, transaction.fee)
      const newCostBasis = (existingPosition.costBasis || 0) + costAddition
      const newAvgCost = this.getAverageCost(newCostBasis, newQty)
      const newMarketValue = this.estimateOpenMarketValue(
        newQty,
        existingPosition.currentPrice,
        transaction.price
      )

      await tx.position.update({
        where: { id: existingPosition.id },
        data: {
          quantity: newQty,
          status: 'open',
          openKey: getOpenPositionKey(transaction.userId, transaction.assetId),
          closedAt: null,
          avgCost: newAvgCost,
          costBasis: newCostBasis,
          currentPrice: existingPosition.currentPrice || transaction.price,
          marketValue: newMarketValue,
          unrealizedPnl: newMarketValue - newCostBasis,
          realizedPnl: existingPosition.realizedPnl,
        },
      })
    }
  }

  /**
   * 删除交易
   * 同时回滚仓位
   */
  async deleteTransaction(transactionId: string) {
    return prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
      })

      if (!transaction) {
        throw new Error('Transaction not found')
      }

      // 回滚仓位影响
      if (transaction.type === 'buy' || transaction.type === 'sell') {
        await this.reversePositionFromTransaction(tx, transaction)
      }

      // 删除交易
      await tx.transaction.delete({
        where: { id: transactionId },
      })

      return { success: true, transactionId }
    })
  }

  /**
   * 计算成本（加权平均法）
   * 可扩展支持FIFO/LIFO
   */
  calculateWeightedAverageCost(positions: Array<{ quantity: number; avgCost: number }>) {
    const totalQty = positions.reduce((sum, p) => sum + p.quantity, 0)
    const totalCost = positions.reduce((sum, p) => sum + p.quantity * p.avgCost, 0)
    return totalQty > 0 ? totalCost / totalQty : 0
  }

  /**
   * FIFO成本计算
   */
  calculateFIFOCost(
    lots: Array<{ quantity: number; price: number; remaining: number }>,
    sellQuantity: number
  ) {
    let remaining = sellQuantity
    let totalCost = 0

    for (const lot of lots) {
      if (remaining <= 0) break

      const qtyFromLot = Math.min(remaining, lot.remaining)
      totalCost += qtyFromLot * lot.price
      remaining -= qtyFromLot
    }

    return totalCost
  }

  /**
   * LIFO成本计算
   */
  calculateLIFOCost(
    lots: Array<{ quantity: number; price: number; remaining: number }>,
    sellQuantity: number
  ) {
    let remaining = sellQuantity
    let totalCost = 0
    const reversedLots = [...lots].reverse()

    for (const lot of reversedLots) {
      if (remaining <= 0) break

      const qtyFromLot = Math.min(remaining, lot.remaining)
      totalCost += qtyFromLot * lot.price
      remaining -= qtyFromLot
    }

    return totalCost
  }
}

export const transactionService = new TransactionService()
