import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type FreeSourceBenchmarkPoint = {
  date: string
  value: number
  evidenceRef?: string
}

export type FreeSourceBenchmarkLoadResult = {
  status: 'available' | 'missing' | 'invalid'
  path: string
  name: string
  source: string
  points: FreeSourceBenchmarkPoint[]
  blockers: string[]
}

const DEFAULT_PATH = resolve(process.cwd(), 'data/market-benchmarks/h30269-total-return-free-source.json')

export class DividendLowVolFreeSourceBenchmarkService {
  loadLocalTotalReturnBenchmark(path = process.env.FAMS_H30269_FREE_SOURCE_BENCHMARK_PATH || DEFAULT_PATH): FreeSourceBenchmarkLoadResult {
    if (!existsSync(path)) {
      return {
        status: 'missing',
        path,
        name: 'CSI Dividend Low Volatility Index H30269 free-source total-return benchmark',
        source: 'local_free_source_file',
        points: [],
        blockers: ['free_source_total_return_benchmark_file_missing'],
      }
    }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        name?: string
        source?: string
        points?: FreeSourceBenchmarkPoint[]
        data?: FreeSourceBenchmarkPoint[]
      } | FreeSourceBenchmarkPoint[]
      const points = (Array.isArray(parsed) ? parsed : parsed.points || parsed.data || [])
        .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(String(point.date)) && Number.isFinite(point.value) && point.value > 0)
        .sort((left, right) => left.date.localeCompare(right.date))
      if (points.length < 60) {
        return {
          status: 'invalid',
          path,
          name: Array.isArray(parsed) ? 'CSI Dividend Low Volatility Index H30269 free-source total-return benchmark' : parsed.name || 'CSI Dividend Low Volatility Index H30269 free-source total-return benchmark',
          source: Array.isArray(parsed) ? 'local_free_source_file' : parsed.source || 'local_free_source_file',
          points,
          blockers: ['free_source_total_return_benchmark_sample_insufficient'],
        }
      }
      return {
        status: 'available',
        path,
        name: Array.isArray(parsed) ? 'CSI Dividend Low Volatility Index H30269 free-source total-return benchmark' : parsed.name || 'CSI Dividend Low Volatility Index H30269 free-source total-return benchmark',
        source: Array.isArray(parsed) ? 'local_free_source_file' : parsed.source || 'local_free_source_file',
        points,
        blockers: [],
      }
    } catch {
      return {
        status: 'invalid',
        path,
        name: 'CSI Dividend Low Volatility Index H30269 free-source total-return benchmark',
        source: 'local_free_source_file',
        points: [],
        blockers: ['free_source_total_return_benchmark_parse_failed'],
      }
    }
  }
}

export const dividendLowVolFreeSourceBenchmarkService = new DividendLowVolFreeSourceBenchmarkService()
