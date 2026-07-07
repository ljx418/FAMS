import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { prisma } from '../src/db/prisma.js'
import { assetService } from '../src/services/asset/assetService.js'

const repoRoot = resolve(process.cwd(), '..')

async function main() {
  const checkedAt = new Date().toISOString()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'ux-f7', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })

  const [assetRouteSource, assetServiceSource, assetsPageSource, templateRouteSource] = await Promise.all([
    readFile(resolve(repoRoot, 'backend/src/routes/asset.ts'), 'utf8'),
    readFile(resolve(repoRoot, 'backend/src/services/asset/assetService.ts'), 'utf8'),
    readFile(resolve(repoRoot, 'frontend/src/pages/Assets.tsx'), 'utf8'),
    readFile(resolve(repoRoot, 'backend/src/routes/template.ts'), 'utf8'),
  ])

  const exportResult = await assetService.exportPortfolioWorkbook('default')
  const workbook = XLSX.read(exportResult.buffer, { type: 'buffer' })
  const requiredSheets = ['current_positions', 'trade_records', 'field_guide']
  const workbookSheetChecks = Object.fromEntries(
    requiredSheets.map((sheetName) => [sheetName, workbook.SheetNames.includes(sheetName)]),
  )

  const checks = {
    templateDownloadEndpointExists: templateRouteSource.includes("app.get('/template'")
      && templateRouteSource.includes('asset_import_template.xlsx')
      && templateRouteSource.includes('导入模板')
      && templateRouteSource.includes('填写说明'),
    parsePreviewEndpointExists: assetRouteSource.includes("app.post('/parse'")
      && assetRouteSource.includes('parseExcelPositions'),
    importEndpointExists: assetRouteSource.includes("app.post('/import'")
      && assetRouteSource.includes('importPositions'),
    exportEndpointExists: assetRouteSource.includes("app.get('/export'")
      && assetRouteSource.includes('exportPortfolioWorkbook'),
    exportBeforeDynamicAssetRoute: assetRouteSource.indexOf("app.get('/export'") > -1
      && assetRouteSource.indexOf("app.get('/export'") < assetRouteSource.indexOf("app.get('/:id'"),
    serviceExportsWorkbook: assetServiceSource.includes('exportPortfolioWorkbook')
      && assetServiceSource.includes('current_positions')
      && assetServiceSource.includes('trade_records')
      && assetServiceSource.includes('field_guide'),
    frontendHasTemplateImportExportActions: assetsPageSource.includes('handleDownloadTemplate')
      && assetsPageSource.includes('handleParseExcel')
      && assetsPageSource.includes('handleExportAssets')
      && assetsPageSource.includes('/api/v1/assets/export'),
    workbookHasRequiredSheets: Object.values(workbookSheetChecks).every(Boolean),
    exportDoesNotCreateOrder: !assetRouteSource.includes('ORDER_CREATE')
      && !assetServiceSource.includes('createOrder'),
  }

  for (const [name, passed] of Object.entries(checks)) {
    assert.equal(passed, true, `Asset Excel flow contract failed: ${name}`)
  }

  const audit = {
    schemaVersion: 'fams.ux_f7.asset_excel_flow_audit.v1',
    status: 'passed',
    checkedAt,
    userId: 'default',
    workbookSheets: workbook.SheetNames,
    workbookSheetChecks,
    exportSummary: exportResult.summary,
    checks,
    userExperience: {
      canDownloadTemplate: true,
      canPreviewBeforeImport: true,
      canConfirmImport: true,
      canExportCurrentPositionsAndTradeRecords: true,
      emptyAssetStateGuidesExcelImport: assetsPageSource.includes('还没有本地资产数据'),
    },
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }

  const auditPath = resolve(auditDir, 'asset_excel_flow_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
