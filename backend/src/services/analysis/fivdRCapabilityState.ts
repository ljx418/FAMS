import { DataGap } from './dataGapTypes.js'

export type FivdRCapabilityState =
  | 'RESEARCH_READY'
  | 'OBSERVE_ONLY'
  | 'DATA_INSUFFICIENT'
  | 'TRADE_BLOCKED'
  | 'SYSTEM_UNAVAILABLE'

export function deriveFivdRCapabilityState(input: {
  summaryStatus: 'available' | 'partial' | 'insufficient' | 'blocked'
  blockedReasons: string[]
  missingData: string[]
  prohibitedActions: string[]
  validationEvidencePassed: boolean
  dataGapSummary?: DataGap[]
}): FivdRCapabilityState {
  if (input.summaryStatus === 'blocked' && input.blockedReasons.some((reason) => reason.includes('system') || reason.includes('operation_failed'))) {
    return 'SYSTEM_UNAVAILABLE'
  }
  if (!input.validationEvidencePassed || input.blockedReasons.includes('validation_evidence')) {
    return 'TRADE_BLOCKED'
  }
  const hasResearchBlockingGap = (input.dataGapSummary || []).some((gap) => (
    gap.severity === 'blocking' && (gap.requiredFor.includes('research') || gap.requiredFor.includes('observe'))
  ))
  if (input.summaryStatus === 'insufficient' || hasResearchBlockingGap || input.missingData.length > 0) {
    return 'DATA_INSUFFICIENT'
  }
  if (input.prohibitedActions.includes('ADD') || input.prohibitedActions.includes('REDUCE')) {
    return 'OBSERVE_ONLY'
  }
  return 'RESEARCH_READY'
}

export function buildFivdRCapabilityFlags(input: {
  capabilityState: FivdRCapabilityState
  validationEvidencePassed: boolean
  dataSufficient: boolean
}) {
  const researchAvailable = input.capabilityState === 'RESEARCH_READY'
    || input.capabilityState === 'OBSERVE_ONLY'
    || input.capabilityState === 'TRADE_BLOCKED'
  return {
    researchAvailable,
    observeAllowed: researchAvailable,
    formalTradeActionAllowed: false,
    manualTradeDraftAllowed: input.validationEvidencePassed && input.dataSufficient,
    autoTradeAllowed: false,
  }
}
