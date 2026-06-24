import { stockScreenerService } from '../src/services/screener/stockScreenerService.js'
import { prisma } from '../src/db/prisma.js'

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

async function main() {
  const userId = process.env.FAMS_FACTSET_PREHEAT_USER_ID || 'default'
  const report = await stockScreenerService.preheatScreenerFactsets(userId, {
    maxScan: numberEnv('FAMS_FACTSET_PREHEAT_MAX_SCAN', 120),
    limit: numberEnv('FAMS_FACTSET_PREHEAT_LIMIT', 120),
    concurrency: numberEnv('FAMS_FACTSET_PREHEAT_CONCURRENCY', 2),
    offset: numberEnv('FAMS_FACTSET_PREHEAT_OFFSET', 0),
    batchSize: numberEnv('FAMS_FACTSET_PREHEAT_BATCH_SIZE', 300),
    perSymbolTimeoutMs: numberEnv('FAMS_FACTSET_PREHEAT_TIMEOUT_MS', 20_000),
    forceRefresh: /^(1|true|yes)$/i.test(process.env.FAMS_FACTSET_PREHEAT_FORCE || ''),
    symbols: (process.env.FAMS_FACTSET_PREHEAT_SYMBOLS || '').split(',').map((item) => item.trim()).filter(Boolean),
    onProgress: (progress) => {
      console.log(JSON.stringify({
        event: 'screener_factset_preheat_progress',
        ...progress,
      }, null, 2))
    },
  })

  console.log(JSON.stringify({
    event: 'screener_factset_preheat_finished',
    universeSource: report.universeSource,
    universeTotal: report.universeTotal,
    requestedSymbols: report.requestedSymbols,
    attemptedSymbols: report.attemptedSymbols,
    successSymbols: report.successSymbols,
    failureSymbols: report.failureSymbols,
    nextOffset: report.nextOffset,
    remainingTargetSymbols: report.remainingTargetSymbols,
    elapsedMs: report.elapsedMs,
    options: report.options,
    initialFullCoverage: (report.initialCoverage as any)?.scanned?.fullOfficialCoveragePercent,
    finalFullCoverage: (report.finalCoverage as any)?.scanned?.fullOfficialCoveragePercent,
    progress: report.progress,
    failureCategorySummary: report.failureCategorySummary,
    failures: report.failures,
    warnings: report.warnings,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
