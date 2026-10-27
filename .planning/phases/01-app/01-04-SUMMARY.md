---
phase: 01-app
plan: 04
subsystem: testing
tags: [validator, js-yaml, node-test, fixtures, d-07, contract-literal, supervisor]

# Dependency graph
requires:
  - phase: 01-app
    provides: "58 项静态校验器与 15 条 node:test 负向用例基线（plan 01-01/01-03）"
provides:
  - "V2 必需键从 5 键提升为精确 14 键（由 CONFIG_ALLOWED_KEYS 派生），逐键无条件断言"
  - "V16 类型/格式断言：name/slug/version/description/url/homeassistant 非空字符串 + RE_SLUG + x.y.z"
  - "V17 契约字面值断言：image/version/homeassistant/slug 与 CONTRACT 常量逐字比对（D-01a/D-03a）"
  - "V18 D-07 注释块存活断言（内容断言，不断言格式）"
  - "fixtures.mjs 单一拼装点 withPortsComment()，两个 config.yaml 写出口都带 D-07 尾块"
  - "36 条 node:test 用例、81 项静态检查"
affects: [01-05, Phase 2 CI, Phase 7 实机验证]

# Actuals (#2632) — 与 plan 的 estimate 同一量纲（chars/4 over realized diff）
actuals:
  tokens: 5000
  tasks: 3
  commits: 4
  plan_head_before: d48eea346da57920195478156c8061c6374caa6f
  plan_head_after: a1ee180

tech-stack:
  added: []
  patterns:
    - "必需键集合由白名单派生（required == allowed），而非另抄一份字面量数组"
    - "检查分工：V2 独家负责存在性，V4/V5/V6/V9/V10/V11 只管值是否正确"
    - "夹具里的注释尾块只在一个常量 + 一个 withPortsComment() 拼装点声明"
    - "负向用例除 code 外还断言消息点名了被变异的字段，防止串扰掩盖"

key-files:
  created: []
  modified:
    - "scripts/validate-app-metadata.mjs — V2 键集扩展 + V16/V17/V18 三段检查 + CONTRACT 常量"
    - "scripts/__tests__/validate-app-metadata.test.mjs — 21 条新用例（9 V2 + 7 V16 + 3 V17 + 2 V18/V8）"
    - "scripts/__tests__/fixtures.mjs — PORTS_COMMENT_BLOCK 常量 + withPortsComment() 单一拼装点"

key-decisions:
  - "CONFIG_REQUIRED_KEYS = [...CONFIG_ALLOWED_KEYS]：派生而不再抄一份，杜绝「V8 允许但 V2 不守」的无人负责差集"
  - "存在性只由 V2 负责；V16/V17 的 has() 包裹仅为避免同一缺失键报两次，注释写明这一例外"
  - "V18 断言 # ports: 与 8124/tcp 两个内容片段而非格式，删除注释块与解注释两条互补路径各有用例"
  - "D-07 尾块在 makeValidTree() 与 writeConfig() 两个出口共用 withPortsComment()，不把 serialize()/toYaml() 变成通用注释生成器"
  - "V16 的 homeassistant 正则分支与 trim() 分支各补一条用例：2026.1 实际走的是 float（非字符串）分支，正则分支原本无人覆盖"

patterns-established:
  - "新增无条件检查前，先修夹具基线：基线不合法会让所有负向用例「因两个错误而通过」"
  - "注释块删除类用例必须先 assert.ok(存在) 再删，且删后 assert.doesNotMatch 二次确认，防空操作通过"
  - "同一变异可能同时命中多条检查时，断言消息措辞而不仅是 code"

requirements-completed: [APP-02, APP-03, APP-04]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "删掉 config.yaml 任一必需键（14 键逐一）都以 ✗ V2 非零退出，且消息点名该键"
    requirement: "APP-02"
    verification:
      - kind: unit
        ref: "scripts/__tests__/validate-app-metadata.test.mjs#V2: missing required key \"<key>\" is rejected（14 条）"
        status: pass
    human_judgment: false
  - id: D2
    description: "name/slug/version/description/url/homeassistant 类型与格式错误以 ✗ V16 失败（含空字符串与列表）"
    requirement: "APP-02"
    verification:
      - kind: unit
        ref: "scripts/__tests__/validate-app-metadata.test.mjs#V16: *（7 条）"
        status: pass
    human_judgment: false
  - id: D3
    description: "image/version/homeassistant/slug 契约字面值被改即以 ✗ V17 失败（D-01a/D-03a）"
    requirement: "APP-03"
    verification:
      - kind: unit
        ref: "scripts/__tests__/validate-app-metadata.test.mjs#V17: *（3 条）"
        status: pass
    human_judgment: false
  - id: D4
    description: "删掉 D-07 注释块以 ✗ V18 失败；解开注释以 ✗ V8 失败（两条互补路径）"
    requirement: "APP-04"
    verification:
      - kind: unit
        ref: "scripts/__tests__/validate-app-metadata.test.mjs#V18: deleting the commented ports block is rejected / V8: uncommenting ports is rejected as an unknown key"
        status: pass
    human_judgment: false
  - id: D5
    description: "夹具两条写路径产出的基线本身合法（含 D-07 尾块），故每个负向用例只报它本该报的那个 code"
    requirement: "APP-02"
    verification:
      - kind: unit
        ref: "scripts/__tests__/validate-app-metadata.test.mjs#positive control: a legal temp tree passes / V15: dotted and rootfs copies of config.yaml do not count"
        status: pass
    human_judgment: false
  - id: D6
    description: "本计划通过不等于本阶段可发布：Supervisor 是否识别并渲染出可安装条目仍为 HAOS 未验证"
    verification: []
    human_judgment: true
    rationale: "无 HAOS 实机环境，静态校验层无法代理 Supervisor 的运行时 schema 接受度；计划范围声明明确归 Phase 7 实机证据"

# Metrics
duration: 20min
completed: 2026-10-27
status: complete
---

# Phase 01 Plan 04: 校验器必需键逐键守卫与 V16/V17/V18 三段补强 Summary

**删任一必需键不再静默通过：V2 逐键覆盖精确 14 键，并新增 V16 类型/格式、V17 契约字面值、V18 D-07 注释块存活三段检查，全部配 node:test 负向用例（81 项检查 / 36 条用例全绿）**

## Performance

- **Duration:** 20 min
- **Started:** 2026-10-27T14:38:00+08:00
- **Completed:** 2026-10-27T14:58:00+08:00
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **GAP-1 / HI-02 闭合**：`CONFIG_REQUIRED_KEYS` 从 5 键提升为精确 14 键，且改为由 `CONFIG_ALLOWED_KEYS` 派生（`required == allowed`），逐键 `check()` 无条件断言。删除 `image:` 之前仍是 `✓ 53 checks passed` + exit 0，现在直接 `✗ V2 ... missing required key "image"` + exit 1。
- **MD-02 闭合**：新增 V16，覆盖 `name/slug/version/description/url/homeassistant` 的非空字符串断言、`slug` 的 RE_SLUG 断言、`homeassistant` 的 `x.y.z` 断言。全部基于解析后的值，不碰引号。
- **MD-03 闭合**：新增 V17，把 `image/version/homeassistant/slug` 与 `CONTRACT` 常量逐字比对，并声明该常量是 copy 而非 source of truth，改动属 costly 变更。
- **LO-01 闭合**：新增 V18，断言产物原文同时含 `# ports:` 与 `8124/tcp`；与既有 V8 组成「删块 → V18 / 解注释 → V8」两条互补路径。
- **夹具基线协同改造（本计划的关键前置）**：`makeValidTree()` 与 `writeConfig()` 两个写出口都经 `withPortsComment()` 追加 D-07 尾块，否则 V18 落地瞬间会让三个 exit-0 基线变红，并让每条 `writeConfig` 负向用例「因两个错误而通过」。
- 检查数 58 → 81，用例数 15 → 36，原有 58 项与 15 条用例一条未删、未放宽。

## Task Commits

每个任务单独提交：

1. **任务 1：端到端「删必需键 → 红灯」——V2 键集提升为精确 14 键并逐键断言** - `2f548d5` (feat)
2. **任务 2：V16 类型/格式断言（MD-02）** - `e06b7c9` (feat)
3. **任务 3：V17 契约字面值（MD-03）+ V18 D-07 注释块存活（LO-01）** - `910da3a` (feat)
4. **补充：覆盖 V16 两条此前未触达的失败分支**（偏差 Rule 2，见下） - `a1ee180` (test)

## Files Created/Modified

- `scripts/validate-app-metadata.mjs`
  - `CONFIG_REQUIRED_KEYS` = `[...CONFIG_ALLOWED_KEYS]`（14 键，派生）；V2 注释写明「存在性只由 V2 负责」
  - 新增 `CONTRACT` 常量（image/version/homeassistant/slug）与 `PORTS_COMMENT_MARKERS`
  - 新增 V16（V14 之后、V15 之前）：`STRING_FIELDS` 非空字符串、`SLUG_PATTERN`、`VERSION_TRIPLE_PATTERN`
  - 新增 V17：对 `CONTRACT` 四键逐字比对，消息同时给出期望值与实际值
  - 新增 V18：`texts.get(CONFIG_FILE)` 必须同时含 `# ports:` 与 `8124/tcp`
- `scripts/__tests__/validate-app-metadata.test.mjs`
  - 新增 9 条 V2 用例（url/init/image/homeassistant/homeassistant_api/ingress/ingress_port/options/schema），每条断言 exit 1 + V2 + 点名该键 + 无 `checks passed`
  - 新增 7 条 V16 用例（slug 大小写+空格、numeric name、`2026.1`、list description、空 name、带空格的 `homeassistant` 字符串、带引号 `homeassistant` 正向对照）
  - 新增 3 条 V17 用例（换 ghcr owner、`0.1.1`、`2026.10.9`）
  - 新增 2 条 D-07 互补用例（删注释块 → V18，解注释 → V8），删前 `assert.ok(/^# ports:/m.test(text))`、删后 `assert.doesNotMatch` 双保险
- `scripts/__tests__/fixtures.mjs`
  - 新增 `PORTS_COMMENT_BLOCK`（`# ports:\n#   8124/tcp: 8124\n`，与真实产物逐字一致）与 `withPortsComment()` 单一拼装点
  - `makeValidTree()` 与 `writeConfig()` 均改为 `withPortsComment(toYaml(...))`

## Decisions Made

- **必需集派生而非重抄**：`[...CONFIG_ALLOWED_KEYS]` 让「允许集」与「必需集」不可能出现无人负责的差集；未来加键是一次有意识的成对编辑。
- **存在性单一归属**：V16/V17 里的 `has()` 包裹只用于避免同一缺失键被报两次，不是放宽守卫；V2 注释与 V16 注释都写明了这条分工，防止后来者再加一层。
- **V18 是内容断言不是格式断言**：只断言两个内容片段，不断言引号、缩进宽度、行序。
- **夹具单一拼装点**：注释尾块不做成 `serialize()`/`toYaml()` 的通用注释能力，而是夹具私有常量 + `withPortsComment()`，两个出口共用，避免以后新增辅助函数再漏一次。
- **`writeExtraConfig()` 有意不加尾块**：它只写 V15 用的诱饵副本（`.hidden/`、`rootfs/`、`nested/`），从不写 `homeweave_app/config.yaml`；V18 只检查正式路径。
- 未引入任何依赖：`devDependencies` 仍恰为 `{ js-yaml }`，`package.json` 未改动。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] 补齐 V16 两条此前无人触达的失败分支**
- **Found during:** 任务 2 的自检（计划第 6 条与 `writeConfig` 的实际行为不符）
- **Issue:** 计划把 `homeassistant: '2026.1'` 描述为「字符串但非 x.y.z」。实际 `fixtures.mjs` 的 `PLAIN_SCALAR` 匹配 `2026.1`，因此它被写成**不带引号**的 YAML，js-yaml 解析为 float —— 这条用例实际走的是「非字符串」分支。`VERSION_TRIPLE_PATTERN` 的失败分支（真字符串但格式不对）与 `value.trim() !== ''` 的失败分支（空字符串）在 36 条用例里一条都没被触达。
- **Fix:** 追加两条用例：`config.name = ''`（空字符串分支）；`config.homeassistant = '2026.10 beta'`（含空格 → 被 `JSON.stringify` 加引号 → 真字符串 → 正则失败分支）。后者同时会触发 V17（改动了契约字面值），因此断言的是 V16 的具体消息措辞而非仅 code，避免「因 V17 而通过」。
- **Files modified:** `scripts/__tests__/validate-app-metadata.test.mjs`
- **Verification:** `corepack pnpm test:app` → `# tests 36 / # pass 36 / # fail 0`，exit 0。
- **Committed in:** `a1ee180`

---

**Total deviations:** 1 auto-fixed (1 missing critical coverage)
**Impact on plan:** 纯加法，不改任何生产代码，不放松既有断言。计划第 6 条的字面要求（`homeassistant: '2026.1'` 以 V16 失败）已按原文实现并通过；新增两条只是把 V16 的另外两个失败分支也钉死。

## Issues Encountered

- **`node --test scripts/` 不可用（环境既有事实）**：所有测试命令均使用 `corepack pnpm test:app`（内部为 `node --test "scripts/**/*.test.mjs"`），未绕开。
- **`homeweave_app/config.yaml` 的 `# ports:` 尾块带两行前言**（第 23–24 行解释性注释 + 第 25–26 行 `# ports:` / `#   8124/tcp: 8124`）。按计划第 3 条约束，夹具只复制 V18 实际断言的两行；V18 断言的是内容片段，不含前言。

## Manual Verification (真实退出码)

| 命令 | 观察到的输出 | exit code |
|---|---|---|
| `corepack pnpm generate:app` | 无输出（脚本静默），`git status --porcelain` 中两个生成物**零 diff** | 0 |
| `corepack pnpm validate:app` | `✓ 81 checks passed` | 0 |
| `corepack pnpm test:app` | `# tests 36 / # pass 36 / # fail 0` | 0 |

**手工负向抽查**（在 `os.tmpdir()` 下的 `homeweave_app/config.yaml` + `repository.yaml` 副本上逐项制造缺陷，未改动仓库树产物；脚本用后即删）：

| 变异 | 观察到的失败 |
|---|---|
| 副本原样 | `✓ 81 checks passed`，exit 0 |
| 删 `image:` | `✗ V2 ... missing required key "image"`，`75 checks run, 1 failed`，exit 1 |
| 删 `init:` | `✗ V2 ... missing required key "init"`，`79 checks run, 1 failed`，exit 1 |
| 删 `ingress:` + `ingress_port:` | 两条 `✗ V2` 分别点名 ingress 与 ingress_port，`77 checks run, 2 failed`，exit 1 |
| `image` 换 owner | `✗ V17 ... "image" must be exactly "ghcr.io/zee1988/homeweave-ha-app"`，exit 1 |
| `version: "0.1.1"` | `✗ V17 ... "version" must be exactly "0.1.0"`，exit 1 |
| `name: 12345` | `✗ V16 ... "name" must parse as a non-empty string, got number`，exit 1 |
| 删 `# ports:` 注释块 | 两条 `✗ V18`（`# ports:`、`8124/tcp` 各一条），exit 1 |
| 解注释让 `ports:` 成活键 | `✗ V8 unknown key "ports"`（伴随一条 V18），exit 1 |

抽查还确认了关键性质：除「解注释」那条外，上述每个负向变异的输出里**只有它本该报的那个 code**，没有夹带 V18 —— 说明 `withPortsComment()` 在 `writeConfig()` 出口生效，负向用例不是「因两个错误而通过」。

## Known Stubs

None。本计划不涉及 UI、数据源或占位文本；新增代码全部是可执行断言。

## Threat Flags

None。未新增网络端点、鉴权路径、文件访问模式或 schema 信任边界；改动只落在本地静态校验器与其测试夹具，夹具仍全部落在 `os.tmpdir()` 下。

## User Setup Required

None - no external service configuration required.（无需新依赖，`devDependencies` 仍恰为 `js-yaml`。）

## Next Phase Readiness

- **01-05 可以接上**：本计划把 `scripts/validate-app-metadata.mjs` 的常量区（`CONFIG_ALLOWED_KEYS` / `CONFIG_REQUIRED_KEYS` / `CONTRACT`）与检查编号（V16/V17/V18 已占用，V15 仍在末尾）稳定下来；01-05 的漂移守卫可直接复用 `CONTRACT` 语义与夹具的 `withPortsComment()`。
- **未完成（明确推迟）**：MD-01（两文件写盘非原子）→ 01-05；LO-02 / LO-03 / LO-04 / LO-05 → 见计划 success_criteria 的推迟清单。
- **仍为 HAOS 未验证**：Supervisor 是否真的接受这份 `config.yaml` 并渲染出可安装条目，静态层无法代签。本计划通过 ≠ 本阶段可发布，该项只归 Phase 7 实机清单。
- **给 verifier 的两个复核点**：（1）`test:app` 用例数应为 36、`validate:app` 检查数应为 81，若数字不同说明基线被改动过；（2）`scripts/__tests__/fixtures.mjs` 中写 `homeweave_app/config.yaml` 的出口必须仍然只有 `makeValidTree()` 与 `writeConfig()` 两处，且两处都经 `withPortsComment()`。

---

*Phase: 01-app*
*Completed: 2026-10-27*

## Self-Check: PASSED

- 提交祖先校验：`2f548d5` / `e06b7c9` / `910da3a` / `a1ee180` 均为 HEAD 祖先 —— FOUND
- 产出文件存在：`.planning/phases/01-app/01-04-SUMMARY.md`、`scripts/validate-app-metadata.mjs`、`scripts/__tests__/validate-app-metadata.test.mjs`、`scripts/__tests__/fixtures.mjs` —— FOUND
- 夹具写出口复核：`homeweave_app/config.yaml` 的写入点仍为 `makeValidTree()`（第 131 行）与 `writeConfig()`（第 146 行）两处，两者都经 `withPortsComment()` —— CONFIRMED
