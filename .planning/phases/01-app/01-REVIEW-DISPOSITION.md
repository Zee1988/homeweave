---
phase: 01-app
review: 01-REVIEW.md
reviewed: 2026-10-27T14:28:04Z
disposition_at: 2026-10-27
findings_total: 13
by_severity:
  critical: 0
  high: 3
  medium: 5
  low: 5
by_status:
  open: 13
  fixed: 0
  deferred: 0
  wontfix: 0
---

# Phase 01 代码评审处置表

处置表默认每一条为 `open`：评审提出的问题在被明确处置前保持可见，
以免被后续会话误当作「已审过、没问题」。

| ID | 严重度 | 标题 | 状态 | 处置 |
|----|--------|------|------|------|
| HI-01 | high | 无「生成物 vs 源 JSON」一致性守卫，幂等性零回归测试 | open | 待处置：测试目录需实际 spawn 生成器并断言产物与提交物一致 |
| HI-02 | high | 校验器「出现才检查」，必需字段整段缺失时静默通过 | open | 待处置：`image`/`ingress_port` 等必需键须无条件断言存在 |
| HI-03 | high | 生成器对源 JSON 的输入校验 fail-open | open | 待处置：未知/改名键须 `fail()`，不得静默忽略 |
| MD-01 | medium | 写入顺序使「崩溃 = 两文件不一致」成为可能 | open | 待处置 |
| MD-02 | medium | `name`/`slug`/`description`/`url`/`homeassistant` 无类型与格式校验 | open | 待处置 |
| MD-03 | medium | 只有形状断言，没有契约字面值断言 | open | 待处置 |
| MD-04 | medium | `scalar()` 用 denylist 判断引号 | open | 待处置 |
| MD-05 | medium | `engines: >=20` 与 `node --test` glob 冲突 | open | 待处置 |
| LO-01 | low | 「`ports` 只以注释存在」只覆盖一半 | open | 待处置 |
| LO-02 | low | `describe()` 让失败消息自相矛盾 | open | 待处置 |
| LO-03 | low | 负向测试只覆盖 15 个 code 里的 7 个 | open | 待处置 |
| LO-04 | low | `fixtures.mjs` 关于测试发现的注释不准确 | open | 待处置 |
| LO-05 | low | V15 的 `MAX_DEPTH = 12` 静默截断 | open | 待处置 |

## 备注

- 评审为 advisory，不阻断阶段推进；本表不改变任何 findings 的严重度。
- HI-01/HI-02/HI-03 均落在本阶段 `<must_haves>` 自己声明的失效模式上，建议在进入
  Phase 2 之前以 gap-closure 计划关闭，而不是留到后续阶段。
