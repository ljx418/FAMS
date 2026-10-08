import type { FastifyInstance } from 'fastify'
import { investmentPolicyService } from '../services/investment-policy/investmentPolicyService.js'

export async function investmentPolicyRoutes(app: FastifyInstance) {
  app.get('/current', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return investmentPolicyService.getCurrent(query.userId || 'default')
  })

  app.post('/drafts', async (request) => {
    const body = request.body as Record<string, unknown>
    return investmentPolicyService.createDraft({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : 'fams_user',
      contract: body.contract,
    })
  })

  app.put<{ Params: { policyId: string } }>('/drafts/:policyId', async (request) => {
    const body = request.body as Record<string, unknown>
    return investmentPolicyService.updateDraft({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      policyId: request.params.policyId,
      contract: body.contract,
    })
  })

  app.post<{ Params: { policyId: string } }>('/:policyId/activate', async (request) => {
    const body = request.body as Record<string, unknown>
    return investmentPolicyService.activate({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      policyId: request.params.policyId,
      confirmed: body.confirmed === true,
      confirmedBy: typeof body.confirmedBy === 'string' ? body.confirmedBy : '',
    })
  })

  app.get('/evaluation', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return investmentPolicyService.evaluate(query.userId || 'default', query.policyId)
  })

  app.post('/evaluation', async (request) => {
    const body = request.body as Record<string, unknown>
    return investmentPolicyService.evaluate(
      typeof body.userId === 'string' ? body.userId : 'default',
      typeof body.policyId === 'string' ? body.policyId : undefined,
      true,
    )
  })

  app.put<{ Params: { policyId: string; positionId: string } }>('/:policyId/overrides/:positionId', async (request) => {
    const body = request.body as Record<string, unknown>
    return investmentPolicyService.upsertOverride({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      policyId: request.params.policyId,
      positionId: request.params.positionId,
      override: body.override,
      reason: typeof body.reason === 'string' ? body.reason : '',
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : 'fams_user',
    })
  })
}
