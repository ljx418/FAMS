import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { prisma } from '../src/db/prisma.js'
import {
  createPublicPortfolioMcpServer,
  PUBLIC_PORTFOLIO_MCP_TOOL_NAMES,
} from '../src/mcp/publicPortfolioServer.js'
import type { PortfolioMcpPrincipal } from '../src/services/mcp/portfolioMcpAuthService.js'

async function verifyPlanDecisionWriteBoundary() {
  const fixtureUserId = `test-portfolio-mcp-${randomUUID()}`
  await prisma.user.create({
    data: {
      id: fixtureUserId,
      email: `${fixtureUserId}@local.invalid`,
      passwordHash: 'test-only',
      name: 'Portfolio MCP acceptance fixture',
    },
  })
  try {
    const asset = await prisma.asset.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })
    const advice = await prisma.advice.create({ data: { userId: fixtureUserId, status: 'proposed' } })
    const action = await prisma.adviceAction.create({
      data: { adviceId: advice.id, assetId: asset.id, actionType: 'buy', suggestedAmount: 100, status: 'proposed' },
    })
    const review = await prisma.dailyReviewRun.create({
      data: {
        userId: fixtureUserId,
        adviceId: advice.id,
        sessionType: 'manual',
        triggerSource: 'test',
        status: 'completed',
        reportJson: JSON.stringify({
          oneClickWorkflow: {
            readyForHumanReview: true,
            tradeDrafts: [{
              adviceActionId: action.id,
              symbol: asset.symbol,
              action: 'buy',
              firstTrancheAmount: 100,
              fullAmount: 400,
              currentState: 'manual_confirmation_required',
            }],
          },
        }),
      },
    })
    const principal: PortfolioMcpPrincipal = {
      subject: `contract-test:${fixtureUserId}`,
      userId: fixtureUserId,
      scopes: new Set(['portfolio:read', 'review:run', 'capture:write', 'plan:write']),
      transport: 'stdio',
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createPublicPortfolioMcpServer(principal)
    const client = new Client({ name: 'fams-public-portfolio-plan-write-test', version: '1.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const result = await client.callTool({
      name: 'portfolio_plan_save_decision',
      arguments: {
        reviewId: review.id,
        actionId: action.id,
        decision: 'modified',
        overrideAmount: 80,
        notes: '自动验收：只保存人工计划',
        confirmation: { confirmed: true, confirmedBy: 'automated-acceptance' },
      },
    })
    assert.notEqual(result.isError, true)
    const execution = await prisma.adviceExecution.findUniqueOrThrow({ where: { adviceActionId: action.id } })
    assert.equal(execution.decision, 'modified')
    assert.equal(execution.executedAt, null)
    assert.equal(await prisma.transaction.count({ where: { userId: fixtureUserId } }), 0)
    assert.equal(await prisma.position.count({ where: { userId: fixtureUserId } }), 0)
    await client.close()
    await server.close()
    return true
  } finally {
    await prisma.user.deleteMany({ where: { id: fixtureUserId } })
  }
}

async function main() {
  const transactionCountBefore = await prisma.transaction.count({ where: { userId: 'default' } })
  const principal: PortfolioMcpPrincipal = {
    subject: 'contract-test:default',
    userId: 'default',
    scopes: new Set(['portfolio:read']),
    transport: 'stdio',
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createPublicPortfolioMcpServer(principal)
  const client = new Client({ name: 'fams-public-portfolio-contract-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const listed = await client.listTools()
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [...PUBLIC_PORTFOLIO_MCP_TOOL_NAMES].sort(),
    'public profile must expose exactly the reviewed portfolio tool set',
  )
  for (const tool of listed.tools) {
    assert(!Object.prototype.hasOwnProperty.call(tool.inputSchema.properties || {}, 'userId'), `${tool.name} leaks userId selection`)
  }
  for (const forbidden of [
    'transaction.create_manual_record',
    'grid_strategy.activate',
    'volatility_workflow.run',
    'relative_rotation.delete_watchlist_item',
  ]) assert(!listed.tools.some((tool) => tool.name === forbidden), `forbidden tool exposed: ${forbidden}`)
  const extractionTool = listed.tools.find((tool) => tool.name === 'portfolio_screenshot_save_extraction') as any
  assert.deepEqual(
    extractionTool?.inputSchema?.properties?.rows?.items?.properties?.rowType?.enum,
    ['account_summary', 'holding'],
    'public screenshot extraction must reject transaction and order rows at schema level',
  )
  const confirmTool = listed.tools.find((tool) => tool.name === 'portfolio_screenshot_confirm') as any
  assert.equal(
    confirmTool?.inputSchema?.properties?.confirmation?.properties?.confirmed?.const,
    true,
    'screenshot confirmation must require an explicit true literal',
  )

  const current = await client.callTool({
    name: 'portfolio_get_current_state',
    arguments: { accountScope: 'alipay' },
  })
  assert.notEqual(current.isError, true)
  const state = current.structuredContent as any
  assert.equal(state.schemaVersion, 'fams.mcp.portfolio-state.v1')
  assert.equal(state.accountScope, 'alipay')
  assert.equal(state.executionBoundary.canCreateOrder, false)
  assert.equal(state.executionBoundary.autoTradeUnlocked, false)
  assert(Number.isFinite(state.totalValue))
  assert(Array.isArray(state.positions))

  const preflight = await client.callTool({
    name: 'portfolio_review_preflight',
    arguments: { portfolioChangedSinceLastCapture: false },
  })
  assert.notEqual(preflight.isError, true)
  assert.equal((preflight.structuredContent as any)?.schemaVersion, 'fams.alipay-one-click-preflight.v1')
  assert.equal(typeof (preflight.structuredContent as any)?.canRun, 'boolean')

  const deniedWrite = await client.callTool({
    name: 'portfolio_snapshot_revoke_reuse',
    arguments: { reason: '权限边界契约测试' },
  })
  assert.equal(deniedWrite.isError, true)
  assert.equal((deniedWrite.structuredContent as any)?.code, 'MCP_SCOPE_REQUIRED')

  const resources = await client.listResources()
  const resourceUris = new Set(resources.resources.map((resource) => resource.uri))
  for (const uri of [
    'fams://portfolio/current',
    'fams://portfolio/contracts/current',
    'fams://portfolio/reviews/latest',
    'fams://data-health/current',
  ]) assert(resourceUris.has(uri), `missing resource: ${uri}`)
  const templates = await client.listResourceTemplates()
  assert(templates.resourceTemplates.some((item) => item.uriTemplate === 'fams://portfolio/reviews/{operationId}'))
  const prompt = await client.getPrompt({
    name: 'daily_portfolio_review',
    arguments: { sessionType: 'manual', portfolioChangedSinceLastCapture: 'no' },
  })
  const promptText = prompt.messages.map((message) => message.content.type === 'text' ? message.content.text : '').join('\n')
  assert.match(promptText, /portfolio_review_preflight/)
  assert.match(promptText, /不得宣称已下单或已成交/)

  const transactionCountAfter = await prisma.transaction.count({ where: { userId: 'default' } })
  assert.equal(transactionCountAfter, transactionCountBefore, 'read-only contract test created a transaction')

  await client.close()
  await server.close()
  const planDecisionWriteBoundaryVerified = await verifyPlanDecisionWriteBoundary()
  await prisma.$disconnect()
  process.stdout.write(JSON.stringify({
    ok: true,
    transport: 'in_memory_official_sdk',
    realPortfolioPositionCount: state.positionCount,
    positiveFinitePortfolioTotalVerified: state.totalValue > 0,
    toolCount: listed.tools.length,
    resourceCount: resources.resources.length,
    transactionBoundaryPreserved: true,
    planDecisionWriteBoundaryVerified,
    realPreflightEvaluated: true,
  }, null, 2) + '\n')
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined)
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
