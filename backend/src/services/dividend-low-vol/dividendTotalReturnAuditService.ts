export class DividendLowVolTotalReturnAuditService {
  buildAudit(backtest: any) {
    const tradeConstraintAudit = backtest?.tradeConstraintAudit || {}
    const benchmark = backtest?.benchmark || { status: 'missing' }
    const insufficientItems = Array.isArray(tradeConstraintAudit.insufficientItems) ? tradeConstraintAudit.insufficientItems : []
    const benchmarkReady = benchmark.status === 'formal_total_return' || benchmark.status === 'free_source_total_return'
    const tradeConstraintsComplete = insufficientItems.length === 0
    const ready = benchmarkReady && tradeConstraintsComplete
    return {
      schemaVersion: 'dividend.low_vol.total_return_backtest_audit.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: 'dividend_low_volatility',
      strategyId: 'dividend_low_vol_leader_v1',
      status: ready
        ? benchmark.status === 'formal_total_return'
          ? 'formal_grade_ready'
          : 'free_source_validation_ready'
        : 'research_only_insufficient',
      notTradingAdvice: true,
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      returnComponents: {
        priceOnlyReturn: backtest?.metrics?.priceOnlyReturnPercent ?? null,
        dividendContribution: backtest?.metrics?.dividendContributionPercent ?? null,
        capitalGainContribution: backtest?.metrics?.capitalGainContributionPercent ?? null,
        costDrag: backtest?.metrics?.estimatedCostDragPercent ?? null,
        benchmarkReturn: backtest?.metrics?.benchmarkReturnPercent ?? null,
        excessReturn: backtest?.metrics?.excessReturnPercent ?? null,
      },
      supportedFeatures: {
        priceOnlyReturn: typeof backtest?.metrics?.priceOnlyReturnPercent === 'number',
        dividendCashMode: true,
        dividendReinvestmentMode: backtest?.options?.dividendReinvestment === true,
        exDividendAdjustment: false,
        taxAssumption: 'not_wired',
        transactionCost: typeof backtest?.options?.transactionCostBps === 'number',
        slippage: typeof backtest?.options?.slippageBps === 'number',
        monthlyRebalance: backtest?.options?.rebalanceFrequency === 'monthly',
        singleStockCap: 'strategy_discipline_only',
        industryCap: 'strategy_discipline_only',
        limitUpDownTradeability: !insufficientItems.includes('limit_up_down_daily_state'),
        suspensionState: !String(tradeConstraintAudit.suspensionConstraint || '').includes('not_available'),
      },
      benchmark,
      tradeConstraintAudit,
      validationImpact: {
        validationEvidenceStatusMustBeInsufficient: !ready,
        blockers: [
          ...(!benchmarkReady ? ['total_return_benchmark_missing_or_proxy'] : []),
          ...insufficientItems,
        ],
      },
    }
  }
}

export const dividendLowVolTotalReturnAuditService = new DividendLowVolTotalReturnAuditService()
