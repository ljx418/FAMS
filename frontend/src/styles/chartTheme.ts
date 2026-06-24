import type { EChartsOption } from 'echarts'

// 涨红跌绿颜色配置 - 优化对比度
export const colors = {
  rising: '#f87171',      // 上涨红色 - 调亮
  falling: '#34d399',     // 下跌绿色 - 调亮
  neutral: '#818cf8',     // 中性蓝色 - 靛蓝

  // 图表配色 - 提高对比度
  primary: '#818cf8',     // 靛蓝 - 在深色背景更易读
  secondary: '#a78bfa',   // 浅紫
  accent: '#fbbf24',      // 琥珀
  success: '#34d399',     // 翠绿
  warning: '#fbbf24',     // 琥珀
  danger: '#f87171',      // 浅红

  // 均线颜色
  ma5: '#fbbf24',    // MA5 黄色
  ma10: '#38bdf8',   // MA10 天蓝
  ma20: '#f472b6',   // MA20 粉色
  ma60: '#a78bfa',   // MA60 紫色

  // 背景和文字 - 优化对比度
  background: '#0f0f23',   // 主背景 - 深黑
  card: '#1a1a2e',         // 卡片背景
  text: '#ffffff',        // 主文字 - 纯白
  textSecondary: '#d1d5db', // 次要文字 - 浅灰 (对比度 ~6:1)
  border: '#374151',       // 边框 - 灰色

  // 网格
  grid: '#374151',
  gridLight: '#1f1f3a',

  // 基金图表颜色
  fundColors: ['#818cf8', '#fbbf24', '#34d399', '#f472b6', '#38bdf8'],
}

// 字体配置
export const fonts = {
  family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  size: {
    xs: '10px',
    sm: '12px',
    md: '14px',
    lg: '16px',
    xl: '20px',
    xxl: '24px',
  },
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
}

// 网格配置
export const gridBase: EChartsOption['grid'] = {
  left: '10%',
  right: '5%',
  top: '15%',
  bottom: '10%',
  containLabel: true,
}

// 动画配置
export const animation = true

// 暗色主题通用配置
export const darkTheme: EChartsOption = {
  backgroundColor: 'transparent',
  textStyle: {
    color: colors.text,
    fontFamily: fonts.family,
  },
  title: {
    textStyle: {
      color: colors.text,
      fontFamily: fonts.family,
      fontSize: fonts.size.lg,
      fontWeight: fonts.weight.semibold,
    },
  },
  legend: {
    textStyle: {
      color: colors.textSecondary,
      fontFamily: fonts.family,
    },
  },
  tooltip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    textStyle: {
      color: colors.text,
      fontFamily: fonts.family,
    },
  },
  xAxis: {
    axisLine: { lineStyle: { color: colors.grid } },
    axisTick: { lineStyle: { color: colors.grid } },
    axisLabel: { color: colors.textSecondary, fontSize: fonts.size.sm },
    splitLine: { lineStyle: { color: colors.gridLight } },
  },
  yAxis: {
    axisLine: { lineStyle: { color: colors.grid } },
    axisTick: { lineStyle: { color: colors.grid } },
    axisLabel: { color: colors.textSecondary, fontSize: fonts.size.sm },
    splitLine: { lineStyle: { color: colors.gridLight } },
  },
}

// 获取K线图颜色
export const getCandleColor = (open: number, close: number): string => {
  return close >= open ? colors.rising : colors.falling
}

// 获取渐变颜色
export const getGradientColor = (color: string, alpha: number = 0.5): string => {
  return color.replace(')', `, ${alpha})`).replace('rgb', 'rgba')
}

// 预定义的渐变色 - 优化对比度
export const gradients = {
  rising: [
    [0, 'rgba(248, 113, 113, 0.8)'],
    [1, 'rgba(248, 113, 113, 0.1)'],
  ],
  falling: [
    [0, 'rgba(52, 211, 153, 0.8)'],
    [1, 'rgba(52, 211, 153, 0.1)'],
  ],
  primary: [
    [0, 'rgba(129, 140, 248, 0.8)'],
    [1, 'rgba(129, 140, 248, 0.1)'],
  ],
  accent: [
    [0, 'rgba(251, 191, 36, 0.8)'],
    [1, 'rgba(251, 191, 36, 0.1)'],
  ],
}

export default {
  colors,
  fonts,
  gridBase,
  animation,
  darkTheme,
  gradients,
  getCandleColor,
  getGradientColor,
}
