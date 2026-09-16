import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/mcp/portfolioStdio.js'],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/dev.db',
      FAMS_MCP_USER_ID: 'default',
    },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const client = new Client({ name: 'fams-public-portfolio-stdio-test', version: '1.0.0' })
  await client.connect(transport)
  const tools = await client.listTools()
  assert(tools.tools.some((tool) => tool.name === 'portfolio_get_current_state'))
  assert(!tools.tools.some((tool) => tool.name === 'transaction.create_manual_record'))
  const current = await client.callTool({ name: 'portfolio_get_current_state', arguments: { accountScope: 'alipay' } })
  assert.notEqual(current.isError, true)
  const currentState = current.structuredContent as any
  assert.equal(currentState?.executionBoundary?.canCreateOrder, false)
  assert.equal(currentState?.allocationPlan?.strategyContract?.id, 'approved_allocation_v3_high_defense_10_15_50_25_2026')
  assert.equal(currentState?.allocationPlan?.strategyContract?.status, 'active')
  assert.deepEqual(
    currentState?.allocationPlan?.accounts?.find((account: any) => account.id === 'alipay')?.buckets
      ?.map((bucket: any) => [bucket.key, bucket.targetRatio]),
    [['cash', 10], ['gold', 15], ['bond', 50], ['equity', 25]],
  )
  assert.equal(currentState?.allocationPlan?.strategyActions?.rebalanceRequired, false)
  await client.close()
  assert.equal(stderr, '', `stdio server wrote unexpected stderr: ${stderr}`)
  process.stdout.write(JSON.stringify({
    ok: true,
    transport: 'stdio_official_sdk',
    toolCount: tools.tools.length,
    realPortfolioPositionCount: currentState?.positionCount,
    allocationContract: currentState?.allocationPlan?.strategyContract?.id,
    rebalanceRequired: currentState?.allocationPlan?.strategyActions?.rebalanceRequired,
  }, null, 2) + '\n')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
