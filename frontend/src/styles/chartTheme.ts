import type { EChartsOption } from 'echarts'

// 涨红跌绿颜色配置 - 浅色背景下优先保证可视度
export const colors = {
  rising: '#dc2626',
  falling: '#047857',
  neutral: '#1d4ed8',

  // 图表配色 - 提高对比度
  primary: '#1d4ed8',
  secondary: '#7c3aed',
  accent: '#b45309',
  success: '#047857',
  warning: '#a16207',
  danger: '#b91c1c',

  // 均线颜色
  ma5: '#a16207',
  ma10: '#0369a1',
  ma20: '#be185d',
  ma30: '#e11d48',
  ma60: '#7e22ce',

  background: '#ffffff',
  card: '#ffffff',
  text: '#0f172a',
  textSecondary: '#475569',
  border: '#cbd5e1',

  // 网格
  grid: '#cbd5e1',
  gridLight: '#e2e8f0',

  // 基金图表颜色
  fundColors: ['#1d4ed8', '#b45309', '#047857', '#be185d', '#0369a1'],
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

// 历史导出名保持不变，实际为浅色高对比图表主题
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

// 预定义的渐变色
export const gradients = {
  rising: [
    [0, 'rgba(220, 38, 38, 0.28)'],
    [1, 'rgba(220, 38, 38, 0.03)'],
  ],
  falling: [
    [0, 'rgba(4, 120, 87, 0.28)'],
    [1, 'rgba(4, 120, 87, 0.03)'],
  ],
  primary: [
    [0, 'rgba(29, 78, 216, 0.28)'],
    [1, 'rgba(29, 78, 216, 0.03)'],
  ],
  accent: [
    [0, 'rgba(180, 83, 9, 0.28)'],
    [1, 'rgba(180, 83, 9, 0.03)'],
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
