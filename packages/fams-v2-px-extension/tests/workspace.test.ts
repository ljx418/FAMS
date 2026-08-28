import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STATE_COPY, WorkspaceContent } from '../entrypoints/workspace/WorkspaceApp'
import type { WorkspaceViewData } from '../src/adapters/fams/types'

const common = { status: 'ok' as const, requestId: 'px-request-real', generatedAt: '2026-08-28T00:00:00.000Z', evidenceRefs: [], warnings: [] }
const sourceRef = 'op-artifact:3d292179-cd6d-4e73-9a35-0097b6809436:YQ'
const views: WorkspaceViewData[] = [
  { ...common, view: 'source_library', value: { items: [{ sourceRef, kind: 'operation_artifact', title: '任务产物', summary: '真实摘要', asOf: common.generatedAt, freshnessStatus: 'fresh', trustStatus: 'available', operationId: '3d292179-cd6d-4e73-9a35-0097b6809436' }], nextCursor: null } },
  { ...common, view: 'source_detail', value: { sourceRef, kind: 'operation_artifact', title: '任务产物', summary: '真实摘要', asOf: common.generatedAt, freshnessStatus: 'fresh', trustStatus: 'available', operationId: '3d292179-cd6d-4e73-9a35-0097b6809436', sourceSystem: 'FAMS.Operation.artifactRefsJson', evidenceRefs: ['operation:real'], displaySections: [{ id: 'p', title: '来源信息', items: [{ label: '状态', value: 'completed' }] }] } },
  { ...common, view: 'ask', value: { conversationId: 'chat-00fdc188-0b6b-4731-81eb-d5fc91de01ed', messageId: 'msg-real', summary: '组合摘要', keyEvidence: ['position:real'], dataAsOf: common.generatedAt, confidence: .9, nextActions: ['继续观察'], artifactRefs: [], prohibitedActions: ['ORDER_CREATE'], notTradingAdvice: true } },
  { ...common, view: 'trace', value: { operationId: '3d292179-cd6d-4e73-9a35-0097b6809436', type: 'daily_review', status: 'completed', progressPct: 100, requestedAt: common.generatedAt, tasks: [{ id: 'task-real', name: '读取行情', status: 'completed', successCount: 1, failureCount: 0 }], artifactRefs: ['operation:real'] } },
  { ...common, view: 'graph', value: { graphId: 'a39d4ba3-e272-46a7-ba5f-e3a495d499be', scope: 'daily-review', status: 'completed', nodes: [{ id: 'quotes', label: '行情', status: 'complete', sequence: 1, inputsSummary: [], outputsSummary: ['已读取'], evidenceRefs: ['quote:real'] }], edges: [], evidenceRefs: ['quote:real'] } },
]

describe('Workspace five views and degradation copy', () => {
  it.each(views)('renders $view with summary, time/credibility, next step and collapsed evidence', (data) => {
    const html = renderToStaticMarkup(createElement(WorkspaceContent, {
      data, currentView: data.view, workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', question: '问题', setQuestion: () => undefined, submitAsk: async () => undefined, navigate: async () => undefined,
    }))
    expect(html).toContain(`data-testid="view-${data.view}`)
    expect(html).toMatch(/数据时间|你的问题/)
    expect(html).toMatch(/下一步|发送问题/)
    if (data.view !== 'ask') expect(html).toContain('<details')
  })

  it('defines all six PRD degradation states with a concrete next action', () => {
    expect(Object.keys(STATE_COPY).sort()).toEqual(['blocked', 'empty', 'failed', 'loading', 'not_connected', 'recovering'])
    expect(Object.values(STATE_COPY).every((item) => item.title && item.detail && item.action)).toBe(true)
  })
})
