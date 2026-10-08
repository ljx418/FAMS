import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { prisma } from '../src/db/prisma.js'
import { createFamsMcpServer } from '../src/mcp/server.js'

const expectedTools = [
  'investment_workflow.get_readiness',
  'investment_workflow.list_strategy_assignments',
  'investment_workflow.suggest_strategy_assignments',
  'investment_workflow.confirm_strategy_assignment',
  'investment_workflow.run_rotation_volatility_strategy',
  'investment_workflow.get_dividend_low_vol_plan',
  'investment_workflow.refresh_dividend_low_vol_research',
  'investment_workflow.get_portfolio_state',
  'investment_workflow.preflight_portfolio_review',
  'investment_workflow.start_portfolio_review',
  'investment_workflow.get_portfolio_review',
  'investment_workflow.compare_saved_advice_scenarios',
  'backtest.grid_replay.list_sources',
  'backtest.grid_replay.run',
  'backtest.grid_replay.get_result',
  'trade_ledger.get_ingestion_batch',
  'trade_ledger.run_reconciliation',
  'trade_ledger.get_reconciliation',
  'trade_ledger.list_pending_matches',
  'trade_ledger.confirm_execution_match',
  'trade_ledger.get_plan_lifecycle',
  'investment_workflow.get_strategy_run',
  'capture.upload_screenshot',
  'capture.apply_extraction',
  'capture.get_preview',
  'capture.update_row',
  'capture.confirm_rows',
  'market_data.get_asset_trend',
  'operation.get',
] as const

async function main() {
  const workspaceRoot = resolve(process.cwd(), '..')
  const launchConfig = JSON.parse(await readFile(resolve(workspaceRoot, 'mcp/financial-mcp.json'), 'utf8'))
  assert.equal(launchConfig.mcpServers['financial-asset-manager'].env.FAMS_MCP_PROFILE, 'workflow')
  assert.ok(launchConfig.mcpServers['financial-asset-manager-portfolio'])
  assert.ok(launchConfig.mcpServers['financial-asset-manager-volatility'])
  assert.ok(launchConfig.mcpServers['financial-asset-manager-research'])

  const connectorConfig = JSON.parse(await readFile(resolve(workspaceRoot, 'mcp/harnessos-connector.json'), 'utf8'))
  assert.equal(connectorConfig.version, 'v2.2.0')
  assert.equal(connectorConfig.connectors.find((connector: any) => connector.id === 'fams_mcp_http')?.status, 'deprecated_compatibility_only')
  assert.equal(connectorConfig.connectors.find((connector: any) => connector.id === 'fams_mcp_stdio')?.env?.FAMS_MCP_PROFILE, 'workflow')
  assert.equal(connectorConfig.connectors.find((connector: any) => connector.id === 'fams_mcp_streamable_http')?.env?.FAMS_MCP_PROFILE, 'workflow')

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createFamsMcpServer({ profile: 'workflow', defaultUserId: 'default', transport: 'stdio' })
  const client = new Client({ name: 'fams-investment-workflow-mcp-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const tools = await client.listTools()
  const names = tools.tools.map((tool) => tool.name).sort()
  assert.deepEqual(names, [...expectedTools].sort())
  assert.equal(tools.tools.find((tool) => tool.name === 'trade_ledger.confirm_execution_match')?.annotations?.destructiveHint, false)
  for (const forbidden of ['create_transaction', 'transaction.create_manual_record', 'grid_strategy.activate', 'relative_rotation.delete_watchlist_item']) {
    assert(!names.includes(forbidden), `unsafe or expert-only tool exposed: ${forbidden}`)
  }

  const resources = await client.listResources()
  const resourceUris = new Set(resources.resources.map((resource) => resource.uri))
  for (const uri of [
    'fams://investment-workflow/contract',
    'fams://investment-workflow/readiness',
    'fams://investment-workflow/assignments',
    'fams://investment-workflow/portfolio/current',
    'fams://backtest/grid-replay/rules',
  ]) assert(resourceUris.has(uri), `missing workflow resource: ${uri}`)

  const prompts = await client.listPrompts()
  const promptNames = new Set(prompts.prompts.map((prompt) => prompt.name))
  for (const prompt of ['basic-information-confirmation', 'position-strategy', 'backtest-review']) {
    assert(promptNames.has(prompt), `missing workflow prompt: ${prompt}`)
  }

  const contract = await client.readResource({ uri: 'fams://investment-workflow/contract' })
  const contractText = contract.contents.find((content) => 'text' in content)?.text || ''
  assert.match(contractText, /basic_information_confirmation/)
  assert.match(contractText, /"formalTradingUnlocked": false/)
  assert.match(contractText, /"orderCreateAllowed": false/)

  const replayRules = await client.readResource({ uri: 'fams://backtest/grid-replay/rules' })
  const replayRulesText = replayRules.contents.find((content) => 'text' in content)?.text || ''
  assert.match(replayRulesText, /insufficient_intraday_evidence/)
  assert.match(replayRulesText, /T\+1/)

  const readiness = await client.callTool({ name: 'investment_workflow.get_readiness', arguments: {} })
  assert.equal(readiness.isError, false)
  const readinessEnvelope = readiness.structuredContent as any
  assert.equal(readinessEnvelope.schemaVersion, 'fams.mcp.call.v1')
  assert.deepEqual(readinessEnvelope.result.workflow.steps, ['basic_information_confirmation', 'position_strategy', 'backtest_review'])
  assert.equal(readinessEnvelope.result.permissionState.formalTradingUnlocked, false)
  assert.equal(readinessEnvelope.result.permissionState.autoTradeUnlocked, false)
  assert.equal(readinessEnvelope.result.permissionState.canCreateOrder, false)
  assert.equal(readinessEnvelope.result.permissionState.orderCreateAllowed, false)

  const dividend = await client.callTool({ name: 'investment_workflow.get_dividend_low_vol_plan', arguments: { limit: 3 } })
  assert.equal(dividend.isError, false)
  const dividendResult = (dividend.structuredContent as any).result
  assert.equal(dividendResult.schemaVersion, 'fams.investment-workflow.dividend-low-vol-plan.v1')
  assert.equal(dividendResult.permissionState.canCreateOrder, false)

  const portfolio = await client.callTool({ name: 'investment_workflow.get_portfolio_state', arguments: {} })
  assert.equal(portfolio.isError, false)
  assert.equal((portfolio.structuredContent as any).result.executionBoundary.orderCreateAllowed, false)

  const assignmentBlocked = await client.callTool({
    name: 'investment_workflow.confirm_strategy_assignment',
    arguments: { positionId: 'not-used-before-confirmation', strategyFamily: 'rotation_volatility' },
  })
  assert.equal(assignmentBlocked.isError, false)
  assert.equal((assignmentBlocked.structuredContent as any).status, 'blocked')
  assert.equal((assignmentBlocked.structuredContent as any).result.code, 'HUMAN_CONFIRMATION_REQUIRED')

  const scanBlocked = await client.callTool({
    name: 'investment_workflow.refresh_dividend_low_vol_research',
    arguments: { idempotencyKey: 'workflow-contract-test', limit: 10 },
  })
  assert.equal(scanBlocked.isError, false)
  assert.equal((scanBlocked.structuredContent as any).status, 'blocked')

  const reviewBlocked = await client.callTool({
    name: 'investment_workflow.start_portfolio_review',
    arguments: { portfolioChangedSinceLastCapture: false, idempotencyKey: 'workflow-review-contract-test' },
  })
  assert.equal(reviewBlocked.isError, false)
  assert.equal((reviewBlocked.structuredContent as any).status, 'blocked')

  const strategyPrompt = await client.getPrompt({ name: 'position-strategy', arguments: { strategyFamily: 'dividend_low_vol' } })
  const promptText = strategyPrompt.messages.map((message) => message.content.type === 'text' ? message.content.text : '').join('\n')
  assert.match(promptText, /investment_workflow\.get_readiness/)
  assert.match(promptText, /investment_workflow\.get_dividend_low_vol_plan/)
  assert.match(promptText, /不得声称已经下单或成交/)

  const mismatch = await client.callTool({ name: 'investment_workflow.get_readiness', arguments: { userId: 'another-user' } })
  assert.equal(mismatch.isError, true)
  assert.equal((mismatch.structuredContent as any).error.code, 'USER_CONTEXT_MISMATCH')

  await client.close()
  await server.close()
  await prisma.$disconnect()
  process.stdout.write(JSON.stringify({
    ok: true,
    profile: 'workflow',
    toolCount: names.length,
    resourceCount: resources.resources.length,
    promptCount: prompts.prompts.length,
    realPositionCount: readinessEnvelope.result.facts.openPositionCount,
    blockedConfirmationCases: 3,
    externalConfigurationContractPassed: true,
  }, null, 2) + '\n')
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined)
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
