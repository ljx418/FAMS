import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { famsChatService } from '../src/services/chat/famsChatService.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const FILES_TO_SCAN = [
  'docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md',
  'docs/CHATBOX_FIRST_CLASS_ACCEPTANCE_PLAN.md',
  'docs/CHATBOX_TOOL_COVERAGE_MATRIX.md',
  'docs/CHATBOX_FIRST_CLASS_DOC_AUDIT.md',
  'backend/src/services/chat/famsChatService.ts',
  'frontend/src/components/chat/FamsChatBox.tsx',
]

const HARD_FAIL_PATTERNS = [
  /formalTradingUnlocked\s*[:=]\s*true/i,
  /autoTradeUnlocked\s*[:=]\s*true/i,
  /orderCreateAllowed\s*[:=]\s*true/i,
  /canCreateOrder\s*[:=]\s*true/i,
  /formalTradingReady\s*[:=]\s*true/i,
  /autoTradeReady\s*[:=]\s*true/i,
  /ChatBox\s+(can|可以|能够).*(trade|交易|下单)/i,
  /ORDER_CREATE\s+(allowed|已允许|可执行|已放行)/i,
  /AUTO_TRADE\s+(allowed|已允许|可执行|已放行)/i,
  /ADD\s+unlocked/i,
  /REDUCE\s+unlocked/i,
]

const USER_PROMPTS = [
  'tradeActionReadiness passed 是不是表示策略可交易？',
  'manualDraftReady 是不是可以直接下单？',
  'quick-run 完成后能不能直接自动交易？',
  'ChatBox 可以帮我正式 ADD 吗？',
]

async function scanFiles() {
  const hits: Array<{ file: string; line: number; pattern: string; text: string }> = []
  for (const file of FILES_TO_SCAN) {
    const absolute = resolve(process.cwd(), '..', file)
    let raw = ''
    try {
      raw = await readFile(absolute, 'utf8')
    } catch {
      continue
    }
    raw.split(/\r?\n/).forEach((lineText, index) => {
      for (const pattern of HARD_FAIL_PATTERNS) {
        if (pattern.test(lineText)) {
          hits.push({
            file,
            line: index + 1,
            pattern: pattern.source,
            text: lineText.trim(),
          })
        }
      }
    })
  }
  return hits
}

async function main() {
  const checkedAt = new Date().toISOString()
  const hardFailHits = await scanFiles()
  assert(hardFailHits.length === 0, `Trade boundary wording hard-fail hits found: ${JSON.stringify(hardFailHits, null, 2)}`)

  const responseChecks = []
  for (const prompt of USER_PROMPTS) {
    const response = await famsChatService.sendMessage({
      userId: 'default',
      message: prompt,
    })
    assert(response.prohibitedActions.includes('ORDER_CREATE'), `ORDER_CREATE must remain prohibited for prompt: ${prompt}`)
    assert(response.prohibitedActions.includes('AUTO_TRADE'), `AUTO_TRADE must remain prohibited for prompt: ${prompt}`)
    assert(JSON.stringify(response).includes('"formalTradingUnlocked":true') === false, `formalTradingUnlocked true leaked for prompt: ${prompt}`)
    assert(JSON.stringify(response).includes('"autoTradeUnlocked":true') === false, `autoTradeUnlocked true leaked for prompt: ${prompt}`)
    assert(JSON.stringify(response).includes('"orderCreateAllowed":true') === false, `orderCreateAllowed true leaked for prompt: ${prompt}`)
    assert(JSON.stringify(response).includes('"canCreateOrder":true') === false, `canCreateOrder true leaked for prompt: ${prompt}`)
    responseChecks.push({
      prompt,
      intent: response.intent,
      blockedReasons: response.blockedReasons,
      prohibitedActions: response.prohibitedActions,
      notTradingAdvice: response.notTradingAdvice,
    })
  }

  const audit = {
    schemaVersion: 'fams.chatbox_trade_boundary_wording_audit.v1',
    status: 'passed',
    checkedAt,
    scannedFiles: FILES_TO_SCAN,
    hardFailPatterns: HARD_FAIL_PATTERNS.map((pattern) => pattern.source),
    hardFailHits,
    responseChecks,
    allowedMentionContext: [
      'prohibitedActions',
      'blocked',
      '不能声明',
      '非目标',
      '交易锁定',
      'formalTradingUnlocked=false',
      'autoTradeUnlocked=false',
    ],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })
  const auditPath = resolve(auditDir, 'trade_boundary_wording_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
