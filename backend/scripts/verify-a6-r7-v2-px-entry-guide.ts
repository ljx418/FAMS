import { strict as assert } from 'node:assert'
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { humanAcceptanceDraftService } from '../src/services/formal-release/humanAcceptanceDraftService.js'

async function main() {
  const root = resolve(process.cwd(), '..')
  const extensionRoot = resolve(root, 'packages/fams-v2-px-extension')
  const outputRoot = resolve(extensionRoot, '.output/chrome-mv3')
  const requiredOutputs = ['manifest.json', 'background.js', 'sidepanel.html', 'workspace.html']
  await Promise.all(requiredOutputs.map((file) => stat(resolve(outputRoot, file))))
  const manifest = JSON.parse(await readFile(resolve(outputRoot, 'manifest.json'), 'utf8'))
  assert.equal(manifest.name, 'FAMS External Brain')
  assert.equal(manifest.side_panel?.default_path, 'sidepanel.html')
  assert.equal(manifest.background?.service_worker, 'background.js')
  assert.deepEqual([...manifest.permissions].sort(), ['sidePanel', 'storage', 'tabs'])
  assert.ok(manifest.externally_connectable.matches.includes('http://127.0.0.1:3000/*'))
  assert.equal('orders' in manifest.permissions, false)

  const context = await humanAcceptanceDraftService.context() as any
  const guide = context.v2PxEntryGuide
  assert.equal(guide.unpackedDirectory, 'packages/fams-v2-px-extension/.output/chrome-mv3')
  assert.equal(guide.chromeExtensionsUrl, 'chrome://extensions')
  assert.equal(guide.backendUrl, 'http://127.0.0.1:4000')
  assert.equal(guide.hostAppUrl, 'http://127.0.0.1:3000')
  assert.equal(guide.nativeSidePanelHumanEvidenceRequired, true)
  const v2Review = context.reviewItems.find((item: any) => item.reviewType === 'v2_px_experience')
  assert.ok(v2Review.steps.some((step: string) => step.includes('chrome://extensions')))
  assert.ok(v2Review.steps.some((step: string) => step.includes('.output/chrome-mv3')))
  assert.ok(v2Review.steps.some((step: string) => step.includes('原生 Side Panel')))

  const checklist = await readFile(resolve(root, 'frontend/public/formal-release-human-checklist.html'), 'utf8')
  assert.ok(checklist.includes('packages/fams-v2-px-extension/.output/chrome-mv3'))
  assert.ok(checklist.includes('http://127.0.0.1:3000'))
  assert.ok(checklist.includes('必须使用真实 Chrome 原生 Side Panel'))

  const audit = {
    schemaVersion: 'fams.a6.r7.v2_px_entry_guide_audit.v1',
    generatedAt: new Date().toISOString(),
    extensionBuild: {
      packageVersion: manifest.version,
      requiredOutputs,
      permissions: manifest.permissions,
      sidePanelPath: manifest.side_panel.default_path,
      workspacePath: guide.workspacePath,
      backgroundPath: manifest.background.service_worker,
    },
    entryGuide: guide,
    assertions: {
      exactBuildDirectoryDocumented: true,
      hostAppPortMatchesManifest: true,
      nativeSidePanelNotConfusedWithTab: true,
      realChromeHumanEvidenceStillRequired: true,
      px602ClaimedPassed: false,
    },
    tradeBoundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    overallStatus: 'passed',
  }
  const output = resolve(root, 'docs/automation-audits/a6-feedback-remediation/R7/v2-px-entry-guide-audit.json')
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ overallStatus: audit.overallStatus, packageVersion: manifest.version, requiredOutputs, humanEvidenceRequired: true }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
