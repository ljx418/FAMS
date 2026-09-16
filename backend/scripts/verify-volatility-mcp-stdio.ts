import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/mcp/stdio.js'],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db',
      FAMS_MCP_PROFILE: 'volatility',
      FAMS_MCP_DEFAULT_USER_ID: 'default',
    },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const client = new Client({ name: 'fams-volatility-stdio-test', version: '1.0.0' })
  await client.connect(transport)
  const tools = await client.listTools()
  assert(tools.tools.some((tool) => tool.name === 'volatility_workflow.reconcile'))
  assert(!tools.tools.some((tool) => tool.name === 'grid_strategy.activate'))
  const prompt = await client.getPrompt({ name: 'volatility-review', arguments: { sessionType: 'open' } })
  assert(prompt.messages.length > 0)
  const strategy = await client.readResource({ uri: 'fams://volatility/strategy/active' })
  const strategyText = strategy.contents.find((content) => 'text' in content)?.text || ''
  assert.match(strategyText, /fams\.volatility-workflow\.v1/)
  const result = await client.callTool({
    name: 'volatility_workflow.reconcile',
    arguments: { sessionType: 'open', zeroNewTradesConfirmed: true },
  })
  assert.equal(result.isError, false)
  assert.equal((result.structuredContent as any)?.result?.executionBoundary?.canCreateOrder, false)
  await client.close()
  assert.equal(stderr, '', `stdio server wrote unexpected stderr: ${stderr}`)
  process.stdout.write(JSON.stringify({
    ok: true,
    transport: 'stdio_official_sdk',
    toolCount: tools.tools.length,
    processSpawned: true,
  }, null, 2) + '\n')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
