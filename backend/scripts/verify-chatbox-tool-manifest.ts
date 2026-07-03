import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { famsChatService } from '../src/services/chat/famsChatService.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const EXPECTED_INTENTS = [
  'dividend_low_vol_top_candidates',
  'dividend_low_vol_trading_zone',
  'dividend_low_vol_scan',
  'dividend_low_vol_plan_draft',
  'refresh_data',
  'portfolio_summary',
  'portfolio_backtest_compare',
  'portfolio_backtest_operation',
  'portfolio_backtest_explain',
  'operation_status',
  'audit_report_explain',
  'data_trust_explain',
  'trade_action_blocked',
]

async function main() {
  const checkedAt = new Date().toISOString()
  const capabilities = await famsChatService.capabilities()
  const tools = capabilities.tools as any[]
  const registeredIntents = new Set(tools.map((tool) => tool.intent))
  const missingIntents = EXPECTED_INTENTS.filter((intent) => !registeredIntents.has(intent))
  const unsafeTools = tools.filter((tool) => /shell|filesystem|file_system|network|curl|wget|order_create|auto_trade/i.test(tool.name))
  const extraToolsNotInMatrix = tools.filter((tool) => !EXPECTED_INTENTS.includes(tool.intent))
  const invalidPermissions = tools.filter((tool) => !['read_only_direct', 'compute_quick_run', 'confirm_before_operation', 'permanently_blocked'].includes(tool.permissionType))
  const invalidConfirmations = tools.filter((tool) => {
    if (tool.permissionType === 'confirm_before_operation') return tool.confirmationPolicy !== 'required' || tool.risk !== 'confirm_required'
    if (tool.permissionType === 'permanently_blocked') return tool.confirmationPolicy !== 'blocked' || tool.risk !== 'blocked'
    return tool.confirmationPolicy !== 'none'
  })

  assert(missingIntents.length === 0, `ChatBox tool manifest missing intents: ${missingIntents.join(', ')}`)
  assert(unsafeTools.length === 0, `Unsafe tools exposed: ${unsafeTools.map((tool) => tool.name).join(', ')}`)
  assert(extraToolsNotInMatrix.length === 0, `Tools not declared in matrix: ${extraToolsNotInMatrix.map((tool) => tool.name).join(', ')}`)
  assert(invalidPermissions.length === 0, `Invalid permission types: ${invalidPermissions.map((tool) => tool.name).join(', ')}`)
  assert(invalidConfirmations.length === 0, `Invalid confirmation policies: ${invalidConfirmations.map((tool) => tool.name).join(', ')}`)
  assert(capabilities.prohibitedActions.includes('ORDER_CREATE'), 'ORDER_CREATE must remain prohibited')
  assert(capabilities.prohibitedActions.includes('AUTO_TRADE'), 'AUTO_TRADE must remain prohibited')

  const audit = {
    schemaVersion: 'fams.chatbox_tool_manifest_audit.v1',
    status: 'passed',
    checkedAt,
    registeredToolCount: tools.length,
    matrixToolCount: EXPECTED_INTENTS.length,
    coveragePercent: 100,
    missingTools: missingIntents,
    extraToolsNotInMatrix: extraToolsNotInMatrix.map((tool) => tool.name),
    unsafeTools: unsafeTools.map((tool) => tool.name),
    invalidPermissions: invalidPermissions.map((tool) => tool.name),
    invalidConfirmations: invalidConfirmations.map((tool) => tool.name),
    tools,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    allowedActions: capabilities.allowedActions,
    prohibitedActions: capabilities.prohibitedActions,
    notTradingAdvice: true,
  }
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })
  const auditPath = resolve(auditDir, 'chatbox_tool_manifest_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
