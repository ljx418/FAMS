import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')

const REQUIRED_DOCS = [
  'docs/CURRENT_STAGE_DOCUMENTATION_CONSISTENCY_AUDIT.md',
  'docs/NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md',
  'docs/TARGET_ARCHITECTURE_GAP.md',
  'docs/target-architecture-gap.drawio',
  'docs/drawio-summary.txt',
  'docs/read-drawio-output.txt',
  'docs/current-stage-state.json',
  'docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json',
  'docs/FORMAL_DATA_GOVERNANCE_CONTRACT.md',
  'docs/FORMAL_VALIDATION_METRIC_DEFINITIONS.md',
]

const REQUIRED_FLAGS = [
  'documentationConsistencyReady=true',
  'drawioCurrentTargetRelationReady=true',
  'expertModuleTabsPreserved=true',
  'formalTradingUnlocked=false',
  'autoTradeUnlocked=false',
  'canCreateOrder=false',
  'orderCreateAllowed=false',
]

const REQUIRED_STAGES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
const REQUIRED_FTR_STAGES = ['FTR-0', 'FTR-1', 'FTR-2', 'FTR-3', 'FTR-4', 'FTR-5', 'FTR-6']
const TRADE_UNLOCK_PATTERNS = [
  'formalTradingUnlocked=true',
  'autoTradeUnlocked=true',
  'canCreateOrder=true',
  'orderCreateAllowed=true',
  'formalTradingReady=true',
  'ChatBox can trade',
  'ORDER_CREATE allowed',
  'AUTO_TRADE allowed',
]

function sha256(input: string | Buffer) {
  return createHash('sha256').update(input).digest('hex')
}

async function main() {
  const checkedAt = new Date().toISOString()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'next-stage-automation', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })

  const files = await Promise.all(REQUIRED_DOCS.map(async (relativePath) => {
    const content = await readFile(resolve(repoRoot, relativePath), 'utf8')
    return {
      relativePath,
      content,
      sha256: sha256(content),
      bytes: Buffer.byteLength(content),
    }
  }))

  const byPath = Object.fromEntries(files.map((file) => [file.relativePath, file]))
  const combinedText = files.map((file) => file.content).join('\n')
  const drawio = byPath['docs/target-architecture-gap.drawio'].content
  const diagramNames = Array.from(drawio.matchAll(/<diagram[^>]*name="([^"]+)"/g)).map((match) => match[1])
  const stagePlan = byPath['docs/NEXT_STAGE_DEVELOPMENT_ACCEPTANCE_PLAN.md'].content
  const ftrManifest = JSON.parse(byPath['docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json'].content)
  const currentState = JSON.parse(byPath['docs/current-stage-state.json'].content)
  const reviewPacketScope = await readFile(resolve(repoRoot, 'docs/claudecode-review-packet/00_REVIEW_SCOPE_AND_CLAIMS.md'), 'utf8')
  const declaredPacketHashes = Array.from(reviewPacketScope.matchAll(/^([0-9a-f]{64})\s{2}(.+)$/gm)).map((match) => ({
    sha256: match[1],
    fileName: match[2].trim(),
  }))
  const reviewPacketHashResults = await Promise.all(declaredPacketHashes.map(async (entry) => {
    const content = await readFile(resolve(repoRoot, 'docs/claudecode-review-packet', entry.fileName))
    return { ...entry, actualSha256: sha256(content), passed: sha256(content) === entry.sha256 }
  }))
  const unsafeTradeUnlockLines = files.flatMap((file) => {
    const lines = file.content.split('\n')
    return lines
      .map((line, index) => ({
        relativePath: file.relativePath,
        line,
        lineNumber: index + 1,
        context: lines.slice(Math.max(0, index - 8), index + 1).join('\n'),
        sectionHeading: lines.slice(0, index + 1).reverse().find((candidate) => /^#{1,6}\s/.test(candidate)) || '',
      }))
      .filter(({ line }) => TRADE_UNLOCK_PATTERNS.some((pattern) => line.includes(pattern)))
      .filter(({ context, sectionHeading }) => !/rg -n|不得|不能|禁止|Hard Fail|Hard fail|hard fail|反例|误写|检查|must not|not declare|禁止事项|以下任一项出现即/.test(`${sectionHeading}\n${context}`))
      .map(({ relativePath, line, lineNumber }) => ({ relativePath, line, lineNumber }))
  })

  const checks = {
    requiredDocsPresent: files.length === REQUIRED_DOCS.length && files.every((file) => file.bytes > 0),
    drawioPageCountWithinLimit: diagramNames.length > 0 && diagramNames.length <= 8,
    requiredFlagsPresent: REQUIRED_FLAGS.every((flag) => combinedText.includes(flag)),
    stagePlanCoversS0ToS8: REQUIRED_STAGES.every((stage) => new RegExp(`\\b${stage}\\b`).test(stagePlan)),
    ftrManifestCoversFtr0ToFtr6: JSON.stringify(ftrManifest.stageOrder) === JSON.stringify(REQUIRED_FTR_STAGES)
      && REQUIRED_FTR_STAGES.every((stage) => ftrManifest.stages?.[stage]?.stageId === stage),
    implementationApprovalEvidenceValid: currentState.implementationApproved === true
      && currentState.implementationApprovalEvidence?.decision === 'approved_for_controlled_implementation',
    publicSourcePolicyFrozen: currentState.preAutomationExternalPrerequisites?.includes('public_source_terms_and_local_noncommercial_use_scope_frozen')
      && byPath['docs/FORMAL_DATA_GOVERNANCE_CONTRACT.md'].content.includes('usageScope=local_personal_noncommercial'),
    formalValidationThresholdsFrozen: byPath['docs/FORMAL_VALIDATION_METRIC_DEFINITIONS.md'].content.includes('maxAnnualizedTurnoverPercent=200%')
      && byPath['docs/FORMAL_VALIDATION_METRIC_DEFINITIONS.md'].content.includes('bestWorstReturnSpreadPercentPoints <= 15')
      && byPath['docs/FORMAL_VALIDATION_METRIC_DEFINITIONS.md'].content.includes('maxDrawdownSpreadPercentPoints <= 10'),
    claudeCodeReviewPacketHashesVerified: declaredPacketHashes.length === 18 && reviewPacketHashResults.every((entry) => entry.passed),
    drawioReadOutputGenerated: diagramNames.every((name) => byPath['docs/read-drawio-output.txt'].content.includes(`## ${name}`))
      && byPath['docs/read-drawio-output.txt'].content.includes('Nodes:')
      && byPath['docs/read-drawio-output.txt'].content.includes('Edges:'),
    currentTargetArchitectureRelationDocumented: (combinedText.includes('当前架构') || combinedText.includes('当前/目标架构'))
      && combinedText.includes('目标架构')
      && (combinedText.includes('关联关系') || combinedText.includes('强关联') || combinedText.includes('架构关系')),
    tradeBoundaryLocked: unsafeTradeUnlockLines.length === 0
      && currentState.statuses.formalTradingUnlocked === false
      && currentState.statuses.autoTradeUnlocked === false
      && currentState.statuses.canCreateOrder === false
      && currentState.statuses.orderCreateAllowed === false,
  }

  for (const [name, passed] of Object.entries(checks)) {
    if (!passed && name === 'tradeBoundaryLocked') console.error(JSON.stringify({ unsafeTradeUnlockLines }, null, 2))
    assert.equal(passed, true, `Documentation baseline failed: ${name}`)
  }

  const audit = {
    schemaVersion: 'fams.next_stage.documentation_baseline_audit.v1',
    status: 'passed',
    checkedAt,
    docs: files.map(({ relativePath, sha256: digest, bytes }) => ({ relativePath, sha256: digest, bytes })),
    drawio: {
      pageCount: diagramNames.length,
      pageLimit: 8,
      pageNames: diagramNames,
    },
    requiredFlags: REQUIRED_FLAGS,
    requiredStages: REQUIRED_STAGES,
    requiredFtrStages: REQUIRED_FTR_STAGES,
    claudeCodeReviewPacket: {
      declaredHashCount: declaredPacketHashes.length,
      verifiedHashCount: reviewPacketHashResults.filter((entry) => entry.passed).length,
      files: reviewPacketHashResults,
    },
    checks,
    unsafeTradeUnlockLines,
    conclusion: {
      documentationSupportsAutomation: true,
      architectureCanBeAuditedAgainstDrawio: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    notTradingAdvice: true,
  }

  const auditPath = resolve(auditDir, '00_documentation_baseline_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
