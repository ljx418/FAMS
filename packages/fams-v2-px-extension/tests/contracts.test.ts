import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { expectedTargetContainer, isLifecycleEventType, validateIntentRoute, validateOperationCommand } from '../src/contracts/validation'

const root = resolve(import.meta.dirname, '../../..')
const schemaDir = resolve(root, 'docs/schemas')
const fixtureDir = resolve(root, 'docs/prototypes/v2-px/fixtures')

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const contracts = [
  ['v2-px-intent-route-v3.schema.json', 'intent-route-v3.positive.json', 'intent-route-v3.negative.json'],
  ['v2-px-operation-command-v2.schema.json', 'operation-command-v2.positive.json', 'operation-command-v2.negative.json'],
  ['v2-px-dual-container-lifecycle-v3.schema.json', 'dual-container-lifecycle-v3.positive.json', 'dual-container-lifecycle-v3.negative.json'],
  ['v2-px-real-chrome-evidence-v2.schema.json', 'real-chrome-evidence-v2.positive.json', 'real-chrome-evidence-v2.negative.json'],
] as const

describe('V2-PX target JSON contracts', () => {
  for (const [schemaName, positiveName, negativeName] of contracts) {
    it(`${schemaName} accepts its positive fixture and rejects its negative fixture`, () => {
      const ajv = new Ajv2020({ allErrors: true, strict: true })
      addFormats(ajv)
      const validate = ajv.compile(json(resolve(schemaDir, schemaName)))
      expect(validate(json(resolve(fixtureDir, positiveName))), JSON.stringify(validate.errors)).toBe(true)
      expect(validate(json(resolve(fixtureDir, negativeName)))).toBe(false)
    })
  }

  it('implements the complete 3x3 entry/action target-container matrix', () => {
    const entries = ['sidepanel', 'workspace_page', 'host_app'] as const
    const actions = ['view_source', 'open_workspace', 'open_in_workspace'] as const
    const matrix = entries.flatMap((entry) => actions.map((action) => [entry, action, expectedTargetContainer(entry, action)]))
    expect(matrix).toEqual([
      ['sidepanel', 'view_source', 'sidepanel'],
      ['sidepanel', 'open_workspace', 'workspace_page'],
      ['sidepanel', 'open_in_workspace', 'workspace_page'],
      ['workspace_page', 'view_source', 'workspace_page'],
      ['workspace_page', 'open_workspace', 'workspace_page'],
      ['workspace_page', 'open_in_workspace', 'workspace_page'],
      ['host_app', 'view_source', 'workspace_page'],
      ['host_app', 'open_workspace', 'workspace_page'],
      ['host_app', 'open_in_workspace', 'workspace_page'],
    ])
  })

  it('runtime guard rejects ask question and Host operation commands', () => {
    const invalidRoute = json(resolve(fixtureDir, 'intent-route-v3.negative.json'))
    const invalidCommand = json(resolve(fixtureDir, 'operation-command-v2.negative.json'))
    expect(validateIntentRoute(invalidRoute).ok).toBe(false)
    expect(validateOperationCommand(invalidCommand).ok).toBe(false)
  })

  it('keeps lifecycle eventType closed and distinct from state names', () => {
    expect(isLifecycleEventType('connection_lost')).toBe(true)
    expect(isLifecycleEventType('storage_write_failed')).toBe(true)
    expect(isLifecycleEventType('disconnected')).toBe(false)
    expect(isLifecycleEventType('recovering')).toBe(false)
    expect(isLifecycleEventType('closed')).toBe(false)
  })
})
