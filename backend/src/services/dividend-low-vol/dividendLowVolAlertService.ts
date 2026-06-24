import { dividendLowVolStrategyService } from './dividendLowVolStrategyService.js'
import type { DividendLowVolFactSet, DividendLowVolInput } from './dividendLowVolTypes.js'
import { prisma } from '../../db/prisma.js'

export class DividendLowVolAlertService {
  check(inputs: DividendLowVolInput[]) {
    const pool = dividendLowVolStrategyService.buildCandidatePool(inputs)
    const alerts = pool.candidates.flatMap((candidate) => this.toAlertRows(candidate))
    return {
      schemaVersion: 'dividend.low_vol.alert_check.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: dividendLowVolStrategyService.strategyFamily,
      strategyId: dividendLowVolStrategyService.strategyId,
      totalCandidates: pool.total,
      totalAlerts: alerts.length,
      alerts,
      policy: pool.policy,
    }
  }

  async listLatest(userId: string, options: { limit?: number; status?: string } = {}) {
    const latest = await prisma.dividendLowVolDaily.findFirst({
      where: { userId, strategyId: dividendLowVolStrategyService.strategyId },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) {
      return {
        schemaVersion: 'dividend.low_vol.persisted_alerts.v1',
        generatedAt: new Date().toISOString(),
        strategyFamily: dividendLowVolStrategyService.strategyFamily,
        strategyId: dividendLowVolStrategyService.strategyId,
        tradeDate: null,
        totalAlerts: 0,
        alerts: [],
        policy: {
          allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
          prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
        },
      }
    }
    const rows = await prisma.dividendLowVolDaily.findMany({
      where: {
        userId,
        strategyId: dividendLowVolStrategyService.strategyId,
        tradeDate: latest.tradeDate,
      },
      orderBy: { evidenceAdjustedScore: 'desc' },
      take: Math.max(1, Math.min(500, options.limit || 200)),
    })
    const alerts = rows.flatMap((row) => {
      const factSet = this.parseJson<DividendLowVolFactSet | null>(row.factsetJson, null)
      if (!factSet) return []
      return this.toAlertRows(factSet).map((alert) => ({
        ...alert,
        sourceOperationId: row.sourceOperationId,
        tradeDate: row.tradeDate.toISOString().slice(0, 10),
      }))
    }).filter((alert) => !options.status || alert.status === options.status)
    return {
      schemaVersion: 'dividend.low_vol.persisted_alerts.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: dividendLowVolStrategyService.strategyFamily,
      strategyId: dividendLowVolStrategyService.strategyId,
      tradeDate: latest.tradeDate.toISOString().slice(0, 10),
      totalAlerts: alerts.length,
      alerts,
      policy: {
        allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      },
    }
  }

  private toAlertRows(candidate: DividendLowVolFactSet) {
    return candidate.alerts.map((alert) => ({
      assetId: candidate.identity.assetId || null,
      symbol: candidate.identity.symbol,
      name: candidate.identity.name,
      alertType: alert.type,
      severity: alert.severity,
      triggerDate: candidate.generatedAt.slice(0, 10),
      triggerPrice: candidate.timing.price || null,
      message: alert.triggerReason,
      invalidationConditions: alert.invalidationConditions,
      discipline: candidate.tradingDiscipline,
      evidenceRefs: alert.evidenceRefs,
      status: 'open',
      allowedActions: candidate.tradingDiscipline.allowedActions,
      prohibitedActions: candidate.tradingDiscipline.prohibitedActions,
    }))
  }

  private parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
}

export const dividendLowVolAlertService = new DividendLowVolAlertService()
