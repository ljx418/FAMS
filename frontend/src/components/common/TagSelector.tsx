import React, { useState, useEffect } from 'react'
import { Select, Tag, Button, Input, Popover, message, Popconfirm, Empty } from 'antd'
import { CloseOutlined, DeleteOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons'
import axios from 'axios'

interface TagSelectorProps {
  value?: string[]
  onChange?: (tags: string[]) => void
  placeholder?: string
  maxTags?: number
}

interface TagItem {
  id: string
  name: string
  color: string
  category?: string
}

// 预设标签及其颜色
const PRESET_TAGS: Record<string, string> = {
  '股票': '#5a6bff',
  'A股': '#5470C6',
  '港股': '#95DE64',
  '美股': '#FF9F7F',
  '新能源': '#95DE64',
  '科技': 'primary',
  '医药': 'danger',
  '消费': '#FAC858',
  '金融': '#7262FD',
  '地产': '#D0D0D0',
  '黄金': '#FFD700',
  '基金': '#36CFC9',
  '债券': '#A0A0A0',
  'ETF': '#36CFC9',
  '现金': '#38bdf8',
  'REIT': '#a78bfa',
  '半导体': 'primary',
}

const TAG_CATEGORIES = [
  { value: 'assetType', label: '类型', color: '#38bdf8' },
  { value: 'market', label: '市场', color: '#5a6bff' },
  { value: 'industry', label: '行业', color: '#f59e0b' },
  { value: 'strategy', label: '策略', color: '#22c55e' },
  { value: 'risk', label: '风险', color: '#f87171' },
  { value: 'custom', label: '自定义', color: '#64748b' },
]

const inferTagCategory = (tagName: string) => {
  if (['股票', '基金', '债券', '黄金', '现金', 'ETF', '债基', '权益类', '固定收益'].includes(tagName)) return 'assetType'
  if (['A股', '港股', '美股'].includes(tagName)) return 'market'
  if (tagName.includes('科技') || tagName.includes('医') || tagName.includes('消费') || tagName.includes('金融') || tagName.includes('互联') || tagName.includes('新能源')) return 'industry'
  if (tagName.includes('定投') || tagName.includes('网格') || tagName.includes('红利') || tagName.includes('低波')) return 'strategy'
  if (tagName.includes('高风险') || tagName.includes('低风险') || tagName.includes('观察')) return 'risk'
  return 'custom'
}

const TagSelector: React.FC<TagSelectorProps> = ({
  value = [],
  onChange,
  placeholder = '选择标签',
  maxTags = 5,
}) => {
  const [tags, setTags] = useState<TagItem[]>([])
  const [loading, setLoading] = useState(false)
  const [newTagVisible, setNewTagVisible] = useState(false)
  const [manageVisible, setManageVisible] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagCategory, setNewTagCategory] = useState('custom')

  useEffect(() => {
    fetchTags()
  }, [])

  const fetchTags = async () => {
    try {
      const response = await axios.get('/api/v1/tags')
      const data = response.data || []
      setTags(data)
    } catch (error) {
      console.error('Failed to fetch tags:', error)
      // 使用预设标签作为后备
      const preset = Object.entries(PRESET_TAGS).map(([name, color], id) => ({
        id: String(id),
        name,
        color,
      }))
      setTags(preset)
    }
  }

  const handleSelect = (selected: string[]) => {
    onChange?.(selected)
  }

  const handleDropdownOpenChange = (open: boolean) => {
    if (!open) {
      setNewTagVisible(false)
      setManageVisible(false)
    }
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) {
      message.warning('请输入标签名称')
      return
    }

    try {
      setLoading(true)
      const response = await axios.post('/api/v1/tags', {
        name: newTagName.trim(),
        color: PRESET_TAGS[newTagName.trim()] || TAG_CATEGORIES.find((item) => item.value === newTagCategory)?.color || '#64748b',
        category: newTagCategory,
      })

      const newTag = response.data
      setTags([...tags, newTag])

      // 自动选中新建的标签
      const newValue = [...value, newTag.name]
      onChange?.(newValue)

      setNewTagName('')
      setNewTagVisible(false)
      message.success('标签创建成功')
    } catch (error) {
      console.error('Failed to create tag:', error)
      message.error('创建标签失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteTag = async (tag: TagItem) => {
    try {
      setLoading(true)
      await axios.delete(`/api/v1/tags/${tag.id}`)
      setTags((current) => current.filter((item) => item.id !== tag.id))
      if (value.includes(tag.name)) {
        onChange?.(value.filter((item) => item !== tag.name))
      }
      message.success(`已删除标签：${tag.name}`)
    } catch (error) {
      console.error('Failed to delete tag:', error)
      message.error('删除标签失败')
    } finally {
      setLoading(false)
    }
  }

  // 获取标签颜色
  const getTagColor = (tagName: string): string => {
    const tag = tags.find(t => t.name === tagName)
    const categoryColor = TAG_CATEGORIES.find((item) => item.value === (tag?.category || inferTagCategory(tagName)))?.color
    return tag?.color || PRESET_TAGS[tagName] || categoryColor || 'primary'
  }

  const getTagLabel = (tagName: string) => {
    const tag = tags.find(t => t.name === tagName)
    const category = TAG_CATEGORIES.find((item) => item.value === (tag?.category || inferTagCategory(tagName)))
    return category ? `${category.label} | ${tagName}` : tagName
  }

  // 标签建议列表只使用后端真实标签；保留当前值中已存在但后端缺失的标签，避免编辑时丢失旧数据。
  const suggestions = [
    ...tags.map(t => t.name),
    ...value.filter((tagName) => !tags.some((tag) => tag.name === tagName)),
  ]

  return (
    <div className="flex flex-wrap gap-1">
      <Select
        mode="multiple"
        placeholder={placeholder}
        value={value}
        onChange={handleSelect}
        style={{ minWidth: 200 }}
        maxCount={maxTags}
        allowClear
        options={suggestions.map(s => ({ label: getTagLabel(s), value: s }))}
        onDropdownVisibleChange={handleDropdownOpenChange}
        tagRender={({ value: tagValue, closable, onClose }) => (
          <Tag
            color={getTagColor(String(tagValue))}
            closable={closable}
            onClose={onClose}
            style={{ marginRight: 4 }}
          >
            {tagValue}
          </Tag>
        )}
        dropdownRender={(menu) => (
          <div>
            {menu}
            <div className="p-2 border-t border-gray-700">
              <Popover
                content={
                  <div className="flex flex-col gap-2">
                    <Input
                      placeholder="新标签名称"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onPressEnter={handleCreateTag}
                      style={{ width: 180 }}
                    />
                    <Select
                      size="small"
                      value={newTagCategory}
                      onChange={setNewTagCategory}
                      options={TAG_CATEGORIES.map((item) => ({ label: item.label, value: item.value }))}
                      style={{ width: 180 }}
                    />
                    <Button
                      type="primary"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={handleCreateTag}
                      loading={loading}
                    >
                      创建
                    </Button>
                  </div>
                }
                title="创建新标签"
                trigger="click"
                open={newTagVisible}
                onOpenChange={setNewTagVisible}
              >
                <Button type="link" size="small" icon={<PlusOutlined />}>
                  新建标签
                </Button>
              </Popover>
              <Popover
                content={
                  <div className="w-72">
                    <div className="mb-2 flex items-center justify-end">
                      <Button
                        size="small"
                        type="text"
                        icon={<CloseOutlined />}
                        onClick={() => setManageVisible(false)}
                      >
                        关闭
                      </Button>
                    </div>
                    <div className="max-h-64 overflow-auto">
                      {tags.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可删除标签" />
                      ) : (
                        <div className="flex flex-col gap-1">
                          {tags.map((tag) => (
                            <div key={tag.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-white/5">
                              <Tag color={getTagColor(tag.name)} style={{ marginRight: 0 }}>
                                {getTagLabel(tag.name)}
                              </Tag>
                              <Popconfirm
                                title={`删除标签「${tag.name}」？`}
                                description="会同步从资产关联和持仓标签中移除。"
                                okText="删除"
                                cancelText="取消"
                                okButtonProps={{ danger: true }}
                                onConfirm={() => handleDeleteTag(tag)}
                              >
                                <Button type="text" danger size="small" icon={<DeleteOutlined />} loading={loading} />
                              </Popconfirm>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                }
                title="管理标签"
                trigger="click"
                open={manageVisible}
                onOpenChange={setManageVisible}
              >
                <Button type="link" size="small" icon={<SettingOutlined />}>
                  管理标签
                </Button>
              </Popover>
            </div>
          </div>
        )}
      />
    </div>
  )
}

export default TagSelector
