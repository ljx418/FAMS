# U2-LONG25 长历史重放与页面联动 R1 最终报告

**冻结合同：** `dlv3.u2-long25-replay-ui.v1` + `dlv3.u2-long25-semantic-adapter.v1`  
**不可变 attempt：** `C0 -> consolidated review -> R1`  
**实现 owner：** Codex；**只读审查：** `/root/long25_final_readonly_review`（首次终审拒绝后由 Codex 修复根因，再复核）  
**候选状态：** `U2_LONG25_REPLAY_UI_R1_CANDIDATE_AWAITING_HUMAN`

**最终只读 verdict：** `ACCEPTED`。审查过程先后拒绝了起点合同、独立语义血缘和浏览器弱验证；Codex 在不创建 R2 的前提下逐项修复，最终复核无剩余 BLOCKER、SUGGESTION 或 NIT。

## 1. R1 关闭的完整 finding 集

1. 用物理 PIT 输入重建 `2018-01..2021-09` 的 45 个真实月度目标，不再用空目标跨过该区间；2018—2021 重建得到 13,500 个身份、9,568 个信号窗口。U2 在该区间没有入选是冻结断路器的真实失败关闭结果，不是人工清空。
2. 加入 `2024-09` 已接受目标到后续目标面的桥接；完整目标面为 240 个互异月度身份，无缺口、重复或额外月份。
3. 日历只来自物理交易日；删除非交易占位行，`2010-01-01` 不再进入回放。
4. continuation 改为调用生产 `deriveAnnualCfoToNp()`；322 条完整语义行保留原始 CFO、归母净利、两侧公告日、来源文件与 SHA-256，并封存 4,479 个来源文件的 exact set。
5. 独立验证器不调用生产账本/指标聚合，独立重算 38 个多起点、113 个固定持有期起点、逐年收益、回撤恢复、滚动 252 日年化、61/122 日收益块和 58 个毛贡献项；同时按每条 `sourceIdentity` 定位唯一物理分区，从源文件读取 CFO、归母净利和两侧公告日后重算 322 个比率，不信任 artifact 内嵌 raw。
6. 页面顶部长历史起点选择现在联动第 4—11 区；短窗口备选决策矩阵仍明确标记为 2021—2024 的合同例外，不混入长样本分母。
7. 加入 8 个最终 control→mutation→recovery 负控：来源漂移、未来事实、当前成分回填、非交易日、重复目标、公司行动缺失、B1 冒充策略、伪造官方前缀。
8. 首次 R1 终审发现三项证据/合同缺口：官方起点解释、CFO/NP 独立重算、页面跨起点真实数据验证。R1 预算没有重置，也没有创建 R2；Codex 按流程直接修复。起点边界由 `101_U2_LONG25_OFFICIAL_START_BOUNDARY_ADDENDUM.md` 一次性冻结（SHA-256 `5cc21172b32c930e79973ac094866a478df088d1f6eb9473a907bded3570aa59`）。
9. 人工复核时发现运行中的旧后端尚未返回 cohort `analytics`，新版前端直接读取该字段导致整页空白。前端现对旧 API 明确降级并展示版本提示；旧响应不再导致 React 根节点崩溃。没有重启生产后端或前端进程。

## 2. 冻结输入与产物身份

| 产物 | SHA-256 / 计数 |
|---|---|
| `mid-selection-2018-2021.json` | `7e3ca2c5ed81535231f1123e3db15b88636796b36087b1cc85ed25dbc2c7200a`；45 月、13,500 身份 |
| `continuation-u2-2024-2026.json` | `75019de2f2270b33314331c6a2bbb0f88730bf4d4e2ac2ebc5dc14159783f6f4`；25 目标、322 完整语义行 |
| `u2-multistart-2006-2026.json` | `ff821d5e4bca15f2cbfc950e0263976554e8094e9e7f771c27aaae234472b3c4`；重复生成一致；前缀 `promotionEligible=false` |
| `independent-verification-2006-2026.json` | `f0cf832ba80f7781d1e7a79e51c7a1161f589c8eac59f1e970ce8e0d5d32da43`；0 finding |

回放有效范围为 `2006-11-01..2026-10-28`，含 4,857 个交易日、240 个目标月。`2006-01..2006-10` 因历史成分快照含未上市证券 `600018`，继续作为显式不可评估前缀；不得宣称 2006 全年完整。`2026-10-29..30` 仍为当时未取得的物理尾部，不伪造。

## 3. 研究结果（描述性，不构成生产晋升）

- 期初资本 30,000,000 CNY；累计收益 `40.94%`；年化 `1.80%`。
- 年化波动 `3.27%`；零无风险利率 Sharpe `0.561`；最大回撤 `-6.61%`。
- 平均权益暴露仅 `9.89%`。低回撤主要来自长期高现金，不得解释为高资本效率。
- 38 个跨时间起点年化范围 `0.51%..8.22%`，中位数 `2.86%`。
- 113 个固定持有期起点年化范围 `-3.04%..17.22%`，中位数 `0%`；不同起点样本长度与暴露不同，不等权充当晋升证据。
- 交易成本 228,958.84 CNY；现金股息 3,029,364.33 CNY；送转价值 243,914.05 CNY；价格损益 9,239,089.86 CNY；守恒残差 `1.68e-7 CNY`。

## 4. 验证结果

| 检查 | 结果 |
|---|---|
| semantic adapter unit | 8/8，0 failed/skipped |
| replay unit | 7/7，0 failed/skipped |
| continuation unit/negative | 32/32（17 controls + 15 mutations，含同时篡改 embedded raw + value） |
| final falsification | 8/8 control→mutation→recovery |
| 独立重算 | `VERIFIED`，0 finding；另逐文件复核 4,479 个 source hash、逐项重算 322 个 CFO/NP 比率和两个 exact set |
| dashboard/API contract | 71/71 |
| 浏览器真实 API | 102/102；390/768/1440；11 区；第 4—11 区实际图表数据指纹全部随起点变化；旧 cohort 响应兼容负控通过 |
| backend full typecheck | exit 0 |
| DLV3 script typecheck | exit 0 |
| frontend typecheck/build | exit 0 / exit 0 |
| 重复生成 | replay SHA-256 仍为 `ff821d…b3c4` |

## 5. 主要 changed files

### 后端生产边界

- `backend/src/research/dividend-low-vol-stock-v3/long25-replay/artifact-validator.ts`
- `backend/src/services/research/dividendLowVolV3BacktestDashboardService.ts`

### 数据构建、重放与验证

- `backend/scripts/research/dividend-low-vol-stock-v3/dlv3-data-long25-build-mid-selection.ts`
- `backend/scripts/research/dividend-low-vol-stock-v3/dlv3-data-long25-build-continuation.ts`
- `backend/scripts/research/dividend-low-vol-stock-v3/dlv3-data-long25-run.ts`
- `backend/scripts/research/dividend-low-vol-stock-v3/dlv3-data-long25-verify.ts`
- `backend/scripts/research/dividend-low-vol-stock-v3/dlv3-data-long25-continuation-unit.ts`
- `backend/scripts/research/dividend-low-vol-stock-v3/dlv3-data-long25-final-falsification.ts`
- `backend/scripts/research/dividend-low-vol-stock-v3/verify-u2-backtest-dashboard.ts`

### 前端与浏览器验收

- `frontend/src/components/backtest/DividendLowVolV3BacktestDashboard.tsx`
- `frontend/src/types/dividendLowVolV3.ts`
- `frontend/scripts/verify-dividend-low-vol-stock-v3-backtest-deep-browser.mjs`
- `frontend/scripts/verify-dividend-low-vol-stock-v3-backtest-live.mjs`

## 6. 边界与限制

- 未搜索或调整任何阈值、因子、权重、断路器或风险预算；U2 字节与经济规则保持冻结。
- 暴露过的 `2025-10-01..2026-09-30` 仅作既有诊断区间，不能恢复为 hold-out，也不能作为晋升证据。
- 本候选只关闭长历史证据与 UI 联动，不改变 Stage 16/17 的负面经济结论，也不授权生产、资金或交易。
- 截至候选封存时，未读取或写入生产数据库，也未启动或重启生产服务、scheduler、MCP、券商、订单或资金能力；其后唯一获授权的后端重启及线上只读验收单列于第 8 节，未执行迁移、修复或业务写入。
- 当前年化与 Sharpe 明显受极低权益暴露限制；结果支持“可回测、可解释”，不支持“已具备生产投资性价比”的结论。

## 7. 下一门限

人工只验收本 R1 的长历史重放正确性、跨起点交互和证据封存。通过不等于生产晋升；后续若继续，应进入冻结 U2 的无资金前向影子/运行健康观察，而不是在同一历史样本上继续发明策略。

## 8. 2026-10-31 交易机制、15 年起点与交互根因修复

补充合同：`102_U2_LONG25_MECHANISM_AND_INTERACTION_CLOSURE_ADDENDUM.md`，版本
`dlv3.u2-long25-mechanism-interaction.v1`。

### 实现与披露

- 策略运行页新增“冻结交易机制与长回测边界”，逐项标记“已进入”、“部分进入”、“未进入”或“研究简化”。
- 已进入 LONG25：PIT 选股/排名、股息与现金流断路器、单股 3%/行业 15%/权益 60% 限制、60 日波动降仓、现金分红/送转与 5bps 聚合成本。
- 未进入 LONG25：70/30 核心—卫星、Bollinger 低买高卖、40/70/100 分批建仓、连续两月基本面退出、raw-open 逐单成交与完整税费。页面不再将“系统已有模块”误报为“已进入当前绩效”。
- 长历史 API 已证明第一个 2010 年起投日为 `2010-01-04`，至 `2026-10-28`
  共 4,083 个交易日；页面默认定位到该日，但保留 `2006-11-01`
  开始的已验证可选历史。
- 吸顶根因是 `Content overflow-x-hidden` 建立了一个不实际滚动的 overflow
  ancestor；改为 `overflow-x-clip`，控制台在 56px 顶栏下方 `top=64px`
  可见吸顶。
- 累计收益和资金/仓位曲线现在共用真实数据点解析器；单击和双击均可打开当日仓位、现金、中文名称/行业和单标的价格曲线。

### 新验收结果

| 检查 | 结果 |
|---|---|
| dashboard/API 独立验证 | 75/75；2010 起投 4,083 交易日；0 skipped |
| 隔离真实 API 浏览器 | 113/113；390/768/1440；真实吸顶、曲线单/双击、机制披露、旧 API 兼容全通过 |
| frontend production build | exit 0 |
| 线上旧 API 兼容 | 64/64；390/768/1440；页面不空白 |
| 线上新前端资产 | `index-CeIgXbWf.js`；机制披露可见；吸顶 `y=64` |
| 线上曲线交互 | 旧 API 726 日路径上，曲线数据点单击/双击均真实打开仓位弹窗 |

### 当前部署门限

用户于 2026-10-31 精确授权仅通过现有 FAMS 控制器重启后端。控制器 PID
`9891` 执行 `target=backend/action=restart`，commandId
`9a529f1a-1c72-49bf-b30b-bf1b0cd0d3f9`，状态 `succeeded`；后端 PID
`3101970 -> 2360450`，前端 PID 保持 `9910`。

重启后的真实线上 API/页面验收为 76/76：390/768/1440 三视口全部通过；可选历史
`2006-11-01..2026-10-28`；首个 2010 年起投日 `2010-01-04`，至尾日
4,083 个交易日；控制台真实吸顶 `top=64px`；资金/仓位曲线单击与双击均打开
时点仓位弹窗；策略运行页机制披露可见。后端健康为 `ok`、运行/排队任务为 0，
DLV3 shadow scheduler 保持 `enabled=false/running=false`，MCP 未启动。未执行迁移、
修复、主动数据库写入、券商或订单动作。终态为
`LIVE_SELF_CHECK_ACCEPTED_AWAITING_HUMAN`。
