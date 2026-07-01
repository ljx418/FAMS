export type FamsLlmProvider = 'openai' | 'openai_compatible' | 'deepseek' | 'minimax' | 'disabled'

export type FamsLlmRuntimeConfig = {
  provider: FamsLlmProvider
  configured: boolean
  apiKey?: string
  keySource?: string
  model: string
  baseUrl?: string
  timeoutMs: number
  chatAgentEnabled: boolean
}

export type FamsLlmPublicStatus = {
  schemaVersion: 'fams.llm.public_status.v1'
  provider: FamsLlmProvider
  configured: boolean
  keySource: string | null
  model: string
  baseUrlConfigured: boolean
  timeoutMs: number
  chatAgentEnabled: boolean
  secretsRedacted: true
  supportedProviders: FamsLlmProvider[]
}

function normalizeProvider(value: string | undefined): FamsLlmProvider | 'auto' {
  const normalized = (value || '').trim().toLowerCase().replace(/-/g, '_')
  if (!normalized || normalized === 'auto') return 'auto'
  if (normalized === 'openai') return 'openai'
  if (normalized === 'openai_compatible' || normalized === 'compatible') return 'openai_compatible'
  if (normalized === 'deepseek') return 'deepseek'
  if (normalized === 'minimax') return 'minimax'
  if (normalized === 'disabled' || normalized === 'off' || normalized === 'none') return 'disabled'
  return 'auto'
}

function firstConfigured(candidates: Array<[string, string | undefined]>) {
  for (const [source, value] of candidates) {
    if (value && value.trim()) return { source, value: value.trim() }
  }
  return null
}

function defaultModel(provider: FamsLlmProvider) {
  if (provider === 'deepseek') return 'deepseek-chat'
  if (provider === 'minimax') return 'abab6.5s-chat'
  if (provider === 'openai_compatible') return 'gpt-4o-mini'
  if (provider === 'openai') return 'gpt-4o-mini'
  return 'disabled'
}

function defaultBaseUrl(provider: FamsLlmProvider) {
  if (provider === 'deepseek') return 'https://api.deepseek.com'
  if (provider === 'openai' || provider === 'openai_compatible') return 'https://api.openai.com/v1'
  return undefined
}

export function getFamsLlmConfig(): FamsLlmRuntimeConfig {
  const requestedProvider = normalizeProvider(process.env.FAMS_LLM_PROVIDER || process.env.LLM_PROVIDER)
  const autoKey = firstConfigured([
    ['FAMS_LLM_API_KEY', process.env.FAMS_LLM_API_KEY],
    ['OPENAI_API_KEY', process.env.OPENAI_API_KEY],
    ['DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY],
    ['MINIMAX_API_KEY', process.env.MINIMAX_API_KEY],
  ])
  const requestedProviderKey = requestedProvider === 'openai'
    ? firstConfigured([
      ['FAMS_LLM_API_KEY', process.env.FAMS_LLM_API_KEY],
      ['OPENAI_API_KEY', process.env.OPENAI_API_KEY],
    ])
    : null
  const shouldAutoDetectLegacyProvider = requestedProvider === 'openai'
    && !requestedProviderKey
    && Boolean(process.env.DEEPSEEK_API_KEY || process.env.MINIMAX_API_KEY)
  const effectiveRequestedProvider = shouldAutoDetectLegacyProvider ? 'auto' : requestedProvider
  const provider: FamsLlmProvider = effectiveRequestedProvider !== 'auto'
    ? effectiveRequestedProvider
    : autoKey?.source === 'DEEPSEEK_API_KEY'
      ? 'deepseek'
      : autoKey?.source === 'MINIMAX_API_KEY'
        ? 'minimax'
        : autoKey
          ? 'openai'
          : 'disabled'
  const key = provider === 'minimax'
    ? firstConfigured([
      ['FAMS_LLM_API_KEY', process.env.FAMS_LLM_API_KEY],
      ['MINIMAX_API_KEY', process.env.MINIMAX_API_KEY],
    ])
    : provider === 'deepseek'
      ? firstConfigured([
        ['FAMS_LLM_API_KEY', process.env.FAMS_LLM_API_KEY],
        ['DEEPSEEK_API_KEY', process.env.DEEPSEEK_API_KEY],
      ])
      : firstConfigured([
        ['FAMS_LLM_API_KEY', process.env.FAMS_LLM_API_KEY],
        ['OPENAI_API_KEY', process.env.OPENAI_API_KEY],
      ])

  const model = (process.env.FAMS_LLM_MODEL || process.env.LLM_MODEL || defaultModel(provider)).trim()
  const baseUrl = (process.env.FAMS_LLM_BASE_URL || process.env.LLM_BASE_URL || defaultBaseUrl(provider) || '').trim() || undefined
  const timeoutMs = Math.max(5_000, Math.min(120_000, Number(process.env.FAMS_LLM_TIMEOUT_MS || 30_000) || 30_000))
  return {
    provider: key && provider !== 'disabled' ? provider : 'disabled',
    configured: Boolean(key && provider !== 'disabled'),
    apiKey: key?.value,
    keySource: key?.source,
    model,
    baseUrl,
    timeoutMs,
    chatAgentEnabled: /^(1|true|yes)$/i.test(process.env.FAMS_CHAT_LLM_ENABLED || ''),
  }
}

export function getFamsLlmPublicStatus(): FamsLlmPublicStatus {
  const config = getFamsLlmConfig()
  return {
    schemaVersion: 'fams.llm.public_status.v1',
    provider: config.provider,
    configured: config.configured,
    keySource: config.keySource || null,
    model: config.model,
    baseUrlConfigured: Boolean(config.baseUrl),
    timeoutMs: config.timeoutMs,
    chatAgentEnabled: config.chatAgentEnabled,
    secretsRedacted: true,
    supportedProviders: ['openai', 'openai_compatible', 'deepseek', 'minimax', 'disabled'],
  }
}
