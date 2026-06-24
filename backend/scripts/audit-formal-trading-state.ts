import 'dotenv/config'
import { securityStatusService } from '../src/services/market-data/securityStatusService.js'
import { prisma } from '../src/db/prisma.js'

function parseSymbols() {
  const raw = process.argv.find((item) => item.startsWith('--symbols='))?.slice('--symbols='.length)
    || process.env.FAMS_FORMAL_TRADING_STATE_SYMBOLS
    || process.env.FAMS_READINESS_SYMBOLS
    || '000001,600000'
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d{6}$/.test(item))
}

async function main() {
  const symbols = parseSymbols()
  const tushareConfigured = Boolean(process.env.FAMS_TUSHARE_TOKEN || process.env.TUSHARE_TOKEN)
  const coverage = tushareConfigured
    ? await securityStatusService.upsertTushareTradingStatus(symbols)
    : await securityStatusService.getCoverageSnapshot(symbols)
  const freeSourceReady = coverage.symbolsWithStatus > 0
    && coverage.symbolsWithTradeability > 0
    && coverage.officialProviderRows > 0
  const formalStateReady = coverage.formalTradingStateRows > 0
  const formalLimitReady = formalStateReady && coverage.fieldCoverage.limitPricePercent >= 80
  const formalLimitCoveragePercent = formalStateReady ? coverage.fieldCoverage.limitPricePercent : 0
  const report = {
    schemaVersion: 'fams.market.formal_trading_state_audit.v1',
    generatedAt: new Date().toISOString(),
    symbols,
    status: formalStateReady && formalLimitReady ? 'formal_source_ready' : freeSourceReady ? 'manual_review_required' : 'blocked',
    policy: {
      researchAllowed: freeSourceReady,
      manualTradeDraftAllowed: freeSourceReady,
      formalTradeExecutionAllowed: false,
      autoTradeAllowed: false,
    },
    gates: [
      {
        id: 'free_source_security_coverage',
        status: freeSourceReady ? 'passed' : 'failed',
        message: freeSourceReady
          ? `免费源证券状态覆盖可用于研究/人工草案：status=${coverage.symbolsWithStatus}, tradeability=${coverage.symbolsWithTradeability}。`
          : '免费源证券状态覆盖不足，不能生成可靠人工交易草案。',
      },
      {
        id: 'formal_trading_state_source',
        status: formalStateReady ? 'passed' : 'warning',
        message: formalStateReady
          ? `已存在 ${coverage.formalTradingStateRows} 行 Tushare/交易所正式交易状态事实。`
          : '未配置或未写入 Tushare/交易所正式交易状态源；执行前必须人工复核停复牌、ST、涨跌停和交易可用性。',
      },
      {
        id: 'formal_limit_price_coverage',
        status: formalLimitReady ? 'passed' : 'warning',
        message: formalLimitReady
          ? `正式源涨跌停价覆盖率 ${formalLimitCoveragePercent}%。`
          : `正式源涨跌停价覆盖率 ${formalLimitCoveragePercent}%；不得自动执行交易。`,
      },
      {
        id: 'auto_trade_policy',
        status: 'passed',
        message: 'AUTO_TRADE 保持禁止；正式 ADD/REDUCE 仍需人工确认和执行前状态复核。',
      },
    ],
    requiredManualChecks: [
      '停复牌状态',
      '涨跌停价和当前是否可买入/卖出',
      'ST/退市风险标记',
      '成交额/流动性是否满足策略约束',
      '持仓、现金、单标的集中度和人工审批记录',
    ],
    coverage,
    nextActions: [
      ...(formalStateReady ? [] : ['配置 FAMS_TUSHARE_TOKEN / TUSHARE_TOKEN，或接入交易所正式状态源后重跑本审计。']),
      ...(formalLimitReady ? [] : ['补齐正式源涨跌停价字段，执行前保持人工复核。']),
    ],
  }
  console.log(JSON.stringify(report, null, 2))
  if (!freeSourceReady) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
