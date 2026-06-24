import assert from 'node:assert/strict'

const baseUrl = process.env.FAMS_API_URL || 'http://localhost:4000'
const userId = process.env.FAMS_USER_ID || 'default'

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  assert.equal(response.ok, true, `${path} returned ${response.status}: ${text}`)
  return body as T
}

type Position = {
  id: string
  currentPrice?: number
  marketValue?: number
  costBasis?: number
  unrealizedPnl?: number
  unrealizedPnlPercent?: number
  stopLoss?: number | null
  takeProfit?: number | null
  asset: { symbol: string; name: string; type: string }
}

type Alert = {
  id: string
  title: string
  message?: string
  assetSymbol?: string
  status: string
}

function getReturnPercent(position: Position): number {
  if (typeof position.unrealizedPnlPercent === 'number') return position.unrealizedPnlPercent
  const costBasis = position.costBasis || 0
  if (costBasis > 0 && typeof position.unrealizedPnl === 'number') return (position.unrealizedPnl / costBasis) * 100
  if (costBasis > 0 && typeof position.marketValue === 'number') return ((position.marketValue - costBasis) / costBasis) * 100
  throw new Error(`Position ${position.asset.symbol} does not have enough PnL data for return-percent alert verification`)
}

async function main() {
  const positionsResult = await requestJson<{ data: Position[] }>(`/api/v1/positions?userId=${userId}&status=open&limit=100`)
  const position = positionsResult.data.find((item) => (
    item.asset.type !== 'cash' &&
    typeof item.currentPrice === 'number' &&
    item.currentPrice > 0 &&
    (item.costBasis || 0) > 0
  ))
  assert.ok(position, 'Need at least one open non-cash position with currentPrice and costBasis')

  const original = {
    stopLoss: position.stopLoss ?? null,
    takeProfit: position.takeProfit ?? null,
  }
  const currentReturnPercent = getReturnPercent(position)
  const stopLoss = Number((currentReturnPercent + 0.01).toFixed(2))
  const alertsBefore = await requestJson<Alert[]>(`/api/v1/alerts?userId=${userId}&status=active&type=risk`)
  const existingAlertIds = new Set(alertsBefore.map((alert) => alert.id))

  try {
    const updated = await requestJson<Position>(`/api/v1/positions/${position.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stopLoss, takeProfit: null }),
    })
    assert.equal(updated.stopLoss, stopLoss, 'stopLoss return-percent threshold should be saved on position')
    assert.equal(updated.takeProfit, null, 'takeProfit should be clearable')

    const alertedSymbols = await requestJson<string[]>('/api/v1/alerts/risk-check', {
      method: 'POST',
      body: JSON.stringify({ userId, refreshPrices: false }),
    })
    assert.ok(alertedSymbols.includes(position.asset.symbol), `Expected ${position.asset.symbol} in alerted symbols`)

    const alerts = await requestJson<Alert[]>(`/api/v1/alerts?userId=${userId}&status=active&type=risk`)
    const stopLossAlert = alerts.find((alert) => (
      alert.assetSymbol === position.asset.symbol &&
      alert.title === '触及止损线' &&
      alert.status === 'active' &&
      (alert.message || '').includes('收益率')
    ))
    assert.ok(stopLossAlert, `Expected active return-percent stop-loss alert for ${position.asset.symbol}`)

    console.log(JSON.stringify({
      ok: true,
      symbol: position.asset.symbol,
      currentPrice: position.currentPrice,
      currentReturnPercent,
      stopLoss,
      alertedSymbols,
    }, null, 2))
  } finally {
    await requestJson(`/api/v1/positions/${position.id}`, {
      method: 'PATCH',
      body: JSON.stringify(original),
    })
    const alertsAfter = await requestJson<Alert[]>(`/api/v1/alerts?userId=${userId}&status=active&type=risk`)
    await Promise.all(alertsAfter
      .filter((alert) => (
        !existingAlertIds.has(alert.id) &&
        alert.assetSymbol === position.asset.symbol &&
        alert.title === '触及止损线'
      ))
      .map((alert) => requestJson(`/api/v1/alerts/${alert.id}`, { method: 'DELETE' }))
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
