import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { formalBenchmarkService, type FormalBenchmarkImportInput } from '../services/formal-release/formalBenchmarkService.js'
import { formalDataProviderService, type FormalProviderAuthorizationDecision, type FormalProviderId } from '../services/formal-release/formalDataProviderService.js'
import { formalReviewerAuthService, FORMAL_RELEASE_REVIEWER_ROLES, type FormalReleaseReviewerRole } from '../services/formal-release/formalReviewerAuth.js'
import { computeOperationManifestHash, manualSignoffService, type FormalReleaseSignoffDecision } from '../services/formal-release/manualSignoffService.js'

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode })
}

async function findBacktestOperation(operationId: string) {
  const operation = await prisma.operation.findUnique({ where: { id: operationId } })
  if (!operation || operation.type !== 'portfolio_backtest_run') throw httpError('formal_release_operation_not_found', 404)
  return operation
}

function parseDate(value: unknown, field: string, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) throw httpError(`${field}_required`, 400)
    return null
  }
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw httpError(`${field}_invalid`, 400)
  return date
}

export async function formalReleaseRoutes(app: FastifyInstance) {
  app.get('/reviewer-context', async (request) => {
    const reviewer = await formalReviewerAuthService.authenticateRequest(request)
    return {
      schemaVersion: 'fams.formal_release.reviewer_context.v1',
      reviewer,
      requiredRoles: [...FORMAL_RELEASE_REVIEWER_ROLES],
      releaseApprovalStatus: 'pending_human_approval',
      formalTradingUnlocked: false,
      orderCreateAllowed: false,
    }
  })

  app.get('/providers/authorizations', async (request) => {
    await formalReviewerAuthService.authenticateRequest(request)
    const query = request.query as { providerId?: FormalProviderId }
    const providerId = query.providerId || 'tushare_pro'
    const [records, audit] = await Promise.all([
      formalDataProviderService.listAuthorizations(providerId),
      formalDataProviderService.authorizationAudit(providerId),
    ])
    return { schemaVersion: 'fams.formal_provider.authorization_list.v1', providerId, records, audit }
  })

  app.post('/providers/authorizations', async (request, reply) => {
    const reviewer = await formalReviewerAuthService.authenticateRequest(request, 'data')
    const body = request.body as {
      providerId?: FormalProviderId
      providerClass?: 'authorized_commercial' | 'official'
      decision?: FormalProviderAuthorizationDecision
      authorizationRef?: string
      authorizedScopes?: string[]
      evidenceRefs?: string[]
      effectiveFrom?: string
      expiresAt?: string | null
    }
    if (!body || !['approved', 'rejected', 'revoked'].includes(String(body.decision))) throw httpError('provider_authorization_decision_invalid', 400)
    if (!['authorized_commercial', 'official'].includes(String(body.providerClass))) throw httpError('provider_authorization_class_invalid', 400)
    const record = await formalDataProviderService.appendAuthorization({
      providerId: body.providerId || 'tushare_pro',
      providerClass: body.providerClass as 'authorized_commercial' | 'official',
      decision: body.decision as FormalProviderAuthorizationDecision,
      authorizationRef: body.authorizationRef || '',
      authorizedScopes: Array.isArray(body.authorizedScopes) ? body.authorizedScopes : [],
      evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs : [],
      reviewerUserId: reviewer.userId,
      reviewerEmail: reviewer.email,
      effectiveFrom: parseDate(body.effectiveFrom, 'effective_from') || undefined,
      expiresAt: parseDate(body.expiresAt, 'expires_at'),
    })
    return reply.status(201).send({
      schemaVersion: 'fams.formal_provider.authorization_append.v1',
      record,
      credentialPersisted: false,
      formalTradingUnlocked: false,
      orderCreateAllowed: false,
    })
  })

  app.get('/benchmarks', async (request) => {
    await formalReviewerAuthService.authenticateRequest(request)
    const benchmarks = await formalBenchmarkService.listBenchmarks()
    return {
      schemaVersion: 'fams.formal_benchmark.list.v1',
      benchmarks: benchmarks.map((artifact) => ({ artifact, qualification: formalBenchmarkService.qualificationAudit(artifact) })),
      formalTradingUnlocked: false,
      orderCreateAllowed: false,
    }
  })

  app.post('/benchmarks/import', async (request, reply) => {
    const reviewer = await formalReviewerAuthService.authenticateRequest(request, 'data')
    const imported = await formalBenchmarkService.importBenchmark(request.body as FormalBenchmarkImportInput, {
      userId: reviewer.userId,
      email: reviewer.email,
    })
    return reply.status(imported.idempotent ? 200 : 201).send({
      schemaVersion: 'fams.formal_benchmark.controlled_import.v1',
      ...imported,
      qualification: formalBenchmarkService.qualificationAudit(imported.artifact),
      formalTradingUnlocked: false,
      orderCreateAllowed: false,
    })
  })

  app.get('/runs/:operationId', async (request) => {
    await formalReviewerAuthService.authenticateRequest(request)
    const { operationId } = request.params as { operationId: string }
    const operation = await findBacktestOperation(operationId)
    const manifestHash = computeOperationManifestHash(operation)
    const signoffAudit = await manualSignoffService.audit(operationId, manifestHash)
    return {
      schemaVersion: 'fams.formal_release.run_review.v1',
      operation: {
        id: operation.id,
        type: operation.type,
        status: operation.status,
        completedAt: operation.completedAt,
        artifactRefs: JSON.parse(operation.artifactRefsJson),
      },
      manifestHash,
      signoffAudit,
      releaseApprovalStatus: 'pending_human_approval',
      productionAdapterEnabled: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    }
  })

  app.post('/runs/:operationId/signoffs', async (request, reply) => {
    const reviewer = await formalReviewerAuthService.authenticateRequest(request)
    const { operationId } = request.params as { operationId: string }
    const body = request.body as { role?: FormalReleaseReviewerRole; decision?: FormalReleaseSignoffDecision; notes?: string; manifestHash?: string }
    if (!body || !FORMAL_RELEASE_REVIEWER_ROLES.includes(body.role as FormalReleaseReviewerRole)) throw httpError('signoff_role_invalid', 400)
    if (!['approved', 'rejected'].includes(String(body.decision))) throw httpError('signoff_decision_invalid', 400)
    const operation = await findBacktestOperation(operationId)
    const manifestHash = computeOperationManifestHash(operation)
    if (body.manifestHash !== manifestHash) throw httpError('signoff_manifest_hash_not_current', 409)
    const record = await manualSignoffService.appendSignoff({
      operationId,
      role: body.role as FormalReleaseReviewerRole,
      decision: body.decision as FormalReleaseSignoffDecision,
      notes: body.notes || '',
      manifestHash,
      reviewer,
    })
    const audit = await manualSignoffService.audit(operationId, manifestHash)
    return reply.status(201).send({
      schemaVersion: 'fams.formal_release.signoff_append.v1',
      record,
      audit,
      releaseApprovalStatus: 'pending_human_approval',
      formalTradingUnlocked: false,
      orderCreateAllowed: false,
    })
  })
}
