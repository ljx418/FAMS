import Fastify from 'fastify'
import { alertRoutes } from '../src/routes/alert.js'
import { alertService } from '../src/services/alert/alertService.js'

type ServiceCall = {
  userId: string
  limit: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const app = Fastify({ logger: false })
const calls: ServiceCall[] = []
const originalGetUnreadAlerts = alertService.getUnreadAlerts

try {
  alertService.getUnreadAlerts = (async (userId: string, limit: number) => {
    calls.push({ userId, limit })
    return []
  }) as typeof alertService.getUnreadAlerts

  await app.register(alertRoutes, { prefix: '/api/v1/alerts' })
  await app.ready()

  const defaultResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/alerts/unread?userId=contract-user',
  })
  assert(defaultResponse.statusCode === 200, `Default limit request returned ${defaultResponse.statusCode}`)
  assert(calls.length === 1, 'Default limit request did not call the service exactly once')
  assert(calls[0].limit === 10, `Expected default numeric limit 10, got ${String(calls[0].limit)}`)
  assert(typeof calls[0].limit === 'number', 'Default limit was not a number')

  const numericResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/alerts/unread?userId=contract-user&limit=30',
  })
  assert(numericResponse.statusCode === 200, `Numeric limit request returned ${numericResponse.statusCode}`)
  assert(calls.length === 2, 'Numeric limit request did not call the service exactly once')
  assert(calls[1].limit === 30, `Expected coerced numeric limit 30, got ${String(calls[1].limit)}`)
  assert(typeof calls[1].limit === 'number', 'Query-string limit was not coerced to a number')

  const invalidCases = [
    '/api/v1/alerts/unread?userId=contract-user&limit=invalid',
    '/api/v1/alerts/unread?userId=contract-user&limit=0',
    '/api/v1/alerts/unread?userId=contract-user&limit=101',
    '/api/v1/alerts/unread?userId=contract-user&limit=1.5',
    '/api/v1/alerts/unread?limit=10',
  ]

  for (const url of invalidCases) {
    const response = await app.inject({ method: 'GET', url })
    assert(response.statusCode === 400, `${url} returned ${response.statusCode} instead of 400`)
  }
  assert(calls.length === 2, 'An invalid request reached the alert service')

  console.log(JSON.stringify({
    schemaVersion: 'fams.alert_unread_contract_verification.v1',
    status: 'passed',
    defaultLimit: calls[0].limit,
    coercedLimit: calls[1].limit,
    invalidCasesRejected: invalidCases.length,
    serviceCallsForInvalidCases: 0,
  }, null, 2))
} finally {
  alertService.getUnreadAlerts = originalGetUnreadAlerts
  await app.close()
}
