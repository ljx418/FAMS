import type {
  RotationMarket,
  RotationResearchPeriod,
  RotationResearchStudyInput,
} from '../../services/relativeRotationService'

export interface IndustryRotationPreset extends RotationResearchStudyInput {
  comparisonTargetKeys: string[]
}

const cnTarget = (code: string, name: string) => ({
  code,
  name,
  kind: 'equity' as const,
  targetKey: `CN:equity:${code}`,
})

const hkTarget = (code: string, name: string) => {
  const symbol = `${code.replace(/\.HK$/i, '').padStart(5, '0')}.HK`
  return {
    code: symbol,
    name,
    kind: 'equity' as const,
    targetKey: `HK:equity:${symbol}`,
  }
}

const defaultPeriod: RotationResearchPeriod = { mode: 'rolling', rollingWeeks: 104 }
const emergingIndustryPeriod: RotationResearchPeriod = { mode: 'rolling', rollingWeeks: 52 }

/**
 * A narrower, fully exchange-traded theme basket for comparing the 159851
 * financial-technology holding with adjacent growth industries.  It uses a
 * shorter 52-week observation window because newer themes, including
 * commercial space and grid equipment, do not have the same history as the
 * mature sector ETFs.  Proxies remain explicit instead of backfilling a
 * broader index or a different security.
 */
export const cnEmergingIndustryEtfRotationPreset: IndustryRotationPreset = {
  name: 'A股科技产业轮动：行业ETF（含159851）',
  market: 'CN',
  frequency: 'weekly',
  historyYears: 3,
  benchmark: { mode: 'market_default', targetKeys: [] },
  period: emergingIndustryPeriod,
  targets: [
    cnTarget('159851', '金融科技ETF'),
    cnTarget('512480', '半导体ETF'),
    cnTarget('515070', '人工智能ETF'),
    cnTarget('516160', '新能源ETF'),
    cnTarget('515790', '光伏ETF'),
    cnTarget('512400', '有色金属ETF'),
    cnTarget('562500', '机器人ETF'),
    cnTarget('561380', '电网设备ETF'),
    cnTarget('159326', '特高压代理（电网设备主题ETF）'),
    cnTarget('159206', '卫星ETF（商业航天代理）'),
  ],
  comparisonTargetKeys: ['CN:equity:159851', 'CN:equity:512480'],
}

/**
 * Broad, exchange-traded A-share sector proxies.  The basket deliberately
 * contains one representative per research theme so pairwise relationships
 * remain interpretable and the study stays below the 16-target API limit.
 */
export const cnIndustryRotationPreset: IndustryRotationPreset = {
  name: 'A股行业轮动：行业ETF',
  market: 'CN',
  frequency: 'weekly',
  historyYears: 8,
  benchmark: { mode: 'market_default', targetKeys: [] },
  period: defaultPeriod,
  targets: [
    cnTarget('512800', '银行ETF'),
    cnTarget('512000', '券商ETF'),
    cnTarget('159851', '金融科技ETF'),
    cnTarget('512200', '房地产ETF'),
    cnTarget('512690', '酒ETF'),
    cnTarget('159928', '消费ETF'),
    cnTarget('512170', '医疗ETF'),
    cnTarget('512480', '半导体ETF'),
    cnTarget('515070', '人工智能ETF'),
    cnTarget('512980', '传媒ETF'),
    cnTarget('512660', '军工ETF'),
    cnTarget('512400', '有色金属ETF'),
    cnTarget('515220', '煤炭ETF'),
    cnTarget('159611', '电力ETF'),
    cnTarget('516160', '新能源ETF'),
  ],
  comparisonTargetKeys: ['CN:equity:512800', 'CN:equity:512480'],
}

/** Hong Kong-listed sector/theme ETFs, isolated from the A-share universe. */
export const hkIndustryRotationPreset: IndustryRotationPreset = {
  name: '港股行业轮动：行业ETF',
  market: 'HK',
  frequency: 'weekly',
  historyYears: 8,
  benchmark: { mode: 'market_default', targetKeys: [] },
  period: defaultPeriod,
  targets: [
    hkTarget('3067', '安硕恒生科技ETF'),
    hkTarget('2807', '中国机器人及人工智能ETF'),
    hkTarget('3191', '中国半导体ETF'),
    hkTarget('2845', '中国电动车及电池ETF'),
    hkTarget('2809', '中国洁净能源ETF'),
    hkTarget('2820', '中国生物科技ETF'),
    hkTarget('2806', '中国消费品牌ETF'),
  ],
  comparisonTargetKeys: ['HK:equity:02820.HK', 'HK:equity:02845.HK'],
}

export const industryRotationPresetChoices: Array<{
  key: string
  label: string
  market: RotationMarket
  draft: IndustryRotationPreset
}> = [
  {
    key: 'preset-industry-cn-emerging-etf',
    label: '预设 · A股科技产业ETF轮动（含159851）',
    market: 'CN',
    draft: cnEmergingIndustryEtfRotationPreset,
  },
  {
    key: 'preset-industry-cn',
    label: '预设 · A股行业轮动（ETF）',
    market: 'CN',
    draft: cnIndustryRotationPreset,
  },
  {
    key: 'preset-industry-hk',
    label: '预设 · 港股行业轮动（ETF）',
    market: 'HK',
    draft: hkIndustryRotationPreset,
  },
]

export const industryRotationMarketForKey = (key: string): RotationMarket | null => (
  industryRotationPresetChoices.find((choice) => choice.key === key)?.market || null
)
