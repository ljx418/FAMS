export const PORTFOLIO_MCP_SCOPES = [
  'portfolio:read',
  'review:run',
  'capture:write',
  'plan:write',
] as const

export type PortfolioMcpScope = typeof PORTFOLIO_MCP_SCOPES[number]
