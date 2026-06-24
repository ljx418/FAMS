/**
 * Asset Service - 资产服务
 *
 * 职责：
 * 1. 资产CRUD操作
 * 2. 资产清单Excel导入
 * 3. 持仓成本推导计算
 */

import * as XLSX from 'xlsx'
import axios from 'axios'
import { prisma } from '../../db/prisma.js'
import { positionService } from '../position/positionService.js'
import { assetIdentityResolver, type AssetIdentityResolution } from './assetIdentityResolver.js'

interface ExcelRow {
  '大类'?: string
  '属性'?: string
  '小类'?: string
  '代码'?: string | number
  '持股数'?: string | number
  '成本'?: string | number    // 持仓成本（万元）- 有值时优先使用，否则按持股数×元/股计算
  '持仓净值'?: string | number  // 持仓净值（万元）
  '元/股'?: string | number    // 每股价格（元）- 基金为净值，股票为股价
}

export interface ParsedPosition {
  category: string    // 大类
  attribute: string   // 属性
  subCategory: string // 小类
  symbol: string | null
  netValue: number    // 持仓净值(万元)
  pnlOrPercent: number | null  // 盈亏值(万元)或收益率(%)
  isPercent: boolean   // true=收益率, false=盈亏值
  calculatedCost: number | null // 推导的持仓成本(元)

  // 股票：用户直接提供
  userShares: number | null   // 用户提供：持股数
  userCostPerShare: number | null // 用户提供：每股成本(元)
  userMarketValue: number | null // 用户提供：市值(万元)
  userPnl: number | null  // 用户提供：盈亏值(万元)或收益率(%)

  // 计算标志
  isCalculated: boolean  // true=系统计算值, false=用户原始值
}

export interface ImportResult {
  success: number
  failed: number
  total: number
  errors: Array<{ row: number; message: string }>
  parsedData: ParsedPosition[]
}

export interface ImportAssetIdentityPreview {
  inputSymbol: string | null
  symbol: string
  name: string
  category: string
  categoryAssetType: string
  assetType: string
  exchange?: string | null
  currency: string
  confidenceScore: number
  resolverWarnings: string[]
  resolverEvidence: string[]
}

interface AssetFilters {
  type?: string
  page?: number
  limit?: number
}

class AssetService {
  /**
   * 获取资产列表
   */
  async getAssets(_userId: string, filters: AssetFilters = {}) {
    const where: any = {}

    if (filters.type) {
      where.type = filters.type
    }

    const page = filters.page || 1
    const limit = filters.limit || 20
    const skip = (page - 1) * limit

    const [assets, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.asset.count({ where }),
    ])

    return {
      data: assets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  /**
   * 获取单个资产
   */
  async getAsset(assetId: string) {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      include: { priceHistory: { take: 10, orderBy: { timestamp: 'desc' } } },
    })

    if (!asset) {
      throw new Error('Asset not found')
    }

    return asset
  }

  /**
   * 创建资产
   */
  async createAsset(data: {
    symbol: string
    name: string
    type: string
    currency?: string
    exchange?: string
    sector?: string
    industry?: string
  }) {
    return prisma.asset.create({
      data: {
        symbol: data.symbol,
        name: data.name,
        type: data.type,
        currency: data.currency || 'CNY',
        exchange: data.exchange,
        sector: data.sector,
        industry: data.industry,
      },
    })
  }

  /**
   * 更新资产
   */
  async updateAsset(
    assetId: string,
    data: {
      name?: string
      type?: string
      currency?: string
      exchange?: string
      sector?: string
      industry?: string
    }
  ) {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } })
    if (!asset) {
      throw new Error('Asset not found')
    }

    return prisma.asset.update({
      where: { id: assetId },
      data,
    })
  }

  /**
   * 删除资产
   */
  async deleteAsset(assetId: string) {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } })
    if (!asset) {
      throw new Error('Asset not found')
    }

    await prisma.asset.delete({ where: { id: assetId } })
    return { success: true, assetId }
  }

  /**
   * 从Excel文件解析资产数据
   *
   * Excel模板列：
   * - 大类、属性、小类、代码、持股数、成本(万元)、持仓净值(万元)、元/股
   *
   * 计算规则：
   * - 成本(万元) = 持股数 × 元/股（若有成本列且有值，优先使用成本列，否则按此公式计算）
   * - 对于基金/现金/黄金：持股数为1，成本和持仓净值均以万元为单位
   */
  parseExcelPositions(file: Buffer): ParsedPosition[] {
    const workbook = XLSX.read(file)
    const sheetName = workbook.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName])

    const parsed: ParsedPosition[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row['大类']) continue // 跳过空行

      const category = String(row['大类'] || '').trim()
      const symbol = row['代码'] ? String(row['代码']).trim() : null
      const shares = this.parseNumber(row['持股数']) // 持股数（基金为1）
      const costInWan = this.parseNumber(row['成本']) // 持仓成本（万元）
      const netValueInWan = this.parseNumber(row['持仓净值']) // 持仓净值（万元）
      const pricePerShare = this.parseNumber(row['元/股']) // 每股价格（元）

      if (category === '股票') {
        // 股票：用户提供持股数、成本、每股价格
        // 成本(万元) = 持股数 × 元/股（若成本列有值则优先使用，否则按公式计算）
        let totalCostInWan = costInWan
        if (!totalCostInWan && shares && pricePerShare) {
          totalCostInWan = shares * pricePerShare / 10000
        }

        parsed.push({
          category,
          attribute: String(row['属性'] || '').trim(),
          subCategory: String(row['小类'] || '').trim(),
          symbol,
          userShares: shares,
          userCostPerShare: pricePerShare,
          userMarketValue: netValueInWan,
          userPnl: null,
          netValue: netValueInWan || 0,
          pnlOrPercent: null,
          isPercent: false,
          calculatedCost: totalCostInWan ? totalCostInWan * 10000 : null, // 转换为元
          isCalculated: false,
        })
      } else if (category === '基金' || category === '债基') {
        // 基金/债基：用户提供持仓净值(万元)、成本(万元)
        // quantity 和 avgCost 在导入时根据持仓净值 + 实时NAV 推算
        // 公式：quantity = 持仓净值(万元) × 10000 / 当前NAV(元)
        //       avgCost = 成本(万元) × 10000 / quantity
        //       marketValue = quantity × NAV(元) = 持仓净值(万元) × 10000
        parsed.push({
          category,
          attribute: String(row['属性'] || '').trim(),
          subCategory: String(row['小类'] || '').trim(),
          symbol,
          userShares: shares,  // 基金：让导入层根据NAV推算quantity，不默认1
          userCostPerShare: pricePerShare,
          userMarketValue: netValueInWan, // 持仓净值（万元）
          userPnl: null,
          netValue: netValueInWan || 0,
          pnlOrPercent: null,
          isPercent: false,
          calculatedCost: costInWan ? costInWan * 10000 : null, // 成本（元）
          isCalculated: false,
        })
      } else {
        // 现金、黄金等：用户直接提供持仓净值（万元）
        const netValue = netValueInWan || 0
        // 成本 = 持仓净值（投入即成本）
        const cashCostInWan = costInWan || netValue

        parsed.push({
          category,
          attribute: String(row['属性'] || '').trim(),
          subCategory: String(row['小类'] || '').trim(),
          symbol,
          userShares: 1,
          userCostPerShare: null,
          userMarketValue: netValue,
          userPnl: null,
          netValue,
          pnlOrPercent: null,
          isPercent: false,
          calculatedCost: cashCostInWan * 10000, // 转换为元
          isCalculated: false,
        })
      }
    }

    return parsed
  }

  /**
   * 解析数值（处理字符串和数字）
   */
  private parseNumber(value: string | number | undefined): number | null {
    if (value === undefined || value === null) return null
    if (typeof value === 'number') return value
    const cleaned = String(value).replace(/[,%]/g, '').trim()
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? null : parsed
  }

  /**
   * 将解析的资产数据导入到数据库
   */
  async importPositions(userId: string, parsedData: ParsedPosition[]): Promise<ImportResult> {
    const result: ImportResult = {
      success: 0,
      failed: 0,
      total: parsedData.length,
      errors: [],
      parsedData,
    }

    for (let i = 0; i < parsedData.length; i++) {
      const item = parsedData[i]
      let positionCreated = false
      try {
        const identityPreview = await this.resolveImportAssetIdentity(item)
        const assetType = identityPreview.assetType

        // 查找或创建资产
        let asset
        const symbolStr = identityPreview.symbol

        if (item.symbol) {
          asset = await prisma.asset.findUnique({ where: { symbol: symbolStr } })
          if (!asset) {
            asset = await prisma.asset.create({
              data: {
                symbol: symbolStr,
                name: identityPreview.name,
                type: assetType,
                exchange: identityPreview.exchange || undefined,
                currency: identityPreview.currency,
              },
            })
          } else {
            const updateData: { type?: string; exchange?: string | null; currency?: string } = {}
            if (asset.type !== assetType) updateData.type = assetType
            if (identityPreview.exchange && asset.exchange !== identityPreview.exchange) updateData.exchange = identityPreview.exchange
            if (identityPreview.currency && asset.currency !== identityPreview.currency) updateData.currency = identityPreview.currency
            if (Object.keys(updateData).length > 0) {
              asset = await prisma.asset.update({
                where: { id: asset.id },
                data: updateData,
              })
            }
          }
        } else {
          // 无代码的资产（如现金），使用复合唯一键
          asset = await prisma.asset.findFirst({
            where: {
              name: item.subCategory,
              type: assetType,
            },
          })
          if (!asset) {
            asset = await prisma.asset.create({
              data: {
                symbol: symbolStr,
                name: identityPreview.name,
                type: assetType,
                exchange: identityPreview.exchange || undefined,
                currency: identityPreview.currency,
              },
            })
          }
        }

        // 检查是否已存在该资产的仓位，如果已存在且有成本则保留
        let existingPosition = null
        if (asset) {
          existingPosition = await prisma.position.findFirst({
            where: {
              assetId: asset.id,
              userId,
              status: 'open',
            },
          })
        }

        // 创建仓位
        // 股票：用户直接提供持股数和成本，系统查询现价计算市值
        // 基金：用户直接提供市值和盈亏，系统查询净值计算份额和成本
        if (asset) {
          if (item.category === '股票') {
            // 股票：用户直接提供持股数和成本（成本单位为万元，总成本 = 成本 × 10000）
            const shares = item.userShares
            const totalCostInYuan = item.calculatedCost // 总成本（元）= 成本(万) × 10000

            if (shares && shares > 0 && totalCostInYuan && totalCostInYuan > 0) {
              const avgCost = totalCostInYuan / shares // 每股成本（元）

              if (existingPosition && (existingPosition.costBasis || 0) > 0) {
                // 保留现有成本，只更新持股数
                await positionService.updatePosition(existingPosition.id, {
                  quantity: shares,
                })
                positionCreated = true
              } else {
                // 新建仓位
                await positionService.createPosition(userId, {
                  assetId: asset.id,
                  quantity: shares,
                  avgCost, // 每股成本（元）
                  marketValue: 0, // 市值待刷新价格时计算
                  tags: [item.category, item.attribute, item.subCategory],
                  labels: [],
                })
                positionCreated = true
              }
            }
          } else if (item.category === '基金' || item.category === '债基') {
            // 基金/债基：
            // - userMarketValue(持仓净值万元) → 市值 = nav_val_wan × 10000
            // - 公式：quantity = 持仓净值(万元) × 10000 / NAV(元)
            // -       avgCost = 成本(万元) × 10000 / quantity
            const navValWan = item.userMarketValue as number || 0  // 持仓净值（万元）
            const totalCostYuan = item.calculatedCost as number || 0 // 总成本（元）

            if (navValWan > 0) {
              // 拉取当前 NAV
              const navPrice = await this.getFundPriceForImport(asset.symbol)
              if (!navPrice) {
                result.errors.push({ row: i + 2, message: `无法获取基金 ${asset.symbol} 的当前净值` })
                continue
              }

              const quantity = navValWan * 10000 / navPrice  // 持仓份数
              const avgCost = totalCostYuan > 0 ? totalCostYuan / quantity : navPrice
              const marketValueYuan = navValWan * 10000       // 市值（元）

              if (existingPosition && (existingPosition.costBasis || 0) > 0) {
                await positionService.updatePosition(existingPosition.id, {
                  quantity: Math.round(quantity * 100) / 100,
                })
                positionCreated = true
              } else {
                await positionService.createPosition(userId, {
                  assetId: asset.id,
                  quantity: Math.round(quantity * 100) / 100,
                  avgCost: Math.round(avgCost * 10000) / 10000,  // 元/份
                  marketValue: Math.round(marketValueYuan * 100) / 100, // 元
                  tags: [item.category, item.attribute, item.subCategory],
                  labels: [],
                })
                positionCreated = true
              }
            } else if (totalCostYuan > 0) {
              // 有成本但无净值：按成本计算
              const navPrice = await this.getFundPriceForImport(asset.symbol)
              if (navPrice) {
                const quantity = totalCostYuan / navPrice
                if (existingPosition && (existingPosition.costBasis || 0) > 0) {
                  await positionService.updatePosition(existingPosition.id, { quantity })
                } else {
                  await positionService.createPosition(userId, {
                    assetId: asset.id, quantity,
                    avgCost: navPrice,
                    marketValue: totalCostYuan,
                    tags: [item.category, item.attribute, item.subCategory], labels: [],
                  })
                }
                positionCreated = true
              }
            }
          } else if (item.category === '黄金') {
            // 黄金：查询金价，计算克重
            const navValWan = item.userMarketValue as number || 0 // 持仓净值（万元）
            if (navValWan > 0) {
              const goldPrice = await this.getGoldPriceForImport()
              if (!goldPrice) {
                result.errors.push({ row: i + 2, message: `无法获取黄金价格` })
                continue
              }

              const weight = navValWan * 10000 / goldPrice // 克重
              const netValueInYuan = navValWan * 10000       // 市值（元）
              const totalCostYuan = item.calculatedCost as number || 0 // 总成本（元）

              if (existingPosition && (existingPosition.costBasis || 0) > 0) {
                await positionService.updatePosition(existingPosition.id, {
                  quantity: Math.round(weight * 100) / 100,
                })
                positionCreated = true
              } else {
                await positionService.createPosition(userId, {
                  assetId: asset.id,
                  quantity: Math.round(weight * 100) / 100, // 克重
                  avgCost: totalCostYuan > 0 ? totalCostYuan / weight : goldPrice,
                  marketValue: netValueInYuan, // 元
                  tags: [item.category, item.attribute, item.subCategory],
                  labels: [],
                })
                positionCreated = true
              }
            }
          } else {
            // 其他（现金等）：用户直接提供市值
            const netValue = item.netValue || item.userMarketValue
            if (netValue && netValue > 0) {
              const netValueInYuan = netValue * 10000 // 转换为元
              await positionService.createPosition(userId, {
                assetId: asset.id,
                quantity: 1,
                avgCost: netValueInYuan, // 成本=市值（元）
                marketValue: netValueInYuan, // 市值（元）
                tags: [item.category, item.attribute, item.subCategory],
                labels: [],
              })
              positionCreated = true
            }
          }
        }

        // 只有实际创建了仓位才计入成功
        if (positionCreated) {
          result.success++
        }
      } catch (error) {
        result.failed++
        result.errors.push({
          row: i + 2, // Excel行号从1开始，且有表头
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return result
  }

  async resolveImportAssetIdentity(item: Pick<ParsedPosition, 'category' | 'attribute' | 'subCategory' | 'symbol'>): Promise<ImportAssetIdentityPreview> {
    const categoryAssetType = this.mapCategoryToAssetType(item.category, item.symbol)
    const rawSymbol = item.symbol ? String(item.symbol).trim() : null
    const compositeKey = `${item.category}-${item.attribute}-${item.subCategory}`
    const identity = rawSymbol ? await assetIdentityResolver.resolve(rawSymbol) : null
    const assetType = this.chooseImportAssetType(item.category, categoryAssetType, identity)

    return {
      inputSymbol: rawSymbol,
      symbol: identity?.normalizedSymbol || rawSymbol || compositeKey,
      name: identity?.name || item.subCategory,
      category: item.category,
      categoryAssetType,
      assetType,
      exchange: identity?.exchange || (assetType === 'cash' ? 'LOCAL' : undefined),
      currency: identity?.currency || 'CNY',
      confidenceScore: identity?.confidenceScore || 0.9,
      resolverWarnings: identity?.warnings || [],
      resolverEvidence: identity?.evidence || [],
    }
  }

  private chooseImportAssetType(
    category: string,
    categoryAssetType: string,
    identity?: AssetIdentityResolution | null
  ): string {
    if (!identity || identity.assetType === 'unknown') return categoryAssetType
    if (category === '现金' || category === '黄金') return categoryAssetType
    if (category === '债基') return identity.assetType === 'bond' ? 'bond' : categoryAssetType
    if (category === '基金') return identity.assetType === 'bond' ? 'bond' : (identity.assetType === 'etf' ? 'etf' : 'fund')
    if (category === '股指') return identity.assetType === 'etf' ? 'etf' : categoryAssetType
    if (category === '股票') {
      return identity.assetType === 'stock' || identity.assetType === 'etf' ? identity.assetType : categoryAssetType
    }
    return identity.assetType
  }

  /**
   * 大类映射到资产类型。
   * 这是导入的兜底规则；有代码的资产优先由 AssetIdentityResolver 判定。
   */
  private mapCategoryToAssetType(category: string, symbol?: string | null): string {
    const mapping: Record<string, string> = {
      '现金': 'cash',
      '黄金': 'gold',
      '基金': 'fund',
      '债基': 'bond',
      '股票': 'stock',
      '股指': 'etf',
    }

    let type = mapping[category] || 'stock'

    // 根据代码特征修正类型，作为无法解析身份时的兜底。
    if (symbol) {
      const s = String(symbol).trim()

      if (/^(159|510|511|512|513|515|516|517|518|520|560|561|562|563|588|589)\d{3}$/.test(s)) {
        type = 'etf'
      }

      if (category === '股票' && /^(513|513770|513080|513100|513500|513650|513800|513900)\d*$/.test(s)) {
        type = 'etf'
      }
    }

    return type
  }

  /**
   * 获取基金净值用于导入计算
   * 尝试多个数据源以确保获取成功
   */
  private async getFundPriceForImport(fundCode: string): Promise<number | null> {
    // 数据源列表，按优先级排序
    const sources = [
      // 1. 天天基金实时估值
      this.fetchFromTiantianFund.bind(this, fundCode),
      // 2. 东方财富历史净值（单位净值）
      this.fetchFromEastmoneyLSJZ.bind(this, fundCode),
      // 3. 东方财富基金详情（累计净值）
      this.fetchFromEastmoneyFundDetail.bind(this, fundCode),
      // 4. 支付宝基金净值
      this.fetchFromAlipayFund.bind(this, fundCode),
    ]

    for (const fetchFn of sources) {
      try {
        const price = await fetchFn()
        if (price !== null && price > 0) {
          return price
        }
      } catch {
        // 继续下一个数据源
      }
    }

    return null
  }

  /**
   * 数据源1: 天天基金实时估值API
   */
  private async fetchFromTiantianFund(fundCode: string): Promise<number | null> {
    const response = await axios.get(
      `https://fundgz.1234567.com.cn/js/${fundCode}.js?rt=${Date.now()}`,
      { timeout: 8000 }
    )
    const dataStr: string = response.data
    const jsonMatch = dataStr.match(/jsonpgz\((.+)\)/)
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1])
      // gsz是实时估算净值，jz是昨日净值
      return parseFloat(data.gsz) || parseFloat(data.jz) || null
    }
    return null
  }

  /**
   * 数据源2: 东方财富历史净值API (lsjz)
   * 获取最新单位净值(DWJZ)
   */
  private async fetchFromEastmoneyLSJZ(fundCode: string): Promise<number | null> {
    const resp = await axios.get(
      'https://api.fund.eastmoney.com/f10/lsjz',
      {
        params: {
          callback: 'jQuery',
          fundCode,
          pageIndex: 1,
          pageSize: 1,
        },
        timeout: 8000,
        headers: { Referer: 'https://fund.eastmoney.com/' },
      }
    )

    let data
    const text = resp.data
    if (typeof text === 'string') {
      // 处理 jQuery 包装或纯 JSON
      const match = text.match(/jQuery\((.+)\)/)
      data = match ? JSON.parse(match[1]) : JSON.parse(text)
    } else {
      data = text
    }

    if (data?.Data?.LSJZList?.length > 0) {
      return parseFloat(data.Data.LSJZList[0].DWJZ) || null
    }
    return null
  }

  /**
   * 数据源3: 东方财富基金详情API
   * 获取累计净值(LJJZ)
   */
  private async fetchFromEastmoneyFundDetail(fundCode: string): Promise<number | null> {
    const resp = await axios.get(
      'https://fundf10.eastmoney.com/f10/jjpj',
      {
        params: { code: fundCode },
        timeout: 8000,
        headers: {
          Referer: 'https://fundf10.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0',
        },
      }
    )

    const html = resp.data as string
    // 提取单位净值
    const dwjzMatch = html.match(/单位净值.*?<span[^>]*>([^<]+)<\/span>/)
    if (dwjzMatch) {
      const price = parseFloat(dwjzMatch[1])
      if (!isNaN(price)) return price
    }
    // 提取累计净值作为备选
    const ljjzMatch = html.match(/累计净值.*?<span[^>]*>([^<]+)<\/span>/)
    if (ljjzMatch) {
      const price = parseFloat(ljjzMatch[1])
      if (!isNaN(price)) return price
    }
    return null
  }

  /**
   * 数据源4: 支付宝基金净值API
   */
  private async fetchFromAlipayFund(fundCode: string): Promise<number | null> {
    try {
      const resp = await axios.get(
        `https://fund-h5.eastmoney.com/f10/f10Data.aspx`,
        {
          params: {
            pageIndex: 1,
            pageSize: 1,
            action: 'jjgm',
            platform: 'H5',
            appId: 'FUND',
            productId: fundCode,
            _: Date.now(), // 时间戳参数
          },
          timeout: 8000,
          headers: {
            Referer: 'https://fund-eastmoney.com/',
            'User-Agent': 'Mozilla/5.0',
          },
        }
      )

      const text = resp.data as string
      // 支付宝返回的是 JSONP 格式: callback({"data":...})
      const jsonMatch = text.match(/callback\((.+)\)/)
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1])
        if (data?.data?.DWJZ) {
          return parseFloat(data.data.DWJZ)
        }
        // 尝试其他字段
        if (data?.data?.GSZ) {
          return parseFloat(data.data.GSZ)
        }
      }
    } catch {
      // 忽略错误
    }

    // 备选：直接用东方财富API获取基金基本信息
    try {
      const resp = await axios.get(
        'https://fundf10.eastmoney.com/FundMUp.aspx',
        {
          params: {
            action: 'jjgm',
            pageIndex: 1,
            pageSize: 1,
            fundCode,
            platform: 'H5',
          },
          timeout: 8000,
          headers: {
            Referer: 'https://fundf10.eastmoney.com/',
          },
        }
      )
      const text = resp.data as string
      const match = text.match(/"DWJZ"\s*:\s*"([^"]+)"/)
      if (match) {
        return parseFloat(match[1])
      }
    } catch {
      // 忽略
    }

    return null
  }

  /**
   * 获取黄金价格（用于导入时计算克重）
   * 使用多个黄金ETF交叉验证
   */
  private async getGoldPriceForImport(): Promise<number | null> {
    const goldFunds = [
      { code: '002611', factor: 318 },   // 博时黄金ETF联接C
      { code: '518880', factor: 104.8 }, // 黄金ETF华安
      { code: '159934', factor: 100.3 }, // 黄金ETF易方达
    ]

    const prices: number[] = []

    for (const fund of goldFunds) {
      try {
        const response = await axios.get(
          `https://fundgz.1234567.com.cn/js/${fund.code}.js`,
          {
            params: { rt: Date.now() },
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000,
          }
        )

        const dataStr: string = response.data
        const jsonMatch = dataStr.match(/jsonpgz\((.+)\)/)
        if (!jsonMatch) continue

        const data = JSON.parse(jsonMatch[1])
        const nav = parseFloat(data.gsz) || parseFloat(data.dwjz) || 0
        if (nav === 0) continue

        prices.push(nav * fund.factor)
      } catch {
        // 单个基金失败不影响其他
      }
    }

    if (prices.length === 0) return null
    return prices.reduce((a, b) => a + b, 0) / prices.length
  }

  /**
   * 根据资产代码和名称自动识别标签
   *
   * 标签规则：
   * - A股（6开头）→ ["A股", "沪市"]
   * - A股（0/3开头）→ ["A股", "深市"]
   * - 港股代码 → ["港股"]
   * - 美股代码 → ["美股"]
   * - 基金代码 → ["基金"]
   * - 黄金 → ["黄金"]
   * - 关键词匹配 → ["新能源", "科技", "医药", "消费", "金融", "地产", "白酒", "半导体"]
   */
  autoTagAsset(symbol: string, name: string): string[] {
    const tags: string[] = []
    const s = String(symbol || '').trim()
    const n = String(name || '').toLowerCase()

    // A股判断
    if (/^6\d{5}$/.test(s)) {
      tags.push('A股', '沪市')
    } else if (/^[03]\d{5}$/.test(s)) {
      tags.push('A股', '深市')
    }
    // 港股判断（5位数，以8开头或带.HK）
    else if (/^8\d{4}$/.test(s) || s.endsWith('.HK')) {
      tags.push('港股')
    }
    // 美股判断（字母开头，如AAPL）
    else if (/^[A-Z]{1,5}$/.test(s)) {
      tags.push('美股')
    }
    // 基金判断（5开头或159开头）
    else if (/^(5\d{5}|159\d{3})$/.test(s)) {
      tags.push('基金')
    }

    // 黄金
    if (n.includes('黄金') || n.includes('gold')) {
      tags.push('黄金')
    }

    // 关键词匹配
    const keywordTags: Array<[string[], string]> = [
      [['新能源', '锂电', '光伏', '储能', '电动车', '比亚迪', '宁德', '特斯拉', '赛力斯'], '新能源'],
      [['科技', '互联网', '软件', '芯片', '半导体', '苹果', '华为'], '科技'],
      [['医药', '生物', '疫苗', '中药', '医疗器械', '恒瑞', '药明'], '医药'],
      [['消费', '食品', '饮料', '家电', '茅台', '五粮液', '伊利'], '消费'],
      [['金融', '银行', '保险', '券商', '证券', '招商', '平安'], '金融'],
      [['地产', '万科', '保利', '龙湖'], '地产'],
      [['白酒', '茅台', '五粮液', '泸州老窖', '洋河'], '消费'],
      [['半导体', '芯片', '集成电路', '中芯'], '科技'],
    ]

    for (const [keywords, tag] of keywordTags) {
      if (keywords.some(k => n.includes(k.toLowerCase()))) {
        if (!tags.includes(tag)) {
          tags.push(tag)
        }
      }
    }

    // 债券/债基
    if (n.includes('债') || n.includes('bond')) {
      tags.push('债券')
    }

    return [...new Set(tags)] // 去重
  }

  /**
   * 为资产创建或关联标签
   */
  async tagAsset(assetId: string, tags: string[]): Promise<void> {
    for (const tagName of tags) {
      // 查找或创建标签
      let tag = await prisma.tag.findUnique({ where: { name: tagName } })
      if (!tag) {
        tag = await prisma.tag.create({
          data: { name: tagName, color: this.getTagColor(tagName) },
        })
      }

      // 关联资产和标签
      await prisma.assetTag.upsert({
        where: { assetId_tagId: { assetId, tagId: tag.id } },
        create: { assetId, tagId: tag.id },
        update: {},
      })
    }
  }

  /**
   * 获取标签颜色
   */
  private getTagColor(tagName: string): string {
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
    }
    return colorMap[tagName] || '#5A6BFF'
  }
}

export const assetService = new AssetService()
