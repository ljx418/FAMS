import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
  PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
  PortfolioManualSignoffRole,
} from './portfolioBacktestTypes.js'

export type PortfolioBacktestManualReviewDecision = 'approve_for_manual_review' | 'request_changes' | 'reject'

export interface PortfolioBacktestManualReview {
  schemaVersion: 'portfolio.backtest.manual_plan_review.v1'
  runId: string
  reviewerId: string
  role: PortfolioManualSignoffRole
  reviewedAt: string
  decision: PortfolioBacktestManualReviewDecision
  notes: string
  blockedReasons: string[]
  humanReviewChecklist: string[]
  safetyAssertions: {
    formalTradeActionAllowed: false
    autoTradeAllowed: false
    canCreateOrder: false
    formalTargetWeightPercent: 0
  }
  allowedActions: typeof PORTFOLIO_BACKTEST_ALLOWED_ACTIONS
  prohibitedActions: typeof PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS
  notTradingAdvice: true
}

function backendRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
}

function safeRunId(runId: string) {
  return runId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 160)
}

function safeRole(role: string | undefined): PortfolioManualSignoffRole {
  if (role === 'data' || role === 'model' || role === 'risk' || role === 'compliance' || role === 'final_release') return role
  return 'final_release'
}

export class PortfolioBacktestReviewService {
  private reviewDir() {
    return resolve(backendRoot(), 'data/gpt-audit/portfolio-backtest-manual-reviews')
  }

  async getReview(runId: string) {
    const path = resolve(this.reviewDir(), `${safeRunId(runId)}.json`)
    const content = await readFile(path, 'utf8').catch(() => '')
    if (!content) {
      return {
        schemaVersion: 'portfolio.backtest.manual_plan_review_status.v1',
        runId,
        status: 'not_reviewed',
        review: null,
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        canCreateOrder: false,
        allowedActions: PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
        prohibitedActions: PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
        notTradingAdvice: true,
      }
    }
    const review = JSON.parse(content) as PortfolioBacktestManualReview
    return {
      schemaVersion: 'portfolio.backtest.manual_plan_review_status.v1',
      runId,
      status: 'review_recorded',
      review,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      allowedActions: PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
      prohibitedActions: PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
  }

  async saveReview(args: {
    runId: string
    reviewerId: string
    role?: PortfolioManualSignoffRole
    decision: PortfolioBacktestManualReviewDecision
    notes?: string
    blockedReasons?: string[]
    humanReviewChecklist?: string[]
  }) {
    await mkdir(this.reviewDir(), { recursive: true })
    const review: PortfolioBacktestManualReview = {
      schemaVersion: 'portfolio.backtest.manual_plan_review.v1',
      runId: args.runId,
      reviewerId: args.reviewerId,
      role: safeRole(args.role),
      reviewedAt: new Date().toISOString(),
      decision: args.decision,
      notes: args.notes || '',
      blockedReasons: Array.from(new Set([
        'formal_trading_not_unlocked',
        'order_creation_not_supported_from_manual_review',
        ...(args.blockedReasons || []),
      ])),
      humanReviewChecklist: args.humanReviewChecklist?.length
        ? args.humanReviewChecklist
        : [
          'review_data_grade',
          'review_model_effectiveness',
          'review_portfolio_risk',
          'review_price_freshness',
          'final_human_confirmation_outside_system',
        ],
      safetyAssertions: {
        formalTradeActionAllowed: false,
        autoTradeAllowed: false,
        canCreateOrder: false,
        formalTargetWeightPercent: 0,
      },
      allowedActions: PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
      prohibitedActions: PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
    const path = resolve(this.reviewDir(), `${safeRunId(args.runId)}.json`)
    await writeFile(path, `${JSON.stringify(review, null, 2)}\n`, 'utf8')
    return {
      schemaVersion: 'portfolio.backtest.manual_plan_review_saved.v1',
      status: 'saved',
      review,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      allowedActions: PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
      prohibitedActions: PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
  }
}

export const portfolioBacktestReviewService = new PortfolioBacktestReviewService()
