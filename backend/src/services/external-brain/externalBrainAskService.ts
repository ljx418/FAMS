import { famsChatService } from '../chat/famsChatService.js'
import { externalBrainPolicyService } from './externalBrainPolicyService.js'
import { externalBrainReadService } from './externalBrainReadService.js'
import {
  DEFAULT_EXTERNAL_BRAIN_USER_ID,
  EXTERNAL_BRAIN_ASK_SCHEMA_VERSION,
  type ExternalBrainAskRequest,
  type ExternalBrainAskResult,
  type ExternalBrainWarning,
} from './externalBrainTypes.js'
import { isFamsEntityId, parseSourceRef } from './sourceRef.js'

const WORKSPACE_PATTERN = /^px-ws-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONVERSATION_PATTERN = /^chat-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const IDEMPOTENCY_PATTERN = /^px-idem-[a-z0-9][a-z0-9-]{7,120}$/

export class ExternalBrainAskError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
    readonly recoverable: boolean,
    readonly category: 'invalid' | 'timeout' | 'policy',
  ) {
    super(code)
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExternalBrainAskError(
      'PX_ASK_TIMEOUT',
      '本次问答超过 35 秒，未自动重试。请稍后从会话或任务追踪中核对最终状态。',
      true,
      'timeout',
    )), timeoutMs)
    work.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
  })
}

const unique = (values: unknown[]): string[] => [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]

export type ExternalBrainAskOutcome = {
  status: 'ok' | 'accepted' | 'blocked'
  data: ExternalBrainAskResult
  warnings: ExternalBrainWarning[]
}

class ExternalBrainAskService {
  validateRequest(input: ExternalBrainAskRequest): void {
    if (input.schemaVersion !== EXTERNAL_BRAIN_ASK_SCHEMA_VERSION) throw new ExternalBrainAskError('PX_SCHEMA_INVALID', 'Ask schemaVersion 无效。', false, 'invalid')
    if (!WORKSPACE_PATTERN.test(input.workspaceId)) throw new ExternalBrainAskError('PX_SCHEMA_INVALID', 'workspaceId 无效。', false, 'invalid')
    if (input.conversationId !== undefined && !CONVERSATION_PATTERN.test(input.conversationId)) throw new ExternalBrainAskError('PX_SCHEMA_INVALID', 'conversationId 无效。', false, 'invalid')
    if (typeof input.question !== 'string' || input.question.trim().length < 1 || input.question.length > 1000) throw new ExternalBrainAskError('PX_QUESTION_INVALID', '问题长度需要在 1 到 1000 个字符之间。', true, 'invalid')
    if (!Array.isArray(input.contextRefs) || input.contextRefs.length > 20 || input.contextRefs.some((ref) => !isFamsEntityId(ref) && !parseSourceRef(ref))) {
      throw new ExternalBrainAskError('PX_CONTEXT_REFS_INVALID', 'contextRefs 只能包含 FAMS UUID 或合法来源引用，最多 20 项。', false, 'invalid')
    }
    if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) throw new ExternalBrainAskError('PX_SCHEMA_INVALID', 'idempotencyKey 无效。', false, 'invalid')
  }

  async ask(input: ExternalBrainAskRequest): Promise<ExternalBrainAskOutcome> {
    this.validateRequest(input)
    const contextRefs = unique(input.contextRefs)
    await Promise.all(contextRefs.filter((ref) => parseSourceRef(ref)).map((ref) => externalBrainReadService.assertSourceRefMembership(ref)))

    const response = await withTimeout(famsChatService.sendMessage({
      userId: DEFAULT_EXTERNAL_BRAIN_USER_ID,
      conversationId: input.conversationId,
      message: input.question.trim(),
      context: {
        source: 'fams-v2-px-external-brain',
        workspaceId: input.workspaceId,
        contextRefs,
        idempotencyKey: input.idempotencyKey,
        executionBoundary: externalBrainPolicyService.boundary(),
      },
    }), 35_000)

    const decision = externalBrainPolicyService.inspectAskResult(response)
    if (decision.disposition === 'hard_fail') {
      throw new ExternalBrainAskError('PX_TRADE_ACTION_FORBIDDEN', '该动作被研究边界永久禁止。', false, 'policy')
    }
    const structured = response.structuredResult
    const blocked = decision.disposition === 'blocked'
    const summaryRaw = structured?.summary || response.reply || '本次没有生成可展示的摘要。'
    const summary = summaryRaw.trim().replace(/\n{3,}/g, '\n\n').slice(0, 1200)
    const artifactRefs = unique(response.artifactRefs || [])
    const keyEvidence = unique([
      ...(structured?.evidenceRefs || []),
      ...artifactRefs,
      ...contextRefs,
      ...(response.operationId ? [`operation:${response.operationId}`] : []),
    ])
    const nextActions = blocked
      ? ['回到 FAMS 处理需要确认的操作；External Brain 不会代为确认或重试。']
      : unique([...(structured?.nextActions || []), ...response.actionCards.filter((card) => card.type !== 'tool_confirmation').map((card) => card.title)]).slice(0, 6)
    return {
      status: blocked ? 'blocked' : response.operationId ? 'accepted' : 'ok',
      data: {
        conversationId: response.conversationId,
        messageId: response.messageId,
        summary,
        keyEvidence,
        dataAsOf: response.generatedAt,
        confidence: Math.max(0, Math.min(1, Number(response.confidence || 0))),
        nextActions,
        ...(response.operationId ? { operationId: response.operationId } : {}),
        artifactRefs,
        prohibitedActions: externalBrainPolicyService.prohibitedActions(),
        notTradingAdvice: true,
      },
      warnings: decision.reasons.map((reason) => ({ code: 'PX_POLICY_BLOCKED', message: reason, recoverable: false })),
    }
  }
}

export const externalBrainAskService = new ExternalBrainAskService()
