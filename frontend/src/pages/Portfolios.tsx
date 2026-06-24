import React from 'react'
import { Card, Row, Col } from 'antd'

const Portfolios: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white mb-6">投资组合</h1>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<span className="text-primary">永久组合</span>} className="bg-[#1a1a2e] border-[surface-border]">
            <div className="h-64 flex items-center justify-center text-gray-500">
              ECharts 饼图
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span className="text-primary">全天候组合</span>} className="bg-[#1a1a2e] border-[surface-border]">
            <div className="h-64 flex items-center justify-center text-gray-500">
              ECharts 饼图
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Portfolios
