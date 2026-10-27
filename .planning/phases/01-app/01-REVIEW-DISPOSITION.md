---
phase: 01-app
review: 01-REVIEW.md
disposition_at: 2026-10-27
note: 覆盖两轮评审 —— 第一轮（缺口收口前，13 条）与第二轮（缺口收口后，9 条）
rounds:
  - round: 1
    reviewed: 2026-10-27T14:28:04Z
    findings_total: 13
    by_severity: { critical: 0, high: 3, medium: 5, low: 5 }
    closed_by: 01-04, 01-05
  - round: 2
    reviewed: 2026-10-27T07:33:57Z
    findings_total: 9
    by_severity: { critical: 0, high: 1, medium: 3, low: 5 }
by_status_round2: { open: 9, fixed: 0, deferred: 0, wontfix: 0 }
---

# Phase 01 代码评审处置表

## 第一轮（缺口收口前 13 条）— 收口结果

| ID | 严重度 | 摘要 | 状态 | 处置 |
|---|---|---|---|---|
| HI-01 | high | 生成物与单一源无漂移守卫 | **fixed** | `01-05` 增加 `--check` 模式并挂入 `test:app`；三向漂移探针实测均 exit 1 |
| HI-02 | high | 缺失必需键不失败（检查被 `if (has())` 包裹） | **fixed** | `01-04` 改为逐键无条件 V2；验证器 58 → 81 checks |
| HI-03 | high | 生成器对未知/改名键静默忽略，且可抛未捕获 TypeError | **partial** | 顶层未知键已 fail-closed 且写盘前中止；残余两处另立 MD-06 / MD-07 |
| MD-02 | medium | 类型/格式未校验 | **fixed** | `01-04` 新增 V16 |
| MD-03 | medium | 契约字面值未钉死 | **fixed** | `01-04` 新增 V17（`image`/`version`/`homeassistant`） |
| MD-04 | medium | `scalar()` denylist 导致 `&anchor` 前缀被吃 | **fixed** | `01-05` 反转正白名单并保留 `trim()` 守卫；残余另立 MD-08 |
| MD-05 | medium | `engines: >=20` 与 glob 形态不符 | **fixed** | `01-05` 改为 `>=22` |
| MD-01 | medium | 多文件写盘非原子 | open | 超出本轮 gap 范围，计划内已注明延后 |
| LO-01 | low | 「`ports` 仅以注释存在」可被静默删掉 | **fixed** | `01-04` 新增 V18（逐行比对注释尾块） |
| LO-02 | low | `describe()` 让失败消息自相矛盾 | open | 未触及 |
| LO-03 | low | 负向测试只覆盖 15 个 code 里的 7 个 | open | 覆盖提升到 53 例，但未逐一配对 |
| LO-04 | low | `fixtures.mjs` 注释关于测试发现不准确 | open | 未触及 |
| LO-05 | low | V15 的 `MAX_DEPTH = 12` 静默截断 | open | 未触及 |

## 第二轮（缺口收口后 9 条）— 待处理

| ID | 严重度 | 摘要 | 状态 | 处置 |
|---|---|---|---|---|
| HI-04 | high | `repository.yaml` 无逐键必需/类型守卫（`maintainer: 42` 三道门全绿） | open | 待裁定：与 HI-02 同类，建议下轮以 gap 计划收口 |
| MD-06 | medium | `assertConsumedKeys()` 抛出落在 `Failed:` 格式化器之外，三种输入退回原始堆栈 | open | 待处理 |
| MD-07 | medium | `app.optionDefs` 内部字段从不被消费且嵌套未知键静默 | open | 待处理 |
| MD-08 | medium | 正白名单仍会静默改值（`null`/`true`/`yes`/`on` 等 YAML 1.1 标量） | open | 待处理 |
| LO-06 | low | 注释行是不转义的原始插值，源里一个 `\n` 即可造出活键 | open | 待处理 |
| LO-07 | low | 同一缺陷被报三次，与「一缺陷一失败」纪律冲突 | open | 待处理 |
| LO-08 | low | 生成器测试有一处永不可能失败的断言 | open | 待处理 |
| LO-09 | low | `missingImage` 变量名与条件相反 | open | 待处理 |
| LO-10 | low | `withPortsComment` 被导出但无 import | open | 待处理 |

## 备注

- 评审为 advisory，不阻断阶段推进；本表不改变任何 finding 的严重度。
- 第一轮 13 条中 8 条已由 `01-04` / `01-05` 关闭，HI-03 部分关闭，其余 5 条（MD-01、LO-02…LO-05）保持 open。
- HI-04 与已关闭的 HI-02 属同一失效类别（静态守卫对被删/被改的键不响），是否构成新的阶段缺口由 verifier 裁定。
