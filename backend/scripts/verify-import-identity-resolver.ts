import assert from 'node:assert/strict'
import { assetService, type ParsedPosition } from '../src/services/asset/assetService.js'

function sample(category: string, symbol: string | null, subCategory: string): Pick<ParsedPosition, 'category' | 'attribute' | 'subCategory' | 'symbol'> {
  return {
    category,
    attribute: '测试',
    subCategory,
    symbol,
  }
}

async function main() {
  const cases = [
    { input: sample('股票', '601127', '赛力斯'), expected: 'stock' },
    { input: sample('股票', '513770', '港股互联网'), expected: 'etf' },
    { input: sample('股指', '159851', '金融科技ETF'), expected: 'etf' },
    { input: sample('基金', '007467', '红利低波'), expected: 'fund' },
    { input: sample('债基', '009725', '中期债'), expected: 'bond' },
    { input: sample('现金', null, '银行卡'), expected: 'cash' },
  ]

  for (const item of cases) {
    const preview = await assetService.resolveImportAssetIdentity(item.input)
    assert.equal(preview.assetType, item.expected, `${preview.symbol} should import as ${item.expected}`)
    assert.ok(preview.symbol, 'import preview should expose canonical symbol')
    assert.ok(preview.currency, 'import preview should expose currency')
    console.log(`import identity ${preview.symbol}: ${preview.assetType} confidence=${preview.confidenceScore}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
