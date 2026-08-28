import { useMemo } from 'react'
import { browser } from 'wxt/browser'
import type { RouteIntent } from '../../src/contracts/types'

const VIEW_LABELS: Record<RouteIntent, string> = {
  source_library: '来源库',
  source_detail: '来源详情',
  ask: '快速问答',
  trace: '任务追踪',
  graph: '关系图谱',
}

export function WorkspaceApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const currentView = (params.get('view') ?? 'source_library') as RouteIntent
  const workspaceId = params.get('workspaceId') ?? 'default_workspace'

  async function openSidePanel() {
    const current = await browser.windows.getCurrent()
    if (typeof current.id === 'number') await browser.sidePanel.open({ windowId: current.id })
  }

  return (
    <main className="px-shell px-shell--workspace" data-testid="workspace-app">
      <header className="px-header">
        <div>
          <p className="px-eyebrow">FAMS External Brain</p>
          <h1 className="px-title">研究工作台</h1>
          <p className="px-subtitle">一个工作区承载来源、问答、追踪和图谱；业务事实继续由本地 FAMS 管理。</p>
        </div>
        <span className="px-badge">交易锁定</span>
      </header>

      <nav className="px-nav" aria-label="工作台视图">
        {Object.entries(VIEW_LABELS).map(([value, label]) => (
          <button key={value} type="button" aria-current={currentView === value ? 'page' : undefined}>{label}</button>
        ))}
      </nav>

      <section className="px-card" aria-live="polite">
        <h2>{VIEW_LABELS[currentView] ?? '来源库'}</h2>
        <p>PX1 已验证真实 Workspace 容器、canonical URL 和标签页复用。</p>
        <p className="px-muted">真实 FAMS read model 将在 PX2 接入；当前不使用 mock 内容冒充业务完成。</p>
        <p className="px-code">workspaceId={workspaceId}</p>
        <div className="px-actions">
          <button className="px-button px-button--secondary" type="button" onClick={() => void openSidePanel()}>打开侧栏</button>
        </div>
      </section>

      <section className="px-grid">
        <article className="px-card"><h3>明确边界</h3><p>只读研究与受控计算；扩展没有订单能力。</p></article>
        <article className="px-card"><h3>恢复准备</h3><p>路由和关联标识由 Background 单写者保存。</p></article>
        <article className="px-card"><h3>证据优先</h3><p>所有完成声明必须能回到真实 Chrome、代码提交与哈希。</p></article>
      </section>
    </main>
  )
}
