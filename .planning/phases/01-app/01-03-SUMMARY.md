---
phase: 01-app
plan: 03
subsystem: infra
tags: [home-assistant, supervisor, validator, node-test, negative-testing, yaml, pnpm, docs]

requires:
  - "01-02 的校验器与输出契约：`✗ <code> <file>: <message>`、`✓ <n> checks passed`、退出码仅 0/1、收集式 failures（不 fail-fast）"
  - "校验器以 process.cwd() 拼出 CONFIG_PATH / REPOSITORY_PATH —— 这是测试用 cwd 注入的前提"
  - "01-01/01-02 落盘的两个生成物（repository.yaml、homeweave_app/config.yaml）作为合法基线"
provides:
  - "`pnpm test:app`：15 个 node:test 用例的反例证明层（零新增依赖）"
  - "scripts/__tests__/fixtures.mjs：os.tmpdir() 临时树构造器（合法基线 + 变异 + cleanup）"
  - "可复用的测试契约：夹具根必须来自 mkdtempSync；断言三元组 = 退出码 1 / 退出码非 null / stdout 含 check code"
  - "docs/21 §5 注释态 ports（D-07 在文档侧一致）与 §11 的 HAOS 实机验证条目（APP-01 书面落点）"
affects: [02 CI 门禁, 05 Ingress 端口开放, 07 实机验证清单]

actuals:
  tokens: 4296
  tasks: 3
  commits: 3

plan_head_before: 7519f134d43bb4feed25cd24cfa076ac6294bb74
plan_head_after: a780674e674c95b942d61cb5429778d490637a6f

tech-stack:
  added: []
  patterns:
    - "反例证明：每个关键检查配一个只违反该检查的合法变体，断言退出码恰为 1 且命中预期 code；另配正向对照排除『恒失败』"
    - "cwd 注入代替改代码：spawnSync(process.execPath, [validator], { cwd: tempRoot }) 让被测文件保持与 CI 完全一致"
    - "夹具全部落 fs.mkdtempSync(path.join(os.tmpdir(), 'hw-app-'))，t.after 递归删除；收尾门在仓库根复跑校验器断言 exit 0"
    - "正向/反向成对用例：V15（双份 config 必败 / 点目录与 rootfs 必过）、V11（缺默认值必败 / 可选键必过），防实现过松或过严"
    - "断言只读退出码与 check code，从不断言 YAML 引号风格或原文片段"

key-files:
  created:
    - scripts/__tests__/fixtures.mjs
    - scripts/__tests__/validate-app-metadata.test.mjs
  modified:
    - package.json
    - docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md

key-decisions:
  - "test:app 用 glob 形式 `node --test \"scripts/**/*.test.mjs\"`，而非计划写的 `node --test scripts/`：后者在本机 Node 22.17 + win32 下把目录当成单个测试文件执行并报 MODULE_NOT_FOUND（实测 exit 1）"
  - "fixtures.mjs 手写 YAML 序列化器而非用 js-yaml dump：行尾与转义完全可控（显式 \\n），且变异只改解析后的对象、不做字符串替换 —— 从机制上排除对引号风格的隐式依赖"
  - "夹具模块只导出函数、不注册 test()，因此 `node --test` 的默认匹配（*.test.mjs）不会把它当用例执行"
  - "V15 负向例把第二份 config 放在 nested/ 而非 homeweave_app/ 内，确保只触发唯一性检查、不污染被读取的那份 config"
  - "V13 只改 repository.yaml 的 url 值、保留三键结构，避免同时触发 V3 掩盖信号；断言用『V13 出现在输出中』而非『唯一失败项』，因为校验器刻意不 fail-fast"
  - "收尾门用 REPO_ROOT（由 import.meta.url 推导）而非 process.cwd() 作为仓库根，避免受测试运行目录影响"
  - "docs/21 §5 只把 ports 两行加 `# ` 前缀并在注意列表补一条 D-07 说明，不重写整节、不动 §7 的条件式表述（条件式与注释态并不矛盾）"

patterns-established:
  - "负向断言统一走 assertDetects(result, code, label) 辅助函数：status 非 null → status === 1 → stdout 匹配 `✗ <code> `"
  - "夹具变异的唯一入口是 writeConfig(root, mutate) / writeRepository(root, mutate)，mutate 收到 structuredClone 后的对象"

requirements-completed: [APP-01]
requirements-deferred: [APP-01 的实机判定部分]

coverage:
  - id: D1
    description: "校验器对已知坏输入确实非零退出（V2 五键、V5、V6、V8、V11、V13、V15 各有独立负向例）"
    requirement: APP-02
    verification:
      - kind: other
        ref: "corepack pnpm test:app → exit 0, # tests 15 / # pass 15 / # fail 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "校验器对合法输入退出 0（正向对照 + V15 跳过语义 + V11 可选键三例），排除恒失败"
    requirement: APP-02
    verification:
      - kind: other
        ref: "test:app 内的 positive control / V15 skip semantics / V11 optional 三例均断言 status === 0 且 stdout 含 checks passed"
        status: pass
    human_judgment: false
  - id: D3
    description: "夹具零泄漏：测试跑完后全仓 config 候选数仍为 1，且仓库根复跑校验器退出 0"
    requirement: APP-02
    verification:
      - kind: other
        ref: "node %TEMP%\\hw-p0103-checks.mjs → CONFIG_COUNT 1 paths=homeweave_app/config.yaml, exit 0"
        status: pass
      - kind: other
        ref: "test:app 的 closing gate 用例（cwd = 仓库根）→ exit 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/21 §5 的 ports 处于注释态并附 D-07 理由；§11 含确切 URL、预期结果与未验证标注"
    requirement: APP-01
    verification:
      - kind: other
        ref: "node %TEMP%\\hw-p0103-docs.mjs → S5_PORTS OK live=0 commented=1 note_d07=true；S11_CHECKLIST OK url/label/expect 均 true, exit 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "『在 HAOS 添加仓库并看到 HomeWeave 条目』是否真的成立"
    requirement: APP-01
    verification: []
    human_judgment: true
    rationale: "本计划只把该条写进清单并标注未验证，没有任何实机证据；不得由文档条目代签。归 Phase 7 实机验证。"

duration: ~4min
completed: 2026-10-27
status: complete
---

# Phase 1 Plan 03: 负向测试证据层与两条文档契约 Summary

**把 V1–V15 从「未被证伪的断言」变成「已证伪的反例」：15 个 node:test 用例对 7 类关键检查各建一个只违反该项的合法变体，断言`✗ <code>` 与退出码 1，并用三个 `status === 0` 的正向例排除「恒失败」这一相反的退化情形；同时把 `docs/21` §5 的 `ports` 改回注释态（对齐 D-07），§11 写入带确切 URL 与「HAOS 未验证」标注的实机条目**

## Performance

- **Duration:** ~4 min（可核验窗口：首个任务提交 2026-10-27T14:20:17+08:00 → 末个任务提交 14:21:13+08:00）
- **Completed:** 2026-10-27
- **Tasks:** 3/3
- **Files modified:** 4（2 新增、2 修改）
- **Commits (measured):** 3（`git rev-list --count 7519f13..a780674`；本 SUMMARY 的 docs 提交另计）
- **actuals.tokens 口径：** 实际改动字符数 / 4 —— `fixtures.mjs` 5,834 字节 + `validate-app-metadata.test.mjs` 10,104 字节 + package.json 与 docs 改动约 1,245 字符 ≈ 17,183 字符 / 4 ≈ 4,296 tokens。计划 `estimate.tokens` 为 52,000，实际约为其 1/12。偏差来源与 01-02 相同：估算把「读 PLAN/PATTERNS/VALIDATION 上下文」的成本算进产出规模，而产出只有两个测试文件与四处文档行。按原样记录，不做取整美化。

## Accomplishments

- **反例证明层成立**：`corepack pnpm test:app` → `# tests 15 / # pass 15 / # fail 0`，退出码 0。覆盖 V2（五个必填键各自独立成例）、V5（arch 含 i386）、V6（image 带 tag）、V8（`ingresss` 拼错键）、V11（缺默认值 / 可选键两侧）、V13（尖括号 owner 占位）、V15（nested/ 下第二份 config）。
- **正向对照先行且真实生效**：第一个用例是「完全合法的临时树 → exit 0 且输出含 `checks passed`」。没有它，上列失败可能来自一个恒返回 1 的校验器。
- **V15 成对用例**：`nested/config.yaml` 必败，`.hidden/` 与 `rootfs/` 内的 config.yaml 必过。跳过清单若写反方向，第一例仍然绿而第二例会红 —— 这是唯一能让「跳过语义」也可证伪的构造。
- **夹具零泄漏由两道独立门证明**：其一，测试套件最后一条用例以仓库根为 cwd 复跑校验器断言 exit 0；其二，套件跑完后独立复算全仓 `config.(yaml|yml|json)` 候选数仍为 `CONFIG_COUNT 1 paths=homeweave_app/config.yaml`。
- **零新增依赖**：`devDependencies` 仍恰为 `{ js-yaml }`；测试只用 `node:test`、`node:assert/strict`、`node:fs`、`node:os`、`node:path`、`node:child_process`、`node:url`。
- **`docs/21` §5 ports 回归注释态**：`ports:` 与 `8124/tcp: 8124` 两行加 `# ` 前缀，并在注意列表补一条说明「Phase 5 之前保持注释；对外开放宿主机端口需先有独立认证与授权（D-07、S2）」。§7 关于「如果暴露 `8124/tcp`」的条件式条款未动 —— 条件式与注释态并不矛盾。
- **§11 实机条目落地 ROADMAP 成功标准 5**：含确切仓库 URL `https://github.com/Zee1988/homeweave`、预期可见结果（Apps 列表出现 `HomeWeave` 条目且能打开详情页）、操作路径（设置 → 加载项商店 → 右上角仓库 → 添加 URL → 刷新），并显式标注 **未在 HAOS 实机验证 / HAOS 未验证**。

**验证结论等级：静态自证通过 / HAOS 未验证。** 本计划证明的是「校验器能检出已知坏输入」（自证类），不证明 Supervisor 会接受这份配置 —— `vol.Schema` 的 `RE_SLUG`、`version_tag`、`docker_image` 语义只能运行时裁决。§11 那条实机条目的存在本身就是「承认未验证」。

## Task Commits

Each task was committed atomically:

1. **Task 1: 临时树夹具与首组负向用例（V2 ×5、V5、V6、V8）+ 正向对照** - `e8355a5` (feat)
2. **Task 2: 结构类与方法面负向用例（V15 两侧、V13、V11 两侧）+ 夹具不泄漏收尾门** - `7434152` (test)
3. **Task 3: docs/21 §5 注释态 ports + §11 HAOS 实机条目** - `a780674` (docs)

**Plan metadata:** 本 SUMMARY 与 STATE/ROADMAP 的 docs 提交另计，不在上面 3 个内。

用例数演进：任务 1 后 9 个用例 → 任务 2 后 15 个。

## Files Created/Modified

- `scripts/__tests__/fixtures.mjs`（新增，5.8 KB）- 只导出函数，不注册 `test()`。导出 `VALID_CONFIG`/`VALID_REPOSITORY`（镜像两个生成物的合法基线）、`makeValidTree()`、`writeConfig()`、`writeRepository()`、`writeExtraConfig()`、`runValidator()`、`cleanup()`、`toYaml()`、`VALIDATOR_PATH`、`REPO_ROOT`。文件头写明两条理由：为什么夹具必须落 `os.tmpdir()`（否则 V15 把夹具当第二份 config），以及为什么用 cwd 注入而不改校验器。
- `scripts/__tests__/validate-app-metadata.test.mjs`（新增，10.1 KB）- 15 个 `test()`；`assertDetects()` 辅助函数统一三元断言（非 null / 1 / 含 code）。
- `package.json`（修改）- 追加 `"test:app"`；`generate:app`、`validate:app`、`devDependencies` 未动。
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`（修改，+4/−2）- §5 两行注释化 + 一条注意项；§11 一条实机条目。`git diff --numstat` 为 `4 2`，即改动严格限于这两节。

## Decisions Made

- **`test:app` 用 glob 而非目录参数**：计划写的 `node --test scripts/` 在本机实测 exit 1，报 `MODULE_NOT_FOUND`（Node 22.17 + win32 把目录当成单个测试文件执行）。改为 `node --test "scripts/**/*.test.mjs"`（Node ≥22.6 原生支持 glob），实测 15/15 通过。计划里写的命令是**本机不可执行**的，这属于必须偏离的字面项，不改就无法满足 `pnpm test:app` 退出 0 的验收条件。
- **手写 YAML 序列化器**：`toYaml()` 用数组 join('\n') 生成文本，显式控制行尾与引号触发条件，不依赖 `js-yaml.dump`。变异一律作用于解析后的对象，从机制上排除「字符串替换 → 隐式依赖引号风格」这条假失败路径。
- **V15 负向例的第二份 config 放 `nested/`**：放在 `homeweave_app/` 内会与「被读取的那份」混淆，无法把失败归因到唯一性检查。
- **V13 断言用「code 出现」而非「唯一失败项」**：校验器刻意不 fail-fast，多 code 并存是设计行为；断言唯一性会把设计特性当成 bug。
- **收尾门取 `REPO_ROOT`（`import.meta.url` 推导）**：避免测试运行目录变化导致「在临时树里复跑」的假绿。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 计划的 `test:app` 命令在本机不可执行**
- **Found during:** Task 1 首次运行 `corepack pnpm test:app`
- **Issue:** `node --test scripts/` 在 Node 22.17 + win32 下把 `scripts/` 当作单个测试文件去 require，报 `MODULE_NOT_FOUND`，`# pass 0 / # fail 1`，exit 1。
- **Fix:** 改为 `node --test "scripts/**/*.test.mjs"`。实测 `# tests 15 / # pass 15 / # fail 0`。
- **Files modified:** `package.json`
- **Verification:** `corepack pnpm test:app` exit 0；`SCRIPTS OK scripts=generate:app|test:app|validate:app devDeps=js-yaml`。
- **Committed in:** `e8355a5`

**2. [Rule 1 - Bug] fixtures.mjs 首版在 ESM 里写了 `require('node:os')`**
- **Found during:** Task 1 写入后的自查（提交前）
- **Issue:** ESM 模块内无 `require`，`makeValidTree()` 会在运行时抛 `ReferenceError`。
- **Fix:** 改为顶部 `import { tmpdir } from 'node:os'` 并使用 `tmpdir()`。
- **Files modified:** `scripts/__tests__/fixtures.mjs`
- **Verification:** 首次运行即 9/9 通过。
- **Committed in:** `e8355a5`（该错误从未进入提交）

### 计划代码号与实际校验器代码的对照

计划正文引用的 code（V2/V5/V6/V8/V11/V13/V15）与 `scripts/validate-app-metadata.mjs` 的**实际**实现逐项核对一致，无需改名。核对中确认的两处细节：

- V13 的占位符字面量表包含 `<owner>`、`<repo>`、`<maintainer name or contact>`、`tree/main` 四项；本计划用到的是 `<owner>`。
- V15 的跳过清单是「任一点开头路径段 + `rootfs` + 本地豁免 `node_modules`」，且要求命中数恰为 1 **并且** 路径等于 `homeweave_app/config.yaml`（两条独立 `check()`）。本计划的跳过语义对照例只覆盖点段与 `rootfs`，未覆盖 `node_modules`（夹具里造 `node_modules` 会误导读者以为那是 Supervisor 规则）。

---

**Total deviations:** 2 auto-fixed（均为本机不可执行/写错的 bug，其一未进入历史）。
**Impact on plan:** 无范围扩张、无新增依赖、无新增文件；`files_modified` 与计划前置声明一致。

## Issues Encountered

- **`gsd_run` SDK 命令行在本机不存在**：`Get-Command gsd_run` 返回 $null。因此 STATE.md / ROADMAP.md 的推进改用直接编辑完成，提交用原生 `git commit`。与 01-02 记录的环境事实相同，`state advance-plan` / `roadmap update-plan-progress` 的自动化边角处理由人工判断代替。
- **在 `master` 上提交**：`.planning/config.json` 为 `git.branching_strategy: "none"`，且本次为顺序执行（`SEQUENTIAL=true`，主工作树、无 worktree、无分支）。01-01 与 01-02 的提交同样落在 `master`，按项目既有模式继续。
- **shell 是混合体**：多数命令走 PowerShell 5.1，但只要命令行里出现 `%TEMP%` 这类 cmd 语法就会被交给 cmd.exe 执行，`Select-Object` 于是报「不是内部或外部命令」。规避方式：统一用 `$env:TEMP` 与 PowerShell 管道。含引号/正则的判定一律写进 `%TEMP%` 下的临时 `.mjs` 脚本再执行（`hw-p0103-checks.mjs`、`hw-p0103-docs.mjs`），与 01-02 的教训一致。
- **`docs/21` 行尾警告**：`git add` 时出现 `LF will be replaced by CRLF the next time Git touches it`。实测工作树文件为 178 个 `\n`、0 个 `\r\n`，即全文件一致为 LF（不是我的编辑造成的混合行尾），该警告来自 `core.autocrlf`。`git diff --numstat` 为 `4 2`，diff 未出现整文件行尾翻转。
- **CRLF/LF 与夹具**：夹具一律由 `toYaml()` 生成 `\n`，不依赖平台默认行尾，因此 win32 上不会给基于行解析的断言带来噪声。

## User Setup Required

None - no external service configuration required, no package installed.

## Threat Flags

无新增计划外攻击面。计划内威胁处置执行情况：

| Threat ID | 处置 | 本计划落地证据 |
|---|---|---|
| T-01-09（夹具泄漏进仓库，high） | mitigate | 全部夹具经 `mkdtempSync(join(tmpdir(),'hw-app-'))`；`t.after(() => cleanup(root))` 递归删除；双门验证：closing gate（仓库根 exit 0）+ 独立复算 `CONFIG_COUNT 1` |
| T-01-10（断言引号风格致假失败，high） | mitigate | 断言只读退出码与 check code；变异走 `structuredClone` 后的对象；序列化器显式决定引号，测试从不比较引号字面量 |
| T-01-11（spawn 失败被误判为检出，medium） | mitigate | `assertDetects` 与三条正向例都先断言 `status !== null` |
| T-01-12（§5 ports 与 D-07 漂移，high） | mitigate | §5 两行注释化 + 注意项；自动门 `S5_PORTS OK live=0 commented=1 note_d07=true` |
| T-01-13（实机条目缺失或标注含糊，medium） | mitigate | `S11_CHECKLIST OK url=true label=true expect=true`；条目同时含 `未在 HAOS 实机验证` 与 `HAOS 未验证` 两种表述，且显式写「不得据此认为仓库已被 Supervisor 识别」 |
| T-01-SC（测试引入依赖扩大供应链面，high） | mitigate | 零新增包；`SCRIPTS OK ... devDeps=js-yaml` 每次套件运行前复核 |

## Known Stubs

无。测试不返回占位值，无 `TODO`/`FIXME`，全部用例都在真实临时树上跑真实校验器。两处**有意保留**的未验证项已在上文标注，不构成 stub：

- Supervisor 是否接受这份 metadata → HAOS 未验证（运行时裁决）。
- 「在 HAOS 添加仓库并看到 HomeWeave 条目」→ 仅写入清单，无实机证据。

## Next Phase Readiness

- **Phase 2 的 CI 门禁可直接串联**：`corepack pnpm validate:app && corepack pnpm test:app`（两者在仓根执行、均以退出码为唯一信号、不依赖 Docker）。注意 `test:app` 的 closing gate 用例以仓库根为 cwd，CI 必须在仓根调用。
- **端口开放门槛**：`8124/tcp` 在生成物与 `docs/21` §5 两侧均为注释态，仅 Phase 5 交付自身认证/授权后才允许解除，且解除时须同步更新 §5 与 D-07 记录。
- **Phase 7 的实机清单已有书面落点**：`docs/21` §11 那条条目 + 本 SUMMARY 的 D5（`human_judgment: true`）。
- **REQUIREMENTS 的处理说明**：APP-01 的**文档侧**要求（「实机条目存在且明确标注未验证」）已由本计划完成；其**判定侧**（「Supervisor 确实识别出 HomeWeave 条目」）仍无实机证据，因此在 REQUIREMENTS.md 中不勾选 APP-01 为完成，而是保持未完成并注明「书面条目已就位，实机判定归 Phase 7」。APP-02 的负向证明部分由本计划补齐，但该需求在 01-02 已勾选，本次不重复改动。

---

*Phase: 01-app*
*Completed: 2026-10-27*

## Self-Check: PASSED

- `scripts/__tests__/fixtures.mjs` — FOUND
- `scripts/__tests__/validate-app-metadata.test.mjs` — FOUND
- `.planning/phases/01-app/01-03-SUMMARY.md` — FOUND
- commit `e8355a5` — FOUND (ancestor of HEAD)
- commit `7434152` — FOUND (ancestor of HEAD)
- commit `a780674` — FOUND (ancestor of HEAD)
