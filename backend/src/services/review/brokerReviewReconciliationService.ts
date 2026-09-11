import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'

export type BrokerReviewSession = 'open' | 'pre_close' | 'manual'

export interface BrokerReviewReconciliationInput {
  userId: string
  sessionType?: BrokerReviewSession
  holdingsCaptureId?: string
  tradesCaptureId?: string
  ordinaryOrdersCaptureId?: string
  conditionalOrdersCaptureId?: string
  zeroNewTradesConfirmed?: boolean
  now?: Date
}

type StrategyState = Record<string, any>

const ACTIVE_ORDER_STATUSES = new Set(['pending', 'submitted', 'partial', 'open', 'triggered'])
const CAPTURE_FRESHNESS_MS = 15 * 60 * 1000
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const defaultStatePath = resolve(repoRoot, '波动交易工作流迁移-20260908/strategy_state.json')

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}

function finite(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function decimal(value: unknown, digits = 4): string | null {
  const number = finite(value)
  if (number === null) return null
  return number.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function shanghaiDate(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
}

function captureTime(capture: any): Date | null {
  const value = capture?.capturedAt || capture?.confirmedAt || capture?.createdAt
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function captureFreshness(capture: any, now: Date) {
  const asOf = captureTime(capture)
  if (!asOf) return { status: 'missing_time' as const, asOf: null, ageSeconds: null, fresh: false }
  const ageMs = Math.max(0, now.getTime() - asOf.getTime())
  return {
    status: ageMs <= CAPTURE_FRESHNESS_MS ? 'fresh' as const : 'stale' as const,
    asOf: asOf.toISOString(),
    ageSeconds: Math.round(ageMs / 1000),
    fresh: ageMs <= CAPTURE_FRESHNESS_MS,
  }
}

function isAlipayFields(fields: Record<string, unknown>) {
  return String(fields.accountId || '').trim().toLowerCase() === 'alipay'
    || String(fields.valueBasis || '').toLowerCase() === 'market_value_total'
    || String(fields.amountBasis || '').toLowerCase() === 'total_position_value'
    || String(fields.broker || '').includes('支付宝')
}

function orderKind(capture: any, raw: Record<string, unknown>) {
  const explicit = String(raw.orderKind || raw.orderType || raw.category || '').toLowerCase()
  if (explicit.includes('condition') || explicit.includes('条件')) return 'conditional'
  if (String(capture?.documentType || '').toLowerCase().includes('conditional')) return 'conditional'
  return 'ordinary'
}

function priceTolerance(symbol: string) {
  return ['159851', '513770'].includes(symbol) ? 0.0005 : 0.005
}

class BrokerReviewReconciliationService {
  private captureMatchesRole(capture: any, role: 'holding' | 'trade' | 'ordinary' | 'conditional') {
    const documentType = String(capture?.documentType || '').toLowerCase()
    if (documentType.includes('fund') || documentType.includes('alipay') || documentType.includes('支付宝')) return false
    const expectedRowTypes = role === 'holding' ? ['holding'] : role === 'trade' ? ['trade'] : ['order', 'pending_order']
    const relevant = (capture?.rows || []).filter((row: any) => expectedRowTypes.includes(row.rowType) && row.status === 'confirmed')
    if (relevant.length === 0) return false
    const fields: Array<Record<string, unknown>> = relevant.map((row: any) => parseJson<Record<string, unknown>>(row.fieldsJson, {}))
    const accountFields: Array<Record<string, unknown>> = (capture?.rows || [])
      .filter((row: any) => row.rowType === 'account_summary' && row.status === 'confirmed')
      .map((row: any) => parseJson<Record<string, unknown>>(row.fieldsJson, {}))
    if ([...fields, ...accountFields].some(isAlipayFields)) return false
    if (role === 'holding') {
      return fields.some((item) => /^\d{6}$/.test(String(item.symbol || '')) && finite(item.quantity) !== null)
        || accountFields.some((item) => finite(item.stockMarketValue) !== null)
    }
    if (role === 'trade') return fields.some((item) => /^\d{6}$/.test(String(item.symbol || item.effectiveSymbol || '')))
    return fields.some((item) => orderKind(capture, item) === role)
  }

  private async loadStrategyState(): Promise<{ state: StrategyState | null; sourcePath: string; error: string | null }> {
    const sourcePath = process.env.FAMS_BROKER_STRATEGY_STATE_PATH || defaultStatePath
    try {
      const state = JSON.parse(await readFile(sourcePath, 'utf8')) as StrategyState
      return { state, sourcePath, error: null }
    } catch (error) {
      return { state: null, sourcePath, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async captureByRole(userId: string, captureId: string | undefined, role: 'holding' | 'trade' | 'ordinary' | 'conditional') {
    if (captureId) {
      const capture = await prisma.screenshotCapture.findFirst({
        where: { id: captureId, userId, status: { in: ['confirmed', 'partially_confirmed'] } },
        include: { rows: { include: { externalOrderObservation: true }, orderBy: { rowIndex: 'asc' } } },
      })
      if (!capture) throw new Error(`confirmed_${role}_capture_not_found:${captureId}`)
      if (!this.captureMatchesRole(capture, role)) throw new Error(`confirmed_${role}_capture_is_not_broker_${role}:${captureId}`)
      return capture
    }
    const rowTypes = role === 'holding' ? ['holding'] : role === 'trade' ? ['trade'] : ['order', 'pending_order']
    const candidates = await prisma.screenshotCapture.findMany({
      where: {
        userId,
        status: { in: ['confirmed', 'partially_confirmed'] },
        rows: { some: { rowType: { in: rowTypes }, status: 'confirmed' } },
      },
      include: { rows: { include: { externalOrderObservation: true }, orderBy: { rowIndex: 'asc' } } },
      orderBy: [{ confirmedAt: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    })
    return candidates.find((capture) => {
      return this.captureMatchesRole(capture, role)
    }) || null
  }

  private captureFacts(capture: any, state: StrategyState | null) {
    const accountRow = capture?.rows?.find((row: any) => row.rowType === 'account_summary' && row.status === 'confirmed')
    const accountFields = parseJson<Record<string, unknown>>(accountRow?.fieldsJson, {})
    const holdingRows = (capture?.rows || []).filter((row: any) => row.rowType === 'holding' && row.status === 'confirmed')
    const captured = holdingRows.map((row: any) => {
      const fields = parseJson<Record<string, unknown>>(row.fieldsJson, {})
      const quantity = finite(fields.quantity)
      const available = finite(fields.availableQuantity ?? fields.sellableQuantity ?? fields.available)
      const frozen = finite(fields.frozenQuantity ?? fields.frozenSecurityQuantity)
      const unavailable = finite(fields.unavailableQuantity ?? fields.t1UnavailableQuantity)
      return {
        symbol: String(fields.symbol || row.assetId || ''),
        name: String(fields.name || ''),
        quantity: decimal(quantity, 4),
        sellableQuantity: decimal(available ?? (quantity !== null && frozen !== null ? quantity - frozen : null), 4),
        frozenQuantity: decimal(frozen ?? (quantity !== null && available !== null ? quantity - available : null), 4),
        unavailableQuantity: decimal(unavailable, 4),
        quantityBalanceStatus: fields.quantityBalanceStatus || 'additive',
        avgCost: decimal(fields.avgCost, 4),
        screenshotPrice: decimal(fields.currentPrice, 4),
        marketValue: decimal(fields.marketValue, 2),
        authority: 'screenshot_fact',
        sourceRef: `screenshot_capture:${capture.id}:row:${row.rowIndex}`,
      }
    }).filter((item: any) => item.symbol)
    if (captured.length > 0) {
      return {
        positions: captured,
        account: {
          cashBalance: decimal(accountFields.cashBalance ?? accountFields.availableCash, 2),
          availableCash: decimal(accountFields.availableCash, 2),
          withdrawableCash: decimal(accountFields.withdrawableCash, 2),
          securitiesMarketValue: decimal(accountFields.stockMarketValue ?? accountFields.investmentMarketValue, 2),
          totalAssets: decimal(accountFields.totalAssets, 2),
          authority: 'screenshot_fact',
          sourceRef: accountRow ? `screenshot_capture:${capture.id}:row:${accountRow.rowIndex}` : null,
        },
        fallbackUsed: false,
      }
    }
    return {
      positions: (state?.positions || []).map((position: any) => ({
        symbol: String(position.symbol),
        name: String(position.name || ''),
        quantity: decimal(position.snapshot?.quantity, 4),
        sellableQuantity: decimal(position.snapshot?.sellable_quantity, 4),
        frozenQuantity: decimal(position.snapshot?.frozen_security_quantity, 4),
        avgCost: decimal(position.snapshot?.broker_displayed_unit_cost, 4),
        screenshotPrice: decimal(position.snapshot?.last_price, 4),
        marketValue: decimal(position.snapshot?.market_value, 2),
        authority: 'screenshot_fact',
        sourceRef: position.snapshot?.source_id || 'strategy_state:account_snapshot',
        isLive: false,
      })),
      account: {
        cashBalance: decimal(state?.account_snapshot?.cash_balance, 2),
        availableCash: decimal(state?.account_snapshot?.available_cash, 2),
        withdrawableCash: decimal(state?.account_snapshot?.withdrawable_cash, 2),
        securitiesMarketValue: decimal(state?.account_snapshot?.securities_market_value, 2),
        totalAssets: decimal(state?.account_snapshot?.account_total_assets, 2),
        authority: 'screenshot_fact',
        sourceRef: state?.account_snapshot?.source_id || null,
        isLive: false,
      },
      fallbackUsed: true,
    }
  }

  private observedOrders(capture: any, kind: 'ordinary' | 'conditional') {
    return (capture?.rows || []).flatMap((row: any) => {
      if (!['order', 'pending_order'].includes(row.rowType) || row.status !== 'confirmed') return []
      const fields = parseJson<Record<string, unknown>>(row.fieldsJson, {})
      if (orderKind(capture, fields) !== kind) return []
      const observed = row.externalOrderObservation
      const status = String(observed?.status || fields.status || 'open').toLowerCase()
      if (!ACTIVE_ORDER_STATUSES.has(status)) return []
      return [{
        id: observed?.id || row.id,
        externalOrderId: observed?.externalOrderId || fields.externalOrderId || null,
        symbol: String(fields.symbol || ''),
        side: String(observed?.side || fields.side || '').toUpperCase(),
        price: decimal(observed?.limitPrice ?? fields.limitPrice ?? fields.price, 4),
        quantity: decimal(observed?.quantity ?? fields.quantity, 4),
        filledQuantity: decimal(observed?.filledQuantity ?? fields.filledQuantity ?? 0, 4),
        status,
        orderKind: kind,
        authority: 'screenshot_fact',
        sourceRef: `screenshot_capture:${capture.id}:row:${row.rowIndex}`,
      }]
    })
  }

  private matchOrder(orders: any[], proposal: any) {
    const targetPrice = finite(proposal.limit_price ?? proposal.price)
    const targetQuantity = finite(proposal.quantity ?? proposal.max_quantity)
    return orders.find((order) => {
      if (order.symbol !== String(proposal.symbol) || order.side !== String(proposal.side).toUpperCase()) return false
      const observedPrice = finite(order.price)
      const observedQuantity = finite(order.quantity)
      const priceMatches = targetPrice === null || (observedPrice !== null && Math.abs(observedPrice - targetPrice) <= priceTolerance(order.symbol))
      const quantityMatches = targetQuantity === null || observedQuantity === targetQuantity
      return priceMatches && quantityMatches
    }) || null
  }

  async reconcile(input: BrokerReviewReconciliationInput) {
    await ensureUser(prisma, input.userId)
    const now = input.now || new Date()
    const { state, sourcePath, error: stateError } = await this.loadStrategyState()
    const [holdingsCapture, tradesCapture, ordinaryCapture, conditionalCapture, positions, transactions] = await Promise.all([
      this.captureByRole(input.userId, input.holdingsCaptureId, 'holding'),
      this.captureByRole(input.userId, input.tradesCaptureId, 'trade'),
      this.captureByRole(input.userId, input.ordinaryOrdersCaptureId, 'ordinary'),
      this.captureByRole(input.userId, input.conditionalOrdersCaptureId, 'conditional'),
      prisma.position.findMany({ where: { userId: input.userId, status: 'open' }, include: { asset: true } }),
      prisma.transaction.findMany({ where: { userId: input.userId }, include: { asset: true }, orderBy: { executedAt: 'desc' } }),
    ])
    const holdingFreshness = captureFreshness(holdingsCapture, now)
    const tradeFreshness = input.zeroNewTradesConfirmed
      ? { status: 'explicit_zero_confirmation' as const, asOf: now.toISOString(), ageSeconds: 0, fresh: true }
      : captureFreshness(tradesCapture, now)
    const ordinaryFreshness = captureFreshness(ordinaryCapture, now)
    const conditionalFreshness = captureFreshness(conditionalCapture, now)
    const ordersFullyReconciled = ordinaryFreshness.fresh && conditionalFreshness.fresh
    // A stale broker capture must not override a newer handoff snapshot. It is
    // still retained below as reconciliation evidence, while order readiness
    // remains blocked until a fresh capture arrives.
    const facts = this.captureFacts(holdingFreshness.fresh ? holdingsCapture : null, state)
    const holdingsFieldsComplete = !facts.fallbackUsed
      && facts.positions.length > 0
      && facts.account.availableCash !== null
      && facts.positions.every((item: any) => item.quantity !== null && item.sellableQuantity !== null)
    const requiredReady = holdingFreshness.fresh && tradeFreshness.fresh && holdingsFieldsComplete
    const stateBySymbol = new Map<string, any>((state?.positions || []).map((item: any) => [String(item.symbol), item] as const))
    const dbBySymbol = new Map(positions.map((item) => [item.asset.symbol, item]))
    const differences: any[] = []
    const rowMarketValueSum = facts.positions.reduce((sum: number, position: any) => sum + (finite(position.marketValue) || 0), 0)
    const headerMarketValue = finite(facts.account.securitiesMarketValue)
    if (headerMarketValue !== null && Math.abs(headerMarketValue - rowMarketValueSum) > 0.01) {
      differences.push({
        scope: 'market_value_rounding', severity: Math.abs(headerMarketValue - rowMarketValueSum) <= 1 ? 'info' : 'warning',
        expected: decimal(headerMarketValue, 2), actual: decimal(rowMarketValueSum, 2),
        message: '券商顶部股票市值与逐行持仓市值合计不一致；保留原始截图字段，不强行改写。', action: 'retain_broker_fields',
      })
    }
    for (const position of facts.positions.filter((item: any) => item.quantityBalanceStatus === 'broker_fields_not_additive_user_override')) {
      differences.push({
        scope: 'sellability_fields', symbol: position.symbol, severity: 'warning',
        message: '截图中的总持仓、可卖与冻结字段不是加总关系；按用户确认忽略冻结做策略容量，但下单前仍以券商可卖和查重结果为准。',
        action: 'manual_dedup_and_sellability_check',
      })
    }

    for (const [symbol, expected] of stateBySymbol) {
      const current = dbBySymbol.get(symbol)
      const expectedQuantity = finite((expected as any).snapshot?.quantity)
      if (!current) {
        differences.push({ scope: 'position', symbol, severity: 'warning', expected: decimal(expectedQuantity, 4), actual: null, message: '交接快照存在该持仓，但本地当前持仓缺失。', action: 'review_only' })
      } else if (expectedQuantity !== null && Math.abs(current.quantity - expectedQuantity) > 0.0001) {
        differences.push({ scope: 'position', symbol, severity: 'warning', expected: decimal(expectedQuantity, 4), actual: decimal(current.quantity, 4), message: '本地持仓与交接快照不一致；不得通过重放历史成交修正。', action: 'confirm_new_snapshot' })
      }
    }
    const brokerCash = positions.find((position) => position.asset.type === 'cash' && !`${position.tags} ${position.labels}`.includes('支付宝'))
    const expectedCash = finite(state?.account_snapshot?.available_cash)
    if (brokerCash && expectedCash !== null && Math.abs(Number(brokerCash.marketValue ?? brokerCash.quantity) - expectedCash) > 0.01) {
      differences.push({ scope: 'cash', severity: 'warning', expected: decimal(expectedCash, 2), actual: decimal(brokerCash.marketValue ?? brokerCash.quantity, 2), message: '本地券商现金与交接快照不一致，以新资金持仓截图为准。', action: 'confirm_new_snapshot' })
    }
    const eventType = (event: any) => event.event_type === 'BUY' ? 'buy' : event.event_type === 'SELL' ? 'sell' : event.event_type === 'DIVIDEND' ? 'dividend' : 'fee'
    const missingEvents = (state?.historical_fill_ledger?.events || []).filter((event: any) => !transactions.some((transaction) => {
      if (transaction.sourceImportKey === `handoff:${event.local_event_id}`) return true
      return transaction.asset.symbol === event.symbol
        && transaction.type === eventType(event)
        && shanghaiDate(transaction.executedAt) === event.date
        && Math.abs(transaction.quantity - Number(event.reference_quantity_as_displayed || 0)) < 0.0001
        && Math.abs(transaction.price - Number(event.unit_price || 0)) <= priceTolerance(event.symbol)
    }))
    if (missingEvents.length > 0) {
      differences.push({
        scope: 'historical_fill_audit', severity: 'info', expected: String(state?.historical_fill_ledger?.events?.length || 0),
        actual: String((state?.historical_fill_ledger?.events?.length || 0) - missingEvents.length),
        message: `${missingEvents.length} 条交接成交尚未进入本地审计台账；它们已包含在持仓快照中，不得重放。`,
        eventIds: missingEvents.map((event: any) => event.local_event_id), action: 'record_without_position_effect',
      })
    }
    if (state?.latest_snapshot_adjustment?.exact_fill_details_status === 'unknown_not_visible_in_trade_screenshot') {
      differences.push({
        scope: 'latest_snapshot_adjustment', severity: 'warning',
        message: '最新持仓截图证明仓位数量已变化，但成交截图未显示对应当日成交价和费用；仅采用持仓快照，不编造成交明细。',
        observedQuantityChanges: state.latest_snapshot_adjustment.observed_quantity_changes || [],
        action: 'audit_when_trade_details_become_visible',
      })
    }
    if (!holdingsCapture || !holdingFreshness.fresh) differences.push({ scope: 'capture', role: 'holdings', severity: 'blocking', message: '缺少15分钟内人工确认的资金持仓截图。', action: 'upload_and_confirm' })
    else if (!holdingsFieldsComplete) differences.push({ scope: 'capture', role: 'holdings_fields', severity: 'blocking', message: '持仓截图缺少可用资金、持仓数量或可卖数量，不能完成下单前对账。', action: 'correct_and_confirm_capture_fields' })
    if (!input.zeroNewTradesConfirmed && (!tradesCapture || !tradeFreshness.fresh)) differences.push({ scope: 'capture', role: 'trades', severity: 'blocking', message: '缺少15分钟内人工确认的近期成交截图或零成交确认。', action: 'upload_and_confirm' })
    if (!ordinaryFreshness.fresh) differences.push({ scope: 'capture', role: 'ordinary_orders', severity: 'warning', message: '普通委托未提供或已过期；新增候选必须在同花顺人工查重。', action: 'manual_dedup' })
    if (!conditionalFreshness.fresh) differences.push({ scope: 'capture', role: 'conditional_orders', severity: 'warning', message: '条件单未提供或已过期；不能给出确定的保留或撤销结论。', action: 'manual_dedup' })

    const ordinaryOrders = this.observedOrders(ordinaryCapture, 'ordinary')
    const conditionalOrders = this.observedOrders(conditionalCapture, 'conditional')
    const retained: any[] = []
    const cancelCandidates: any[] = []
    const addCandidates: any[] = []
    const blockedOrders: any[] = []
    const matchedIds = new Set<string>()
    const downtrendLevels = state?.grid_policy?.mode === 'downtrend_defensive'
      ? (state?.positions || []).flatMap((position: any) => (position.downtrend_grid?.levels || []).map((level: any) => ({ ...level, symbol: position.symbol })))
      : []
    const pendingProposals = downtrendLevels.length > 0
      ? downtrendLevels.filter((level: any) => level.activationStatus !== 'awaiting_parent_fill').map((level: any) => ({
          plan_id: level.orderRef,
          symbol: level.symbol,
          side: String(level.side).toUpperCase(),
          limit_price: level.price,
          quantity: level.quantity,
          purpose: level.orderRole,
          order_role: level.orderRole,
          activation_status: level.activationStatus,
          source_id: 'A_DOWNTREND_PLAN_20260911',
        }))
      : state?.pending_order_proposals || []
    const conditionalProposals = downtrendLevels.length > 0
      ? downtrendLevels.filter((level: any) => level.activationStatus === 'awaiting_parent_fill').map((level: any) => ({
          id: level.orderRef,
          parent_plan_id: level.parentOrderRef,
          symbol: level.symbol,
          side: String(level.side).toUpperCase(),
          price: level.price,
          max_quantity: level.quantity,
          order_role: level.orderRole,
          activation_status: level.activationStatus,
        }))
      : state?.conditional_followup_proposals || []
    for (const proposal of pendingProposals) {
      const match = this.matchOrder(ordinaryOrders, proposal)
      const row = {
        proposalId: proposal.plan_id,
        symbol: String(proposal.symbol), side: String(proposal.side).toUpperCase(),
        price: decimal(proposal.limit_price, 4), quantity: decimal(proposal.quantity, 4),
        purpose: proposal.purpose, orderRole: proposal.order_role || proposal.purpose,
        activationStatus: proposal.activation_status || 'active', authority: 'assistant_proposal', approved: false,
        sourceRef: proposal.source_id, existingOrderId: match?.externalOrderId || match?.id || null,
      }
      if (proposal.activation_status && proposal.activation_status !== 'active') {
        blockedOrders.push({ ...row, disposition: 'blocked', blocker: proposal.activation_status, message: '该档位尚未满足可卖/父单条件，当前不得挂单。' })
      } else if (match) {
        matchedIds.add(match.id)
        retained.push({ ...row, disposition: 'retain_candidate', message: '观察到匹配的普通委托；仅可提请保留，策略价格仍未获用户批准。' })
      } else if (!requiredReady) {
        blockedOrders.push({ ...row, disposition: 'blocked', blocker: 'required_capture_reconciliation_incomplete' })
      } else if (!ordinaryFreshness.fresh) {
        addCandidates.push({ ...row, disposition: 'manual_dedup', message: '未核对普通委托，新增前必须在同花顺人工查重。' })
      } else {
        blockedOrders.push({ ...row, disposition: 'blocked', blocker: 'assistant_proposal_not_user_approved' })
      }
    }
    for (const proposal of conditionalProposals) {
      const match = this.matchOrder(conditionalOrders, proposal)
      const row = {
        proposalId: proposal.id, parentProposalId: proposal.parent_plan_id,
        symbol: String(proposal.symbol), side: String(proposal.side).toUpperCase(),
        price: decimal(proposal.price, 4), quantity: decimal(proposal.max_quantity, 4),
        authority: 'assistant_proposal', approved: false, orderKind: 'conditional',
        orderRole: proposal.order_role || 'conditional_buyback', activationStatus: proposal.activation_status || 'awaiting_parent_fill',
        existingOrderId: match?.externalOrderId || match?.id || null,
      }
      if (proposal.activation_status === 'awaiting_parent_fill' && !match) {
        blockedOrders.push({ ...row, disposition: 'blocked', blocker: 'awaiting_parent_fill', message: '父单尚未确认成交；当前只展示配对价，不新增买回/卖出单。' })
      } else if (match) {
        matchedIds.add(match.id)
        retained.push({ ...row, disposition: 'retain_candidate', message: '观察到匹配条件单；仍需核实父卖单成交条件和用户授权。' })
      } else if (!conditionalFreshness.fresh) {
        addCandidates.push({ ...row, disposition: 'manual_dedup', message: '条件单未核对，不得直接新增。' })
      } else {
        blockedOrders.push({ ...row, disposition: 'blocked', blocker: 'assistant_proposal_not_user_approved' })
      }
    }
    for (const check of state?.proposed_cancel_or_pause_checks || []) {
      const match = this.matchOrder(ordinaryOrders, { ...check, quantity: check.quantity ?? null, limit_price: check.price ?? null })
      if (!match) continue
      matchedIds.add(match.id)
      cancelCandidates.push({
        existingOrderId: match.externalOrderId || match.id, symbol: match.symbol, side: match.side,
        price: match.price, quantity: match.quantity, disposition: 'cancel_candidate', authority: 'assistant_proposal',
        message: check.action, requiresHumanConfirmation: true,
      })
    }
    for (const order of [...ordinaryOrders, ...conditionalOrders].filter((item) => !matchedIds.has(item.id))) {
      blockedOrders.push({ ...order, disposition: 'blocked', blocker: 'existing_order_not_mapped_to_confirmed_strategy', message: '已观察到订单，但没有可确认的策略映射，需人工核对。' })
    }

    const userRules = (state?.positions || []).flatMap((position: any) => {
      const rows: any[] = [{
        symbol: position.symbol, rule: 'quantity_hard_cap', value: decimal(position.user_policy?.quantity_hard_cap, 4),
        authority: position.user_policy?.quantity_hard_cap !== null && position.user_policy?.quantity_hard_cap !== undefined
          ? 'user_confirmed'
          : 'pending_confirmation',
        sourceRef: position.user_policy?.source_id,
      }]
      if (position.stop?.user_level !== null && position.stop?.user_level !== undefined) rows.push({
        symbol: position.symbol, rule: 'stop_price', value: decimal(position.stop.user_level, 4),
        authority: 'user_confirmed', enabledForExecution: false, sourceRef: position.stop.source_id,
      })
      if (position.user_policy?.allocation_status === 'user_confirmed') rows.push({
        symbol: position.symbol, rule: 'core_satellite_capacity',
        value: {
          core: decimal(position.user_policy.core_capacity, 4),
          satellite: decimal(position.user_policy.satellite_capacity, 4),
          reboundExit: decimal(position.user_policy.rebound_exit_capacity ?? 0, 4),
        },
        currentDerived: {
          core: decimal(position.derived_current_allocation?.core_quantity, 4),
          satellite: decimal(position.derived_current_allocation?.satellite_quantity, 4),
          reboundExit: decimal(position.derived_current_allocation?.rebound_exit_quantity ?? 0, 4),
          remainingSatelliteCapacity: decimal(position.derived_current_allocation?.remaining_satellite_capacity ?? 0, 4),
        },
        authority: 'user_confirmed', sourceRef: position.user_policy.source_id,
      })
      if (position.downtrend_grid) rows.push({
        symbol: position.symbol,
        rule: 'downtrend_defensive_grid',
        value: position.downtrend_grid,
        authority: position.downtrend_grid.status === 'active_user_requested_draft' ? 'user_requested_assistant_draft' : 'assistant_proposal',
        sourceRef: position.downtrend_grid.source_id || 'strategy_state:downtrend_grid',
      })
      return rows
    })
    const pendingRules = [
      ...(state?.unresolved_items || []).map((message: string) => ({ message, authority: 'pending_confirmation', status: 'blocked_until_confirmed' })),
      ...(stateError ? [{ message: `策略交接文件读取失败：${stateError}`, authority: 'pending_confirmation', status: 'blocking' }] : []),
    ]
    const openPairs = (state?.grid_pair_ledger || []).filter((pair: any) => String(pair.status).includes('waiting_rebuy')).map((pair: any) => ({
      pairId: pair.pair_id, symbol: pair.symbol, soldQuantity: decimal(pair.sold_quantity, 4),
      remainingRebuyQuantity: decimal(pair.remaining_rebuy_quantity_at_snapshot, 4), sellPrice: decimal(pair.sell_price, 4),
      proposedRebuyPrice: decimal(pair.proposed_rebuy_price, 4), proposalAuthority: 'assistant_proposal',
      status: pair.status, sourceRef: `strategy_state:grid_pair_ledger:${pair.pair_id}`,
    }))

    return {
      schemaVersion: 'fams.daily-review-reconciliation.v1',
      generatedAt: now.toISOString(),
      sessionType: input.sessionType || 'manual',
      strategyState: {
        version: state?.strategy_version || null,
        preparedOn: state?.prepared_on || null,
        sourcePath,
        authorization: state?.authorization || null,
        gridMode: state?.grid_policy?.mode || null,
      },
      readiness: {
        researchAllowed: true,
        requiredInputsReady: requiredReady,
        holdingsFieldsComplete,
        ordersFullyReconciled,
        draftStatus: requiredReady ? ordersFullyReconciled ? 'reconciled_draft' : 'manual_dedup_required' : 'blocked',
        captures: {
          holdings: { captureId: holdingsCapture?.id || null, ...holdingFreshness },
          trades: { captureId: tradesCapture?.id || null, ...tradeFreshness, explicitZeroConfirmation: input.zeroNewTradesConfirmed === true },
          ordinaryOrders: { captureId: ordinaryCapture?.id || null, ...ordinaryFreshness, required: false },
          conditionalOrders: { captureId: conditionalCapture?.id || null, ...conditionalFreshness, required: false },
        },
      },
      confirmedFacts: {
        authority: facts.fallbackUsed ? 'historical_screenshot_fact' : 'screenshot_fact',
        fallbackUsed: facts.fallbackUsed,
        account: facts.account,
        positions: facts.positions,
        userRules,
        cashPolicy: state?.cash_policy || null,
        downtrendGrids: Object.fromEntries((state?.positions || [])
          .filter((position: any) => position.downtrend_grid)
          .map((position: any) => [String(position.symbol), position.downtrend_grid])),
        openGridPairs: openPairs,
        historicalFillsAlreadyIncludedInSnapshot: true,
        doNotReplayHistoricalFills: true,
      },
      reconciliationDifferences: differences,
      pendingRules,
      proposedOrders: {
        retained,
        cancelCandidates,
        addCandidates,
        blocked: blockedOrders,
        observedOrdinaryOrders: ordinaryOrders,
        observedConditionalOrders: conditionalOrders,
        missingOrderScreenshotsRequireManualDedup: !ordersFullyReconciled,
        legacyGridSuperseded: state?.grid_policy?.oldGridStatus === 'superseded_do_not_rehang',
      },
      executionPermission: {
        mode: 'monitor_and_draft_only',
        planDraftOnly: true,
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        canCreateOrder: false,
        orderCreateAllowed: false,
        brokerConnectionAvailable: false,
        userMustExecuteInBroker: true,
      },
    }
  }
}

export const brokerReviewReconciliationService = new BrokerReviewReconciliationService()
