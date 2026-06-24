import { Outlet } from 'react-router-dom'
import { Layout as AntLayout, Menu } from 'antd'
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
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'

const { Sider, Content } = AntLayout

const menuItems = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '总览' },
  { key: 'assets', icon: <BankOutlined />, label: '资产管理' },
  { key: 'positions', icon: <WalletOutlined />, label: '仓位管理' },
  { key: 'transactions', icon: <SwapOutlined />, label: '交易记录' },
  { key: 'analysis', icon: <LineChartOutlined />, label: '分析建议' },
  { key: 'portfolios', icon: <PieChartOutlined />, label: '投资组合' },
  { key: 'dividend-low-vol', icon: <RiseOutlined />, label: '红利低波策略' },
  { key: 'alerts', icon: <BellOutlined />, label: '风险告警' },
  { key: 'operations', icon: <HistoryOutlined />, label: '任务中心' },
  { key: 'backtest', icon: <ExperimentOutlined />, label: '策略回测' },
]

export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const selectedKey = location.pathname.split('/')[1] || 'dashboard'

  return (
    <AntLayout className="min-h-screen min-w-0">
      <Sider
        width={200}
        breakpoint="md"
        collapsedWidth={0}
        className="bg-[#1a1a2e] border-r border-[surface-border]"
        theme="dark"
      >
        <div className="h-16 flex items-center justify-center border-b border-[surface-border]">
          <span className="text-lg font-bold text-white">FAMS</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(`/${key}`)}
          className="bg-transparent border-0 mt-2"
          theme="dark"
        />
      </Sider>
      <AntLayout className="bg-[#0f0f23] min-w-0">
        <Content className="min-w-0 overflow-x-hidden p-4 md:p-6">
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  )
}
