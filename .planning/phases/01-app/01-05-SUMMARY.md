---
phase: 01-app
plan: 05
subsystem: tooling
tags: [generator, drift-guard, --check, fail-closed, plain-scalar, js-yaml, node-test, autocrlf, ci]

# Dependency graph
requires:
  - phase: 01-app
    plan: 04
    provides: "81 项静态校验器、36 条 node:test 用例、fixtures.mjs 的 withPortsComment() 单一拼装点"
provides:
  - "生成器 `--check` 模式：内存构建 → 与磁盘内容比对 → 点名每个过期产物 + exit 1，全程零写入"
  - "`check:app` 脚本，并被串联进 `test:app`，漂移守卫无法被绕过"
  - "生成器对源 JSON 的 fail-closed 输入校验：APP_SOURCE_KEYS / REPOSITORY_SOURCE_KEYS 双向白名单 + optionDefs/arch/options/注释数组显式守卫"
  - "scalar() 反转为 plain-scalar 正向白名单（含 `value.trim() === value` 守卫）"
  - "engines.node >=22；scripts 4 键；devDependencies 仍恰为 { js-yaml }"
  - "53 条 node:test 用例（36 → 53），81 项静态检查不下降"
affects: [Phase 2 CI, 01-05 之后的每条 commit, Phase 7 实机验证]

# Actuals (#2632) — 与 plan 的 estimate 同一量纲（chars/4 over realized diff）
actuals:
  tokens: 9772
  tasks: 3
  commits: 4
  plan_head_before: 18bd4633144cf714fcdaa1fbbcf47abeea3928c3
  plan_head_after: d27eb52

tech-stack:
  added: []
  patterns:
    - "双模式写入口：同一个 writeLines() 在正常模式是唯一写盘点，在 --check 模式是唯一漂移检测点，且该分支物理上无法写盘"
    - "漂移检测收集后统一报告（不 fail-fast），每个过期产物单独点名 + 一行汇总"
    - "构建函数只 throw，main() 统一包成 `Failed: <source>: <msg>`——错误成形点只有一处"
    - "源键白名单双向校验：未知键（作者以为发布了但没发布）与缺失键（读到 undefined 写进产物）都 fail"
    - "plain-scalar 正向白名单：失效方向是「多一对引号」而非「静默改值」"
    - "比对时把签出策略造成的 CRLF 折回 LF，但内容差异一律仍然红"

key-files:
  created:
    - "scripts/__tests__/generate-app-metadata.test.mjs — 17 条用例（漂移守卫 5 + fail-closed 2 + scalar 往返 7 + CRLF 2 + 冒烟 1）"
  modified:
    - "scripts/generate-app-metadata.mjs — --check 模式、源键白名单、输入守卫、先构建后写盘、scalar() 白名单、EOL 归一化"
    - "package.json — 新增 check:app、test:app 串联守卫、engines.node >=22"
    - "homeweave_app/config.yaml — 重新生成（url 与 schema.log_level 加引号）"
    - "repository.yaml — 重新生成（url 加引号）"
    - ".planning/phases/01-app/01-VALIDATION.md — 四处失效命令形态替换 + Test Infrastructure 新增 Drift guard 行"

key-decisions:
  - "`--check` 绝不写盘也绝不 mkdirSync：它若顺手修好自己发现的问题，就成了「报告成功」的假守卫"
  - "漂移比对先把 CRLF 折回 LF 再比较。实测干净克隆（core.autocrlf=true、无 .gitattributes）会得到 CRLF 产物，守卫若逐字节硬比就在每个新克隆上是假红"
  - "只折 EOL，不折其他任何东西：孤立 CR 仍算差异，CRLF 文件里的真实手改仍被点名"
  - "`scalar()` 用正向白名单而非继续给 denylist 打补丁：denylist 每漏一个 YAML 行首指示符就是一种静默改值"
  - "`value.trim() === value` 守卫保留。前导空格由正则首字符规则挡住，尾随空格只有这条守卫能挡（探针 B 已证伪）"
  - "选 `value.trim() === value` 而不是让正则接受首尾空白：语义更直白，且不依赖正则细节"
  - "拒绝评审建议的 `node --test scripts/` 形态，保留带引号 glob：前者在 Node 22.17 + win32 上把目录当单文件，MODULE_NOT_FOUND"
  - "未新增 .gitattributes。它是整个仓库的 EOL 政策决定，超出本计划 files_modified 范围，且需 git add --renormalize 波及大量文件；改为在生成器内做 EOL 归一化，推荐留给后续阶段单独处理"

patterns-established:
  - "「守卫能红」必须双向实测：既证明正常态绿，也证明变异态红，且红的时候点名了正确文件"
  - "负向用例先写哨兵内容的产物副本，再用「内容不变」把「失败时未被改写」变成断言而不是期望"
  - "涉及 VCS 换行策略的字节级比对，必须在真实 git clone 上验证，不能只信临时目录夹具"

requirements-completed: [APP-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "改了源不重生成 → check:app 非零退出并点名 homeweave_app/config.yaml"
    status: verified
  - id: D2
    description: "手改产物（删 # ports: 行）→ check:app 非零退出并点名该文件"
    status: verified
  - id: D3
    description: "--check 零写入：运行前后两个产物 SHA256 完全一致"
    status: verified
  - id: D4
    description: "源加 app.watchdog → 格式化 Failed 消息 + 两产物字节不变"
    status: verified
  - id: D5
    description: "optionDefs.haUrl 改名 → 格式化 Failed 消息，无 TypeError、无堆栈帧"
    status: verified
  - id: D6
    description: "七个危险 description 值经 js-yaml 回读与原值逐字相等"
    status: verified
  - id: D7
    description: "check:app 失败时 test:app 也非零退出且 node:test 根本不执行"
    status: verified

metrics:
  duration: "约 45 分钟"
  completed: "2026-10-27"
status: complete
---

# Phase 01 Plan 05: 生成物漂移守卫与生成器 fail-closed Summary

**一句话：** 给 app-metadata 生成器装上只读的 `--check` 漂移守卫并把它串进 `test:app`，同时堵住生成器的两条静默改值通道（源键 fail-open、`scalar()` denylist），使「改了源忘了重生成」和「手改产物」从全绿变成点名文件的红灯。

## 任务与提交

| 任务 | 名称 | 提交 | 关键改动 |
|------|------|------|----------|
| 1 | 端到端漂移守卫：`--check` 模式 + 守卫测试 | `4a9d8e5` | `writeLines()` 双模式；`check:app` 脚本；新建 `generate-app-metadata.test.mjs`（5 条） |
| 2 | 生成器输入 fail-closed（HI-03）+ `scalar()` 反转（MD-04） | `ddc5ab0` | 源键双向白名单、守卫化 `buildSchemaDsl`、先构建后写盘、plain-scalar 白名单、产物重新生成 |
| 2-补 | 漂移比对与签出换行策略解耦（探针发现） | `e3b2836` | `normaliseLineEndings()`；补 2 条 CRLF 用例 |
| 3 | `engines` 对齐（MD-05）+ 守卫挂上 `test:app` + 规格同步 | `d27eb52` | `engines.node >=22`；`test:app` 串联 `--check`；`01-VALIDATION.md` 四处替换 + 新增一行 |

## 实测命令与退出码

全部在本机 Node 22.17.0 / pnpm 9.15.4 / win32 上真实执行：

| 命令 | 结果 |
|------|------|
| `corepack pnpm generate:app`（第 1 次） | exit 0 |
| `corepack pnpm generate:app`（第 2 次，立即重跑） | exit 0，`git status` 中两个产物零 diff（幂等） |
| `corepack pnpm check:app`（干净树） | exit 0，无 `Out of date` |
| `corepack pnpm validate:app` | exit 0，`✓ 81 checks passed`（不下降） |
| `corepack pnpm test:app` | exit 0，`# tests 53 / # pass 53 / # fail 0`（36 → 53） |

## 变异探针（守卫必须真的会红）

| 探针 | 操作 | 观测结果 | 还原 |
|------|------|----------|------|
| A | 真实树：源 JSON `app.version` → `0.1.1`，不重生成 | `check:app` **exit 1**，`Out of date: homeweave_app/config.yaml … first difference at line 4: expected "version: \"0.1.1\"", found "version: \"0.1.0\""`，`1 artifact(s) out of date` | `git checkout --`，复跑 check 回 exit 0 |
| B | 真实树：删掉 `homeweave_app/config.yaml` 里 `# ports:` 一行 | `check:app` **exit 1**，点名 `homeweave_app/config.yaml`，`first difference at line 25` | `corepack pnpm generate:app`（连跑两次均零 diff），复跑 check 回 exit 0 |
| C | 真实树：源 JSON `app` 段加 `watchdog: true` | `generate:app` **exit 1**，`Failed: <path>: app.watchdog is not consumed by the generator (add it to buildConfigYaml or delete it)`；两产物 SHA256 运行前后**完全一致**（`DC3C1DF9…` / `AFE5801E…`） | 移除该键 |
| D | 真实树：`optionDefs.haUrl` → `haURL` | `generate:app` **exit 1**，`Failed: <path>: app.optionDefs.haUrl must be an object; got undefined`；输出中**无** `TypeError`、**无** `at buildSchemaDsl` | 改回 `haUrl` |
| E | 代码级证伪：临时移除 `scalar()` 的 `value.trim() === value` | `node --test scripts/__tests__/generate-app-metadata.test.mjs` **exit 1**，`not ok 14 - description "AI OS " …`，`# fail 1` | 立即恢复该守卫，复跑全绿 |
| F | 干净 `git clone` 到临时目录（`core.autocrlf=true`）：CR 计数 3 | 修复前 `--check` **exit 1**（两产物均报 `Out of date`）；修复后 **exit 0** | — |
| G | 同一 CRLF 克隆中删掉 `# ports:` 行 | `--check` **exit 1**，`Out of date: homeweave_app/config.yaml … first difference at line 25` | 删除整个探针克隆 |

探针 E 的精确结论：前导空格用例（`" AI OS"`）由正则的「首字符必须是字母」规则挡住，移除 trim 守卫后仍绿；**尾随空格用例（`"AI OS "`）只有 trim 守卫能挡**，移除即红。两条用例都保留，各自守一条路径。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - 缺失关键功能] `--check` 在 Windows 克隆上永久假红**
- **发现于：** 任务 2 完成后的干净克隆探针（探针 F）
- **问题：** 本仓 `core.autocrlf=true` 且无 `.gitattributes`，因此 `git clone` 出来的两个产物是 CRLF，而生成器永远写 LF。逐字节硬比导致**全新克隆上 `check:app` 直接报两个文件都过期**。由于 `test:app` 串联了守卫，整个测试套件会在每个新克隆上失败——一个在没人做错事时就变红的守卫，等价于没有守卫。
- **修复：** 比对前把 `\r\n` 折回 `\n`（`normaliseLineEndings()`）。只折 EOL，孤立 CR 仍算差异；CRLF 文件里的真实手改仍被点名（探针 G 证明）。
- **验证：** 真实 `git clone` 双向复验；新增 2 条用例（CRLF 无内容改动必须绿、CRLF 内有真实改动必须红）。
- **文件：** `scripts/generate-app-metadata.mjs`、`scripts/__tests__/generate-app-metadata.test.mjs`
- **提交：** `e3b2836`

**2. [Rule 2 - 缺失关键功能] 源键白名单补了「缺失键」方向**
- **发现于：** 任务 2 实现时
- **问题：** 计划只要求「未知键即 fail」。但**缺失**键会让构建函数读到 `undefined` 并写进产物，或在下游抛 `TypeError`——与未知键同属「生成器跑成功了但源没被正确应用」。
- **修复：** `assertConsumedKeys()` 双向校验，缺失键报 `app.<key> is missing (the generator reads it)`。
- **文件：** `scripts/generate-app-metadata.mjs`
- **提交：** `ddc5ab0`

**3. [Rule 2 - 缺失关键功能] `assertStringList` / `assertObject` 守卫覆盖到 arch、options 与两个注释数组**
- **发现于：** 任务 2 实现时
- **问题：** 计划显式点名了 `app.arch`。但 `commentedPortsBlock` 若被误写成字符串，`for...of` 会逐字符迭代，产物变成一堆单字符注释行——exit 0、YAML 合法、内容被毁。属于同类静默改值通道。
- **修复：** 统一的 `assertStringList()` / `assertObject()`，`arch`、`options`、`commentedPortsComment`、`commentedPortsBlock` 全部守卫。
- **文件：** `scripts/generate-app-metadata.mjs`
- **提交：** `ddc5ab0`

### 计划的显式要求与执行的对应关系

- **`scripts` 键集合 3 → 4：** 这是 01-03「键集合恰为 3 个」契约的**唯一有意变更**（新增 `check:app`），计划已预告并要求留痕；`devDependencies` 仍恰为 `{ js-yaml: ^4.1.0 }`，未新增任何依赖。
- **产物 churn：** `scalar()` 反转后共 3 行加引号——`repository.yaml` 的 `url`，`config.yaml` 的 `url` 与 `schema.log_level`。**解析值全部不变**，`validate:app` 仍 81 项全绿。产物由 `generate:app` 生成，无任何手工编辑。
- **`01-VALIDATION.md` 窄同步：** 四处 `node --test scripts/` 已按内容 grep 定位并全部替换（现文件内该形态 0 命中）；`## Test Infrastructure` 表新增一行 `Drift guard`。`## Sampling Rate` 数值、`## Wave 0 Requirements`、`## Manual-Only Verifications` 与 Nyquist 策略内容未改动。
  - 残留已知小瑕疵（**未处理，按窄同步约束**）：`## Per-Task Verification Map` 另外 4 行仍写 `pnpm validate:app`（缺 `corepack` 前缀）。它们不是已失效形态，只是在本机不可直接粘贴；若后续要清理，应作为独立的文档整理任务。

### 未采用的做法及理由

- **未新增 `.gitattributes`（`*.yaml text eol=lf`）：** 那是整个仓库的换行政策决定，超出本计划 `files_modified`，且需 `git add --renormalize` 波及大量文件。改为在生成器内做 EOL 归一化，把影响面限制在一个文件里。推荐在后续阶段以单独变更引入 `.gitattributes`。
- **未做成两阶段原子写盘（MD-01 完整方案）：** 计划明确推迟；本计划只落地「先全部构建、后统一写盘」这一最小缓解。

## must_haves 逐项核对

| Truth | 结论 | 证据 |
|-------|------|------|
| 改源不重生成 → 非零退出并打印 `Out of date: homeweave_app/config.yaml`，`test:app` 随之中断 | ✅ | 探针 A；链路探针（`test:app` exit 1 且无 `# tests`） |
| 手改产物一字节 → 非零退出并点名该文件 | ✅ | 探针 B；探针 G（CRLF 变体） |
| `--check` 零写入（SHA256 前后一致） | ✅ | 任务 1 用例 (b) 的 SHA256 断言；探针 C 的两产物哈希不变 |
| 源加 `app.watchdog` → `Failed: … app.watchdog is not consumed by the generator`，exit 1 | ✅ | 探针 C（且产物未被改写） |
| `optionDefs.haUrl` 改名 → 格式化错误，无 `TypeError` / `at buildSchemaDsl` | ✅ | 探针 D；用例断言 |
| 七个 description 值经 js-yaml 回读逐字相等 | ✅ | 7 条往返用例全绿；探针 E 证明尾随空格那条确实有守卫在守 |
| `engines.node` 为 `>=22` | ✅ | `package.json` |

| Artifact | 结论 |
|----------|------|
| `scripts/generate-app-metadata.mjs` 支持 `--check`（内存生成 → 比对 → exit 1 + 逐文件摘要，不写盘） | ✅ |
| `scripts/__tests__/generate-app-metadata.test.mjs` 新增（漂移守卫 + 源键白名单 + scalar 引号往返） | ✅ 17 条 |
| `package.json` 新增 `check:app`、`test:app` 串联 `--check`、`engines.node >=22` | ✅ |
| 重新生成的 `homeweave_app/config.yaml` 与 `repository.yaml`（引号 churn） | ✅ |
| `01-VALIDATION.md` 四处失效形态已替换、表内新增 `check:app` 一行 | ✅ |

## Known Stubs

无。本计划未留下任何占位实现、跳过用例或未执行的 `<verify>`。全部 `<automated>` 均真实执行并记录退出码。

## 范围声明（重要）

**本计划通过不等于本阶段可发布。** 本计划证明的只是静态层：源与产物不再可能悄悄漂移，生成器对自己的输入 fail-closed，危险标量不再被静默改值。

**明确未验证、不属本计划的：**
- Supervisor 是否接受这个仓库（`vol.Schema` 对 `RE_SLUG` / `version_tag` / `docker_image` 的真实行为）
- 加载项商店是否渲染出可安装条目
- 镜像 pull / upgrade / ingress 行为
- 任何运行时端点或 UI

以上全部属 Phase 7 的 HAOS 实机证据；镜像本身由 Phase 2 交付。`01-VALIDATION.md` 的 `## Manual-Only Verifications` 表格仍是这些项的唯一记录处，其状态未因本计划改变。

## Self-Check: PASSED

- 本次 plan 的 4 个任务提交均可达：`4a9d8e5`、`ddc5ab0`、`e3b2836`、`d27eb52`
- 新建文件存在：`scripts/__tests__/generate-app-metadata.test.mjs`
- `corepack pnpm validate:app` = 81 checks / exit 0
- `corepack pnpm test:app` = 53 pass / 0 fail / exit 0
- 工作树中两个生成物零 diff；源 JSON 与 HEAD 一致
