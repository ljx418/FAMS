import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

async function optionalMtime(path: string) {
  return stat(path).then((item) => item.mtimeMs).catch(() => undefined)
}

async function main() {
  const tempDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(tempDir, { recursive: true })
  const tempCsv = resolve(tempDir, `dividend-low-vol-public-seed-import-smoke-${Date.now()}.csv`)
  await writeFile(tempCsv, [
    'symbol,sourceUrl,asOf,dividend_2024,dividend_2023,dividend_2022,payoutRatio,roe,ocfToNetProfit,debtToAsset,profitGrowth3y,pe,pb,industryDividendYieldPercentile',
    '1965,public-smoke:001965,2026-06-06,0.62,0.55,0.49,0.55,0.11,1.12,0.42,0.08,12.5,1.4,76',
  ].join('\n') + '\n', 'utf8')

  const dividendPath = resolve(process.cwd(), 'data/dividend-low-vol-public-dividend-seed.json')
  const fundamentalPath = resolve(process.cwd(), 'data/dividend-low-vol-public-fundamental-seed.json')
  const beforeDividendMtime = await optionalMtime(dividendPath)
  const beforeFundamentalMtime = await optionalMtime(fundamentalPath)
  const { stdout } = await execFile(process.execPath, [
    'node_modules/tsx/dist/cli.mjs',
    'scripts/run-dividend-low-vol-public-seed-import.ts',
    `--file=${tempCsv}`,
    '--dryRun',
  ], { cwd: process.cwd() })
  const result = JSON.parse(stdout)
  const afterDividendMtime = await optionalMtime(dividendPath)
  const afterFundamentalMtime = await optionalMtime(fundamentalPath)
  await unlink(tempCsv).catch(() => undefined)

  if (!result.ok || result.dryRun !== true || result.writeApplied !== false) {
    throw new Error(`Expected dry-run import without writes, got ${stdout}`)
  }
  if (result.skipped?.length) {
    throw new Error(`Expected numeric symbol to be normalized to 6 digits, skipped=${JSON.stringify(result.skipped)}`)
  }
  if (result.dividendUpdated !== 1 || result.fundamentalUpdated !== 1) {
    throw new Error(`Expected one dividend and one fundamental update in dry-run, got ${stdout}`)
  }
  if (beforeDividendMtime !== afterDividendMtime || beforeFundamentalMtime !== afterFundamentalMtime) {
    throw new Error('Dry-run import changed seed file mtimes')
  }
  console.log(JSON.stringify({
    ok: true,
    dryRun: result.dryRun,
    dividendUpdated: result.dividendUpdated,
    fundamentalUpdated: result.fundamentalUpdated,
    skipped: result.skipped,
    writeApplied: result.writeApplied,
    note: 'Public seed import dry-run preserves files and handles CSV numeric symbols with leading zero padding.',
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
