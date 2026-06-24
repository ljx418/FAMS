import { dividendLowVolStrategyService } from './dividendLowVolStrategyService.js'
import type { DividendLowVolFactSet, DividendLowVolInput } from './dividendLowVolTypes.js'

export class DividendLowVolFivdRAdapter {
  buildCandidates(inputs: DividendLowVolInput[]) {
    const pool = dividendLowVolStrategyService.buildCandidatePool(inputs)
    return {
      schemaVersion: 'dividend.low_vol.fivd_r_adapter.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: dividendLowVolStrategyService.strategyFamily,
      strategyId: dividendLowVolStrategyService.strategyId,
      candidates: pool.candidates.map((candidate) => this.mapCandidate(candidate)),
      policy: pool.policy,
    }
  }

  private mapCandidate(candidate: DividendLowVolFactSet) {
    const observable = !['avoid', 'data_insufficient'].includes(candidate.disposition)
    return {
      strategyFamily: dividendLowVolStrategyService.strategyFamily,
      strategyId: dividendLowVolStrategyService.strategyId,
      symbol: candidate.identity.symbol,
      name: candidate.identity.name,
      disposition: observable ? 'observe_only' : candidate.disposition,
      signalScore: candidate.scores.timingScore,
      valuationScore: candidate.scores.valuationScore,
      qualityScore: candidate.scores.dividendQualityScore,
      riskScore: candidate.scores.riskScore,
      researchScore: candidate.scores.totalResearchScore,
      evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
      evidenceRefs: candidate.evidenceRefs,
      dataGapSummary: candidate.dataGapSummary,
      blockedReasons: candidate.blockedReasons,
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      validationGateRequired: 'validation_evidence',
      notes: [
        'dividend_low_volatility uses structured dividend, valuation, volatility and timing evidence.',
        'FIVD-R adapter does not emit formal ADD/REDUCE/AUTO_TRADE actions.',
      ],
    }
  }
}

export const dividendLowVolFivdRAdapter = new DividendLowVolFivdRAdapter()
