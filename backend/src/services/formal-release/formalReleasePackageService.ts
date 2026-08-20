import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256Canonical } from './formalReleaseHash.js'

const REQUIRED_OPERATION_ARTIFACTS = [
  '13_execution_isolation_audit.json',
  '14_release_gate_audit.json',
  '15_data_governance_audit.json',
  '16_benchmark_qualification_audit.json',
  '17_formal_validation_audit.json',
  '18_manual_signoff_audit.json',
] as const

type OperationForPackage = {
  id: string
  type: string
  status: string
  inputJson: string
  resultJson: string
  artifactRefsJson: string
  completedAt: Date | null
}

function parseObject(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
}

export class FormalReleasePackageService {
  constructor(private readonly rootDir = resolve(process.cwd(), 'data', 'formal-release', 'packages')) {}

  async build(input: {
    operation: OperationForPackage
    operationManifestHash: string
    providerAuthorizationAudit: Record<string, any>
    formalBenchmarkAudits: Array<Record<string, any>>
    manualSignoffAudit: Record<string, any>
    productionAdapterApprovalRecord: Record<string, any>
    now?: Date
  }) {
    const generatedAt = (input.now ?? new Date()).toISOString()
    const operationResult = parseObject(input.operation.resultJson)
    const operationArtifacts = operationResult.artifacts && typeof operationResult.artifacts === 'object'
      ? operationResult.artifacts as Record<string, unknown>
      : {}
    const missingArtifacts = REQUIRED_OPERATION_ARTIFACTS.filter((name) => !(name in operationArtifacts))
    const sourceArtifactEntries = Object.entries(operationArtifacts).map(([name, value]) => ({
      name,
      source: 'operation',
      sha256: sha256Canonical(value),
    }))
    const dataGovernance = (operationArtifacts['15_data_governance_audit.json'] as any)?.dataGovernanceAudit || {}
    const benchmarkQualification = (operationArtifacts['16_benchmark_qualification_audit.json'] as any)?.benchmarkQualificationAudit || {}
    const formalValidation = (operationArtifacts['17_formal_validation_audit.json'] as any)?.formalValidationAudit || {}
    const executionIsolation = (operationArtifacts['13_execution_isolation_audit.json'] as any)?.executionIsolationAudit || {}
    const businessGates = {
      formalDataGovernancePassed: dataGovernance.status === 'passed' && input.providerAuthorizationAudit.status === 'passed',
      benchmarkQualificationPassed: benchmarkQualification.canSupportFormalTrading === true
        && input.formalBenchmarkAudits.some((audit) => audit.status === 'passed'),
      formalValidationPassed: formalValidation.formalValidationPassed === true && formalValidation.allReleaseCandidatesPassed === true,
      manualSignoffPassed: input.manualSignoffAudit.manualSignoffPassed === true,
      executionIsolationPassed: executionIsolation.mode === 'paper_sandbox_only'
        && executionIsolation.productionAdapterEnabled === false
        && executionIsolation.realPositionMutationAllowed === false
        && executionIsolation.orderCreateAllowed === false,
    }
    const packageChecks = {
      allRequiredArtifactsPresent: missingArtifacts.length === 0,
      allArtifactHashesVerified: sourceArtifactEntries.every((entry) => entry.sha256 === sha256Canonical(operationArtifacts[entry.name])),
      allReleaseCandidatesVisible: Boolean(formalValidation.releaseCandidateSet?.releaseCandidateStrategyIds?.length)
        && formalValidation.checks?.length === formalValidation.releaseCandidateSet?.releaseCandidateStrategyIds?.length,
      blockedAndInsufficientResultsPreserved: Array.isArray(formalValidation.checks)
        && formalValidation.checks.every((check: any) => ['passed', 'warning', 'insufficient', 'failed'].includes(check.status)),
    }
    const formalTradingReleaseReviewReady = Object.values(packageChecks).every(Boolean)
    const businessBlockers = [
      ...(!businessGates.formalDataGovernancePassed ? ['formal_data_governance_not_passed'] : []),
      ...(!businessGates.benchmarkQualificationPassed ? ['benchmark_qualification_not_passed'] : []),
      ...(!businessGates.formalValidationPassed ? ['formal_validation_not_passed'] : []),
      ...(!businessGates.manualSignoffPassed ? ['manual_signoff_not_passed'] : []),
      ...(!businessGates.executionIsolationPassed ? ['execution_isolation_not_passed'] : []),
      'production_order_adapter_not_enabled',
      'human_release_approval_pending',
    ]
    const releaseGateAudit = {
      schemaVersion: 'fams.formal_release.release_gate_audit.v1',
      generatedAt,
      operationId: input.operation.id,
      status: 'blocked',
      engineeringPackageStatus: formalTradingReleaseReviewReady ? 'ready_for_human_review' : 'incomplete',
      businessGates,
      packageChecks,
      blockers: businessBlockers,
      releaseApprovalStatus: 'pending_human_approval',
      formalTradingReleaseReviewReady,
      formalTradingReleaseReady: false,
      productionAdapterEnabled: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
      notTradingAdvice: true,
    }
    const summary = [
      '# FAMS Formal Release Review Summary',
      '',
      `- Operation: ${input.operation.id}`,
      `- Generated at: ${generatedAt}`,
      `- Engineering package: ${releaseGateAudit.engineeringPackageStatus}`,
      `- Business release gate: ${releaseGateAudit.status}`,
      '- Release approval: pending_human_approval',
      '- Production adapter: disabled',
      '- Trading/order permissions: locked',
      '',
      '## Business blockers',
      '',
      ...businessBlockers.map((blocker) => `- ${blocker}`),
      '',
      'This package is review evidence only and is not trading advice or an order authorization.',
      '',
    ].join('\n')
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>FAMS Formal Release Review</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#18202a}code{word-break:break-all}.blocked{color:#b42318}.ready{color:#067647}li{margin:6px 0}</style></head><body><h1>FAMS Formal Release Review</h1><p>Operation: <code>${escapeHtml(input.operation.id)}</code></p><p class="${formalTradingReleaseReviewReady ? 'ready' : 'blocked'}">Engineering package: ${escapeHtml(releaseGateAudit.engineeringPackageStatus)}</p><p class="blocked">Business release gate: blocked / pending human approval</p><h2>Business blockers</h2><ul>${businessBlockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join('')}</ul><h2>Hard boundary</h2><p>productionAdapterEnabled=false; formalTradingUnlocked=false; autoTradeUnlocked=false; canCreateOrder=false; orderCreateAllowed=false</p></body></html>\n`
    const generatedArtifactEntries = [
      { name: '14_release_gate_audit.json', source: 'generated', sha256: sha256Canonical(releaseGateAudit) },
      { name: 'acceptance-report.html', source: 'generated', sha256: sha256Canonical(html) },
      { name: 'SUMMARY_FOR_GPT.md', source: 'generated', sha256: sha256Canonical(summary) },
    ]
    const manifest = {
      schemaVersion: 'fams.formal_release.review_manifest.v1',
      generatedAt,
      operationId: input.operation.id,
      operationManifestHash: input.operationManifestHash,
      status: formalTradingReleaseReviewReady ? 'ready_for_human_review' : 'incomplete',
      sourceArtifacts: sourceArtifactEntries,
      generatedArtifacts: generatedArtifactEntries,
      missingArtifacts,
      packageChecks,
      businessGates,
      manualSignoffAuditHash: sha256Canonical(input.manualSignoffAudit),
      providerAuthorizationAuditHash: sha256Canonical(input.providerAuthorizationAudit),
      formalBenchmarkAuditsHash: sha256Canonical(input.formalBenchmarkAudits),
      productionAdapterApprovalRecordHash: sha256Canonical(input.productionAdapterApprovalRecord),
      humanReviewRequired: true,
      releaseApprovalStatus: 'pending_human_approval',
      formalTradingReleaseReviewReady,
      formalTradingReleaseReady: false,
      productionAdapterEnabled: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    }
    const packageHash = sha256Canonical(manifest)
    const packageDir = resolve(this.rootDir, input.operation.id, packageHash)
    await mkdir(packageDir, { recursive: true })
    const paths = {
      releaseGateAudit: resolve(packageDir, '14_release_gate_audit.json'),
      manifest: resolve(packageDir, 'formal_release_review_manifest.json'),
      html: resolve(packageDir, 'acceptance-report.html'),
      summary: resolve(packageDir, 'SUMMARY_FOR_GPT.md'),
    }
    await Promise.all([
      writeFile(paths.releaseGateAudit, `${JSON.stringify(releaseGateAudit, null, 2)}\n`, 'utf8'),
      writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      writeFile(paths.html, html, 'utf8'),
      writeFile(paths.summary, summary, 'utf8'),
    ])
    return { packageHash, packageDir, paths, manifest, releaseGateAudit, html, summary }
  }
}

export const formalReleasePackageService = new FormalReleasePackageService()
