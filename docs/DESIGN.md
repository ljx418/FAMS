# FAMS 设计规范

## 概述
金融资产管理系统设计规范，参考 Stripe/Linear 深色主题风格。

## 色彩系统

### 主色
```
--primary: #5A6BFF      /* 主操作蓝紫 */
--primary-hover: #4451E6 /* 主操作悬停 */
```

### 语义色
```
--success: #34D399      /* 涨/盈利 - 翠绿 */
--success-bg: rgba(52, 211, 153, 0.1)
--danger: #F87171       /* 跌/亏损 - 浅红 */
--danger-bg: rgba(248, 113, 113, 0.1)
--warning: #FBBF24     /* 警告 - 琥珀 */
--info: #38BDF8        /* 信息 - 天蓝 */
```

### 背景色
```
--bg-primary: #0F0F23   /* 主背景 - 深黑 */
--bg-secondary: #1A1A2E /* 卡片/面板背景 */
--bg-tertiary: #1F1F3A  /* 表格头/悬停 */
--bg-hover: #252545     /* 交互悬停态 */
```

### 边框色
```
--border: #2A2A4E       /* 边框/分割线 */
--border-light: #374151 /* 浅边框 */
```

### 文字色
```
--text-primary: #FFFFFF   /* 主文字 - 纯白 */
--text-secondary: #E5E7EB /* 次要文字 - 高对比 */
--text-muted: #D1D5DB     /* 弱化文字 - 中对比 */
--text-disabled: #6B7280 /* 禁用文字 */
```

## 字体
```
font-family: 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif

字号:
- h1: 24px / 700
- h2: 20px / 600
- h3: 16px / 600
- body: 14px / 400
- caption: 12px / 400
- small: 11px / 400
```

## 间距系统
```
--space-xs: 4px
--space-sm: 8px
--space-md: 12px
--space-lg: 16px
--space-xl: 20px
--space-2xl: 24px
```

## 圆角
```
--radius-sm: 4px
--radius-md: 6px
--radius-lg: 8px
--radius-xl: 12px
```

## 阴影
```
--shadow-sm: 0 1px 2px rgba(0,0,0,0.3)
--shadow-md: 0 4px 12px rgba(0,0,0,0.4)
--shadow-lg: 0 8px 24px rgba(0,0,0,0.5)
```

## 组件

### 按钮

**主要按钮**
- background: --primary
- color: #FFFFFF
- padding: 8px 16px
- border-radius: --radius-md
- hover: --primary-hover

**次要按钮**
- background: transparent
- border: 1px solid --border
- color: --text-secondary
- hover: --bg-hover

**危险按钮**
- background: --danger
- color: #FFFFFF

### 卡片
```
background: --bg-secondary
border: 1px solid --border
border-radius: --radius-lg
padding: 16px
```

### 表格
```
header: background: --bg-tertiary
row: border-bottom: 1px solid --border
row-hover: background: --bg-hover
cell-padding: 12px 16px
```

### 标签/标签页
```
padding: 2px 8px
border-radius: --radius-sm
font-size: 11px
font-weight: 500
```

### 模态框
```
background: --bg-secondary
border-radius: --radius-xl
padding: 20px
max-width: 480px
overlay: rgba(0,0,0,0.6)
```

### 输入框
```
background: --bg-primary
border: 1px solid --border
border-radius: --radius-md
padding: 8px 12px
color: --text-primary
focus: border-color: --primary
```

### 统计卡片
```
layout: flex column
label: text-muted, 12px
value: text-primary, 24px, font-weight: 600
unit: text-muted, 14px
```

## 动画

### 过渡
```
transition: all 0.15s ease
hover-scale: scale(1.02)
```

### 加载
```
spinner: border-top-color: --primary
animation: spin 0.8s linear infinite
```

## 对比度要求

**WCAG AA (4.5:1) 以上**
- 主文字: #FFFFFF on #0F0F23 = 16:1 ✓
- 次要文字: #E5E7EB on #1A1A2E = 9:1 ✓
- 弱化文字: #D1D5DB on #1A1A2E = 6:1 ✓

**不可用灰色**
- ❌ #9CA3AF (gray-400) - 对比度仅 3:1
- ✅ #D1D5DB (gray-300) - 对比度 5.5:1
- ✅ #E5E7EB (gray-200) - 对比度 7:1
