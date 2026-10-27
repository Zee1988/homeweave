---
phase: 01-app
verified: 2026-10-27T08:26:18Z
status: passed
score: 20/20 must-haves verified
must_haves_checked: 20
covered_files:
  - .planning/phases/01-app/01-01-PLAN.md
  - .planning/phases/01-app/01-01-SUMMARY.md
  - .planning/phases/01-app/01-02-PLAN.md
  - .planning/phases/01-app/01-02-SUMMARY.md
  - .planning/phases/01-app/01-03-PLAN.md
  - .planning/phases/01-app/01-03-SUMMARY.md
  - .planning/phases/01-app/01-04-PLAN.md
  - .planning/phases/01-app/01-04-SUMMARY.md
  - .planning/phases/01-app/01-05-PLAN.md
  - .planning/phases/01-app/01-05-SUMMARY.md
  - .planning/phases/01-app/01-06-PLAN.md
  - .planning/phases/01-app/01-06-SUMMARY.md
  - docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md
  - homeweave_app/app-metadata.json
  - homeweave_app/config.yaml
  - package.json
  - repository.yaml
  - scripts/__tests__/fixtures.mjs
  - scripts/__tests__/generate-app-metadata.test.mjs
  - scripts/__tests__/validate-app-metadata.test.mjs
  - scripts/generate-app-metadata.mjs
  - scripts/validate-app-metadata.mjs
covered_digest: "v4:sha256:e19a9efb94be3fdc7d2510820b3cda28752f5048e053973169379e93a6286008"
behavior_unverified: 0
overrides_applied: 0
re_verification: true
previous_status: gaps_found
previous_score: 19/20
gaps_closed:
  - "GAP-1 / HI-02：config.yaml 必需键缺失静默通过 —— 14/14 键逐键删除均以 ✗ V2 点名该键退出 1"
  - "GAP-2 / HI-01：生成物 vs 单一数据源的漂移守卫 —— --check 已串联进 test:app，改源不重生成时 node:test 不执行且整体 exit 1"
  - "HI-04：repository.yaml 逐键必需/类型守卫缺失 —— V19 已落地，五种篡改全部 exit 1 并点名键名与实测类型；源侧 assertNonEmptyString 同步 fail-closed"
gaps_remaining: []
regressions: []
gaps: []
deferred:
  - truth: "Supervisor 实机把 https://github.com/Zee1988/homeweave 识别为有效 App 仓库并渲染出 HomeWeave 条目（APP-01、ROADMAP 成功标准 1/5）"
    addressed_in: "Phase 7"
    evidence: "ROADMAP Success Criteria 1 要求「HAOS 部分明确标注未验证」；Notes 声明「只有 Phase 7 的实机清单在真实设备上被勾选后，才能使用 HAOS 实机通过的措辞」"
  - truth: "安装后 log_level / ha_url 选项渲染正确、默认值生效、详情与日志页正常（APP-04、APP-02 的 schema 运行时解析）"
    addressed_in: "Phase 7"
    evidence: "Supervisor 对 schema DSL 的解析属运行时行为；静态层已由 V11/V12 覆盖到可静态证明的极限"
  - truth: "镜像可拉取（image 无 tag）并在安装/升级路径上行为正确"
    addressed_in: "Phase 7"
    evidence: "ROADMAP Phase 7 Depends on Phase 1–6；镜像发布归 Phase 2「镜像构建与发布链路」"
  - truth: "「Open Web UI」/ Ingress 按钮在 Phase 5 前的行为（已知限制 S2）"
    addressed_in: "Phase 7"
    evidence: "Ingress 页面能力归 Phase 5「Ingress Web UI 与认证边界」；Phase 1 只交付静态声明"
advisory:
  - finding: "R3-03（LOW，已知且有意延后）：repository.yaml 的 url 只判「非空字符串」不判形状，url: \"not-a-url\" 仍 ✓ 87 checks passed exit 0"
    category: other
    reason: "不在 01-06 计划 T-01-22 范围内；config 侧 documentation/issue_tracker 同样无形状校验，属既有对称缺口；修复需先决定是否引入 URL 解析依赖与是否允许 http:// 内网地址，应作为独立计划统一处理"
    evidence_status: "01-REVIEW.md R3-03 实测；本轮未复跑（按指令不计为 HI）"
  - finding: "scalar() 正白名单仍允许 null/true/false/yes/no/on/off 裸写（MD-08）"
    category: architectural
    reason: "需作者主动写出保留词才触发；当前产物无此类值；js-yaml 4 回读为字符串、Supervisor（PyYAML 系）回读为布尔"
    evidence_status: "01-REVIEW.md MD-08 逐值实测；本轮未复跑"
  - finding: "assertConsumedKeys() 调用点在 try 之外（MD-06）：app: null / repository: null 退回原始堆栈"
    category: other
    reason: "退出码仍 1 且在写盘前中止，fail-closed 未破；只影响报错形状与排障成本"
    evidence_status: "01-REVIEW.md MD-06 实测；本轮未复跑"
human_verification: []
---

# Phase 01: App 仓库结构与元数据 Verification Report

**Phase Goal:** 仓库结构与 App 元数据达到「Supervisor 能识别为有效 App 仓库并渲染出可安装条目」的条件，并锁死全部占位符决策。
**Verified:** 2026-10-27T08:26:18Z
**Status:** passed
**Re-verification:** Yes — plan 01-06（HI-04）之后

> 上一轮唯一阻塞项 HI-04 在隔离副本上被独立复现：五种篡改全部 exit 1 并被 `✗ V19` 点名正确键与实测类型，源侧 `assertNonEmptyString` 亦 fail-closed。**20/20 truth 通过，`status: passed`。** HAOS 实机 4–5 项维持 unknown，按 ROADMAP 既定归属移交 Phase 7（见 `deferred:`），不计入本阶段缺口。

## Re-verification (plan 01-06)

本轮变更范围（`git diff 66ec59b~1..HEAD --stat`，源码侧仅 4 个文件）：

```
scripts/__tests__/generate-app-metadata.test.mjs | 106 +++++++++++++++-
scripts/__tests__/validate-app-metadata.test.mjs | 137 +++++++++++++++++++++
scripts/generate-app-metadata.mjs                |  27 +++
scripts/validate-app-metadata.mjs                |  56 ++++++++
```

两个实现文件 diff 为纯新增（0 删除）；`repository.yaml` / `homeweave_app/*` / `package.json` **未出现在 diff 中**，产物与依赖面零变更。

### 1. 三道 gate 亲自实跑（未引用 SUMMARY 数字）

| 命令 | 实测报文 | exit |
|---|---|---|
| `corepack pnpm validate:app` | `✓ 87 checks passed`（无 `✗`） | **0** |
| `corepack pnpm test:app` | `# tests 66 / # suites 0 / # pass 66 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（`1..66`） | **0** |
| `corepack pnpm check:app` | 无 `Out of date`、无输出即通过 | **0** |

`git status --porcelain` 全程为空（探针在 `%TEMP%` 副本执行，仓库工作树未被触碰）。

### 2. HI-04 五变异独立复现（关键裁决项）

方法：`%TEMP%/hw-hi04-probe` 隔离副本树（`scripts/` + `homeweave_app/` + `repository.yaml` + `node_modules/js-yaml`）；校验器 `ROOT = process.cwd()`，故读取副本内产物。被测键值与真实 `repository.yaml` 逐字一致，基线先自证 `✓ 87 checks passed` exit 0。

| # | 篡改（副本 `repository.yaml`） | exit | 实测报文 |
|---|---|---|---|
| D1 | 删除 `url:` 整行 | **1** | `✗ V19 repository.yaml: missing required key "url" -- repository.yaml is the whole-repository manifest, so one bad key makes Supervisor fail to load the entire repository and no app appears at all` / `85 checks run, 1 failed` |
| D2 | 删除 `maintainer:` 整行 | **1** | `✗ V19 repository.yaml: missing required key "maintainer" -- (同上)` / `85 checks run, 1 failed` |
| T1 | `maintainer: 42` | **1** | `✗ V19 repository.yaml: "maintainer" must parse as a non-empty string, got number` / `87 checks run, 1 failed` |
| T2 | `maintainer: null` | **1** | `✗ V19 repository.yaml: "maintainer" must parse as a non-empty string, got null` / `87 checks run, 1 failed` |
| T3 | `url: true` | **1** | `✗ V19 repository.yaml: "url" must parse as a non-empty string, got boolean` / `87 checks run, 1 failed` |

**五种篡改全部反转**：上一轮这五条均为 `exit 0` + `✓ 81 checks passed`；本轮全部 `exit 1` + `✗ V19`，键名与类型词均正确、无错位。

### 3. 两个新增边界输入（上轮未试）

| # | 输入 | exit | 实测报文 | 堆栈 |
|---|---|---|---|---|
| B1 | `repository.yaml` 空文件 | **1** | `✗ V1 repository.yaml: top level must be a mapping, got undefined` / `76 checks run, 1 failed` | 无（`hasStackTrace=False`） |
| B2 | 顶层写成数组（`- name: …`） | **1** | `✗ V1 repository.yaml: top level must be a mapping, got a list` / `76 checks run, 1 failed` | 无（`hasStackTrace=False`） |

均未崩栈、未静默通过。V19 的前提取决于 V1 已放过，而 V1 在此二例中 fail 并返回 `null`，故不存在「无键可查」的绕过路径。还原副本后复归 `✓ 87 checks passed` exit 0。

### 4. 源侧 fail-closed 独立复现（HI-04 的另一半）

在副本 `homeweave_app/app-metadata.json` 改源，跑 `node scripts/generate-app-metadata.mjs`：

| 变异 | exit | 实测报文 |
|---|---|---|
| `repository.maintainer = 42` | **1** | `Failed: …/app-metadata.json: repository.maintainer must be a non-empty string; got number` |
| `repository.url = null` | **1** | `Failed: …/app-metadata.json: repository.url must be a non-empty string; got null` |

报文为生成器自有 `Failed: <源路径>: <键> …` 形状，无 JS 堆栈帧。**「源注入坏值 → generate 0 → check 0 → validate 0」三门全绿路径已不可达**（上轮 `01-REVIEW.md` 实测的成因被消除）。

### 5. HI-04 代码侧确认（两半结构上都成立）

- **产物侧 V19**（`scripts/validate-app-metadata.mjs:189-234`）：两段独立。存在性循环 `:212-221` 的循环体是裸 `check(has(repository, key), 'V19', …)`，**不在任何 `if (has(...))` 内** —— 上轮根因（缺键时静默短路）结构上被消除；类型循环 `:223-234` 为独立 `for`，`if (!has(...)) continue` 只为「一缺键 = 一失败」，不消费前段结果。
- **必需集派生**（`:62`、`:71`）：`REPOSITORY_REQUIRED_KEYS = [...REPOSITORY_ALLOWED_KEYS]`，与 `CONFIG_REQUIRED_KEYS`（`:60`）同构，无「V8 允许但无人要求」的差集；插入序固定 `name → url → maintainer`。
- **源侧断言**（`scripts/generate-app-metadata.mjs:190-207`）：`assertNonEmptyString` 判 `typeof value === 'string' && value.trim() !== ''`，`null`/`undefined`/数字/布尔/数组一律抛，**无「先 stringify 再判空」窗口**；三个调用点 `:202-204` 全在唯一 `scalar()`（`:206`）之前；缺键更早被 `assertConsumedKeys()` 拦截。
- **用例钉死**：`validate-app-metadata.test.mjs:396-507` 有 7 条 V19 负例（数字/null/空串 maintainer、布尔 url、缺失 url/maintainer/name），全部走 `assertDetects(result, 'V19', …)`（`status !== null` + `exit 1` + `✗ V19` + 点名键）；`generate-app-metadata.test.mjs:288-303` 的 `REPOSITORY_SOURCE_FAILURES` 4 项覆盖 name/url/maintainer 三行断言（含 R3-01 补的两条），删任一调用点即转红。

### 6. 旧缺口未回归（抽验，非重跑）

| 项 | 本轮观测 |
|---|---|
| GAP-1 / HI-02 | `V2` 循环在 `:172-176` 仍为无条件 `check()`；87 全绿说明 14 键断言全在跑。14/14 逐键矩阵沿用上轮实测（本轮未重跑） |
| GAP-2 / HI-01 | `check:app` exit 0 无 `Out of date`；`test:app` 66 例含两条真链路用例。「改源 → test:app 红」完整探针沿用上轮（本轮未重跑） |
| 检查数 / 用例数 | 81 → **87**（+6 = V19 的 3 存在性 + 3 类型），53 → **66**（+13），**零减少**（本轮实跑） |
| `TBD`/`FIXME`/`XXX`/`.skip`/`.only`/`todo(` | 全量扫描 `scripts/` → **0 命中** |
| 产物与依赖面 | 三处产物与 `package.json` 均不在本轮 diff 内；`repository.yaml` 内容逐字未变 |

### 7. HI-04 改判

**上一轮判定：阻塞缺口（`gaps[0]`，truth #9 FAILED）。本轮判定：resolved。**

依据：原证词点名的五种篡改（删 `url` / 删 `maintainer` / `maintainer: 42` / `maintainer: null` / `url: true`）在本轮独立实测中**全部 exit 1 且被 `✗ V19` 点名正确键名与实测类型**；两条新增边界输入（空文件、顶层数组）由 `✗ V1` 拦截且无堆栈；源侧三门全绿路径以 `assertNonEmptyString` 封闭并经两例变异实测。根因「`if (has(...))` 在键缺失时静默短路」在结构与行为两个层面都已消除。上轮点名的三项 `missing` 全部落地：

| 上轮 `missing` 项 | 落地位置 |
|---|---|
| 新增 V19：逐键断言三键存在且为可解析的非空字符串 | `validate-app-metadata.mjs:212-234` |
| 生成器写盘前 `assertNonEmptyString('repository.<key>', …)` | `generate-app-metadata.mjs:202-204` |
| 配套负例：三键各一条删除 + 一条 null + 一条数字 | `validate-app-metadata.test.mjs:396-507`（7 条）+ `generate-app-metadata.test.mjs:288-303`（4 项） |

## 目标倒推检查（沿用上轮 20 条）

| # | Truth | Status | 证据 |
|---|-------|--------|------|
| 1 | D-02 单一来源生效：改源重跑两产物同步；无手工编辑路径 | ✓ VERIFIED | `check:app` exit 0 零漂移（本轮实跑）；`generate→check` 零残留 + 改源不重生成点名过期产物两条真链路在 66/66 内通过；GAP-2 完整探针沿用上轮 |
| 2 | 仓根唯一 `repository.yaml`，三字段值正确（APP-03） | ✓ VERIFIED | 内容逐字匹配（本轮实读）；全仓仅 1 份；V3 + V8 + **V19** 三层覆盖 |
| 3 | `config.yaml` 五必填键齐全，arch 恰为 amd64/aarch64 顺序固定 | ✓ VERIFIED | 14 键无条件断言在 `:172-176`；87 全绿；14/14 矩阵沿用上轮 |
| 4 | image 全小写无 tag；version 为 `0.1.0` 字符串（D-01a） | ✓ VERIFIED | V17 逐字契约比对 + 3 条负例；87 全绿 |
| 5 | homeassistant = `2026.10.0`（D-03a），HAOS 未验证有标注 | ✓ VERIFIED | 产物一致；V17 锁定；docs/21 §11 保留标注 |
| 6 | options + schema：log_level 三选一、ha_url 可选默认空串 | ✓ VERIFIED | 产物逐字匹配；V11/V12 + 负例；V2 保证两键存在 |
| 7 | 注释态 ports 块存在且无激活 ports 键（D-07） | ✓ VERIFIED | V18 断言两内容片段；解注释→V8、删块→V18，各有负例 |
| 8 | 重跑生成器后两生成物 `git diff` 为空 | ✓ VERIFIED | `check:app` exit 0；探针后 `git status --porcelain` 为空 |
| 9 | 单一入口判定**两个生成物**的必填/类型/取值 | ✓ **VERIFIED（本轮改判，原 FAILED）** | config 侧 V2/V16/V17；repository 侧新增 V19 —— 五变异全 exit 1 并点名（D1/D2/T1/T2/T3），两边界输入 V1 拦截（B1/B2）；源侧三门全绿路径已封 |
| 10 | 键白名单：未知键即非零退出 | ✓ VERIFIED | V8 对两文件各一套（repository 在 `:319-327`）+ 负例 |
| 11 | image 无 tag/ghcr 前缀；arch 仅 amd64/aarch64 | ✓ VERIFIED | V5/V6 + 负例；V17 追加字面值 |
| 12 | options↔schema 交叉检查 + DSL 字面值 | ✓ VERIFIED | V11/V12 + 负例；DSL 逐字匹配 |
| 13 | 全仓 `config.*` 恰 1 份，跳过点段与 rootfs | ✓ VERIFIED | V15 + 负例；隔离副本基线未误报 |
| 14 | 收集式失败，退出码只有 0/1 | ✓ VERIFIED | 本轮观测 `85 checks run, 1 failed` / `76 checks run, 1 failed` / `✓ 87 checks passed` 三种计数式输出，exit 仅 0 或 1 |
| 15 | 每个核心检查 ≥1 负例 | ✓ VERIFIED | 66 例全绿；V19 现有 **7 条**负例（`:396-507`，三键 × 缺失/类型错误）；生成器侧 4 条表驱动（`:288-303`） |
| 16 | 正向对照：合法临时树 exit 0 | ✓ VERIFIED | 隔离副本基线 `✓ 87 checks passed` exit 0（本轮实跑）+ `positive control` 用例 |
| 17 | 夹具全在 `os.tmpdir()` 并清理 | ✓ VERIFIED | 本轮探针建于 `%TEMP%/hw-hi04-probe`、跑完 `Remove-Item -Recurse -Force`，`tempExists=False`；仓库 `git status` 全程为空 |
| 18 | 负向断言只读退出码与 check code | ✓ VERIFIED | `assertDetects` 断言 `exit 1` + `✗ <code>` + 点名键；值断言走 js-yaml 回读 |
| 19 | docs/21 §5 ports 注释态（D-07） | ✓ VERIFIED | 与 config.yaml:23-26 一致；docs 本轮无 diff |
| 20 | docs/21 §11 HAOS 实机条目（APP-01） | ✓ VERIFIED | 条目存在并标注「HAOS 未验证」；docs 本轮无 diff |

**Score: 20/20**，`behavior_unverified: 0` —— 本轮所有行为类断言均有实跑证据，无 `PRESENT_BEHAVIOR_UNVERIFIED` 残留。

## 产物存在性

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | 4 个 app 脚本、engines >=22、仅 js-yaml | ✓ VERIFIED | `generate/validate/check/test:app`；`>=22`；依赖未增（本轮无 diff） |
| `homeweave_app/app-metadata.json` | 两段式单一数据源 | ✓ VERIFIED | 生成器读、校验器不读；repository 段三键现由源侧断言守住 |
| `scripts/generate-app-metadata.mjs` | `--check` 只读守卫 + 源 fail-closed | ✓ VERIFIED（本轮补齐） | 双模式写入、EOL 归一、双向键白名单、plain-scalar 白名单；**三键 `assertNonEmptyString` 位于 `scalar()` 之前**，两例变异实测 exit 1 |
| `repository.yaml` | 仓根生成物 | ✓ VERIFIED | 内容逐字正确、全仓唯一；三键存在性 + 类型由 V19 守住（五变异实跑） |
| `homeweave_app/config.yaml` | 14 键 + 注释尾块 | ✓ VERIFIED | 实读一致；V2/V16/V17/V18 全链 |
| `scripts/validate-app-metadata.mjs` | 87 项检查、收集式、0/1 | ✓ VERIFIED | 87 实测；V19 段 `:189-234` 存在性无条件、类型独立循环 |
| `scripts/__tests__/validate-app-metadata.test.mjs` | 负例 + 正向对照 | ✓ VERIFIED | 66 例全绿；V19 7 条负例 |
| `scripts/__tests__/generate-app-metadata.test.mjs` | 漂移 / fail-closed / scalar / CRLF | ✓ VERIFIED | 两条真链路用例 + 4 项 repository 源失败表（R3-01 已补） |
| `scripts/__tests__/fixtures.mjs` | 临时树构造器，单一注释拼装点 | ✓ VERIFIED | `withPortsComment()` 单点；`writeExtraConfig()` 有意不带 |
| `docs/21_...DEPLOYMENT.md` | §5 注释态 ports、§11 实机条目 | ✓ VERIFIED | 与产物一致 |

## prohibitions 检查

| Prohibition | 状态 | 证据 |
|---|---|---|
| 不得存在第二份可被递归识别的 `config.*` | ✓ 成立 | 全仓仅 1 份；V15 + 负例；隔离副本基线未误报 |
| 树内不得出现真实 config 夹具 | ✓ 成立 | 夹具全在 `os.tmpdir()`，本轮探针跑完自删（`tempExists=False`） |
| 测试不得断言引号风格 | ✓ 成立 | 仅 V18 断言两段内容子串；值断言走 js-yaml |
| 不得修改 `examples/*.example` | ✓ 成立 | 本轮 diff 文件列表不含 `examples/` |
| 不得新增依赖 | ✓ 成立 | `package.json` 本轮无 diff；`devDependencies` 仍恰为 `{ js-yaml }` |

## 需求逐条裁定（APP-01..APP-04）

| Requirement | 静态裁定 | 说明 |
|---|---|---|
| **APP-01** | ⚠️ 未验证（人工，归 Phase 7） | 静态前提齐备且守卫完整（含 repository 侧 V19）；「Supervisor 识别 + 商店渲染出可安装条目」不可静态证明 → `deferred[0]` |
| **APP-02** | ✓ 静态满足 | arch/ingress/ingress_port/init/homeassistant_api 声明齐备；14 键必填性与类型由 V2/V16/V17 守住；`watchdog/startup/boot/healthcheck` 依最小字段集决策（D-07）依赖 Supervisor 默认值 —— 该解释问题与 schema 运行时解析一并移交 Phase 7 |
| **APP-03** | ✓ 静态通过（守卫本轮补齐） | 三字段值逐字正确、全仓唯一；逐键必需 + 类型由 V19 守住，五变异实跑全红 |
| **APP-04** | ✓ 静态通过 | options/schema/默认值/DSL 正确，V11 交叉检查 + 负例 |

**占位符决策锁定**：全仓占位符扫描为空集（无 `<owner>` 类模板残留）；D-01a/D-02/D-03a/D-04/D-05a/D-07/D-09 均已落进产物或文档。✓ 达成。

## 未验证项与原因（HAOS 侧，归 Phase 7，非本阶段缺口）

1. **Supervisor 实机识别与商店渲染（APP-01 核心）** —— 未验证：无 HAOS 环境，静态层只提供必要条件 → `deferred[0]`
2. **Supervisor schema 实际校验通过（APP-02 后半句）** —— 未验证：本地校验器是复刻（`REMOVE_EXTRA`、`RE_SLUG` 等语义靠研究文档复刻）→ `deferred[1]`
3. **安装/启动/升级路径与镜像 pull** —— 未验证：依赖 Phase 2 镜像发布与 Phase 7 实机清单 → `deferred[2]`
4. **`watchdog/startup/boot/healthcheck` 缺失是否符合 APP-02 文字** —— 未验证：需求解释问题，需人工裁定 → `deferred[1]`
5. **Ingress「Open Web UI」按钮在 Phase 5 前的表现（已知限制 S2）** —— 未验证：归 Phase 5/7 → `deferred[3]`

以上 5 点与上一轮归类一致，状态维持 `unknown`；ROADMAP Notes 明确「只有 Phase 7 的实机清单在真实设备上被勾选后，才能使用 HAOS 实机通过的措辞」。故不计入本阶段缺口。

## Human Verification Required（已全部移交 Phase 7）

本阶段无需人工介入即可判定通过。下列 4 条为长期未验证项，已在 `deferred:` 中登记去向，供 Phase 7 的 `-UAT.md` 收编，不是 Phase 01 的放行条件：

1. **HAOS 添加仓库** — 设置 → 加载项商店 → 右上角仓库 → 添加 `https://github.com/Zee1988/homeweave`；期望列表出现 HomeWeave 条目
2. **选项渲染** — 安装后确认 `log_level`（info/debug/warning）与 `ha_url`（默认空串）可见且默认值生效
3. **镜像 pull / upgrade** — 确认 `image` 无 tag 时 Supervisor 解析出与 `version` 对应的 tag
4. **Ingress 按钮** — Phase 5 前的空白/错误页应记入已知限制（S2），不记为失败

## Gaps Summary

**无阻塞缺口。** 上一轮唯一阻塞项 HI-04 已在本轮独立复现中闭合（五变异 + 两边界 + 源侧双双实测）。`gaps: []`、`gaps_remaining: []`、`regressions: []`。

**非阻断残留（advisory，不阻塞放行）**：

- **R3-03（LOW，已知有意延后）**：`url: "not-a-url"` 仍 `✓ 87 checks passed` exit 0。与 HI-04 同属「坏值静态全绿」类别，但不在本计划声明范围内，且 config 侧 `documentation`/`issue_tracker` 等 URL 字段同样缺形状校验（既有对称缺口）。修复需先决定是否引入 URL 解析依赖、是否允许 `http://` 内网地址 —— 建议作为独立计划统一处理，不要零散加。
- **MD-06 / MD-08**：报错形状与 YAML 保留词白名单，均未突破 fail-closed。

## 下一阶段交接

- **本阶段可放行**：20/20 truth 通过，无阻塞缺口。
- **移交 Phase 7**：`deferred[0..3]` 五条 HAOS 未验证内容，登记为「HAOS 未验证 / 待实机」证据。
- **建议独立计划处理的残留**：R3-03 URL 形状校验（config 与 repository 两处对称缺口一并处理）。
- **Phase 2 提醒**：`check:app` 已串联进 `test:app`，CI 只需跑 `corepack pnpm test:app` 即可同时获得静态校验链（87 checks）与漂移守卫；`engines.node >=22` 是 CI 选型的硬约束。若改动 `app-metadata.json` 结构，`REPOSITORY_ALLOWED_KEYS` / `CONFIG_ALLOWED_KEYS` 两张表与派生的 REQUIRED 表必须同步，否则 `check:app` 或 V19 会立刻变红 —— 这是有意的 fail-closed 设计。

---

_Verified: 2026-10-27T08:26:18Z_
_Verifier: CodeBuddy (gsd-verifier)_

