# 资产清单导入功能实现计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development (推荐) 或 superpowers:executing-plans 来执行此计划。

**目标:** 解析用户提供的Excel资产清单（2026仓位管理-20260407.xlsx），识别大类/属性/小类/代码，根据持有收益率或盈亏值推导持仓成本，并导入到系统中。

**架构:** 新增 `/api/v1/assets/import` 路由和对应的import Service。解析规则：若收益率列为百分数（如"-7.68%"）则为收益率，若为两位小数（如"-0.1"）则为盈亏值（万元）。持仓成本 = 持仓净值 / (1 + 收益率) 或 持仓净值 - 盈亏值。

**技术栈:** Node.js + Fastify + xlsx + Prisma ORM + React + Ant Design

---

## 文件影响范围

| 文件 | 操作 | 职责 |
|------|------|------|
| `backend/src/routes/asset.ts` | 修改 | 新增 `/import` 路由 |
| `backend/src/services/asset/assetService.ts` | 创建 | 资产清单解析导入逻辑 |
| `backend/src/services/position/positionService.ts` | 修改 | 新增 `importPositions` 方法 |
| `frontend/src/pages/Positions.tsx` | 修改 | 添加导入按钮和成本显示列 |

---

## Task 1: 创建 Asset Service

**Files:**
- Create: `backend/src/services/asset/assetService.ts`
- Test: 手动通过API测试

- [ ] **Step 1: 创建 assetService.ts**

```typescript
import * as XLSX from 'xlsx'
import { prisma } from '../../index.js'
import { positionService } from '../position/positionService.js'

interface ExcelRow {
  '大类'?: string
  '属性'?: string
  '小类'?: string
  '代码'?: string | number
  '持有收益率（%）/盈亏值（万元）'?: string | number
  '持仓净值'?: string | number
}

interface ParsedPosition {
  category: string    // 大类
  attribute: string   // 属性
  subCategory: string // 小类
  symbol: string | null
  netValue: number    // 持仓净值
  pnlOrPercent: number | null  // 盈亏值(万元)或收益率(%)
  isPercent: boolean   // true=收益率, false=盈亏值
  calculatedCost: number | null // 推导的持仓成本
}

export interface ImportResult {
  success: number
  failed: number
  total: number
  errors: Array<{ row: number; message: string }>
  parsedData: ParsedPosition[]
}

class AssetService {
  /**
   * 从Excel文件解析资产数据
   */
  parseExcelPositions(file: Buffer): ParsedPosition[] {
    const workbook = XLSX.read(file)
    const sheetName = workbook.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName])

    const parsed: ParsedPosition[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row['大类']) continue // 跳过空行

      const netValue = this.parseNumber(row['持仓净值'])
      const pnlOrPercent = this.parseNumber(row['持有收益率（%）/盈亏值（万元）'])

      // 判断是收益率还是盈亏值：如果包含%则为收益率，否则为两位小数的盈亏值
      const pnlOrPercentStr = String(row['持有收益率（%）/盈亏值（万元）'] || '').trim()
      const isPercent = pnlOrPercentStr.includes('%')

      // 计算持仓成本
      let calculatedCost: number | null = null
      if (netValue && pnlOrPercent !== null) {
        if (isPercent) {
          // 收益率：持仓成本 = 持仓净值 / (1 + 收益率/100)
          const percent = pnlOrPercent / 100
          calculatedCost = percent !== -1 ? netValue / (1 + percent) : null
        } else {
          // 盈亏值：持仓成本 = 持仓净值 - 盈亏值
          calculatedCost = netValue - pnlOrPercent
        }
      }

      parsed.push({
        category: String(row['大类'] || '').trim(),
        attribute: String(row['属性'] || '').trim(),
        subCategory: String(row['小类'] || '').trim(),
        symbol: row['代码'] ? String(row['代码']).trim() : null,
        netValue: netValue || 0,
        pnlOrPercent,
        isPercent,
        calculatedCost,
      })
    }

    return parsed
  }

  /**
   * 解析数值（处理字符串和数字）
   */
  private parseNumber(value: string | number | undefined): number | null {
    if (value === undefined || value === null) return null
    if (typeof value === 'number') return value
    const cleaned = String(value).replace(/[,%]/g, '').trim()
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? null : parsed
  }

  /**
   * 将解析的资产数据导入到数据库
   */
  async importPositions(userId: string, parsedData: ParsedPosition[]): Promise<ImportResult> {
    const result: ImportResult = {
      success: 0,
      failed: 0,
      total: parsedData.length,
      errors: [],
      parsedData,
    }

    for (let i = 0; i < parsedData.length; i++) {
      const item = parsedData[i]
      try {
        // 确定资产类型映射
        const assetType = this.mapCategoryToAssetType(item.category)

        // 查找或创建资产
        let asset
        if (item.symbol) {
          asset = await prisma.asset.findUnique({ where: { symbol: String(item.symbol) } })
          if (!asset) {
            asset = await prisma.asset.create({
              data: {
                symbol: String(item.symbol),
                name: item.subCategory,
                type: assetType,
              },
            })
          }
        } else {
          // 无代码的资产（如现金），使用复合唯一键
          const compositeKey = `${item.category}-${item.attribute}-${item.subCategory}`
          asset = await prisma.asset.findFirst({
            where: {
              name: item.subCategory,
              type: assetType,
            },
          })
          if (!asset) {
            asset = await prisma.asset.create({
              data: {
                symbol: compositeKey,
                name: item.subCategory,
                type: assetType,
              },
            })
          }
        }

        // 创建仓位
        if (asset && item.netValue > 0) {
          const avgCost = item.calculatedCost && item.calculatedCost > 0
            ? item.calculatedCost
            : item.netValue // 如果无法计算成本，默认使用净值

          await positionService.createPosition(userId, {
            assetId: asset.id,
            quantity: 1,
            avgCost,
            tags: [item.category, item.attribute, item.subCategory],
            labels: [],
          })
        }

        result.success++
      } catch (error) {
        result.failed++
        result.errors.push({
          row: i + 2, // Excel行号从1开始，且有表头
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return result
  }

  /**
   * 大类映射到资产类型
   */
  private mapCategoryToAssetType(category: string): string {
    const mapping: Record<string, string> = {
      '现金': 'cash',
      '黄金': 'gold',
      '基金': 'fund',
      '债基': 'bond',
      '股票': 'stock',
      '股指': 'etf',
    }
    return mapping[category] || 'stock'
  }
}

export const assetService = new AssetService()
```

- [ ] **Step 2: 在 index.ts 导出 assetService（如果需要）**

- [ ] **Step 3: 测试解析功能**

通过 curl 上传文件测试解析结果。

---

## Task 2: 添加导入路由

**Files:**
- Modify: `backend/src/routes/asset.ts`

- [ ] **Step 1: 读取现有 asset.ts 路由**

```typescript
import { FastifyInstance } from 'fastify'
import { assetService } from '../services/asset/assetService.js'
import { positionService } from '../services/position/positionService.js'

export async function assetRoutes(app: FastifyInstance) {
  // 获取资产列表
  app.get('/', async (request) => {
    const { userId, type, page, limit } = request.query as any
    return assetService.getAssets(userId, { type, page, limit })
  })

  // 获取单个资产
  app.get('/:id', async (request) => {
    const { id } = request.params as any
    return assetService.getAsset(id)
  })

  // 创建资产
  app.post('/', async (request) => {
    const data = request.body as any
    return assetService.createAsset(data)
  })

  // 更新资产
  app.put('/:id', async (request) => {
    const { id } = request.params as any
    const data = request.body as any
    return assetService.updateAsset(id, data)
  })

  // 删除资产
  app.delete('/:id', async (request) => {
    const { id } = request.params as any
    return assetService.deleteAsset(id)
  })

  // 解析Excel资产清单（预览，不入库）
  app.post('/parse', async (request) => {
    const data = await request.file()
    if (!data) {
      throw new Error('No file uploaded')
    }
    const buffer = await data.toBuffer()
    const parsed = assetService.parseExcelPositions(buffer)
    return { data: parsed }
  })

  // 导入Excel资产清单（入库）
  app.post('/import', async (request) => {
    const { userId } = request.body as any
    const data = await request.file()
    if (!data) {
      throw new Error('No file uploaded')
    }
    const buffer = await data.toBuffer()
    const parsed = assetService.parseExcelPositions(buffer)
    return assetService.importPositions(userId, parsed)
  })
}
```

---

## Task 3: 更新前端 Positions 页面

**Files:**
- Modify: `frontend/src/pages/Positions.tsx`

- [ ] **Step 1: 更新 Positions.tsx 添加导入功能和成本列**

```typescript
import React, { useState, useEffect } from 'react'
import { Table, Tag, Button, Card, Input, Upload, message, Modal } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { UploadOutlined } from '@ant-design/icons'
import axios from 'axios'

interface Position {
  id: string
  symbol: string
  name: string
  type: string
  quantity: number
  avgCost: number      // 持仓成本
  currentPrice: number
  marketValue: number
  costBasis: number    // 总成本
  pnl: number
  pnlPercent: number
  status: string
  tags: string[]
}

const Positions: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(false)
  const [importModalVisible, setImportModalVisible] = useState(false)
  const [parsedPreview, setParsedPreview] = useState<any[]>([])

  useEffect(() => {
    fetchPositions()
  }, [])

  const fetchPositions = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/v1/positions?userId=default')
      setPositions(response.data.data)
    } catch (error) {
      console.error('Failed to fetch positions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleParseExcel = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    try {
      const response = await axios.post('/api/v1/assets/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setParsedPreview(response.data.data)
      setImportModalVisible(true)
    } catch (error) {
      message.error('解析失败')
    }
    return false // 阻止默认上传
  }

  const handleImport = async () => {
    const file = (document.querySelector('input[type=file]') as HTMLInputElement)?.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)
    formData.append('userId', 'default')
    try {
      const response = await axios.post('/api/v1/assets/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      message.success(`导入成功: ${response.data.success}条`)
      setImportModalVisible(false)
      fetchPositions()
    } catch (error) {
      message.error('导入失败')
    }
  }

  const columns: ColumnsType<Position> = [
    { title: '代码', dataIndex: 'symbol', key: 'symbol' },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (type) => (
      <Tag color="blue">{type}</Tag>
    )},
    { title: '数量', dataIndex: 'quantity', key: 'quantity' },
    { title: '成本价', dataIndex: 'avgCost', key: 'avgCost', render: (v) => v?.toFixed(4) || '-' },
    { title: '当前价', dataIndex: 'currentPrice', key: 'currentPrice' },
    { title: '市值', dataIndex: 'marketValue', key: 'marketValue' },
    {
      title: '浮动盈亏',
      dataIndex: 'pnl',
      key: 'pnl',
      render: (value: number, record: Position) => (
        <span className={value >= 0 ? 'text-[#73D897]' : 'text-[#EE6666]'}>
          {value >= 0 ? '+' : ''}{value.toFixed(2)} ({record.pnlPercent.toFixed(2)}%)
        </span>
      ),
    },
    { title: '状态', dataIndex: 'status', key: 'status', render: (status) => (
      <Tag color={status === 'open' ? 'green' : 'red'}>{status === 'open' ? '持仓中' : '已平仓'}</Tag>
    )},
  ]

  const previewColumns: ColumnsType<any> = [
    { title: '大类', dataIndex: 'category', key: 'category' },
    { title: '属性', dataIndex: 'attribute', key: 'attribute' },
    { title: '小类', dataIndex: 'subCategory', key: 'subCategory' },
    { title: '代码', dataIndex: 'symbol', key: 'symbol' },
    { title: '持仓净值', dataIndex: 'netValue', key: 'netValue' },
    { title: '收益率/盈亏', dataIndex: 'pnlOrPercent', key: 'pnlOrPercent', render: (v, r) => r.isPercent ? `${v}%` : v },
    { title: '持仓成本', dataIndex: 'calculatedCost', key: 'calculatedCost', render: (v) => v?.toFixed(4) || '-' },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white mb-6">仓位管理</h1>

      <Card className="bg-[#1a1a2e] border-[#2a2a4e]">
        <div className="flex justify-between mb-4">
          <Input.Search placeholder="搜索仓位..." className="w-64" />
          <div className="flex gap-2">
            <Upload beforeUpload={handleParseExcel} showUploadList={false}>
              <Button icon={<UploadOutlined />}>导入Excel</Button>
            </Upload>
            <Button type="primary">新建仓位</Button>
          </div>
        </div>
        <Table columns={columns} dataSource={positions} rowKey="id" loading={loading} />
      </Card>

      <Modal
        title="导入预览"
        open={importModalVisible}
        onCancel={() => setImportModalVisible(false)}
        onOk={handleImport}
        width={1000}
      >
        <Table columns={previewColumns} dataSource={parsedPreview} rowKey="symbol" pagination={false} size="small" />
      </Modal>
    </div>
  )
}

export default Positions
```

---

## Task 4: 配置 Fastify 文件上传

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 注册 fastify-multipart 插件**

在 `backend/src/index.ts` 中添加:

```typescript
import fastifyMultipart from '@fastify/multipart'

// 注册插件
await app.register(fastifyMultipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
})
```

并安装: `npm install @fastify/multipart`

---

## Task 5: 验证完整流程

- [ ] **Step 1: 安装依赖**

```bash
cd backend && npm install @fastify/multipart
```

- [ ] **Step 2: 启动后端**

```bash
cd backend && npm run dev
```

- [ ] **Step 3: 测试解析API**

```bash
curl -X POST -F "file=@/Users/Zhuanz/Desktop/2026仓位管理-20260407.xlsx" http://localhost:4000/api/v1/assets/parse
```

- [ ] **Step 4: 启动前端**

```bash
cd frontend && npm run dev
```

- [ ] **Step 5: 在前端测试导入功能**

访问 http://localhost:3000/positions，点击"导入Excel"按钮。

---

## 验证清单

- [ ] 解析API正确识别大类/属性/小类/代码
- [ ] 收益率（如"-7.68%"）和盈亏值（如"-0.1"）正确区分
- [ ] 持仓成本计算正确：
  - 收益率情况：持仓净值 / (1 + 收益率/100)
  - 盈亏值情况：持仓净值 - 盈亏值
- [ ] 导入后数据入库成功
- [ ] 前端页面显示持仓成本列
