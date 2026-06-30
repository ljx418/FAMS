import { Segmented, Space, Tag } from 'antd'

export type ExperienceMode = 'plain' | 'expert'

type ExperienceModeToggleProps = {
  value: ExperienceMode
  onChange: (value: ExperienceMode) => void
}

export function ExperienceModeToggle({ value, onChange }: ExperienceModeToggleProps) {
  return (
    <Space size={8} wrap>
      <Segmented
        aria-label="体验模式"
        value={value}
        options={[
          { label: '普通模式', value: 'plain' },
          { label: '专业模式', value: 'expert' },
        ]}
        onChange={(next) => onChange(next as ExperienceMode)}
      />
      <Tag color={value === 'plain' ? '#38bdf8' : '#a78bfa'}>
        {value === 'plain' ? '先看结论' : '完整证据'}
      </Tag>
    </Space>
  )
}
