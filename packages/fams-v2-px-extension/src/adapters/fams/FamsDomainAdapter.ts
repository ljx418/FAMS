import type { OperationCommand, WorkspaceStateV1 } from '../../contracts/types'
import { FamsApiClient } from './FamsApiClient'
import type { AskResult, ExternalBrainResponse, WorkspaceViewData } from './types'

function viewData<TView extends WorkspaceViewData['view'], TValue>(view: TView, response: ExternalBrainResponse<TValue>): WorkspaceViewData {
  if (response.data === null) throw new Error('PX_RESPONSE_DATA_MISSING')
  return {
    view,
    status: response.status,
    requestId: response.requestId,
    generatedAt: response.generatedAt,
    evidenceRefs: response.evidenceRefs,
    warnings: response.warnings,
    value: response.data,
  } as unknown as WorkspaceViewData
}

export class FamsDomainAdapter {
  constructor(private readonly api: FamsApiClient = new FamsApiClient()) {}

  async loadWorkspaceView(state: WorkspaceStateV1): Promise<WorkspaceViewData | null> {
    if (state.currentView === 'source_library') return viewData('source_library', await this.api.listSources({ limit: 50 }))
    if (state.currentView === 'source_detail') {
      if (!state.selectedRef) throw new Error('PX_SOURCE_REF_REQUIRED')
      return viewData('source_detail', await this.api.getSource(state.selectedRef))
    }
    if (state.currentView === 'trace') {
      if (!state.activeOperationId) throw new Error('PX_OPERATION_ID_REQUIRED')
      return viewData('trace', await this.api.getTrace(state.activeOperationId))
    }
    if (state.currentView === 'graph') {
      if (!state.activeGraph) throw new Error('PX_GRAPH_ID_REQUIRED')
      return viewData('graph', await this.api.getGraph(state.activeGraph.scope, state.activeGraph.id))
    }
    return null
  }

  async ask(command: OperationCommand): Promise<Extract<WorkspaceViewData, { view: 'ask' }>> {
    if (command.commandType !== 'query' || !('question' in command.payload)) throw new Error('PX_QUERY_COMMAND_REQUIRED')
    const response = await this.api.ask({
      workspaceId: command.payload.workspaceId,
      question: command.payload.question,
      contextRefs: command.payload.contextRefs,
      ...(command.payload.conversationId ? { conversationId: command.payload.conversationId } : {}),
      idempotencyKey: command.idempotencyKey,
    })
    return viewData<'ask', AskResult>('ask', response) as Extract<WorkspaceViewData, { view: 'ask' }>
  }
}
