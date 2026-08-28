import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import type { WorkspaceViewData } from '../../src/adapters/fams/types'
import { hasBackendPermission, requestBackendPermission } from '../../src/background/connection'
import { createIntentRoute, createOperationCommand } from '../../src/contracts/factories'
import { sendCommandDetailed, sendRoute } from '../../src/ui/runtimeClient'

const WORKSPACE_ID = 'px-ws-00000000-0000-4000-8000-000000000001'
type ConnectionView = 'checking' | 'not_connected' | 'connected' | 'failed'
type SourceViewData = Extract<WorkspaceViewData, { view: 'source_library' }>
type AskViewData = Extract<WorkspaceViewData, { view: 'ask' }>

export const SIDE_PANEL_STATE_COPY = {
  checking: { title: '正在检查本地 FAMS', detail: '正在确认权限和 4000 端口连接。', action: '请稍候，系统不会用缓存摘要冒充本次结果。' },
  not_connected: { title: '需要连接本地 FAMS', detail: '扩展尚未获得本地 4000 端口访问权限。', action: '点击“连接本地 FAMS”，只确认两个本地后端地址。' },
  loading: { title: '正在读取真实摘要', detail: 'Background 正在读取 FAMS read model。', action: '请稍候；失败时会保留原因和重试动作。' },
  empty: { title: '当前没有研究任务', detail: 'FAMS 返回明确 empty，没有使用示例内容填充。', action: '先在 FAMS 运行复盘或研究任务，再重新读取。' },
  failed: { title: '本地摘要读取失败', detail: '当前 workspace 标识仍保留，没有显示旧结果为成功。', action: '确认 FAMS 已启动后重新读取。' },
  blocked: { title: '请求已阻断', detail: '权限、合同或策略检查未通过。', action: '按下方原因处理；需要确认的操作回 FAMS 完成。' },
} as const

const displayTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

export function SidePanelApp() {
  const [connection, setConnection] = useState<ConnectionView>('checking')
  const [message, setMessage] = useState<string>(SIDE_PANEL_STATE_COPY.checking.detail)
  const [busy, setBusy] = useState(false)
  const [sourceData, setSourceData] = useState<SourceViewData | null>(null)
  const [answerData, setAnswerData] = useState<AskViewData | null>(null)
  const [question, setQuestion] = useState('')
  const [ackVisible, setAckVisible] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  const refreshConnection = useCallback(async () => {
    const granted = await hasBackendPermission(browser.permissions)
    if (!granted) {
      setConnection('not_connected')
      setMessage(SIDE_PANEL_STATE_COPY.not_connected.detail)
      return
    }
    setConnection('checking')
    setMessage(SIDE_PANEL_STATE_COPY.loading.detail)
    try {
      const route = createIntentRoute({
        entryContainer: 'sidepanel', entryAction: 'view_source', routeIntent: 'source_library', routePayload: { workspaceId: WORKSPACE_ID },
      })
      const routeResult = await sendRoute(route)
      if (routeResult.status !== 'accepted') throw new Error(routeResult.error?.userMessage ?? '来源路由被阻断。')
      const command = await createOperationCommand({
        sourceContainer: 'sidepanel', commandType: 'refresh_index', payload: { workspaceId: WORKSPACE_ID },
        routeId: route.routeId, correlationId: route.correlationId,
      })
      const response = await sendCommandDetailed(command)
      if (response.viewData?.view === 'source_library') setSourceData(response.viewData)
      if (response.commandResult.status === 'completed' || response.commandResult.status === 'empty') {
        setConnection('connected')
        setMessage(response.commandResult.status === 'empty' ? SIDE_PANEL_STATE_COPY.empty.detail : '已从本地 FAMS 读取并验证最新摘要。')
      } else {
        setConnection('failed')
        setMessage(response.commandResult.error?.userMessage ?? SIDE_PANEL_STATE_COPY.failed.detail)
      }
    } catch {
      setConnection('failed')
      setMessage(SIDE_PANEL_STATE_COPY.failed.detail)
    }
  }, [])

  useEffect(() => { void refreshConnection() }, [refreshConnection])

  async function connect() {
    setBusy(true)
    try {
      const granted = await requestBackendPermission(browser.permissions)
      if (!granted) {
        setConnection('not_connected')
        setMessage('你拒绝了本地访问授权；扩展没有发送 FAMS API 请求。')
        return
      }
      await refreshConnection()
    } catch {
      setConnection('failed')
      setMessage('本地授权流程未完成；扩展没有把连接显示为成功。')
    } finally {
      setBusy(false)
    }
  }

  async function openWorkspace() {
    setBusy(true)
    try {
      const latest = sourceData?.value.items[0]
      const route = createIntentRoute(latest ? {
        entryContainer: 'sidepanel', entryAction: 'open_workspace', routeIntent: 'source_detail', routePayload: { workspaceId: WORKSPACE_ID, sourceRef: latest.sourceRef },
      } : {
        entryContainer: 'sidepanel', entryAction: 'open_workspace', routeIntent: 'source_library', routePayload: { workspaceId: WORKSPACE_ID },
      })
      const result = await sendRoute(route)
      setMessage(result.status === 'accepted' ? '已打开或聚焦现有工作台。' : result.error?.userMessage ?? '无法打开工作台。')
    } catch {
      setMessage('打开工作台失败；当前摘要仍保留，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  async function submitAsk() {
    const normalized = question.trim()
    if (!normalized || busy) return
    setBusy(true)
    setAckVisible(true)
    setAnswerData(null)
    setAskError(null)
    setMessage('问题已接收；POST 不会自动重试，正在等待最终摘要。')
    try {
      const latest = sourceData?.value.items[0]
      const command = await createOperationCommand({
        sourceContainer: 'sidepanel', commandType: 'query',
        payload: { workspaceId: WORKSPACE_ID, question: normalized, contextRefs: latest ? [latest.sourceRef] : [] },
      })
      const response = await sendCommandDetailed(command)
      if (response.viewData?.view === 'ask' && response.commandResult.status === 'completed') {
        setAnswerData(response.viewData)
        setMessage('最终摘要已返回；复杂证据请在完整工作台核对。')
      } else {
        const prefix = response.commandResult.status === 'unknown_result' ? '结果状态未知。' : response.commandResult.status === 'blocked' ? '问题已被阻断。' : '问答未完成。'
        setAskError(`${prefix}${response.commandResult.error?.userMessage ?? '请到 FAMS 复核。'}`)
      }
    } catch {
      setAskError('问答连接失败；系统没有自动发送第二次 POST，请到 FAMS 复核。')
    } finally {
      setAckVisible(false)
      setBusy(false)
    }
  }

  return <SidePanelContent
    connection={connection} message={message} busy={busy} sourceData={sourceData} answerData={answerData}
    question={question} ackVisible={ackVisible} askError={askError} setQuestion={setQuestion}
    connect={connect} retry={refreshConnection} openWorkspace={openWorkspace} submitAsk={submitAsk}
  />
}

export function SidePanelContent(props: {
  connection: ConnectionView
  message: string
  busy: boolean
  sourceData: SourceViewData | null
  answerData: AskViewData | null
  question: string
  ackVisible: boolean
  askError?: string | null
  setQuestion: (value: string) => void
  connect: () => Promise<void>
  retry: () => Promise<void>
  openWorkspace: () => Promise<void>
  submitAsk: () => Promise<void>
}) {
  const connected = props.connection === 'connected'
  const connectionCopy = props.connection === 'connected' ? null : SIDE_PANEL_STATE_COPY[props.connection]
  const latest = props.sourceData?.value.items[0]
  const recent = props.sourceData?.value.items.slice(0, 5) ?? []

  return <main className="px-shell px-shell--sidepanel" data-testid="sidepanel-app" data-connection={props.connection}>
    <header className="px-header">
      <div><p className="px-eyebrow">FAMS External Brain</p><h1 className="px-title">研究摘要入口</h1><p className="px-subtitle">先看简明结论；复杂来源、追踪和图谱进入完整工作台。</p></div>
      <span className="px-badge">研究模式</span>
    </header>

    <section className={`px-card ${connected ? 'px-success' : props.connection === 'failed' ? 'px-error' : 'px-warning'}`} aria-live="polite" data-testid="sidepanel-connection">
      <div className="px-status"><span className={`px-status-dot ${connected ? 'px-status-dot--ok' : ''}`} aria-hidden="true" /><div>
        <h2>{connected ? '本地 FAMS 已连接' : connectionCopy?.title}</h2><p>{props.message}</p>
      </div></div>
      {!connected && <div className="px-actions">
        {props.connection === 'not_connected' && <button className="px-button" type="button" disabled={props.busy} onClick={() => void props.connect()}>连接本地 FAMS</button>}
        {props.connection === 'failed' && <button className="px-button" type="button" disabled={props.busy} onClick={() => void props.retry()}>重新读取</button>}
      </div>}
    </section>

    {connected && latest && <section className="px-card" data-testid="sidepanel-current-summary">
      <p className="px-eyebrow">当前任务</p><h2>{latest.title}</h2><p className="px-panel-summary">{latest.summary}</p>
      <div className="px-meta"><span>数据时间：{displayTime(latest.asOf)}</span><span>研究模式 · {latest.trustStatus}</span></div>
      <details className="px-panel-evidence"><summary>查看依据</summary><p>来源已保存在 FAMS；可信状态 {latest.trustStatus}，新鲜度 {latest.freshnessStatus}。</p></details>
      <button className="px-button px-button--wide" type="button" disabled={props.busy} onClick={() => void props.openWorkspace()}>在完整工作台打开</button>
    </section>}

    {connected && !latest && <section className="px-card px-warning" data-testid="sidepanel-empty"><h2>{SIDE_PANEL_STATE_COPY.empty.title}</h2><p>{SIDE_PANEL_STATE_COPY.empty.detail}</p><p className="px-muted">下一步：{SIDE_PANEL_STATE_COPY.empty.action}</p><button className="px-button" type="button" onClick={() => void props.retry()}>重新读取</button></section>}

    {connected && <section className="px-card" data-testid="sidepanel-ask">
      <p className="px-eyebrow">快速问答</p><h2>让 FAMS 整合为简明摘要</h2>
      <label className="px-field">你的问题<textarea value={props.question} maxLength={1000} onChange={(event) => props.setQuestion(event.target.value)} placeholder="例如：总结当前真实研究上下文" /></label>
      <button className="px-button" type="button" disabled={props.busy || !props.question.trim()} onClick={() => void props.submitAsk()}>发送问题</button>
      {props.ackVisible && <div className="px-panel-notice" role="status" data-testid="sidepanel-ask-ack"><strong>已接收，正在处理</strong><p>正在等待最终摘要；系统不会自动发送第二次 POST。</p></div>}
      {props.askError && <div className="px-panel-notice px-error" role="alert" data-testid="sidepanel-ask-error"><strong>问答未完成</strong><p>{props.askError}</p><p>下一步：到 FAMS 核对最近会话或稍后重新提问。</p></div>}
      {props.answerData && <article className="px-result" data-testid="sidepanel-ask-result"><h3>结论摘要</h3><p>{props.answerData.value.summary}</p><div className="px-meta"><span>数据时间：{displayTime(props.answerData.value.dataAsOf)}</span><span>可信度 {Math.round(props.answerData.value.confidence * 100)}%</span></div><h3>下一步</h3><ul>{props.answerData.value.nextActions.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></article>}
    </section>}

    {connected && recent.length > 0 && <section className="px-card" data-testid="sidepanel-recent"><p className="px-eyebrow">最近任务</p><ul className="px-recent-list">{recent.map((item) => <li key={item.sourceRef} data-testid="sidepanel-recent-task"><strong>{item.title}</strong><span>{displayTime(item.asOf)} · {item.freshnessStatus}</span></li>)}</ul></section>}

    <footer className="px-footer"><span>workspaceId：{WORKSPACE_ID}</span><span>订单能力：关闭</span></footer>
  </main>
}
