import { postJson } from '../../utils/httpJson.js'
import { screenshotCaptureService } from './screenshotCaptureService.js'

function getConfig() {
  const apiKey = process.env.FAMS_VISION_API_KEY || process.env.FAMS_LLM_API_KEY || ''
  const baseUrl = (process.env.FAMS_VISION_BASE_URL || process.env.FAMS_LLM_BASE_URL || '').replace(/\/$/, '')
  const model = process.env.FAMS_VISION_MODEL || ''
  if (!apiKey || !baseUrl || !model) {
    const error = new Error('FAMS vision model is not configured; set FAMS_VISION_MODEL and API credentials') as Error & { code?: string }
    error.code = 'VISION_MODEL_NOT_CONFIGURED'
    throw error
  }
  return { apiKey, baseUrl, model }
}

export function getVisionCaptureStatus() {
  const apiKey = process.env.FAMS_VISION_API_KEY || process.env.FAMS_LLM_API_KEY || ''
  const baseUrl = process.env.FAMS_VISION_BASE_URL || process.env.FAMS_LLM_BASE_URL || ''
  const model = process.env.FAMS_VISION_MODEL || ''
  const configured = Boolean(apiKey && baseUrl && model)
  return {
    schemaVersion: 'fams.vision-capture-status.v1',
    configured,
    model: model || null,
    credentialSource: process.env.FAMS_VISION_API_KEY ? 'FAMS_VISION_API_KEY' : process.env.FAMS_LLM_API_KEY ? 'FAMS_LLM_API_KEY' : null,
    consentRequiredPerUpload: true,
    manualStructuredInputAvailable: true,
    secretsRedacted: true,
  }
}

function parseJson(text: string) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const candidate = stripped.match(/\{[\s\S]*\}/)?.[0] || stripped
  return JSON.parse(candidate)
}

class VisionCaptureService {
  async extract(input: { captureId: string; userId?: string; consentGranted: boolean }) {
    if (input.consentGranted !== true) {
      const error = new Error('Explicit consent is required before sending a screenshot to the configured vision model') as Error & { code?: string }
      error.code = 'VISION_PROCESSING_CONSENT_REQUIRED'
      throw error
    }
    const config = getConfig()
    const { capture, buffer } = await screenshotCaptureService.readPrivateImage(input.captureId)
    if (input.userId && capture.userId !== input.userId) throw new Error('Screenshot capture does not belong to the requested user')
    const response = await postJson<any>(
      `${config.baseUrl}/chat/completions`,
      {
        model: config.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `识别这张证券账户截图。只提取图片中明确可见的信息，不推断缺失值。返回严格 JSON：
{
  "documentType": "holding|trade|order|mixed",
  "rawText": "简短原文",
  "rows": [{
    "rowType": "account_summary|holding|trade|order",
    "rawText": "该行原文",
    "fields": {},
    "fieldConfidence": {"字段名": 0.0},
    "confidence": 0.0
  }]
}
账户汇总只生成一行，字段使用 availableCash,cashBalance,withdrawableCash,stockMarketValue,totalAssets,holdingPnl,dayPnl,dayPnlPct；持仓字段使用 symbol,name,quantity,avgCost,currentPrice,marketValue；成交字段使用 symbol,type,quantity,price,fee,executedAt,broker,confirmationNo；委托字段使用 symbol,side,status,quantity,filledQuantity,limitPrice,submittedAt,externalOrderId,validUntil。金额和比例保留图片所示正负号；日期用 ISO 8601，方向只用 buy/sell。无法确定的字段省略。`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:${capture.mimeType};base64,${buffer.toString('base64')}` },
            },
          ],
        }],
      },
      {
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        timeout: Number(process.env.FAMS_VISION_TIMEOUT_MS || 60_000),
        maxBodyLength: 15 * 1024 * 1024,
      },
    )
    const content = response?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('Vision model returned an empty extraction')
    const extracted = parseJson(content)
    return screenshotCaptureService.applyExtraction({
      captureId: input.captureId,
      userId: capture.userId,
      documentType: extracted.documentType,
      rows: extracted.rows,
      rawText: extracted.rawText,
      visionProvider: config.model,
      consentGranted: true,
    })
  }
}

export const visionCaptureService = new VisionCaptureService()
