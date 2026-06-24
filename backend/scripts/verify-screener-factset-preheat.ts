import { stockScreenerService } from '../src/services/screener/stockScreenerService.js'
import { prisma } from '../src/db/prisma.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function main() {
  requireDevDbMutationAcknowledgement('verify-screener-factset-preheat')

  const report = await stockScreenerService.preheatScreenerFactsets('default', {
    maxScan: 1,
    limit: 1,
    concurrency: 1,
    forceRefresh: true,
    symbols: ['601127'],
  })

  if (report.schemaVersion !== 'fams.screener.factset_preheat_run.v1') {
    throw new Error(`Unexpected schemaVersion ${report.schemaVersion}`)
  }
  if (report.requestedSymbols !== 1) {
    throw new Error(`Expected requestedSymbols=1, got ${report.requestedSymbols}`)
  }
  if (report.plannedSymbols > 1 || report.attemptedSymbols > 1) {
    throw new Error('Expected preheat verification to stay bounded to 1 symbol')
  }
  const finalFullCoverage = (report.finalCoverage as any)?.scanned?.fullOfficialCoveragePercent
  if (typeof finalFullCoverage !== 'number') {
    throw new Error('Expected final coverage percent to be numeric')
  }
  if (report.universeSource !== 'sina_hs_a_all_a_share') {
    throw new Error(`Expected verified full A universe source, got ${report.universeSource}`)
  }
  if (finalFullCoverage < 100) {
    throw new Error(`Expected 601127 factset coverage to reach 100%, got ${finalFullCoverage}%`)
  }
  if (report.failureSymbols !== 0) {
    throw new Error(`Expected unresolved factset failures to be 0, got ${report.failureSymbols}`)
  }

  console.log(JSON.stringify({
    ok: true,
    universeSource: report.universeSource,
    universeTotal: report.universeTotal,
    requestedSymbols: report.requestedSymbols,
    attemptedSymbols: report.attemptedSymbols,
    successSymbols: report.successSymbols,
    failureSymbols: report.failureSymbols,
    initialFullCoverage: (report.initialCoverage as any)?.scanned?.fullOfficialCoveragePercent,
    finalFullCoverage,
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
