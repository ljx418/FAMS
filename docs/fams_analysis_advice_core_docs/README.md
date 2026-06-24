# FAMS 分析建议核心功能文档包

版本：v0.2  
日期：2026-06-01

本文件包包含 FAMS “分析建议”核心功能的产品、模型、开发与验收材料。自 v0.2 起，P4 策略竞标赛不再作为独立外部产品入口，而是内化为 FIVD-R 的内部验证锦标赛 Agent；对外只保留 FIVD-R 一套入口。

## 文件清单

1. `01_PRD_FAMS_Analysis_Advice_Core.md`  
   产品需求文档，定义分析建议板块的目标、范围、用户场景、功能需求、非功能需求、交互信息架构和上线标准。

2. `02_Model_Architecture_FIVD_R.md`  
   FIVD-R 模型架构设计文档，覆盖投资标的价值评估、预计盈亏分布、交易纪律、仓位建议联动、验证回放、人工干预和模型调优。

3. `03_Development_Acceptance_Plan.md`  
   可执行开发计划与验收计划，按 Phase 0 到 Phase 4 拆分统一入口、内部编排、前端面板和交易动作 readiness。

4. `04_Codex_Terminal_Prompt.txt`  
   可直接复制到 Codex CLI / 终端 Agent 的执行提示词，用于引导它扫描代码库、分阶段实现并遵守安全边界。

5. `05_Data_API_Schema_Reference.md`  
   数据库表、核心 TypeScript 类型、API、Operation、Artifacts 的参考设计。

6. `06_Testing_Validation_Checklist.md`  
   测试、回放验证、概率校准、模型调优、人工干预与上线前检查清单。

7. `07_FIVD_R_Stage_Governance.md`  
   FIVD-R 后续阶段的开发计划、验收计划、PRD 检视和审计门禁规则。

8. `08_FIVD_R_Phase3_Development_Acceptance_Audit.md`  
   Phase 3 统一前端面板的开发计划、验收标准、审计意见和真实数据端到端验收结果。

9. `09_FIVD_R_Remaining_Roadmap.md`  
   FIVD-R 剩余开发总计划，覆盖 Phase 3.5 到 Phase 10 的开发、验收、PRD 检视、审计门禁和打回规则。

10. `10_FIVD_R_Phase3_5_Development_Acceptance_Audit.md`  
    Phase 3.5 单持仓 FIVD-R 面板与性能审计的开发前计划、验收标准、PRD 规格检视和审计意见。

11. `11_FIVD_R_Phase4_Expected_Return_Development_Acceptance_Audit.md`  
    Phase 4 Expected Return Distribution 的开发前计划、验收标准、PRD 规格检视和审计意见。

12. `12_FIVD_R_Phase5_Trading_Discipline_Development_Acceptance_Audit.md`  
    Phase 5 Trading Discipline Engine 完整化的开发前计划、验收标准、PRD 规格检视和审计意见。

13. `13_FIVD_R_Phase6_PositionAdvice_Adapter_Development_Acceptance_Audit.md`  
    Phase 6 PositionAdvice Adapter 深度接入的开发前计划、验收标准、PRD 规格检视和审计意见。

14. `14_FIVD_R_Phase7_Advice_Replay_Validation_Development_Acceptance_Audit.md`  
    Phase 7 Advice Replay & Validation 的开发前计划、验收标准、PRD 规格检视和审计意见。

15. `15_FIVD_R_Phase8_Intervention_Review_Development_Acceptance_Audit.md`  
    Phase 8 人工复核与干预记录的开发计划、验收标准、PRD 规格检视和审计意见。

16. `16_FIVD_R_Phase9_Calibration_Model_Tuning_Development_Acceptance_Audit.md`  
    Phase 9 Calibration 与 Model Tuning 的开发计划、验收标准、PRD 规格检视和审计意见。

17. `17_FIVD_R_Phase10_Readiness_Closure_Development_Acceptance_Audit.md`  
    Phase 10 交易动作 Readiness 收口的开发计划、验收标准、PRD 规格检视和审计意见。

## 核心边界

- LLM 不直接决定买入、卖出、加仓、减仓。
- 没有 evidenceRefs 的输出不能作为交易建议。
- 数据不足、provider 冲突、回测验证不足时，只能输出观察、风险提示或研究结论。
- Validation Evidence 未通过时，不允许 formal ADD / REDUCE。
- 所有模型输出、回放结果和调参结果都必须可追溯、可复现、可比较。
