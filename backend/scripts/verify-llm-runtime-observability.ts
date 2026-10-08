import 'dotenv/config'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getFamsLlmConfig } from '../src/config/llmConfig.js'
import {
  classifyLlmFailure,
  LlmRuntimeStatusService,
  llmRuntimeStatusService,
  type LlmFailureCode,
} from '../src/services/llm/llmRuntimeStatusService.js'

const checkedAt = new Date().toISOString()

const classificationCases: Array<{ id: string; error: unknown; expected: LlmFailureCode }> = [
  { id: 'auth_401', error: Object.assign(new Error('Unauthorized'), { status: 401 }), expected: 'AUTH_FAILED' },
  { id: 'quota_402', error: Object.assign(new Error('Insufficient Balance request_id=private'), { status: 402 }), expected: 'QUOTA_EXHAUSTED' },
  { id: 'rate_429', error: Object.assign(new Error('Too many requests'), { status: 429 }), expected: 'RATE_LIMITED' },
  { id: 'timeout', error: new Error('Request timed out'), expected: 'TIMEOUT' },
  { id: 'network', error: new Error('fetch failed ECONNRESET'), expected: 'NETWORK_ERROR' },
  { id: 'invalid', error: new Error('invalid response: unusable payload'), expected: 'INVALID_RESPONSE' },
  { id: 'provider', error: new Error('upstream rejected request'), expected: 'PROVIDER_ERROR' },
]

for (const item of classificationCases) {
  assert.equal(classifyLlmFailure(item.error), item.expected, `Failure classification mismatch: ${item.id}`)
}

const controlled = new LlmRuntimeStatusService()
controlled.recordAttempt('chat_planner', { provider: 'controlled-provider', model: 'controlled-model' })
controlled.recordFailure('chat_planner', classificationCases[1].error)
let controlledSnapshot = controlled.snapshot('chat_planner')
assert.equal(controlledSnapshot.state, 'unavailable')
assert.equal(controlledSnapshot.lastFailureCode, 'QUOTA_EXHAUSTED')
assert.equal(controlledSnapshot.deterministicFallbackActive, true)
controlled.recordAttempt('chat_planner', { provider: 'controlled-provider', model: 'controlled-model' })
controlled.recordSuccess('chat_planner')
controlledSnapshot = controlled.snapshot('chat_planner')
assert.equal(controlledSnapshot.state, 'available')
assert.equal(controlledSnapshot.lastFailureCode, null)
assert.equal(controlledSnapshot.consecutiveFailures, 0)

process.env.FAMS_CHAT_LLM_ENABLED = '1'
const { chatLlmPlannerService } = await import('../src/services/chat/chatLlmPlannerService.js')
const config = getFamsLlmConfig()
llmRuntimeStatusService.resetForVerification()

let realProviderOutcome: 'success' | 'failure' | 'not_configured' = 'not_configured'
let realSummarySource: string | null = null
if (config.configured && config.apiKey) {
  try {
    const summary = await chatLlmPlannerService.summarizeResult({
      intent: 'portfolio_summary',
      userMessage: '请用一句话解释当前研究结果',
      deterministicReply: '当前结果来自结构化真实账户摘要，交易动作保持阻断。',
      structuredResult: {
        resultType: 'portfolio_summary',
        summary: '当前为受控研究结果。',
        keyNumbers: [{ label: '开放持仓', value: 16 }],
        nextActions: ['查看证据详情'],
        blockedReasons: [],
        dataHealth: { status: 'ready' },
      },
    })
    realProviderOutcome = 'success'
    realSummarySource = summary?.source || null
  } catch {
    realProviderOutcome = 'failure'
  }
}

const status = chatLlmPlannerService.publicStatus()
const summaryRuntime = status.runtime.capabilities.chatSummary
if (realProviderOutcome === 'not_configured') {
  assert.equal(status.configured, false)
  assert.equal(summaryRuntime.state, 'not_attempted')
} else if (realProviderOutcome === 'success') {
  assert.equal(summaryRuntime.state, 'available')
  assert.equal(status.summaryAvailable, true)
  assert.equal(realSummarySource, 'llm')
} else {
  assert.ok(['degraded', 'unavailable'].includes(summaryRuntime.state))
  assert.equal(status.summaryAvailable, false)
  assert.equal(status.summaryMode, 'deterministic_summary_fallback_after_provider_failure')
  assert.ok(summaryRuntime.lastFailureCode)
}

const serialized = JSON.stringify(status)
if (config.apiKey) assert.equal(serialized.includes(config.apiKey), false, 'Public runtime status leaked the API key')
assert.equal(/request[_-]?id|insufficient balance|bearer\s+/i.test(serialized), false, 'Public runtime status leaked raw provider error text')
assert.equal(status.runtime.rawProviderErrorsExposed, false)
assert.equal(status.formalTradingUnlocked, false)
assert.equal(status.autoTradeUnlocked, false)

const audit = {
  schemaVersion: 'fams.llm.runtime_observability.verification.v1',
  status: 'passed',
  checkedAt,
  classificationCases: classificationCases.map(({ id, expected }) => ({ id, expected, actual: expected })),
  recoveryVerified: controlledSnapshot.state === 'available',
  realProvider: {
    configured: config.configured,
    provider: config.provider,
    model: config.model,
    outcome: realProviderOutcome,
    summarySource: realSummarySource,
    runtimeState: summaryRuntime.state,
    failureCode: summaryRuntime.lastFailureCode,
  },
  publicStatus: status,
  secretsRedacted: true,
  deterministicFallbackTruthful: realProviderOutcome !== 'failure' || status.summaryAvailable === false,
  prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
  formalTradingUnlocked: false,
  autoTradeUnlocked: false,
  canCreateOrder: false,
  orderCreateAllowed: false,
}

const dir = resolve(process.cwd(), 'data', 'gpt-audit', 'llm-runtime-observability', checkedAt.replace(/[:.]/g, '-'))
await mkdir(dir, { recursive: true })
const auditPath = resolve(dir, 'llm_runtime_observability_audit.json')
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
