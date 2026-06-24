import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('echarts-for-react')) {
            return 'vendor-echarts-react'
          }

          if (id.includes('zrender')) {
            return 'vendor-zrender'
          }

          if (id.includes('echarts/lib') || id.includes('echarts/core') || id.includes('echarts/types')) {
            return 'vendor-echarts-core'
          }

          if (id.includes('echarts/charts')) {
            return 'vendor-echarts-charts'
          }

          if (id.includes('echarts/components')) {
            return 'vendor-echarts-components'
          }

          if (id.includes('echarts/renderers') || id.includes('echarts/features')) {
            return 'vendor-echarts-renderers'
          }

          if (id.includes('antd/es/table') || id.includes('antd/lib/table') || id.includes('rc-table')) {
            return 'vendor-table'
          }

          if (id.includes('antd') || id.includes('@ant-design') || id.includes('rc-')) {
            return 'vendor-antd'
          }

          if (id.includes('react') || id.includes('scheduler')) {
            return 'vendor-react'
          }

          if (id.includes('lodash') || id.includes('dayjs') || id.includes('axios')) {
            return 'vendor-utils'
          }
        },
      },
    },
  },
})
