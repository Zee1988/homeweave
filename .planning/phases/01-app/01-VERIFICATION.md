---
phase: 01-app
verified: 2026-10-27T15:35:00Z
status: gaps_found
score: 19/20 must-haves verified
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
covered_digest: "v4:sha256:6ecc650c86e6ecaa8772b8c4d8aaab6300ad7b95bdb3aa6ce9dd244936b23eeb"
behavior_unverified: 0
overrides_applied: 0
re_verification: true
previous_status: gaps_found
previous_score: 18/20
gaps_closed:
  - "GAP-1 / HI-02：config.yaml 必需键缺失静默通过 —— 14/14 键逐键删除均以 ✗ V2 点名该键退出 1"
  - "GAP-2 / HI-01：生成物 vs 单一数据源的漂移守卫 —— --check 已串联进 test:app，改源不重生成时 node:test 不执行且整体 exit 1"
gaps_remaining:
  - "HI-04：repository.yaml 仍无逐键必需/类型守卫（maintainer: 42 / null / 缺失、url: true / 缺失 均 exit 0）"
regressions: []
gaps:
  - truth: "开发者执行单一入口 `pnpm validate:app` 即可判定**两个生成物**是否满足必填字段、类型与取值约束"
    status: partial
    reason: "config.yaml 一侧已真实闭合（14/14 逐键实测），但同一轮交付的姊妹生成物 `repository.yaml` 未被纳入：`REPOSITORY_ALLOWED_KEYS` 只支撑 V8（拒绝多余键），既无必需键存在性断言，也无 url/maintainer 类型断言；V3 只约束 name。本轮独立实测（临时树副本，未改仓库）：maintainer: 42 → exit 0/✓81；maintainer: null → exit 0/✓81；删 maintainer 整行 → exit 0/✓80；url: true → exit 0/✓81；删 url 整行 → exit 0/✓80；仅 name: null 被 ✗ V3 抓住。源侧同样无人守：generate-app-metadata.mjs:177-180 对 repository 段只有 assertObject + 键白名单，故「源注入 maintainer: 42 → generate 0 → check 0 → validate 0」是完整的三门全绿路径。"
    artifacts:
      - path: "scripts/validate-app-metadata.mjs"
        issue: "只有 V3（name）；缺 repository 段逐键存在性 + 类型断言（建议 V19，与 CONFIG_REQUIRED_KEYS 同构）"
      - path: "scripts/generate-app-metadata.mjs"
        issue: "buildRepositoryYaml() 未对 name/url/maintainer 做非空字符串断言，坏源在写盘前不停下"
    missing:
      - "新增 V19：逐键断言 name/url/maintainer 存在且为可解析的非空字符串（消息点名该键）"
      - "生成器写盘前 assertNonEmptyString('repository.<key>', …)，与 app 段 fail-closed 对齐"
      - "配套负例：三键各一条删除、一条 null、一条数字，断言 ✗ V19 且点名被变异键"
deferred: []
advisory:
  - finding: "scalar() 正白名单仍允许 null/true/false/yes/no/on/off 裸写（MD-08）：null/true 被 V16 抓住，但 yes/no/on/off 在 js-yaml 4 回读为字符串、在 Supervisor（PyYAML 系）回读为布尔"
    category: architectural
    reason: "需作者主动写出保留词才触发；当前产物无此类值；修复为一条正则排除 + 一条属性测试。属同类残留，但不影响当前产物的 Supervisor 接受度"
    evidence_status: "01-REVIEW.md MD-08 逐值实测；本次未复跑"
  - finding: "assertConsumedKeys() 调用点在 try 之外（MD-06）：app: null / repository: null / 源文件为 null 退回原始堆栈"
    category: other
    reason: "退出码仍 1 且在写盘前中止，fail-closed 未破；只影响报错形状与排障成本"
    evidence_status: "01-REVIEW.md MD-06 实测；本次未复跑"
human_verification:
  - test: "HAOS「设置 → 加载项商店 → 右上角仓库 → 添加」https://github.com/Zee1988/homeweave，刷新后确认 Apps 列表出现 HomeWeave 条目"
    expected: "仓库被识别为有效 App 仓库，列表出现 HomeWeave 条目并可进入详情/安装（APP-01、APP-03、ROADMAP 成功标准 1/5）"
    why_human: "无 HAOS 实机；Supervisor 的接受行为不可静态证明（01-VALIDATION.md Manual-Only Verifications）"
  - test: "安装后确认 log_level / ha_url 选项可见且有默认值（info / 空串），打开日志页"
    expected: "选项渲染正确、默认值生效、详情与日志页正常（APP-04、APP-02 的「schema 校验通过」）"
    why_human: "Supervisor 对 schema DSL 的解析与 UI 渲染属运行时行为"
  - test: "确认镜像可拉取（image 无 tag）并在升级路径上行为正确"
    expected: "Supervisor 解析出与 version 对应的 tag 并成功安装/升级"
    why_human: "依赖 Phase 2 镜像发布；本阶段只交付静态声明"
  - test: "「Open Web UI」/ Ingress 按钮在 Phase 5 前的行为"
    expected: "点击后空白/错误页，记入已知限制（S2），不记为失败"
    why_human: "已知后果，需实机核对是否被误判为缺陷"
---

# Phase 01: App 仓库结构与元数据 Verification Report

**Phase Goal:** 仓库结构与 App 元数据达到「Supervisor 能识别为有效 App 仓库并渲染出可安装条目」的条件，并锁死全部占位符决策。
**Verified:** 2026-10-27T15:35:00Z
**Status:** gaps_found
**Re-verification:** Yes — 01-04 / 01-05 之后

> 两条旧阻塞缺口**确实关掉了**，是「变异会被抓住」意义上的关闭。但同一修法在姊妹生成物上留了同一失效类的最后一个口子（HI-04），本轮判为仍属阶段目标的阻塞项。

## 旧缺口独立复验（本轮实跑）

### GAP-1 / HI-02 —— 已关闭，14/14 键证明

方法：把真实 `homeweave_app/config.yaml` + `repository.yaml` 复制到 `os.tmpdir()` 临时树（保留 `# ports:` 注释块，排除 V18 串扰），文本级逐键删除该键及续行，以该树为 cwd 运行 `scripts/validate-app-metadata.mjs`。

| 删除对象 | exit | 报文 |
|---|---|---|
| name / slug / version / description / url | 1 | `✗ V2 ... missing required key "<key>"` |
| arch / init / image | 1 | 逐键点名 |
| homeassistant / homeassistant_api | 1 | 逐键点名 |
| ingress / ingress_port | 1 | 逐键点名 |
| options / schema | 1 | 逐键点名 |
| **ingress + ingress_port 同删** | 1 | 两条独立 V2，分别点名两键 |
| 基线未变异 | 0 | `✓ 81 checks passed` |

**14/14 全部无条件化**（`validate-app-metadata.mjs:163-167` 为无条件 `check()`；`CONFIG_REQUIRED_KEYS = [...CONFIG_ALLOWED_KEYS]` 派生，无「V8 允许但 V2 不守」的差集）。上轮点名的最小反例全部复现为红灯。对照：`name: 12345` → `✗ V16 ... got number`，exit 1。

### GAP-2 / HI-01 —— 已关闭，守卫在测试路径上

| 观测 | 实测结果 |
|---|---|
| 干净树 `corepack pnpm test:app` | exit **0**，`# tests 53 / # pass 53 / # fail 0` |
| 源 `app.version` → `0.1.9`、不重生成 → `test:app` | exit **1**，`# tests` 完全未出现（`node --test` 未执行）；`Out of date: homeweave_app/config.yaml ... first difference at line 4: expected "version: \"0.1.9\"", found "version: \"0.1.0\""` + `1 artifact(s) out of date` |
| 还原源 → `check:app` | exit **0** |
| 手改产物一行（删 `init: false`）→ `check:app` | exit **1**（点名 config.yaml） |
| 再还原 → `check:app` / `validate:app` | 0 / 0（`✓ 81 checks passed`），两产物 `git status` 零 diff |

机制（观察所得）：`package.json:13` 为 `generate-app-metadata.mjs --check && node --test "scripts/**/*.test.mjs"`，`&&` 短路使漂移态下整套测试不可能通过；`--check` 分支在 `writeLines()` 内读完即 `return`，写盘调用物理不可达。

### 是否削弱既有保证 —— 未发现

- 检查数 58 → **81**，用例 15 → **53**，零减少（实跑）。
- `git diff d48eea3..HEAD -- scripts/ package.json` 的 26 行删除逐条核对：全部是替换/改写（engines、test:app、两处写盘调用改经 `withPortsComment()`、注释、`scalar()` denylist→正向白名单、`writeFileSync`→`writeLines`、旧的 5 键数组）。**无任何 `check(`/`test(`/`assert` 被删除或降级**；无 `.skip`/`.only`/`todo(`/`TODO`/`FIXME`/`TBD`。
- CRLF 归一窄度：`normaliseLineEndings()` 仅 `replace(/\r\n/g, '\n')`；孤立 CR 与其它字节差异照旧触发。实测真实树删一行 → exit 1；另有两条互补用例（纯 CRLF 必须绿 / CRLF 内真实改动必须红）。**归一化没抹平真实编辑。**

### 顺带闭合的旧观察点

- 上轮 truth #1 为 `PRESENT_BEHAVIOR_UNVERIFIED`（无用例 spawn 生成器）；现有 `generate then --check leaves zero residual drift` 与「改源不重生成 → 点名过期产物」两条真链路用例 → **VERIFIED，`behavior_unverified` 归零**。
- 上轮 truth #4 的「精确值无断言（MD-03）」与 truth #7 的「注释块存在性无断言（LO-01）」已由 V17 / V18 补齐并配负例。

### HI-04 —— 判定为**阶段目标内的阻塞缺口**（不是可推迟项）

实测（临时树副本）：

```
maintainer: 42     exit=0  ✓ 81 checks passed
maintainer: null   exit=0  ✓ 81 checks passed
删 maintainer 行    exit=0  ✓ 80 checks passed
url: true          exit=0  ✓ 81 checks passed
删 url 行           exit=0  ✓ 80 checks passed
name: null         exit=1  ✗ V3 "name" must be a non-empty string, got null
```

判定理由：

1. **同一失效类、同一轮交付、同形状**：HI-02 是「生成的 config.yaml 缺键/类型错无人守」，HI-04 是「生成的 repository.yaml 缺键/类型错无人守」，在同一个 `if (has(...))` 结构上是两半。`REPOSITORY_ALLOWED_KEYS`（`:62`）已把三键当仓库契约，却只支撑 V8 的「拒绝多余」，不支撑「要求必需/要求类型」。给一个判阻塞、另一个判可推迟无可辩护依据。
2. **影响面更大且直指目标第一半句**：`repository.yaml` 是整仓清单，`maintainer: 42` 在 Supervisor 侧会让**整个仓库**加载失败 → 一个 app 都不出现，正是「能被识别为有效 App 仓库」的反面。本阶段把静态层声明为 HAOS 验收的唯一替身（Phase 7 才实机），对被守卫的键成立，对 url/maintainer 不成立。
3. **绿灯链路完整**：源侧 `generate-app-metadata.mjs:177-180` 无值校验，故 `generate 0 → check 0 → validate 0` 全绿却产出坏产物（`01-REVIEW.md` 已实测，本轮代码侧确认成因）。
4. **非范围外新工作**：修复面 = 校验器一个 V19 段 + 生成器三行断言 + 三组负例，与 GAP-1 修法同构，无需新决策。

**故 status = gaps_found，score 19/20（truth #9 仍 FAILED —— 它写的是「两个生成物」）。这是本轮唯一阻塞项；GAP-1/GAP-2 不重复计入。**

## 目标倒推检查（沿用上轮 20 条）

| # | Truth | Status | 证据 |
|---|-------|--------|------|
| 1 | D-02 单一来源生效：改源重跑两产物同步；无手工编辑路径 | ✓ VERIFIED（本轮升级） | `generate→check` 零残留用例；本轮实跑：改源 → `test:app` exit 1 点名 config.yaml，还原 → 0，零 diff |
| 2 | 仓根唯一 `repository.yaml`，三字段值正确（APP-03） | ✓ VERIFIED | 内容逐字匹配；全仓仅 1 份；V3/V8 覆盖 name 与多余键 |
| 3 | `config.yaml` 五必填键齐全，arch 恰为 amd64/aarch64 顺序固定 | ✓ VERIFIED（守卫加强） | 14 键无条件断言（本轮 14/14 实跑） |
| 4 | image 全小写无 tag；version 为 `0.1.0` 字符串（D-01a） | ✓ VERIFIED（MD-03 已补） | V17 逐字契约比对 + 3 条负例 |
| 5 | homeassistant = `2026.10.0`（D-03a），HAOS 未验证有标注 | ✓ VERIFIED | 产物一致；V17 锁定；docs/21 §11 保留标注 |
| 6 | options + schema：log_level 三选一、ha_url 可选默认空串 | ✓ VERIFIED | 产物逐字匹配；V11/V12 + 负例；V2 保证两键存在 |
| 7 | 注释态 ports 块存在且无激活 ports 键（D-07） | ✓ VERIFIED（LO-01 已补） | V18 断言两内容片段；解注释→V8、删块→V18，各有负例 |
| 8 | 重跑生成器后两生成物 `git diff` 为空 | ✓ VERIFIED | `generate:app` exit 0，`git status` 零 diff（探针后复确认） |
| 9 | 单一入口判定**两个生成物**的必填/类型/取值 | ✗ FAILED（部分闭合） | config 侧已证；repository 侧 5 种变异全 exit 0（HI-04） |
| 10 | 键白名单：未知键即非零退出 | ✓ VERIFIED | V8 对两文件各一套 + 负例 |
| 11 | image 无 tag/ghcr 前缀；arch 仅 amd64/aarch64 | ✓ VERIFIED | V5/V6 + 负例；V17 追加字面值 |
| 12 | options↔schema 交叉检查 + DSL 字面值 | ✓ VERIFIED | V11/V12 + 负例；DSL 逐字匹配 |
| 13 | 全仓 `config.*` 恰 1 份，跳过点段与 rootfs | ✓ VERIFIED | V15 + 负例；临时树基线未误报 |
| 14 | 收集式失败，退出码只有 0/1 | ✓ VERIFIED | 观测到 `77 checks run, 2 failed` / `80 checks passed` 计数式输出；仅 `process.exitCode = 1` |
| 15 | 每个核心检查 ≥1 负例 | ✓ VERIFIED | 53 例全绿；新增 V2×9 / V16×7 / V17×3 / V18×2（V19 缺口见 gap） |
| 16 | 正向对照：合法临时树 exit 0 | ✓ VERIFIED | `positive control` 用例；本轮基线树 exit 0 |
| 17 | 夹具全在 `os.tmpdir()` 并清理 | ✓ VERIFIED | 本轮探针自建自删；`git status` 仅 `.planning/` 变化 |
| 18 | 负向断言只读退出码与 check code | ✓ VERIFIED | exit code + `✗ <code>` + 消息点名（比上轮更严）；值断言走 js-yaml 回读 |
| 19 | docs/21 §5 ports 注释态（D-07） | ✓ VERIFIED | 与 config.yaml:23-26 一致 |
| 20 | docs/21 §11 HAOS 实机条目（APP-01） | ✓ VERIFIED | 条目存在并标注「HAOS 未验证」 |

**Score:** 19/20（唯一失败项为 truth #9 的 repository 半边；`behavior_unverified: 0`）

## 产物存在性

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | 4 个 app 脚本、engines >=22、仅 js-yaml | ✓ VERIFIED | `generate/validate/check/test:app`；`>=22`；依赖未增 |
| `homeweave_app/app-metadata.json` | 两段式单一数据源 | ✓ VERIFIED | 生成器读、校验器不读（方向正确） |
| `scripts/generate-app-metadata.mjs` | `--check` 只读守卫 + 源 fail-closed | ✓ VERIFIED（repository 值校验缺） | 双模式写入、EOL 归一、双向键白名单、plain-scalar 白名单；`buildRepositoryYaml()` 无值断言 |
| `repository.yaml` | 仓根生成物 | ⚠️ 产物正确、守卫不全 | 当前值合法且唯一；无逐键必需/类型守卫 |
| `homeweave_app/config.yaml` | 14 键 + 注释尾块 | ✓ VERIFIED | 实读一致；V2/V16/V17/V18 全链 |
| `scripts/validate-app-metadata.mjs` | 81 项检查、收集式、0/1 | ✓ VERIFIED（repository 段缺守卫） | V3 仅 name |
| `scripts/__tests__/validate-app-metadata.test.mjs` | 负例 + 正向对照 | ✓ VERIFIED | 全绿 |
| `scripts/__tests__/generate-app-metadata.test.mjs` | 漂移 / fail-closed / scalar / CRLF | ✓ VERIFIED | 17 例，含两条真链路用例 |
| `scripts/__tests__/fixtures.mjs` | 临时树构造器，单一注释拼装点 | ✓ VERIFIED | `withPortsComment()` 单点；`writeExtraConfig()` 有意不带 |
| `docs/21_...DEPLOYMENT.md` | §5 注释态 ports、§11 实机条目 | ✓ VERIFIED | 与产物一致 |

## prohibitions 检查

| Prohibition | 状态 | 证据 |
|---|---|---|
| 不得存在第二份可被递归识别的 `config.*` | ✓ 成立 | 全仓仅 1 份；V15 + 负例；临时树基线未误报 |
| 树内不得出现真实 config 夹具 | ✓ 成立 | 夹具全在 `os.tmpdir()`，探针自删 |
| 测试不得断言引号风格 | ✓ 成立 | 仅 V18 断言两段内容子串；值断言走 js-yaml |
| 不得修改 `examples/*.example` | ✓ 成立 | 本轮 diff 文件列表不含 `examples/` |
| 不得新增依赖 | ✓ 成立 | `devDependencies` 仍恰为 `{ js-yaml }` |

## 需求逐条裁定（APP-01..APP-04）

| Requirement | 静态裁定 | 说明 |
|---|---|---|
| **APP-01** | ⚠️ 未验证（人工） | 静态前提齐备；「Supervisor 识别 + 商店渲染出可安装条目」不可静态证明 → Phase 7 |
| **APP-02** | 部分满足（config 侧守卫已闭合） | arch/ingress/ingress_port/init/homeassistant_api 声明齐备；14 键必填性与类型现由 V2/V16/V17 守住；`watchdog/startup/boot/healthcheck` 依最小字段集决策依赖 Supervisor 默认值（需求解释问题，仍需人工确认）；「schema 校验通过」的静态替身对 config.yaml 成立 |
| **APP-03** | ✓ 静态通过（守卫缺一维） | 三字段值逐字正确、唯一一份；但逐键必需/类型守卫缺失 → 见 gap |
| **APP-04** | ✓ 静态通过 | options/schema/默认值/DSL 正确，V11 交叉检查 + 负例 |

**占位符决策锁定**：全仓占位符扫描为空集（无 `<owner>` 类模板残留）；D-01a/D-02/D-03a/D-04/D-05a/D-07/D-09 均已落进产物或文档。✓ 达成。

## 未验证项与原因（HAOS 侧，归 Phase 7）

1. **Supervisor 实机识别与商店渲染（APP-01 核心）** —— 未验证：无 HAOS 环境，静态层只提供必要条件。
2. **Supervisor schema 实际校验通过（APP-02 后半句）** —— 未验证：本地校验器是复刻（`REMOVE_EXTRA`、`RE_SLUG` 等语义靠研究文档复刻）。
3. **安装/启动/升级路径** —— 未验证：依赖 Phase 2 镜像发布。
4. **`watchdog/startup/boot/healthcheck` 缺失是否符合 APP-02 文字** —— 未验证：需求解释问题，需人工裁定。
5. ~~D-02 单一来源往返行为~~ —— 本轮已由自动化用例覆盖（见 GAP-2），移出未验证清单。

## 下一阶段交接

- **本阶段唯一残留阻塞项（阻断进入下一阶段的静态守卫缺口）**：**HI-04** —— repository.yaml 逐键必需 + 类型守卫（校验器 V19、生成器 `assertNonEmptyString`、三组负例）。
- **非阻断建议**：MD-06（`main()` 单一格式化出口）、MD-07（`optionDefs` 内层键校验）、MD-08（`scalar()` 排除 YAML 保留词）。
- **移交 Phase 7**：上方第 1–4 项未验证内容登记为「HAOS 未验证 / 待实机」证据。
- **Phase 2 提醒**：`check:app` 已进入 `test:app`，CI 只需跑 `corepack pnpm test:app` 即可同时获得静态校验链与漂移守卫；`engines.node >=22` 是 CI 选型的硬约束。

---

_Verified: 2026-10-27T15:35:00Z_
_Verifier: CodeBuddy (gsd-verifier)_

## ISSUES FOUND
