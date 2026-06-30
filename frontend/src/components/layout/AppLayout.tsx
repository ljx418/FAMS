import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Button, Drawer, Layout as AntLayout, Menu } from 'antd'
import {
  DashboardOutlined,
  BankOutlined,
  WalletOutlined,
  SwapOutlined,
  LineChartOutlined,
  RiseOutlined,
  ExperimentOutlined,
  PieChartOutlined,
  HistoryOutlined,
  BellOutlined,
  MenuOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { FamsChatBox } from '../chat/FamsChatBox'

const { Sider, Content } = AntLayout

const menuItems = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '总览' },
  {
    key: 'portfolio-management',
    type: 'group' as const,
    label: '资产与组合',
    children: [
      { key: 'assets', icon: <BankOutlined />, label: '资产管理' },
      { key: 'positions', icon: <WalletOutlined />, label: '仓位管理' },
      { key: 'transactions', icon: <SwapOutlined />, label: '交易记录' },
      { key: 'portfolios', icon: <PieChartOutlined />, label: '投资组合' },
    ],
  },
  {
    key: 'strategy-research',
    type: 'group' as const,
    label: '策略研究',
    children: [
      { key: 'analysis', icon: <LineChartOutlined />, label: '分析建议' },
      { key: 'dividend-low-vol', icon: <RiseOutlined />, label: '红利低波策略' },
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
    navigate(`/${key}`)
    setMobileNavOpen(false)
  }
  const navigationMenu = (
    <Menu
      mode="inline"
      selectedKeys={[selectedKey]}
      items={menuItems}
      onClick={({ key }) => handleNavigate(String(key))}
      className="bg-transparent border-0 mt-2"
      theme="dark"
    />
  )

  return (
    <AntLayout className="min-h-screen min-w-0">
      <Sider
        width={200}
        breakpoint="md"
        collapsedWidth={0}
        className="bg-[#1a1a2e] border-r border-surface-border"
        theme="dark"
      >
        <div className="h-16 flex items-center justify-center border-b border-surface-border">
          <span className="text-lg font-bold text-white">FAMS</span>
        </div>
        {navigationMenu}
      </Sider>
      <AntLayout className="bg-[#0f0f23] min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-surface-border bg-[#111827]/95 px-4 md:hidden">
          <Button
            type="text"
            icon={<MenuOutlined />}
            aria-label="打开导航菜单"
            onClick={() => setMobileNavOpen(true)}
            className="text-white"
          />
          <div className="min-w-0 text-center">
            <div className="text-sm font-semibold text-white">{currentLabel}</div>
            <div className="text-[11px] text-gray-400">研究与组合管理</div>
          </div>
          <span className="w-8" aria-hidden />
        </header>
        <Drawer
          title="FAMS 导航"
          placement="left"
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          width={280}
          styles={{ body: { padding: 0, background: '#1a1a2e' }, header: { background: '#1a1a2e', borderBottomColor: '#2a2a4e' } }}
        >
          {navigationMenu}
        </Drawer>
        <Content className="min-w-0 overflow-x-hidden p-4 md:p-6">
          <Outlet />
        </Content>
        <FamsChatBox />
      </AntLayout>
    </AntLayout>
  )
}
