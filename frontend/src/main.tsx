import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: '#1d4ed8',
            colorSuccess: '#047857',
            colorWarning: '#a16207',
            colorError: '#b91c1c',
            colorInfo: '#0369a1',
            colorText: '#0f172a',
            colorTextSecondary: '#334155',
            colorTextTertiary: '#475569',
            colorTextQuaternary: '#64748b',
            colorBgLayout: '#f1f5f9',
            colorBgContainer: '#ffffff',
            colorBgElevated: '#ffffff',
            colorBorder: '#cbd5e1',
            colorBorderSecondary: '#e2e8f0',
            colorFillAlter: '#f8fafc',
            colorFillSecondary: '#f1f5f9',
            borderRadius: 8,
            controlHeight: 40,
            fontSize: 15,
          },
          components: {
            Button: {
              primaryShadow: 'none',
              defaultBorderColor: '#94a3b8',
              defaultColor: '#1e293b',
            },
            Card: {
              headerFontSize: 16,
            },
            Menu: {
              itemColor: '#334155',
              itemSelectedColor: '#1d4ed8',
              itemSelectedBg: '#dbeafe',
              groupTitleColor: '#475569',
            },
            Table: {
              headerColor: '#1e293b',
              headerBg: '#f1f5f9',
              rowHoverBg: '#eff6ff',
            },
          },
        }}
      >
        <AntApp>
          <App />
        </AntApp>
      </ConfigProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
