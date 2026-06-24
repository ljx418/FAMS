import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Point = {
  date: string
  value: number
  evidenceRef?: string
}

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

function normalize(raw: unknown, source: string): Point[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.points)
      ? (raw as any).points
      : Array.isArray((raw as any)?.data)
        ? (raw as any).data
        : Array.isArray((raw as any)?.data?.klines)
          ? (raw as any).data.klines
          : []
  return rows
    .map((row: any): Point | null => {
      if (typeof row === 'string') {
        const [date, open, close] = row.split(',')
        const value = Number(close || open)
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0
          ? { date, value, evidenceRef: `${source}:kline:${date}` }
          : null
      }
      const date = String(row.date || row.tradeDate || row.f51 || '')
      const value = Number(row.value ?? row.close ?? row.f53 ?? row.f2)
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0
        ? { date, value, evidenceRef: row.evidenceRef || `${source}:point:${date}` }
        : null
    })
    .filter((point): point is Point => Boolean(point))
    .sort((left, right) => left.date.localeCompare(right.date))
}

async function main() {
  const input = arg('input')
  const output = resolve(process.cwd(), arg('output') || 'data/market-benchmarks/h30269-total-return-free-source.json')
  const source = arg('source') || 'free_source_manual_import'
  if (!input) {
    const audit = {
      ok: false,
      status: 'missing_input',
      usage: 'npm run run:dividend-low-vol-free-benchmark-import -- --input=/path/to/free-source.json',
      output,
      requiredFormat: 'Array<{date,value}> or Eastmoney kline JSON with data.klines',
    }
    console.log(JSON.stringify(audit, null, 2))
    process.exitCode = 1
    return
  }
  const raw = JSON.parse(await readFile(resolve(process.cwd(), input), 'utf8'))
  const points = normalize(raw, source)
  await mkdir(resolve(output, '..'), { recursive: true })
  const artifact = {
    schemaVersion: 'dividend.low_vol.free_source_total_return_benchmark.v1',
    generatedAt: new Date().toISOString(),
    name: 'CSI Dividend Low Volatility Index H30269 free-source total-return benchmark',
    source,
    pointCount: points.length,
    points,
    evidenceRefs: points.map((point) => point.evidenceRef).filter(Boolean).slice(0, 50),
    validation: {
      status: points.length >= 60 ? 'available' : 'insufficient',
      blockers: points.length >= 60 ? [] : ['free_source_total_return_benchmark_sample_insufficient'],
    },
  }
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    output,
    pointCount: points.length,
    status: artifact.validation.status,
    blockers: artifact.validation.blockers,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
