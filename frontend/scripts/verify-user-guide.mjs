import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(scriptDir, '..')
const appSource = readFileSync(resolve(frontendRoot, 'src/App.tsx'), 'utf8')
const layoutSource = readFileSync(resolve(frontendRoot, 'src/components/layout/AppLayout.tsx'), 'utf8')
const chatSource = readFileSync(resolve(frontendRoot, 'src/components/chat/FamsChatBox.tsx'), 'utf8')
const guideSource = readFileSync(resolve(frontendRoot, 'public/fams-user-guide.html'), 'utf8')

function fail(message) {
  console.error(`FAMS 使用指南覆盖校验失败：${message}`)
  process.exitCode = 1
}

function unique(values) {
  return [...new Set(values)]
}

function appRoutes() {
  return unique([...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => {
    const path = match[1]
    return path === '/' ? '/' : `/${path.replace(/^\//, '')}`
  })).filter(route => route !== '/*')
}

function guideRoutes() {
  const match = guideSource.match(/<script id="route-manifest" type="application\/json">([^<]+)<\/script>/)
  if (!match) {
    fail('缺少 route-manifest。')
    return []
  }
  try { return JSON.parse(match[1]) }
  catch {
    fail('route-manifest 不是合法 JSON。')
    return []
  }
}

const routesInApp = appRoutes()
const routesInGuide = guideRoutes()
routesInApp.filter(route => !routesInGuide.includes(route)).forEach(route => fail(`App 路由 ${route} 未写入指南。`))
routesInGuide.filter(route => !routesInApp.includes(route)).forEach(route => fail(`指南路由 ${route} 已不在 App 中。`))

const menuBlock = layoutSource.match(/const menuItems = \[([\s\S]*?)\n\]/)?.[1] || ''
const menuLabels = unique([...menuBlock.matchAll(/label: '([^']+)'/g)].map(match => match[1]))
menuLabels.filter(label => label !== '使用指南' && !guideSource.includes(label)).forEach(label => fail(`导航名称“${label}”未出现在指南内容中。`))

const quickTaskBlock = chatSource.match(/const welcomeTaskCards = \[([\s\S]*?)\n\]/)?.[1] || ''
const quickTaskTitles = unique([...quickTaskBlock.matchAll(/title: '([^']+)'/g)].map(match => match[1]))
quickTaskTitles.filter(title => !guideSource.includes(title)).forEach(title => fail(`ChatBox 快捷任务“${title}”未出现在指南内容中。`))

const requiredSafetyTerms = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE', '不会自动下单', '截图确认前不改写台账']
requiredSafetyTerms.filter(term => !guideSource.includes(term)).forEach(term => fail(`缺少安全边界“${term}”。`))

const requiredInteractions = ['localStorage', 'indexedDB', '下载带截图 HTML', '下载 JSON', '遇到问题', '暂时跳过']
requiredInteractions.filter(term => !guideSource.includes(term)).forEach(term => fail(`缺少交互能力“${term}”。`))

if (!process.exitCode) {
  console.log(`FAMS 使用指南覆盖校验通过：${routesInGuide.length} 个路由、${menuLabels.length} 个导航名称、${quickTaskTitles.length} 个 ChatBox 快捷任务。`)
}
