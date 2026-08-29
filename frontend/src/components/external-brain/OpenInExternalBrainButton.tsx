import { useState } from 'react'
import { ExportOutlined, LoadingOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { ButtonProps } from 'antd'
import { openInExternalBrain, type PxHostBridgeResult, type PxHostRouteRequest } from '../../services/pxExternalBrainBridge'

type OpenInExternalBrainButtonProps = {
  entryId: 'chatbox' | 'daily-review' | 'operations'
  label: string
  request?: PxHostRouteRequest
  disabledReason?: string
  buttonType?: ButtonProps['type']
  size?: ButtonProps['size']
}

export function OpenInExternalBrainButton({ entryId, label, request, disabledReason, buttonType = 'default', size = 'middle' }: OpenInExternalBrainButtonProps) {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<PxHostBridgeResult>()
  const testId = `external-brain-${entryId}`
  const contextId = request?.routeIntent === 'graph'
    ? request.routePayload.graphId
    : request?.routeIntent === 'trace'
      ? request.routePayload.operationId
      : request?.routeIntent === 'source_detail'
        ? request.routePayload.sourceRef
        : ''

  const open = async () => {
    if (!request || pending) return
    setPending(true)
    setResult(undefined)
    try {
      setResult(await openInExternalBrain(request))
    } finally {
      setPending(false)
    }
  }

  const statusText = result?.userMessage ?? disabledReason
  return (
    <div
      className="inline-flex max-w-full flex-col items-start gap-1"
      data-testid={`${testId}-entry`}
      data-bridge-status={result?.status ?? (disabledReason ? 'invalid_context' : 'idle')}
      data-route-id={result?.routeId ?? ''}
      data-correlation-id={result?.correlationId ?? ''}
      data-ack-ms={result?.ackMs ?? ''}
      data-context-id={contextId}
    >
      <Button
        type={buttonType}
        size={size}
        icon={pending ? <LoadingOutlined /> : <ExportOutlined />}
        disabled={!request || pending}
        loading={pending}
        onClick={() => void open()}
        data-testid={`${testId}-button`}
        aria-label={label}
        title={disabledReason}
      >
        {label}
      </Button>
      {statusText ? (
        <span
          role="status"
          aria-live="polite"
          data-testid={`${testId}-status`}
          className={`max-w-[360px] text-xs leading-5 ${result?.ok ? 'text-emerald-700' : 'text-amber-700'}`}
        >
          {statusText}
        </span>
      ) : null}
    </div>
  )
}
