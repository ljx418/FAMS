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

function sha256(input: string) {
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
  const unsafeTradeUnlockLines = combinedText
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => TRADE_UNLOCK_PATTERNS.some((pattern) => line.includes(pattern)))
    .filter(({ line }) => !/rg -n|不得|不能|禁止|Hard fail|hard fail|反例|误写|检查|must not|not declare|禁止事项/.test(line))

  const checks = {
    requiredDocsPresent: files.length === REQUIRED_DOCS.length && files.every((file) => file.bytes > 0),
    drawioPageCountWithinLimit: diagramNames.length > 0 && diagramNames.length <= 8,
    requiredFlagsPresent: REQUIRED_FLAGS.every((flag) => combinedText.includes(flag)),
    stagePlanCoversS0ToS8: REQUIRED_STAGES.every((stage) => new RegExp(`\\b${stage}\\b`).test(stagePlan)),
    drawioReadOutputGenerated: diagramNames.every((name) => byPath['docs/read-drawio-output.txt'].content.includes(`## ${name}`))
      && byPath['docs/read-drawio-output.txt'].content.includes('Nodes:')
      && byPath['docs/read-drawio-output.txt'].content.includes('Edges:'),
    currentTargetArchitectureRelationDocumented: (combinedText.includes('当前架构') || combinedText.includes('当前/目标架构'))
      && combinedText.includes('目标架构')
      && (combinedText.includes('关联关系') || combinedText.includes('强关联') || combinedText.includes('架构关系')),
    tradeBoundaryLocked: unsafeTradeUnlockLines.length === 0,
  }

  for (const [name, passed] of Object.entries(checks)) {
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
