import { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'

function parseTagArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return [...new Set(input.flatMap(parseTagArray))]
  }
  if (typeof input !== 'string') {
    return []
  }

  const trimmed = input.trim()
  if (!trimmed) {
    return []
  }
  try {
    return parseTagArray(JSON.parse(trimmed))
  } catch {
    return [...new Set(trimmed.split(',').map((item) => item.trim()).filter(Boolean))]
  }
}

function inferTagColor(tagName: string): string {
  const colorMap: Record<string, string> = {
    A股: '#5470C6',
    港股: '#95DE64',
    美股: '#FF9F7F',
    新能源: '#95DE64',
    科技: '#5A6BFF',
    医药: '#EE6666',
    消费: '#FAC858',
    金融: '#7262FD',
    地产: '#D0D0D0',
    黄金: '#FFD700',
    基金: '#36CFC9',
    债券: '#A0A0A0',
    股票: '#5470C6',
    现金: '#38BDF8',
    ETF: '#36CFC9',
  }
  return colorMap[tagName] || '#5A6BFF'
}

async function ensurePositionTagsInRegistry() {
  const positions = await prisma.position.findMany({ select: { tags: true } })
  const tagNames = new Set<string>()
  for (const position of positions) {
    for (const tag of parseTagArray(position.tags)) {
      tagNames.add(tag)
    }
  }

  for (const tagName of tagNames) {
    await prisma.tag.upsert({
      where: { name: tagName },
      create: {
        name: tagName,
        color: inferTagColor(tagName),
      },
      update: {},
    })
  }
}

export async function tagRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    await ensurePositionTagsInRegistry()
    return prisma.tag.findMany({ orderBy: { name: 'asc' } })
  })

  app.post('/', async (request) => {
    const data = request.body as any
    return prisma.tag.create({ data })
  })

  app.put('/:id', async (request) => {
    const { id } = request.params as { id: string }
    const data = request.body as any
    return prisma.tag.update({ where: { id }, data })
  })

  app.delete('/:id', async (request) => {
    const { id } = request.params as { id: string }
    const tag = await prisma.tag.findUnique({ where: { id } })
    if (!tag) {
      return { success: true, removedFromPositions: 0, removedAssetLinks: 0 }
    }

    const positions = await prisma.position.findMany()
    let removedFromPositions = 0
    let removedAssetLinks = 0
    await prisma.$transaction(async (tx) => {
      const removed = await tx.assetTag.deleteMany({ where: { tagId: id } })
      removedAssetLinks = removed.count
      for (const position of positions) {
        let tags: string[] = []
        try {
          tags = JSON.parse(position.tags || '[]')
        } catch {
          tags = String(position.tags || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        }
        const nextTags = tags.filter((item) => item !== tag.name)
        if (nextTags.length !== tags.length) {
          removedFromPositions += 1
          await tx.position.update({
            where: { id: position.id },
            data: { tags: JSON.stringify([...new Set(nextTags)]) },
          })
        }
      }
      await tx.tag.delete({ where: { id } })
    })
    return { success: true, removedFromPositions, removedAssetLinks }
  })
}
