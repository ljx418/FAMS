import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { browser } from 'wxt/browser'
import type { WorkspaceViewData } from '../../src/adapters/fams/types'
import { createIntentRoute, createOperationCommand } from '../../src/contracts/factories'
import type { IntentRoute, RouteIntent, WorkspaceStateV1 } from '../../src/contracts/types'
import { openLifecycleChannel } from '../../src/ui/lifecycleClient'
import { sendCommandDetailed, sendRoute, startOperationPolling } from '../../src/ui/runtimeClient'

const VIEW_LABELS: Record<RouteIntent, string> = {
  source_library: '来源库', source_detail: '来源详情', ask: '快速问答', trace: '任务追踪', graph: '关系图谱',
}
type UiState = 'not_connected' | 'loading' | 'ready' | 'empty' | 'failed' | 'recovering' | 'blocked'

export const STATE_COPY: Record<Exclude<UiState, 'ready'>, { title: string; detail: string; action: string }> = {
  not_connected: { title: '本地 FAMS 未连接', detail: '工作区引用仍保留，但扩展尚未获得 4000 端口权限。', action: '请先打开侧栏并点击“连接本地 FAMS”。' },
  loading: { title: '正在读取真实 FAMS 数据', detail: '当前只显示加载状态，不把空壳冒充结果。', action: '请稍候；超过 8 秒会显示明确失败。' },
  empty: { title: '当前视图没有可显示的数据', detail: '工作区与筛选条件已保留。', action: '返回来源库，或先在 FAMS 生成一次复盘/任务。' },
  failed: { title: '读取失败', detail: '当前路由和来源引用已保留，没有清空或伪造结果。', action: '可重试 GET；若持续失败，请回 FAMS 查看服务状态。' },
  recovering: { title: '正在恢复', detail: '正在按保存的 workspaceId 重新读取业务事实。', action: '5 秒内会显示已恢复或明确阻断。' },
  blocked: { title: '请求已阻断', detail: '系统没有把合同、权限或策略错误显示成成功。', action: '按下方原因处理；需要确认的动作只能回 FAMS 完成。' },
}

const displayTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const ROUTE_INTENTS: RouteIntent[] = ['source_library', 'source_detail', 'ask', 'trace', 'graph']

function lifecycleUiState(state: WorkspaceStateV1): UiState {
  if (state.lifecycleStatus === 'disconnected') return 'not_connected'
  if (state.lifecycleStatus === 'ready') return 'ready'
  if (state.lifecycleStatus === 'empty') return 'empty'
  if (state.lifecycleStatus === 'failed') return 'failed'
  if (state.lifecycleStatus === 'blocked') return 'blocked'
  if (state.lifecycleStatus === 'recovering' || state.recovery.status === 'recovering' || state.lifecycleStatus === 'closed') return 'recovering'
  if (state.lifecycleStatus === 'uninitialized') return 'not_connected'
  return 'loading'
}

export function WorkspaceApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const requestedView = params.get('view')
  const currentView: RouteIntent = requestedView && ROUTE_INTENTS.includes(requestedView as RouteIntent) ? requestedView as RouteIntent : 'source_library'
  const workspaceId = params.get('workspaceId') ?? 'px-ws-00000000-0000-4000-8000-000000000001'
  const selectedRef = params.get('ref') ?? undefined
  const [uiState, setUiState] = useState<UiState>('loading')
  const [message, setMessage] = useState('正在连接 Background 单写者…')
  const [viewData, setViewData] = useState<WorkspaceViewData | null>(null)
  const [question, setQuestion] = useState('')
  const [ackVisible, setAckVisible] = useState(false)
  const [backgroundState, setBackgroundState] = useState<WorkspaceStateV1 | null>(null)
  const initialLifecycleHandled = useRef(false)
  const recoveryLoadInFlight = useRef(false)
  const pollingOperationId = useRef<string | null>(null)

  const loadView = useCallback(async (recovering = false) => {
    setUiState(recovering ? 'recovering' : 'loading')
    setMessage(recovering ? '正在重新读取已保存的工作区引用。' : '正在读取真实 FAMS read model。')
    const command = await createOperationCommand({ sourceContainer: 'workspace_page', commandType: 'refresh_index', payload: { workspaceId } })
    const response = await sendCommandDetailed(command)
    const result = response.commandResult
    if (response.viewData) setViewData(response.viewData)
    if (response.viewData?.view === 'trace'
      && !response.viewData.value.completedAt
      && !['completed', 'succeeded', 'failed', 'cancelled'].includes(response.viewData.value.status)
      && pollingOperationId.current !== response.viewData.value.operationId) {
      const operationId = response.viewData.value.operationId
      pollingOperationId.current = operationId
      void startOperationPolling(workspaceId, operationId).then((pollResult) => {
        if (pollResult.status === 'failed') pollingOperationId.current = null
      }).catch(() => { pollingOperationId.current = null })
    }
    if (result.status === 'completed') { setUiState('ready'); setMessage('已从本地 FAMS 读取并验证响应。') }
    else if (result.status === 'empty') { setUiState('empty'); setMessage('接口返回明确 empty，没有使用 mock 填充。') }
    else if (result.error?.code === 'PX_PERMISSION_REQUIRED') { setUiState('not_connected'); setMessage(result.error.userMessage) }
    else if (result.status === 'blocked') { setUiState('blocked'); setMessage(result.error?.userMessage ?? '请求被合同或策略阻断。') }
    else { setUiState('failed'); setMessage(result.error?.userMessage ?? '读取失败。') }
  }, [workspaceId])

  useEffect(() => {
    const channel = openLifecycleChannel({
      workspaceId, container: 'workspace_page', currentView, ...(selectedRef ? { selectedRef } : {}),
      onSnapshot: (state) => {
        setBackgroundState(state)
        setUiState(lifecycleUiState(state))
        if (['disconnected', 'recovering', 'blocked', 'closed'].includes(state.lifecycleStatus)) pollingOperationId.current = null
        if (state.recovery.status === 'restored') setMessage('已由 Background 恢复工作区并重新验证真实 FAMS 数据。')
        if (state.recovery.status === 'blocked') setMessage('Background 无法安全恢复；原恢复索引仍保留，请按原因处理。')
        if (initialLifecycleHandled.current && state.lifecycleStatus === 'recovering' && !recoveryLoadInFlight.current) {
          recoveryLoadInFlight.current = true
          void loadView(true).finally(() => { recoveryLoadInFlight.current = false })
        }
      },
      onConnectionLost: () => { pollingOperationId.current = null; setUiState('not_connected'); setMessage('Background 连接已中断，正在执行一次有界重连。') },
      onReconnectExhausted: () => { setUiState('blocked'); setMessage('一次有界重连未成功；请打开侧栏确认 FAMS 状态后手动重试。') },
    })
    void channel.firstSnapshot
      .then((snapshot) => {
        initialLifecycleHandled.current = true
        const state = snapshot.payload.workspaceState
        if (state.lifecycleStatus !== 'blocked' && state.recovery.status !== 'blocked') {
          recoveryLoadInFlight.current = true
          return loadView(state.recovery.status === 'recovering').finally(() => { recoveryLoadInFlight.current = false })
        }
      })
      .catch(() => { setUiState('blocked'); setMessage('生命周期订阅未通过验证；系统没有自行显示恢复成功。') })
    return () => channel.disconnect()
  }, [currentView, loadView, selectedRef, workspaceId])

  async function openSidePanel() {
    const current = await browser.windows.getCurrent()
    if (typeof current.id === 'number') await browser.sidePanel.open({ windowId: current.id })
  }

  async function navigate(routeIntent: RouteIntent, routePayload: IntentRoute['routePayload']) {
    setUiState('loading')
    const route = createIntentRoute({ entryContainer: 'workspace_page', entryAction: 'view_source', routeIntent, routePayload })
    const result = await sendRoute(route)
    if (result.status !== 'accepted') { setUiState('blocked'); setMessage(result.error?.userMessage ?? '无法切换视图。') }
  }

  async function submitAsk() {
    if (!question.trim()) return
    setAckVisible(true)
    setUiState('loading')
    setMessage('问题已接收；POST 不会自动重试，正在等待最终摘要。')
    const command = await createOperationCommand({
      sourceContainer: 'workspace_page',
      commandType: 'query',
      payload: { workspaceId, question: question.trim(), contextRefs: [] },
    })
    const response = await sendCommandDetailed(command)
    setAckVisible(false)
    if (response.viewData) setViewData(response.viewData)
    const result = response.commandResult
    if (result.status === 'completed') { setUiState('ready'); setMessage('最终摘要已返回，并保留 FAMS 会话引用。') }
    else if (result.status === 'blocked') { setUiState('blocked'); setMessage(result.error?.userMessage ?? '问题被策略阻断。') }
    else if (result.status === 'unknown_result') { setUiState('blocked'); setMessage(result.error?.userMessage ?? '结果未知，请到 FAMS 复核。') }
    else { setUiState('failed'); setMessage(result.error?.userMessage ?? '问答失败。') }
  }

  const stateCopy = uiState === 'ready' ? null : STATE_COPY[uiState]

  return (
    <main className="px-shell px-shell--workspace" data-testid="workspace-app" data-view={currentView} data-ui-state={uiState} data-lifecycle-state={backgroundState?.lifecycleStatus ?? 'pending'}>
      <header className="px-header">
        <div>
          <p className="px-eyebrow">FAMS External Brain</p>
          <h1 className="px-title">研究工作台</h1>
          <p className="px-subtitle">来源、问答、追踪和图谱使用同一个本地 FAMS 事实源；这里只保存最小路由。</p>
        </div>
        <span className="px-badge">研究模式 · 交易锁定</span>
      </header>

      <nav className="px-nav" aria-label="工作台视图">
        <button type="button" aria-current={currentView === 'source_library' ? 'page' : undefined} onClick={() => void navigate('source_library', { workspaceId })}>来源库</button>
        <button type="button" aria-current={currentView === 'ask' ? 'page' : undefined} onClick={() => void navigate('ask', { workspaceId })}>快速问答</button>
        <span className="px-nav-note">详情、追踪和图谱从真实来源卡片进入</span>
      </nav>

      {stateCopy && <section className={`px-card px-state px-state--${uiState}`} aria-live="polite" data-testid="workspace-state">
        <h2>{stateCopy.title}</h2><p>{message || stateCopy.detail}</p><p className="px-muted">下一步：{stateCopy.action}</p>
        <div className="px-actions">
          {(uiState === 'failed' || uiState === 'empty' || uiState === 'recovering') && <button className="px-button" type="button" onClick={() => void loadView(true)}>重新读取</button>}
          {uiState === 'not_connected' && <button className="px-button" type="button" onClick={() => void openSidePanel()}>打开连接侧栏</button>}
        </div>
      </section>}

      {ackVisible && <section className="px-card px-warning" role="status" data-testid="ask-ack"><h2>已接收问题</h2><p>正在等待最终结果；系统不会自动发送第二次 POST。</p></section>}
      {(uiState === 'ready' || viewData) && <WorkspaceContent data={viewData} currentView={currentView} workspaceId={workspaceId} question={question} setQuestion={setQuestion} submitAsk={submitAsk} navigate={navigate} />}

      <footer className="px-footer">
        <span>workspaceId：{workspaceId}</span><span>状态：{uiState}</span><span>订单能力：关闭</span>
      </footer>
    </main>
  )
}

export function WorkspaceContent(props: {
  data: WorkspaceViewData | null
  currentView: RouteIntent
  workspaceId: string
  question: string
  setQuestion: (value: string) => void
  submitAsk: () => Promise<void>
  navigate: (intent: RouteIntent, payload: IntentRoute['routePayload']) => Promise<void>
}) {
  if (props.currentView === 'ask') {
    const answer = props.data?.view === 'ask' ? props.data : null
    return <section className="px-card px-primary-view" data-testid="view-ask">
      <p className="px-eyebrow">快速问答</p><h2>让 FAMS 重新整合为简明摘要</h2>
      <label className="px-field">你的问题<textarea value={props.question} maxLength={1000} onChange={(event) => props.setQuestion(event.target.value)} placeholder="例如：总结我的当前组合" /></label>
      <button className="px-button" type="button" disabled={!props.question.trim()} onClick={() => void props.submitAsk()}>发送问题</button>
      {answer && <article className="px-result" data-testid="ask-result"><h3>结论摘要</h3><p>{answer.value.summary}</p><MetaRow time={answer.value.dataAsOf} trust={`可信度 ${Math.round(answer.value.confidence * 100)}%`} />
        <h3>下一步</h3><ul>{answer.value.nextActions.map((item) => <li key={item}>{item}</li>)}</ul><EvidenceDrawer refs={answer.value.keyEvidence} requestId={answer.requestId} /></article>}
    </section>
  }
  if (!props.data) return <section className="px-card"><h2>{VIEW_LABELS[props.currentView]}</h2><p>正在等待真实 read model。</p></section>
  if (props.data.view === 'source_library') return <section className="px-card px-primary-view" data-testid="view-source_library">
    <p className="px-eyebrow">来源库</p><h2>真实任务产物与复盘证据</h2><MetaRow time={props.data.generatedAt} trust={`${props.data.value.items.length} 条已验证来源`} />
    <div className="px-source-list">{props.data.value.items.slice(0, 20).map((item) => <article className="px-source-item" key={item.sourceRef} data-source-ref={item.sourceRef}>
      <div><span className="px-kind">{item.kind === 'operation_artifact' ? '任务产物' : '复盘证据'}</span><h3>{item.title}</h3><p>{item.summary}</p><MetaRow time={item.asOf} trust={`${item.trustStatus} · ${item.freshnessStatus}`} /></div>
      <div className="px-actions"><button className="px-button px-button--secondary" type="button" onClick={() => void props.navigate('source_detail', { workspaceId: props.workspaceId, sourceRef: item.sourceRef })}>查看详情</button>
        {item.operationId && <button className="px-button px-button--secondary" type="button" onClick={() => void props.navigate('trace', { workspaceId: props.workspaceId, operationId: item.operationId })}>任务追踪</button>}
        {(item.reviewId || item.operationId) && <button className="px-button px-button--secondary" type="button" onClick={() => void props.navigate('graph', { workspaceId: props.workspaceId, graphScope: item.reviewId ? 'daily-review' : 'operation', graphId: item.reviewId ?? item.operationId! })}>关系图谱</button>}
      </div></article>)}</div><p className="px-muted">下一步：选择一条来源查看详情；如需理解任务过程，再进入任务追踪或关系图谱。</p><EvidenceDrawer refs={props.data.evidenceRefs.map((item) => item.ref)} requestId={props.data.requestId} />
  </section>
  if (props.data.view === 'source_detail') return <section className="px-card px-primary-view" data-testid="view-source_detail"><p className="px-eyebrow">来源详情</p><h2>{props.data.value.title}</h2><p>{props.data.value.summary}</p><MetaRow time={props.data.value.asOf} trust={`${props.data.value.trustStatus} · ${props.data.value.freshnessStatus}`} />
    {props.data.value.displaySections.map((section) => <article key={section.id} className="px-section"><h3>{section.title}</h3><dl>{section.items.map((item) => <div key={`${item.label}-${item.value}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></article>)}<p className="px-muted">下一步：返回来源库，或按关联任务进入追踪/图谱。</p><EvidenceDrawer refs={props.data.value.evidenceRefs} requestId={props.data.requestId} /></section>
  if (props.data.view === 'trace') return <section className="px-card px-primary-view" data-testid="view-trace"><p className="px-eyebrow">任务追踪</p><h2>{props.data.value.type}</h2><p>任务状态：{props.data.value.status}；进度 {props.data.value.progressPct}%</p><MetaRow time={props.data.value.completedAt ?? props.data.value.startedAt ?? props.data.value.requestedAt} trust={`${props.data.value.tasks.length} 个子任务`} />
    <ol className="px-timeline">{props.data.value.tasks.map((task) => <li key={task.id}><strong>{task.name}</strong><span>{task.status} · 成功 {task.successCount} / 失败 {task.failureCount}</span></li>)}</ol><p className="px-muted">下一步：核对失败节点或关联产物，不在此执行任务确认。</p><EvidenceDrawer refs={props.data.value.artifactRefs} requestId={props.data.requestId} /></section>
  if (props.data.view === 'graph') return <section className="px-card px-primary-view" data-testid="view-graph"><p className="px-eyebrow">关系图谱</p><h2>{props.data.value.scope === 'daily-review' ? '复盘流程图' : '任务流程图'}</h2><p>状态：{props.data.value.status}；{props.data.value.nodes.length} 个节点，{props.data.value.edges.length} 条关系。</p><MetaRow time={props.data.generatedAt} trust="由现有 FAMS workflow 派生" />
    <div className="px-node-grid">{props.data.value.nodes.map((node) => <article key={node.id} className="px-node"><span>{node.sequence ?? '—'}</span><h3>{node.label}</h3><p>{node.status}</p><small>{node.outputsSummary[0] ?? '无输出摘要'}</small></article>)}</div><p className="px-muted">下一步：从阻断或部分完成节点回到 FAMS 核对证据。</p><EvidenceDrawer refs={props.data.value.evidenceRefs} requestId={props.data.requestId} /></section>
  return null
}

function MetaRow({ time, trust }: { time: string; trust: string }) {
  return <div className="px-meta"><span>数据时间：{displayTime(time)}</span><span>可信状态：{trust}</span></div>
}

function EvidenceDrawer({ refs, requestId }: { refs: string[]; requestId: string }) {
  return <details className="px-evidence" data-testid="evidence-drawer"><summary>高级证据（{refs.length}）</summary><p className="px-code">requestId={requestId}</p><ul>{refs.slice(0, 30).map((ref) => <li className="px-code" key={ref}>{ref}</li>)}</ul></details>
}
