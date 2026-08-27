import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, App as AntApp, Button, Card, Checkbox, Descriptions, Input, Modal, Space, Tag } from 'antd'
import { EditOutlined, SafetyCertificateOutlined, UploadOutlined } from '@ant-design/icons'
import { API_BASE } from '../../config/api'

export type ScreenshotCaptureEvent = {
  type: 'saved' | 'extracted' | 'confirmed'
  captureId: string
  filename?: string
  rowCount?: number
}

type ScreenshotCapturePanelProps = {
  userId?: string
  conversationId?: string
  compact?: boolean
  onEvent?: (event: ScreenshotCaptureEvent) => void
  onConfirmed?: (event: ScreenshotCaptureEvent) => void
}

type ScreenshotPreview = {
  capture: {
    id: string
    documentType: string
    status: string
    warnings: string[]
    extraction?: { missingHoldings?: Array<Record<string, unknown>> }
  }
  rows: Array<{
    id: string
    rowIndex: number
    rowType: string
    status: string
    confidence: number
    fields: Record<string, unknown>
    diff: Record<string, unknown>
  }>
  confirmationBoundary: {
    humanConfirmationRequired: true
    missingHoldingsWillNeverBeClosed: true
    createsBrokerOrder: false
  }
  accountReconciliation: null | {
    status: 'exact' | 'warning' | 'unavailable'
    rowMarketValueSum: number
    brokerStockMarketValue: number | null
    stockMarketValueVariance: number | null
    availableCash: number | null
    calculatedTotalAssets: number | null
    brokerTotalAssets: number | null
    totalAssetsVariance: number | null
    ledgerBasis: 'holding_rows_plus_available_cash'
  }
}

type VisionCaptureStatus = {
  configured: boolean
  model: string | null
  consentRequiredPerUpload: true
  manualStructuredInputAvailable: true
  secretsRedacted: true
}

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const captureFieldLabels: Record<string, string> = {
  symbol: '证券代码', name: '名称', quantity: '数量', avgCost: '平均成本', currentPrice: '当前价', marketValue: '市值',
  type: '成交类型', side: '方向', price: '成交价', fee: '费用', executedAt: '成交时间', broker: '券商', confirmationNo: '成交编号',
  status: '委托状态', filledQuantity: '已成交数量', limitPrice: '委托价', submittedAt: '委托时间', externalOrderId: '外部委托号', validUntil: '有效期',
  availableCash: '可用金额', cashBalance: '资金余额', withdrawableCash: '可取金额', stockMarketValue: '股票市值', totalAssets: '总资产',
  holdingPnl: '持仓盈亏', dayPnl: '当日盈亏', dayPnlPct: '当日盈亏比（%）',
}

function captureFieldKeys(rowType: string, fields: Record<string, unknown>) {
  const defaults = rowType === 'account_summary'
    ? ['availableCash', 'cashBalance', 'withdrawableCash', 'stockMarketValue', 'totalAssets', 'holdingPnl', 'dayPnl', 'dayPnlPct']
    : rowType === 'holding'
    ? ['symbol', 'name', 'quantity', 'avgCost', 'currentPrice', 'marketValue']
    : rowType === 'trade'
      ? ['symbol', 'type', 'quantity', 'price', 'fee', 'executedAt', 'broker', 'confirmationNo']
      : ['symbol', 'side', 'status', 'quantity', 'filledQuantity', 'limitPrice', 'submittedAt', 'externalOrderId', 'validUntil']
  return Array.from(new Set([...defaults, ...Object.keys(fields)]))
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`)
  return payload as T
}

export function ScreenshotCapturePanel({
  userId = 'default',
  conversationId,
  compact = false,
  onEvent,
  onConfirmed,
}: ScreenshotCapturePanelProps) {
  const { message } = AntApp.useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File>()
  const [captureId, setCaptureId] = useState<string>()
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<ScreenshotPreview>()
  const [draftFields, setDraftFields] = useState<Record<string, Record<string, unknown>>>({})
  const [visionStatus, setVisionStatus] = useState<VisionCaptureStatus>()

  const applyPreview = useCallback((next: ScreenshotPreview) => {
    setPreview(next)
    setDraftFields(Object.fromEntries(next.rows.map((row) => [row.id, { ...row.fields }])))
  }, [])

  useEffect(() => {
    void jsonRequest<VisionCaptureStatus>('/api/v1/captures/vision/status')
      .then(setVisionStatus)
      .catch(() => setVisionStatus({
        configured: false,
        model: null,
        consentRequiredPerUpload: true,
        manualStructuredInputAvailable: true,
        secretsRedacted: true,
      }))
  }, [])

  const resetForFile = (next?: File) => {
    if (next && (!ACCEPTED_TYPES.has(next.type) || next.size > MAX_FILE_SIZE)) {
      message.error('仅支持 PNG、JPEG、WebP，文件不得超过 10MB')
      setFile(undefined)
    } else {
      setFile(next)
    }
    setCaptureId(undefined)
    setPreview(undefined)
    setDraftFields({})
    setConsent(false)
  }

  const upload = async () => {
    if (captureId) return captureId
    if (!file) throw new Error('请先选择截图')
    const form = new FormData()
    form.append('userId', userId)
    if (conversationId) form.append('conversationId', conversationId)
    form.append('screenshot', file)
    const result = await jsonRequest<{ capture: { id: string } }>('/api/v1/captures/screenshots', { method: 'POST', body: form })
    setCaptureId(result.capture.id)
    return result.capture.id
  }

  const saveOnly = async () => {
    if (!file || loading) return
    setLoading(true)
    try {
      const id = await upload()
      const event = { type: 'saved' as const, captureId: id, filename: file.name }
      onEvent?.(event)
      message.success(`截图已私有保存：${id}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '截图保存失败')
    } finally {
      setLoading(false)
    }
  }

  const extract = async () => {
    if (!file || !consent || loading || visionStatus?.configured !== true) return
    setLoading(true)
    try {
      const id = await upload()
      const next = await jsonRequest<ScreenshotPreview>(`/api/v1/captures/screenshots/${encodeURIComponent(id)}/vision-extract`, {
        method: 'POST',
        body: JSON.stringify({ userId, consentGranted: true }),
      })
      applyPreview(next)
      onEvent?.({ type: 'extracted', captureId: id, filename: file.name, rowCount: next.rows.length })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '截图识别失败')
    } finally {
      setLoading(false)
    }
  }

  const updateDraftField = (rowId: string, key: string, value: string, original: unknown) => {
    const nextValue = typeof original === 'number' ? value.trim() === '' ? '' : Number(value) : value
    setDraftFields((current) => ({ ...current, [rowId]: { ...(current[rowId] || {}), [key]: nextValue } }))
  }

  const saveRow = async (row: ScreenshotPreview['rows'][number], ignored = false) => {
    if (!preview || loading) return
    setLoading(true)
    try {
      const fields = draftFields[row.id] || row.fields
      const next = await jsonRequest<ScreenshotPreview>(
        `/api/v1/captures/screenshots/${encodeURIComponent(preview.capture.id)}/rows/${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            userId,
            fields,
            confidence: ignored ? row.confidence : 1,
            fieldConfidence: ignored ? undefined : Object.fromEntries(Object.keys(fields).map((key) => [key, 1])),
            ignored,
            correctedBy: 'fams_screenshot_panel_user',
          }),
        },
      )
      applyPreview(next)
      message.success(ignored ? '该行已忽略，不会写入台账' : '修改已保存并重新校验')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存修改失败')
    } finally {
      setLoading(false)
    }
  }

  const confirmRows = async () => {
    if (!preview || loading) return
    setLoading(true)
    try {
      const readyRows = preview.rows.filter((row) => row.status === 'ready')
      const result = await jsonRequest<{ results: unknown[]; missingHoldingsClosed: number }>(
        `/api/v1/captures/screenshots/${encodeURIComponent(preview.capture.id)}/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({ userId, rowIds: readyRows.map((row) => row.id), confirmed: true, confirmedBy: 'fams_screenshot_panel_user' }),
        },
      )
      const event = { type: 'confirmed' as const, captureId: preview.capture.id, filename: file?.name, rowCount: result.results.length }
      message.success(`已确认 ${result.results.length} 行；未自动关闭任何缺失持仓。`)
      onEvent?.(event)
      onConfirmed?.(event)
      resetForFile(undefined)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '确认写入失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={compact ? 'text-xs text-slate-600' : 'space-y-4'} data-testid="screenshot-capture-panel" aria-label="截图台账导入">
      {!compact ? (
        <Alert
          type="info"
          showIcon
          icon={<SafetyCertificateOutlined />}
          message="先私有保存，再由你决定是否识别"
          description="视觉同意只对当前选中的这一份文件有效；确认前不写入持仓、成交或委托台账。"
        />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label="选择持仓、成交或委托截图"
        onChange={(event) => {
          resetForFile(event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size={compact ? 'small' : 'middle'} icon={<UploadOutlined />} onClick={() => inputRef.current?.click()} disabled={loading}>
          选择持仓/成交/委托截图
        </Button>
        {file ? <Tag color="blue" title={file.name} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</Tag> : <span>支持 PNG、JPEG、WebP，最大 10MB</span>}
        {visionStatus ? <Tag color={visionStatus.configured ? 'green' : 'orange'}>{visionStatus.configured ? `视觉识别可用：${visionStatus.model}` : '视觉识别未配置'}</Tag> : null}
      </div>
      {file ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <Checkbox checked={consent} onChange={(event) => setConsent(event.target.checked)}>
            我明确同意仅本次把该截图发送给已配置的 FAMS 视觉模型识别
          </Checkbox>
          <Space wrap>
            <Button size="small" onClick={saveOnly} loading={loading}>仅私有保存</Button>
            <Button size="small" type="primary" disabled={!consent || visionStatus?.configured !== true} onClick={extract} loading={loading}>
              同意并识别，先看预览
            </Button>
          </Space>
          {captureId ? <div className="break-all text-slate-500">私有台账编号：{captureId}</div> : null}
          {visionStatus?.configured === false ? <div className="text-amber-700">当前未配置 FAMS 视觉模型；仍可仅私有保存，再由 Codex 或人工提交结构化字段。</div> : null}
        </div>
      ) : null}

      <Modal
        title="截图识别预览（确认前不写入台账）"
        open={Boolean(preview)}
        width={760}
        confirmLoading={loading}
        okText="确认写入可用行"
        cancelText="返回检查"
        okButtonProps={{ disabled: !preview?.rows.some((row) => row.status === 'ready') }}
        onOk={confirmRows}
        onCancel={() => setPreview(undefined)}
      >
        {preview ? (
          <div className="space-y-3">
            <Alert
              type="info"
              showIcon
              message="截图缺失的现有持仓只提示差异，绝不自动减仓或平仓"
              description={`文档类型：${preview.capture.documentType}；可确认 ${preview.rows.filter((row) => row.status === 'ready').length}/${preview.rows.length} 行；不会创建券商订单。`}
            />
            {preview.accountReconciliation ? (
              <Alert
                type={preview.accountReconciliation.status === 'exact' ? 'success' : 'warning'}
                showIcon
                message={preview.accountReconciliation.status === 'exact' ? '账户汇总与逐行持仓完全对平' : '账户汇总与逐行市值存在差额，按原图保留并提示'}
                description={(
                  <Descriptions size="small" column={{ xs: 1, sm: 2 }} className="mt-2">
                    <Descriptions.Item label="逐行股票市值">{preview.accountReconciliation.rowMarketValueSum.toFixed(2)}</Descriptions.Item>
                    <Descriptions.Item label="券商股票市值">{preview.accountReconciliation.brokerStockMarketValue?.toFixed(2) ?? '--'}</Descriptions.Item>
                    <Descriptions.Item label="市值差额">{preview.accountReconciliation.stockMarketValueVariance?.toFixed(2) ?? '--'}</Descriptions.Item>
                    <Descriptions.Item label="可用金额">{preview.accountReconciliation.availableCash?.toFixed(2) ?? '--'}</Descriptions.Item>
                    <Descriptions.Item label="逐行市值 + 可用金额">{preview.accountReconciliation.calculatedTotalAssets?.toFixed(2) ?? '--'}</Descriptions.Item>
                    <Descriptions.Item label="券商总资产">{preview.accountReconciliation.brokerTotalAssets?.toFixed(2) ?? '--'}</Descriptions.Item>
                    <Descriptions.Item label="总资产差额">{preview.accountReconciliation.totalAssetsVariance?.toFixed(2) ?? '--'}</Descriptions.Item>
                  </Descriptions>
                )}
              />
            ) : null}
            <div className="max-h-[52vh] space-y-2 overflow-y-auto">
              {preview.rows.map((row) => {
                const draft = draftFields[row.id] || row.fields
                return (
                  <Card key={row.id} size="small" title={`第 ${row.rowIndex + 1} 行｜${row.rowType}`} extra={<Tag color={row.status === 'ready' ? 'green' : row.status === 'ignored' ? 'default' : 'red'}>{row.status} / {Math.round(row.confidence * 100)}%</Tag>}>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {captureFieldKeys(row.rowType, draft).map((key) => (
                        <label key={key} className="text-xs text-slate-600">
                          <span className="mb-1 block">{captureFieldLabels[key] || key}</span>
                          <Input size="small" value={String(draft[key] ?? '')} disabled={row.status === 'ignored'} onChange={(event) => updateDraftField(row.id, key, event.target.value, row.fields[key])} />
                        </label>
                      ))}
                    </div>
                    {row.status !== 'ready' && row.status !== 'ignored' ? <div className="mt-2 text-xs text-red-600">需要修正：{JSON.stringify((row.diff as { issues?: unknown }).issues || [])}</div> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="small" type="primary" icon={<EditOutlined />} disabled={row.status === 'ignored'} onClick={() => saveRow(row)} loading={loading}>保存修改并重新校验</Button>
                      <Button size="small" danger disabled={row.status === 'ignored'} onClick={() => saveRow(row, true)} loading={loading}>忽略此行</Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  )
}
