import { FastifyInstance } from 'fastify'
import { screenshotCaptureService } from '../services/capture/screenshotCaptureService.js'
import { getVisionCaptureStatus, visionCaptureService } from '../services/capture/visionCaptureService.js'

export async function captureRoutes(app: FastifyInstance) {
  app.get('/vision/status', async () => getVisionCaptureStatus())

  app.post('/screenshots', async (request, reply) => {
    if (!request.isMultipart()) return reply.status(415).send({ error: 'multipart/form-data is required' })
    const file = await request.file()
    if (!file) return reply.status(400).send({ error: 'screenshot file is required' })
    const fields = file.fields as Record<string, any>
    const result = await screenshotCaptureService.upload({
      userId: String(fields.userId?.value || 'default'),
      conversationId: fields.conversationId?.value ? String(fields.conversationId.value) : undefined,
      originalFilename: file.filename,
      mimeType: file.mimetype,
      buffer: await file.toBuffer(),
    })
    return reply.status(result.reused ? 200 : 201).send({ ...result, capture: { ...result.capture, storagePath: undefined } })
  })

  app.post('/screenshots/base64', async (request, reply) => {
    const result = await screenshotCaptureService.uploadBase64(request.body as any)
    return reply.status(result.reused ? 200 : 201).send({ ...result, capture: { ...result.capture, storagePath: undefined } })
  })

  app.post<{ Params: { id: string } }>('/screenshots/:id/extractions', async (request) => {
    const body = request.body as any
    return screenshotCaptureService.applyExtraction({
      captureId: request.params.id,
      userId: body.userId || 'default',
      documentType: body.documentType,
      rows: body.rows,
      rawText: body.rawText,
      visionProvider: body.visionProvider || 'codex_structured_input',
      consentGranted: false,
    })
  })

  app.post<{ Params: { id: string } }>('/screenshots/:id/vision-extract', async (request) => {
    const body = request.body as any
    return visionCaptureService.extract({ captureId: request.params.id, userId: body.userId || 'default', consentGranted: body.consentGranted === true })
  })

  app.get<{ Params: { id: string } }>('/screenshots/:id/preview', async (request) => {
    const query = request.query as any
    return screenshotCaptureService.getPreview(request.params.id, query.userId || 'default')
  })

  app.patch<{ Params: { id: string; rowId: string } }>('/screenshots/:id/rows/:rowId', async (request) => {
    const body = request.body as any
    return screenshotCaptureService.updateRow({
      captureId: request.params.id,
      rowId: request.params.rowId,
      userId: body.userId || 'default',
      update: {
        rowType: body.rowType,
        rawText: body.rawText,
        fields: body.fields,
        fieldConfidence: body.fieldConfidence,
        confidence: body.confidence,
        ignored: body.ignored,
        correctedBy: body.correctedBy,
      },
    })
  })

  app.post<{ Params: { id: string } }>('/screenshots/:id/confirm', async (request) => {
    const body = request.body as any
    return screenshotCaptureService.confirm({
      captureId: request.params.id,
      userId: body.userId || 'default',
      rowIds: body.rowIds,
      confirmed: body.confirmed === true,
      confirmedBy: body.confirmedBy,
      tradePositionEffectPolicy: body.tradePositionEffectPolicy,
    })
  })
}
