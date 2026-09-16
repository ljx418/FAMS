/** Official MCP stdio entrypoint for FAMS. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createFamsMcpServer, resolveMcpProfile } from './server.js'

async function main() {
  const server = createFamsMcpServer({
    profile: resolveMcpProfile(),
    defaultUserId: process.env.FAMS_MCP_DEFAULT_USER_ID || 'default',
    transport: 'stdio',
  })
  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  process.stderr.write(`[fams-mcp-stdio] ${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
