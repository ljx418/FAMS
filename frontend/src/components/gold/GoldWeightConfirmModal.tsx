import React, { useEffect } from 'react'
import { Modal, Form, InputNumber, Card, Row, Col, Statistic } from 'antd'
import { colors } from '../../styles/chartTheme'

interface GoldWeightConfirmModalProps {
  visible: boolean
  marketValue: number
  goldPrice: number
  estimatedWeight: number
  onConfirm: (weight: number) => void
  onCancel: () => void
}

const GoldWeightConfirmModal: React.FC<GoldWeightConfirmModalProps> = ({
  visible,
  marketValue,
  goldPrice,
  estimatedWeight: initialWeight,
  onConfirm,
  onCancel,
}) => {
  const [form] = Form.useForm()

  useEffect(() => {
    if (visible) {
      form.setFieldValue('weight', initialWeight)
    }
  }, [visible, initialWeight, form])

  const handleConfirm = () => {
    const finalWeight = form.getFieldValue('weight')
    if (finalWeight && finalWeight > 0) {
      onConfirm(finalWeight)
    }
  }

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <span className="text-[#FBBF24] text-lg font-bold">设置黄金克重</span>
        </div>
      }
      open={visible}
      onCancel={onCancel}
      onOk={handleConfirm}
      okText="确认"
      cancelText="取消"
      width={420}
      destroyOnHidden
    >
      <div className="space-y-4 py-4">
        <Card className="bg-[#0f0f23] border-[surface-border] card-md">
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Statistic
                title={<span className="text-gray-300 text-xs">当前净值</span>}
                value={marketValue / 10000}
                suffix="万"
                precision={2}
                valueStyle={{ color: colors.primary, fontSize: '20px' }}
              />
            </Col>
            <Col span={12}>
              <Statistic
                title={<span className="text-gray-300 text-xs">金价</span>}
                value={goldPrice}
                suffix="元/克"
                precision={2}
                valueStyle={{ color: colors.accent, fontSize: '20px' }}
              />
            </Col>
          </Row>
        </Card>

        <div className="bg-[#1a1a2e] rounded-lg p-4 border border-[surface-border]">
          <div className="text-gray-300 text-sm mb-3 text-center">
            根据净值和金价估算克重，请确认或调整
          </div>
          <Form form={form} layout="vertical">
            <Form.Item
              name="weight"
              label={<span className="text-gray-300">克重（克）</span>}
              rules={[{ required: true, message: '请输入克重' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                precision={2}
                placeholder="请输入克重"
                size="large"
              />
            </Form.Item>
          </Form>
          <div className="text-center text-gray-500 text-xs mt-2">
            估算克重: {(marketValue / goldPrice).toFixed(2)} 克
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default GoldWeightConfirmModal
