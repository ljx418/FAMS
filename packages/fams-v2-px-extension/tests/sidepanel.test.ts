import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SIDE_PANEL_STATE_COPY, SidePanelContent } from '../entrypoints/sidepanel/SidePanelApp'
import type { WorkspaceViewData } from '../src/adapters/fams/types'

const generatedAt = '2026-08-29T00:00:00.000Z'
const sources: Extract<WorkspaceViewData, { view: 'source_library' }> = {
  view: 'source_library', status: 'ok', requestId: 'px-request-sidepanel', generatedAt, evidenceRefs: [], warnings: [],
  value: {
    items: Array.from({ length: 7 }, (_, index) => ({
      sourceRef: `op-artifact:3d292179-cd6d-4e73-9a35-0097b6809436:${Buffer.from(`real-${index}`).toString('base64url')}`,
      kind: 'operation_artifact' as const,
      title: `真实任务 ${index + 1}`,
      summary: `真实摘要 ${index + 1}`,
      asOf: generatedAt,
      freshnessStatus: 'fresh' as const,
      trustStatus: 'available' as const,
      operationId: '3d292179-cd6d-4e73-9a35-0097b6809436',
    })),
    nextCursor: null,
  },
}
const answer: Extract<WorkspaceViewData, { view: 'ask' }> = {
  view: 'ask', status: 'ok', requestId: 'px-request-ask', generatedAt, evidenceRefs: [], warnings: [],
  value: {
    conversationId: 'chat-00fdc188-0b6b-4731-81eb-d5fc91de01ed', messageId: 'msg-real', summary: '当前组合保持研究观察。',
    keyEvidence: ['position:real'], dataAsOf: generatedAt, confidence: 0.85, nextActions: ['打开完整工作台核对来源'],
    artifactRefs: [], prohibitedActions: ['ORDER_CREATE'], notTradingAdvice: true,
  },
}

const baseProps = {
  connection: 'connected' as const,
  message: '本地 FAMS 已连接。',
  busy: false,
  sourceData: sources,
  answerData: null,
  question: '',
  ackVisible: false,
  setQuestion: () => undefined,
  connect: async () => undefined,
  retry: async () => undefined,
  openWorkspace: async () => undefined,
  submitAsk: async () => undefined,
}

describe('Side Panel lightweight product experience', () => {
  it('shows a real current summary, time, research mode and at most five recent tasks', () => {
    const html = renderToStaticMarkup(createElement(SidePanelContent, baseProps))
    expect(html).toContain('data-testid="sidepanel-current-summary"')
    expect(html).toContain('真实任务 1')
    expect(html).toContain('真实摘要 1')
    expect(html).toContain('数据时间')
    expect(html).toContain('研究模式')
    expect(html.match(/data-testid="sidepanel-recent-task"/g)).toHaveLength(5)
    expect(html).not.toContain('真实任务 6')
    expect(html).toContain('查看依据')
    expect(html).toContain('在完整工作台打开')
  })

  it('keeps Ask acknowledgement distinct from the final answer', () => {
    const ackHtml = renderToStaticMarkup(createElement(SidePanelContent, { ...baseProps, ackVisible: true, question: '请总结' }))
    expect(ackHtml).toContain('data-testid="sidepanel-ask-ack"')
    expect(ackHtml).not.toContain('data-testid="sidepanel-ask-result"')

    const finalHtml = renderToStaticMarkup(createElement(SidePanelContent, { ...baseProps, answerData: answer, question: '请总结' }))
    expect(finalHtml).not.toContain('data-testid="sidepanel-ask-ack"')
    expect(finalHtml).toContain('data-testid="sidepanel-ask-result"')
    expect(finalHtml).toContain('当前组合保持研究观察。')
    expect(finalHtml).toContain('可信度 85%')
    expect(finalHtml).toContain('下一步')
  })

  it('defines honest non-ready states and never renders a trading action', () => {
    expect(Object.keys(SIDE_PANEL_STATE_COPY).sort()).toEqual(['blocked', 'checking', 'empty', 'failed', 'loading', 'not_connected', 'recovering'])
    expect(Object.values(SIDE_PANEL_STATE_COPY).every((item) => item.title && item.detail && item.action)).toBe(true)
    const html = renderToStaticMarkup(createElement(SidePanelContent, baseProps))
    expect(html).not.toMatch(/创建订单|立即买入|自动交易|解锁交易/)
  })
})
