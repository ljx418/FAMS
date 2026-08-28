import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { expectedTargetContainer, isContextRef, isConversationId, isLifecycleEventType, isSourceRef, parseSourceRef, validateIntentRoute, validateOperationCommand } from '../src/contracts/validation'

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
      const validate = ajv.compile(json(resolve(schemaDir, schemaName)) as object)
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

  it('accepts real UUID/sourceRef values and round-trips canonical UTF-8 refs', () => {
    const route = json(resolve(fixtureDir, 'intent-route-v3.positive.json')) as { routePayload: { sourceRef: string } }
    const parsed = parseSourceRef(route.routePayload.sourceRef)
    expect(validateIntentRoute(route).ok).toBe(true)
    expect(parsed).toEqual({
      kind: 'op-artifact',
      entityId: '3d292179-cd6d-4e73-9a35-0097b6809436',
      rawRef: 'operation_artifact:3d292179-cd6d-4e73-9a35-0097b6809436:01_request_and_strategy_definitions.json',
    })
    expect(isContextRef('00fdc188-0b6b-4731-81eb-d5fc91de01ed')).toBe(true)
    expect(isContextRef(route.routePayload.sourceRef)).toBe(true)
    expect(isConversationId('chat-00fdc188-0b6b-4731-81eb-d5fc91de01ed')).toBe(true)
    expect(isConversationId('00fdc188-0b6b-4731-81eb-d5fc91de01ed')).toBe(false)
  })

  it.each([
    'op-artifact:3d292179-cd6d-4e73-9a35-0097b6809436:YQ=',
    'op-artifact:3d292179-cd6d-4e73-9a35-0097b6809436:YR',
    'unknown:3d292179-cd6d-4e73-9a35-0097b6809436:YQ',
    'op-artifact:3D292179-CD6D-4E73-9A35-0097B6809436:YQ',
    'op-artifact:3d292179-cd6d-1e73-9a35-0097b6809436:YQ',
    `op-artifact:3d292179-cd6d-4e73-9a35-0097b6809436:${btoa('x'.repeat(513)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`,
  ])('rejects malformed/noncanonical/unknown/oversize sourceRef %s', (sourceRef) => {
    expect(isSourceRef(sourceRef)).toBe(false)
  })

  it('keeps lifecycle eventType closed and distinct from state names', () => {
    expect(isLifecycleEventType('connection_lost')).toBe(true)
    expect(isLifecycleEventType('storage_write_failed')).toBe(true)
    expect(isLifecycleEventType('disconnected')).toBe(false)
    expect(isLifecycleEventType('recovering')).toBe(false)
    expect(isLifecycleEventType('closed')).toBe(false)
  })
})
