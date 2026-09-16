import { useEffect, useState } from 'react'
import { Button, Tag } from 'antd'
import { BarChartOutlined, DatabaseOutlined, RadarChartOutlined, RightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../../config/api'

type WorkflowStep = 'basic_information_confirmation' | 'position_strategy' | 'backtest_review'

type Readiness = {
  facts: { openPositionCount: number; unassignedPositionCount: number; pendingAssignmentCount: number }
  strategies: Array<{ strategyFamily: string; researchReady: boolean; blockers: string[] }>
}

const steps: Array<{ id: WorkflowStep; title: string; short: string; path: string; icon: typeof DatabaseOutlined }> = [
  { id: 'basic_information_confirmation', title: '基本信息确认', short: '账户、价格与交易事实', path: '/assets', icon: DatabaseOutlined },
  { id: 'position_strategy', title: '仓位策略', short: '归类并运行对应研究', path: '/positions', icon: RadarChartOutlined },
  { id: 'backtest_review', title: '回测复盘', short: '比较建议、不执行与实仓', path: '/backtest', icon: BarChartOutlined },
]

export function InvestmentWorkflowBar({ currentStep, userId = 'default' }: { currentStep: WorkflowStep; userId?: string }) {
  const navigate = useNavigate()
  const [readiness, setReadiness] = useState<Readiness | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`${API_BASE}/api/v1/investment-workflow/readiness?userId=${encodeURIComponent(userId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(setReadiness)
      .catch(() => setReadiness(null))
    return () => controller.abort()
  }, [userId])

  const readyStrategyCount = readiness?.strategies.filter((item) => item.researchReady).length || 0
  return (
    <section className="fams-workflow-bar" aria-label="投资工作流" data-testid="investment-workflow-bar">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">投资工作流</div>
          <div className="mt-1 text-xs text-slate-500">这是模块关系提示，不限制你直接打开任何专家页面。</div>
        </div>
        {readiness ? (
          <div className="flex flex-wrap gap-2">
            <Tag>{readiness.facts.openPositionCount} 项开放持仓</Tag>
            <Tag color={readiness.facts.pendingAssignmentCount + readiness.facts.unassignedPositionCount === 0 ? 'green' : 'orange'}>
              {readiness.facts.pendingAssignmentCount + readiness.facts.unassignedPositionCount === 0 ? '归类已确认' : `${readiness.facts.pendingAssignmentCount + readiness.facts.unassignedPositionCount} 项待确认`}
            </Tag>
            <Tag color={readyStrategyCount > 0 ? 'blue' : 'default'}>{readyStrategyCount}/3 类研究可运行</Tag>
          </div>
        ) : <Tag>状态读取中</Tag>}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {steps.map((step, index) => {
          const Icon = step.icon
          const active = step.id === currentStep
          return (
            <Button
              key={step.id}
              type={active ? 'primary' : 'text'}
              className={`fams-workflow-step ${active ? 'is-active' : ''}`}
              onClick={() => navigate(step.path)}
              icon={<Icon />}
            >
              <span className="min-w-0 text-left">
                <span className="block truncate font-medium">{index + 1}. {step.title}</span>
                <span className={`block truncate text-xs ${active ? 'text-blue-100' : 'text-slate-500'}`}>{step.short}</span>
              </span>
              <RightOutlined className="ml-auto text-xs" />
            </Button>
          )
        })}
      </div>
    </section>
  )
}
