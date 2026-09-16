import type {
  RotationPoint,
  RotationQuadrant,
  RotationResearchTimelineItem,
} from '../../services/relativeRotationService'

export interface IndustryRotationItemAnalysis {
  targetKey: string
  symbol: string
  name: string
  currentQuadrant: RotationQuadrant
  currentTrend: number
  currentMomentum: number
  currentRole: string
  priorQuadrant: RotationQuadrant
  currentStreak: number
  leadingRatio: number
  constructiveRatio: number
  leaderRatio: number
  relativeReturn: number | null
  pointCount: number
}

export interface IndustryRotationPairAnalysis {
  key: string
  leftName: string
  rightName: string
  correlation: number | null
  sameQuadrantRatio: number | null
  alignedPointCount: number
  classification: '同步轮动' | '阶段分化' | '关系混合'
}

export interface IndustryRotationAnalysis {
  asOfDate: string
  comparisonLabel: string
  currentDistribution: Record<RotationQuadrant, number>
  priorDistribution: Record<RotationQuadrant, number>
  rows: IndustryRotationItemAnalysis[]
  confirmedLeaders: string[]
  improvingCandidates: string[]
  persistentLeaders: string[]
  synchronousPairs: IndustryRotationPairAnalysis[]
  differentiatedPairs: IndustryRotationPairAnalysis[]
}

const quadrants: RotationQuadrant[] = ['leading', 'improving', 'weakening', 'lagging']

const emptyDistribution = (): Record<RotationQuadrant, number> => ({
  leading: 0,
  improving: 0,
  weakening: 0,
  lagging: 0,
})

const pointsThrough = (points: RotationPoint[], endDate: string) => (
  points.filter((point) => !endDate || point.date <= endDate)
)

const correlation = (left: number[], right: number[]) => {
  if (left.length !== right.length || left.length < 3) return null
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
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
  if (leftVariance === 0 || rightVariance === 0) return null
  return covariance / Math.sqrt(leftVariance * rightVariance)
}

const currentRole = (point: RotationPoint) => {
  const x = point.deltaX || 0
  const y = point.deltaY || 0
  if (point.quadrant === 'leading') return x > 0 && y > 0 ? '领先扩张' : y < 0 ? '领先降温' : '保持领先'
  if (point.quadrant === 'improving') return x > 0 && y > 0 ? '加速改善' : x < 0 && y < 0 ? '改善减速' : '改善中'
  if (point.quadrant === 'weakening') return x < 0 && y < 0 ? '弱化加速' : '弱化中'
  return x > 0 && y > 0 ? '筑底回升' : '持续落后'
}

const pairAnalysis = (
  left: RotationResearchTimelineItem,
  right: RotationResearchTimelineItem,
  endDate: string,
): IndustryRotationPairAnalysis => {
  const leftByDate = new Map(pointsThrough(left.points, endDate).map((point) => [point.date, point]))
  const rightByDate = new Map(pointsThrough(right.points, endDate).map((point) => [point.date, point]))
  const dates = Array.from(leftByDate.keys()).filter((date) => rightByDate.has(date)).sort()
  const leftReturns: number[] = []
  const rightReturns: number[] = []
  for (let index = 1; index < dates.length; index += 1) {
    const previousDate = dates[index - 1]
    const date = dates[index]
    const leftPrevious = leftByDate.get(previousDate)?.relativePrice || 0
    const leftCurrent = leftByDate.get(date)?.relativePrice || 0
    const rightPrevious = rightByDate.get(previousDate)?.relativePrice || 0
    const rightCurrent = rightByDate.get(date)?.relativePrice || 0
    if (leftPrevious > 0 && rightPrevious > 0) {
      leftReturns.push((leftCurrent / leftPrevious) - 1)
      rightReturns.push((rightCurrent / rightPrevious) - 1)
    }
  }
  const sameQuadrantCount = dates.filter((date) => leftByDate.get(date)?.quadrant === rightByDate.get(date)?.quadrant).length
  const pairCorrelation = correlation(leftReturns, rightReturns)
  const sameQuadrantRatio = dates.length > 0 ? sameQuadrantCount / dates.length : null
  const classification = pairCorrelation !== null && pairCorrelation >= 0.7 && (sameQuadrantRatio || 0) >= 0.45
    ? '同步轮动'
    : (pairCorrelation !== null && pairCorrelation <= 0.25) || (sameQuadrantRatio !== null && sameQuadrantRatio <= 0.25)
      ? '阶段分化'
      : '关系混合'
  return {
    key: `${left.targetKey}::${right.targetKey}`,
    leftName: left.name,
    rightName: right.name,
    correlation: pairCorrelation,
    sameQuadrantRatio,
    alignedPointCount: dates.length,
    classification,
  }
}

export function buildIndustryRotationAnalysis(
  items: RotationResearchTimelineItem[],
  endDate: string,
  frequency: 'weekly' | 'daily',
): IndustryRotationAnalysis {
  const usable = items.map((item) => ({ item, points: pointsThrough(item.points, endDate) }))
    .filter(({ points }) => points.length > 0)
  const observedDates = usable.flatMap(({ points }) => points.map((point) => point.date)).sort()
  const asOfDate = observedDates[observedDates.length - 1] || endDate
  const leaderCounts = new Map<string, number>()
  const allDates = Array.from(new Set(usable.flatMap(({ points }) => points.map((point) => point.date)))).sort()
  for (const date of allDates) {
    const candidates = usable.flatMap(({ item, points }) => {
      const point = points.find((candidate) => candidate.date === date)
      return point ? [{ targetKey: item.targetKey, score: point.relativeTrend + point.relativeMomentum }] : []
    })
    const leader = candidates.sort((left, right) => right.score - left.score)[0]
    if (leader) leaderCounts.set(leader.targetKey, (leaderCounts.get(leader.targetKey) || 0) + 1)
  }

  const currentDistribution = emptyDistribution()
  const priorDistribution = emptyDistribution()
  const priorOffset = frequency === 'weekly' ? 4 : 5
  const rows = usable.map(({ item, points }): IndustryRotationItemAnalysis => {
    const latest = points[points.length - 1]
    const first = points[0]
    currentDistribution[latest.quadrant] += 1
    const prior = points[Math.max(0, points.length - 1 - priorOffset)]
    priorDistribution[prior.quadrant] += 1
    let currentStreak = 0
    for (let index = points.length - 1; index >= 0 && points[index].quadrant === latest.quadrant; index -= 1) currentStreak += 1
    const leadingCount = points.filter((point) => point.quadrant === 'leading').length
    const constructiveCount = points.filter((point) => point.quadrant === 'leading' || point.quadrant === 'improving').length
    return {
      targetKey: item.targetKey,
      symbol: item.symbol,
      name: item.name,
      currentQuadrant: latest.quadrant,
      currentTrend: latest.relativeTrend,
      currentMomentum: latest.relativeMomentum,
      currentRole: currentRole(latest),
      priorQuadrant: prior.quadrant,
      currentStreak,
      leadingRatio: leadingCount / points.length,
      constructiveRatio: constructiveCount / points.length,
      leaderRatio: allDates.length > 0 ? (leaderCounts.get(item.targetKey) || 0) / allDates.length : 0,
      relativeReturn: first.relativePrice > 0 ? (latest.relativePrice / first.relativePrice) - 1 : null,
      pointCount: points.length,
    }
  }).sort((left, right) => {
    const quadrantOrder: Record<RotationQuadrant, number> = { leading: 0, improving: 1, weakening: 2, lagging: 3 }
    return quadrantOrder[left.currentQuadrant] - quadrantOrder[right.currentQuadrant]
      || (right.currentTrend + right.currentMomentum) - (left.currentTrend + left.currentMomentum)
  })

  const pairs: IndustryRotationPairAnalysis[] = []
  for (let leftIndex = 0; leftIndex < usable.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < usable.length; rightIndex += 1) {
      pairs.push(pairAnalysis(usable[leftIndex].item, usable[rightIndex].item, endDate))
    }
  }
  const validPairs = pairs.filter((pair) => pair.alignedPointCount >= 12 && pair.correlation !== null)
  const synchronousPairs = [...validPairs]
    .sort((left, right) => (right.correlation || 0) - (left.correlation || 0))
    .slice(0, 3)
  const differentiatedPairs = [...validPairs]
    .sort((left, right) => (left.correlation || 0) - (right.correlation || 0))
    .slice(0, 3)
  const persistentLeaders = [...rows]
    .sort((left, right) => right.leaderRatio - left.leaderRatio)
    .filter((row) => row.leaderRatio > 0)
    .slice(0, 3)
    .map((row) => row.name)

  return {
    asOfDate,
    comparisonLabel: frequency === 'weekly' ? '4周前' : '5个交易日前',
    currentDistribution,
    priorDistribution,
    rows,
    confirmedLeaders: rows.filter((row) => row.currentQuadrant === 'leading').map((row) => row.name),
    improvingCandidates: rows.filter((row) => row.currentQuadrant === 'improving').map((row) => row.name),
    persistentLeaders,
    synchronousPairs,
    differentiatedPairs,
  }
}

export const INDUSTRY_ROTATION_QUADRANTS = quadrants
