import { createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto'
import jwt, { type JwtPayload } from 'jsonwebtoken'
import { PORTFOLIO_MCP_SCOPES, type PortfolioMcpScope } from './portfolioMcpScopes.js'

type FetchLike = typeof fetch

export class PortfolioMcpOAuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: 401 | 403 | 503,
    readonly oauthError: 'invalid_token' | 'insufficient_scope' | 'server_error',
  ) {
    super(message)
  }
}

export type PortfolioMcpOAuthConfig = {
  enabled: boolean
  publicBaseUrl: string | null
  resourceUrl: string | null
  resourceMetadataUrl: string | null
  issuer: string | null
  audience: string | null
  jwksUri: string | null
  userIdClaim: string
  scopeClaim: string
  allowedOrigins: string[]
}

type JwkRecord = JsonWebKey & { kid?: string; alg?: string; use?: string }

function normalizedBaseUrl(value: string | undefined) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  if (!trimmed) return null
  try {
    return new URL(trimmed).toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function urlWithPath(base: string | null, path: string) {
  if (!base) return null
  const url = new URL(base)
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url.toString()
}

function isHttps(value: string | null) {
  if (!value) return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function isHttpsOrLoopback(value: string | null) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
  } catch {
    return false
  }
}

function scopesFromPayload(payload: JwtPayload, claim: string) {
  const value = payload[claim] ?? payload.scope ?? payload.scp
  const raw = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : []
  return raw.filter((scope): scope is PortfolioMcpScope => PORTFOLIO_MCP_SCOPES.includes(scope as PortfolioMcpScope))
}

export class PortfolioMcpOAuthService {
  private jwksCache = new Map<string, { expiresAt: number; keys: JwkRecord[] }>()

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  config(): PortfolioMcpOAuthConfig {
    const publicBaseUrl = normalizedBaseUrl(process.env.FAMS_MCP_PUBLIC_BASE_URL)
    const issuer = normalizedBaseUrl(process.env.FAMS_MCP_OAUTH_ISSUER)
    const jwksUri = normalizedBaseUrl(process.env.FAMS_MCP_OAUTH_JWKS_URI)
    const allowedOrigins = String(process.env.FAMS_MCP_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    return {
      enabled: process.env.FAMS_MCP_OAUTH_ENABLED === 'true',
      publicBaseUrl,
      resourceUrl: urlWithPath(publicBaseUrl, '/mcp'),
      resourceMetadataUrl: urlWithPath(publicBaseUrl, '/.well-known/oauth-protected-resource/mcp'),
      issuer,
      audience: String(process.env.FAMS_MCP_OAUTH_AUDIENCE || '').trim() || null,
      jwksUri,
      userIdClaim: String(process.env.FAMS_MCP_OAUTH_USER_ID_CLAIM || 'fams_user_id').trim(),
      scopeClaim: String(process.env.FAMS_MCP_OAUTH_SCOPE_CLAIM || 'scope').trim(),
      allowedOrigins,
    }
  }

  readiness() {
    const config = this.config()
    const missingConfiguration = [
      ...(!config.enabled ? ['FAMS_MCP_OAUTH_ENABLED'] : []),
      ...(!config.publicBaseUrl ? ['FAMS_MCP_PUBLIC_BASE_URL'] : []),
      ...(!config.issuer ? ['FAMS_MCP_OAUTH_ISSUER'] : []),
      ...(!config.audience ? ['FAMS_MCP_OAUTH_AUDIENCE'] : []),
      ...(!config.jwksUri ? ['FAMS_MCP_OAUTH_JWKS_URI'] : []),
      ...(config.allowedOrigins.length === 0 ? ['FAMS_MCP_ALLOWED_ORIGINS'] : []),
    ]
    const codeReady = missingConfiguration.length === 0 && isHttpsOrLoopback(config.jwksUri)
    const configurationPreflightReady = codeReady
      && isHttps(config.publicBaseUrl)
      && isHttps(config.issuer)
      && isHttps(config.jwksUri)
      && config.allowedOrigins.every((origin) => isHttps(origin))
    return {
      schemaVersion: 'fams.portfolio_mcp.oauth_readiness.v1' as const,
      generatedAt: new Date().toISOString(),
      oauthResourceServerCodeReady: true,
      oauthConfigurationPresent: missingConfiguration.length === 0,
      oauthConfigurationPreflightReady: configurationPreflightReady,
      externalHttpsDeploymentVerified: false,
      publicInternetReleaseReady: false,
      resource: config.resourceUrl,
      resourceMetadataUrl: config.resourceMetadataUrl,
      issuer: config.issuer,
      audienceConfigured: Boolean(config.audience),
      jwksUriConfigured: Boolean(config.jwksUri),
      allowedOriginCount: config.allowedOrigins.length,
      missingConfiguration,
      blockers: [
        ...missingConfiguration.map((item) => `missing:${item}`),
        ...(!isHttps(config.publicBaseUrl) ? ['public_base_url_must_be_https'] : []),
        ...(!isHttps(config.issuer) ? ['oauth_issuer_must_be_https'] : []),
        ...(!isHttps(config.jwksUri) ? ['oauth_jwks_uri_must_be_https_for_public_release'] : []),
        ...(config.allowedOrigins.some((origin) => !isHttps(origin)) ? ['all_allowed_origins_must_be_https'] : []),
        'external_https_deployment_not_verified',
        'external_authorization_flow_not_human_verified',
      ],
      supportedAuthModes: ['local_opaque_token', 'oauth_jwt'],
      supportedScopes: [...PORTFOLIO_MCP_SCOPES],
      brokerOrderToolsExposed: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    }
  }

  protectedResourceMetadata() {
    const config = this.config()
    if (!config.enabled || !config.resourceUrl || !config.issuer) {
      throw new PortfolioMcpOAuthError('MCP_OAUTH_METADATA_NOT_CONFIGURED', 503, 'server_error')
    }
    return {
      resource: config.resourceUrl,
      authorization_servers: [config.issuer],
      scopes_supported: [...PORTFOLIO_MCP_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'FAMS Portfolio Management MCP',
    }
  }

  wwwAuthenticate(input: { error?: 'invalid_token' | 'insufficient_scope'; scopes?: string[] } = {}) {
    const config = this.config()
    if (!config.enabled || !config.resourceMetadataUrl) return null
    const parts = [
      'Bearer',
      ...(input.error ? [`error="${input.error}"`] : []),
      `resource_metadata="${config.resourceMetadataUrl}"`,
      ...(input.scopes?.length ? [`scope="${input.scopes.join(' ')}"`] : []),
    ]
    return parts.join(' ')
  }

  private async getJwks(uri: string) {
    const cached = this.jwksCache.get(uri)
    if (cached && cached.expiresAt > Date.now()) return cached.keys
    let response: Response
    try {
      response = await this.fetchImpl(uri, { signal: AbortSignal.timeout(5_000) })
    } catch {
      throw new PortfolioMcpOAuthError('MCP_OAUTH_JWKS_UNAVAILABLE', 503, 'server_error')
    }
    if (!response.ok) throw new PortfolioMcpOAuthError('MCP_OAUTH_JWKS_UNAVAILABLE', 503, 'server_error')
    const body = await response.json() as { keys?: JwkRecord[] }
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new PortfolioMcpOAuthError('MCP_OAUTH_JWKS_INVALID', 503, 'server_error')
    }
    this.jwksCache.set(uri, { expiresAt: Date.now() + 5 * 60_000, keys: body.keys })
    return body.keys
  }

  async verifyAccessToken(token: string) {
    const config = this.config()
    if (!config.enabled || !config.issuer || !config.audience || !config.jwksUri) {
      throw new PortfolioMcpOAuthError('MCP_OAUTH_NOT_CONFIGURED', 503, 'server_error')
    }
    if (!isHttpsOrLoopback(config.jwksUri)) {
      throw new PortfolioMcpOAuthError('MCP_OAUTH_JWKS_URI_UNSAFE', 503, 'server_error')
    }
    const decoded = jwt.decode(token, { complete: true })
    const header = decoded && typeof decoded === 'object' ? decoded.header : null
    if (!header?.kid || header.alg !== 'RS256') {
      throw new PortfolioMcpOAuthError('MCP_OAUTH_TOKEN_INVALID', 401, 'invalid_token')
    }
    const keys = await this.getJwks(config.jwksUri)
    const jwk = keys.find((item) => item.kid === header.kid && (!item.alg || item.alg === 'RS256') && (!item.use || item.use === 'sig'))
    if (!jwk) throw new PortfolioMcpOAuthError('MCP_OAUTH_TOKEN_INVALID', 401, 'invalid_token')
    let key: KeyObject
    try {
      key = createPublicKey({ key: jwk, format: 'jwk' })
    } catch {
      throw new PortfolioMcpOAuthError('MCP_OAUTH_JWKS_INVALID', 503, 'server_error')
    }
    let payload: JwtPayload
    try {
      const verified = jwt.verify(token, key, {
        algorithms: ['RS256'],
        issuer: config.issuer,
        audience: config.audience,
      })
      if (typeof verified === 'string') throw new Error('invalid payload')
      payload = verified
    } catch {
      throw new PortfolioMcpOAuthError('MCP_OAUTH_TOKEN_INVALID', 401, 'invalid_token')
    }
    const subject = typeof payload.sub === 'string' ? payload.sub.trim() : ''
    const userIdValue = payload[config.userIdClaim]
    const userId = typeof userIdValue === 'string' ? userIdValue.trim() : ''
    if (!subject || !userId) throw new PortfolioMcpOAuthError('MCP_OAUTH_TOKEN_INVALID', 401, 'invalid_token')
    const scopes = scopesFromPayload(payload, config.scopeClaim)
    if (scopes.length === 0) throw new PortfolioMcpOAuthError('MCP_OAUTH_INSUFFICIENT_SCOPE', 403, 'insufficient_scope')
    return {
      subject,
      userId,
      scopes,
      expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null,
    }
  }
}

export const portfolioMcpOAuthService = new PortfolioMcpOAuthService()
