import assert from 'node:assert/strict'
import { gridStrategyService } from '../src/services/strategy/gridStrategyService.js'
import {
  buildDailyReviewSynthesisFallback,
  validateDailyReviewSynthesisPayload,
} from '../src/services/review/dailyReviewSynthesisService.js'

const config = gridStrategyService.getTemplate('mean_reversion_atr_v1')
const baseInput = {
  config,
  assetType: 'stock',
  currentPrice: 10,
  avgCost: 12,
  quantity: 1_000,
  cashBudget: 50_000,
  portfolioValue: 200_000,
  currentMarketValue: 10_000,
  completedBars: 80,
  confidence: 0.9,
  ma5: 10.1,
  ma10: 10.2,
  ma30: 9.8,
  atr14: 0.3,
  valuationStatus: 'available',
  valuationConclusion: 'risk_review',
} as const

const material = gridStrategyService.buildGridDraft({ ...baseInput, materialChange: 'material' })
assert.equal(material.derivation.schemaVersion, 'fams.grid-derivation.v1')
assert.ok(material.sideBlockers.buy.includes('material_change_requires_review'))
assert.ok(material.sideBlockers.buy.includes('stock_valuation_risk_review'))
assert.equal(material.orders.some((order) => order.side === 'buy'), false)
assert.equal(material.orders.some((order) => order.side === 'sell'), true)
assert.equal(material.derivation.anchor.source, 'ma10')
assert.equal(material.derivation.spacing.rawPercent, 2.25)
assert.equal(material.derivation.spacing.finalPercent, 2.25)

const insufficient = gridStrategyService.buildGridDraft({ ...baseInput, materialChange: 'insufficient' })
assert.equal(insufficient.orders.length, 0)
assert.ok(insufficient.blockers.includes('fundamental_or_news_evidence_insufficient'))

const synthesisInput = {
  decisionSummary: {
    headline: '需要人工复核。',
    assets: [{
      symbol: 'TEST',
      conclusion: '只允许卖出草案。',
      blockers: ['material_change_requires_review'],
      evidenceRefs: ['financial-report:TEST:latest'],
      gridDerivation: material.derivation,
    }],
  },
  attentionCandidates: [{
    symbol: 'TEST',
    reason: '财务风险需要复核。',
    evidenceStatus: 'available',
    evidenceRefs: ['financial-report:TEST:latest'],
  }],
}

const validPayload = {
  headline: '组合风险需要人工复核',
  overview: '风险证据已经触发买入门禁，现有草案仅用于人工检查',
  attentionSummaries: [{
    symbol: 'TEST',
    summary: '财务安全性下降，需要优先检查',
    reasons: ['最新财务证据触发风险门禁'],
    watchItems: ['关注后续财务修复和价格走势'],
    risk: '证据可用，但人工计划仍需人工确认',
    evidenceRefs: ['financial-report:TEST:latest'],
  }],
  orderExplanations: [{
    symbol: 'TEST',
    summary: '仅保留风险降低方向的人工计划',
    anchorLogic: '价格锚来自已保存的技术均线',
    spacingLogic: '间距来自波动率并受策略边界限制',
    sizingLogic: '数量受持仓和最小交易单位约束',
    risks: ['禁止把草案解释为自动交易指令'],
  }],
}
assert.equal(validateDailyReviewSynthesisPayload(validPayload, synthesisInput).ok, true)
assert.deepEqual(validateDailyReviewSynthesisPayload({
  ...validPayload,
  overview: '建议在 10 元附近操作',
}, synthesisInput), { ok: false, code: 'llm_numeric_narrative_rejected' })
assert.deepEqual(validateDailyReviewSynthesisPayload({
  ...validPayload,
  attentionSummaries: [{ ...validPayload.attentionSummaries[0], evidenceRefs: ['invented:evidence'] }],
}, synthesisInput), { ok: false, code: 'llm_evidence_ref_outside_allowlist' })

const fallback = buildDailyReviewSynthesisFallback(synthesisInput, 'llm_timeout', true)
assert.equal(fallback.source, 'deterministic')
assert.equal(fallback.attemptCount, 1)
assert.equal(fallback.failureCode, 'llm_timeout')

console.log(JSON.stringify({
  ok: true,
  materialSellDrafts: material.orders.filter((order) => order.side === 'sell').length,
  materialBuyDrafts: material.orders.filter((order) => order.side === 'buy').length,
  synthesisValidation: 'passed',
}, null, 2))
