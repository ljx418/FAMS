import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { chatRoutes } from '../src/routes/chat.js'

function parseSseEvents(body: string) {
  return body
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const eventLine = chunk.split('\n').find((line) => line.startsWith('event: '))
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '))
      assert.ok(eventLine, `SSE chunk missing event line: ${chunk}`)
      assert.ok(dataLine, `SSE chunk missing data line: ${chunk}`)
      return {
        event: eventLine.replace(/^event:\s*/, ''),
        data: JSON.parse(dataLine.replace(/^data:\s*/, '')),
      }
    })
}

async function main() {
  const checkedAt = new Date().toISOString()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'next-stage-automation', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })

  const app = Fastify({ logger: false })
  await app.register(chatRoutes, { prefix: '/api/v1/chat' })
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/chat/messages/stream',
    payload: {
      userId: 'default',
      conversationId: 'chatbox-streaming-acceptance',
      message: '你帮我对比一下永久投资组合对比全天候投资组合在最近三年的实际收益率和最大回撤，并画出曲线',
    },
  })
  await app.close()

  assert.equal(response.statusCode, 200)
  assert.ok(String(response.headers['content-type']).includes('text/event-stream'), 'stream route must return text/event-stream')

  const events = parseSseEvents(response.body)
  const eventTypes = events.map((item) => item.event)
  assert.ok(eventTypes.includes('start'), 'stream should include start event')
  assert.ok(eventTypes.includes('status'), 'stream should include status event')
  assert.ok(eventTypes.includes('tool_result'), 'stream should include tool_result event')
  assert.ok(eventTypes.includes('final'), 'stream should include final event')

  for (const event of events) {
    assert.equal(event.data.schemaVersion, 'fams.chat.stream_event.v1')
    assert.equal(event.data.formalTradingUnlocked, false)
    assert.equal(event.data.autoTradeUnlocked, false)
    assert.equal(event.data.canCreateOrder, false)
    assert.equal(event.data.orderCreateAllowed, false)
    assert.equal(event.data.notTradingAdvice, true)
    assert.deepEqual(event.data.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  }

  const final = events.find((item) => item.event === 'final')?.data
  assert.ok(final?.response, 'final stream event should include full chat response')
  assert.equal(final.response.notTradingAdvice, true)
  assert.equal(final.response.structuredResult?.resultType, 'strategy_comparison')
  assert.ok((final.response.structuredResult?.charts || []).some((chart: any) => chart.type === 'line_chart'), 'final response should include line chart payload')
  assert.ok((final.response.structuredResult?.charts || []).some((chart: any) => chart.type === 'drawdown_chart'), 'final response should include drawdown chart payload')
  assert.ok((final.response.structuredResult?.metricCards || []).length > 0, 'final response should include metric cards')
  assert.ok((final.response.structuredResult?.comparisonTable?.rows || []).length > 0, 'final response should include comparison table rows')
  assert.deepEqual(final.response.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.ok(!JSON.stringify(final.response).includes('formalTradingUnlocked":true'), 'response must not unlock formal trading')
  assert.ok(!JSON.stringify(final.response).includes('orderCreateAllowed":true'), 'response must not allow order creation')

  const audit = {
    schemaVersion: 'fams.next_stage.chatbox_streaming_audit.v1',
    status: 'passed',
    checkedAt,
    endpoint: '/api/v1/chat/messages/stream',
    eventTypes,
    finalResponse: {
      intent: final.response.intent,
      resultType: final.response.structuredResult?.resultType,
      chartTypes: (final.response.structuredResult?.charts || []).map((chart: any) => chart.type),
      metricCardCount: final.response.structuredResult?.metricCards?.length || 0,
      comparisonRowCount: final.response.structuredResult?.comparisonTable?.rows?.length || 0,
      blockedReasons: final.response.blockedReasons,
      prohibitedActions: final.response.prohibitedActions,
      notTradingAdvice: final.response.notTradingAdvice,
    },
    checks: {
      streamEndpointReady: true,
      structuredFinalResultReady: true,
      inlineChartPayloadReady: true,
      tradeGateLockedAcrossEvents: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    notTradingAdvice: true,
  }

  const auditPath = resolve(auditDir, '08_chatbox_streaming_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
