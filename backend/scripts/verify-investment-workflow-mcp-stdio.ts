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
      FAMS_MCP_PROFILE: 'workflow',
      FAMS_MCP_DEFAULT_USER_ID: 'default',
    },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const client = new Client({ name: 'fams-workflow-stdio-test', version: '1.0.0' })
  await client.connect(transport)

  const tools = await client.listTools()
  assert(tools.tools.some((tool) => tool.name === 'investment_workflow.get_readiness'))
  assert(tools.tools.some((tool) => tool.name === 'investment_workflow.compare_saved_advice_scenarios'))
  assert(tools.tools.some((tool) => tool.name === 'backtest.grid_replay.list_sources'))
  assert(tools.tools.some((tool) => tool.name === 'backtest.grid_replay.run'))
  assert(tools.tools.some((tool) => tool.name === 'backtest.grid_replay.get_result'))
  assert(!tools.tools.some((tool) => tool.name === 'create_transaction'))
  assert(!tools.tools.some((tool) => tool.name === 'grid_strategy.activate'))

  const prompts = await client.listPrompts()
  assert(prompts.prompts.some((prompt) => prompt.name === 'basic-information-confirmation'))
  assert(prompts.prompts.some((prompt) => prompt.name === 'position-strategy'))
  assert(prompts.prompts.some((prompt) => prompt.name === 'backtest-review'))

  const readiness = await client.callTool({ name: 'investment_workflow.get_readiness', arguments: {} })
  assert.equal(readiness.isError, false)
  assert.equal((readiness.structuredContent as any)?.result?.permissionState?.canCreateOrder, false)
  assert.equal((readiness.structuredContent as any)?.result?.permissionState?.orderCreateAllowed, false)

  await client.close()
  assert.equal(stderr, '', `stdio server wrote unexpected stderr: ${stderr}`)
  process.stdout.write(JSON.stringify({
    ok: true,
    transport: 'stdio_official_sdk',
    profile: 'workflow',
    toolCount: tools.tools.length,
  }, null, 2) + '\n')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
