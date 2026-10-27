---
phase: 02-image-release
plan: "01"
subsystem: infra
tags: [pnpm-workspace, nestjs, tsc, lint, typecheck, negative-testing, zero-dependency]

requires:
  - "Phase 01 的 66 例 node:test 基线（`scripts/__tests__/*.test.mjs`）与 `js-yaml` 作为唯一 devDependency"
  - "Node 22.17 + corepack（提供 `corepack pnpm@9.15.4`）——本机未执行 `corepack enable`，裸 `pnpm` 不可解析"
provides:
  - "`pnpm-workspace.yaml`（`apps/*` + `packages/*`）与可 `--frozen-lockfile` 安装的 `pnpm-lock.yaml`"
  - "`apps/api`：由 tsc 直接编译的最小 NestJS 应用，`apps/api/dist/main.js` 可启动 —— 02-03 Dockerfile 的唯一 COPY 目标"
  - "`corepack pnpm lint`：19 文件扫描（mjs 语法 / YAML 解析 / JSON 解析），零第三方依赖"
  - "`corepack pnpm typecheck`：真实转发 `tsc --noEmit`，且「无包声明 typecheck」时判红（VER-01 的反假绿机制）"
  - "README 的「本地命令」与「启动冒烟（实测）」两节"
affects: [02-02 Prisma 接入, 02-03 Dockerfile 构建, 02-04 CI 门禁串接]

actuals:
  tokens: 4968
  tasks: 6
  commits: 1

plan_head_before: 05437589918b281039a875ecaa0422b1d50711f9
plan_head_after: c7391354ade45a52d08879c29400807685b2dedb

tech-stack:
  added:
    - "@nestjs/common ^12.3.0"
    - "@nestjs/core ^12.3.0"
    - "@nestjs/platform-express ^12.3.0"
    - "reflect-metadata ^0.2.2"
    - "rxjs ^7.8.2"
    - "typescript ^5.9.3 (dev)"
    - "@types/node ^22.20.5 (dev)"
  patterns:
    - "构建只走 tsc（`tsc -p tsconfig.json`），不引入 @nestjs/cli —— 减少攻击面与镜像体积"
    - "`sourceMap: false` 在 tsconfig 里关掉，从源头保证镜像内无 `.map`（IMG-02），而不是在 Dockerfile 里事后删"
    - "子进程调 pnpm 的两条路径：`npm_execpath`（经 pnpm run 调用时）与 `corepack pnpm@9.15.4`（直接 `node scripts/...` 时）"
    - "「没东西可查」必须判红：typecheck 脚本在零包声明时 exit 1，杜绝 VER-01 想禁止的假绿"
    - "门禁脚本只用 `node:` 内置 + 已存在的 js-yaml，4 个新 mjs 零新增依赖"

key-files:
  created:
    - pnpm-workspace.yaml
    - apps/api/package.json
    - apps/api/tsconfig.json
    - apps/api/src/main.ts
    - apps/api/src/app.module.ts
    - scripts/lint-workspace.mjs
    - scripts/lint-workspace.test.mjs
    - scripts/typecheck-workspace.mjs
    - scripts/typecheck-workspace.test.mjs
  modified:
    - package.json
    - pnpm-lock.yaml
    - README.md

key-decisions:
  - "裸 `pnpm` 在本机不可解析（未 `corepack enable`），`pnpm test` 若直接写 `pnpm run test:app` 必红；统一用 `corepack pnpm@9.15.4` 包裹，与 02-04 的 CI `pnpm/action-setup` 版本对齐，同时避免在根 package.json 加 `packageManager`（计划禁令）"
  - "`typecheck-workspace.mjs` 在「递归结果中无任何包声明 typecheck」时打印 `✗ no workspace package declares typecheck` 并 exit 1：否则删掉 apps/api 的 typecheck 脚本就能让 VER-01 静默变绿"
  - "判断「谁声明了 typecheck」只解析 `pnpm-workspace.yaml` 的 `prefix/*` 形式，不引入 glob 实现；遇到其它形式跳过而非猜测"
  - "`apps/api` 的 `version` 固定 `0.0.0` 并在 description 里写明与 HA App 0.1.0 无关 —— 防止后续有人拿它算镜像 tag"
  - "`@nestjs/platform-express` 必须显式安装：它是 `@nestjs/core` 的 optional peer，但 `NestFactory.create()` 运行期缺它会抛错，属运行必需最小集"
  - "`main.ts` 端口取 `Number(process.env.PORT ?? 8099)`，对齐 docs/21 的 `ingress_port: 8099`"
  - "保留原有 `generate:app`/`validate:app`/`check:app`/`test:app` 四条 script 不动，只在 `test` 里串联它们"

patterns-established:
  - "每个门禁脚本配一个 `node --test` 测试文件，且必须含至少一个「坏输入必须判红」的反例（lint 4 例 / typecheck 1 例）"
  - "负向断言三元组沿用 Phase 01：退出码非 0 + 退出码非 null + stdout 含预期标记"
  - "测试写临时树到 `os.tmpdir()`，绝不在仓库内造坏文件"

requirements-completed: [VER-01]
requirements-partial: [IMG-01]

coverage:
  - id: D1
    description: "干净 clone 上 lint / typecheck / test 三条命令各自 exit 0"
    requirement: VER-01
    verification:
      - kind: other
        ref: "corepack pnpm lint → exit 0, `✓ lint passed (19 files)`"
        status: pass
      - kind: other
        ref: "corepack pnpm typecheck → exit 0, `✓ typecheck passed (@homeweave/api)`，子进程真实输出 `tsc -p tsconfig.json --noEmit`"
        status: pass
      - kind: other
        ref: "corepack pnpm test → exit 0, # tests 75 / # pass 75 / # fail 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "`build` 产出 `apps/api/dist/main.js`，由 tsc 从 `apps/api/src/main.ts` 编译，且不含 sourceMappingURL"
    requirement: IMG-01
    verification:
      - kind: other
        ref: "corepack pnpm --filter @homeweave/api build → exit 0, apps/api/dist/main.js 存在，`sourceMappingURL` 断言 exit 0"
        status: pass
      - kind: other
        ref: "git check-ignore -v apps/api/dist/main.js → 命中 dist/ 规则（不进版本库）"
        status: pass
    human_judgment: false
  - id: D3
    description: "`node apps/api/dist/main.js` 能起进程并打印 Nest 启动日志"
    requirement: IMG-01
    verification:
      - kind: other
        ref: "Start-Process node apps/api/dist/main.js → boot.log 含 `Nest application successfully started`，随后进程已终止、boot.log 已删除"
        status: pass
    human_judgment: false
  - id: D4
    description: "`apps/api` 的 version 与 HA App version 解耦，不参与镜像 tag 计算"
    requirement: IMG-01
    verification:
      - kind: other
        ref: "apps/api/package.json version=0.0.0，description 明示与 homeweave_app/config.yaml 的 0.1.0 无关；README「本地命令」章节复述该事实"
        status: pass
    human_judgment: false
  - id: D5
    description: "Phase 01 的 66 例仍全绿，未被新脚本破坏"
    requirement: VER-01
    verification:
      - kind: other
        ref: "corepack pnpm test → 75 = Phase 01 的 66 + lint 5 + typecheck 4"
        status: pass
    human_judgment: false

duration: ~45min（跨两次会话；本计划只产生 1 个提交，无法用提交窗口核验）
completed: 2026-10-28
status: complete
---

# Phase 2 Plan 01: workspace 骨架与最小可构建 API Summary

**`apps/` 此前不存在，02-03 的 Dockerfile 没有任何真实产物可打包。本计划建立最小但真实可编译、可启动的 pnpm workspace 与 NestJS 应用，并把 VER-01 的三条可复现命令落地 —— 其中 `typecheck` 刻意做成「零包声明即判红」，因为一条永远绿的门禁比没有门禁更危险。**

## Performance

- **Duration:** ~45 min（跨两次会话）
- **Completed:** 2026-10-28
- **Tasks:** 6/6
- **Files modified:** 12（9 新增、3 修改）
- **Commits (measured):** 1（`c739135` = `0543758..HEAD`；本 SUMMARY 的 docs 提交另计）
- **actuals.tokens 口径：** 手写内容字符数 / 4 ≈ 4,968 tokens。计入 9 个新文件（17,622 字节）+ README 41 行 + 根 package.json 4 行，**排除 `pnpm-lock.yaml` 的 1,963 行**（机械产物，不代表本计划的手写产出）。计划未给 estimate，故不计算偏差比。

## Accomplishments

- **三条门禁真实可跑且全绿**（提交后复跑，非提交前快照）：`lint` exit 0（`✓ lint passed (19 files)` = 原有 17 + 新增 2 个 mjs）、`typecheck` exit 0（真实 `tsc --noEmit`）、`test` exit 0（`# tests 75 / # pass 75 / # fail 0`）。
- **「坏代码必须变红」已实测，而非声称**：把 `main.ts` 的 `const port = Number(...)` 改成 `const port: string = Number(...)`，`corepack pnpm typecheck` 返回 **exit 2** 并打印 `✗ typecheck failed (exit 2)`；还原后文件 SHA256 与改动前一致（`restored-identical=True`），工作树无残留错误。这一步是 VER-01 的实质证据 —— 没有它，「typecheck 通过」可能只是脚本没跑 tsc。
- **反假绿机制落地**：`typecheck-workspace.mjs` 在「没有任何包声明 typecheck」时判红（对应测试 `refuses to pass when no package declares typecheck`）。删掉 `apps/api` 的 typecheck 脚本不会让门禁变绿，只会让它红。
- **构建产物零 source map**：`tsconfig.json` 显式 `sourceMap: false`，`dist/main.js` 断言不含 `sourceMappingURL`。IMG-02 的「镜像内无 `.map`」从编译源头保证，不依赖 Dockerfile 事后清理。
- **启动冒烟通过**：`node apps/api/dist/main.js` 打印 `Nest application successfully started`，`boot.log` 事后删除。这是本机（无 Docker）唯一能闭环的镜像前置证明。
- **README 双向一致可自动核验**：断言 exit 0，捕获 `generate:app,check:app,validate:app,test:app,lint,typecheck,test` 七个 script 既在 `package.json` 也在 README 的行内代码中；散文里的「pnpm workspaces」按设计不参与匹配。
- **零新增第三方依赖**：4 个新 mjs 只用 `node:` 内置 + 已存在的 `js-yaml`；`devDependencies` 未因本计划增加任何门禁库。

## Task Commits

本计划在 `git.branching_strategy: "none"` + 串行模式下执行，6 个 Task 合并为 **1 个原子提交**（`c739135`，`feat`）：

1. **Task 1–6 一体提交** — `c739135` `feat(02-01): add pnpm workspace skeleton with minimal buildable NestJS API`

**Plan metadata:** 本 SUMMARY 与 `02-01-PLAN.md` 的 docs 提交另计，不在上面 1 个内。

**为什么没有逐 Task 提交：** Task 1–3 在上一会话完成时未提交，Task 4–6 在本会话完成，工作树里两批改动已交织（`apps/` 整目录未跟踪、`pnpm-lock.yaml` 同时含 workspace 与 Prisma 两类改动），按 hunk 拆分会产生「无法单独通过门禁」的中间提交。选择合并提交并在此显式记账，而不是伪造 6 个可能各自不绿的提交。

## Files Created/Modified

- `pnpm-workspace.yaml`（新增，43 B）- 仅 `packages:` 下 `- "apps/*"` 与 `- "packages/*"`；后者目录尚不存在也合法，为共享包预留。
- `apps/api/package.json`（新增，712 B）- `name: @homeweave/api`、`version: 0.0.0`、`private: true`；scripts 仅 `build`/`typecheck`/`start`，**不引入 @nestjs/cli**。
- `apps/api/tsconfig.json`（新增，486 B）- `target ES2022`、`module commonjs`、`outDir dist`、`rootDir src`、`strict`、装饰器两项开启、`sourceMap: false`、`skipLibCheck: true`。
- `apps/api/src/main.ts`（新增，408 B）- `NestFactory.create(AppModule)`、`port = Number(process.env.PORT ?? 8099)`、`listen(port, '0.0.0.0')`。
- `apps/api/src/app.module.ts`（新增，281 B）- `@Module({})` 空模块 + 一行注释说明控制器由后续阶段加入。
- `scripts/lint-workspace.mjs`（新增，4.7 KB / 143 行）- 扫 `*.mjs` 走 `node --check`（`execFileSync(process.execPath)`）、`*.yaml|yml` 走 js-yaml、`*.json` 走 `JSON.parse`；排除 `node_modules`/`dist`/`.git`/`.planning`；成功打印 `✓ lint passed (<n> files)`。
- `scripts/lint-workspace.test.mjs`（新增，3.0 KB / 89 行）- 5 例：合法 exit 0 且报计数、坏 JSON→exit 1 带行号、坏 YAML→exit 1 带行号、坏 mjs 语法→exit 1、`node_modules`/`dist`/`.planning` 不被扫。
- `scripts/typecheck-workspace.mjs`（新增，5.0 KB / 143 行）- 枚举 `packages:` 目录读各包 `package.json` 判定谁声明 typecheck → 递归执行并透传退出码；零声明时 `✗ no workspace package declares typecheck` + exit 1。
- `scripts/typecheck-workspace.test.mjs`（新增，3.0 KB / 83 行）- 4 例：零声明判红、成功透传 0、失败透传非 0、无 `package.json` 的目录被忽略。
- `package.json`（修改，+4/−1）- 新增 `lint`/`typecheck`/`test` 三条；`test` = `corepack pnpm@9.15.4 run test:app && corepack pnpm@9.15.4 -r --if-present test`；原有四条 script 未动。
- `pnpm-lock.yaml`（修改，+1963/−3）- workspace 骨架与依赖的完整锁定，供 CI `--frozen-lockfile`。
- `README.md`（修改，+41）- 新增「本地命令」（8 条命令 + version 解耦、本机无 Docker 两条事实）与「启动冒烟（实测）」小节；日志已去 ANSI 转义，PID/时间戳为实测原值。

## Decisions Made

- **子进程调 pnpm 走两条路径**：经 `pnpm run typecheck` 调用时用 `npm_execpath` 指向的 pnpm JS 入口（`node <execpath> -r ...`，跨平台、不依赖 shim）；直接 `node scripts/typecheck-workspace.mjs` 时回退 `corepack pnpm@9.15.4 -r ...`（经 shell 解析 `.cmd`）。两条路径均实测 exit 0。原因与 Task 1 同源：本机未 `corepack enable`，裸 `pnpm` 不可解析。
- **「零包声明」必须失败**：这是把 VER-01 从「命令存在」推进到「命令有效」的关键设计。计划原文即要求，实现时额外用测试 `refuses to pass when no package declares typecheck` 钉住。
- **`packages:` 只支持 `prefix/*`**：本仓库仅此一种形式，为零依赖手写 glob 匹配不划算；遇其它形式跳过。副作用是将来引入 `packages/**` 或否定模式会静默少扫包 —— 但不会假绿，因为「零声明」会判红。
- **不引入 `@nestjs/cli`**：构建只需 `tsc`，CLI 会把 webpack 探测、Husky、Update notifier 等带入 devDependencies，纯增攻击面。
- **`sourceMap: false` 写在 tsconfig**：比在 Dockerfile 里 `rm *.map` 更可靠 —— 后者漏删一个文件就破坏 IMG-02，且无法被本机测试覆盖。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 4 计划写的裸 `pnpm -r --if-present typecheck` 在本机不可执行**
- **Found during:** Task 4 实现时首次直接运行 `node scripts/typecheck-workspace.mjs`
- **Issue:** 裸 `pnpm` 未经 `corepack enable` 时由 `cmd.exe` 解析，报 `'pnpm' is not recognized`，脚本必然失败；这与 Task 1 已在计划里规避的坑是同一个，但 Task 4 原文仍写了裸 `pnpm`。
- **Fix:** 实现两条调用路径（`npm_execpath` / `corepack pnpm@9.15.4`），并把该机制**回写进 `02-01-PLAN.md` 的 Task 4 action**，避免后续复审把它当成实现擅自偏离。
- **Files modified:** `scripts/typecheck-workspace.mjs`、`.planning/phases/02-image-release/02-01-PLAN.md`
- **Verification:** 两条路径各跑一次，均 exit 0；`corepack pnpm typecheck` 亦 exit 0。
- **Committed in:** `c739135`（PLAN 回写部分见本 SUMMARY 的 docs 提交）

**2. [Rule 2 - 记账] 本计划提交额外携带了 02-02 Task 1 的依赖钉版**
- **Found during:** 补写本 SUMMARY、准备提交时
- **Issue:** `apps/` 整目录此前未跟踪，`apps/api/package.json` 与 `pnpm-lock.yaml` 已含 02-02 Task 1 的 `@prisma/client 7.10.1`（runtime）与 `prisma 7.10.1`（dev）。未跟踪文件无法按 hunk 干净拆分，强行回退重建 lockfile 会破坏已实测通过的安装状态。
- **Fix:** 合并提交，并在提交信息 body 里显式声明该越界内容及其原因（"Also carries 02-02 Task 1 dependency pins ... could not be split by hunk"）。
- **Impact:** `apps/api/package.json` 的依赖数由计划 T-02-01 断言的「运行 5 + 开发 2」变为「运行 6 + 开发 3」。**该数字断言在 02-01 提交时点已不再字面成立**，但它要防的风险（未钉版本的供应链面扩张）未被削弱：新增两项均为精确版本 `7.10.1`，且 `prisma` 正确落在 devDependencies。02-02 收尾时须复核该断言并更新 T-02-01 的验证口径。
- **Committed in:** `c739135`

### 与计划的字面差异（非缺陷）

- 计划 Task 3 要求 lint「所有 `*.yaml`/`*.yml`（含 `.github/workflows/*.yml`，若已存在）」—— `.github/workflows/` 在 02-04 才创建，本计划时点不存在，脚本按「存在则扫」处理，未提前造目录。

**Total deviations:** 2 auto-fixed（1 个本机不可执行 bug、1 个记账越界）。
**Impact on plan:** 无范围扩张（未提前实现 `/health`、优雅停止、日志脱敏、数据库、Docker）；无新增第三方依赖。

## Issues Encountered

- **管道缓冲导致 `pnpm add` 静默超时**：`corepack pnpm add ... | Select-Object -Last 12` 会等命令结束才输出，长时间无输出被误判为卡死。改用 `--reporter=append-only` 流式输出后正常（Task 1 相关，02-02 Task 1 期间遇到并已记录于该 plan 的执行过程）。
- **`corepack pnpm@9.15.4` 首次执行需联网**拉取 corepack 缓存；离线机器需预置。这是 `corepack` 方案相对 `corepack enable` 的已知代价。
- **CRLF 警告**：`git add` 时出现 `LF will be replaced by CRLF the next time Git touches it`（`core.autocrlf` 导致），与 Phase 01 记录的环境事实相同；diff 未出现整文件行尾翻转。
- **`gsd_run` SDK 命令行在本机不存在**：与 01-02/01-03 记录一致，状态类边角处理由人工判断代替。

## User Setup Required

None — 无外部服务配置。`corepack pnpm install` 会在本机首次生成 `node_modules`（约 200 MB，预期行为）。

## Threat Flags

计划内威胁处置执行情况：

| Threat ID | 处置 | 本计划落地证据 |
|---|---|---|
| T-02-01（一次性引入大量未钉版本依赖，medium） | mitigate | 全部依赖写入 `pnpm-lock.yaml` 供 CI `--frozen-lockfile`；未引入 `@nestjs/cli`。**注意**：验证项「运行 5 + 开发 2」已被 02-02 Task 1 的 Prisma 钉版覆盖为「6 + 3」，两项均为精确 `7.10.1`，见 Deviations #2 |

无新增计划外攻击面。

## Known Stubs

无。不含 `TODO`/`FIXME`，无占位返回值。两处**有意未覆盖**的边界已在正文标明，不构成 stub：

- **镜像层可构建性未验证**：本机无 Docker，`apps/api/dist/main.js` 能启动不等于镜像能构建、能运行。归 02-03（Dockerfile）与 02-04（CI）。
- **启动冒烟是单次观察**：6 秒窗口内出现启动行即通过，未验证端口占用、并发、长时间运行、优雅停止。这些属 Phase 03 范围，本计划明令不做。

## Next Phase Readiness

- **02-02（Prisma）可继续**：`prisma 7.10.1` CLI 与 `@prisma/client 7.10.1` 已按精确版本就位，`apps/api` 的 `typecheck`/`build` 脚本已能承载 schema 生成后的类型检查。Task 2–6（schema、引擎判定、初始迁移、build 前置 generate、门禁复核）未做。
- **02-03（Dockerfile）的 COPY 目标已存在**：`apps/api/dist/main.js` 由 `tsc` 产出、无 source map、可启动，且 `dist/` 已被 `.gitignore` 忽略（不会误入镜像上下文之外的版本库）。
- **02-04（CI）可直接串三条门禁**：`corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test`，均在仓根执行、以退出码为唯一信号、不依赖 Docker。CI 侧 pnpm 版本须钉 `9.15.4`，与 `test` script 内的 `corepack pnpm@9.15.4` 一致。
- **依赖版本一致性注意**：`@nestjs/*` 为 `^12.3.0`（caret），非精确版本。若 02-03/02-04 要求全量精确钉版，需在后续计划中显式处理这一点，不要默认它已满足。

---

*Phase: 02-image-release*
*Completed: 2026-10-28*

## Self-Check: PASSED

- `pnpm-workspace.yaml` — FOUND
- `apps/api/src/main.ts` — FOUND
- `scripts/lint-workspace.mjs` — FOUND
- `scripts/typecheck-workspace.mjs` — FOUND
- `.planning/phases/02-image-release/02-01-SUMMARY.md` — FOUND
- commit `c739135` — FOUND (ancestor of HEAD)
