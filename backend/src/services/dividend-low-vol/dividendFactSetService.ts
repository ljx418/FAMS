import { prisma } from '../../db/prisma.js'
import { dividendLowVolStrategyService } from './dividendLowVolStrategyService.js'
import type { DividendLowVolFactSet, DividendLowVolInput } from './dividendLowVolTypes.js'

export class DividendFactSetService {
  build(input: DividendLowVolInput): DividendLowVolFactSet {
    return dividendLowVolStrategyService.buildFactSet(input)
  }

  buildMany(inputs: DividendLowVolInput[]): DividendLowVolFactSet[] {
    return inputs.map((input) => this.build(input))
  }

  async getLatest(userId: string, symbol: string): Promise<DividendLowVolFactSet | null> {
    const row = await prisma.dividendLowVolDaily.findFirst({
      where: {
        userId,
        symbol,
        strategyId: dividendLowVolStrategyService.strategyId,
      },
      orderBy: [
        { tradeDate: 'desc' },
        { generatedAt: 'desc' },
      ],
    })
    if (!row) return null
    try {
      return JSON.parse(row.factsetJson) as DividendLowVolFactSet
    } catch {
      return null
    }
  }
}

export const dividendFactSetService = new DividendFactSetService()
