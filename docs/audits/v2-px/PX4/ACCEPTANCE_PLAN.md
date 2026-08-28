# V2-PX PX4-A Side Panel 验收计划

日期：2026-08-29

## 自动验收场景

| ID | 前置 | 操作 | 硬门槛 | 证据 |
| --- | --- | --- | --- | --- |
| SP-01 真实摘要 | 4000、真实 SQLite、已授权验收副本 | 打开 Side Panel，建立 source_library route 并 refresh | 当前标题、摘要、数据时间、研究模式、最近任务 1～5 条；mock 字样=0 | DB/API/DOM 对照、360/420 截图 |
| SP-02 Quick Ask | 已连接且有真实来源 | 输入问题并点击一次发送 | ack <=1s；final <=35s 或明确 failed/blocked/unknown_result；POST=1；摘要/时间/可信度/下一步可见 | network、DOM 时间戳、trace |
| SP-03 信息分层 | 有当前来源/Ask 结果 | 查看依据，再打开完整工作台 | Side Panel 不出现 DAG/大表/常驻原始 refs；Workspace tab 打开或聚焦；主动作 >=44px | DOM/layout、tab trace |
| SP-04 两视口 | Side Panel 有最终回答 | 360、420 各运行一次 | `scrollWidth<=clientWidth`；关键动作可见；正文>=14px；console error=0 | 两张原始截图与像素/hash |
| SP-05 状态诚实 | 无权限、加载、空、失败、阻断输入 | 逐一渲染/触发 | 每种状态有事实、原因和下一步；shell/ack 不算 final；原始 stack=0 | unit DOM + 真实失败 trace |
| SP-06 隐私交易 | 完整真实路径 | 扫描 network/storage/DOM | question/answer/secret storage=0；broker/order=0；Transaction 变更=0；四锁=false | storage/network/DB report |

## 必跑命令

```text
npm --prefix packages/fams-v2-px-extension run typecheck
npm --prefix packages/fams-v2-px-extension run test:sidepanel
npm --prefix packages/fams-v2-px-extension test -- --run
npm --prefix packages/fams-v2-px-extension run build
npm --prefix packages/fams-v2-px-extension run verify:sidepanel-chrome
```

## PRD 复检

实施后必须单独形成 `PRD_SPEC_REVIEW.md`，逐项核对 PX-REQ-004/009/011/013/015/016/017/018，并明确哪些只是 Side Panel 子集、哪些留给 Host Bridge/PX5/PX6。fatal/major 或虚假验收风险非 0 时不得进入 PX4-B。
