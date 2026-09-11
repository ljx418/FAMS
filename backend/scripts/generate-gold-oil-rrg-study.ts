import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { prisma } from '../src/db/prisma.js'
import {
  relativeRotationService,
  type RelativeRotationSeriesPoint,
} from '../src/services/relative-rotation/relativeRotationService.js'
import {
  getEastmoneyQfqStockHistory,
  getTencentQfqStockHistory,
} from '../src/utils/stockUtils.js'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputDirectory = path.join(repoRoot, 'docs/generated')
const htmlPath = path.join(outputDirectory, 'gold-oil-rrg-one-year.html')
const jsonPath = path.join(outputDirectory, 'gold-oil-rrg-one-year.json')
const etfValidationPath = path.join(outputDirectory, 'gold-oil-etf-provider-validation.json')

type PricePoint = { date: string; close: number; source?: string }
type ReturnPoint = { date: string; value: number }

const instruments = [
  { symbol: '518880', name: '华安黄金ETF', shortName: '黄金ETF', color: '#d79a18' },
  { symbol: '513350', name: '富国标普油气ETF', shortName: '油气ETF', color: '#2877d4' },
] as const

const round = (value: number | null, digits = 4) => {
  if (value === null || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const subtractCalendarDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() - days)
  return value.toISOString().slice(0, 10)
}

const returns = (points: PricePoint[]): ReturnPoint[] => {
  const result: ReturnPoint[] = []
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].close
    const current = points[index].close
    if (previous > 0 && current > 0) result.push({ date: points[index].date, value: Math.log(current / previous) })
  }
  return result
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

const correlation = (left: number[], right: number[]) => {
  if (left.length !== right.length || left.length < 3) return null
  const leftMean = mean(left)
  const rightMean = mean(right)
  let covariance = 0
  let leftVariance = 0
  let rightVariance = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean
    const rightDelta = right[index] - rightMean
    covariance += leftDelta * rightDelta
    leftVariance += leftDelta * leftDelta
    rightVariance += rightDelta * rightDelta
  }
  if (leftVariance <= 0 || rightVariance <= 0) return null
  return covariance / Math.sqrt(leftVariance * rightVariance)
}

const ranks = (values: number[]) => {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const result = Array(values.length).fill(0) as number[]
  let index = 0
  while (index < sorted.length) {
    let end = index + 1
    while (end < sorted.length && sorted[end].value === sorted[index].value) end += 1
    const averageRank = ((index + 1) + end) / 2
    for (let cursor = index; cursor < end; cursor += 1) result[sorted[cursor].index] = averageRank
    index = end
  }
  return result
}

const fisherInterval = (value: number | null, sampleSize: number) => {
  if (value === null || sampleSize <= 3 || Math.abs(value) >= 1) return { low: null, high: null }
  const z = Math.atanh(value)
  const delta = 1.96 / Math.sqrt(sampleSize - 3)
  return { low: Math.tanh(z - delta), high: Math.tanh(z + delta) }
}

const partialCorrelation = (xy: number | null, xz: number | null, yz: number | null) => {
  if (xy === null || xz === null || yz === null) return null
  const denominator = Math.sqrt((1 - xz ** 2) * (1 - yz ** 2))
  return denominator > 0 ? (xy - xz * yz) / denominator : null
}

const maxDrawdown = (points: PricePoint[]) => {
  let peak = 0
  let drawdown = 0
  for (const point of points) {
    peak = Math.max(peak, point.close)
    if (peak > 0) drawdown = Math.min(drawdown, point.close / peak - 1)
  }
  return drawdown
}

const volatility = (values: number[]) => {
  if (values.length < 2) return null
  const average = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252)
}

const curlText = async (url: string, timeoutSeconds = 20) => {
  const { stdout } = await execFileAsync('curl', [
    '-L', '--silent', '--show-error', '--max-time', String(timeoutSeconds),
    '--retry', '3', '--retry-delay', '1', '--retry-all-errors',
    '-A', 'Mozilla/5.0', url,
  ], { maxBuffer: 24 * 1024 * 1024 })
  return stdout.toString()
}

const fetchEastmoneyDollarIndex = async (): Promise<{ points: PricePoint[]; sourceUrl: string }> => {
  const sourceUrl = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.UDI&fields1=f1%2Cf2%2Cf3%2Cf4%2Cf5%2Cf6&fields2=f51%2Cf52%2Cf53%2Cf54%2Cf55%2Cf56%2Cf57%2Cf58%2Cf59%2Cf60%2Cf61&klt=101&fqt=0&beg=20250801&end=20500101&lmt=5000'
  const payload = JSON.parse(await curlText(sourceUrl))
  const klines: string[] = payload?.data?.klines || []
  const points = klines.map((line) => {
    const fields = line.split(',')
    return { date: fields[0], close: Number(fields[2]), source: 'eastmoney:100.UDI' }
  }).filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.close) && point.close > 0)
  if (points.length < 200) throw new Error(`美元指数样本不足：${points.length}/200`)
  return { points, sourceUrl }
}

const fetchSinaDollarIndex = async (): Promise<{ points: PricePoint[]; sourceUrl: string }> => {
  const sourceUrl = 'https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20DINIW=/NewForexService.getDayKLine?symbol=DINIW'
  const raw = await curlText(sourceUrl)
  const body = raw.match(/DINIW=\("([\s\S]*)"\)/)?.[1] || ''
  const points = body.split('|').map((line) => {
    const fields = line.split(',')
    return { date: fields[0], close: Number(fields[4]), source: 'sina:DINIW' }
  }).filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.close) && point.close > 0)
  if (points.length < 200) throw new Error(`新浪美元指数样本不足：${points.length}/200`)
  return { points, sourceUrl }
}

const seriesMap = (points: ReturnPoint[]) => new Map(points.map((point) => [point.date, point.value]))

const alignPairReturns = (left: PricePoint[], right: PricePoint[], cutoff: string, endDate: string) => {
  const leftReturns = seriesMap(returns(left))
  const rightReturns = seriesMap(returns(right))
  return Array.from(leftReturns.keys())
    .filter((date) => date >= cutoff && date <= endDate && rightReturns.has(date))
    .sort()
    .map((date) => ({ date, left: leftReturns.get(date)!, right: rightReturns.get(date)! }))
}

const laggedDollarReturn = (dollarReturns: ReturnPoint[], cnDate: string) => {
  for (let index = dollarReturns.length - 1; index >= 0; index -= 1) {
    if (dollarReturns[index].date < cnDate) {
      const days = (Date.parse(`${cnDate}T00:00:00Z`) - Date.parse(`${dollarReturns[index].date}T00:00:00Z`)) / 86_400_000
      return days <= 4 ? dollarReturns[index] : null
    }
  }
  return null
}

const isoWeekKey = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`)
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() - day + 1)
  return value.toISOString().slice(0, 10)
}

const weeklyPoints = (points: PricePoint[]) => {
  const byWeek = new Map<string, PricePoint>()
  for (const point of points) byWeek.set(isoWeekKey(point.date), point)
  return Array.from(byWeek.values()).sort((a, b) => a.date.localeCompare(b.date))
}

const rollingCorrelation = (pairs: Array<{ date: string; left: number; right: number }>, window: number) => {
  const result: Array<{ date: string; value: number }> = []
  for (let index = window - 1; index < pairs.length; index += 1) {
    const slice = pairs.slice(index - window + 1, index + 1)
    const value = correlation(slice.map((point) => point.left), slice.map((point) => point.right))
    if (value !== null) result.push({ date: pairs[index].date, value })
  }
  return result
}

const segmentCorrelations = (pairs: Array<{ date: string; left: number; right: number }>) => {
  const segmentSize = Math.ceil(pairs.length / 4)
  return [0, 1, 2, 3].map((segment) => {
    const slice = pairs.slice(segment * segmentSize, Math.min(pairs.length, (segment + 1) * segmentSize))
    return {
      startDate: slice[0]?.date || null,
      endDate: slice.at(-1)?.date || null,
      sampleSize: slice.length,
      correlation: correlation(slice.map((point) => point.left), slice.map((point) => point.right)),
    }
  }).filter((segment) => segment.sampleSize > 0)
}

const escapeHtml = (value: unknown) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const pct = (value: number | null, digits = 2) => value === null ? '—' : `${(value * 100).toFixed(digits)}%`
const decimal = (value: number | null, digits = 3) => value === null ? '—' : value.toFixed(digits)

const main = async () => {
  const previousPayload = await readFile(jsonPath, 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => null)
  const retainedEtfValidation = await readFile(etfValidationPath, 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => null)
  const refreshMarketData = process.argv.includes('--refresh')
  const histories: Record<string, PricePoint[]> = {}
  const rotations: Record<string, Awaited<ReturnType<typeof relativeRotationService.computeSymbol>>> = {}
  for (const instrument of instruments) {
    histories[instrument.symbol] = await relativeRotationService.ensureQfqHistory(instrument.symbol, { days: 800, refresh: refreshMarketData })
    rotations[instrument.symbol] = await relativeRotationService.computeSymbol({
      symbol: instrument.symbol,
      frequency: 'weekly',
      trail: 52,
      days: 800,
      refresh: false,
      persist: false,
    })
  }

  const etfProviderCrossChecks = await Promise.all(instruments.map(async (instrument) => {
    try {
      const [eastmoney, tencent] = await Promise.all([
        getEastmoneyQfqStockHistory(instrument.symbol, 300),
        getTencentQfqStockHistory(instrument.symbol, 300),
      ])
      const eastmoneyByDate = new Map(eastmoney.map((point) => [point.date, point.close]))
      const common = tencent.filter((point) => eastmoneyByDate.has(point.date))
      const differences = common
        .map((point) => Math.abs(point.close / eastmoneyByDate.get(point.date)! - 1))
        .sort((a, b) => a - b)
      const retained = retainedEtfValidation?.items?.find((item: { symbol?: string }) => item.symbol === instrument.symbol)
      if (common.length < 200 && retained?.status === 'passed' && retained?.commonSampleSize >= 200) {
        return {
          ...retained,
          status: 'retained_passed' as const,
          error: `live_provider_returned_insufficient_common_sample:${common.length}/200`,
        }
      }
      return {
        symbol: instrument.symbol,
        status: common.length >= 200 ? 'passed' as const : 'insufficient' as const,
        commonSampleSize: common.length,
        latestCommonDate: common.at(-1)?.date || null,
        eastmoneyLatestClose: eastmoney.at(-1)?.close || null,
        tencentLatestClose: tencent.at(-1)?.close || null,
        medianAbsoluteDifferencePct: differences.length > 0 ? differences[Math.floor(differences.length / 2)] * 100 : null,
        latestAbsoluteDifferencePct: common.length > 0
          ? Math.abs(common.at(-1)!.close / eastmoneyByDate.get(common.at(-1)!.date)! - 1) * 100
          : null,
        error: null,
      }
    } catch (error) {
      const retained = retainedEtfValidation?.items?.find((item: { symbol?: string }) => item.symbol === instrument.symbol)
      if (retained?.status === 'passed' && retained?.commonSampleSize >= 200) {
        return {
          ...retained,
          status: 'retained_passed' as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
      return {
        symbol: instrument.symbol,
        status: 'provider_failed' as const,
        commonSampleSize: 0,
        latestCommonDate: null,
        eastmoneyLatestClose: null,
        tencentLatestClose: null,
        medianAbsoluteDifferencePct: null,
        latestAbsoluteDifferencePct: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }))

  const dollar = await fetchSinaDollarIndex()
  let dollarCrossCheck: Awaited<ReturnType<typeof fetchEastmoneyDollarIndex>> | null = null
  let dollarCrossCheckError: string | null = null
  try {
    dollarCrossCheck = await fetchEastmoneyDollarIndex()
  } catch (error) {
    dollarCrossCheckError = error instanceof Error ? error.message : String(error)
  }

  const commonEndDate = instruments.map((instrument) => histories[instrument.symbol].at(-1)?.date || '').sort()[0]
  const cutoff = subtractCalendarDays(commonEndDate, 365)
  const goldWindow = histories['518880'].filter((point) => point.date >= cutoff && point.date <= commonEndDate)
  const oilWindow = histories['513350'].filter((point) => point.date >= cutoff && point.date <= commonEndDate)
  const dollarWindow = dollar.points.filter((point) => point.date >= subtractCalendarDays(cutoff, 7) && point.date <= commonEndDate)
  const pairs = alignPairReturns(histories['518880'], histories['513350'], cutoff, commonEndDate)
  const goldValues = pairs.map((point) => point.left)
  const oilValues = pairs.map((point) => point.right)
  const dailyCorrelation = correlation(goldValues, oilValues)
  const spearmanCorrelation = correlation(ranks(goldValues), ranks(oilValues))
  const dailyCorrelationCi = fisherInterval(dailyCorrelation, pairs.length)
  const weeklyPairs = alignPairReturns(weeklyPoints(histories['518880']), weeklyPoints(histories['513350']), cutoff, commonEndDate)
  const weeklyCorrelation = correlation(weeklyPairs.map((point) => point.left), weeklyPairs.map((point) => point.right))
  const rolling20 = rollingCorrelation(pairs, 20)
  const negativeRollingShare = rolling20.length > 0 ? rolling20.filter((point) => point.value < 0).length / rolling20.length : null
  const oppositeSignShare = pairs.length > 0
    ? pairs.filter((point) => Math.sign(point.left) !== Math.sign(point.right) && point.left !== 0 && point.right !== 0).length / pairs.length
    : null

  const dollarReturns = returns(dollar.points)
  const dollarAligned = pairs.map((point) => ({ ...point, dollar: laggedDollarReturn(dollarReturns, point.date) }))
    .filter((point): point is typeof point & { dollar: ReturnPoint } => point.dollar !== null)
  const factorGold = dollarAligned.map((point) => point.left)
  const factorOil = dollarAligned.map((point) => point.right)
  const factorDollar = dollarAligned.map((point) => point.dollar.value)
  const goldDollarCorrelation = correlation(factorGold, factorDollar)
  const oilDollarCorrelation = correlation(factorOil, factorDollar)
  const pairFactorCorrelation = correlation(factorGold, factorOil)
  const controlledCorrelation = partialCorrelation(pairFactorCorrelation, goldDollarCorrelation, oilDollarCorrelation)

  const crossCheckByDate = new Map((dollarCrossCheck?.points || []).map((point) => [point.date, point.close]))
  const commonDollarDates = dollar.points.filter((point) => point.date >= cutoff && crossCheckByDate.has(point.date))
  const crossCheckMapes = commonDollarDates.map((point) => Math.abs(point.close / crossCheckByDate.get(point.date)! - 1))
  const dollarMedianMape = crossCheckMapes.length > 0 ? [...crossCheckMapes].sort((a, b) => a - b)[Math.floor(crossCheckMapes.length / 2)] : null
  const dollarLatestCommon = [...commonDollarDates].reverse().find((point) => crossCheckByDate.has(point.date)) || null
  const dollarLatestDiff = dollarLatestCommon ? Math.abs(dollarLatestCommon.close / crossCheckByDate.get(dollarLatestCommon.date)! - 1) : null

  const instrumentMetrics = instruments.map((instrument) => {
    const history = histories[instrument.symbol].filter((point) => point.date >= cutoff && point.date <= commonEndDate)
    const values = returns(history).map((point) => point.value)
    const latestRotation = rotations[instrument.symbol].points.at(-1)
    return {
      ...instrument,
      sampleSize: history.length,
      firstDate: history[0]?.date || null,
      lastDate: history.at(-1)?.date || null,
      firstClose: history[0]?.close || null,
      lastClose: history.at(-1)?.close || null,
      totalReturn: history.length > 1 ? history.at(-1)!.close / history[0].close - 1 : null,
      annualizedVolatility: volatility(values),
      maxDrawdown: maxDrawdown(history),
      dataStatus: rotations[instrument.symbol].dataStatus,
      totalHistorySize: histories[instrument.symbol].length,
      coveragePercent: rotations[instrument.symbol].coveragePercent,
      blockers: rotations[instrument.symbol].blockers,
      source: history.at(-1)?.source || 'unknown',
      latestRotation,
    }
  })

  const segments = segmentCorrelations(pairs)
  const pronouncedAntagonism = dailyCorrelation !== null
    && dailyCorrelation <= -0.3
    && dailyCorrelationCi.high !== null
    && dailyCorrelationCi.high < 0
    && negativeRollingShare !== null
    && negativeRollingShare >= 0.7
    && oppositeSignShare !== null
    && oppositeSignShare >= 0.6
    && controlledCorrelation !== null
    && controlledCorrelation <= -0.2
  const moderateAntagonism = !pronouncedAntagonism
    && dailyCorrelation !== null
    && dailyCorrelation <= -0.15
    && negativeRollingShare !== null
    && negativeRollingShare >= 0.6
  const conclusion = pronouncedAntagonism
    ? '近一年存在较明显且较稳定的负相关，但仍不能仅凭观察数据断言由美元造成。'
    : moderateAntagonism
      ? '近一年有一定负相关迹象，但稳定性或强度不足，不能称为明显拮抗。'
      : '近一年没有形成稳定、显著的“此消彼长”拮抗关系。'
  const dollarMechanismSupported = goldDollarCorrelation !== null && oilDollarCorrelation !== null
    && Math.sign(goldDollarCorrelation) !== Math.sign(oilDollarCorrelation)
    && Math.abs(goldDollarCorrelation) >= 0.2
    && Math.abs(oilDollarCorrelation) >= 0.2
  const dollarConclusion = dollarMechanismSupported
    ? '两只ETF对前一交易日美元指数的方向相反且相关幅度达到观察阈值，美元机制存在相关性支持，但不是因果证明。'
    : '两只ETF对前一交易日美元指数未呈现强而方向相反的暴露，数据不支持“主要因为美元”这一解释。'

  const liveDollarCrossCheck = dollarCrossCheck ? {
    provider: 'eastmoney:100.UDI',
    sampleSize: crossCheckMapes.length,
    medianAbsoluteDifferencePct: dollarMedianMape === null ? null : dollarMedianMape * 100,
    latestCommonDate: dollarLatestCommon?.date || null,
    latestAbsoluteDifferencePct: dollarLatestDiff === null ? null : dollarLatestDiff * 100,
    error: null,
  } : null
  const retainedDollarCrossCheck = previousPayload?.dollarFactor?.crossCheck?.sampleSize > 0
    ? {
        ...previousPayload.dollarFactor.crossCheck,
        provider: 'retained_eastmoney_vs_sina_validation',
        error: dollarCrossCheckError,
      }
    : null

  const payload = {
    schemaVersion: 'gold_oil_rrg_study.v1',
    generatedAt: new Date().toISOString(),
    period: { cutoff, commonEndDate, calendarDays: 365 },
    benchmark: { symbol: '000300.SH', name: '沪深300价格指数' },
    formula: {
      version: 'transparent_relative_rotation.v1',
      note: '周频相对价格=ETF/沪深300；趋势为EMA(10)/EMA(30)归一至100；动量为趋势EMA(4)/EMA(12)归一至100。',
    },
    instruments: instrumentMetrics,
    rrg: Object.fromEntries(instruments.map((instrument) => [instrument.symbol, rotations[instrument.symbol].points])),
    normalizedPerformance: {
      gold: goldWindow.map((point) => ({ date: point.date, value: point.close / goldWindow[0].close * 100 })),
      oil: oilWindow.map((point) => ({ date: point.date, value: point.close / oilWindow[0].close * 100 })),
      dollar: dollarWindow.map((point) => ({ date: point.date, value: point.close / dollarWindow[0].close * 100 })),
    },
    relationship: {
      dailySampleSize: pairs.length,
      dailyPearson: dailyCorrelation,
      dailyPearson95Ci: dailyCorrelationCi,
      dailySpearman: spearmanCorrelation,
      weeklySampleSize: weeklyPairs.length,
      weeklyPearson: weeklyCorrelation,
      rolling20Count: rolling20.length,
      negativeRollingShare,
      oppositeSignShare,
      rolling20,
      segments,
    },
    dollarFactor: {
      symbol: 'DINIW',
      name: '美元指数',
      method: '以严格早于A股交易日的最近一个美元指数日收益作为滞后因子，避免使用A股收盘后的美元数据。',
      sampleSize: dollarAligned.length,
      goldCorrelation: goldDollarCorrelation,
      oilCorrelation: oilDollarCorrelation,
      pairCorrelationOnFactorSample: pairFactorCorrelation,
      partialCorrelationControllingDollar: controlledCorrelation,
      crossCheck: liveDollarCrossCheck || retainedDollarCrossCheck || {
        provider: 'unavailable', sampleSize: 0, medianAbsoluteDifferencePct: null,
        latestCommonDate: null, latestAbsoluteDifferencePct: null, error: dollarCrossCheckError,
      },
    },
    conclusion: { pronouncedAntagonism, moderateAntagonism, dollarMechanismSupported, conclusion, dollarConclusion },
    sources: {
      etfMarketData: instrumentMetrics.map((instrument) => ({ symbol: instrument.symbol, source: instrument.source })),
      etfProviderCrossChecks,
      dollarPrimary: dollar.sourceUrl,
      dollarCrossCheck: dollarCrossCheck?.sourceUrl || previousPayload?.sources?.dollarPrimary || null,
      officialGoldFund: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-12-16/518880_20251216_OT5W.pdf',
      officialOilFund: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-07-21/513350_20250721_SR3U.pdf',
    },
  }
  const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex')

  await mkdir(outputDirectory, { recursive: true })
  await writeFile(jsonPath, `${JSON.stringify({ ...payload, payloadHash }, null, 2)}\n`, 'utf8')

  const latestGold = instrumentMetrics[0].latestRotation as RelativeRotationSeriesPoint | undefined
  const latestOil = instrumentMetrics[1].latestRotation as RelativeRotationSeriesPoint | undefined
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>黄金与油气 ETF：近一年 RRG 与美元拮抗检验</title>
  <style>
    :root{color-scheme:light;--ink:#172033;--muted:#64748b;--line:#dbe3ef;--card:#fff;--bg:#f4f7fb;--gold:#d79a18;--oil:#2877d4;--usd:#64748b;--good:#087f5b;--warn:#b45309;--bad:#b42318}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}.wrap{max-width:1240px;margin:0 auto;padding:28px 20px 48px}.eyebrow{color:#3568b8;font-size:13px;font-weight:700;letter-spacing:.08em}.hero{display:grid;grid-template-columns:1.5fr 1fr;gap:18px;margin-top:10px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 8px 28px rgba(42,62,93,.06)}h1{margin:6px 0 10px;font-size:32px;line-height:1.25}h2{font-size:19px;margin:0 0 14px}h3{font-size:15px;margin:0 0 8px}.sub,.note{color:var(--muted);line-height:1.7}.verdict{font-size:22px;font-weight:800;line-height:1.45}.pill{display:inline-flex;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;background:#eef4ff;color:#24589f;margin:4px 5px 4px 0}.pill.warn{background:#fff7e6;color:#9a5b00}.pill.good{background:#e8f7f1;color:#067255}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.stat{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px}.stat small{display:block;color:var(--muted);margin-bottom:7px}.stat strong{font-size:25px}.layout{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}.wide{grid-column:1/-1}.chart{height:410px;width:100%;position:relative}.chart.small{height:300px}.controls{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 10px;color:var(--muted);font-size:13px}.controls label{display:flex;align-items:center;gap:6px}.legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:13px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}.table{width:100%;border-collapse:collapse;font-size:13px}.table th,.table td{padding:10px 8px;text-align:right;border-bottom:1px solid #edf1f7}.table th:first-child,.table td:first-child{text-align:left}.positive{color:var(--good)}.negative{color:var(--bad)}.method{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.method>div{border-left:3px solid #9fb8dc;padding:4px 0 4px 12px}.callout{border-left:4px solid var(--warn);background:#fff9ed;padding:14px 16px;border-radius:8px;line-height:1.65}.source-list{font-size:13px;line-height:1.9;color:var(--muted);word-break:break-all}.source-list a{color:#3568b8}.footer{margin-top:18px;color:var(--muted);font-size:12px}.tooltip{position:absolute;display:none;pointer-events:none;background:#172033;color:white;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.5;z-index:3;box-shadow:0 8px 18px rgba(0,0,0,.18)}svg text{font-family:inherit}@media(max-width:800px){.hero,.layout{grid-template-columns:1fr}.wide{grid-column:auto}.stats{grid-template-columns:1fr 1fr}.method{grid-template-columns:1fr}.chart{height:350px}h1{font-size:25px}}
  </style>
</head>
<body><main class="wrap">
  <div class="eyebrow">研究级事实核查 · ${escapeHtml(cutoff)} 至 ${escapeHtml(commonEndDate)}</div>
  <section class="hero">
    <div class="card"><h1>黄金与油气 ETF 是否因美元<br/>出现明显“此消彼长”？</h1><p class="sub">同一张 RRG 使用项目既有沪深300基准；另用收益相关、滚动稳定性和美元控制后的偏相关作验证。数据截至最近共同交易日，不含盘中估值。</p><div><span class="pill">周频 RRG / 沪深300</span><span class="pill">日收益相关</span><span class="pill">DXY 滞后因子</span><span class="pill warn">研究用途，不是交易指令</span></div></div>
    <div class="card"><h2>一句话结论</h2><div class="verdict">${escapeHtml(conclusion)}</div><p class="note">${escapeHtml(dollarConclusion)}</p></div>
  </section>
  <section class="stats">
    <div class="stat"><small>黄金 / 油气 日收益相关</small><strong>${decimal(dailyCorrelation)}</strong><div class="note">95% CI ${decimal(dailyCorrelationCi.low)} ～ ${decimal(dailyCorrelationCi.high)}</div></div>
    <div class="stat"><small>周收益相关</small><strong>${decimal(weeklyCorrelation)}</strong><div class="note">n=${weeklyPairs.length}</div></div>
    <div class="stat"><small>20日滚动相关为负占比</small><strong>${pct(negativeRollingShare, 1)}</strong><div class="note">窗口数 ${rolling20.length}</div></div>
    <div class="stat"><small>控制滞后美元后的偏相关</small><strong>${decimal(controlledCorrelation)}</strong><div class="note">n=${dollarAligned.length}</div></div>
  </section>
  <section class="layout">
    <div class="card wide"><h2>RRG 轮动轨迹</h2><div class="controls"><label>轨迹长度 <select id="trail"><option value="12">12周</option><option value="26">26周</option><option value="52" selected>52周</option></select></label><label><input type="checkbox" data-rrg="518880" checked/>黄金ETF</label><label><input type="checkbox" data-rrg="513350" checked/>油气ETF</label></div><div id="rrgChart" class="chart"></div><div class="legend"><span><i class="dot" style="background:var(--gold)"></i>518880 华安黄金ETF</span><span><i class="dot" style="background:var(--oil)"></i>513350 富国标普油气ETF</span><span>横轴：相对趋势；纵轴：相对动量；100 为分界</span></div></div>
    <div class="card"><h2>近一年归一化价格</h2><div class="controls"><label><input type="checkbox" data-perf="gold" checked/>黄金</label><label><input type="checkbox" data-perf="oil" checked/>油气</label><label><input type="checkbox" data-perf="dollar" checked/>美元指数</label></div><div id="performanceChart" class="chart small"></div><p class="note">各序列首个可用收盘价=100，仅比较路径，不代表同一交易时区。</p></div>
    <div class="card"><h2>黄金 / 油气 20日滚动相关</h2><div id="correlationChart" class="chart small"></div><p class="note">若存在稳定拮抗，曲线应长期明显低于0；偶尔为负只说明阶段性分化。</p></div>
    <div class="card"><h2>分段稳定性</h2><table class="table"><thead><tr><th>区间</th><th>样本</th><th>日收益相关</th></tr></thead><tbody>${segments.map((segment) => `<tr><td>${segment.startDate}—${segment.endDate}</td><td>${segment.sampleSize}</td><td class="${(segment.correlation || 0) < 0 ? 'negative' : 'positive'}">${decimal(segment.correlation)}</td></tr>`).join('')}</tbody></table><p class="note">Spearman 秩相关：${decimal(spearmanCorrelation)}；相反涨跌日占比：${pct(oppositeSignShare, 1)}。</p></div>
    <div class="card"><h2>美元因子检验</h2><table class="table"><tbody><tr><td>黄金 vs 前一美元交易日</td><td>${decimal(goldDollarCorrelation)}</td></tr><tr><td>油气 vs 前一美元交易日</td><td>${decimal(oilDollarCorrelation)}</td></tr><tr><td>控制美元后的黄金/油气偏相关</td><td>${decimal(controlledCorrelation)}</td></tr><tr><td>美元双源中位绝对差</td><td>${dollarMedianMape === null ? '未完成' : `${(dollarMedianMape * 100).toFixed(3)}%`}</td></tr></tbody></table><p class="note">严格使用早于A股交易日的最近一个美元指数收益，避免把A股收盘后的美元走势作为当日已知信息。</p></div>
    <div class="card wide"><h2>标的性质与当前 RRG 状态</h2><table class="table"><thead><tr><th>标的</th><th>近一年收益</th><th>年化波动</th><th>最大回撤</th><th>RRG象限</th><th>相对趋势</th><th>相对动量</th><th>数据状态</th></tr></thead><tbody>${instrumentMetrics.map((item) => `<tr><td>${item.symbol} ${item.name}</td><td>${pct(item.totalReturn)}</td><td>${pct(item.annualizedVolatility)}</td><td>${pct(item.maxDrawdown)}</td><td>${item.latestRotation?.quadrant || '—'}</td><td>${item.latestRotation?.relativeTrend.toFixed(3) || '—'}</td><td>${item.latestRotation?.relativeMomentum.toFixed(3) || '—'}</td><td>${item.dataStatus}${item.blockers.length ? ` · ${item.blockers.join(', ')}` : ''}</td></tr>`).join('')}</tbody></table><div class="callout" style="margin-top:14px"><b>关键口径：</b>513350 跟踪的是美国油气勘探与生产企业指数，不是原油现货或原油期货。它同时承受油价、海外股票市场、企业利润、人民币汇率以及 QDII 溢折价影响，因此不能把它与黄金的差异全部归因于美元。</div></div>
    <div class="card wide"><h2>判定方法</h2><div class="method"><div><h3>1. 是否负相关</h3><span class="note">Pearson、Spearman 与周频相关共同核验，避免只看一条轨迹。</span></div><div><h3>2. 是否稳定</h3><span class="note">检查20日滚动相关为负占比及四段子样本，避免把一个阶段当全年规律。</span></div><div><h3>3. 是否由美元解释</h3><span class="note">比较两者美元暴露并计算控制美元后的偏相关；相关性仍不等于因果。</span></div></div></div>
    <div class="card wide"><h2>证据与限制</h2><div class="source-list"><div>ETF 行情：项目 canonical qfq 数据服务；518880=${escapeHtml(instrumentMetrics[0].source)}，513350=${escapeHtml(instrumentMetrics[1].source)}。</div><div>ETF 双源核验：${etfProviderCrossChecks.map((check) => `${check.symbol} ${check.status}，共同样本 ${check.commonSampleSize}，最新价绝对差 ${check.latestAbsoluteDifferencePct === null ? '—' : `${check.latestAbsoluteDifferencePct.toFixed(4)}%`}`).join('；')}。</div><div>美元指数主序列：<a href="${dollar.sourceUrl}">新浪 DINIW 日线接口</a>；交叉核验：${payload.sources.dollarCrossCheck ? `<a href="${payload.sources.dollarCrossCheck}">东方财富 100.UDI 日线接口</a>（${payload.dollarFactor.crossCheck.provider}）` : `失败：${escapeHtml(dollarCrossCheckError)}`}。</div><div>基金定义：<a href="${payload.sources.officialGoldFund}">上交所 518880 产品资料概要</a>；<a href="${payload.sources.officialOilFund}">上交所 513350 定期报告</a>。</div><div>石油ETF长期 RRG 严格门槛：672/756 日，故 dataStatus=insufficient；但近一年相关研究样本完整。美元序列是市场数据代理，不提供因果识别；未控制油价、实际利率、地缘风险、股市 beta 和 QDII 溢折价。</div></div></div>
  </section>
  <div class="footer">生成时间 ${escapeHtml(payload.generatedAt)} · 数据指纹 ${payloadHash.slice(0, 16)} · 本报告不生成买卖单，不构成投资建议。</div>
</main>
<script>
const DATA=${JSON.stringify(payload)};
const COLORS={"518880":"#d79a18","513350":"#2877d4",gold:"#d79a18",oil:"#2877d4",dollar:"#64748b"};
const NS='http://www.w3.org/2000/svg';
function node(name,attrs={}){const el=document.createElementNS(NS,name);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));return el}
function textNode(svg,x,y,text,attrs={}){const el=node('text',{x,y,...attrs});el.textContent=text;svg.appendChild(el);return el}
function baseChart(container){container.innerHTML='';const width=Math.max(320,container.clientWidth),height=container.clientHeight;const svg=node('svg',{viewBox:'0 0 '+width+' '+height,width:'100%',height:'100%'});container.appendChild(svg);return{svg,width,height,plot:{left:54,right:width-18,top:18,bottom:height-40}}}
function extent(values,padding=.08){let min=Math.min(...values),max=Math.max(...values);if(min===max){min-=1;max+=1}const gap=(max-min)*padding;return[min-gap,max+gap]}
function lineChart(containerId,series,yDomain,zeroLine=false){const container=document.getElementById(containerId),{svg,width,height,plot}=baseChart(container);const all=series.flatMap(s=>s.points);if(!all.length)return;const dates=all.map(p=>Date.parse(p.date)),xRange=extent(dates,0),ys=yDomain||extent(all.map(p=>p.value),.08);const x=v=>plot.left+(v-xRange[0])/(xRange[1]-xRange[0])*(plot.right-plot.left),y=v=>plot.bottom-(v-ys[0])/(ys[1]-ys[0])*(plot.bottom-plot.top);for(let i=0;i<=4;i++){const value=ys[0]+(ys[1]-ys[0])*i/4;svg.appendChild(node('line',{x1:plot.left,x2:plot.right,y1:y(value),y2:y(value),stroke:'#e6ebf2'}));textNode(svg,plot.left-8,y(value)+4,value.toFixed(zeroLine?2:0),{'text-anchor':'end',fill:'#748196','font-size':11})}if(zeroLine&&ys[0]<0&&ys[1]>0)svg.appendChild(node('line',{x1:plot.left,x2:plot.right,y1:y(0),y2:y(0),stroke:'#718096','stroke-dasharray':'5 4'}));[0,.5,1].forEach(r=>{const d=new Date(xRange[0]+(xRange[1]-xRange[0])*r);textNode(svg,x(d.getTime()),height-14,d.toISOString().slice(0,7),{'text-anchor':r===0?'start':r===1?'middle':'end',fill:'#748196','font-size':11})});for(const s of series){const path=s.points.map((p,i)=>(i?'L':'M')+x(Date.parse(p.date)).toFixed(1)+' '+y(p.value).toFixed(1)).join(' ');svg.appendChild(node('path',{d:path,fill:'none',stroke:s.color,'stroke-width':2.2,'stroke-linejoin':'round'}))}}
function renderPerformance(){const active=[...document.querySelectorAll('[data-perf]:checked')].map(el=>el.dataset.perf);lineChart('performanceChart',active.map(key=>({points:DATA.normalizedPerformance[key],color:COLORS[key]})),null,false)}
function renderCorrelation(){lineChart('correlationChart',[{points:DATA.relationship.rolling20,color:'#5b53c6'}],[-1,1],true)}
function renderRrg(){const trail=Number(document.getElementById('trail').value),active=[...document.querySelectorAll('[data-rrg]:checked')].map(el=>el.dataset.rrg),series=active.map(symbol=>({symbol,points:DATA.rrg[symbol].slice(-trail),color:COLORS[symbol]}));const all=series.flatMap(s=>s.points);const container=document.getElementById('rrgChart'),{svg,width,height,plot}=baseChart(container);if(!all.length)return;let [xmin,xmax]=extent(all.map(p=>p.relativeTrend).concat([100]),.12),[ymin,ymax]=extent(all.map(p=>p.relativeMomentum).concat([100]),.12);const x=v=>plot.left+(v-xmin)/(xmax-xmin)*(plot.right-plot.left),y=v=>plot.bottom-(v-ymin)/(ymax-ymin)*(plot.bottom-plot.top);const rects=[{x1:xmin,x2:100,y1:100,y2:ymax,fill:'#eaf7f1',label:'改善 Improving'},{x1:100,x2:xmax,y1:100,y2:ymax,fill:'#e8f2ff',label:'领先 Leading'},{x1:xmin,x2:100,y1:ymin,y2:100,fill:'#fff0ef',label:'落后 Lagging'},{x1:100,x2:xmax,y1:ymin,y2:100,fill:'#fff7e5',label:'转弱 Weakening'}];for(const r of rects){svg.appendChild(node('rect',{x:x(r.x1),y:y(r.y2),width:Math.abs(x(r.x2)-x(r.x1)),height:Math.abs(y(r.y1)-y(r.y2)),fill:r.fill}));textNode(svg,x((r.x1+r.x2)/2),y((r.y1+r.y2)/2),r.label,{'text-anchor':'middle',fill:'#8190a6','font-size':12,'font-weight':650})}svg.appendChild(node('line',{x1:x(100),x2:x(100),y1:plot.top,y2:plot.bottom,stroke:'#63738a','stroke-dasharray':'5 4'}));svg.appendChild(node('line',{x1:plot.left,x2:plot.right,y1:y(100),y2:y(100),stroke:'#63738a','stroke-dasharray':'5 4'}));textNode(svg,width/2,height-10,'相对趋势 →',{'text-anchor':'middle',fill:'#63738a','font-size':12});textNode(svg,14,height/2,'相对动量',{'text-anchor':'middle',fill:'#63738a','font-size':12,transform:'rotate(-90 14 '+height/2+')'});for(const s of series){const path=s.points.map((p,i)=>(i?'L':'M')+x(p.relativeTrend).toFixed(1)+' '+y(p.relativeMomentum).toFixed(1)).join(' ');svg.appendChild(node('path',{d:path,fill:'none',stroke:s.color,'stroke-width':2.4,opacity:.82,'stroke-linejoin':'round'}));s.points.forEach((p,i)=>svg.appendChild(node('circle',{cx:x(p.relativeTrend),cy:y(p.relativeMomentum),r:i===s.points.length-1?6:2.6,fill:s.color,opacity:.35+.65*(i+1)/s.points.length})));const last=s.points.at(-1);if(last)textNode(svg,x(last.relativeTrend)+9,y(last.relativeMomentum)-8,s.symbol+' · '+last.date,{fill:s.color,'font-size':12,'font-weight':750})}}
document.querySelectorAll('input,select').forEach(el=>el.addEventListener('change',()=>{renderRrg();renderPerformance()}));window.addEventListener('resize',()=>{renderRrg();renderPerformance();renderCorrelation()});renderRrg();renderPerformance();renderCorrelation();
</script></body></html>`
  await writeFile(htmlPath, html, 'utf8')
  console.log(JSON.stringify({ htmlPath, jsonPath, payloadHash, conclusion: payload.conclusion, metrics: payload.relationship, dollarFactor: payload.dollarFactor, instruments: instrumentMetrics }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
