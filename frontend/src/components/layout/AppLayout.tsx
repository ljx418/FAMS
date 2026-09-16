import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Button, Drawer, Layout as AntLayout, Menu, notification } from 'antd'
import {
  DashboardOutlined,
  BankOutlined,
  WalletOutlined,
  SwapOutlined,
  LineChartOutlined,
  RiseOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  BellOutlined,
  MenuOutlined,
  AuditOutlined,
  ReadOutlined,
  RadarChartOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { FamsChatBox } from '../chat/FamsChatBox'
import { API_BASE } from '../../config/api'

const { Sider, Content } = AntLayout

const menuItems = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '总览' },
  { key: 'fams-user-guide', icon: <ReadOutlined />, label: '使用指南' },
  {
    key: 'portfolio-management',
    type: 'group' as const,
    label: '资产与组合',
    children: [
      { key: 'assets', icon: <BankOutlined />, label: '资产管理' },
      { key: 'positions', icon: <WalletOutlined />, label: '仓位管理' },
      { key: 'daily-reviews', icon: <AuditOutlined />, label: '每日复盘' },
      { key: 'transactions', icon: <SwapOutlined />, label: '交易记录' },
    ],
  },
  {
    key: 'strategy-research',
    type: 'group' as const,
    label: '策略研究',
    children: [
      { key: 'analysis', icon: <LineChartOutlined />, label: '分析建议' },
      { key: 'dividend-low-vol', icon: <RiseOutlined />, label: '红利低波策略' },
      { key: 'relative-rotation', icon: <RadarChartOutlined />, label: '相对轮动与波动仓' },
      { key: 'backtest', icon: <ExperimentOutlined />, label: '策略回测' },
    ],
  },
  {
    key: 'execution-governance',
    type: 'group' as const,
    label: '执行治理',
    children: [
      { key: 'alerts', icon: <BellOutlined />, label: '风险告警' },
      { key: 'operations', icon: <HistoryOutlined />, label: '任务中心' },
    ],
  },
]

export function Layout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [notificationApi, notificationContext] = notification.useNotification()
  const notifiedReminderIds = useRef(new Set<string>())
  const navigate = useNavigate()
  const location = useLocation()
  const pathKey = location.pathname.split('/')[1] || 'dashboard'
  const selectedKey = pathKey === 'fund'
    ? 'assets'
    : pathKey === 'stock'
      ? 'analysis'
      : pathKey
  const currentLabel = menuItems
    .flatMap((item: any) => item.children || [item])
    .find((item: any) => item.key === selectedKey)?.label || 'FAMS'
  const handleNavigate = (key: string) => {
    if (key === 'fams-user-guide') {
      setMobileNavOpen(false)
      window.open('/fams-user-guide.html', '_blank', 'noopener,noreferrer')
      return
    }
    navigate(`/${key}`)
    setMobileNavOpen(false)
  }
  useEffect(() => {
    let cancelled = false
    const storageKey = 'fams.brokerReviewReminder.seen.v1'
    try {
      notifiedReminderIds.current = new Set(JSON.parse(window.localStorage.getItem(storageKey) || '[]'))
    } catch {
      notifiedReminderIds.current = new Set()
    }
    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v1/alerts/unread?userId=default&limit=30`)
        if (!response.ok || cancelled) return
        const alerts = await response.json() as Array<{ id: string; title: string; message: string }>
        for (const alert of alerts.filter((item) => item.title.startsWith('[券商复盘提醒]')).reverse()) {
          if (notifiedReminderIds.current.has(alert.id)) continue
          notifiedReminderIds.current.add(alert.id)
          const kept = [...notifiedReminderIds.current].slice(-40)
          notifiedReminderIds.current = new Set(kept)
          window.localStorage.setItem(storageKey, JSON.stringify(kept))
          notificationApi.info({
            key: alert.id,
            message: '券商波动交易复盘提醒',
            description: alert.message,
            duration: 0,
            actions: <Button type="primary" size="small" onClick={() => navigate('/daily-reviews')}>进入每日复盘</Button>,
          })
          if ('Notification' in window && window.Notification.permission === 'granted') {
            new window.Notification('FAMS 券商复盘提醒', { body: alert.message, tag: alert.id })
          }
          window.dispatchEvent(new CustomEvent('fams:broker-review-reminder', { detail: alert }))
        }
      } catch {
        // 后端暂不可用时保持静默，下一个轮询周期会重试。
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 60_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [navigate, notificationApi])
  const navigationMenu = (
    <nav aria-label="FAMS 主导航">
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={({ key }) => handleNavigate(String(key))}
        className="bg-transparent border-0 mt-2"
        theme="light"
      />
    </nav>
  )

  return (
    <AntLayout className="min-h-screen min-w-0">
      {notificationContext}
      <Sider
        width={200}
        breakpoint="md"
        collapsedWidth={0}
        trigger={null}
        className="border-r border-slate-200 bg-white"
        theme="light"
      >
        <div className="flex h-16 items-center justify-center border-b border-slate-200">
          <span className="text-lg font-bold text-slate-950">FAMS</span>
        </div>
        {navigationMenu}
      </Sider>
      <AntLayout className="min-w-0 bg-[#f4f7fb]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 md:hidden">
          <Button
            type="text"
            icon={<MenuOutlined />}
            aria-label="打开导航菜单"
            onClick={() => setMobileNavOpen(true)}
            className="text-slate-950"
          />
          <div className="min-w-0 text-center">
            <div className="text-sm font-semibold text-slate-950">{currentLabel}</div>
            <div className="text-[11px] text-slate-500">研究与组合管理</div>
          </div>
          <span className="w-8" aria-hidden />
        </header>
        <Drawer
          title="FAMS 导航"
          placement="left"
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          width={280}
          styles={{ body: { padding: 0, background: '#ffffff' }, header: { background: '#ffffff', borderBottomColor: '#e2e8f0' } }}
        >
          {navigationMenu}
        </Drawer>
        <Content className="fams-content min-w-0 overflow-x-hidden p-4 md:p-6">
          <Outlet />
        </Content>
        <FamsChatBox />
      </AntLayout>
    </AntLayout>
  )
}
