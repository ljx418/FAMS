import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'FAMS External Brain',
    description: 'FAMS 本地研究工作台的浏览器入口。只读研究与受控问答，不执行交易。',
    version: '0.1.0',
    permissions: ['sidePanel', 'tabs', 'storage'],
    host_permissions: [],
    optional_host_permissions: [
      'http://localhost:4000/*',
      'http://127.0.0.1:4000/*',
    ],
    externally_connectable: {
      matches: ['http://localhost:3000/*', 'http://127.0.0.1:3000/*'],
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; connect-src http://localhost:4000 http://127.0.0.1:4000",
    },
  },
})
