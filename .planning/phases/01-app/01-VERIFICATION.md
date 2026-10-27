---
phase: 01-app
verified: 2026-10-27T14:31:40Z
status: gaps_found
score: 18/20 must-haves verified
must_haves_checked: 20
covered_files:
  - .planning/phases/01-app/01-01-PLAN.md
  - .planning/phases/01-app/01-01-SUMMARY.md
  - .planning/phases/01-app/01-02-PLAN.md
  - .planning/phases/01-app/01-02-SUMMARY.md
  - .planning/phases/01-app/01-03-PLAN.md
  - .planning/phases/01-app/01-03-SUMMARY.md
  - docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md
  - homeweave_app/app-metadata.json
  - homeweave_app/config.yaml
  - package.json
  - repository.yaml
  - scripts/__tests__/fixtures.mjs
  - scripts/__tests__/validate-app-metadata.test.mjs
  - scripts/generate-app-metadata.mjs
  - scripts/validate-app-metadata.mjs
covered_digest: "v4:sha256:e47e24736925db82e931b846686567cd209fc27dc518dd9f908fc4149a51d432"
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "D-02 单一来源生效：改动 homeweave_app/app-metadata.json 后重跑生成器，两个 YAML 生成物同步变化"
    test: "改 app-metadata.json 中 app.version 为 0.1.1 后执行 `corepack pnpm generate:app`，观察 config.yaml 与 repository.yaml 两文件是否同步变化"
    expected: "两文件与源 JSON 保持一致；无人为介入即可复现（且无第二条手工编辑路径）"
    why_human: "无任何自动化用例 spawn 生成器做「改源 → 重跑 → 比对」的往返断言（01-REVIEW.md HI-01：测试目录只在注释里提到生成器）。当前 0.1.0 产物的正确性只由一次性人工观测支撑，不是可回归的行为证据。"
gaps:
  - truth: "开发者执行单一入口 `pnpm validate:app` 即可判定两个生成物是否满足必填字段、类型与取值约束"
    status: partial
    reason: "校验器对必需字段采用「出现才检查」（`if (has(config, key))`）而 CONFIG_REQUIRED_KEYS 只含 5 个通用键；整段删除必需键仍退出 0。01-REVIEW.md HI-02 实测：删 `image:` → ✓ 53 checks passed / exit 0；删 `ingress:`+`ingress_port:` → exit 0；删 `init:` → exit 0；删 `homeassistant:` → exit 0。无 `image`/`build` 的 config.yaml 在 Supervisor 侧不可安装，而本阶段静态层是唯一防线（docs/21 §11 已声明 HAOS 未验证）。同时 MD-02 显示 slug/name/description/homeassistant 的类型与格式变异同样 exit 0。"
    artifacts:
      - path: "scripts/validate-app-metadata.mjs"
        issue: "V6/V9/V10 包在 has(config, key) 内；CONFIG_REQUIRED_KEYS 仅 5 键，V8 有意不反向要求 14 键全在，导致必需性无人负责；缺 V16 类型/格式断言"
    missing:
      - "把必需键提升为精确最小键集（name/slug/version/description/url/arch/init/image/homeassistant/homeassistant_api/ingress/ingress_port/options/schema）并逐键断言存在，未知键反向拒绝"
      - "为 name/slug/description/url/homeassistant 增加类型断言与 slug=^[a-z0-9-_]+$、homeassistant=x.y.z 字符串断言"
  - truth: "生成物与单一数据源之间不存在漂移（01-VALIDATION.md:49 将其列为 `node --test scripts/` 的自动化验证项）"
    status: partial
    reason: "该验证项在 01-VALIDATION.md 被指派给自动化命令，但测试目录从未 import/spawn 生成器（01-REVIEW.md HI-01），package.json 无 --check 类脚本，validate-app-metadata.mjs 全文不含 app-metadata.json。后果：改源 JSON 的 version 却忘记重生成时，V4 只校验 `x.y.z` 形状、closing gate 只断言 exit 0，73 项检查（58+15）全绿，而镜像 tag 由产物驱动。幂等/零漂移目前完全依赖人工纪律。"
    artifacts:
      - path: "scripts/generate-app-metadata.mjs"
        issue: "无 --check / dry-run 一致性模式，无法在不写盘的前提下比对已提交生成物与源 JSON 的生成结果"
      - path: "scripts/__tests__/validate-app-metadata.test.mjs"
        issue: "无用例覆盖生成→比对往返（仅注释提及生成器）"
      - path: "package.json"
        issue: "无 check:app 之类脚本，test:app 不含漂移守卫"
    missing:
      - "生成器增加 `--check` 模式（比对现有文件与将写入内容，不一致则 exit 1）"
      - "`test:app`（或独立 `check:app`）串联该模式，使「源 JSON 改了但产物未重生成」成为红灯"
  - truth: "Prohibition：仓库内不得存在第二份会被 Supervisor 递归识别的 config.* 文件 —— 该禁令的自动化守护已在仓内成立（V15），可执行证据通过；但同一禁令的姊妹项（配置必需键完整）反向失效，见上方首条 gap"
    status: partial
    reason: "本条 non-blocking：V15 唯一性断言与负向用例均通过（见下方 prohibitions 表），仅在此登记「静态层是唯一防线」这一前提已因 HI-02 被削弱。"
    artifacts:
      - path: "scripts/validate-app-metadata.mjs"
        issue: "必需键缺失静默通过，削弱了「静态层可替代 HAOS 验收」的整体假设"
    missing:
      - "随首条 gap 一并修复"
advisory:
  - finding: "生成器对源 JSON 的 app 段无键白名单，未知/改名键 fail-open（加 app.watchdog 静默忽略；optionDefs.haUrl→haURL 抛未捕获 TypeError 且此时 repository.yaml 已被写过）"
    category: architectural
    reason: "尚未在已提交产物中造成错误值；01-REVIEW.md HI-03/MD-01 有可复现记录，但当前必须项未被其直接推翻，故按建议性记录"
    evidence_status: "01-REVIEW.md 变异实测（HI-03、MD-01）"
human_verification:
  - test: "在 HAOS 上「设置 → 加载项商店 → 右上角仓库 → 添加」https://github.com/Zee1988/homeweave，刷新后确认 Apps 列表出现名为 HomeWeave 的条目"
    expected: "仓库被 Supervisor 识别为有效 App 仓库，列表出现 HomeWeave 条目，且可进入详情/安装流程（APP-01、APP-03、ROADMAP 成功标准 1/5）"
    why_human: "无 HAOS 实机；Supervisor 对仓库与 config.yaml 的接受行为无法静态证明（01-VALIDATION.md Manual-Only Verifications 已如此标注）"
  - test: "安装后在详情页确认 log_level / ha_url 两个选项可见且有默认值（info / 空串），打开日志页"
    expected: "选项渲染正确、默认值生效、App 详情与日志页正常（APP-04、APP-02 的「可被 Supervisor schema 校验通过」）"
    why_human: "Supervisor 对 schema DSL 的实际解析与 UI 渲染属运行时行为"
  - test: "确认镜像可拉取（image: ghcr.io/zee1988/homeweave-ha-app 无 tag）并在升级路径上行为正确"
    expected: "Supervisor 解析出与 version 对应的镜像 tag 并成功安装/升级"
    why_human: "依赖 Phase 2 的镜像发布；本阶段只交付静态声明"
  - test: "「Open Web UI」/ Ingress 按钮在 Phase 5 前的行为"
    expected: "点击后为空白/错误页，记入已知限制（S2），不记为失败"
    why_human: "已知后果，需实机核对是否被误判为缺陷"
  - test: "D-02 单一来源往返：改 app-metadata.json 的 version → 重跑 generate:app → 观察两产物同步变化"
    expected: "两个 YAML 同步更新，无手工编辑生成物的必要"
    why_human: "无自动化用例覆盖该状态转移（见 behavior_unverified_items）"
---

# Phase 01: App 仓库结构与元数据 Verification Report

**Phase Goal:** 仓库结构与 App 元数据达到「Supervisor 能识别为有效 App 仓库并渲染出可安装条目」的条件，并锁死全部占位符决策。
**Verified:** 2026-10-27T14:31:40Z
**Status:** gaps_found
**Re-verification:** No — initial verification

> 本阶段目标包含两半：**(a) 静态层**（结构、必需键、占位符决策、自动化守卫）与 **(b) 运行时层**（Supervisor 是否真的识别、商店是否真的渲染出可安装条目）。**(a) 基本达成但有 2 处必需项被可复现缺陷推翻；(b) 完全不可静态证明**，已全部转入人工验证。

## 目标倒推检查（逐条 must_have truth）

### Plan 01-01（8 truths）

| # | Truth | Status | 证据 |
|---|-------|--------|------|
| 1 | D-02 单一来源生效：改源 JSON 重跑，两个 YAML 同步变化；无手工编辑生成物路径 | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | 机制在（生成器是唯一写入路径，`git status --porcelain` 干净）；但「改源 → 重跑 → 两产物同步变化」无自动化往返断言（HI-01）。见 behavior_unverified_items |
| 2 | 仓根唯一 `repository.yaml`：name=HomeWeave Apps、url=https://github.com/Zee1988/homeweave、maintainer=Zee（APP-03） | ✓ VERIFIED | `repository.yaml` 实际内容逐字匹配；全仓扫描 `repository.yaml` 命中数 = 1（无第二份） |
| 3 | `config.yaml` 五必填键齐全，`arch` 恰为 amd64/aarch64 且顺序固定（APP-02） | ✓ VERIFIED | `config.yaml` 头部含 name/slug/version/description/arch；`arch: [amd64, aarch64]` 顺序固定；V2/V5 有负向用例 |
| 4 | `image` = 全小写 `ghcr.io/zee1988/homeweave-ha-app` 不带 tag；`version` 为字符串 `0.1.0`（APP-02、D-01a） | ✓ VERIFIED | 产物字面值一致；`homeassistant: "2026.10.0"` 带引号说明 scalar 引号策略生效。**注**：精确值无断言（MD-03），仅形状断言 |
| 5 | `homeassistant` = `2026.10.0`（D-03a），并在计划与产物旁注标注 HAOS 未验证 | ✓ VERIFIED | 产物值一致；`docs/21` §11 已含「HAOS 未验证」标注条目（01-REVIEW.md 第 11 项核对通过） |
| 6 | 含 `options` 与 `schema`：`log_level` 三选一枚举、`ha_url` 可选字符串默认空串（APP-04、D-09） | ✓ VERIFIED | `options.log_level: info`、`options.ha_url: ""`；`schema.log_level: list(info\|debug\|warn)`、`schema.ha_url: "str?"`；V11/V12 覆盖 |
| 7 | 被注释保留的 `ports` 块真实存在于生成物中，且不存在激活的 `ports` 键（D-07） | ✓ VERIFIED | 产物第 23–26 行为注释态 `# ports:` / `# 8124/tcp: 8124`；`has_live_ports=false`、`has_commented_ports=true`；解注释实测 `✗ V8` exit 1（01-REVIEW.md C4）。**注**：注释块存在性无断言（LO-01），靠人工纪律 |
| 8 | 重跑生成器后两生成物 `git diff` 为空（D-02 唯一自动化守护） | ✓ VERIFIED | `corepack pnpm generate:app` exit 0 后 `git status --porcelain` 仅列出未跟踪的 `.planning/` 文件，两份生成物均无改动 |

### Plan 01-02（6 truths）

| # | Truth | Status | 证据 |
|---|-------|--------|------|
| 9 | 单一入口 `pnpm validate:app` 可判定两个生成物是否满足**必填字段**、类型与取值约束 | ✗ FAILED | **HI-02 实测推翻**：删 `image:`→exit 0；删 `ingress:`+`ingress_port:`→exit 0；删 `init:`→exit 0；删 `homeassistant:`→exit 0；MD-02：`slug: HomeWeave bad`、`name: 12345`、`homeassistant: 2026.1`、`description: [alpha]` 全部 exit 0。`validate:app` exit 0 只证明当前产物没问题，不证明「必填」被守卫 |
| 10 | 校验器自带键白名单：任何未知键即非零退出（Supervisor 用 `REMOVE_EXTRA` 静默丢弃） | ✓ VERIFIED | V8 负向用例存在；解注释 `ports` 实测 `✗ V8 ... unknown key "ports"` exit 1（01-REVIEW.md C4） |
| 11 | 断言 `image` 不带 tag 且前缀 `ghcr.io/`；`arch` 元素只允许 amd64/aarch64 | ✓ VERIFIED | V6/V5 有负向用例；`arch: [i386]` 类变异据 01-REVIEW.md 命中 `✗ V5` |
| 12 | 交叉检查 `options`↔`schema`：schema 每键有默认值或以 `?` 结尾；options 每键都在 schema 中；DSL 字面值正确（APP-04） | ✓ VERIFIED | `✗ V11` 负向用例通过（D3：options 多一个无 schema 的键 → exit 1）；DSL 字面值 `list(info\|debug\|warn)` / `str?` 在产物中逐字匹配 |
| 13 | 递归扫描全仓 `config.*` 断言命中数恰为 1，跳过点开头路径段与 rootfs，node_modules 豁免有注释 | ✓ VERIFIED | V15 负向用例（同树两份 config.yaml）通过；本轮独立扫描实测命中数 = 1（`homeweave_app/config.yaml`），`repository.yaml` 亦仅 1 份 |
| 14 | 收集全部失败后统一报告再退出，不 fail-fast；退出码只有 0 与 1 | ✓ VERIFIED | `failures` 数组收集 + 末尾统一输出；全文仅 `process.exitCode = 1`，无 `process.exit(`（01-REVIEW.md 第 4/5 项逐行确认） |

### Plan 01-03（6 truths）

| # | Truth | Status | 证据 |
|---|-------|--------|------|
| 15 | 每个核心检查都有 ≥1 负向用例：V2/V5/V6/V8/V11/V13/V15 | ✓ VERIFIED | `test:app` exit 0，`# pass 15 / # fail 0`；01-REVIEW.md LO-03 确认这 7 个 code 均有负例（缺例的是 V1/V3/V4/V9/V10/V12/V14，不在本条列举范围内） |
| 16 | 存在正向对照：完全合法的临时树让校验器退出 0 | ✓ VERIFIED | 测试内置基线正例；整体 `# pass 15` 且含 positive baseline（01-REVIEW.md 第 9 项） |
| 17 | 夹具全在 `os.tmpdir()`+mkdtemp 并在 after 钩子清理；跑完 `validate:app` 仍 exit 0、候选数仍为 1 | ✓ VERIFIED | `test:app` exit 0 后 `validate:app` 仍 `✓ 58 checks passed` exit 0；`git status --porcelain` 无夹具残留；V15 复跑候选数 = 1 |
| 18 | 负向断言只读退出码与 check code，从不断言 YAML 引号风格 | ✓ VERIFIED | 测试统一经 exit code + `✗ <code>` 判定，需读值时用 js-yaml 解析后比类型/值；无引号字面量比较（01-REVIEW.md 第 6 项逐行确认） |
| 19 | `docs/21` §5 的 ports 回到注释状态，与 D-07 一致 | ✓ VERIFIED | §5 与 `config.yaml:23-26` 一致（01-REVIEW.md 第 11 项） |
| 20 | `docs/21` §11 出现 HAOS 实机验证条目（确切仓库 URL、预期结果、HAOS 未验证标注）（APP-01） | ✓ VERIFIED | §11 条目存在并明确标注「HAOS 未验证」，预先声明「Open Web UI 空端口属 S2 已知后果」 |

**Score:** 18/20 truths verified（1 项 FAILED，1 项 present-behavior-unverified）

## 产物存在性

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | 仓根最小包，private，devDependencies 仅 js-yaml | ✓ VERIFIED | `name: homeweave`、`private: true`、`devDependencies: { js-yaml ^4.1.0 }`；scripts 含 generate/validate/test:app。**注**：`engines.node >=20` 与 `node --test "<glob>"`（需 v21+）冲突（MD-05） |
| `homeweave_app/app-metadata.json` | 两段式单一数据源 | ✓ VERIFIED | 存在；生成器读它，校验器不读它（方向正确） |
| `scripts/generate-app-metadata.mjs` | ESM 生成器，字符串模板方案 | ✓ VERIFIED（有缺陷） | 无 `js-yaml` 引用、显式 `\n`、单一尾换行、block style 列表；但 app 段键无白名单（HI-03）、写入顺序两文件非原子（MD-01）、`scalar()` denylist 可静默丢值（MD-04） |
| `repository.yaml` | 仓根生成物 | ✓ VERIFIED | 唯一一份，值符合 APP-03 |
| `homeweave_app/config.yaml` | 生成物，含注释尾缀 | ✓ VERIFIED | 14 键最小集 + 注释态 ports 块；必需键存在性无守卫（HI-02） |
| `scripts/validate-app-metadata.mjs` | 校验器 | ✓ VERIFIED（有缺陷） | 58 项检查、收集式失败、退出码 0/1；必需键缺失静默通过（HI-02） |
| `scripts/__tests__/validate-app-metadata.test.mjs` | node:test 负向用例 + 正向对照 | ✓ VERIFIED | 15 用例全绿；覆盖缺口见 LO-03（V1/V3/V4/V9/V10/V12/V14 无负例） |
| `scripts/__tests__/fixtures.mjs` | 临时树构造器，全在 os.tmpdir() | ✓ VERIFIED | 已确认不含 test() 注册、全部临时目录 |
| `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` | §5 注释态 ports、§11 HAOS 实机验证条目 | ✓ VERIFIED | 两处编辑与产物一致 |

## prohibitions 检查

| Prohibition | 状态 | 证据 |
|---|---|---|
| 仓库内不得存在第二份会被 Supervisor 递归识别的 `config.*`（D-05a / 成功标准 2） | ✓ 成立 | 独立全仓扫描：仅 `homeweave_app/config.yaml` 一份；V15 断言 + 负向用例守护 |
| 仓库树内不得出现真实的 config 测试夹具 | ✓ 成立 | 夹具全在 `os.tmpdir()`；测试后 `git status` 无残留 |
| 测试不得断言 YAML 引号风格或原文片段 | ✓ 成立 | 仅 V13 扫原文内容（非引号风格），测试断言退出码 + check code |
| 不得修改 `examples/home-assistant-app/*.example` | ✓ 成立 | 本阶段改动文件列表不含 `examples/`；V13 只扫两个生成物 |
| 不得新增任何运行时或开发依赖（js-yaml 为唯一依赖，D-04） | ✓ 成立 | `devDependencies` 键集仍为 `{ js-yaml }`；测试只用 node 内置模块 |

## 需求逐条裁定（APP-01..APP-04）

| Requirement | 描述摘要 | 静态裁定 | 说明 |
|---|---|---|---|
| **APP-01** | 用户可在 HAOS App 商店添加 HomeWeave Git 仓库 URL，并在 Apps 列表看到名为 HomeWeave 的条目 | ⚠️ 未验证（人工） | 静态可证的前提齐备（`repository.yaml` 唯一且三字段正确、仓库根结构符合 Supervisor 约定）；「Supervisor 识别 + 商店渲染出可安装条目」不可静态证明 → 移交 Phase 7 实机证据 |
| **APP-02** | `config.yaml` 声明 amd64/aarch64、Ingress 入口与端口、`/data` 持久化、HA API 权限与启动/停止/健康相关字段，且可通过 Supervisor schema 校验 | ⚠️ 部分满足 + 一处 gap | arch/ingress/ingress_port/init/homeassistant_api 均已声明；`/data` 持久化是 Supervisor 隐式行为（无需键）；`watchdog/startup/boot/healthcheck` 未声明，依赖 Supervisor 默认值（最小字段集决策）——**这是决策锁定的结果但与本条需求文字存在落差，需人工确认是否接受**；而「schema 校验通过」的静态替身被 HI-02 削弱（删 `image`/`init`/`ingress`/`homeassistant` 仍 exit 0），故静态层不构成 APP-02 的完整守卫 |
| **APP-03** | 仓根 `repository.yaml` 提供仓库名称、URL 与 maintainer，使 Supervisor 能识别为有效 App 仓库 | ✓ 静态通过 | 三字段值逐字正确、唯一一份；「Supervisor 识别」部分并入 APP-01 的人工验证 |
| **APP-04** | 暴露用户可配置选项（至少日志级别与可选 HA URL 覆盖），`config.yaml` 给出 `options` + `schema` 及默认值 | ✓ 静态通过 | `options`/`schema`/默认值/DSL 字面值均正确且有 V11 交叉检查与负向用例；渲染效果属人工验证 |

**占位符决策锁定（目标后半句）**：仓库内占位符扫描结果为空集（`placeholders: []`），无任何 `<owner>` 类模板残留；D-01a/D-02/D-03a/D-04/D-05a/D-07/D-09 均已落进产物或文档。✓ 达成。

## 实际运行的命令与真实退出码

| 命令 | Exit | 输出要点 | 来源 |
|---|---|---|---|
| `corepack pnpm generate:app` | **0** | `node scripts/generate-app-metadata.mjs` 正常结束 | 编排器实跑（evidence.json） |
| `git status --porcelain`（生成后） | **0** | 仅 `?? .planning/.tmp/`、`?? .planning/phases/01-app/01-REVIEW*.md`、`?? .planning/state.json` — **两份生成物无改动** | 编排器实跑 |
| `corepack pnpm validate:app` | **0** | `✓ 58 checks passed` | 编排器实跑 |
| `corepack pnpm test:app` | **0** | `1..15` / `# pass 15` / `# fail 0` / `# skipped 0` | 编排器实跑 |
| 全仓 `config.*` / `repository.yaml` 扫描 | **0** | 命中：`homeweave_app/config.yaml`、`repository.yaml`（各 1 份） | 本次核验实跑 |
| `node gsd-tools.cjs query verification.fingerprint ...` | **0** | 见 frontmatter `covered_digest` | 本次核验实跑 |

> **对 exit 0 的克制解读**：`validate:app` 与 `test:app` 全绿**只证明当前已提交产物没问题**，不证明「守卫覆盖了必需项」。01-REVIEW.md 的变异实测（在 `%TEMP%` 隔离副本上做、未改仓库）显示多处该红的地方是绿的——这正是下方两条 gap 的依据。verification 不因绿灯而调低严重性。

## 未验证项与原因

1. **Supervisor 实机识别与商店渲染（APP-01 核心）** — 无 HAOS 环境；这是本阶段目标的运行时半边，静态层只能提供必要条件。
2. **Supervisor schema 实际校验通过（APP-02 后半句）** — 本地校验器是复刻而非 Supervisor 本体（`REMOVE_EXTRA`、`RE_SLUG` 等语义靠研究文档复刻）。
3. **安装/启动/升级路径** — 依赖 Phase 2 镜像发布（`ghcr.io/zee1988/homeweave-ha-app` 无 tag，tag 由 version 驱动）。
4. **D-02 单一来源往返行为** — 无自动化用例 spawn 生成器（HI-01），仅一次性人工观测。
5. **`watchdog/startup/boot/healthcheck` 缺失是否符合 APP-02 文字** — 属需求解释问题（最小字段集决策 vs 需求原文），需人工裁定，verification 不代决策。

## 下一阶段交接

- **移交 Phase 7（文档与三类验证证据）**：第 1–5 项未验证内容应作为「HAOS 未验证 / 待实机」类证据登记；Phase 7 成功标准 1 的「添加仓库 → 安装 → 启动 → 侧边栏打开」流程正是 APP-01 的最终判据。
- **本阶段需先闭合的 gap（阻断进入下一阶段的静态守卫缺口）**：
  1. **HI-02 — 必需键缺失静默通过**：把必需键提升为精确最小键集并逐键断言，反向拒绝未知键（同时覆盖 APP-02 的必需性与 V8 白名单）；补 `name/slug/description/url/homeassistant` 的类型/格式断言（MD-02）。
  2. **HI-01 — 生成物 vs 源 JSON 零漂移守卫缺失**：`01-VALIDATION.md:49` 已把该验证指派给自动化，但无实现。加 `--check` 模式并接入 `test:app`/CI，否则「改了源忘了重生成」永远绿灯。
- **建议同一轮处理（非阻断）**：HI-03（生成器源键白名单 + `buildSchemaDsl` 显式守卫）、MD-01（两阶段写盘）、MD-04（`scalar()` 改 plain-scalar 白名单）、MD-05（`engines >=22` 或 `node --test scripts/`）、LO-01（注释 ports 块存在性断言）。
- **Phase 2 提醒**：`test:app` 的 Node 版本门禁（MD-05）会直接影响 CI 选型，建议在 CI 落地前修掉。

---

_Verified: 2026-10-27T14:31:40Z_
_Verifier: CodeBuddy (gsd-verifier)_
