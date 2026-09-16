import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import { ALIPAY_ALLOCATION_STRATEGY } from '../allocation/alipayAllocationStrategy.js'
import {
  alipayPortfolioComparisonService,
  type AlipayPortfolioComparisonStudy,
  type AlipayPortfolioWindowComparison,
} from '../portfolio-backtest/alipayPortfolioComparisonService.js'

export const ALIPAY_RESEARCH_WORKFLOW_KEY = 'alipay_complete_research'
export const ALIPAY_RESEARCH_PROFILE_VERSION = '1.1.0'
export const ALIPAY_COMPARISON_OPERATION_TYPE = 'alipay_portfolio_comparison_run'

const WORKFLOW_CONTRACT = {
  schemaVersion: 'fams.analysis-workflow-contract.v1',
  workflowKey: ALIPAY_RESEARCH_WORKFLOW_KEY,
  profileVersion: ALIPAY_RESEARCH_PROFILE_VERSION,
  title: '支付宝完整分析＋持仓组合对比',
  actualAllocationContract: {
    id: ALIPAY_ALLOCATION_STRATEGY.id,
    role: 'manual_plan_draft',
    weights: ALIPAY_ALLOCATION_STRATEGY.weights,
    effectiveFrom: ALIPAY_ALLOCATION_STRATEGY.effectiveFrom,
    effectiveUntil: ALIPAY_ALLOCATION_STRATEGY.effectiveUntil,
  },
  researchComparisonContract: {
    id: 'alipay_research_10_25_40_25_v1',
    role: 'research_comparison_only',
    weights: { cash: 10, gold: 25, bond: 40, equity: 25 },
    driftThresholdPercentagePoints: 3,
  },
  steps: [
    'snapshot_preflight',
    'market_ma_rrg_refresh',
    'position_and_history_constraints',
    'actual_allocation_draft',
    'portfolio_comparison',
    'strict_llm_synthesis',
    'persist_and_present',
  ],
  executionBoundary: {
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    createsExternalOrder: false,
  },
} as const

type StoredPayload = {
  encoding: 'gzip+base64'
  sha256: string
  uncompressedBytes: number
  compressedBytes: number
  data: string
}

type SnapshotAuthorization = {
  status?: 'active' | 'revoked'
  captureId?: string
  authorizedAt?: string
  expiresAt?: string
  revokedAt?: string
  reason?: string
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}

const contractHash = () => createHash('sha256').update(JSON.stringify(WORKFLOW_CONTRACT)).digest('hex')

function encodeStudy(study: AlipayPortfolioComparisonStudy): StoredPayload {
  const plain = Buffer.from(JSON.stringify(study), 'utf8')
  const compressed = gzipSync(plain, { level: 9 })
  return {
    encoding: 'gzip+base64',
    sha256: createHash('sha256').update(plain).digest('hex'),
    uncompressedBytes: plain.byteLength,
    compressedBytes: compressed.byteLength,
    data: compressed.toString('base64'),
  }
}

function decodeStudy(payload: StoredPayload): AlipayPortfolioComparisonStudy {
  if (payload?.encoding !== 'gzip+base64' || !payload.data || !payload.sha256) throw new Error('comparison_payload_missing')
  const plain = gunzipSync(Buffer.from(payload.data, 'base64'))
  const actualHash = createHash('sha256').update(plain).digest('hex')
  if (actualHash !== payload.sha256) throw new Error('comparison_payload_checksum_mismatch')
  return JSON.parse(plain.toString('utf8')) as AlipayPortfolioComparisonStudy
}

function studySummary(study: AlipayPortfolioComparisonStudy) {
  const main = study.strategies.find((item) => item.strategyId === 'approved_10_25_40_25_drift3')
  return {
    schemaVersion: 'portfolio.alipay_comparison.saved_summary.v1',
    status: study.status,
    generatedAt: study.generatedAt,
    sourceHash: study.sourceSnapshot.sourceHash,
    period: study.period,
    snapshot: {
      capturedAt: study.snapshot.capturedAt,
      initialCapital: study.snapshot.initialCapital,
      positionCount: study.snapshot.positionCount,
    },
    strategyCount: study.strategies.length,
    completedStrategyCount: study.strategies.filter((item) => item.status === 'completed').length,
    mainMetrics: main?.metrics || null,
    headline: study.conclusion.headline,
    confidence: study.conclusion.confidence,
    dataStatus: study.dataAudit.status,
    allowedActions: study.allowedActions,
    prohibitedActions: study.prohibitedActions,
    notTradingAdvice: true,
  }
}

class AlipayResearchWorkflowService {
  getContract() {
    return { contract: WORKFLOW_CONTRACT, contractHash: contractHash() }
  }

  async ensureProfile(userId = 'default') {
    await ensureUser(prisma, userId)
    const expectedHash = contractHash()
    const previousProfile = await prisma.analysisWorkflowProfile.findFirst({
      where: { userId, workflowKey: ALIPAY_RESEARCH_WORKFLOW_KEY, isActive: true },
      orderBy: { updatedAt: 'desc' },
    })
    const profile = await prisma.analysisWorkflowProfile.upsert({
      where: {
        userId_workflowKey_profileVersion: {
          userId,
          workflowKey: ALIPAY_RESEARCH_WORKFLOW_KEY,
          profileVersion: ALIPAY_RESEARCH_PROFILE_VERSION,
        },
      },
      create: {
        userId,
        workflowKey: ALIPAY_RESEARCH_WORKFLOW_KEY,
        profileVersion: ALIPAY_RESEARCH_PROFILE_VERSION,
        contractHash: expectedHash,
        contractJson: JSON.stringify(WORKFLOW_CONTRACT),
        isActive: true,
        schedulerEnabled: previousProfile?.schedulerEnabled ?? false,
        timezone: previousProfile?.timezone || 'Asia/Shanghai',
        scheduleSlotsJson: previousProfile?.scheduleSlotsJson || JSON.stringify(['09:40', '14:40']),
        snapshotAuthorizationJson: previousProfile?.snapshotAuthorizationJson || '{}',
        lastRunAt: previousProfile?.lastRunAt || null,
      },
      update: { isActive: true },
    })
    if (profile.contractHash !== expectedHash || profile.contractJson !== JSON.stringify(WORKFLOW_CONTRACT)) {
      throw new Error('analysis_workflow_contract_version_collision')
    }
    await prisma.analysisWorkflowProfile.updateMany({
      where: { userId, workflowKey: ALIPAY_RESEARCH_WORKFLOW_KEY, id: { not: profile.id }, isActive: true },
      data: { isActive: false },
    })
    return profile
  }

  async getConfig(userId = 'default') {
    const profile = await this.ensureProfile(userId)
    const authorization = parseJson<SnapshotAuthorization>(profile.snapshotAuthorizationJson, {})
    const authorizationStatus = await this.checkSnapshotAuthorization(userId, new Date(), profile)
    return {
      schemaVersion: 'fams.alipay-research-workflow-config.v1',
      workflowKey: profile.workflowKey,
      profileVersion: profile.profileVersion,
      contractHash: profile.contractHash,
      contract: WORKFLOW_CONTRACT,
      scheduler: {
        enabled: profile.schedulerEnabled,
        timezone: profile.timezone,
        slots: parseJson<string[]>(profile.scheduleSlotsJson, ['09:40', '14:40']),
        catchUpMinutes: 15,
      },
      snapshotAuthorization: { ...authorization, ...authorizationStatus },
      lastRunAt: profile.lastRunAt?.toISOString() || null,
      executionBoundary: WORKFLOW_CONTRACT.executionBoundary,
    }
  }

  async updateConfig(input: { userId?: string; schedulerEnabled?: boolean; slots?: string[] }) {
    const userId = input.userId || 'default'
    const profile = await this.ensureProfile(userId)
    const slots = input.slots ?? parseJson<string[]>(profile.scheduleSlotsJson, ['09:40', '14:40'])
    const normalizedSlots = [...new Set(slots.map(String))].sort()
    if (normalizedSlots.length < 1 || normalizedSlots.length > 2 || normalizedSlots.some((slot) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot))) {
      throw new Error('analysis_workflow_schedule_slots_invalid')
    }
    await prisma.analysisWorkflowProfile.update({
      where: { id: profile.id },
      data: {
        schedulerEnabled: input.schedulerEnabled ?? profile.schedulerEnabled,
        scheduleSlotsJson: JSON.stringify(normalizedSlots),
      },
    })
    return this.getConfig(userId)
  }

  async authorizeSnapshot(input: { userId?: string; captureId?: string }) {
    const userId = input.userId || 'default'
    const profile = await this.ensureProfile(userId)
    const capture = await prisma.screenshotCapture.findFirst({
      where: { userId, documentType: 'fund_portfolio', status: { in: ['confirmed', 'partially_confirmed'] } },
      orderBy: [{ confirmedAt: 'desc' }, { createdAt: 'desc' }],
    })
    if (!capture) throw new Error('confirmed_alipay_portfolio_capture_required')
    if (input.captureId && input.captureId !== capture.id) throw new Error('snapshot_authorization_capture_is_not_latest')
    const authorizedAt = new Date()
    const expiresAt = new Date(authorizedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    const authorization: SnapshotAuthorization = {
      status: 'active',
      captureId: capture.id,
      authorizedAt: authorizedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
    await prisma.analysisWorkflowProfile.update({
      where: { id: profile.id },
      data: { snapshotAuthorizationJson: JSON.stringify(authorization) },
    })
    return this.getConfig(userId)
  }

  async revokeSnapshot(input: { userId?: string; reason?: string }) {
    const userId = input.userId || 'default'
    const profile = await this.ensureProfile(userId)
    const previous = parseJson<SnapshotAuthorization>(profile.snapshotAuthorizationJson, {})
    await prisma.analysisWorkflowProfile.update({
      where: { id: profile.id },
      data: {
        snapshotAuthorizationJson: JSON.stringify({
          ...previous,
          status: 'revoked',
          revokedAt: new Date().toISOString(),
          reason: String(input.reason || 'portfolio_changed').slice(0, 120),
        } satisfies SnapshotAuthorization),
      },
    })
    return this.getConfig(userId)
  }

  async checkSnapshotAuthorization(userId: string, now = new Date(), providedProfile?: Awaited<ReturnType<AlipayResearchWorkflowService['ensureProfile']>>) {
    const profile = providedProfile || await this.ensureProfile(userId)
    const authorization = parseJson<SnapshotAuthorization>(profile.snapshotAuthorizationJson, {})
    const latest = await prisma.screenshotCapture.findFirst({
      where: { userId, documentType: 'fund_portfolio', status: { in: ['confirmed', 'partially_confirmed'] } },
      orderBy: [{ confirmedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    })
    const blockers: string[] = []
    if (authorization.status !== 'active') {
      blockers.push('snapshot_reuse_not_authorized')
    } else {
      if (!authorization.expiresAt || Date.parse(authorization.expiresAt) <= now.getTime()) blockers.push('snapshot_reuse_authorization_expired')
      if (!latest || authorization.captureId !== latest.id) blockers.push('snapshot_reuse_capture_changed')
    }
    return {
      valid: blockers.length === 0,
      blockers: [...new Set(blockers)],
      latestCaptureId: latest?.id || null,
    }
  }

  async runComparison(input: {
    userId?: string
    createdBy?: 'user' | 'scheduler' | 'system' | 'agent'
    idempotencyKey?: string
    parentOperationId?: string
  } = {}) {
    const userId = input.userId || 'default'
    const profile = await this.ensureProfile(userId)
    if (input.idempotencyKey) {
      const existing = await prisma.operation.findUnique({
        where: { type_idempotencyKey: { type: ALIPAY_COMPARISON_OPERATION_TYPE, idempotencyKey: input.idempotencyKey } },
      })
      if (existing) {
        if (existing.userId !== userId) throw new Error('comparison_idempotency_key_user_conflict')
        return { operation: existing, summary: parseJson<any>(existing.resultJson, {}).summary || null, reused: true }
      }
    }
    const createOperation = () => prisma.operation.create({
        data: {
          userId,
          parentOperationId: input.parentOperationId || null,
          type: ALIPAY_COMPARISON_OPERATION_TYPE,
          status: 'queued',
          createdBy: input.createdBy || 'user',
          idempotencyKey: input.idempotencyKey || null,
          inputJson: JSON.stringify({
            schemaVersion: 'portfolio.alipay_comparison.saved_request.v1',
            workflowKey: profile.workflowKey,
            profileVersion: profile.profileVersion,
            contractHash: profile.contractHash,
            requestedAt: new Date().toISOString(),
          }),
          progressPct: 0,
          progressMessage: '等待读取持仓与行情快照',
          tasks: {
            create: [
              { name: '读取持仓和行情', taskType: 'snapshot', status: 'queued', idempotencyKey: 'snapshot' },
              { name: '运行十组组合比较', taskType: 'backtest', status: 'queued', idempotencyKey: 'backtest' },
              { name: '压缩并保存研究证据', taskType: 'persist', status: 'queued', idempotencyKey: 'persist' },
            ],
          },
        },
        include: { tasks: true },
      })
    let operation: Awaited<ReturnType<typeof createOperation>>
    try {
      operation = await createOperation()
    } catch (error) {
      if (input.idempotencyKey) {
        const raced = await prisma.operation.findUnique({
          where: { type_idempotencyKey: { type: ALIPAY_COMPARISON_OPERATION_TYPE, idempotencyKey: input.idempotencyKey } },
        })
        if (raced) {
          if (raced.userId !== userId) throw new Error('comparison_idempotency_key_user_conflict')
          return { operation: raced, summary: parseJson<any>(raced.resultJson, {}).summary || null, reused: true }
        }
      }
      throw error
    }
    const taskByType = new Map(operation.tasks.map((task) => [task.taskType, task]))
    const startTask = async (type: string) => {
      const task = taskByType.get(type)
      if (task) await prisma.operationTask.update({ where: { id: task.id }, data: { status: 'running', startedAt: new Date() } })
    }
    const completeTask = async (type: string, metrics: Record<string, unknown> = {}) => {
      const task = taskByType.get(type)
      if (task) await prisma.operationTask.update({ where: { id: task.id }, data: { status: 'completed', completedAt: new Date(), successCount: 1, metricsJson: JSON.stringify(metrics) } })
    }
    try {
      const startedAt = new Date()
      await prisma.operation.update({ where: { id: operation.id }, data: { status: 'running', startedAt, progressPct: 5, progressMessage: '正在读取持仓与行情快照' } })
      await startTask('snapshot')
      const study = await alipayPortfolioComparisonService.run(userId)
      await completeTask('snapshot', { sourceHash: study.sourceSnapshot.sourceHash, tradingDays: study.period.tradingDays })
      await startTask('backtest')
      await prisma.operation.update({ where: { id: operation.id }, data: { progressPct: 65, progressMessage: '十组组合比较已完成，正在校验结果' } })
      await completeTask('backtest', { strategyCount: study.strategies.length, status: study.status })
      await startTask('persist')
      const payload = encodeStudy(study)
      const summary = studySummary(study)
      const artifacts = {
        '01_workflow_contract.json': { ...WORKFLOW_CONTRACT, contractHash: profile.contractHash },
        '02_run_summary.json': summary,
        '03_compressed_study.json': payload,
      }
      const completedAt = new Date()
      const artifactRefs = Object.keys(artifacts).map((name) => `operation_artifact:${operation.id}:${name}`)
      const resultJson = JSON.stringify({
        schemaVersion: 'portfolio.alipay_comparison.saved_run.v1',
        summary,
        payload,
        artifacts,
        executionBoundary: WORKFLOW_CONTRACT.executionBoundary,
      })
      await prisma.$transaction([
        prisma.operation.update({
          where: { id: operation.id },
          data: {
            status: study.status === 'completed' ? 'completed' : 'partial',
            completedAt,
            progressPct: 100,
            progressCurrent: study.strategies.filter((item) => item.status === 'completed').length,
            progressTotal: study.strategies.length,
            progressMessage: study.status === 'completed' ? '组合对比已持久化' : '组合对比已保存，但数据证据不足',
            resultJson,
            artifactRefsJson: JSON.stringify(artifactRefs),
          },
        }),
        prisma.analysisWorkflowProfile.update({ where: { id: profile.id }, data: { lastRunAt: completedAt } }),
      ])
      await completeTask('persist', { compressedBytes: payload.compressedBytes, sha256: payload.sha256 })
      const savedOperation = await prisma.operation.findUnique({ where: { id: operation.id } })
      if (!savedOperation) throw new Error('alipay_portfolio_comparison_run_not_found_after_save')
      return {
        operation: savedOperation,
        summary,
        reused: false,
      }
    } catch (error) {
      const completedAt = new Date()
      const message = error instanceof Error ? error.message : String(error)
      await prisma.$transaction([
        prisma.operation.update({ where: { id: operation.id }, data: { status: 'failed', completedAt, progressPct: 100, progressMessage: '组合对比运行失败', errorSummary: message, errorJson: JSON.stringify({ message }) } }),
        prisma.operationTask.updateMany({ where: { operationId: operation.id, status: { in: ['queued', 'running'] } }, data: { status: 'failed', completedAt, failureCount: 1, errorJson: JSON.stringify({ message }) } }),
      ])
      throw error
    }
  }

  async linkParent(operationId: string, parentOperationId: string, userId: string) {
    const parent = await prisma.operation.findFirst({ where: { id: parentOperationId, userId }, select: { id: true } })
    if (!parent) throw new Error('comparison_parent_operation_user_mismatch')
    return prisma.operation.updateMany({
      where: { id: operationId, userId, type: ALIPAY_COMPARISON_OPERATION_TYPE, parentOperationId: null },
      data: { parentOperationId },
    })
  }

  async loadStudy(operationId: string, userId = 'default') {
    const operation = await prisma.operation.findFirst({ where: { id: operationId, userId, type: ALIPAY_COMPARISON_OPERATION_TYPE } })
    if (!operation) throw new Error('alipay_portfolio_comparison_run_not_found')
    const result = parseJson<any>(operation.resultJson, {})
    return { operation, study: decodeStudy(result.payload as StoredPayload), summary: result.summary || null }
  }

  async getLatest(userId = 'default') {
    const operation = await prisma.operation.findFirst({
      where: { userId, type: ALIPAY_COMPARISON_OPERATION_TYPE, status: { in: ['completed', 'partial'] } },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
    })
    return operation ? this.loadStudy(operation.id, userId) : null
  }

  async listRuns(userId = 'default', limit = 20) {
    const operations = await prisma.operation.findMany({
      where: { userId, type: ALIPAY_COMPARISON_OPERATION_TYPE },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(100, Math.max(1, limit)),
      select: { id: true, parentOperationId: true, status: true, requestedAt: true, completedAt: true, createdBy: true, resultJson: true, errorSummary: true },
    })
    return {
      schemaVersion: 'portfolio.alipay_comparison.run_history.v1',
      userId,
      runs: operations.map((operation) => ({
        operationId: operation.id,
        parentOperationId: operation.parentOperationId,
        status: operation.status,
        requestedAt: operation.requestedAt,
        completedAt: operation.completedAt,
        createdBy: operation.createdBy,
        summary: parseJson<any>(operation.resultJson, {}).summary || null,
        errorSummary: operation.errorSummary,
      })),
      notTradingAdvice: true,
    }
  }

  async runWindow(input: { userId?: string; operationId: string; startDate: string; endDate: string }): Promise<AlipayPortfolioWindowComparison> {
    const { study } = await this.loadStudy(input.operationId, input.userId || 'default')
    return alipayPortfolioComparisonService.runWindow(study, input.startDate, input.endDate)
  }
}

export const alipayResearchWorkflowService = new AlipayResearchWorkflowService()
