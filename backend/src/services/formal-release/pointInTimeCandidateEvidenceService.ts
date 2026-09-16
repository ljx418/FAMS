import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256Canonical } from './formalReleaseHash.js'

const CANDIDATE_VERSION = 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time' as const

type Json = Record<string, any>

function sha256Bytes(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

export class PointInTimeCandidateEvidenceService {
  async latestQualified() {
    const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R1')
    const entries = await readdir(root, { withFileTypes: true })
    for (const directory of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
      const dir = resolve(root, directory)
      const path = resolve(dir, 'point_in_time_candidate_validation.json')
      try {
        await access(resolve(dir, 'INVALIDATED.json')).then(() => Promise.reject(new Error('invalidated'))).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
        const raw = await readFile(path)
        const artifact = JSON.parse(raw.toString('utf8')) as Json
        this.assertQualified(artifact)
        const windows = artifact.walkForward.windows as Json[]
        const componentIds = Array.from(new Set(windows.flatMap((window) => window.selectedSymbols.map(String)))).sort()
        const policy = {
          candidateId: 'dividend_low_vol_basket',
          candidateVersion: CANDIDATE_VERSION,
          componentSelectionMode: 'point_in_time_dynamic' as const,
          selectionSource: artifact.algorithm.selectionSource,
          ranking: artifact.algorithm.ranking,
          weightPolicy: artifact.algorithm.weightPolicy,
          maxComponents: artifact.algorithm.maxComponents,
          minimumComponents: artifact.algorithm.minimumComponents,
          feeRate: artifact.algorithm.feeRate,
          slippageRate: artifact.algorithm.slippageRate,
          benchmarkId: artifact.algorithm.benchmarkId,
          windows: windows.map((window) => ({
            windowId: window.windowId,
            decisionDate: window.decisionDate,
            trainingStartDate: window.trainingStartDate,
            trainingEndDate: window.trainingEndDate,
            validationStartDate: window.validationStartDate,
            validationEndDate: window.validationEndDate,
            selectedSymbols: window.selectedSymbols,
            sourceSnapshotSha256: window.sourceSnapshotSha256,
            parameterSnapshotHash: window.parameterSnapshotHash,
          })),
        }
        return {
          artifact,
          path,
          sha256: sha256Bytes(raw),
          componentIds,
          policy,
          definitionHash: sha256Canonical(policy),
        }
      } catch {
        // Partial, invalidated, or semantically unqualified runs remain evidence only.
      }
    }
    throw new Error('qualified_point_in_time_candidate_v2_not_found')
  }

  private assertQualified(artifact: Json) {
    if (artifact.schemaVersion !== 'fams.ftr_3r1.point_in_time_candidate_validation.v1'
      || artifact.stageId !== 'FTR-3R1'
      || artifact.candidateVersion !== CANDIDATE_VERSION
      || artifact.status !== 'passed'
      || artifact.realDataUsed !== true
      || artifact.summary?.pointInTimeCandidateV2ValidationPassed !== true
      || artifact.summary?.candidateV2RefreezeAllowed !== true
      || artifact.summary?.ftr4EntryAllowed !== false
      || artifact.walkForward?.configuredWindowCount !== 6
      || artifact.walkForward?.validWindowCount !== 6
      || Number(artifact.walkForward?.passedRatio) < 0.6
      || artifact.antiFalseGreen?.latestCandidateSnapshotBackfillDetected !== false
      || artifact.antiFalseGreen?.futureCandidateSelectionReuseDetected !== false
      || artifact.antiFalseGreen?.failedWindowsRemoved !== false
      || artifact.antiFalseGreen?.benchmarkChangedForPassing !== false
      || artifact.antiFalseGreen?.thresholdReduced !== false
      || artifact.antiFalseGreen?.historicalSecurityStatusProxyUsed !== false) {
      throw new Error('point_in_time_candidate_v2_not_qualified')
    }
    const windows = artifact.walkForward.windows
    if (!Array.isArray(windows) || windows.length !== 6) throw new Error('point_in_time_candidate_v2_windows_invalid')
    const ids = windows.flatMap((window: Json) => Array.isArray(window.selectedSymbols) ? window.selectedSymbols.map(String) : [])
    if (new Set(ids).size < 3) throw new Error('point_in_time_candidate_v2_component_union_below_3')
  }
}

export const pointInTimeCandidateEvidenceService = new PointInTimeCandidateEvidenceService()
export const POINT_IN_TIME_CANDIDATE_VERSION = CANDIDATE_VERSION
