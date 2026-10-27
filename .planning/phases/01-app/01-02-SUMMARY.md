---
phase: 01-app
plan: 02
subsystem: infra
tags: [home-assistant, supervisor, validator, yaml, pnpm, esm, static-analysis]

requires:
  - "01-01 的两个生成物：repository.yaml（仓根 3 键）与 homeweave_app/config.yaml（14 键固定键序）"
  - "仓根 package.json + devDependency js-yaml 4.3.2（不新增任何依赖）"
provides:
  - "scripts/validate-app-metadata.mjs：V1–V6、V8–V15 的收集式校验器（V7 并入 V6）"
  - "唯一入口 `pnpm validate:app`，Phase 2 CI 直接复用（D-06）"
  - "常量 CONFIG_ALLOWED_KEYS（14 键）、REPOSITORY_ALLOWED_KEYS（3 键）供 plan 01-03 注入负向测试"
  - "输出契约：`✗ <code> <file>: <message>` 与 `✓ <n> checks passed`；退出码仅 0/1"
affects: [01-03 负向测试, 02 CI 门禁, 05 Ingress 字段复核, 06 options 扩展]

actuals:
  tokens: 3971
  tasks: 3
  commits: 3

plan_head_before: dbbeba7cd9684e21ec61d39b7ed5fbd6795fa187
plan_head_after: cb970a06c03bedd8bf30dd5653da0f71cdaa71ae

tech-stack:
  added: []
  patterns:
    - "收集式校验：`failures` 数组 + `check(ok, code, file, message)`，末尾统一打印后置 process.exitCode，全程无提前 return"
    - "断言基于 js-yaml 解析后的值类型与集合，不做源码字符串匹配 —— 引号风格不是契约"
    - "键白名单以 Set 常量表达，未知键即失败：补偿 Supervisor 的 extra=vol.REMOVE_EXTRA 静默丢弃"
    - "递归遍历用 node:fs readdirSync({withFileTypes}) 手写，跳过点段/rootfs（Supervisor 规则）与 node_modules（本地豁免，注释标明不是 Supervisor 规则）"

key-files:
  created:
    - scripts/validate-app-metadata.mjs
  modified:
    - package.json

key-decisions:
  - "V7 不设独立 code：image 已被 V6 断言为不带 tag，则 tag 与 version 的 mismatch 不可能存在，单列一条 code 会得到一条永远无事可做的检查"
  - "键白名单用 Set 常量而非硬编码黑名单数组：D-07 的『不写哪些键』与『允许哪些键』因此只有一处维护点，不会出现两处漂移"
  - "V8 只对实际出现的键做差集，不反向要求 14 个允许键全部存在：必填性由 V2 负责，两处职责不重叠"
  - "V13 扫描范围硬编码为两个生成物：examples/*.example 刻意保留 <owner>/<repo> 通用占位（examples/README.md），扫全仓会让该检查恒失败"
  - "V14 对缺失 url 不判失败（url 是可选项），但一旦出现 /tree/<branch> 就必须是 master —— 落实 D-01『模板里的 main 会 404』"
  - "V15 的 node_modules 豁免在代码注释里明确写为本地假阳性防护，并说明它不可能掩盖真实第二个 App（App 只存在于受版本控制的目录中）"
  - "checksRun 由 check() 逐次自增（而非写死数字），汇总行因此随实现增长：任务 1 结束时 8 项，任务 2 后 47 项，任务 3 后 58 项"

patterns-established:
  - "失败行格式 `✗ <Vn> <relative-file>: <message>`；成功汇总 `✓ <n> checks passed`；失败汇总 `<n> checks run, <m> failed`（成功与失败汇总用不同措辞，避免失败时也出现 'checks passed'）"
  - "路径常量集中在文件顶部：CONFIG_PATH / REPOSITORY_PATH 由 process.cwd() + join 拼出，仓库内任何位置运行都不会写入绝对路径"
  - "读盘与解析错误也走 failures（V1），不抛栈；对不可读目录与坏符号链接 try/catch 跳过"

requirements-completed: [APP-02, APP-03, APP-04]

coverage:
  - id: D1
    description: "单一入口 `pnpm validate:app` 判定两个生成物是否满足必填字段、类型与取值约束"
    requirement: APP-02
    verification:
      - kind: other
        ref: "corepack pnpm validate:app  (exit 0, stdout '✓ 58 checks passed')"
        status: pass
      - kind: other
        ref: "node ~/AppData/Local/Temp/hw-audit.mjs  (AUDIT_OK, exit 0: 15 项源码/入口断言全 PASS)"
        status: pass
    human_judgment: false
  - id: D2
    description: "键白名单使拼错键（如 ingresss）在本地即失败，而不是被 Supervisor 静默丢弃"
    requirement: APP-03
    verification:
      - kind: other
        ref: "node ~/AppData/Local/Temp/hw-negative.mjs → PASS unknown-key exit=1 expected=V8"
        status: pass
      - kind: other
        ref: "同套件 multi-failure: 单次运行同时报出 V5+V6+V8（证明无 fail-fast）"
        status: pass
    human_judgment: false
  - id: D3
    description: "全仓只有一份 Supervisor 可递归识别的 config.*，且路径为 homeweave_app/config.yaml"
    requirement: APP-02
    verification:
      - kind: other
        ref: "node ~/AppData/Local/Temp/hw-config-count.mjs  (CONFIG_COUNT 1, CONFIG_PATHS homeweave_app/config.yaml, exit 0)"
        status: pass
      - kind: other
        ref: "hw-negative.mjs → PASS second-config exit=1 expected=V15"
        status: pass
    human_judgment: false
  - id: D4
    description: "options/schema 双向一致：schema 键有默认值或以 ? 结尾，options 键均已声明"
    requirement: APP-04
    verification:
      - kind: other
        ref: "corepack pnpm validate:app  V11/V12 对当前 options{log_level,ha_url} 与 schema{log_level:list(info|debug|warn),ha_url:str?} 通过"
        status: pass
    human_judgment: false
  - id: D5
    description: "Supervisor 自身是否接受这份 metadata（vol.Schema 的 RE_SLUG / version_tag / docker_image 实际语义）"
    requirement: APP-03
    verification: []
    human_judgment: true
    rationale: "只能由 Supervisor 运行时裁决，本机无 HAOS 实机，归 Phase 7 实机验证清单；不得由静态校验代签。"

duration: ~10min
completed: 2026-10-27
status: complete
---

# Phase 1 Plan 02: 静态元数据校验器（`pnpm validate:app`）Summary

**一份只依赖 js-yaml 的收集式校验器，把 V1–V6、V8–V15 共 14 类断言与「全仓只有一份 config.\*」的唯一性检查收进单一入口 `pnpm validate:app`；当前树 58 项检查全通过，退出码只有 0 与 1**

## Performance

- **Duration:** ~10 min（近似值；会话起点未打时间戳。可核验的提交窗口：2026-10-27T14:14:31+08:00 → 2026-10-27T14:17:29+08:00）
- **Completed:** 2026-10-27
- **Tasks:** 3/3
- **Files modified:** 2（1 新增、1 修改）
- **Commits (measured):** 3（`git rev-list --count dbbeba7..cb970a0`；本次 docs 提交另计）
- **actuals.tokens 口径说明：** 按实现完成后的 diff 字符数 / 4 计（`scripts/validate-app-metadata.mjs` 15,885 字节 + package.json 一行 ≈ 3,971 tokens）。计划 `estimate.tokens` 为 62,000，实际不到其 1/15 —— 估算把「读 RESEARCH/PATTERNS 上下文」的成本算进了产出规模，而本计划最终只有一个文件。这条偏差按原样记录，不做取整美化。

## Accomplishments

- `pnpm validate:app` 成为 Phase 1 的唯一校验入口（D-06）：退出码仅 0/1，纯文本输出，不引 reporter、不装 Docker，`corepack pnpm validate:app` 秒级返回 `✓ 58 checks passed`。
- **键白名单（V8）落地为本阶段最高价值检查**：`CONFIG_ALLOWED_KEYS` 恰含 14 键、`REPOSITORY_ALLOWED_KEYS` 恰含 3 键。Supervisor 的 schema 用 `extra=vol.REMOVE_EXTRA`，未知键被静默丢弃——这条断言是唯一能让 `ingresss` 这类拼写错误在本地就失败的手段。
- **唯一性断言（V15）把 ROADMAP 成功标准 2 从人工评审升级为自动化**：手写递归遍历照译 Supervisor 的 `path.glob("**/config.*")` 过滤语义（跳过任一点开头路径段、跳过 `rootfs`），命中数须恰为 1 且路径须等于 `homeweave_app/config.yaml`。
- **引号风格禁令被执行**：全部断言都在 js-yaml 解析后的值上做，`version` 断言的是「解析后为 string 且形如 x.y.z」，无论单双引号；审计脚本 `QUOTE_ASSERT_OK` 证明源码中不存在 `quotingType` 或 `'0.1.0'`/`"0.1.0"` 字面量断言。
- **零新增依赖**：`devDependencies` 仍恰为 `{ js-yaml }`，遍历用 `node:fs`/`node:path` 内置模块；审计断言拒绝 `globby`/`fast-glob`（UNIQ_OK）。
- **单次运行可同时报出多条失败**：临时夹具里同时破坏 arch、image、未知键三项，一次运行输出 V5+V6+V8 三条失败并 exit 1，证明没有 fail-fast 提前返回。

**验证结论等级：静态校验通过 / Supervisor 实际接受度 HAOS 未验证。** 本计划只能证明「两份生成物符合我们在仓内维护的字段契约、且仓内只有一份会被识别的 config 文件」；`vol.Schema` 的 `RE_SLUG`、`version_tag`、`docker_image` 真实语义无法静态证明，任何「Supervisor 会接受」的表述均须标注未验证。

## Task Commits

Each task was committed atomically:

1. **Task 1: 校验器骨架 + 唯一入口（V1–V3）** - `4342bde` (feat)
2. **Task 2: 类型/枚举/键白名单/options-schema 交叉（V4–V12）** - `50f53a3` (feat)
3. **Task 3: 占位符、分支与全仓 config 唯一性（V13–V15）** - `cb970a0` (feat)

**Plan metadata:** 本 SUMMARY 的 docs 提交（另计，不包含在上面 3 个内）

检查数随任务递增：任务 1 后 8 项 → 任务 2 后 47 项 → 任务 3 后 58 项。数字由 `check()` 逐次自增计算，未写死。

## Files Created/Modified

- `scripts/validate-app-metadata.mjs`（新增，466 行量级）- ESM、无 shebang、无 `process.exit(`，只用 `process.exitCode`。结构：路径常量 → `fail/check/describe/readAndParse` 工具 → V1–V15 顺序断言 → 统一报告。文件头注释写明字段清单来源 `contributors.home-assistant.io` 且**须随官方变更核对**（D-04 自写实现的代价）。
- `package.json`（修改）- 只增加一项 `"validate:app": "node scripts/validate-app-metadata.mjs"`；`generate:app` 与 `devDependencies` 未动。

## Decisions Made

- **V7 并入 V6，不设独立 code**：image 已被断言为不带 tag，则「tag 与 version mismatch」不可能发生；单列 code 只会得到一条永远无事可做的检查。
- **白名单只做正向差集，不反向要求 14 键全在**：必填性归 V2，避免两处检查职责重叠、报出重复失败。
- **`check()` 统一计数**：无论通过与否都自增 `checksRun`，因此汇总行是「实际执行的检查数」而不是「通过数」，失败运行也有可信分母（`<n> checks run, <m> failed`）。
- **成功与失败汇总用不同措辞**：成功才打印 `✓ <n> checks passed`，失败打印 `<n> checks run, <m> failed`，避免失败时输出里也出现 "checks passed" 这类可被误读为通过的字符串。
- **V13 扫描范围写死为两个生成物**：`examples/*.example` 保留 `<owner>`/`<repo>` 是有意的（`examples/README.md` 第 5 行），扫全仓会让该检查恒失败。
- **V14 对缺失 url 放行**：`url` 是可选键，缺失不判失败；但一旦出现 `/tree/<branch>`，branch 必须是 `master`。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 首次写入 Task 2 时残留一个无意义辅助函数 `models_placeholder`**
- **Found during:** Task 2 自检（提交前）
- **Issue:** V6 首行误留了一个把已算好的布尔值再包一层的辅助函数，逻辑等价但纯噪声，会让后续维护者误以为其中还有第二套 tag 判断。
- **Fix:** 直接改为 `check(isUsableString, ...)` 并删除该函数；行为零变化。
- **Files modified:** `scripts/validate-app-metadata.mjs`
- **Verification:** 删除后 `corepack pnpm validate:app` 仍 exit 0、`✓ 47 checks passed`，随后进入 `50f53a3`。
- **Committed in:** `50f53a3`（该函数从未进入任何提交，属提交前清理）

---

**Total deviations:** 1 auto-fixed（bug，且未进入历史）。
**Impact on plan:** 无范围扩张、无取值变更、无新增文件。

## Issues Encountered

- **本机无 `gsd_run`（SDK 命令行不可用）**：`Get-Command gsd_run` 返回不存在。因此 STATE.md / ROADMAP.md 的推进改用直接编辑完成，`commit` 用原生 `git commit`。这不改变计划语义，但意味着 `state advance-plan` / `roadmap update-plan-progress` 的自动化边角处理（如末计划边界）由人工判断代替。
- **在 `master` 上提交**：`.planning/config.json` 为 `git.branching_strategy: "none"` 且本次为顺序执行（顺序模式、无 worktree），plan 01-01 的 3 个提交同样落在 `master`。按项目既有模式继续，未新建分支。若后续启用分支策略，这批提交需要重挂。
- **PowerShell 5.1 会吃掉 `node -e` 里的引号**：计划 Task 2 的第三项 `<automated>`（`includes('"0.1.0"')` 正则）在 PowerShell 下被改写导致 `SyntaxError: Invalid regular expression`，退出码 1 —— 这是**命令写法失败**，不是断言失败。改用仓外临时脚本 `%TEMP%\hw-quote-check.mjs` 承载同一判定后得 `QUOTE_ASSERT_OK`、exit 0。凡含引号或正则的 `node -e` 在本机都应按此处理。
- **负向验收夹具自身的 bug（已修）**：第一版夹具脚本在写入文件**之前**调用 mutate，导致 `cpSync` 找不到源文件而 ENOENT。修正为「先写基线文件 → 再 mutate → 重写」后全套通过。这只影响我的临时工具，不影响校验器。
- **`process.cwd()` 依赖**：校验器与负向夹具都以 cwd 为根。在仓外目录运行时，若该目录没有 `homeweave_app/config.yaml`，会得到 V1 失败而不是自动定位仓库根 —— 这是刻意的（避免猜测仓库根），Phase 2 的 CI 必须在仓根调用 `pnpm validate:app`。
- **未跟踪文件**：工作树里 `?? .planning/.tmp/`、`?? .planning/state.json` 在本计划开始前已存在，非本计划产物，未纳入提交。

## User Setup Required

None - no external service configuration required.

## Threat Flags

无新增计划外攻击面。计划内威胁处置执行情况：

| Threat ID | 处置 | 本计划落地证据 |
|---|---|---|
| T-01-05（键白名单，high） | mitigate | V8 覆盖 config 全部 14 个允许键 + repository 3 键；负向夹具 `unknown-key` 以 V8 退出 1 |
| T-01-06（唯一性扫描，high） | mitigate | V15 递归 + 点段/rootfs 跳过 + 命中数恰为 1 且路径等值；负向夹具 `second-config` 以 V15 退出 1；独立复算 `CONFIG_COUNT 1` |
| T-01-07（遍历 DoS，low） | accept | `try/catch` 跳过不可读目录与坏链接，`MAX_DEPTH = 12` 防环；本地开发命令，不面向网络 |
| T-01-08（失败被吞，medium） | mitigate | `failures` 数组 + 末尾统一置 `process.exitCode`；`multi-failure` 单次运行报出 V5+V6+V8；源码无 `process.exit(` |
| T-01-SC（依赖面，high） | mitigate | 审计断言 `devDependencies` 恰为 `{ js-yaml }`、遍历零第三方 glob 库（`UNIQ_OK`） |

## Known Stubs

无。校验器不返回占位值、无 TODO/FIXME 标记，所有断言都在真实读盘的生成物上执行。`examples/home-assistant-app/*.example` 保留 `<owner>` 类占位是**有意设计**（`examples/README.md`），且被 V13 的扫描范围显式排除，不构成 stub。

## Next Phase Readiness

- **plan 01-03（负向测试）可直接开工**：注入点已就位 —— 常量 `CONFIG_ALLOWED_KEYS`/`REPOSITORY_ALLOWED_KEYS`、code 标识 V1–V15、输出格式 `✗ <code> <file>: <message>`、退出码 0/1。夹具必须放 `os.tmpdir()`，否则 V15 会对夹具自身报错（本次负向验证已按此实践）。
- **Phase 2 CI 可直接调用**：`pnpm validate:app` 不依赖 Docker，唯一失败信号是退出码；CI 必须在仓根执行。
- **仍遗留的文档-实现分歧**（承自 01-01，未在本计划处理）：`docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §5 把 `ports:` 写成未注释活字段且缺 `homeassistant`/`options`/`schema`，与 D-07 冲突；`AGENTS.md` §1 第 6 条要求同步。须由 plan 01-03 或其验收清单承接。
- **HAOS 未验证**：`homeassistant: "2026.10.0"` 仍只是静态声明；plan 01-03 的清单文件需继续把「实机被识别」标为未验证。
- `examples/home-assistant-app/*.example` 保持原样，未新增、未改名（改名会变成第二个 App）。

---
*Phase: 01-app*
*Completed: 2026-10-27*

## Self-Check: PASSED
