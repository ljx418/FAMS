# FAMS 会话进度记录

更新日期：2026-05-06  
工作环境：WSL，项目路径 `/mnt/c/workSpace/financial-asset-manager`，Windows 路径 `C:\workSpace\financial-asset-manager`

## 当前推进原则

- 后续开发严格按照 `docs/target-architecture-gap.drawio` 推进。
- 每完成一个开发节点，必须执行一次端到端验证。
- 验证通过后，同步更新：
  - `docs/target-architecture-gap.drawio`
  - `docs/TARGET_ARCHITECTURE_GAP.md`
  - 必要时刷新 `docs/drawio-summary.txt`
- 未完成端到端验证的能力不得标为“已完成”，只能标为“部分完成”或“待验证”。

## 今日完成事项

### 文档与架构路线

- 将 `docs/target-architecture-gap.drawio` 重构为全中文架构路线图。
- 图中保留两页：
  - `目标架构`
  - `当前到目标 Gap 路线图`
- 每个阶段已标明：
  - 技术架构
  - 主要功能点
  - 对应 Gap
  - 当前进度
  - 开发计划与验收节点
- 图下方新增统一规则：每到一个节点执行一次端到端验证，并根据完成情况同步更新 gap 文档。
- 修复 drawio 深色网格下文字不可读的问题：
  - 卡片文字改为深色
  - 泳道标题加粗加深
  - 卡片字号提升
  - 连线和边框加粗
- 同步更新：
  - `docs/TARGET_ARCHITECTURE_GAP.md`
  - `docs/drawio-summary.txt`

### Windows 本地工具

- 已确认 Windows 本地 draw.io 安装路径：
  - `C:\Program Files\draw.io\draw.io.exe`
- 用户可以在 Windows 本地直接打开 docs 里的 `.drawio` 文件查看和编辑。

### 行情与 ETF 价格修复

- 用户反馈 `513770` 当前价格应为 `0.421`。
- 已验证并修复 ETF 行情路径：
  - 支持 `513xxx`、`159xxx` 等 ETF 风格代码。
  - 修正 SH/SZ 市场映射。
  - 修正 Eastmoney ETF 价格缩放。
  - 增加 Sina fallback。
  - axios 行情请求使用 `proxy: false`，绕开 WSL 代理导致的请求失败。
- 已验证：
  - `GET /api/v1/prices/realtime?symbol=513770&source=auto&assetType=stock`
  - 返回价格 `0.421`，来源 `sina`。

### 标签类型同步与三位小数

- 修复资产类型标签修改后左侧类型不同步的问题。
- 类型标签现在会同步更新底层 `asset.type`。
- 例如将 ETF 相关资产类型修正为 `股票` 后，刷新价格仍走正确行情路径。
- 前端价格显示和价格输入已统一保留三位小数：
  - Assets 表格现价
  - Assets 交易弹窗当前市价
  - Assets 交易记录价格
  - Transactions 交易价格
  - FundDetail / FundDetailModal 持仓现价
  - EditAssetModal 股票成本价与黄金现价
- 修复后清理 Vite 缓存并重启前端，避免浏览器继续拿旧模块。

### API、交易、告警与 Operation

前面阶段已落地并体现在 gap 图中：

- 核心写接口增加 JSON Schema 校验和稳定错误契约。
- 默认用户上下文通过 `ensureUser` 兜底。
- `PositionService` 成为 Dashboard / Assets 仓位汇总来源之一。
- `Tag` / `AssetTag` 同步逻辑收敛到 position 写路径。
- 手动交易增加二次确认弹窗。
- 交易成功后触发风险检查，并返回 `riskCheck` 结果。
- Alerts 页面成为风险告警的独立产物面。
- `check_alerts` Operation 已接入任务中心。
- 失败或取消的 Operation 支持 parent-linked retry。

## 当前运行方式

因为 Windows/WSL 下 `node_modules/.bin` shim 可能不可用，优先使用真实 Node 入口。

### 后端

```bash
cd /mnt/c/workSpace/financial-asset-manager/backend
node node_modules/tsx/dist/cli.mjs watch src/index.ts
```

后台启动方式：

```bash
setsid -f bash -lc 'cd /mnt/c/workSpace/financial-asset-manager/backend && node node_modules/tsx/dist/cli.mjs watch src/index.ts > /tmp/fams-backend.log 2>&1'
```

访问地址：

- API：`http://localhost:4000`
- Swagger：`http://localhost:4000/api-docs`

### 前端

```bash
cd /mnt/c/workSpace/financial-asset-manager/frontend
node node_modules/vite/bin/vite.js --host 0.0.0.0
```

后台启动方式：

```bash
setsid -f bash -lc 'cd /mnt/c/workSpace/financial-asset-manager/frontend && node node_modules/vite/bin/vite.js --host 0.0.0.0 > /tmp/fams-frontend.log 2>&1'
```

访问地址：

- `http://localhost:3000`

### 常用检查

```bash
ps -ef | rg "vite|tsx|src/index.ts"
node docs/read-drawio.mjs docs/target-architecture-gap.drawio
node docs/read-drawio.mjs > docs/drawio-summary.txt
```

前端构建检查：

```bash
cd /mnt/c/workSpace/financial-asset-manager/frontend
node node_modules/typescript/bin/tsc && node node_modules/vite/bin/vite.js build
```

## 端到端验证约定

后续每个开发节点至少验证四层：

1. 后端接口：状态码、DTO、错误契约、关键字段。
2. 数据库状态：资产、仓位、交易、告警、Operation 或快照是否持久化正确。
3. 前端运行态：通过浏览器自动化或截图确认实际页面显示正确。
4. 业务结果：价格、仓位、盈亏、标签、交易、告警或任务状态一致。

涉及 UI 的问题，后续默认使用浏览器运行态验证，不只看源码。

## 下次恢复起点

1. 先读取：
   - 本文件
   - `docs/target-architecture-gap.drawio`
   - `docs/TARGET_ARCHITECTURE_GAP.md`
   - `docs/drawio-summary.txt`
2. 确认前后端是否还在运行：
   - `ps -ef | rg "vite|tsx|src/index.ts"`
3. 如果服务不在，按上面的真实 Node 入口启动。
4. 继续开发时，从 `当前到目标 Gap 路线图` 的 V1.0/V1.5 节点推进。
5. 每完成一个节点，先端到端验证，再更新 gap 图和文档。

## 当前状态判断

- 当前主线仍是 `V1.0 可信投资账本` 到 `V1.5 行情可靠性与异步任务`。
- `V2.0 FAMS Connect` 和 `V3.0 harnessOS 编排` 暂不作为当前开发主线。
- 今日最后确认的用户要求：后续严格按照中文 gap 图推进，今天开发结束，保存当前项目和对话进度。
