/**
 * FAMS MCP stdio Provider
 *
 * Minimal JSON-RPC over stdio entrypoint for external Agent sessions.
 * It reuses the same registry as the HTTP bridge.
 */

import readline from 'node:readline'
import {
  buildDomainPackManifest,
  callMcpTool,
  listMcpTools,
} from './registry.js'

type JsonRpcRequest = {
  jsonrpc?: '2.0'
  id?: string | number | null
  method?: string
  params?: any
}

const writeMessage = (message: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

const toMcpTool = (tool: ReturnType<typeof listMcpTools>['tools'][number]) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: {
    domain: tool.domain,
    version: tool.version,
    aliases: tool.aliases,
    permissions: tool.permissions,
    safety: tool.safety,
  },
})

const toToolContent = (value: unknown) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(value, null, 2),
    },
  ],
})

const getStdioContextUserId = (params: any) => {
  const userId = params?.context?.userId || params?.requestContext?.userId
  return typeof userId === 'string' && userId.trim().length > 0 ? userId : undefined
}

const handleRequest = async (request: JsonRpcRequest) => {
  const id = request.id ?? null

  switch (request.method) {
    case 'initialize':
      return writeMessage({
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'financial-asset-manager',
            version: 'v2.0.0-alpha.1',
          },
          capabilities: {
            tools: {},
          },
        },
      })

    case 'tools/list': {
      const tools = listMcpTools().tools.map(toMcpTool)
      return writeMessage({ id, result: { tools } })
    }

    case 'tools/call': {
      const name = request.params?.name
      const parameters = request.params?.arguments || request.params?.parameters || {}
      const result = await callMcpTool(name, parameters, {
        requestId: id === null ? undefined : String(id),
        transport: 'stdio',
        userId: getStdioContextUserId(request.params),
        userContextSource: getStdioContextUserId(request.params) ? 'stdio_context' : undefined,
      })

      if (!result.success) {
        return writeMessage({
          id,
          error: {
            code: result.error?.code === 'TOOL_NOT_FOUND' ? -32601 : -32000,
            message: result.error?.message || 'Tool call failed',
            data: result,
          },
        })
      }

      return writeMessage({ id, result: toToolContent(result) })
    }

    case 'fams/domain-pack':
      return writeMessage({ id, result: buildDomainPackManifest() })

    case 'notifications/initialized':
      return undefined

    default:
      return writeMessage({
        id,
        error: {
          code: -32601,
          message: `Method '${request.method || 'unknown'}' not found`,
        },
      })
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

rl.on('line', (line) => {
  if (!line.trim()) return

  let request: JsonRpcRequest
  try {
    request = JSON.parse(line)
  } catch (error) {
    writeMessage({
      id: null,
      error: {
        code: -32700,
        message: error instanceof Error ? error.message : 'Parse error',
      },
    })
    return
  }

  void handleRequest(request)
})
