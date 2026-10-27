---
phase: 01-app
plan: 06
subsystem: infra
tags: [home-assistant, app-metadata, repository-yaml, validator, generator, node-test, gap-closure]

requires:
  - phase: 01-app
    provides: 01-04 的 config 侧逐键 V2/V16 与 V18 ports 注释存活守卫；01-05 的生成物漂移守卫与 --check 模式
provides:
  - repository.yaml 三个必需键（name / url / maintainer）的无条件存在性守卫（V19）
  - repository.yaml 三键的值类型守卫（V19 独立循环，不再受 if (has(...)) 短路影响）
  - 生成器源侧 assertNonEmptyString() 值断言，null/数字/布尔在写盘前即被拒绝
  - 基线由 81 checks / 53 例抬升至 87 checks / 66 例
affects: [01-app 验证收口, Phase 7 HAOS 实机验收, 后续任何改动 app-metadata.json 的计划]

actuals:
  tokens: 5200
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - 校验器对「整仓清单」类产物采用与 config 侧完全同构的两段式守卫：无条件存在性 + 独立循环类型检查
    - 源侧值断言前置于任何 scalar() 强制转换，避免 null 被字符串化成看似合法的值

key-files:
  created: []
  modified:
    - scripts/validate-app-metadata.mjs
    - scripts/generate-app-metadata.mjs
    - scripts/__tests__/validate-app-metadata.test.mjs
    - scripts/__tests__/generate-app-metadata.test.mjs

key-decisions:
  - "V19 结构上与 V2/V16 同构，存在性断言无条件执行，类型检查放在独立循环里——HI-04 的成因正是 if (has(...)) 在键缺失时静默短路"
  - "REPOSITORY_REQUIRED_KEYS 由 REPOSITORY_ALLOWED_KEYS 派生，与 CONFIG_REQUIRED_KEYS 的派生方式一致，避免两份清单漂移"
  - "name 缺失或类型错误会同时触发 V3 与 V19（双报）。接受双报，而不是给 V19 加 key !== 'name' 例外：删 V3 会减少检查数，加例外会破坏与 config 侧的同构性"
  - "源侧 delete repository.url 会先被 assertConsumedKeys 拦下（消息 `repository.url is missing (the generator reads it)`），到不了 assertNonEmptyString，因此两条负例断言的正则不同——这是设计使然而非遗漏"

patterns-established:
  - "整仓清单守卫模式：一份 ALLOWED 键表派生 REQUIRED 键表，校验器无条件断言存在性 + 独立循环断言类型"
  - "源侧与产物侧双点防线：生成器在写盘前用 assertNonEmptyString 拒绝空值，校验器在产物上再拒绝一次，任一侧失效另一侧仍能兜住"

requirements-completed: [APP-03]

coverage:
  - id: D1
    description: "repository.yaml 缺少 url 或 maintainer 时校验器拒绝并点名缺失键"
    requirement: "APP-03"
    verification:
      - kind: unit
        ref: "scripts/__tests__/validate-app-metadata.test.mjs#each required repository key is reported when absent"
        status: pass
      - kind: manual_procedural
        ref: "删除 repository.yaml 的 url / maintainer 行后 corepack pnpm validate:app 退出码 1 且报 ✗ V19 missing required key"
        status: pass
    human_judgment: false
  - id: D2
    description: "repository.yaml 三键取值类型错误（number / null / boolean / 空串）时校验器拒绝"
    requirement: "APP-03"
    verification:
      - kind: unit
        ref: "scripts/__tests__/validate-app-metadata.test.mjs#a ${label} repository value fails V19 type checking"
        status: pass
      - kind: manual_procedural
        ref: "maintainer: 42 / maintainer: null / url: true 三种篡改后 validate:app 退出码 1，报文含 got number / got null / got boolean"
        status: pass
    human_judgment: false
  - id: D3
    description: "源 homeweave_app/app-metadata.json 的空值在生成阶段即被 assertNonEmptyString 拒绝，不写入任何产物"
    requirement: "APP-03"
    verification:
      - kind: unit
        ref: "scripts/__tests__/generate-app-metadata.test.mjs#a ${label} repository value is rejected before anything is written"
        status: pass
    human_judgment: false
  - id: D4
    description: "Home Assistant OS 实机上 Supervisor 接受本仓库、商店渲染出 app 卡片、镜像可拉取与升级、ingress 可访问"
    verification: []
    human_judgment: true
    rationale: "需要真实 HAOS + Supervisor 环境；本仓库当前只有静态校验与 node:test，无法在 CI 或本机模拟 Supervisord 的仓库加载行为。归 Phase 7 实机验收，状态保持「未验证」。"

duration: 12min
completed: 2026-10-27
status: complete
---

# Phase 01: App 元数据与仓库可识别性 Summary（Plan 06）

**为 repository.yaml 补上与 config.yaml 同构的逐键守卫：V19 无条件断言 name/url/maintainer 存在且类型正确，生成器侧前置 assertNonEmptyString，基线抬到 87 checks / 66 例**

## Performance

- **Duration:** 约 12 min（15:55 → 16:06 +08:00）
- **Started:** 2026-10-27T15:55:43+08:00
- **Completed:** 2026-10-27T16:06:00+08:00
- **Tasks:** 2
- **Files modified:** 4（+306 / −2）

## Accomplishments

- HI-04 闭合：`repository.yaml` 从「只有 `name` 被 V3 抓到」变成三键逐键守卫。删除 `url`、删除 `maintainer`、`maintainer: 42`、`maintainer: null`、`url: true` 五种篡改全部退出码 1 并被 V19 点名，与 verifier 报告中「四种篡改 exit 0」的证词逐条对应反转。
- 守卫结构上与 config 侧 `V2`/`V16` 完全同构：存在性断言无条件执行，类型检查在独立循环中。这正面消除 HI-04 的根因 —— `if (has(...))` 在键缺失时静默短路。
- 源侧新增 `assertNonEmptyString()`，且先于任何 `scalar()` 强制转换调用，`null` 与数字不再有机会被字符串化成看似合法的值再写盘。
- 基线净增无弱化：`validate:app` 81 → 87 checks，`test:app` 53 → 66 例（`# pass 66` / `# fail 0` / `# skipped 0` / `# todo 0`），`check:app` 零漂移。计划门槛「不小于 64」在追加评审修复后仍成立。

## Task Commits

Each task was committed atomically:

1. **Task 1: 双侧值守卫（校验器 V19 + 生成器 assertNonEmptyString）** - `66ec59b` (feat)
2. **Task 2: V19 负例矩阵与源侧负例补齐** - `1b0746c` (test)
3. **Task 2 后续修复：CRLF 用例与检出状态解耦** - `b71f7f7` (test)
4. **第三轮代码评审 R3-01/R3-02：name/url 断言钉死 + V19 注释订正** - `f5333bb` (test)

**Plan metadata:** 本 SUMMARY 单独提交（docs）

## Files Created/Modified

- `scripts/validate-app-metadata.mjs`（+55）- 新增 V19 段：`REPOSITORY_REQUIRED_KEYS` 由 `REPOSITORY_ALLOWED_KEYS` 派生；三键无条件存在性断言；独立的类型/非空循环
- `scripts/generate-app-metadata.mjs`（+27）- 新增 `assertNonEmptyString()`；在 `buildRepositoryYaml()` 中对 `name`/`url`/`maintainer` 逐键调用，位置在任何 `scalar()` 之前
- `scripts/__tests__/validate-app-metadata.test.mjs`（+137）- V19 的负例矩阵（缺失两键 + 三种类型 + 空串），以及 repository 侧 V8 未知键分支
- `scripts/__tests__/generate-app-metadata.test.mjs`（+89 / −2）- 源侧两例空值/缺失负例（表驱动、每表项独立注册 `test()`）；两例 CRLF 容差用例改为先归一到 LF 再转 CRLF

## Decisions Made

- 接受 `name` 缺失时 `V3` 与 `V19` 双报。代价是多一条报文，收益是保住与 config 侧的同构性，且不减少既有检查数。
- `✓ 87 checks passed` 作为等值硬断言、`# tests` 作为「不小于 64」的下界写进计划 gate：前者任何顺手加严都会立刻变红，后者允许评审修复追加用例而不需要回改计划。
- 源侧 `delete repository.url` 与产物侧同名负例的消息正则不同，因为前者先被 `assertConsumedKeys` 拦截。这不是覆盖漏洞，两条路径各自都有断言。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CRLF 容差用例依赖检出状态，在 CRLF 工作树上必然失败**
- **Found during:** 编排者对账阶段（执行器因上下文上限中止后）
- **Issue:** 两例 CRLF 用例以真实产物为种子，再做 `\n → \r\n`。当种子文件本身已是 CRLF（`core.autocrlf=true` 下 `git checkout` 的产物）时得到 `\r\r\n`，生成器的 `\r\n → \n` 归一化只吃掉一半，于是把「损坏文件」当成「Windows 检出」并报漂移，用例红。这正是 `--check tolerates CRLF` 这条断言想守的场景，却在真实检出的仓库上自相矛盾。
- **Fix:** 两例都在转换前先 `.replace(/\r\n/g, '\n')`，使种子与检出状态无关；断言强度未降低（第二例仍强制校验 `# ports:` 行的删除确实生效，未命中即断言失败）。
- **Files modified:** `scripts/__tests__/generate-app-metadata.test.mjs`
- **Verification:** 在 CRLF 工作树上 `corepack pnpm test:app` → `# tests 64 / # pass 64 / # fail 0`
- **Committed in:** `b71f7f7`

---

**Total deviations:** 3 auto-fixed (1 bug, 1 test-coverage gap, 1 doc inaccuracy)

**2. [Rule 1 - Bug] 生成器侧 name/url 断言零行为覆盖（代码评审 R3-01，MEDIUM）**
- **Found during:** 第三轮代码评审（post-execution hook）
- **Issue:** `assertNonEmptyString('repository.name', …)` / `('repository.url', …)` 两行若被整行删除，`test:app` 仍 66/66 全绿——只有 `maintainer` 那行有对应用例。这与测试文件自己立的标准（`generate-app-metadata.test.mjs:283-287` 注释）直接冲突：守卫可被删除而表仍绿。
- **Fix:** 在 `REPOSITORY_SOURCE_FAILURES` 表追加 `empty name` / `empty url` 两条，断言的是值级消息 `must be a non-empty string`，而非存在级消息 `is missing`。
- **Verification:** 变异验证——注释掉 `assertNonEmptyString('repository.name', …)` 后 `# tests 66 / # pass 65 / # fail 1`，且失败点名 `a empty name repository value fails the generator…`；还原后 66/66/0。
- **Committed in:** `f5333bb`

**3. [Rule 1 - Bug] V19 注释两处表述可证伪（代码评审 R3-02，LOW）**
- **Found during:** 第三轮代码评审
- **Issue:** 注释称「check 总数与缺失哪个键无关」，实际 87 / 85 / 83 随缺失键数变化；又称「V3 在本块下方」，实际 V3 在 178-187，位于上方。
- **Fix:** 改为「三个键都在时 87，缺一个 85，缺两个 83，只有全在的数值被断言」，并把 `below` 改成 `above`。
- **Files modified:** `scripts/validate-app-metadata.mjs`
- **Committed in:** `f5333bb`

**Impact on plan:** 三项修复都是「让守卫与它的测试互相钉死」，未改变任何被校验的业务语义；检查数仍 87，用例数 64 → 66（计划门槛是「不小于 64」，仍成立）。无范围蔓延。

## Issues Encountered

- **执行器两次触达上下文上限**（本轮第二个子代理如此）。第一次发生在写 SUMMARY 之前，工作已落盘但未提交：`66ec59b` 只含任务 1 的实现与部分用例，任务 2 的 9 个用例留在工作树。编排者按工作流用 `git log` / `git diff` / 磁盘状态对账后接管收尾：提交剩余用例（`1b0746c`）、跑完五变异人工探针、修复 CRLF 用例（`b71f7f7`）、撰写本 SUMMARY。所有断言均由编排者亲自实跑，未采用子代理自述。
- **`repository.yaml` 行尾状态曾被探针扰动**：探针用 `Set-Content` 还原后再 `git checkout`，在 `core.autocrlf=true` 下产出 CRLF 工作副本身。这不是内容变更（`git status` 干净），且修复后的用例对此免疫。

## HI-04 人工复现（编排者实跑，逐条对应 verifier 原证词）

```
[D1 delete url line]        exit=1  → ✗ V19 repository.yaml: missing required key "url" -- repository.yaml is the whole-repository manifest, so one bad key makes Supervisor fail to load the entire repository and no app appears at all
[D2 delete maintainer line] exit=1  → ✗ V19 repository.yaml: missing required key "maintainer" -- (同上)
[T1 maintainer: 42]         exit=1  → ✗ V19 repository.yaml: "maintainer" must parse as a non-empty string, got number
[T2 maintainer: null]       exit=1  → ✗ V19 repository.yaml: "maintainer" must parse as a non-empty string, got null
[T3 url: true]              exit=1  → ✗ V19 repository.yaml: "url" must parse as a non-empty string, got boolean
```

对照 `01-VERIFICATION.md` 中 HI-04 的原证词「`maintainer: 42` / `maintainer: null` / `url: true` / 删 `maintainer` / 删 `url` 全部 exit 0」，五种篡改现已全部 exit 1 并点名键名与实测类型。

## Gate 实测

| 命令 | 结果 |
|---|---|
| `corepack pnpm validate:app` | `✓ 87 checks passed`，exit 0，无 `✗` |
| `corepack pnpm test:app` | `# tests 66 / # pass 66 / # fail 0 / # skipped 0 / # todo 0`，exit 0 |
| `corepack pnpm check:app` | exit 0，无 `Out of date` |
| `git status --porcelain`（源码侧） | 干净 |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- HI-04 静态层已闭合，Phase 01 的 20 条 truth 在静态维度上全部有守卫。
- **HAOS 实机验收仍未验证**（D4）：Supervisor 是否接受本仓库、商店是否渲染 app、镜像能否 pull/upgrade、ingress 是否可访问，全部归 Phase 7。任何「已可在 HAOS 安装」的表述在此前都不成立。
- **R3-03 未修（LOW，故意延后）**：`url: "not-a-url"` 仍是 `✓ 87 checks passed`。它与 HI-04 属同类（坏值静态全绿），但不在本计划的 T-01-22 范围内；config 侧的 `documentation` / `issue_tracker` 等 URL 字段同样没有形状校验，属既有对称缺口。建议作为独立计划统一处理 URL 形状（需要先决定是否引入 URL 解析依赖，以及是否允许 `http://` 内网地址），不要在本计划里零散加。
- 后续若改动 `app-metadata.json` 的结构，`REPOSITORY_ALLOWED_KEYS` / `CONFIG_ALLOWED_KEYS` 两张表与派生的 REQUIRED 表必须同步，否则 `check:app` 或 V19 会立刻变红 —— 这是有意的 fail-closed 设计。

---
*Phase: 01-app*
*Completed: 2026-10-27*
