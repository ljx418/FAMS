import React from 'react'
import { Card, Row, Col, Statistic } from 'antd'

interface ValuationCardsProps {
  pe?: number
  pb?: number
  roe?: number
}

const ValuationCards: React.FC<ValuationCardsProps> = ({ pe, pb, roe }) => {
  const renderValue = (value?: number, suffix?: string) => {
    if (value === undefined || value === null) return '--'
    return `${value.toFixed(2)}${suffix || ''}`
  }

  const getPERating = (pe?: number) => {
    if (pe === undefined || pe === null) return { color: '#A0A0A0', label: '--' }
    if (pe < 0) return { color: '#A0A0A0', label: '亏损' }
    if (pe < 15) return { color: '#34d399', label: '低估' }
    if (pe < 30) return { color: '#FAC858', label: '合理' }
    return { color: '#f87171', label: '高估' }
  }

  const getPBRating = (pb?: number) => {
    if (pb === undefined || pb === null) return { color: '#A0A0A0', label: '--' }
    if (pb < 0) return { color: '#A0A0A0', label: '亏损' }
    if (pb < 1) return { color: '#34d399', label: '低估' }
    if (pb < 3) return { color: '#FAC858', label: '合理' }
    return { color: '#f87171', label: '高估' }
  }

  const getROERating = (roe?: number) => {
    if (roe === undefined || roe === null) return { color: '#A0A0A0', label: '--' }
    if (roe < 0) return { color: '#f87171', label: '负收益' }
    if (roe < 10) return { color: '#FAC858', label: '较低' }
    if (roe < 20) return { color: '#34d399', label: '良好' }
    return { color: '#5a6bff', label: '优秀' }
  }

  const peRating = getPERating(pe)
  const pbRating = getPBRating(pb)
  const roeRating = getROERating(roe)

  return (
    <Row gutter={[12, 12]}>
      <Col xs={8}>
        <Card className="bg-[#1a1a2e] border-[surface-border] text-center">
          <Statistic
            title={<span className="text-gray-300 text-xs">市盈率 PE</span>}
            value={renderValue(pe)}
            valueStyle={{ color: peRating.color, fontSize: '20px' }}
          />
          <div
            className="text-xs mt-1 px-2 py-0.5 rounded inline-block"
            style={{ backgroundColor: `${peRating.color}20`, color: peRating.color }}
          >
            {peRating.label}
          </div>
        </Card>
      </Col>
      <Col xs={8}>
        <Card className="bg-[#1a1a2e] border-[surface-border] text-center">
          <Statistic
            title={<span className="text-gray-300 text-xs">市净率 PB</span>}
            value={renderValue(pb)}
            valueStyle={{ color: pbRating.color, fontSize: '20px' }}
          />
          <div
            className="text-xs mt-1 px-2 py-0.5 rounded inline-block"
            style={{ backgroundColor: `${pbRating.color}20`, color: pbRating.color }}
          >
            {pbRating.label}
          </div>
        </Card>
      </Col>
      <Col xs={8}>
        <Card className="bg-[#1a1a2e] border-[surface-border] text-center">
          <Statistic
            title={<span className="text-gray-300 text-xs">净资产收益率 ROE</span>}
            value={renderValue(roe, '%')}
            valueStyle={{ color: roeRating.color, fontSize: '20px' }}
          />
          <div
            className="text-xs mt-1 px-2 py-0.5 rounded inline-block"
            style={{ backgroundColor: `${roeRating.color}20`, color: roeRating.color }}
          >
            {roeRating.label}
          </div>
        </Card>
      </Col>
    </Row>
  )
}

export default ValuationCards
