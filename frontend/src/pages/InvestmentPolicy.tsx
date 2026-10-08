import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App as AntApp, Button, Card, Descriptions, Divider, Input, InputNumber, Modal, Progress, Space, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckCircleOutlined, EditOutlined, InfoCircleOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, SettingOutlined } from '@ant-design/icons'
import { investmentPolicyApi, type InvestmentPolicyContract, type PolicyEvaluation, type PolicyRecord, type StrategyFamily } from '../services/investmentPolicyService'

const USER_ID = 'default'

const FAMILY_LABELS: Record<StrategyFamily, string> = {
  portfolio: '基金组合',
  dividend_low_vol: '红利低波',
  rotation_volatility: '行业 / 个股轮动',
}

const ASSET_CLASS_LABELS: Record<string, string> = {
  equity_index: '股指', bond_fund: '债基', gold: '黄金', cash: '组合内现金',
}

const money = (value: number | null | undefined) => value === null || value === undefined
  ? '--'
  : new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value)

const cloneContract = (contract: InvestmentPolicyContract) => JSON.parse(JSON.stringify(contract)) as InvestmentPolicyContract

export default function InvestmentPolicy() {
  const { message, modal } = AntApp.useApp()
  const [active, setActive] = useState<PolicyRecord | null>(null)
  const [draft, setDraft] = useState<PolicyRecord | null>(null)
  const [legacy, setLegacy] = useState<{ strategyId?: string; name?: string; status?: string; remainsActiveUntilExplicitPolicyActivation: boolean } | null>(null)
  const [contract, setContract] = useState<InvestmentPolicyContract | null>(null)
  const [evaluation, setEvaluation] = useState<PolicyEvaluation | null>(null)
  const [loading, setLoading] = useState(false)
  const [overridePosition, setOverridePosition] = useState<PolicyEvaluation['positions'][number] | null>(null)
  const [overrideCap, setOverrideCap] = useState<number | null>(null)
  const [overrideStopMode, setOverrideStopMode] = useState<'inherit' | 'fixed_loss_percent' | 'model'>('inherit')
  const [overrideStopLoss, setOverrideStopLoss] = useState<number | null>(null)
  const [overrideReason, setOverrideReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const state = await investmentPolicyApi.current(USER_ID)
      setActive(state.activePolicy)
      setDraft(state.latestDraft)
      setLegacy(state.legacyPortfolioPlan)
      const selected = state.latestDraft || state.activePolicy
      setContract(selected ? cloneContract(selected.contract) : null)
      setEvaluation(selected ? await investmentPolicyApi.evaluation(selected.id, USER_ID) : null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取投资政策失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void load() }, [load])

  const createDraft = async () => {
    setLoading(true)
    try {
      const created = await investmentPolicyApi.createDraft(USER_ID)
      setDraft(created)
      setContract(cloneContract(created.contract))
      setEvaluation(await investmentPolicyApi.evaluation(created.id, USER_ID))
      message.success('已建立新政策草案；现有活动政策没有改变。')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建政策草案失败')
    } finally {
      setLoading(false)
    }
  }

  const saveDraft = async () => {
    if (!draft || !contract) return null
    const saved = await investmentPolicyApi.updateDraft(draft.id, contract, USER_ID)
    setDraft(saved)
    setContract(cloneContract(saved.contract))
    setEvaluation(await investmentPolicyApi.evaluation(saved.id, USER_ID))
    message.success('政策草案已保存；不会触发调仓。')
    return saved
  }

  const activate = () => {
    if (!draft || !contract) return
    modal.confirm({
      title: `激活政策 v${draft.version}`,
      icon: <SafetyCertificateOutlined />,
      content: '激活会把当前草案设为新的研究与风险边界，但不会创建订单、不会自动调仓。现有政策会保留为历史版本。',
      okText: '确认激活',
      cancelText: '继续编辑',
      onOk: async () => {
        setLoading(true)
        try {
          const saved = await investmentPolicyApi.updateDraft(draft.id, contract, USER_ID)
          await investmentPolicyApi.activate(saved.id, USER_ID)
          message.success('投资政策已激活；交易权限仍保持锁定。')
          await load()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '政策激活失败，请补齐所有必填门槛')
        } finally {
          setLoading(false)
        }
      },
    })
  }

  const updateBucket = (family: StrategyFamily, field: 'targetPercent' | 'minPercent' | 'maxPercent', value: number | null) => {
    if (!contract) return
    const next = cloneContract(contract)
    const bucket = next.strategyBuckets.find((item) => item.strategyFamily === family)!
    if (field === 'targetPercent') bucket.targetPercent = Number(value || 0)
    else bucket.warningBand[field] = value
    setContract(next)
  }

  const updateRisk = (path: 'reserve' | 'drawdown' | 'globalAsset' | 'globalIndustry' | 'dividendAsset' | 'dividendIndustry' | 'rotationAsset' | 'rotationCash', value: number | null) => {
    if (!contract) return
    const next = cloneContract(contract)
    if (path === 'reserve') next.reserveCash.floorPercent = value
    if (path === 'drawdown') next.riskRules.portfolio.drawdownReviewPercent = value
    if (path === 'globalAsset') next.riskRules.global.aggregateAssetCapPercent = Number(value || 0)
    if (path === 'globalIndustry') next.riskRules.global.industryCapPercent = Number(value || 0)
    if (path === 'dividendAsset') next.riskRules.dividendLowVol.singleAssetCapPercent = Number(value || 0)
    if (path === 'dividendIndustry') next.riskRules.dividendLowVol.industryCapPercent = Number(value || 0)
    if (path === 'rotationAsset') next.riskRules.rotationVolatility.singleAssetCapPercent = Number(value || 0)
    if (path === 'rotationCash') next.riskRules.rotationVolatility.cashFloorPercent = Number(value || 0)
    setContract(next)
  }

  const openOverride = (position: PolicyEvaluation['positions'][number]) => {
    setOverridePosition(position)
    setOverrideCap(typeof position.override?.maxAssetWeightPercent === 'number' ? Number(position.override.maxAssetWeightPercent) : position.capPercent)
    const mode = String(position.override?.stopMode || 'inherit') as 'inherit' | 'fixed_loss_percent' | 'model'
    setOverrideStopMode(mode)
    setOverrideStopLoss(typeof position.override?.stopLossPercent === 'number' ? Number(position.override.stopLossPercent) : null)
    setOverrideReason('')
  }

  const saveOverride = async () => {
    if (!draft || !overridePosition) return
    setLoading(true)
    try {
      await investmentPolicyApi.saveOverride(draft.id, overridePosition.positionId, {
        maxAssetWeightPercent: overrideCap,
        stopMode: overrideStopMode,
        stopLossPercent: overrideStopMode === 'fixed_loss_percent' ? overrideStopLoss : null,
        reason: overrideReason,
      }, USER_ID)
      setOverridePosition(null)
      await load()
      message.success('单标的覆盖已写入草案和审计记录。')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存单标的覆盖失败')
    } finally {
      setLoading(false)
    }
  }

  const targetSum = useMemo(() => contract?.strategyBuckets.reduce((sum, item) => sum + item.targetPercent, 0) || 0, [contract])
  const selectedPolicy = draft || active

  const positionColumns: ColumnsType<PolicyEvaluation['positions'][number]> = [
    { title: '持仓', key: 'asset', render: (_, row) => <div><div className="font-medium text-slate-950">{row.name}</div><div className="text-xs text-slate-500">{row.symbol} · {row.industry}</div></div> },
    { title: '策略', dataIndex: 'strategyFamily', render: (value) => value === 'unclassified' ? <Tag color="warning">待归类</Tag> : <Tag>{FAMILY_LABELS[value as StrategyFamily]}</Tag> },
    { title: '当前 / 上限', key: 'cap', render: (_, row) => <div><div>{row.currentWeightPercent.toFixed(2)}% / {row.capPercent}%</div><Tag color={row.capStatus === 'over_cap' ? 'error' : 'success'}>{row.capStatus === 'over_cap' ? '禁止新增风险' : '上限内'}</Tag></div> },
    { title: '止损 / 失效', key: 'stop', render: (_, row) => <Tooltip title="组合使用回撤与论点复核；红利低波使用基本面和动态区间；轮动使用ATR与趋势失效。"><span className="cursor-help border-b border-dotted border-slate-400">{row.stopPolicy.mode}{row.stopPolicy.percent ? ` · ${row.stopPolicy.percent}%` : ''}</span></Tooltip> },
    { title: '规则', key: 'action', width: 100, render: (_, row) => draft ? <Button size="small" icon={<EditOutlined />} onClick={() => openOverride(row)}>覆盖</Button> : <span className="text-xs text-slate-500">只读</span> },
  ]
  const industryColumns: ColumnsType<PolicyEvaluation['industryExposures'][number]> = [
    { title: '口径', key: 'scope', render: (_, row) => <Tag color={row.scope === 'global' ? 'blue' : 'green'}>{row.scope === 'global' ? '全局行业' : '红利低波行业'}</Tag> },
    { title: '行业', dataIndex: 'industry' },
    { title: '市值', dataIndex: 'marketValue', align: 'right', render: (value) => money(Number(value)) },
    { title: '当前 / 上限', key: 'weight', align: 'right', render: (_, row) => `${row.currentWeightPercent.toFixed(2)}% / ${row.capPercent}%` },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'over_cap' ? 'error' : 'success'}>{value === 'over_cap' ? '禁止新增风险' : '上限内'}</Tag> },
  ]

  return (
    <div className="fams-page space-y-6" data-testid="investment-policy-page">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="fams-eyebrow"><SettingOutlined /> 统一策略边界</div>
          <h1 className="fams-page-title mb-0 mt-2">投资政策</h1>
          <p className="fams-muted mb-0 mt-2 max-w-3xl text-sm leading-6">先保留独立备用现金，再把可投资资金按基金组合、红利低波、行业/个股轮动分桶。比例漂移只告警，系统不会自动再平衡或创建订单。</p>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新评估</Button>
          {!draft && <Button type="primary" icon={<EditOutlined />} loading={loading} onClick={() => void createDraft()}>新建政策草案</Button>}
          {draft && <Button icon={<SaveOutlined />} loading={loading} onClick={() => void saveDraft()}>保存草案</Button>}
          {draft && <Button type="primary" icon={<CheckCircleOutlined />} loading={loading} onClick={activate}>确认激活</Button>}
        </Space>
      </header>

      <Alert
        showIcon
        type={draft ? 'warning' : active ? 'success' : 'info'}
        message={draft ? `正在编辑 v${draft.version} 草案，当前活动政策没有改变` : active ? `v${active.version} 政策正在生效` : '尚未激活统一投资政策'}
        description={legacy ? `旧组合策略：${legacy.name || legacy.strategyId || '未命名'}（${legacy.status || 'unknown'}）。只有显式激活新政策后才会切换。` : '当前没有可显示的旧组合策略。'}
      />

      {contract && selectedPolicy ? (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="capital-policy-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="fams-eyebrow">资金层</div><h2 id="capital-policy-heading" className="mb-0 mt-2 text-xl font-semibold text-slate-950">备用现金与三类策略预算</h2></div>
              <Tag color={Math.abs(targetSum - 100) < 0.001 ? 'success' : 'error'}>目标合计 {targetSum}%</Tag>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-4">
              <label className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-900">独立备用现金下限 <Tooltip title="组合外的流动性缓冲。组合内部25%现金不重复计入。"><InfoCircleOutlined /></Tooltip></span>
                <InputNumber className="mt-3 w-full" min={0} max={50} suffix="%" value={contract.reserveCash.floorPercent ?? undefined} placeholder="激活前必填" disabled={!draft} onChange={(value) => updateRisk('reserve', value)} />
                <div className="mt-2 text-xs text-slate-500">仅告警，不自动补足现金。</div>
              </label>
              {contract.strategyBuckets.map((bucket) => (
                <div key={bucket.strategyFamily} className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-950">{FAMILY_LABELS[bucket.strategyFamily]}</div>
                  <InputNumber className="mt-3 w-full" min={0} max={100} prefix="目标" suffix="%" value={bucket.targetPercent} disabled={!draft} onChange={(value) => updateBucket(bucket.strategyFamily, 'targetPercent', value)} />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <InputNumber min={0} max={100} prefix="下限" suffix="%" value={bucket.warningBand.minPercent ?? undefined} placeholder="必填" disabled={!draft} onChange={(value) => updateBucket(bucket.strategyFamily, 'minPercent', value)} />
                    <InputNumber min={0} max={100} prefix="上限" suffix="%" value={bucket.warningBand.maxPercent ?? undefined} placeholder="必填" disabled={!draft} onChange={(value) => updateBucket(bucket.strategyFamily, 'maxPercent', value)} />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">上下限仅控制展示警示。</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="strategy-rules-heading">
            <div className="fams-eyebrow">策略层</div>
            <h2 id="strategy-rules-heading" className="mb-0 mt-2 text-xl font-semibold text-slate-950">四资产组合与风险规则</h2>
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <Card className="fams-card" title="四资产均衡组合">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {contract.portfolioTemplate.components.map((component) => (
                    <div key={component.assetClass} className="rounded-md bg-slate-50 p-3 text-center"><div className="text-xs text-slate-500">{ASSET_CLASS_LABELS[component.assetClass]}</div><div className="mt-1 text-xl font-semibold text-slate-950">{component.targetPercent}%</div></div>
                  ))}
                </div>
                <Divider />
                <label className="block text-sm font-medium text-slate-900">组合回撤复核线</label>
                <InputNumber className="mt-2 w-full" min={0.1} max={80} suffix="%" value={contract.riskRules.portfolio.drawdownReviewPercent ?? undefined} placeholder="激活前必填" disabled={!draft} onChange={(value) => updateRisk('drawdown', value)} />
                <div className="mt-2 text-xs text-slate-500">触发后要求复核配置和投资论点，不创建机械卖出单。</div>
              </Card>
              <Card className="fams-card" title="硬上限与新增风险门禁">
                <div className="grid gap-3 sm:grid-cols-2">
                  <InputNumber prefix="全局单标的" suffix="%" min={0.1} max={100} value={contract.riskRules.global.aggregateAssetCapPercent} disabled={!draft} onChange={(value) => updateRisk('globalAsset', value)} />
                  <InputNumber prefix="全局行业" suffix="%" min={0.1} max={100} value={contract.riskRules.global.industryCapPercent} disabled={!draft} onChange={(value) => updateRisk('globalIndustry', value)} />
                  <InputNumber prefix="红利单标的" suffix="%" min={0.1} max={100} value={contract.riskRules.dividendLowVol.singleAssetCapPercent} disabled={!draft} onChange={(value) => updateRisk('dividendAsset', value)} />
                  <InputNumber prefix="红利行业" suffix="%" min={0.1} max={100} value={contract.riskRules.dividendLowVol.industryCapPercent} disabled={!draft} onChange={(value) => updateRisk('dividendIndustry', value)} />
                  <InputNumber prefix="轮动单标的" suffix="%" min={0.1} max={100} value={contract.riskRules.rotationVolatility.singleAssetCapPercent} disabled={!draft} onChange={(value) => updateRisk('rotationAsset', value)} />
                  <InputNumber prefix="轮动现金下限" suffix="%" min={0} max={100} value={contract.riskRules.rotationVolatility.cashFloorPercent} disabled={!draft} onChange={(value) => updateRisk('rotationCash', value)} />
                </div>
                <Alert className="mt-4" type="info" showIcon message="既有超限仓位只告警；新的买入研究草案会被硬门禁阻断。" />
              </Card>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="evaluation-heading">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="fams-eyebrow">真实持仓评估</div><h2 id="evaluation-heading" className="mb-0 mt-2 text-xl font-semibold text-slate-950">当前敞口与政策差异</h2></div>{evaluation && <Tag color={evaluation.status === 'within_policy' ? 'success' : 'warning'}>{evaluation.status}</Tag>}</div>
            {evaluation ? (
              <>
                <Descriptions className="mt-5" bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
                  <Descriptions.Item label="总资产">{money(evaluation.totals.totalValue)}</Descriptions.Item>
                  <Descriptions.Item label="独立备用现金">{money(evaluation.totals.reserveCashValue)} · {evaluation.totals.reserveCashPercent.toFixed(2)}%</Descriptions.Item>
                  <Descriptions.Item label="已归类可投资资产">{money(evaluation.totals.assignedInvestedValue)}</Descriptions.Item>
                  <Descriptions.Item label="政策可投资基数">{money(evaluation.totals.policyInvestableValue)}</Descriptions.Item>
                </Descriptions>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {evaluation.buckets.map((bucket) => (
                    <div key={bucket.strategyFamily} className="rounded-md border border-slate-200 p-4">
                      <div className="flex items-center justify-between"><span className="font-medium text-slate-950">{FAMILY_LABELS[bucket.strategyFamily]}</span><Tag color={bucket.status === 'within_warning_band' ? 'success' : 'warning'}>{bucket.status}</Tag></div>
                      <Progress className="mt-3" percent={Math.min(100, bucket.currentPercent)} success={{ percent: Math.min(bucket.targetPercent, bucket.currentPercent) }} format={() => `${bucket.currentPercent.toFixed(1)}%`} />
                      <div className="mt-2 text-xs text-slate-500">目标 {bucket.targetPercent}% · 警示 {bucket.warningBand.minPercent ?? '--'}% 至 {bucket.warningBand.maxPercent ?? '--'}%</div>
                    </div>
                  ))}
                </div>
                <div className="mt-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="mb-0 text-base font-semibold text-slate-950">行业敞口</h3>
                    <Tooltip title="全局口径汇总全部已知行业持仓；红利低波口径只汇总该策略的持仓。缺少行业事实的标的不会被伪造聚合。">
                      <span className="cursor-help text-xs text-slate-500">两种上限口径 <InfoCircleOutlined /></span>
                    </Tooltip>
                  </div>
                  {evaluation.industryExposures.length > 0 ? (
                    <Table
                      size="small"
                      columns={industryColumns}
                      dataSource={evaluation.industryExposures}
                      rowKey={(row) => `${row.scope}-${row.strategyFamily || 'all'}-${row.industry}`}
                      pagination={false}
                      scroll={{ x: 680 }}
                    />
                  ) : (
                    <Alert type="warning" showIcon message="当前没有可用的行业事实，行业上限尚不可完整评估。" />
                  )}
                </div>
                {evaluation.warnings.length > 0 && <Alert className="mt-5" type="warning" showIcon message={`${evaluation.warnings.length} 项政策提示`} description={<ul className="mb-0 mt-2 pl-5">{evaluation.warnings.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul>} />}
                <Table className="mt-5" columns={positionColumns} dataSource={evaluation.positions} rowKey="positionId" pagination={{ pageSize: 8 }} scroll={{ x: 860 }} />
              </>
            ) : <Alert className="mt-5" type="info" showIcon message="保存或激活政策后生成真实持仓评估。" />}
          </section>
        </>
      ) : (
        <div className="fams-empty-state"><div><div className="font-semibold text-slate-950">先建立投资政策草案</div><div className="mt-1 text-sm text-slate-600">默认三桶目标为 50/30/20，备用现金和警示区间需要由你填写。</div></div><Button type="primary" onClick={() => void createDraft()}>建立草案</Button></div>
      )}

      <Alert type="error" showIcon message="交易边界保持锁定" description="正式交易、订单创建和自动交易均未开放。投资政策只控制研究、告警和人工计划草案。" />

      <Modal title={overridePosition ? `覆盖 ${overridePosition.name} 的规则` : '单标的规则'} open={Boolean(overridePosition)} onCancel={() => setOverridePosition(null)} onOk={() => void saveOverride()} okText="写入草案" confirmLoading={loading}>
        <div className="space-y-4">
          <label className="block"><span className="text-sm font-medium text-slate-900">单标的仓位上限</span><InputNumber className="mt-2 w-full" min={0.1} max={100} suffix="%" value={overrideCap ?? undefined} onChange={setOverrideCap} /></label>
          <label className="block"><span className="text-sm font-medium text-slate-900">止损模式</span><select className="mt-2 h-10 w-full rounded-md border border-slate-300 px-3" value={overrideStopMode} onChange={(event) => setOverrideStopMode(event.target.value as typeof overrideStopMode)}><option value="inherit">继承策略规则</option><option value="model">使用策略模型</option><option value="fixed_loss_percent">固定损失百分比</option></select></label>
          {overrideStopMode === 'fixed_loss_percent' && <label className="block"><span className="text-sm font-medium text-slate-900">固定损失百分比</span><InputNumber className="mt-2 w-full" min={0.1} max={80} suffix="%" value={overrideStopLoss ?? undefined} onChange={setOverrideStopLoss} /></label>}
          <label className="block"><span className="text-sm font-medium text-slate-900">覆盖理由</span><Input.TextArea className="mt-2" rows={3} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="必填；该理由会进入审计记录" /></label>
        </div>
      </Modal>
    </div>
  )
}
