import { Suspense, lazy } from 'react'
import { Spin } from 'antd'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/AppLayout'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Positions = lazy(() => import('./pages/Positions'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Analysis = lazy(() => import('./pages/Analysis'))
const DividendLowVol = lazy(() => import('./pages/DividendLowVol'))
const Backtest = lazy(() => import('./pages/Backtest'))
const Assets = lazy(() => import('./pages/Assets'))
const Operations = lazy(() => import('./pages/Operations'))
const Alerts = lazy(() => import('./pages/Alerts'))
const FundDetail = lazy(() => import('./pages/FundDetail'))
const StockAnalysis = lazy(() => import('./pages/StockAnalysis'))
const DailyReviews = lazy(() => import('./pages/DailyReviews'))
const RelativeRotation = lazy(() => import('./pages/RelativeRotation'))
const PortfolioComparison = lazy(() => import('./pages/PortfolioComparison'))

const PageFallback = () => (
  <div className="min-h-[50vh] flex items-center justify-center">
    <Spin size="large" />
  </div>
)

function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="assets" element={<Assets />} />
          <Route path="positions" element={<Positions />} />
          <Route path="daily-reviews" element={<DailyReviews />} />
          <Route path="daily-reviews/:reviewId" element={<DailyReviews />} />
          <Route path="fund/:code" element={<FundDetail />} />
          <Route path="stock/:code" element={<StockAnalysis />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="dividend-low-vol" element={<DividendLowVol />} />
          <Route path="relative-rotation" element={<RelativeRotation />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="operations" element={<Operations />} />
          <Route path="backtest" element={<Backtest />} />
          <Route path="portfolio-comparison" element={<PortfolioComparison />} />
          <Route path="portfolios" element={<Navigate to="/positions" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default App
