import React from 'react'
import { Tag } from 'antd'

const ReliabilityWarnings: React.FC<{
  warnings: string[]
  className?: string
}> = ({ warnings, className }) => {
  if (warnings.length === 0) return null

  return (
    <div className={className || 'flex flex-wrap gap-2'}>
      {warnings.map((warning) => (
        <Tag key={warning} color="#fbbf24">
          {warning}
        </Tag>
      ))}
    </div>
  )
}

export default ReliabilityWarnings
