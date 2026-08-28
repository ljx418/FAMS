import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import type { CommandResult } from '../../src/contracts/types'
import { createIntentRoute, createOperationCommand } from '../../src/contracts/factories'
import { hasBackendPermission, requestBackendPermission } from '../../src/background/connection'
import { sendCommand, sendRoute } from '../../src/ui/runtimeClient'

type ConnectionView = 'checking' | 'not_connected' | 'connected' | 'failed'

export function SidePanelApp() {
  const [connection, setConnection] = useState<ConnectionView>('checking')
  const [message, setMessage] = useState('正在检查本地连接…')
  const [busy, setBusy] = useState(false)

  const refreshConnection = useCallback(async () => {
    const granted = await hasBackendPermission(browser.permissions)
    if (!granted) {
      setConnection('not_connected')
      setMessage('扩展尚未获得本地 FAMS 访问权限。只有你点击连接后才会请求 4000 端口。')
      return
    }
    const command = await createOperationCommand({ sourceContainer: 'sidepanel', commandType: 'refresh_index', payload: { workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001' } })
    const result = await sendCommand(command)
    setConnection(result.status === 'completed' ? 'connected' : 'failed')
    setMessage(result.status === 'completed' ? '本地 FAMS 已连接，可以打开研究工作台。' : result.error?.userMessage ?? '连接失败。')
  }, [])

  useEffect(() => { void refreshConnection() }, [refreshConnection])

  async function connect() {
    setBusy(true)
    const granted = await requestBackendPermission(browser.permissions)
    if (!granted) {
      setConnection('not_connected')
      setMessage('你拒绝了本地访问授权。扩展没有发送任何 FAMS API 请求。')
      setBusy(false)
      return
    }
    await refreshConnection()
    setBusy(false)
  }

  async function openWorkspace() {
    setBusy(true)
    const route = createIntentRoute({
      entryContainer: 'sidepanel',
      entryAction: 'open_workspace',
      routeIntent: 'source_library',
      routePayload: { workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001' },
    })
    const result: CommandResult = await sendRoute(route)
    setMessage(result.status === 'accepted' ? '已打开或聚焦现有工作台。' : result.error?.userMessage ?? '无法打开工作台。')
    setBusy(false)
  }

  return (
    <main className="px-shell" data-testid="sidepanel-app">
      <header className="px-header">
        <div>
          <p className="px-eyebrow">FAMS External Brain</p>
          <h1 className="px-title">研究摘要入口</h1>
          <p className="px-subtitle">快速确认状态，再到完整工作台查看来源、追踪和图谱。</p>
        </div>
        <span className="px-badge">只读研究</span>
      </header>

      <section className={`px-card ${connection === 'connected' ? 'px-success' : connection === 'failed' ? 'px-error' : 'px-warning'}`} aria-live="polite">
        <div className="px-status">
          <span className={`px-status-dot ${connection === 'connected' ? 'px-status-dot--ok' : ''}`} aria-hidden="true" />
          <div>
            <h2>{connection === 'connected' ? '本地 FAMS 已连接' : connection === 'checking' ? '检查连接' : '需要连接本地 FAMS'}</h2>
            <p>{message}</p>
          </div>
        </div>
        <div className="px-actions">
          {connection !== 'connected' && <button className="px-button" type="button" disabled={busy} onClick={() => void connect()}>连接本地 FAMS</button>}
          <button className="px-button px-button--secondary" type="button" disabled={busy} onClick={() => void openWorkspace()}>打开完整工作台</button>
        </div>
      </section>

      <section className="px-card">
        <h2>本阶段能做什么</h2>
        <p><strong>查看：</strong>确认扩展、权限和工作台路径真实可用。</p>
        <p><strong>不会做：</strong>不会自动下单、不会复制账户截图、不会读取 cookie 或 token。</p>
        <p className="px-muted">完整来源库和快速问答会在后续阶段接入真实 FAMS 结果。</p>
      </section>
    </main>
  )
}
