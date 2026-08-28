const FAMS_ENTITY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SOURCE_REF_PATTERN = /^(op-artifact|review-evidence):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Za-z0-9_-]{2,686})$/

export type ParsedSourceRef = {
  kind: 'op-artifact' | 'review-evidence'
  entityId: string
  rawRef: string
}

export function isFamsEntityId(value: unknown): value is string {
  return typeof value === 'string' && FAMS_ENTITY_ID_PATTERN.test(value)
}

export function createSourceRef(kind: ParsedSourceRef['kind'], entityId: string, rawRef: string): string {
  if (!isFamsEntityId(entityId)) throw new Error('PX_SOURCE_ENTITY_ID_INVALID')
  const bytes = Buffer.from(rawRef, 'utf8')
  if (bytes.length < 1 || bytes.length > 512) throw new Error('PX_SOURCE_RAW_REF_LENGTH_INVALID')
  const sourceRef = `${kind}:${entityId}:${bytes.toString('base64url')}`
  if (sourceRef.length > 768) throw new Error('PX_SOURCE_REF_LENGTH_INVALID')
  return sourceRef
}

export function parseSourceRef(value: unknown): ParsedSourceRef | null {
  if (typeof value !== 'string' || value.length > 768) return null
  const matched = SOURCE_REF_PATTERN.exec(value)
  if (!matched) return null
  try {
    const encoded = matched[3]!
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.length < 1 || bytes.length > 512 || bytes.toString('base64url') !== encoded) return null
    const rawRef = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!Buffer.from(rawRef, 'utf8').equals(bytes)) return null
    return { kind: matched[1] as ParsedSourceRef['kind'], entityId: matched[2]!, rawRef }
  } catch {
    return null
  }
}
