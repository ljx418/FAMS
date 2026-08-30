import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { externalBrainRoutes } from '../src/routes/externalBrain.js'
import { dailyReviewRoutes } from '../src/routes/dailyReview.js'
import { operationRoutes } from '../src/routes/operation.js'
import { captureRoutes } from '../src/routes/capture.js'
import { externalBrainPolicyService } from '../src/services/external-brain/externalBrainPolicyService.js'

const extensionIds = externalBrainPolicyService.configuredExtensionIds()
if (extensionIds.length === 0) throw new Error('FAMS_V2_PX_EXTENSION_IDS is required')

await initializePrisma()
const app = Fastify({ logger: false, maxParamLength: 1024 })
await app.register(cors, {
  origin: (origin, callback) => callback(null, externalBrainPolicyService.isCorsOriginAllowed(origin)),
})
app.get('/health', async (request) => ({
  schemaVersion: 'fams.health.v1',
  status: 'ok',
  database: 'ok',
  requestOrigin: request.headers.origin ?? null,
}))
await app.register(externalBrainRoutes, { prefix: '/api/v1/external-brain' })
// PX4-B Host Bridge acceptance loads the production read-only Host pages against
// their real route handlers. The verifier never invokes the registered mutation routes.
await app.register(dailyReviewRoutes, { prefix: '/api/v1/daily-reviews' })
await app.register(operationRoutes, { prefix: '/api/v1/operations' })
await app.register(captureRoutes, { prefix: '/api/v1/captures' })
const acceptanceHost = process.env.V2_PX_ACCEPTANCE_HOST || '0.0.0.0'
await app.listen({ port: 4000, host: acceptanceHost })

const counts = await Promise.all([
  prisma.operation.count({ where: { userId: 'default' } }),
  prisma.dailyReviewRun.count({ where: { userId: 'default' } }),
])
console.log(JSON.stringify({ status: 'ready', host: acceptanceHost, port: 4000, extensionIds, operationCount: counts[0], reviewCount: counts[1] }))

async function stop() {
  await app.close().catch(() => undefined)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(0)
}

process.on('SIGTERM', () => { void stop() })
process.on('SIGINT', () => { void stop() })
