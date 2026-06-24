import { assetIdentityResolver, AssetIdentityResolution } from './assetIdentityResolver.js'

export type ResearchAssetIdentity = {
  symbol: string
  name?: string
  assetId?: string
  assetType: string
  market: string
  exchange?: string | null
  confidenceScore: number
  resolved: boolean
  lightweightResearchIdentity: boolean
  evidenceRefs: string[]
  warnings: string[]
  resolution: AssetIdentityResolution
}

class ResearchAssetIdentityService {
  async resolve(symbol: string, name?: string): Promise<ResearchAssetIdentity> {
    const resolution = await assetIdentityResolver.resolve(symbol)
    const resolved = Boolean(resolution.matchedAsset) || (resolution.assetType !== 'unknown' && resolution.market !== 'UNKNOWN' && resolution.confidenceScore >= 0.7)
    const displayName = resolution.matchedAsset?.name || resolution.name || name || resolution.normalizedSymbol
    return {
      symbol: resolution.normalizedSymbol,
      name: displayName,
      assetId: resolution.matchedAsset?.id,
      assetType: resolution.matchedAsset?.type || resolution.assetType,
      market: resolution.market,
      exchange: resolution.exchange,
      confidenceScore: resolution.confidenceScore,
      resolved,
      lightweightResearchIdentity: !resolution.matchedAsset && resolved,
      evidenceRefs: [
        `asset-identity:${resolution.normalizedSymbol}:${resolution.assetType}:${resolution.market}`,
        ...resolution.evidence.map((_, index) => `asset-identity-evidence:${resolution.normalizedSymbol}:${index + 1}`),
      ],
      warnings: resolution.warnings,
      resolution,
    }
  }
}

export const researchAssetIdentityService = new ResearchAssetIdentityService()
