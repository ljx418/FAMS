import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const GENERATED_AT = new Date().toISOString()
const STAMP = GENERATED_AT.replace(/[:.]/g, '-')
const ALLOWED_ACTIONS = ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT']
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']

const REQUIRED_DOCS = [
  'docs/DIVIDEND_LOW_VOL_PRD.md',
  'docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md',
  'docs/FORMAL_TRADING_RELEASE_DEVELOPMENT_ACCEPTANCE_PLAN.md',
  'docs/FORMAL_TRADING_RELEASE_DOC_AUDIT.md',
  'docs/TARGET_ARCHITECTURE_GAP.md',
  'docs/drawio-summary.txt',
  'docs/read-drawio-output.txt',
  'docs/target-architecture-gap.drawio',
]

const REQUIRED_IMPLEMENTATION_MARKERS = [
  'dataGovernanceAudit',
  'benchmarkQualificationAudit',
  'formalValidationAudit',
  'manualSignoffAudit',
  'executionIsolationAudit',
  'releaseGateAudit',
  'formalTradingUnlocked: false',
  'autoTradeUnlocked: false',
  'orderCreateAllowed: false',
  'canCreateOrder: false',
]

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

function backendRoot() {
  return resolve(repoRoot(), 'backend')
}

function auditDir() {
  return resolve(backendRoot(), 'data/gpt-audit/formal-trading-release', STAMP)
}

async function readRepoFile(path: string) {
  return readFile(resolve(repoRoot(), path), 'utf8')
}

async function readOptional(path: string) {
  return readFile(resolve(repoRoot(), path), 'utf8').catch(() => '')
}

async function gitCommit() {
  try {
    const head = await readRepoFile('.git/HEAD')
    const trimmed = head.trim()
    if (!trimmed.startsWith('ref:')) return trimmed
    return (await readRepoFile(`.git/${trimmed.slice(5)}`)).trim()
  } catch {
    return 'unknown'
  }
}

function diagramNames(drawio: string) {
  return Array.from(drawio.matchAll(/<diagram[^>]*name="([^"]+)"/g)).map((match) => match[1])
}

function containsLockedBoundary(content: string) {
  return [
    'formalTradingUnlocked=false',
    'autoTradeUnlocked=false',
    'canCreateOrder=false',
    'orderCreateAllowed=false',
  ].every((marker) => content.includes(marker))
}

function hardFailMatches(content: string) {
  const patterns = [
    /formalTradingUnlocked\s*[:=]\s*true/g,
    /autoTradeUnlocked\s*[:=]\s*true/g,
    /orderCreateAllowed\s*[:=]\s*true/g,
    /canCreateOrder\s*[:=]\s*true/g,
  ]
  return patterns.flatMap((pattern) => Array.from(content.matchAll(pattern)).map((match) => match[0]))
}

async function addJson(files: string[], name: string, data: unknown) {
  await writeFile(resolve(auditDir(), name), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  files.push(name)
}

async function addText(files: string[], name: string, data: string) {
  await writeFile(resolve(auditDir(), name), data, 'utf8')
  files.push(name)
}

async function buildManifest(files: string[]) {
  const items = await Promise.all(files.map(async (file) => {
    const path = resolve(auditDir(), file)
    const [content, info] = await Promise.all([readFile(path), stat(path)])
    return {
      file,
      sizeBytes: info.size,
      sha256: createHash('sha256').update(content).digest('hex'),
    }
  }))
  return {
    schemaVersion: 'formal_trading_release.stage_entry_manifest.v1',
    generatedAt: GENERATED_AT,
    gitCommit: await gitCommit(),
    items,
    allowedActions: ALLOWED_ACTIONS,
    prohibitedActions: PROHIBITED_ACTIONS,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }
}

async function main() {
  await mkdir(auditDir(), { recursive: true })
  const files: string[] = []
  const commit = await gitCommit()
  const docs = await Promise.all(REQUIRED_DOCS.map(async (path) => {
    const content = await readOptional(path)
    return {
      path,
      exists: content.length > 0,
      containsLockedBoundary: containsLockedBoundary(content),
      mentionsFtrPlan: content.includes('FTR-1') && content.includes('FTR-6'),
      sha256: content ? createHash('sha256').update(content).digest('hex') : null,
    }
  }))
  const drawio = await readOptional('docs/target-architecture-gap.drawio')
  const pages = diagramNames(drawio)
  const implementationContent = [
    await readOptional('backend/src/services/portfolio-backtest/portfolioBacktestEngine.ts'),
    await readOptional('backend/src/routes/portfolioBacktest.ts'),
    await readOptional('frontend/src/pages/Backtest.tsx'),
    await readOptional('backend/scripts/generate-interactive-strategy-backtest-audit-package.ts'),
  ].join('\n')
  const docsAndImplementation = [
    ...(await Promise.all(REQUIRED_DOCS.map((path) => readOptional(path)))),
    implementationContent,
  ].join('\n')
  const hardFailures = hardFailMatches(docsAndImplementation)
  const implementationMarkers = REQUIRED_IMPLEMENTATION_MARKERS.map((marker) => ({
    marker,
    present: implementationContent.includes(marker),
  }))
  const failedChecks = [
    ...docs.filter((doc) => !doc.exists).map((doc) => `doc_missing:${doc.path}`),
    ...docs.filter((doc) => !doc.containsLockedBoundary).map((doc) => `doc_lock_boundary_missing:${doc.path}`),
    ...(pages.length > 8 ? [`drawio_page_count_above_8:${pages.length}`] : []),
    ...(pages.length === 0 ? ['drawio_pages_missing'] : []),
    ...implementationMarkers.filter((item) => !item.present).map((item) => `implementation_marker_missing:${item.marker}`),
    ...hardFailures.map((failure) => `hard_fail_positive_unlock:${failure}`),
  ]
  const common = {
    generatedAt: GENERATED_AT,
    gitCommit: commit,
    strategyStage: 'formal_trading_release_prerequisite_implementation',
    allowedActions: ALLOWED_ACTIONS,
    prohibitedActions: PROHIBITED_ACTIONS,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }

  const stageEntryAudit = {
    schemaVersion: 'formal_trading_release.stage_entry_plan_audit.v1',
    ...common,
    status: failedChecks.length === 0 ? 'passed' : 'blocked',
    docs,
    drawio: {
      pageCount: pages.length,
      pageLimit: 8,
      pages,
    },
    implementationMarkers,
    failedChecks,
    decision: failedChecks.length === 0
      ? 'implementation_can_continue_under_locked_formal_trading_boundary'
      : 'implementation_must_return_to_planning_or_docs',
  }

  const prdSpecReview = {
    schemaVersion: 'formal_trading_release.prd_spec_review.v1',
    ...common,
    status: failedChecks.length === 0 ? 'passed' : 'blocked',
    currentStageCanDeclare: [
      'portfolioBacktestFormalReviewReady=true',
      'manualTradePlanDraftReviewReady=true',
      'longHorizonRealDataBacktestReady=true',
      'dataTrustVisible=true',
      'calculationAuditVisible=true',
    ],
    currentStageCannotDeclare: [
      'formalTradingUnlocked=true',
      'autoTradeUnlocked=true',
      'canCreateOrder=true',
      'orderCreateAllowed=true',
      'formal ADD/REDUCE released',
    ],
    requiredSubstages: [
      'FTR-1 field level data governance',
      'FTR-2 benchmark qualification',
      'FTR-3 formal validation',
      'FTR-4 manual signoff',
      'FTR-5 paper sandbox isolation',
      'FTR-6 release gate audit',
    ],
    highRiskStopConditions: [
      'positive formal trading unlock appears in docs or code',
      'free source marked official_authorized',
      'proxy benchmark used for formal trading unlock',
      'manual signoff auto-filled without human evidence',
      'paper order intent mutates real positions',
    ],
    failedChecks,
  }

  await addJson(files, '00_stage_entry_plan_audit.json', stageEntryAudit)
  await addJson(files, '00_prd_spec_review.json', prdSpecReview)
  await addText(files, 'SUMMARY_FOR_GPT.md', `# FTR Stage Entry Audit\n\nGeneratedAt: ${GENERATED_AT}\n\nStatus: ${stageEntryAudit.status}\n\nDecision: ${stageEntryAudit.decision}\n\nFormalTradingUnlocked: false\n\nAutoTradeUnlocked: false\n\nCanCreateOrder: false\n\nOrderCreateAllowed: false\n\nDrawioPageCount: ${pages.length}\n\nFailedChecks: ${failedChecks.join(', ') || 'none'}\n`)
  await addJson(files, 'manifest.json', await buildManifest(files))

  console.log(JSON.stringify({
    ok: failedChecks.length === 0,
    status: stageEntryAudit.status,
    auditDir: auditDir(),
    files,
    failedChecks,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
  }, null, 2))
  if (failedChecks.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
