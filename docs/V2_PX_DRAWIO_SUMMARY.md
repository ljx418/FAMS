# V2-PX 目标架构 gap 图说明与防退化检查

更新时间：2026-08-29

## 1. 文档定位

`docs/v2-px-target-architecture-gap.drawio` 是 V2-PX 专项架构与开发验收总图，共 8 页。它不覆盖 `docs/target-architecture-gap.drawio`；后者继续作为 FTR 主线权威图，因此本轮不会使既有正式发布架构信息退化。

```text
drawioFile=docs/v2-px-target-architecture-gap.drawio
pageCount=8
language=zh-CN
implementationStatus=PX1_THROUGH_PRODUCT_PX4_ROUTER_IDEMPOTENCY_AUTOMATED_ACCEPTED
externalIndependentAuditStatus=CONDITIONAL_PASS
externalAuditRemediationStatus=APPLIED_INTERNAL_REAUDIT_PASSED
```

## 2. 页级职责

| 页 | 唯一职责 | 人类应能回答的问题 |
| --- | --- | --- |
| 1 目标体验与阶段边界 | 解释为什么开发、完成后是什么体验、当前不能做什么 | Side Panel、Workspace 和 Host App 分别解决什么问题？ |
| 2 当前与目标差异 | 按 Web、API、PX 合同、Extension 四层列真实实体和缺口 | 哪些已存在、哪些需修改、哪些尚未开发？ |
| 3 目标分层和交互 | 展示容器、Background、target v3/v2 合同、Read/Ask Adapter、FAMS、数据与证据；合同原子迁移/负例失败以红边返回 ADR | 导航和提交问题如何得到结果，合同迁移失败为何不能进入 PX-2？ |
| 4 三入口五 intent 与原型 | 展示入口动作、五视图和两个容器线框 | 用户实际看到什么、五 intent 落到什么数据？ |
| 5 权限状态数据恢复 | 展示 4000 optional host/3000 external connect、状态所有权、TTL/ledger、cleanup→写入→回读顺序和恢复 | 什么数据存在哪里，写入冲突、断连和结果后存储失败如何诚实处理？ |
| 6 开发及验收计划 | 展示 D0、PX-1 合同迁移、PX-2 API+Workspace、PX-3～PX-6 | 每阶段开发什么、验收什么、失败打回哪里？ |
| 7 里程碑风险与回退 | 展示 M0～M6、关键风险和替代路线；R3 先修 facade、仍失败则返回 API 合同/ADR | 架构风险何时验证，失败后是否有明确可逆路径？ |
| 8 验收门槛与出门 | 展示十个场景的步骤、阈值、证据和两类出门声明 | 如何操作验收，什么条件才算通过？ |

## 3. 状态色

- 绿色：代码已开发并可直接复用。
- 黄色：现有代码实体需要受控修改。
- 橙色：目标代码实体待新增，当前不存在。
- 蓝色：文档合同、测试或证据。
- 红色：阶段、权限、隐私和交易硬边界。
- 灰色：现有基础、缺失事实或本阶段非目标。

所有页面使用同一状态色；同一实体不得在不同页面出现相反状态。

## 4. 与 PRD 的对应关系

| 图页 | PRD requirement |
| --- | --- |
| 1 | PX-REQ-004、005、016、018 |
| 2 | PX-REQ-013、020 |
| 3 | PX-REQ-001、002、003、013、014 |
| 4 | PX-REQ-001～005、011、016、017 |
| 5 | PX-REQ-007～009、012、014、015、018 |
| 6 | PX-REQ-001～020 的阶段计划 |
| 7 | PX-REQ-006～010、013～015、020 的风险与依赖 |
| 8 | PX-REQ-001～020 的用户验收和出门门槛 |

## 5. 防退化验收

图必须同时满足：

1. 页数不超过 8；本图固定 8 页。
2. 页面标题和说明使用中文；代码路径保留真实英文名称。
3. 第 2、3 页必须出现当前和目标的具体代码实体，不能只写抽象层。
4. 第 3 页必须有从三个入口到 Background、Adapter、FAMS service、Prisma/证据的有向交互。
5. 第 4 页必须能看懂 Side Panel 与 Workspace 的信息层级差异。
6. 第 6、7 页必须给出阶段效果、依赖、风险、停止和回退条件。
7. 第 8 页必须给出用户场景、前置条件、操作、量化阈值、证据和失败归属。
8. 图中所有“待新增”实体不得被文字写成已实现。
9. `implementationApprovalStatus=APPROVED_FOR_PX1_THROUGH_PX6_SEQUENTIAL_AUTOMATION`、PX6 最终人工确认与交易四锁必须可见。
10. 现有 FTR draw.io 的 8 页内容和文件保持不变。
11. 图中必须明确 current schema v2/v1 与 target v3/v2 的迁移关系，禁止把计划版本写成已实现。
12. 3000 不得出现在 optionalHostPermissions；Ask 不得被描述为纯只读或自动确认。
13. 第 3 页必须有 `p3-contract -> p3-contract-stop` 红边，明确 target schema/validator/fixture/types 原子迁移失败返回 ADR。
14. 第 5 页必须显示 expiresAt 清理、LRU、ledger 回读、网络单次调用、recoveryIndex/session 后写，以及结果后写失败转 unknown_result 的顺序。
15. 第 7 页必须有 `p7-risk3 -> p7-r3-return` 红边，明确 facade mapping 失败后返回运行时 API 合同/ADR，禁止改 intent 或 mock。
16. XML 解析统计应为 8 页、102 个有文字节点、64 条边；统计变化必须解释，不能静默删页或删边。

## 6. 当前允许声明

当 XML、追踪和状态审计全部通过后，只允许声明：

```text
v2PxDrawioDocumentationReady=true
documentationReadyForImplementationReview=true
externalIndependentAuditStatus=CONDITIONAL_PASS
externalAuditRemediationStatus=APPLIED_INTERNAL_REAUDIT_PASSED
implementationApprovalStatus=APPROVED_FOR_PX1_THROUGH_PX6_SEQUENTIAL_AUTOMATION_2026_08_28
px1FeasibilitySpikeAllowed=true
```

该图不是交互式原型、真实 Chrome evidence 或生产实现证明。
