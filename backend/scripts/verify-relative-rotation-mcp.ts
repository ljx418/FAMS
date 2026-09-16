import assert from 'node:assert/strict'
import {
  buildDomainPackManifest,
  callMcpTool,
  listMcpTools,
} from '../src/mcp/registry.js'

const expectedTools = [
  'relative_rotation.get_industry_crowding',
  'relative_rotation.get_market_flow',
  'relative_rotation.refresh_industry_crowding',
  'relative_rotation.get_holdings_timeline',
  'relative_rotation.refresh_holdings_timeline',
  'relative_rotation.list_watchlist',
  'relative_rotation.add_watchlist_item',
  'relative_rotation.delete_watchlist_item',
  'relative_rotation.get_watchlist_timeline',
  'relative_rotation.refresh_watchlist_timeline',
  'relative_rotation.list_research_studies',
  'relative_rotation.create_research_study',
  'relative_rotation.update_research_study',
  'relative_rotation.delete_research_study',
  'relative_rotation.get_research_timeline',
  'relative_rotation.refresh_research_timeline',
]

const toolNames = listMcpTools().tools.map((tool) => tool.name)
for (const name of expectedTools) assert.ok(toolNames.includes(name), `missing MCP tool: ${name}`)

const manifest = buildDomainPackManifest()
assert.ok(manifest.domains.includes('relative_rotation'), 'relative_rotation domain missing from MCP manifest')

const invalidSeries = await callMcpTool(
  'relative_rotation.get_industry_crowding',
  { userId: 'default', detail: 'series' },
  { transport: 'stdio', userId: 'default', userContextSource: 'stdio_context' },
)
assert.equal(invalidSeries.status, 'failed')
assert.equal(invalidSeries.error?.code, 'INVALID_TOOL_INPUT')

const mismatchedUser = await callMcpTool(
  'relative_rotation.list_research_studies',
  { userId: 'another-user' },
  { transport: 'http', userId: 'default', userContextSource: 'http_header' },
)
assert.equal(mismatchedUser.status, 'failed')
assert.equal(mismatchedUser.error?.code, 'USER_CONTEXT_MISMATCH')

const deletionBlocked = await callMcpTool(
  'relative_rotation.delete_research_study',
  { userId: 'default', studyId: 'confirmation-contract-probe' },
  { transport: 'stdio', userId: 'default', userContextSource: 'stdio_context' },
)
assert.equal(deletionBlocked.status, 'blocked')
assert.equal((deletionBlocked.result as { code?: string }).code, 'HUMAN_CONFIRMATION_REQUIRED')

console.log(JSON.stringify({
  schemaVersion: 'fams.relative_rotation.mcp_verification.v1',
  toolCount: expectedTools.length,
  validation: 'passed',
  userIsolation: 'passed',
  deletionConfirmation: 'passed',
  status: 'passed',
}, null, 2))
