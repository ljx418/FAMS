import { alertService } from '../src/services/alert/alertService.js'

const USER_ID = 'default'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  const rules = await alertService.getMarketWatchRules(USER_ID)
  assert(rules.length >= 5, `Expected at least 5 market watch rules, got ${rules.length}`)
  assert(rules.some((rule) => rule.symbol === '000001.SH' && rule.thresholdPercent === 10), 'Missing default 上证指数 10% rule')

  const evaluations = await alertService.evaluateMarketWatch(USER_ID)
  assert(evaluations.length > 0, 'Expected market watch evaluations')

  const shComposite = evaluations.find((item) => item.symbol === '000001.SH')
  assert(shComposite, 'Missing 上证指数 evaluation')

  for (const item of evaluations) {
    assert(item.thresholdPercent > 0, `${item.symbol} threshold must be positive`)
    assert(item.windowDays >= 30, `${item.symbol} windowDays must be >= 30`)

    if (item.dataStatus === 'ok') {
      assert(item.latestPrice !== null && item.latestPrice > 0, `${item.symbol} latest price must be positive`)
      assert(item.peakPrice !== null && item.peakPrice >= item.latestPrice, `${item.symbol} peak must be >= latest price`)
      assert(item.drawdownPercent !== null && item.drawdownPercent >= 0, `${item.symbol} drawdown must be non-negative`)
      assert(Boolean(item.latestDate), `${item.symbol} latest date is required`)
      assert(Boolean(item.peakDate), `${item.symbol} peak date is required`)
    } else {
      assert(item.message.length > 0, `${item.symbol} failure message is required`)
    }
  }

  const triggeredSymbols = await alertService.checkAndGenerateMarketWatchAlerts(USER_ID)
  assert(Array.isArray(triggeredSymbols), 'Triggered symbols must be an array')

  console.log(JSON.stringify({
    ok: true,
    rules: rules.length,
    evaluations: evaluations.length,
    triggeredSymbols,
    shComposite,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
