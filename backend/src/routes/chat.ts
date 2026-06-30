import { FastifyInstance } from 'fastify'
import { famsChatService } from '../services/chat/famsChatService.js'

export async function chatRoutes(app: FastifyInstance) {
  app.get('/capabilities', async () => {
    return famsChatService.capabilities()
  })

  app.post('/sessions', async (request) => {
    const body = request.body as Record<string, unknown> | undefined
    return famsChatService.createSession(typeof body?.userId === 'string' ? body.userId : 'default')
  })

  app.get('/sessions/:id', async (request) => {
    const { id } = request.params as { id: string }
    return famsChatService.getSessionSnapshot(id)
  })

  app.post('/sessions/:id/messages', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    return famsChatService.sendMessage({
      conversationId: id,
      userId: typeof body?.userId === 'string' ? body.userId : 'default',
      message: typeof body?.message === 'string' ? body.message : '',
      context: typeof body?.context === 'object' && body.context ? body.context as Record<string, unknown> : undefined,
    })
  })

  app.post('/messages', async (request) => {
    const body = request.body as Record<string, unknown>
    return famsChatService.sendMessage({
      conversationId: typeof body?.conversationId === 'string' ? body.conversationId : undefined,
      userId: typeof body?.userId === 'string' ? body.userId : 'default',
      message: typeof body?.message === 'string' ? body.message : '',
      context: typeof body?.context === 'object' && body.context ? body.context as Record<string, unknown> : undefined,
    })
  })

  app.post('/tool-confirmations', async (request) => {
    const body = request.body as Record<string, unknown>
    return famsChatService.confirmTool({
      userId: typeof body?.userId === 'string' ? body.userId : 'default',
      conversationId: typeof body?.conversationId === 'string' ? body.conversationId : undefined,
      confirmationId: typeof body?.confirmationId === 'string' ? body.confirmationId : '',
    })
  })
}
