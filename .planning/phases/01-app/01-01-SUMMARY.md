---
phase: 01-app
plan: 01
subsystem: infra
tags: [home-assistant, supervisor, app-metadata, yaml, pnpm, esm, codegen]

requires: []
provides:
  - "homeweave_app/app-metadata.json 作为唯一元数据源（repository + app 两段）"
  - "scripts/generate-app-metadata.mjs 字符串模板生成器（零 dump，注释块与键序完全可控）"
  - "repository.yaml（仓根，Supervisor 非递归发现）"
  - "homeweave_app/config.yaml（含 14 键固定顺序 + 注释保留的 ports 尾块）"
  - "仓根最小 package.json + pnpm-lock.yaml（唯一直接依赖 js-yaml）"
  - "generate:app 生成入口，幂等（重跑零 diff）"
affects: [01-02 校验器, 01-03 负向测试, 02 镜像构建, 03 运行时, 05 Ingress, 06 HA API]

actuals:
  tokens: 2461
  tasks: 2
  commits: 3

tech-stack:
  added:
    - "js-yaml 4.3.2（唯一直接依赖，仅经由 lockfile 锁定；传递依赖 argparse 2.0.1 为 js-yaml 自带）"
    - "pnpm 9.15.4 via corepack（本机 pnpm 不在 PATH）"
  patterns:
    - "单一元数据源 → 生成器 → 入库生成物：源与产物的漂移由 git diff 发现（D-02）"
    - "YAML 用字符串模板逐行拼接，不用 js-yaml 序列化器 —— 注释块与键序须逐字节可控"
    - "生成器确定化：显式 \\n 行尾、无时间戳/commit hash/随机值、末尾恰好一个换行"

key-files:
  created:
    - package.json
    - pnpm-lock.yaml
    - homeweave_app/app-metadata.json
    - scripts/generate-app-metadata.mjs
    - repository.yaml
    - homeweave_app/config.yaml
  modified: []

key-decisions:
  - "生成器采用字符串模板逐行拼接（PATTERNS §2 解法 1）：js-yaml 序列化器无法输出注释，纯序列化会静默删除 D-07 要求保留的 ports 注释块；同时键序 100% 可控，这是幂等零 diff 的前提"
  - "元数据源只存语义值、不存 YAML/DSL 文本：schema DSL（list(info|debug|warn) / str?）由 optionDefs 在生成期拼出，避免 DSL 串在源与产物各存一遍（D-02）"
  - "app-metadata.json 顶层恰为 repository + app 两段（一个文件同时喂两个不同契约）；basename 不是 config.*，不会被 Supervisor 递归识别为第二个 App"
  - "repository.yaml 的 url 与 maintainer 保留 Zee1988 / Zee，只有 app.image 走全小写 zee1988（D-01a：OCI/GHCR 拒绝大写路径）"
  - "config.yaml 顶部第一行写固定来源注释，ports 尾块上方写 Phase 5 授权前置说明；两处均为产物注解（同头部来源注释），不属于元数据语义值，故不写入 app-metadata.json"
  - "package.json 未加 packageManager 字段（会把 pnpm 版本钉死在本阶段）；未建 pnpm-workspace.yaml（Phase 1 只有仓根一个最小包）"

patterns-established:
  - "键序契约：name→slug→version→description→url→arch→init→image→homeassistant→homeassistant_api→ingress→ingress_port→options→schema（+注释 ports 尾块）"
  - "退出码契约：成功 0；失败打印 Failed: <path>: <msg> 后 process.exit(1)"
  - "生成器输入校验前置：顶层键集合、image 全小写、image 不带 tag，均在写盘前失败退出"

requirements-completed: [APP-02, APP-03, APP-04]

coverage:
  - id: D1
    description: "单一元数据源经生成器产出 repository.yaml 与 homeweave_app/config.yaml，键序/取值/注释块符合 D-01/D-01a/D-03a/D-07/D-09"
    requirement: APP-02
    verification:
      - kind: other
        ref: "corepack pnpm generate:app  (exit 0)"
        status: pass
      - kind: other
        ref: "git add -N -- repository.yaml homeweave_app/config.yaml && git diff --exit-code -- repository.yaml homeweave_app/config.yaml  (exit 0)"
        status: pass
      - kind: other
        ref: "node -e ORDER_CHECK  (stdout ORDER_OK, exit 0)"
        status: pass
      - kind: other
        ref: "node -e PLACEHOLDER_CHECK  (stdout PLACEHOLDER_OK, exit 0)"
        status: pass
      - kind: other
        ref: "node -e js-yaml parse of config.yaml  (version string \"0.1.0\"; image ghcr.io/zee1988/homeweave-ha-app no tag; homeassistant string \"2026.10.0\"; arch amd64,aarch64; schema {log_level: list(info|debug|warn), ha_url: \"str?\"})"
        status: pass
    human_judgment: false
  - id: D2
    description: "仓库可被 Home Assistant Supervisor 识别为有效 App 仓库，并在 Apps 列表渲染可安装的 HomeWeave 条目"
    requirement: APP-03
    verification: []
    human_judgment: true
    rationale: "本计划只能产出静态校验证据；'被 Supervisor 识别' 与 '条目可安装' 需要 HAOS 实机。标注 HAOS 未验证，不得由自动化代签。"
  - id: D3
    description: "仓根最小包 + lockfile 可复现：唯一直接依赖 js-yaml 可解析，生成入口唯一"
    requirement: APP-04
    verification:
      - kind: other
        ref: "corepack pnpm install  (exit 0, js-yaml 4.3.2)"
        status: pass
      - kind: other
        ref: "node -p \"require.resolve('js-yaml')\"  (resolves to node_modules/.pnpm/js-yaml@4.3.2/...)"
        status: pass
      - kind: other
        ref: "node -e PKG_CHECK  (stdout PKG_OK: private=true, devDeps={js-yaml}, scripts={generate:app}, no packageManager)"
        status: pass
      - kind: other
        ref: "git ls-files -- pnpm-lock.yaml  (tracked)"
        status: pass
    human_judgment: false

duration: ~12min
completed: 2026-10-27
status: complete
---

# Phase 1 Plan 01: App 元数据与仓库可识别性 Summary

**单一 JSON 元数据源经 ESM 字符串模板生成器产出仓根 `repository.yaml` 与 `homeweave_app/config.yaml`，14 键顺序固定、`ports` 块以注释存活、重跑零 diff，js-yaml 为唯一直接依赖**

## Performance

- **Duration:** ~12 min（近似值；会话起点未打时间戳。可核验的提交窗口：2026-10-27T14:12:39+08:00 → 2026-10-27T14:13:17+08:00）
- **Completed:** 2026-10-27
- **Tasks:** 2/2
- **Files modified:** 6（6 新增、0 修改）
- **Commits (measured):** 3（`git rev-list --count e605916..HEAD`）

## Accomplishments

- 建立里程碑第一批可执行工程物：仓根最小 `package.json` + `pnpm-lock.yaml`，`corepack pnpm install` 一次通过。
- 「单一元数据源 → 生成器 → 两个入库 YAML」端到端打通：`homeweave_app/app-metadata.json` 是唯一写入口，两个生成物同时入库，源与产物漂移因此变成 `git diff` 可发现的事实。
- 生成器刻意避开 js-yaml 序列化器，改用逐行字符串拼接：`ports` 注释块按 D-07 存活，14 个键序逐字节稳定，重跑 `git diff --exit-code` 为空（D-02 的唯一自动化守护成立）。
- 全部 Phase 1 取值决策一次落盘：`image` 全小写无 tag、`homeassistant: "2026.10.0"`、`tree/master`（非 `main`）、`arch` 固定 `amd64`+`aarch64`、`options`/`schema` 两项（`log_level` 三选一枚举、`ha_url` 默认空串）。
- 未写任何 D-07 禁止键（`boot`/`startup`/`watchdog`/`map`/`apparmor`/`panel_title`/`panel_icon`/`backup`/`devices`/`ports`），全部由解析后断言确认不存在。

**验证结论等级：静态校验通过 / HAOS 未验证。** 本计划**不能**证明「仓库能被 Supervisor 识别」或「条目可安装」——仓库内没有任何 HAOS 实机证据，任何此类表述均须标注未验证。

## Task Commits

Each task was committed atomically:

1. **Task 1: 端到端打通「单一元数据源 → 生成器 → 两个 YAML 生成物」** - `46282d7` (feat)
2. **Task 1 修正: 生成器头注释去歧义** - `5b4d9cb` (refactor)
3. **Task 2: 补齐 package.json 工程基线与依赖锁** - `b41a42f` (chore)

**Plan metadata:** 见本 SUMMARY 的 docs 提交

## Files Created/Modified

- `package.json` - 仓根最小私有包：name `homeweave`、version `0.1.0`、`private: true`、`engines.node >=20`、唯一 script `generate:app`、devDeps 仅 `js-yaml`
- `pnpm-lock.yaml` - lockfileVersion 9.0，锁定 js-yaml 4.3.2（含 integrity）+ 其传递依赖 argparse 2.0.1
- `homeweave_app/app-metadata.json` - 唯一元数据源，顶层 `repository` / `app` 两段，只存语义值
- `scripts/generate-app-metadata.mjs` - ESM 生成器（无 shebang、无导出、纯 CLI 副作用），读 JSON 写两个 YAML，显式 `\n` 行尾
- `repository.yaml` - 仓根生成物，3 行：`name: HomeWeave Apps` / `url: https://github.com/Zee1988/homeweave` / `maintainer: Zee`
- `homeweave_app/config.yaml` - 生成物，14 键 + 注释 `ports` 尾块

## Decisions Made

- **生成器用字符串模板而非序列化库**：js-yaml 无法输出注释，纯序列化会静默删除 D-07 要求保留的 `ports` 注释块；且键序完全可控是幂等零 diff 的前提。
- **DSL 串只在产物中出现一次**：`schema` 的 `list(info|debug|warn)` 与 `str?` 由 `optionDefs` 的语义定义（type/values/optional）在生成期拼出，源文件不存 DSL 文本。
- **两处产物注解由生成器固定**：`config.yaml` 顶部来源注释、`ports` 尾块上方「Phase 5 授权完成后才开放」说明，属产物注解而非元数据语义值，故不进 `app-metadata.json`；元数据语义值（如 `commentedPortsComment` / `commentedPortsBlock`）仍全部来自源文件，生成器未硬编码这些内容。
- **`package.json` 不加 `packageManager`、不建 `pnpm-workspace.yaml`**：前者会把 pnpm 版本钉死在本阶段（尚无 CI），后者超出 Phase 1 单包边界。
- **`generate:app` 是目前唯一脚本**：`validate:app` 由 plan 01-02 加入，本计划不预留指向不存在文件的入口。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `package.json` 在 Task 1 即落盘**
- **Found during:** Task 1
- **Issue:** Task 1 的 `<verify>` 需要 `corepack pnpm generate:app` 可执行，而该入口必须存在于 `package.json` —— 文件尚未创建时 Task 1 无法验证。
- **Fix:** Task 1 先建 `package.json`（内容即 Task 2 的最终形态），Task 2 只负责 `corepack pnpm install` 与 lockfile 入库。计划文本本身已隐含此顺序（Task 2 action 写「在上一步生成的 package.json 上收敛」）。
- **Files modified:** `package.json`
- **Verification:** Task 2 的 `PKG_OK` 断言（devDeps 恰为 {js-yaml}、scripts 恰为 {generate:app}、无 packageManager）通过。
- **Committed in:** `46282d7`（Task 1 提交）

**2. [Rule 1 - Bug] 生成器头注释含可被误判的 `dump()` 字面量**
- **Found during:** Task 1 验收自检
- **Issue:** 头注释里为了解释「为什么不用序列化器」写了 `dump()`。虽然没有任何 `yaml.dump(` 调用，但验收口径「生成器中不出现 yaml.dump」用朴素子串扫描时会命中注释，门禁语义变模糊。
- **Fix:** 改写成不含该字面量的表述（"serialise an object through js-yaml"），保留原意。行为零变化（生成物逐字节不变，重跑 diff 仍为空）。
- **Files modified:** `scripts/generate-app-metadata.mjs`
- **Verification:** `NO_DUMPCALL_OK` / `NO_DUMPTOKEN_OK` / `NO_SHEBANG_OK`；重跑 `generate:app` 后 `git diff --exit-code` 仍为 0，`ORDER_OK` / `PLACEHOLDER_OK` 不变。
- **Committed in:** `5b4d9cb`

---

**Total deviations:** 2 auto-fixed（1 blocking、1 bug）
**Impact on plan:** 两项均为让门禁可执行/可判定，无范围扩张、无新增文件、无取值变更。

## Issues Encountered

- **`git add -N` 基线次序**：首次执行 Task 1 的 `<verify>` 时 `git diff --exit-code` 非零，因为两个生成物当时还是**未提交的新文件**，`git add -N` 只是声明意图添加，diff 展示的是「新文件全文」。计划 `<verification>` 第 2 条已言明「缺它则门禁会空转通过」，其正确语义是「相对已提交基线重跑零 diff」。处理：先提交产物，再重跑 `generate:app` + `git add -N` + `git diff --exit-code` → 退出码 0。**这条验证只有在产物已入库后才有判别力**，plan 01-02/01-03 复用时须先确保基线已提交。
- **PowerShell 包装 `cmd /c "corepack pnpm ..."` 失败**：报 `The filename, directory name, or volume label syntax is incorrect.`（`generate:app` 的冒号在 cmd 嵌套引号下被误解析）。改为在 PowerShell 中直接执行 `corepack pnpm generate:app`，退出码 0。仅影响本机命令写法，不影响计划语义。
- **win32 行尾**：git 提示 `LF will be replaced by CRLF the next time Git touches it`。生成器始终写 `\n`（产物 `HAS_CR=OK`，无 CR），且在 `core.autocrlf` 下 `git diff` 归一化后仍为空。`.gitattributes` 归 Phase 2（PATTERNS §6），本阶段未引入。
- **`js-yaml` 的传递依赖**：`pnpm install` 除 js-yaml 4.3.2 外还装了 `argparse@2.0.1`（js-yaml 4.x 自带）。直接依赖仍恰为 1 个（`devDependencies` 键集合 = { js-yaml }），D-04 未被违反。

## User Setup Required

None - no external service configuration required.

## Threat Flags

无新增计划外攻击面。计划内威胁处置执行情况：

| Threat ID | 处置 | 本计划落地证据 |
|---|---|---|
| T-01-02 | mitigate | 生成器写盘前断言 `image` 全小写且不带 tag（失败即 `Failed:` + exit 1）；解析后断言 `hasTag=false` |
| T-01-03 | mitigate | 两个生成物的占位符扫描在本任务内执行，输出 `PLACEHOLDER_OK` |
| T-01-SC | mitigate | 仅装 js-yaml；`pnpm-lock.yaml` 锁定 4.3.2 且含 `integrity` 字段；无额外依赖 |
| T-01-01 | 移交 01-02 | 键白名单（V8）由 plan 01-02 落地；本计划生成器已前置校验顶层键集合与 optionDefs 类型 |
| T-01-04 | accept（本阶段仅声明） | 只写入 `homeassistant_api: true` 声明，无调用路径；权限边界文档化归 Phase 6 |

## Next Phase Readiness

- **plan 01-02（校验器）可直接开工**：两个生成物已入库，`scripts/validate-app-metadata.mjs` 的输入稳定；键序契约与 `Failed:`/退出码 1 约定已由本计划确立，校验器应复用同一约定。
- **plan 01-02 需补 `validate:app` 入口**：本计划刻意未加，避免出现指向不存在文件的 script。
- **仍遗留的一处文档-实现分歧**：`docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §5 示例把 `ports:` 写成未注释活字段，且缺 `homeassistant`/`options`/`schema`（PATTERNS §4 已记录，`AGENTS.md` §1 第 6 条要求同步）。本计划 `<tasks>` 未包含该工作，须由 plan 01-03 或其验收清单承接。
- **HAOS 未验证**：`homeassistant: "2026.10.0"` 依据是 2026-10-27 实取的官方 `stable.json`，非实机验证；`repository.yaml` 的唯一性与仓根位置属静态结论。计划 `<verification>` 第 6 条的「homeassistant 行旁注 HAOS 未验证」按计划应写入 plan 01-03 的清单文件，在本计划未执行。
- `examples/home-assistant-app/*.example` 保持原样（含故意保留的 `<owner>` 占位符，理由见 `examples/README.md`）；本计划的占位符扫描范围刻意限定为两个生成物。

---
*Phase: 01-app*
*Completed: 2026-10-27*

## Self-Check: PASSED

- 6 个交付文件 + 本 SUMMARY 均存在于磁盘
- 3 个任务提交（46282d7 / 5b4d9cb / b41a42f）均为 HEAD 祖先
- 计划级验证 V1-V5 全部退出码 0：generate:app / 幂等零 diff (ORDER_OK) / 占位符 (PLACEHOLDER_OK) / require.resolve('js-yaml')
