type DraftOrder = Record<string, any>
type AssetDraft = { symbol: string; grid: { mode?: string; orders?: DraftOrder[]; derivation?: any; constraints?: any; blockers?: string[] } }

const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))]

function orderBlockers(order: DraftOrder) {
  const trigger = order.triggerCondition || {}
  return unique([...(Array.isArray(trigger.blockers) ? trigger.blockers : []), trigger.blocker])
}

function downgrade(order: DraftOrder, status: string, blocker: string) {
  const blockers = unique([...orderBlockers(order), blocker])
  const trigger = {
    ...(order.triggerCondition || {}),
    activationStatus: status,
    effectiveStatus: status,
    blocker,
    blockers,
    consumesImmediateCashBeforeFill: false,
  }
  return {
    ...order,
    status,
    activationStatus: status,
    actionability: status === 'manual_confirmation_required' ? 'manual_confirmation_required' : 'conditional',
    conflictStatus: status === 'manual_confirmation_required' ? order.conflictStatus : 'not_active',
    triggerCondition: trigger,
  }
}

export function finalizeVolatilityDraftSafety(gridDraft: any, options: { singleConfirmationMode?: boolean } = {}) {
  if (gridDraft?.mode !== 'downtrend_defensive') return gridDraft
  try {
    const draft = structuredClone(gridDraft)
    let downgraded = 0
    draft.orders = (draft.orders || []).map((raw: DraftOrder) => {
      let order = raw
      const trigger = order.triggerCondition || {}
      const status = order.activationStatus || order.status
      if (status !== 'active') return order
      const blockers = orderBlockers(order)
      if (blockers.length > 0) {
        downgraded += 1
        return downgrade(order, 'dormant', blockers[0])
      }
      if (order.conflictStatus && order.conflictStatus !== 'none') {
        downgraded += 1
        return downgrade(order, options.singleConfirmationMode ? 'dormant' : 'manual_confirmation_required', 'external_order_conflict')
      }
      if (trigger.effectiveDisposition) {
        downgraded += 1
        return downgrade(order, 'dormant', 'effective_disposition_not_active')
      }
      const quoteAgeSeconds = Number(trigger.quote?.ageSeconds)
      const livePrice = Number(trigger.quote?.livePrice)
      if (trigger.quote?.fresh !== true
        || trigger.quote?.ageSeconds === null
        || trigger.quote?.ageSeconds === undefined
        || !Number.isFinite(quoteAgeSeconds)
        || quoteAgeSeconds < 0
        || quoteAgeSeconds > 120
        || !Number.isFinite(livePrice)
        || livePrice <= 0) {
        downgraded += 1
        return downgrade(order, options.singleConfirmationMode ? 'dormant' : 'manual_confirmation_required', 'fresh_quote_required')
      }
      const price = Number(order.price)
      const marketableNow = order.side === 'buy' ? price >= livePrice : price <= livePrice
      if (trigger.marketableNow === true || marketableNow) {
        downgraded += 1
        return downgrade(order, options.singleConfirmationMode ? 'dormant' : 'manual_confirmation_required', 'marketable_now')
      }
      if (order.side === 'buy' && trigger.orderRole === 'capacity_build') {
        const rawDistanceAtr = trigger.reachability?.distanceAtr
        const distanceAtr = Number(rawDistanceAtr)
        if (rawDistanceAtr === null || rawDistanceAtr === undefined || !Number.isFinite(distanceAtr)) {
          downgraded += 1
          return downgrade(order, 'dormant', 'reachability_unknown')
        }
        if (distanceAtr > 3) {
          downgraded += 1
          return downgrade(order, 'dormant', 'distance_above_3_atr')
        }
      }
      order = {
        ...order,
        triggerCondition: {
          ...trigger,
          effectiveStatus: 'active',
          blockers: [],
          consumesImmediateCashBeforeFill: order.side === 'buy',
        },
      }
      return order
    })
    draft.derivation = {
      ...(draft.derivation || {}),
      finalSafetyValidation: { status: 'passed', downgraded, checkedOrders: draft.orders.length },
    }
    return draft
  } catch (error) {
    const draft = structuredClone(gridDraft || {})
    draft.orders = (draft.orders || []).map((order: DraftOrder) => downgrade(order, 'dormant', 'final_safety_validator_failed'))
    draft.blockers = unique([...(draft.blockers || []), 'final_safety_validator_failed'])
    draft.derivation = {
      ...(draft.derivation || {}),
      finalSafetyValidation: {
        status: 'failed_closed',
        failure: error instanceof Error ? error.message : String(error),
      },
    }
    return draft
  }
}

export interface PortfolioDraftBudgetInput {
  principalLimit: number
  cashSpendLimit: number
}

export function compileVolatilityPortfolioBudget(assetDrafts: AssetDraft[], input: PortfolioDraftBudgetInput) {
  const assets = structuredClone(assetDrafts)
  const principalLimit = Number.isFinite(input.principalLimit) ? Math.max(0, input.principalLimit) : 0
  const cashSpendLimit = Number.isFinite(input.cashSpendLimit) ? Math.max(0, input.cashSpendLimit) : 0
  const eligibleAssets = assets.filter((asset) => asset.grid?.mode === 'downtrend_defensive')
  const activeBuys = () => eligibleAssets.flatMap((asset) => (asset.grid.orders || [])
    .filter((order) => order.side === 'buy' && (order.activationStatus || order.status) === 'active')
    .map((order) => ({ asset, order })))
  const feeFor = (asset: AssetDraft) => Number(asset.grid?.derivation?.cashGate?.feeReserve
    ?? asset.grid?.constraints?.feeReserve
    ?? 0)
  const totals = () => {
    const rows = activeBuys()
    const principal = rows.reduce((sum, row) => sum + Number(row.order.amount || 0), 0)
    const symbolsWithBuys = new Set(rows.map((row) => row.asset.symbol))
    const feeReserve = eligibleAssets.reduce((sum, asset) => sum + (symbolsWithBuys.has(asset.symbol) ? feeFor(asset) : 0), 0)
    return { principal, feeReserve, spend: principal + feeReserve }
  }
  const sleepOrder = activeBuys().sort((left, right) => {
    const leftDistance = Number(left.order.triggerCondition?.reachability?.distanceAtr ?? Number.NEGATIVE_INFINITY)
    const rightDistance = Number(right.order.triggerCondition?.reachability?.distanceAtr ?? Number.NEGATIVE_INFINITY)
    return rightDistance - leftDistance
      || left.asset.symbol.localeCompare(right.asset.symbol)
      || Number(left.order.level || 0) - Number(right.order.level || 0)
  })
  const slept: Array<{ symbol: string; level: number; amount: number; distanceAtr: number | null }> = []
  let current = totals()
  while ((current.principal > principalLimit + 1e-8 || current.spend > cashSpendLimit + 1e-8) && sleepOrder.length > 0) {
    const next = sleepOrder.shift()!
    const index = (next.asset.grid.orders || []).findIndex((order) => order === next.order)
    if (index < 0) continue
    const downgraded = downgrade(next.order, 'dormant', 'portfolio_budget_compiled_out')
    next.asset.grid.orders![index] = downgraded
    slept.push({
      symbol: next.asset.symbol,
      level: Number(next.order.level || 0),
      amount: Number(next.order.amount || 0),
      distanceAtr: Number.isFinite(Number(next.order.triggerCondition?.reachability?.distanceAtr))
        ? Number(next.order.triggerCondition.reachability.distanceAtr)
        : null,
    })
    current = totals()
  }
  const summary = {
    principalLimit: Number(principalLimit.toFixed(2)),
    cashSpendLimit: Number(cashSpendLimit.toFixed(2)),
    activeBuyPrincipal: Number(current.principal.toFixed(2)),
    feeReserve: Number(current.feeReserve.toFixed(2)),
    immediateCashCommitment: Number(current.spend.toFixed(2)),
    remainingPrincipalBudget: Number(Math.max(0, principalLimit - current.principal).toFixed(2)),
    remainingCashSpendBudget: Number(Math.max(0, cashSpendLimit - current.spend).toFixed(2)),
    slept,
    ordering: 'distanceAtr_desc,symbol_asc,level_asc',
    status: current.principal <= principalLimit + 1e-8 && current.spend <= cashSpendLimit + 1e-8 ? 'passed' : 'failed_closed',
  }
  return { assets, summary }
}
