# FAMS Benchmark 枚举合同

更新时间：2026-07-16

## 1. 目的

统一组合回测、红利低波、正式交易前置评审和 release gate 中的 benchmark 状态，避免 `proxy`、`research_proxy`、`formal_total_return` 等口径漂移。

## 2. 规范枚举

```text
official_total_return
trusted_total_return
free_source_total_return
price_index
research_proxy
unavailable
```

## 3. 语义

| 枚举 | 含义 | 可用于 formal validation passed | 可用于 formal trading unlock |
| --- | --- | --- | --- |
| `official_total_return` | 官方或授权 total-return benchmark | 可以，仍需其他 gate | 可以，仍需人工 release approval |
| `trusted_total_return` | 非官方但经过授权/复核的可信 total-return benchmark | 可以，仍需审计说明 | 可以，仍需人工 release approval |
| `free_source_total_return` | 免费源 total-return，可进入 formal-review-ready | 不可自动升级，需人工确认是否等价 trusted | 不可直接解锁 |
| `price_index` | 价格指数，不含完整分红总回报 | 不可作为 total-return formal validation | 不可解锁 |
| `research_proxy` | 研究代理 benchmark | 不可 | 不可 |
| `unavailable` | benchmark 缺失 | 不可 | 不可 |

## 4. Deprecated alias

```text
formal_total_return -> deprecated alias of official_total_return or trusted_total_return; must be resolved before persistence.
proxy -> deprecated alias of research_proxy.
```

## 5. 自动化要求

API DTO、审计 JSON、数据库持久化和前端展示必须使用规范枚举。Deprecated alias 只能出现在迁移、兼容或文档说明中，不得作为新产物输出。

