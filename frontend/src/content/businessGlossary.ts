export const businessGlossary = {
  rrg: {
    label: 'RRG',
    explanation: '相对轮动图。用同一基准比较多个标的的相对强弱与动量，只描述相对趋势，不等同于买卖信号。',
  },
  macd: {
    label: 'MACD',
    explanation: '用快慢移动平均线观察趋势和动量变化。本项目只把它作为多层研究门控之一。',
  },
  moving_average: {
    label: '均线',
    explanation: '一段时间内收盘价的平均值。MA5、MA10、MA30 分别代表最近 5、10、30 个交易日。',
  },
  atr: {
    label: 'ATR',
    explanation: '平均真实波幅，用来衡量近期价格波动，并辅助确定网格间距，不预测涨跌方向。',
  },
  volume_confirmation: {
    label: '成交量确认',
    explanation: '检查价格变化是否得到成交量配合；量价不一致时，研究结论会降低可信度或保持观察。',
  },
  grid_plan: {
    label: '交易网格',
    explanation: '预先记录的分档观察价格、数量和有效期。它是人工计划草案，不会自动创建或提交订单。',
  },
  benchmark: {
    label: '基准',
    explanation: '用于比较策略或标的表现的共同参照。基准口径不同会直接影响相对收益和轮动结论。',
  },
  maximum_drawdown: {
    label: '最大回撤',
    explanation: '观察期内从历史高点到随后低点的最大跌幅，用来衡量最不利阶段的损失。',
  },
  equity_curve: {
    label: '收益曲线',
    explanation: '把同一时间段内的累计收益按日期绘制成曲线，便于比较收益、波动和回撤。',
  },
  data_freshness: {
    label: '数据新鲜度',
    explanation: '数据截止时间与预期最近交易日之间的距离。过期数据只能支持观察，不能生成精确价格草案。',
  },
  validation_ready: {
    label: '验证充分',
    explanation: '历史样本、共同基准、公式计算和数据时点均达到当前研究门槛；不代表正式交易已放行。',
  },
  evidence_refs: {
    label: '证据引用',
    explanation: '记录结论所使用的行情、快照、任务产物或审计文件，便于追溯数据来源和计算过程。',
  },
  formal_trade_gate: {
    label: '正式交易 gate',
    explanation: '正式交易前的数据、模型、人工签核和执行隔离门槛。回测通过本身不会解锁下单。',
  },
} as const

export type BusinessTermId = keyof typeof businessGlossary
