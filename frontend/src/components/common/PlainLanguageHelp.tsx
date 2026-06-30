import { QuestionCircleOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

type PlainLanguageHelpProps = {
  term: string
  explanation: string
}

export function PlainLanguageHelp({ term, explanation }: PlainLanguageHelpProps) {
  return (
    <Tooltip title={explanation}>
      <span className="inline-flex items-center gap-1 text-sky-200">
        {term}
        <QuestionCircleOutlined aria-hidden="true" className="text-xs text-sky-300" />
      </span>
    </Tooltip>
  )
}
