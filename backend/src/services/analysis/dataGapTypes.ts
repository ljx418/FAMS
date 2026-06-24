export type DataGapSeverity = 'blocking' | 'degrading' | 'optional'

export type DataGapCategory =
  | 'asset_identity'
  | 'market_data'
  | 'valuation'
  | 'fundamental'
  | 'financial_report'
  | 'fund_factset'
  | 'gold_macro'
  | 'validation_evidence'
  | 'tradeability'
  | 'news_event'
  | 'provider_health'

export type DataGapRequiredFor =
  | 'research'
  | 'observe'
  | 'manual_trade_draft'
  | 'formal_trade_action'

export type DataGapAssetType = 'stock' | 'etf' | 'fund' | 'bond_fund' | 'gold' | 'cash' | 'unknown'

export type DataGap = {
  gapId: string
  assetId?: string
  symbol?: string
  assetName?: string
  assetType: DataGapAssetType
  severity: DataGapSeverity
  category: DataGapCategory
  blockedReason: string
  missingFields: string[]
  requiredFor: DataGapRequiredFor[]
  userMessage: string
  developerMessage: string
  suggestedAction: string
  providerCandidates: string[]
  lastAttemptAt?: string
  lastError?: string
  evidenceRefs: string[]
}

export type BuildDataGapInput = {
  blockedReasons: string[]
  assetId?: string
  symbol?: string
  assetName?: string
  assetType?: string
  evidenceRefs?: string[]
  lastAttemptAt?: string
  lastError?: string
}
