import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { prisma } from '../src/db/prisma.js'
import { createFamsMcpServer } from '../src/mcp/server.js'

async function main() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createFamsMcpServer({
    profile: 'volatility',
    defaultUserId: 'default',
    transport: 'stdio',
  })
  const client = new Client({ name: 'fams-volatility-protocol-test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const listed = await client.listTools()
  const names = new Set(listed.tools.map((tool) => tool.name))
  for (const required of [
    'volatility_workflow.reconcile',
    'volatility_workflow.run',
    'volatility_workflow.get_result',
    'capture.apply_extraction',
    'capture.confirm_rows',
    'market_data.get_asset_trend',
  ]) assert(names.has(required), `missing volatility MCP tool: ${required}`)
  for (const forbidden of [
    'transaction.create_manual_record',
    'grid_strategy.activate',
    'capture.vision_status',
    'relative_rotation.delete_watchlist_item',
  ]) assert(!names.has(forbidden), `unsafe or out-of-profile tool was exposed: ${forbidden}`)

  const resourceList = await client.listResources()
  const resourceUris = new Set(resourceList.resources.map((resource) => resource.uri))
  assert(resourceUris.has('fams://volatility/strategy/active'))
  assert(resourceUris.has('fams://volatility/portfolio/latest-reconciled'))
  assert(resourceUris.has('fams://volatility/rules'))
  const templates = await client.listResourceTemplates()
  assert(templates.resourceTemplates.some((item) => item.uriTemplate === 'fams://volatility/reviews/{reviewId}'))

  const rules = await client.readResource({ uri: 'fams://volatility/rules' })
  const rulesText = rules.contents.find((content) => 'text' in content)?.text || ''
  assert.match(rulesText, /doNotReplayHistoricalFills/)
  assert.match(rulesText, /"canCreateOrder": false/)

  const prompt = await client.getPrompt({ name: 'volatility-review', arguments: { sessionType: 'manual' } })
  const promptText = prompt.messages.map((message) => message.content.type === 'text' ? message.content.text : '').join('\n')
  assert.match(promptText, /volatility_workflow\.reconcile/)
  assert.match(promptText, /capture\.apply_extraction/)

  const reconciliation = await client.callTool({
    name: 'volatility_workflow.reconcile',
    arguments: { sessionType: 'manual', zeroNewTradesConfirmed: true },
  })
  assert.equal(reconciliation.isError, false)
  const structured = reconciliation.structuredContent as any
  assert.equal(structured.schemaVersion, 'fams.mcp.call.v1')
  assert.equal(structured.result.schemaVersion, 'fams.volatility-workflow.v1')
  assert.equal(structured.result.fivePartReport.executionPermission.canCreateOrder, false)
  assert.equal(structured.result.fivePartReport.confirmedFacts.doNotReplayHistoricalFills, true)

  const latestReview = await prisma.dailyReviewRun.findFirst({
    where: { userId: 'default' },
    orderBy: { generatedAt: 'desc' },
    select: { id: true },
  })
  if (latestReview) {
    const reviewResult = await client.callTool({
      name: 'volatility_workflow.get_result',
      arguments: { reviewId: latestReview.id, includeHtml: false },
    })
    assert.equal(reviewResult.isError, false)
    assert.equal((reviewResult.structuredContent as any)?.result?.schemaVersion, 'fams.volatility-workflow.v1')
    assert.equal((reviewResult.structuredContent as any)?.result?.executionBoundary?.canCreateOrder, false)
    const htmlResult = await client.callTool({
      name: 'volatility_workflow.get_result',
      arguments: { reviewId: latestReview.id, includeHtml: true },
    })
    const htmlContent = (htmlResult.structuredContent as any)?.result?.artifacts?.html?.content || ''
    if (['completed', 'partial'].includes((htmlResult.structuredContent as any)?.result?.status)) {
      assert.match(htmlContent, /^<!doctype html>/i)
      assert.match(htmlContent, /canCreateOrder=false/)
    }
    const reviewResource = await client.readResource({ uri: `fams://volatility/reviews/${latestReview.id}` })
    const reviewText = reviewResource.contents.find((content) => 'text' in content)?.text || ''
    assert.match(reviewText, /fams\.volatility-workflow\.v1/)
  }

  const mismatch = await client.callTool({
    name: 'volatility_workflow.reconcile',
    arguments: { userId: 'another-user', sessionType: 'manual' },
  })
  assert.equal(mismatch.isError, true)
  assert.equal((mismatch.structuredContent as any)?.error?.code, 'USER_CONTEXT_MISMATCH')

  await client.close()
  await server.close()

  const [fullClientTransport, fullServerTransport] = InMemoryTransport.createLinkedPair()
  const fullServer = createFamsMcpServer({ profile: 'full', defaultUserId: 'default', transport: 'stdio' })
  const fullClient = new Client({ name: 'fams-full-profile-compatibility-test', version: '1.0.0' })
  await fullServer.connect(fullServerTransport)
  await fullClient.connect(fullClientTransport)
  const fullList = await fullClient.listTools()
  assert(fullList.tools.length > listed.tools.length)
  assert(fullList.tools.some((tool) => tool.name === 'relative_rotation.get_holdings_timeline'))
  assert(fullList.tools.some((tool) => tool.name === 'create_transaction'))
  await fullClient.close()
  await fullServer.close()

  await prisma.$disconnect()
  process.stdout.write(JSON.stringify({
    ok: true,
    transport: 'in_memory_official_sdk',
    toolCount: listed.tools.length,
    resourceCount: resourceList.resources.length,
    templateCount: templates.resourceTemplates.length,
    fullProfileToolCount: fullList.tools.length,
    reviewResourceRead: Boolean(latestReview),
    hostVisionGate: structured.result.hostVision,
  }, null, 2) + '\n')
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined)
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
