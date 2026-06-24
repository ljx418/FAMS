import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dividendLowVolFormalProviderIngestionService } from '../src/services/dividend-low-vol/formalProviderIngestionService.js'

function parseSymbols() {
  const raw = process.argv.find((item) => item.startsWith('--symbols='))?.slice('--symbols='.length)
    || process.env.FAMS_DIVIDEND_LOW_VOL_PROVIDER_SYMBOLS
    || '000001,600000'
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d{6}$/.test(item))
}

function parseArg(name: string) {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run') || /^(1|true|yes)$/i.test(process.env.FAMS_DIVIDEND_LOW_VOL_PROVIDER_DRY_RUN || '')
  const result = await dividendLowVolFormalProviderIngestionService.runTushareProbe({
    symbols: parseSymbols(),
    tradeDate: parseArg('trade-date') || process.env.FAMS_DIVIDEND_LOW_VOL_PROVIDER_TRADE_DATE,
    reportPeriod: parseArg('period') || process.env.FAMS_DIVIDEND_LOW_VOL_PROVIDER_PERIOD,
    dryRun,
  })
  const dir = resolve(process.cwd(), 'data/gpt-audit/dividend-low-vol-provider-ingestion')
  await mkdir(dir, { recursive: true })
  const fileName = `provider-ingestion-${result.generatedAt.replace(/[:.]/g, '-')}.json`
  const path = resolve(dir, fileName)
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: result.status !== 'blocked_provider_not_configured',
    status: result.status,
    dryRun,
    tokenInAuditPackage: result.tokenInAuditPackage,
    summary: result.summary,
    path,
    prohibitedActions: result.prohibitedActions,
  }, null, 2))
  if (result.status === 'blocked_provider_not_configured') {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
