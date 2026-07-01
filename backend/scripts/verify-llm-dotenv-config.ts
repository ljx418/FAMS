import 'dotenv/config'
import { getFamsLlmConfig, getFamsLlmPublicStatus } from '../src/config/llmConfig.js'
import { famsChatService } from '../src/services/chat/famsChatService.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const original = {
    FAMS_LLM_PROVIDER: process.env.FAMS_LLM_PROVIDER,
    FAMS_LLM_API_KEY: process.env.FAMS_LLM_API_KEY,
    FAMS_LLM_MODEL: process.env.FAMS_LLM_MODEL,
    FAMS_LLM_BASE_URL: process.env.FAMS_LLM_BASE_URL,
    FAMS_CHAT_LLM_ENABLED: process.env.FAMS_CHAT_LLM_ENABLED,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  }

  const testKey = 'sk-test-fams-secret-must-not-leak'
  process.env.FAMS_LLM_PROVIDER = 'openai'
  process.env.FAMS_LLM_API_KEY = testKey
  process.env.FAMS_LLM_MODEL = 'gpt-4o-mini'
  process.env.FAMS_LLM_BASE_URL = 'https://api.openai.com/v1'
  process.env.FAMS_CHAT_LLM_ENABLED = '1'
  delete process.env.OPENAI_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.MINIMAX_API_KEY

  try {
    const privateConfig = getFamsLlmConfig()
    assert(privateConfig.configured === true, 'FAMS_LLM_API_KEY should configure the LLM runtime')
    assert(privateConfig.apiKey === testKey, 'Private runtime config should keep the API key in memory')
    assert(privateConfig.keySource === 'FAMS_LLM_API_KEY', 'Key source should be FAMS_LLM_API_KEY')

    const publicStatus = getFamsLlmPublicStatus()
    assert(publicStatus.configured === true, 'Public status should report configured=true')
    assert(publicStatus.secretsRedacted === true, 'Public status should mark secretsRedacted=true')
    assert(JSON.stringify(publicStatus).includes(testKey) === false, 'Public status must not leak the API key')

    const capabilities = await famsChatService.capabilities()
    assert(capabilities.llm.configured === true, 'Chat capabilities should include LLM readiness')
    assert(JSON.stringify(capabilities).includes(testKey) === false, 'Chat capabilities must not leak the API key')

    console.log(JSON.stringify({
      schemaVersion: 'fams.llm_dotenv_config_verification.v1',
      status: 'passed',
      checkedAt: new Date().toISOString(),
      llm: publicStatus,
      chatCapabilitiesExposeRedactedLlmStatus: true,
      keyLeakDetected: false,
    }, null, 2))
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
