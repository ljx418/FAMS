export const AUTO_TRADE_ALWAYS_PROHIBITED = true

export function deriveProhibitedActions(input: {
  validationEvidencePassed: boolean
  dataSufficient: boolean
}) {
  if (!input.validationEvidencePassed || !input.dataSufficient) {
    return ['ADD', 'REDUCE', 'AUTO_TRADE']
  }
  return ['AUTO_TRADE']
}
