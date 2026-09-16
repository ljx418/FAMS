import type { PortfolioStrategyDefinition } from '../portfolio-backtest/portfolioBacktestTypes.js'
import {
  FORMAL_RELEASE_CANDIDATES,
  type FormalReleaseCandidateId,
} from './releaseCandidateSetService.js'
import { sha256Canonical } from './formalReleaseHash.js'

export const FORMAL_VALIDATION_PROFILE_SET_SCHEMA_VERSION = 'fams.formal_validation_profile_set.v1' as const
export const FORMAL_VALIDATION_PROFILE_SET_VERSION = '2026-09-14.route-a-v1' as const
export const FORMAL_VALIDATION_PROFILE_SET_VERSION_POINT_IN_TIME_V2 = '2026-09-15.route-a-point-in-time-v2' as const
export const FORMAL_VALIDATION_OWNER_DECISION_REF = 'project-owner-conversation:2026-09-14:route-a-with-candidate-benchmark-mapping' as const

export type FormalValidationCandidateRole =
  | 'product_release_candidate'
  | 'research_reference_strategy'
  | 'diagnostic_snapshot'
  | 'engineering_path_fixture'

export type FormalValidationProfileId =
  | 'equity_selection_release_v1'
  | 'strategic_allocation_reference_v1'
  | 'current_holdings_diagnostic_v1'
  | 'engineering_path_only_v1'

export interface FormalValidationProfileAssignment {
  candidateId: FormalReleaseCandidateId
  candidateVersion: string
  candidateRole: FormalValidationCandidateRole
  validationProfileId: FormalValidationProfileId
  formalGateApplicable: boolean
  benchmarkId: string | null
  componentIds: string[]
  definitionHash: string
  exclusionReason: string | null
  componentSelectionMode: 'fixed_definition' | 'point_in_time_dynamic'
  selectionArtifactRef: string | null
  selectionArtifactSha256: string | null
}

export interface FormalValidationProfileSet {
  schemaVersion: typeof FORMAL_VALIDATION_PROFILE_SET_SCHEMA_VERSION
  setVersion: string
  candidateSet: {
    setId: string
    version: string
    contentHash: string
  }
  ownerDecisionRef: typeof FORMAL_VALIDATION_OWNER_DECISION_REF
  inventoryCount: 7
  productReleaseCandidateIds: FormalReleaseCandidateId[]
  candidateAssignments: FormalValidationProfileAssignment[]
  profileSetHash: string
  frozen: true
  generatedAt: string
}

const ASSIGNMENT_POLICY: Record<FormalReleaseCandidateId, {
  candidateRole: FormalValidationCandidateRole
  validationProfileId: FormalValidationProfileId
  formalGateApplicable: boolean
  benchmarkId: string | null
  exclusionReason: string | null
}> = {
  dividend_low_vol_basket: {
    candidateRole: 'product_release_candidate',
    validationProfileId: 'equity_selection_release_v1',
    formalGateApplicable: true,
    benchmarkId: 'csi300_total_return_h00300',
    exclusionReason: null,
  },
  permanent_portfolio: {
    candidateRole: 'research_reference_strategy',
    validationProfileId: 'strategic_allocation_reference_v1',
    formalGateApplicable: false,
    benchmarkId: null,
    exclusionReason: 'research_reference_not_approved_as_product_release_candidate',
  },
  all_weather: {
    candidateRole: 'research_reference_strategy',
    validationProfileId: 'strategic_allocation_reference_v1',
    formalGateApplicable: false,
    benchmarkId: null,
    exclusionReason: 'research_reference_not_approved_as_product_release_candidate',
  },
  current_holdings_buy_and_hold: {
    candidateRole: 'diagnostic_snapshot',
    validationProfileId: 'current_holdings_diagnostic_v1',
    formalGateApplicable: false,
    benchmarkId: null,
    exclusionReason: 'current_holdings_are_user_facts_not_a_releasable_strategy',
  },
  local_real_data_sample_60_40: {
    candidateRole: 'engineering_path_fixture',
    validationProfileId: 'engineering_path_only_v1',
    formalGateApplicable: false,
    benchmarkId: null,
    exclusionReason: 'engineering_real_data_path_fixture_not_a_product',
  },
  local_real_data_equal_weight_5: {
    candidateRole: 'engineering_path_fixture',
    validationProfileId: 'engineering_path_only_v1',
    formalGateApplicable: false,
    benchmarkId: null,
    exclusionReason: 'engineering_real_data_path_fixture_not_a_product',
  },
  local_real_data_concentrated_3: {
    candidateRole: 'engineering_path_fixture',
    validationProfileId: 'engineering_path_only_v1',
    formalGateApplicable: false,
    benchmarkId: null,
    exclusionReason: 'engineering_real_data_path_fixture_not_a_product',
  },
}

function componentId(component: PortfolioStrategyDefinition['components'][number]) {
  return String(component.symbol || component.proxySymbol || component.name || component.assetClass).trim()
}

export function formalValidationDefinitionHash(definition: PortfolioStrategyDefinition) {
  const components = definition.components.map((component) => ({
    assetClass: component.assetClass,
    symbol: component.symbol || null,
    proxySymbol: component.proxySymbol || null,
    targetWeightPercent: component.targetWeightPercent,
  })).sort((left, right) => String(left.symbol || left.proxySymbol || left.assetClass).localeCompare(String(right.symbol || right.proxySymbol || right.assetClass)))
  return sha256Canonical({
    strategyId: definition.strategyId,
    strategyVersion: definition.strategyVersion,
    source: definition.source,
    components,
    rebalancePolicy: definition.rebalancePolicy,
    dividendPolicy: definition.dividendPolicy,
    costModel: definition.costModel,
    benchmarkPolicy: definition.benchmarkPolicy,
  })
}

export function formalValidationProfileSetHash(profileSet: Omit<FormalValidationProfileSet, 'profileSetHash'> | FormalValidationProfileSet) {
  const { profileSetHash: _profileSetHash, generatedAt: _generatedAt, ...semanticCore } = profileSet as FormalValidationProfileSet
  return sha256Canonical(semanticCore)
}

export class FormalValidationProfileService {
  freeze(input: {
    candidateSet: {
      setId: string
      version: string
      contentHash: string
      candidateIds: string[]
      candidateVersions: Record<string, string>
    }
    definitions: PortfolioStrategyDefinition[]
    setVersion?: string
    assignmentOverrides?: Partial<Record<FormalReleaseCandidateId, {
      componentIds: string[]
      definitionHash: string
      componentSelectionMode: 'point_in_time_dynamic'
      selectionArtifactRef: string
      selectionArtifactSha256: string
    }>>
    generatedAt?: Date
  }): FormalValidationProfileSet {
    const expectedIds = [...FORMAL_RELEASE_CANDIDATES]
    if (input.candidateSet.candidateIds.length !== expectedIds.length
      || input.candidateSet.candidateIds.some((id, index) => id !== expectedIds[index])) {
      throw new Error('formal_validation_profile_candidate_inventory_mismatch')
    }
    const definitions = new Map(input.definitions.map((definition) => [definition.strategyId, definition]))
    if (definitions.size !== expectedIds.length) throw new Error('formal_validation_profile_definition_inventory_mismatch')

    const candidateAssignments = expectedIds.map((candidateId): FormalValidationProfileAssignment => {
      const definition = definitions.get(candidateId)
      if (!definition) throw new Error(`formal_validation_profile_definition_missing:${candidateId}`)
      const candidateVersion = input.candidateSet.candidateVersions[candidateId]
      if (!candidateVersion || candidateVersion !== definition.strategyVersion) {
        throw new Error(`formal_validation_profile_definition_version_mismatch:${candidateId}`)
      }
      const componentIds = Array.from(new Set(definition.components.map(componentId).filter(Boolean))).sort()
      const override = input.assignmentOverrides?.[candidateId]
      const frozenComponentIds = override ? Array.from(new Set(override.componentIds.map(String).filter(Boolean))).sort() : componentIds
      if (frozenComponentIds.length === 0) throw new Error(`formal_validation_profile_components_missing:${candidateId}`)
      return {
        candidateId,
        candidateVersion,
        ...ASSIGNMENT_POLICY[candidateId],
        componentIds: frozenComponentIds,
        definitionHash: override?.definitionHash ?? formalValidationDefinitionHash(definition),
        componentSelectionMode: override?.componentSelectionMode ?? 'fixed_definition',
        selectionArtifactRef: override?.selectionArtifactRef ?? null,
        selectionArtifactSha256: override?.selectionArtifactSha256 ?? null,
      }
    })
    const productReleaseCandidateIds = candidateAssignments
      .filter((assignment) => assignment.formalGateApplicable)
      .map((assignment) => assignment.candidateId)
    if (productReleaseCandidateIds.length !== 1 || productReleaseCandidateIds[0] !== 'dividend_low_vol_basket') {
      throw new Error('formal_validation_profile_product_candidate_policy_violation')
    }
    const core = {
      schemaVersion: FORMAL_VALIDATION_PROFILE_SET_SCHEMA_VERSION,
      setVersion: input.setVersion ?? FORMAL_VALIDATION_PROFILE_SET_VERSION,
      candidateSet: {
        setId: input.candidateSet.setId,
        version: input.candidateSet.version,
        contentHash: input.candidateSet.contentHash,
      },
      ownerDecisionRef: FORMAL_VALIDATION_OWNER_DECISION_REF,
      inventoryCount: 7 as const,
      productReleaseCandidateIds,
      candidateAssignments,
      frozen: true as const,
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    }
    return {
      ...core,
      profileSetHash: formalValidationProfileSetHash(core),
    }
  }
}

export const formalValidationProfileService = new FormalValidationProfileService()
