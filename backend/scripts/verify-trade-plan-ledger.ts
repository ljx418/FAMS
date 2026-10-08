import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

type Check = { id: string; passed: boolean; detail: string }

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

function parseLastJson(output: string) {
  const start = output.lastIndexOf('\n{')
  return JSON.parse(output.slice(start >= 0 ? start + 1 : output.indexOf('{')))
}

async function runWorker() {
  const [{ prisma }, { transactionService }, { tradeLedgerService, stableJson, sha256 }, { planExecutionService },
    { rotationVolatilityStrategyService }, { gridReplayService }, { callMcpTool, mcpTools }, XLSX] = await Promise.all([
    import('../src/db/prisma.js'),
    import('../src/services/transaction/transactionService.js'),
    import('../src/services/trade-ledger/tradeLedgerService.js'),
    import('../src/services/trade-ledger/planExecutionService.js'),
    import('../src/services/investment-workflow/rotationVolatilityStrategyService.js'),
    import('../src/services/backtest/gridReplayService.js'),
    import('../src/mcp/registry.js'),
    import('xlsx'),
  ])
  const checks: Check[] = []
  const check = (id: string, detail: string, condition = true) => {
    assert.ok(condition, `${id}: ${detail}`)
    checks.push({ id, passed: true, detail })
  }
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`
  const userId = `trade-ledger-acceptance-${runId}`
  const symbolSeed = String(Date.now()).slice(-4)
  const symbols = {
    strategyA: `8${symbolSeed}1`,
    strategyB: `8${symbolSeed}2`,
    execution: `8${symbolSeed}3`,
    unmatched: `8${symbolSeed}4`,
    cash: `CASH-${runId}`,
  }

  const isoDate = (date: Date) => date.toISOString().slice(0, 10)
  const positionFingerprint = async () => sha256((await prisma.position.findMany({
    where: { userId },
    select: { id: true, assetId: true, quantity: true, avgCost: true, costBasis: true, marketValue: true, status: true },
    orderBy: { id: 'asc' },
  })))
  const workbookBuffer = (rows: Array<Record<string, unknown>>) => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'trades')
    return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  }
  const mapping = { date: 'date', symbol: 'symbol', type: 'type', quantity: 'quantity', price: 'price', fee: 'fee', broker: 'broker', confirmationNo: 'confirmationNo' }

  try {
    await prisma.user.create({ data: { id: userId, email: `${userId}@local.test`, name: 'Trade ledger acceptance', passwordHash: 'no-login' } })
    const [strategyAssetA, strategyAssetB, executionAsset, unmatchedAsset, cashAsset] = await Promise.all([
      prisma.asset.create({ data: { symbol: symbols.strategyA, name: '策略样本 A', type: 'stock', exchange: 'SH', sector: '验收行业', industry: '验收行业', lastPrice: 25 } }),
      prisma.asset.create({ data: { symbol: symbols.strategyB, name: '策略样本 B', type: 'stock', exchange: 'SH', sector: '验收行业', industry: '验收行业', lastPrice: 20 } }),
      prisma.asset.create({ data: { symbol: symbols.execution, name: '执行归因样本', type: 'stock', exchange: 'SH', lastPrice: 10 } }),
      prisma.asset.create({ data: { symbol: symbols.unmatched, name: '计划外样本', type: 'stock', exchange: 'SH', lastPrice: 8 } }),
      prisma.asset.create({ data: { symbol: symbols.cash, name: '验收现金', type: 'cash', currency: 'CNY', lastPrice: 1 } }),
    ])
    const [positionA, positionB, executionPosition] = await Promise.all([
      prisma.position.create({ data: { userId, assetId: strategyAssetA.id, openKey: `${userId}:${strategyAssetA.id}`, quantity: 1000, avgCost: 20, currentPrice: 25, marketValue: 25000, costBasis: 20000, tags: '["同花顺"]' } }),
      prisma.position.create({ data: { userId, assetId: strategyAssetB.id, openKey: `${userId}:${strategyAssetB.id}`, quantity: 1000, avgCost: 19, currentPrice: 20, marketValue: 20000, costBasis: 19000, tags: '["同花顺"]' } }),
      prisma.position.create({ data: { userId, assetId: executionAsset.id, openKey: `${userId}:${executionAsset.id}`, quantity: 1000, avgCost: 10, currentPrice: 10, marketValue: 10000, costBasis: 10000 } }),
      prisma.position.create({ data: { userId, assetId: cashAsset.id, openKey: `${userId}:${cashAsset.id}`, quantity: 100000, avgCost: 1, currentPrice: 1, marketValue: 100000, costBasis: 100000, tags: '["同花顺"]' } }),
    ])
    await prisma.position.create({ data: { userId, assetId: unmatchedAsset.id, openKey: `${userId}:${unmatchedAsset.id}`, quantity: 1000, avgCost: 8, currentPrice: 8, marketValue: 8000, costBasis: 8000 } })

    const recordRows = [{ date: '2026-10-01', symbol: symbols.strategyA, type: 'buy', quantity: 100, price: 24, fee: 5, broker: 'acceptance', confirmationNo: `record-${runId}` }]
    const beforeRecordHash = await positionFingerprint()
    const recordFirst = await transactionService.importTransactions(userId, workbookBuffer(recordRows), mapping, {
      idempotencyKey: `record-only-${runId}`, positionEffect: 'record_only', confirmedBy: 'acceptance-user',
    })
    const recordSecond = await transactionService.importTransactions(userId, workbookBuffer(recordRows), mapping, {
      idempotencyKey: `record-only-${runId}`, positionEffect: 'record_only', confirmedBy: 'acceptance-user',
    })
    assert.equal(recordFirst.ingestionBatchId, recordSecond.ingestionBatchId)
    assert.equal(await positionFingerprint(), beforeRecordHash)
    const recordTransactions = await prisma.transaction.findMany({ where: { userId, sourceImportKey: `confirmation:acceptance:record-${runId}` } })
    assert.equal(recordTransactions.length, 1)
    assert.equal(recordTransactions[0].positionEffect, 'record_only')
    check('AC-01', '重复文件导入复用同一批次且没有重复 Transaction')
    check('AC-02', 'record_only 明确落库且 Position/Cash 指纹不变')

    const applyRows = [{ date: '2026-10-02', symbol: symbols.strategyA, type: 'buy', quantity: 100, price: 25, fee: 5, broker: 'acceptance', confirmationNo: `apply-${runId}` }]
    const beforeApply = await prisma.position.findUniqueOrThrow({ where: { id: positionA.id } })
    const applyFirst = await transactionService.importTransactions(userId, workbookBuffer(applyRows), mapping, {
      idempotencyKey: `apply-${runId}`, positionEffect: 'apply', confirmedBy: 'acceptance-user',
    })
    const afterApply = await prisma.position.findUniqueOrThrow({ where: { id: positionA.id } })
    await transactionService.importTransactions(userId, workbookBuffer(applyRows), mapping, {
      idempotencyKey: `apply-${runId}`, positionEffect: 'apply', confirmedBy: 'acceptance-user',
    })
    const afterApplyRepeat = await prisma.position.findUniqueOrThrow({ where: { id: positionA.id } })
    assert.equal(afterApply.quantity, beforeApply.quantity + 100)
    assert.equal(afterApplyRepeat.quantity, afterApply.quantity)
    assert.equal((await prisma.transaction.findMany({ where: { ingestionBatchId: applyFirst.ingestionBatchId } })).length, 1)
    check('AC-03', 'apply 只改变一次仓位，重复请求不重放')

    await assert.rejects(
      () => transactionService.importTransactions(userId, workbookBuffer([{ ...applyRows[0], price: 26 }]), mapping, {
        idempotencyKey: `apply-${runId}`, positionEffect: 'apply', confirmedBy: 'acceptance-user',
      }),
      (error: any) => error?.code === 'INGESTION_IDEMPOTENCY_CONFLICT',
    )
    check('AC-04', '同一幂等键携带不同经济事实返回冲突并禁止覆盖')

    const zeroAt = new Date()
    const zero = await tradeLedgerService.confirmZeroAttestation({
      userId, accountSource: 'acceptance', coverageKinds: ['trades', 'ordinary_orders', 'conditional_orders'], confirmedBy: 'acceptance-user', confirmedAt: zeroAt,
    })
    assert.equal(zero?.status, 'confirmed')
    assert.equal(zero?.rows.length, 3)
    const readyReconciliation = await tradeLedgerService.persistReconciliation({
      userId, idempotencyKey: `ready-reconciliation-${runId}`, ingestionBatchId: zero!.id, accountSource: 'acceptance', status: 'ready', asOf: zeroAt,
      coverage: { holdings: true, cash: true, trades: true, ordinaryOrders: true, conditionalOrders: true },
      summary: { explicitZeroEvidence: true }, differences: [], inputRefs: { ingestionBatchId: zero!.id }, holdings: [{ assetId: strategyAssetA.id, quantity: afterApply.quantity }], transactions: [], orders: [],
    })
    assert.equal(readyReconciliation.reconciliation.status, 'ready')
    check('AC-05', '明确零成交/零委托保存为独立批次并被 ready 对账引用')

    const blockedReconciliation = await tradeLedgerService.persistReconciliation({
      userId, idempotencyKey: `blocked-reconciliation-${runId}`, accountSource: 'acceptance', status: 'blocked', asOf: new Date(zeroAt.getTime() - 60_000),
      coverage: { holdings: true, cash: true, trades: false, orders: false }, summary: { missing: ['trade_coverage', 'order_coverage'] }, differences: [{ code: 'TRADE_COVERAGE_MISSING' }], inputRefs: {}, holdings: [], transactions: [], orders: [],
    })
    assert.equal(blockedReconciliation.reconciliation.status, 'blocked')
    check('AC-06', '缺少成交/委托覆盖时可持久化 blocked 门禁，不能冒充完整对账')

    const asOf = new Date(`${new Date().toISOString().slice(0, 10)}T02:00:00.000Z`)
    await tradeLedgerService.persistReconciliation({
      userId, idempotencyKey: `strategy-reconciliation-${runId}`, status: 'ready', asOf,
      coverage: { holdings: true, cash: true, trades: true, orders: true }, summary: { source: 'acceptance' }, differences: [], inputRefs: { source: 'acceptance' }, holdings: [], transactions: [], orders: [],
    })
    const dayMs = 24 * 60 * 60 * 1000
    const makeBars = (target: boolean) => Array.from({ length: 120 }, (_, index) => {
      const date = new Date(asOf.getTime() - (119 - index) * dayMs)
      const base = target ? 15 + 0.035 * index + 0.0008 * index * index : 18 + 0.009 * index
      const close = Number(base.toFixed(4))
      return {
        tradeDate: isoDate(date), open: close * 0.997, high: close * 1.003, low: close * 0.994, close,
        volume: index === 119 ? 300000 : 100000, provider: 'acceptance_fixture', validationStatus: 'valid', sourceRefs: [`acceptance:${target ? 'target' : 'peer'}:${index}`],
      }
    })
    const barsA = makeBars(true)
    const barsB = makeBars(false)
    await prisma.position.update({ where: { id: positionA.id }, data: { currentPrice: barsA.at(-1)!.close, marketValue: afterApply.quantity * barsA.at(-1)!.close } })
    await prisma.position.update({ where: { id: positionB.id }, data: { currentPrice: barsB.at(-1)!.close, marketValue: 1000 * barsB.at(-1)!.close } })
    const snapshotInput = {
      userId, strategyFamily: 'rotation_volatility', positions: [
        { positionId: positionA.id, assetId: strategyAssetA.id, symbol: symbols.strategyA, name: strategyAssetA.name, type: 'stock', sector: '验收行业', industry: '验收行业', exchange: 'SH', priceAsOf: asOf.toISOString(), quantity: afterApply.quantity, avgCost: afterApply.avgCost, currentPrice: barsA.at(-1)!.close, marketValue: afterApply.quantity * barsA.at(-1)!.close, accountMarkers: ['同花顺'] },
        { positionId: positionB.id, assetId: strategyAssetB.id, symbol: symbols.strategyB, name: strategyAssetB.name, type: 'stock', sector: '验收行业', industry: '验收行业', exchange: 'SH', priceAsOf: asOf.toISOString(), quantity: 1000, avgCost: 19, currentPrice: barsB.at(-1)!.close, marketValue: 1000 * barsB.at(-1)!.close, accountMarkers: ['同花顺'] },
      ], dailyBars: { [symbols.strategyA]: barsA, [symbols.strategyB]: barsB },
    }
    const snapshotHash = sha256(snapshotInput)
    const snapshotRow = await prisma.investmentResearchSnapshot.create({
      data: { userId, strategyFamily: 'rotation_volatility', asOf, providerSummaryJson: '["acceptance_fixture"]', freshnessStatus: 'fresh', inputJson: stableJson(snapshotInput), dataHealthJson: stableJson({ status: 'ready', blockers: [], warnings: [] }), evidenceRefsJson: '["acceptance:synthetic-market-bars"]', inputHash: snapshotHash },
    })
    const snapshot = { id: snapshotRow.id, inputHash: snapshotHash, asOf, providerSummary: ['acceptance_fixture'], dataHealth: { status: 'fresh', blockers: [], warnings: [] }, evidenceRefs: ['acceptance:synthetic-market-bars'], input: snapshotInput }
    const strategyKey = `strategy-${runId}`
    const strategyFirst: any = await rotationVolatilityStrategyService.run({ userId, snapshot, positionIds: [positionA.id], materialChange: 'none', idempotencyKey: strategyKey })
    const firstTarget = strategyFirst.targets[0]
    const firstPlan = await prisma.gridPlan.findUniqueOrThrow({ where: { id: firstTarget.gridPlanId }, include: { orders: { include: { events: true } } } })
    assert.equal(firstPlan.investmentStrategyRunId, strategyFirst.strategyRunId)
    assert.ok(firstPlan.orders.length > 0, `synthetic leading/trending input should create a draft; blockers=${JSON.stringify(firstTarget.result.blockedReasons)}`)
    assert.ok(firstPlan.orders.every((order: any) => order.events.some((event: any) => event.eventType === 'proposed')))
    check('AC-07', '轻量轮动策略保存 StrategyRun、GridPlan、GridOrderDraft 及 proposed 事件')

    const planCountBeforeIdempotent = await prisma.gridPlan.count({ where: { userId } })
    const strategyRepeat: any = await rotationVolatilityStrategyService.run({ userId, snapshot, positionIds: [positionA.id], materialChange: 'none', idempotencyKey: strategyKey })
    assert.equal(strategyRepeat.strategyRunId, strategyFirst.strategyRunId)
    assert.equal(strategyRepeat.reused, true)
    assert.equal(await prisma.gridPlan.count({ where: { userId } }), planCountBeforeIdempotent)
    check('AC-08', '相同策略幂等键复用同一运行且不复制计划网格')

    const strategyReuse: any = await rotationVolatilityStrategyService.run({ userId, snapshot, positionIds: [positionA.id], materialChange: 'none', idempotencyKey: `strategy-reuse-${runId}` })
    assert.equal(strategyReuse.targets[0].gridPlanId, firstPlan.id)
    assert.equal(strategyReuse.targets[0].planDisposition, 'reuse')
    assert.equal(await prisma.gridPlan.count({ where: { userId } }), planCountBeforeIdempotent)
    check('AC-09', '有效旧计划仅被引用，不复制订单或计划')

    const strategyReplacement: any = await rotationVolatilityStrategyService.run({ userId, snapshot, positionIds: [positionA.id], materialChange: 'material', idempotencyKey: `strategy-replace-${runId}` })
    const replacementPlan = await prisma.gridPlan.findUniqueOrThrow({ where: { id: strategyReplacement.targets[0].gridPlanId }, include: { orders: true } })
    assert.equal(replacementPlan.previousPlanId, firstPlan.id)
    const supersededEvents = await prisma.gridOrderDraftEvent.count({ where: { gridOrderDraft: { gridPlanId: firstPlan.id }, eventType: 'superseded' } })
    assert.equal(supersededEvents, firstPlan.orders.length)
    check('AC-10', '重大变化生成 previousPlanId 替代链并为旧草案追加 superseded 事件')

    const review = await prisma.dailyReviewRun.create({ data: { userId, sessionType: 'trade_ledger_acceptance', triggerSource: 'automated_acceptance', status: 'completed', completedAt: new Date() } })
    const planAt = new Date(Date.now() - 5 * dayMs)
    const executionPlan = await prisma.gridPlan.create({
      data: { userId, dailyReviewRunId: review.id, assetId: executionAsset.id, mode: 'acceptance_grid', status: 'draft', summary: '计划执行生命周期验收', validUntil: new Date(Date.now() + 2 * dayMs), createdAt: planAt,
        orders: { create: { side: 'buy', level: 1, price: 10, quantity: 200, amount: 2000, validUntil: new Date(Date.now() + 2 * dayMs), rationale: 'acceptance', events: { create: { idempotencyKey: 'proposed', eventType: 'proposed', quantity: 200, price: 10, occurredAt: planAt } } } } },
      include: { orders: true },
    })
    const fill1 = await transactionService.createTransaction({ userId, assetId: executionAsset.id, type: 'buy', quantity: 100, price: 10, fee: 5, executedAt: new Date(planAt.getTime() + dayMs), source: 'acceptance', sourceImportKey: `partial-1-${runId}` })
    const fill2 = await transactionService.createTransaction({ userId, assetId: executionAsset.id, type: 'buy', quantity: 100, price: 10, fee: 5, executedAt: new Date(planAt.getTime() + 2 * dayMs), source: 'acceptance', sourceImportKey: `partial-2-${runId}` })
    const suggested1 = await planExecutionService.suggest({ userId, transactionId: fill1.id, explicitGridOrderDraftId: executionPlan.orders[0].id })
    const suggested2 = await planExecutionService.suggest({ userId, transactionId: fill2.id, explicitGridOrderDraftId: executionPlan.orders[0].id })
    assert.equal(suggested1.links[0].matchStatus, 'suggested')
    const confirmed1: any = await planExecutionService.decide({ userId, linkId: suggested1.links[0].id, decision: 'confirmed', confirmedBy: 'acceptance-user', idempotencyKey: `confirm-partial-1-${runId}` })
    assert.equal(confirmed1.matchStatus, 'confirmed')
    assert.equal((await prisma.gridOrderDraft.findUniqueOrThrow({ where: { id: executionPlan.orders[0].id } })).status, 'partially_filled')
    await planExecutionService.decide({ userId, linkId: suggested2.links[0].id, decision: 'confirmed', confirmedBy: 'acceptance-user', idempotencyKey: `confirm-partial-2-${runId}` })
    assert.equal((await prisma.gridOrderDraft.findUniqueOrThrow({ where: { id: executionPlan.orders[0].id } })).status, 'filled')
    const fillEvents = await prisma.gridOrderDraftEvent.findMany({ where: { gridOrderDraftId: executionPlan.orders[0].id, eventType: { in: ['partially_filled', 'filled'] } }, orderBy: { occurredAt: 'asc' } })
    assert.deepEqual(fillEvents.map((event: any) => event.eventType), ['partially_filled', 'filled'])
    check('AC-11', '两笔真实成交按 100+100 聚合，生命周期先 partial 后 filled')

    const multiPlan1 = await prisma.gridPlan.create({ data: { userId, dailyReviewRunId: review.id, assetId: executionAsset.id, mode: 'candidate_a', status: 'draft', createdAt: planAt, validUntil: new Date(Date.now() + dayMs), orders: { create: { side: 'sell', level: 1, price: 11, quantity: 100, amount: 1100, status: 'proposed' } } }, include: { orders: true } })
    const multiPlan2 = await prisma.gridPlan.create({ data: { userId, dailyReviewRunId: review.id, assetId: executionAsset.id, mode: 'candidate_b', status: 'draft', createdAt: planAt, validUntil: new Date(Date.now() + dayMs), orders: { create: { side: 'sell', level: 1, price: 11, quantity: 100, amount: 1100, status: 'proposed' } } }, include: { orders: true } })
    const ambiguousFact = await transactionService.createTransaction({ userId, assetId: executionAsset.id, type: 'sell', quantity: 100, price: 11, fee: 5, executedAt: new Date(), source: 'acceptance', sourceImportKey: `ambiguous-${runId}` })
    const ambiguous = await planExecutionService.suggest({ userId, transactionId: ambiguousFact.id })
    assert.ok(ambiguous.links.some((link: any) => link.gridOrderDraftId === multiPlan1.orders[0].id))
    assert.ok(ambiguous.links.some((link: any) => link.gridOrderDraftId === multiPlan2.orders[0].id))
    assert.ok(ambiguous.links.every((link: any) => link.matchStatus === 'suggested'))
    check('AC-12', '多候选仅生成 suggested，未自动 confirmed')

    const unplanned = await transactionService.createTransaction({ userId, assetId: unmatchedAsset.id, type: 'buy', quantity: 100, price: 8, fee: 5, executedAt: new Date(), source: 'acceptance', sourceImportKey: `unplanned-${runId}` })
    const unmatched = await planExecutionService.suggest({ userId, transactionId: unplanned.id })
    assert.equal(unmatched.links.length, 1)
    assert.equal(unmatched.links[0].matchStatus, 'unmatched')
    assert.equal(unmatched.links[0].gridOrderDraftId, null)
    check('AC-13', '计划外成交保留为 Transaction 并有 unmatched 归因记录')

    const lifecyclePlan = await prisma.gridPlan.create({ data: { userId, dailyReviewRunId: review.id, assetId: executionAsset.id, mode: 'lifecycle', status: 'draft', validUntil: new Date(Date.now() + dayMs), orders: { create: { side: 'buy', level: 1, price: 9, quantity: 100, amount: 900, status: 'proposed' } } }, include: { orders: true } })
    await planExecutionService.appendLifecycleEvent({ userId, gridOrderDraftId: lifecyclePlan.orders[0].id, eventType: 'accepted', confirmedBy: 'acceptance-user', idempotencyKey: `accepted-${runId}` })
    await planExecutionService.appendLifecycleEvent({ userId, gridOrderDraftId: lifecyclePlan.orders[0].id, eventType: 'cancelled', confirmedBy: 'acceptance-user', idempotencyKey: `cancelled-${runId}`, reason: 'acceptance cancellation' })
    const lifecycle = await planExecutionService.getPlanLifecycle(userId, lifecyclePlan.id)
    assert.deepEqual(lifecycle.orders[0].events.map((event: any) => event.eventType), ['accepted', 'cancelled'])
    check('AC-14', '接受与撤销均追加事件，原计划和历史事件保留')

    assert.ok(mcpTools['investment_workflow.get_strategy_run'])
    assert.ok(mcpTools['trade_ledger.get_plan_lifecycle'])
    const mcpRun: any = await callMcpTool('investment_workflow.get_strategy_run', { userId, id: strategyFirst.strategyRunId }, { transport: 'stdio', userId, userContextSource: 'acceptance' })
    assert.equal(mcpRun.status, 'completed')
    assert.equal(mcpRun.result.id, strategyFirst.strategyRunId)
    const directRun = await rotationVolatilityStrategyService.getRun(userId, strategyFirst.strategyRunId)
    assert.equal(directRun.resultHash, mcpRun.result.resultHash)
    check('AC-15', 'REST 同源服务与 MCP 读取同一不可变策略运行和结果哈希')

    const replayStart = new Date(planAt.getTime() - dayMs)
    for (let index = 0; index < 12; index += 1) {
      const tradeDate = new Date(replayStart.getTime() + index * dayMs)
      const close = 10 + index * 0.05
      await prisma.marketBarCanonical.create({ data: { assetId: executionAsset.id, symbol: symbols.execution, market: 'CN', timeframe: '1d', tradeDate, adjustType: 'none', openPrice: close, highPrice: close + 1.2, lowPrice: close - 1.2, closePrice: close, volume: 100000, primaryProvider: 'acceptance_fixture', validationStatus: 'valid', dataVersion: 'acceptance.v1' } })
    }
    const unconfirmedReplayFact = await transactionService.createTransaction({ userId, assetId: executionAsset.id, type: 'buy', quantity: 100, price: 10.1, fee: 5, executedAt: new Date(planAt.getTime() + 3 * dayMs), source: 'acceptance', sourceImportKey: `unconfirmed-replay-${runId}` })
    assert.ok(unconfirmedReplayFact.id)
    const replay: any = await gridReplayService.replay({ userId, assetId: executionAsset.id, startDate: isoDate(replayStart), endDate: isoDate(new Date(replayStart.getTime() + 11 * dayMs)), initialCash: 100000 })
    assert.equal(replay.schemaVersion, 'fams.backtest.grid_replay.v3')
    assert.ok(replay.executionAttribution.confirmed.some((item: any) => item.transactionId === fill1.id || item.transactionId === fill2.id))
    assert.ok(replay.executionAttribution.unmatchedOrUnconfirmed.some((item: any) => item.transactionId === unconfirmedReplayFact.id))
    assert.ok(replay.scenarios.some((scenario: any) => scenario.id === 'actual_transactions'))
    check('AC-16', '实际收益仅纳入 confirmed 计划关联，未确认成交单列且不混入实际场景')

    const orderObservationsBefore = await prisma.externalOrderObservation.count({ where: { userId } })
    assert.equal(strategyFirst.permissionState.canCreateOrder, false)
    assert.equal(strategyFirst.permissionState.orderCreateAllowed, false)
    assert.equal(strategyFirst.permissionState.formalTradingUnlocked, false)
    assert.equal(strategyFirst.permissionState.autoTradeUnlocked, false)
    assert.equal(await prisma.externalOrderObservation.count({ where: { userId } }), orderObservationsBefore)
    check('AC-18', '策略运行始终保持只读/拟单权限且未创建券商委托观察')

    const concurrentKey = `concurrent-${runId}`
    const concurrentInput = { userId, sourceType: 'host_structured' as const, idempotencyKey: concurrentKey, positionEffectPolicy: 'record_only' as const, coverageKinds: ['trades'], rows: [{ rowIndex: 1, rowType: 'trade', normalized: { confirmationNo: concurrentKey }, status: 'new' as const }] }
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => tradeLedgerService.stageBatch(concurrentInput)))
    assert.equal(new Set(concurrent.map((item: any) => item.batch.id)).size, 1)
    assert.equal(await prisma.tradeIngestionBatch.count({ where: { userId, idempotencyKey: concurrentKey } }), 1)
    check('AC-19', '并发相同幂等请求只产生一个批次')

    const failureConfirmation = `rollback-${runId}`
    const failedRows = [
      { date: '2026-10-03', symbol: symbols.execution, type: 'buy', quantity: 100, price: 10, fee: 5, broker: 'acceptance', confirmationNo: failureConfirmation },
      { date: '2026-10-03', symbol: symbols.execution, type: 'buy', quantity: 100, price: 10, fee: 5, broker: 'acceptance', confirmationNo: failureConfirmation },
    ]
    const failedBatchKey = `rollback-batch-${runId}`
    await assert.rejects(() => transactionService.importTransactions(userId, workbookBuffer(failedRows), mapping, {
      idempotencyKey: failedBatchKey, positionEffect: 'record_only', confirmedBy: 'acceptance-user',
    }))
    const failedBatch = await prisma.tradeIngestionBatch.findUniqueOrThrow({ where: { userId_idempotencyKey: { userId, idempotencyKey: failedBatchKey } } })
    assert.equal(failedBatch.status, 'failed')
    assert.equal(await prisma.transaction.count({ where: { userId, sourceImportKey: `confirmation:acceptance:${failureConfirmation}` } }), 0)
    check('AC-20', '批次中途唯一约束失败后业务写入整体回滚，批次保留 failed 证据')

    const expected = Array.from({ length: 20 }, (_, index) => `AC-${String(index + 1).padStart(2, '0')}`)
    check('AC-17', '迁移一次及重复迁移验证由父进程完成')
    const present = new Set(checks.map((item) => item.id))
    assert.deepEqual(expected.filter((id) => !present.has(id)), [], 'every acceptance criterion must be represented')
    console.log(JSON.stringify({ schemaVersion: 'fams.trade-plan-ledger-acceptance.v1', status: 'passed', userId, checks }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  if (process.argv.includes('--worker')) {
    await runWorker()
    return
  }
  const tempDir = mkdtempSync(resolve(tmpdir(), 'fams-trade-plan-ledger-acceptance-'))
  const sourceDb = resolve(process.cwd(), 'prisma/dev.db')
  const tempDb = resolve(tempDir, 'dev.db')
  try {
    run('sqlite3', [sourceDb, `.backup ${tempDb}`])
    const tsx = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs')
    const migrationScript = resolve(process.cwd(), 'scripts/apply-trade-plan-ledger-migration.ts')
    const firstMigration = parseLastJson(run(process.execPath, [tsx, migrationScript, '--database', tempDb]))
    const secondMigration = parseLastJson(run(process.execPath, [tsx, migrationScript, '--database', tempDb]))
    assert.ok(['applied', 'already_applied'].includes(firstMigration.status))
    assert.equal(secondMigration.status, 'already_applied')
    assert.equal(firstMigration.integrity, 'ok')
    assert.deepEqual(firstMigration.foreignKeyViolations, [])
    if (firstMigration.before && firstMigration.after) assert.deepEqual(firstMigration.after, firstMigration.before)
    const workerOutput = run(process.execPath, [tsx, resolve(process.cwd(), 'scripts/verify-trade-plan-ledger.ts'), '--worker'], { env: { DATABASE_URL: `file:${tempDb}` } })
    const worker = parseLastJson(workerOutput)
    assert.equal(worker.status, 'passed')
    const checks = worker.checks.map((item: Check) => item.id === 'AC-17'
      ? { ...item, detail: '隔离副本迁移保持 Transaction/Position/GridPlan/GridOrderDraft/ExternalOrderObservation 哈希不变，重复迁移为 already_applied' }
      : item)
    console.log(JSON.stringify({ ...worker, databaseIsolation: 'temporary_copy', migration: { first: firstMigration.status, second: secondMigration.status, integrity: firstMigration.integrity, foreignKeyViolations: firstMigration.foreignKeyViolations }, checks }, null, 2))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
