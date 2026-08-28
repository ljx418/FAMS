import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BACKEND_ORIGINS, OPTIONAL_BACKEND_PERMISSIONS } from '../src/background/connection'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')

describe('PX1 build and permission baseline', () => {
  it('contains all real WXT entrypoints', () => {
    for (const path of [
      'entrypoints/background.ts',
      'entrypoints/sidepanel/index.html',
      'entrypoints/sidepanel/main.tsx',
      'entrypoints/workspace/index.html',
      'entrypoints/workspace/main.tsx',
    ]) expect(existsSync(resolve(packageRoot, path)), path).toBe(true)
  })

  it('pins the approved runtime and test dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
    expect(pkg.dependencies.wxt).toBe('0.21.4')
    expect(pkg.dependencies.react).toBe('18.2.0')
    expect(pkg.devDependencies['@playwright/test']).toBe('1.62.1')
  })

  it('uses only the two approved 4000 origins', () => {
    expect(BACKEND_ORIGINS).toEqual(['http://localhost:4000', 'http://127.0.0.1:4000'])
    expect(OPTIONAL_BACKEND_PERMISSIONS).toEqual(['http://localhost:4000/*', 'http://127.0.0.1:4000/*'])
    const config = readFileSync(resolve(packageRoot, 'wxt.config.ts'), 'utf8')
    expect(config).not.toContain('<all_urls>')
    expect(config).toMatch(/host_permissions:\s*\[\s*\]/)
    expect(config).toContain("permissions: ['sidePanel', 'tabs', 'storage']")
    expect(config).toContain("matches: ['http://localhost:3000/*', 'http://127.0.0.1:3000/*']")
  })

  it('contains every frozen target fixture without changing the PX0 fixture', () => {
    const fixtureDir = resolve(repoRoot, 'docs/prototypes/v2-px/fixtures')
    const names = [
      'intent-route-v3.positive.json', 'intent-route-v3.negative.json',
      'operation-command-v2.positive.json', 'operation-command-v2.negative.json',
      'dual-container-lifecycle-v3.positive.json', 'dual-container-lifecycle-v3.negative.json',
      'real-chrome-evidence-v2.positive.json', 'real-chrome-evidence-v2.negative.json',
      'semantic-contract-fixtures.json',
    ]
    for (const name of names) expect(existsSync(resolve(fixtureDir, name)), name).toBe(true)
  })
})
