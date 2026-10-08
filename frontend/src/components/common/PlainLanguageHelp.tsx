import { QuestionCircleOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import { businessGlossary, type BusinessTermId } from '../../content/businessGlossary'

type PlainLanguageHelpProps = {
  termId?: BusinessTermId
  term?: string
  explanation?: string
}

export function PlainLanguageHelp({ termId, term, explanation }: PlainLanguageHelpProps) {
  const registered = termId ? businessGlossary[termId] : null
  const label = term || registered?.label || ''
  const content = explanation || registered?.explanation || ''
  return (
    <Tooltip title={content} trigger={['hover', 'focus']}>
      <span
        className="inline-flex cursor-help items-center gap-1 rounded-sm font-medium text-blue-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        role="button"
        tabIndex={0}
        aria-label={`${label}：${content}`}
      >
        {label}
        <QuestionCircleOutlined aria-hidden="true" className="text-xs text-blue-600" />
      </span>
    </Tooltip>
  )
}
