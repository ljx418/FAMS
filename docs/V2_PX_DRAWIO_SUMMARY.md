# V2-PX 目标架构 gap 图说明与防退化检查

更新时间：2026-08-27

## 1. 文档定位

`docs/v2-px-target-architecture-gap.drawio` 是 V2-PX 专项架构与开发验收总图，共 8 页。它不覆盖 `docs/target-architecture-gap.drawio`；后者继续作为 FTR 主线权威图，因此本轮不会使既有正式发布架构信息退化。

```text
drawioFile=docs/v2-px-target-architecture-gap.drawio
pageCount=8
language=zh-CN
implementationStatus=DOCUMENTATION_ONLY
```

## 2. 页级职责

| 页 | 唯一职责 | 人类应能回答的问题 |
| --- | --- | --- |
| 1 目标体验与阶段边界 | 解释为什么开发、完成后是什么体验、当前不能做什么 | Side Panel、Workspace 和 Host App 分别解决什么问题？ |
| 2 当前与目标差异 | 按 Web、API、PX 合同、Extension 四层列真实实体和缺口 | 哪些已存在、哪些需修改、哪些尚未开发？ |
| 3 目标分层和交互 | 展示容器、Background、Adapter、FAMS、数据与证据调用关系 | 一个命令如何经过具体实体得到结果？ |
| 4 三入口五 intent 与原型 | 展示入口动作、五视图和两个容器线框 | 用户实际看到什么、五 intent 落到什么数据？ |
| 5 权限状态数据恢复 | 展示最小权限、状态所有权、存储边界和恢复状态机 | 什么数据存在哪里，断连时如何处理？ |
| 6 开发及验收计划 | 展示 D0、PX-1～PX-6 的顺序、结果和停止规则 | 每阶段开发什么、验收什么、失败打回哪里？ |
| 7 里程碑风险与回退 | 展示 M0～M6、关键风险和替代路线 | 架构风险何时验证，失败后是否可逆？ |
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
9. `implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL` 与交易四锁必须可见。
10. 现有 FTR draw.io 的 8 页内容和文件保持不变。

## 6. 当前允许声明

当 XML、追踪和状态审计全部通过后，只允许声明：

```text
v2PxDrawioDocumentationReady=true
documentationReadyForImplementationReview=true
implementationApprovalStatus=PENDING_EXPLICIT_USER_APPROVAL
px1FeasibilitySpikeAllowed=false
```

该图不是交互式原型、真实 Chrome evidence 或生产实现证明。
