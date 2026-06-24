import { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { assetService } from '../services/asset/assetService.js'
import { assetIdentityResolver } from '../services/asset/assetIdentityResolver.js'

export async function assetRoutes(app: FastifyInstance) {
  // 获取资产列表
  app.get('/', async (request) => {
    const { type, sector, search, page, limit } = request.query as any
    const where: any = {}

    if (type) where.type = type
    if (sector) where.sector = sector
    if (search) {
      where.OR = [
        { symbol: { contains: search } },
        { name: { contains: search } },
      ]
    }

    return prisma.asset.findMany({
      where,
      skip: ((page || 1) - 1) * (limit || 20),
      take: limit || 20,
      orderBy: { symbol: 'asc' },
    })
  })

  // 获取单个资产
  app.get('/:id', async (request) => {
    const { id } = request.params as any
    return prisma.asset.findUnique({
      where: { id },
      include: { priceHistory: { take: 30, orderBy: { timestamp: 'desc' } } },
    })
  })

  // 创建资产
  app.post('/', async (request) => {
    const data = request.body as any
    return prisma.asset.create({ data })
  })

  // 更新资产
  app.put('/:id', async (request) => {
    const { id } = request.params as any
    const data = request.body as any
    return prisma.asset.update({ where: { id }, data })
  })

  app.patch('/:id', async (request) => {
    const { id } = request.params as any
    const data = request.body as any
    return prisma.asset.update({ where: { id }, data })
  })

  // 删除资产
  app.delete('/:id', async (request) => {
    const { id } = request.params as any
    await prisma.asset.delete({ where: { id } })
    return { success: true }
  })

  // 解析Excel资产清单（预览，不入库）
  app.post('/parse', async (request) => {
    const data = await request.file()
    if (!data) {
      throw new Error('No file uploaded')
    }
    const buffer = await data.toBuffer()
    const parsed = assetService.parseExcelPositions(buffer)
    return { data: parsed }
  })

  // 导入Excel资产清单（入库）
  app.post('/import', async (request) => {
    // 收集所有 multipart 字段
    const fields: Record<string, string> = {}
    let fileBuffer: Buffer | null = null

    // 遍历所有字段
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer()
        fileBuffer = buffer
      } else {
        fields[part.fieldname] = String(part.value)
      }
    }

    const userId = fields['userId']
    if (!userId) {
      throw new Error('userId is required')
    }
    if (!fileBuffer) {
      throw new Error('No file uploaded')
    }

    const parsed = assetService.parseExcelPositions(fileBuffer)
    return assetService.importPositions(userId, parsed)
  })

  app.get('/resolve', async (request) => {
    const { input, symbol, query } = request.query as any
    const target = input || symbol || query
    if (!target || !String(target).trim()) {
      throw new Error('input is required')
    }
    return assetIdentityResolver.resolve(String(target))
  })
}
