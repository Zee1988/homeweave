---
phase: 02-image-release
plan: "02"
subsystem: data
tags: [prisma, prisma-7, sqlite, migration, engine-decision, cross-arch, zero-dependency]

requires:
  - "02-01 的 workspace 骨架与 `apps/api`（tsc 构建、`typecheck` 真实执行）"
  - "`prisma@7.10.1`（devDependencies）与 `@prisma/client@7.10.1`（dependencies），均为精确版本 —— 实际落在 02-01 的提交 `c739135` 内，见 Deviations #5"
  - "`docs/13_ADR.md` ADR-005（SQLite）与 `docs/21:105`（`/data` 持久卷）"
provides:
  - "`apps/api/prisma/schema.prisma`：sqlite datasource + `prisma-client` generator + 单一低承诺模型 `AppSetting`"
  - "`apps/api/prisma.config.ts`：Prisma 7 的连接串入口（`DATABASE_URL`，默认 `file:./data/app.db`）"
  - "`apps/api/prisma/migrations/20261028000037_init/migration.sql`：空库可应用的初始迁移"
  - "`apps/api/prisma/ENGINE_DECISION` = `RUST_FREE`：**有证据支撑的跨架构判定**，02-03 的引擎断言据此降级为 skipped"
  - "`scripts/probe-prisma-engine.mjs` + 14 个测试：可重跑的引擎形态探测（从磁盘产物推导，不看 `--version` banner）"
  - "编译后的 client 位于 `apps/api/dist/generated/prisma/`（9 个 `.js`），02-03 的 COPY 目标"
affects: [02-03 Dockerfile COPY 路径与引擎断言, 02-04 CI 门禁, Phase 04 真实数据模型]

actuals:
  tokens: 5250
  tasks: 6
  commits: 3

plan_head_before: 251e1c65cb1d12f3663710e4f8fb323f228fc932
plan_head_after: 39cb48bffc5794e12dffd14320d3a5e09b00f162

tech-stack:
  added: []
  patterns:
    - "Prisma 7 形态：datasource 不再写 `url`，连接串由 `prisma.config.ts` 读环境变量 —— 计划原文的 `url = env(\"DATABASE_URL\")` 在 7.10.1 上直接 P1012"
    - "generator 用 `prisma-client` + 显式 `output`：生成 **TypeScript 源码**，由 `tsc` 编译进 `dist`，镜像只需 dist"
    - "引擎形态由「探测生成的 client 目录里有无原生二进制」判定，而非 `prisma --version` banner —— banner 描述 CLI，不描述 client"
    - "探测失败关闭（fail-closed）：找不到 client 目录返回 `null` 而非 `RUST_FREE`；`RUST_FREE` 与 schema 残留 `binaryTargets` 互斥校验（注释内的字样不算）"
    - "结论落盘为单一 token 文件 `ENGINE_DECISION`，成为跨 plan 的可检查契约，而不是靠人「记得删掉」"

key-files:
  created:
    - apps/api/prisma/schema.prisma
    - apps/api/prisma.config.ts
    - apps/api/prisma/migrations/20261028000037_init/migration.sql
    - apps/api/prisma/migrations/migration_lock.toml
    - apps/api/prisma/ENGINE_DECISION
    - scripts/probe-prisma-engine.mjs
    - scripts/probe-prisma-engine.test.mjs
  modified:
    - apps/api/package.json
    - package.json
    - .env.example
    - .gitignore
    - docs/14_ENV_AND_DEPLOYMENT.md

key-decisions:
  - "generator 用 `prisma-client` 而非计划写的 `prisma-client-js`：后者在 7.10.1 上仍能通过 `validate`，但**不生成任何代码**，是静默失效。改用 `prisma-client` + `output = \"../src/generated/prisma\"`（计划「已知风险」第 1 条已授权该偏离）"
  - "datasource 只留 `provider = \"sqlite\"`：Prisma 7 移除 schema 内 `url`，写了会 P1012"
  - "client 输出到 `src/generated/prisma` 并被 `.gitignore` 忽略：它是 schema 的派生物，编译进 `dist` 后镜像只需 `dist` + `@prisma/client` 的 runtime"
  - "模型只放 `AppSetting` 一张低承诺表：真实业务模型（会话、设备、策略、审计）由 Phase 04 决策，此处提前长表会锁死后续迁移"
  - "`build` 改为 `prisma generate && tsc`：保证 `dist` 与 client 同源，删掉 dist 后仍可一键重建（已实测）"
  - "`db:migrate:deploy` 只供 CI/维护使用，**不在镜像内调用**（D-1：镜像只分发迁移文件）"
  - "`.env.example` 的 `DATABASE_URL` 保留本地开发值 `file:./data/app.db`，容器值 `file:/data/homeweave.db` 写在注释里：模板文件不该默认指向一个本机不存在的绝对路径"
  - "探测脚本额外校验 `newest artifact mtime` 并打印：证明目录是本次生成的，不是上一次 generator 设置留下的旧产物"

patterns-established:
  - "「判定」类产物必须由可重跑脚本 + 落盘结论文件共同构成，且脚本对结论有反向校验（不能只写不验）"
  - "凡 `RUST_FREE` 结论，同时断言 schema 未残留对应配置，防止结论与配置各说各话"
  - "`RUST_FREE`/`NATIVE_ENGINE` 常量从脚本导出，测试与 CLI 共用同一套规则，避免两处判定漂移"

requirements-completed: [IMG-02]
requirements-partial: [IMG-01]

coverage:
  - id: D1
    description: "`apps/api/prisma/migrations/` 下存在 `<timestamp>_init/migration.sql`，内容可被 SQLite 接受"
    requirement: IMG-02
    verification:
      - kind: other
        ref: "apps/api/prisma/migrations/20261028000037_init/migration.sql（144 B，`CREATE TABLE \"AppSetting\" ...`）+ migration_lock.toml（124 B）"
        status: pass
    human_judgment: false
  - id: D2
    description: "对全新空 sqlite 文件执行 `prisma migrate deploy` 能 exit 0 并建出表"
    requirement: IMG-02
    verification:
      - kind: other
        ref: "DATABASE_URL=file:.tmp/verify.db → `All migrations have been successfully applied.`，exit 0；空库由 prisma 当场创建（`SQLite database verify.db created`）"
        status: pass
      - kind: other
        ref: "node 断言 apps/api/.tmp/verify.db（20,480 B）包含 `AppSetting` → `TABLE_CHECK=0`；`git status` 无 .db；`git check-ignore` 命中 `.gitignore:18:.tmp/`"
        status: pass
    human_judgment: false
  - id: D3
    description: "在没有任何先验 client 的干净工作树上 `build` 仍成功（build 前置 generate）"
    requirement: IMG-02
    verification:
      - kind: other
        ref: "删除 apps/api/dist 与 apps/api/src/generated → `corepack pnpm --filter @homeweave/api build` exit 0，`✔ Generated Prisma Client (7.10.1) ... in 46ms`，dist/main.js 与 src/generated/prisma 均重建，无 sourceMappingURL"
        status: pass
    human_judgment: false
  - id: D4
    description: "Prisma Client 生成产物位置被记录，供 02-03 的 Dockerfile COPY 使用"
    requirement: IMG-01
    verification:
      - kind: other
        ref: "源：apps/api/src/generated/prisma（9 文件）；编译后：apps/api/dist/generated/prisma（9 个 .js，dist 共 11 个 .js）"
        status: pass
    human_judgment: false
  - id: D5
    description: "`prisma` CLI 是 devDependency，运行时不进入镜像（D-1）"
    requirement: IMG-02
    verification:
      - kind: other
        ref: "apps/api/package.json：`dependencies` 无 `prisma`，`devDependencies.prisma = \"7.10.1\"`；`@prisma/client` 在 dependencies"
        status: pass
    human_judgment: false
  - id: D6
    description: "arm64 镜像是否会因 amd64 生成的原生引擎而在首次查询时崩溃（T-02-02 的实质）"
    requirement: IMG-02
    verification:
      - kind: other
        ref: "probe：client dir 9 文件 / native binaries 0 / ok: RUST_FREE（两次，含删 dist 重建后）"
        status: pass
    human_judgment: true
    rationale: "判定为 RUST_FREE（无原生引擎），但「arm64 容器内真实查询不崩」仍无实机证据 —— 本机无 Docker、无 arm64 环境。证明的是「不存在平台相关二进制」这一前提，不是「容器已跑通」。归 02-03 的 CI 多架构构建与 Phase 07 实机验证。"

duration: ~60min（跨一次执行器会话 + 一次编排补账会话）
completed: 2026-10-28
status: complete
---

# Phase 2 Plan 02: Prisma Client 与初始迁移 Summary

**IMG-02 要求镜像内自带 Prisma Client 与迁移文件。本计划让两者在本仓库真实存在，并把「arm64 镜像会不会因 amd64 引擎而崩」从一句警告变成一个可重跑的判定：探测生成的 client 目录，0 个原生二进制 → `RUST_FREE`，`binaryTargets` 整条配置作废，02-03 的引擎断言据此降级而不是靠人记得删代码。**

## Performance

- **Duration:** ~60 min（一次执行器会话 + 一次编排补账会话）
- **Completed:** 2026-10-28
- **Tasks:** 6/6
- **Files modified:** 12（7 新增、5 修改）
- **Commits (measured):** 3（`251e1c6..39cb48b`）；另 Task 1 的依赖钉版内容落在 02-01 的 `c739135` 内，见 Deviations #5
- **actuals.tokens 口径：** 新增 525 行 × 平均 40 字符 / 4 ≈ 5,250 tokens。这是**估算**，不是逐字节统计（02-01/02-03 的口径为实际字节 / 4）。计划未给 estimate，不计算偏差比。

## Accomplishments

- **引擎判定有证据，且能自己复验**：`corepack pnpm probe:prisma-engine` → client dir `apps/api/src/generated/prisma`、`files scanned: 9`、`native binaries: 0`、`ok: RUST_FREE`。删掉 dist 与 generated 重建后再跑一次，结论相同。判据是磁盘文件的扩展名与文件名前缀（`*.node`、`libquery_engine*`、`query_engine-*`），不是 `prisma --version` 的 banner。
- **探测失败关闭**：找不到 client 目录时返回 `decision: null` 并报 `generated client dir not found; run prisma generate first`，绝不把「没有产物」说成「没有引擎」。这一条有专门测试（`never claims RUST_FREE when no generated client directory exists`）。
- **结论与配置强制一致**：判定 `RUST_FREE` 时若 schema 仍残留 `binaryTargets` 则判红；只出现在注释里的字样不算（`stripComments` 先剥注释再匹配）。两个方向都有测试。
- **迁移真的能应用**：对不存在的空库执行 `prisma migrate deploy`，prisma 当场建库、应用 `20261028000037_init`，退出 0；随后对 20,480 字节的 db 文件断言含 `AppSetting`。仓库不被污染（`.tmp/` 已 gitignore，`git check-ignore` 可证）。
- **构建自给自足**：删 `dist` 与 `src/generated` 后 `build` 仍 exit 0，46ms 内重新生成 client 并编译出 `dist/main.js`，无 `sourceMappingURL`。Task 5 要证明的「构建不依赖手工预生成」成立。
- **零新增第三方依赖**：probe 脚本只用 `node:fs`/`node:path`/`node:url`；`prisma.config.ts` **刻意不引 `dotenv`** —— Prisma 7 不再自动加载 `.env`，为此加一个包不值，改为「导出环境变量或走默认值」。
- **门禁未回归且用例数上升**：`lint` 21 files exit 0（19 + 2 个新 mjs）、`typecheck` exit 0、`test` **89/89 pass**（75 基线 + 14 个 probe 用例）。

## Task Commits

1. **Task 2 + Task 5 的 schema/config/migration 部分** — `b84484f` `feat(02-02): add prisma schema, config and initial migration`
2. **Task 3 的判定产物与探测脚本** — `41e2320` `feat(02-02): derive prisma engine decision from generated artifacts`
3. **Task 2 的 `.env.example`/`.gitignore` 与 docs 同步** — `39cb48b` `docs(02-02): document DATABASE_URL per deployment shape and ignore derived client`

**Task 1**（版本钉装）的内容因 `apps/` 当时整目录未跟踪，已并入 02-01 的提交 `c739135`。
**Task 4 / Task 6** 无独立代码产物（迁移文件已由 `b84484f` 承载，门禁复核不改文件），其验收在下方实测记录中。

**Plan metadata:** 本 SUMMARY 的 docs 提交另计，不在上面 3 个内。

## Files Created/Modified

- `apps/api/prisma/schema.prisma`（新增，1,619 B）- sqlite datasource（无 `url`）、`generator client { provider = "prisma-client"; output = "../src/generated/prisma" }`、单一模型 `AppSetting(key/value/updatedAt)`；文件头写明「真实业务模型归 Phase 04」与 Prisma 7 的三条形态事实。
- `apps/api/prisma.config.ts`（新增）- `defineConfig({ schema, migrations.path, datasource.url })`；`DATABASE_URL ?? 'file:./data/app.db'`；注释说明为何不加 `dotenv`、容器内用 `file:/data/homeweave.db`。
- `apps/api/prisma/migrations/20261028000037_init/migration.sql`（新增，144 B）- `CREATE TABLE "AppSetting" (...)`，标准 prisma 输出。
- `apps/api/prisma/migrations/migration_lock.toml`（新增，124 B）- `provider = "sqlite"`。
- `apps/api/prisma/ENGINE_DECISION`（新增，11 B）- 恰好一行 `RUST_FREE`。
- `scripts/probe-prisma-engine.mjs`（新增，212 行）- 导出 `probe`/`checkDecision`/`readGeneratorOutput`；`output` 按 **schema 文件所在目录**解析（不是仓库根、不是包目录 —— 解析错基准就会得到假的 `RUST_FREE`，文件头把这个坑写明了）；三个候选目录按特异性排序，第一个存在的胜出。
- `scripts/probe-prisma-engine.test.mjs`（新增，14 例）- 覆盖 output 基准解析、`RUST_FREE`/`NATIVE_ENGINE` 两侧、无目录不判绿、`ENGINE_DECISION` 缺失/非法/不一致、`binaryTargets` 残留、注释内字样不算、`.node` 与前缀标记识别、CLI 双向退出码。
- `apps/api/package.json`（修改，+5/−2）- `build` 改 `prisma generate && tsc -p tsconfig.json`；新增 `db:generate`、`db:migrate:deploy`。
- `package.json`（修改，+1）- 新增 `probe:prisma-engine`。
- `.env.example`（修改，+7）- `DATABASE_URL` 三种形态的注释说明（本地 / 一次性校验 / HA App 持久卷），并写明不得提交 `.db`。
- `.gitignore`（修改，+8）- `.tmp/`、`apps/api/.env`、`apps/api/src/generated/`。
- `docs/14_ENV_AND_DEPLOYMENT.md`（修改，+2）- 一段 `DATABASE_URL` 随部署形态变化的说明 + Prisma 7 起连接串不在 schema 里。

## Decisions Made

- **`prisma-client-js` → `prisma-client`**：`validate` 对前者照样通过，但生成阶段什么都不产出。这是本计划最危险的静默失效点 —— 若不核对生成目录，`ENGINE_DECISION` 会得到一个「空目录里没有引擎」的假 `RUST_FREE`。计划「已知风险」第 1 条已授权改用 `prisma-client` + 显式 `output`，此处为落地。
- **datasource 不写 `url`**：Prisma 7 下写 `url = env("DATABASE_URL")` 报 P1012。连接串迁到 `prisma.config.ts`，与计划 Task 2 step 1 的字面不符，属必须偏离。
- **`.env.example` 保留本地值**：计划 Task 2 step 4 要求写 `DATABASE_URL=file:/data/homeweave.db`。照写会让任何本地 `cp .env.example .env` 的人都指向一个不存在的绝对路径。改为「模板写本地值，容器值写注释并指向 docs/21」。
- **探测基准取 schema 目录**：`output = "../src/generated/prisma"` 是相对 schema 文件解析的。计划 §Task 3 step 1 已经警告过上一版「探测 `apps/api` 递归」会永远探不到引擎 —— 本实现把这条警告固化成函数注释与一条专门测试。
- **`newest artifact mtime` 打进输出**：光有「0 个原生二进制」不足以排除「这是一个旧的、用别的 generator 设置生成的目录」。时间戳让这个反证据可见。

## Deviations from Plan

### 按计划授权项的偏离

**1. [计划已授权] generator 由 `prisma-client-js` 改为 `prisma-client` + 显式 `output`**
- **依据:** 计划「已知风险」第 1 条；Task 2 acceptance 要求「含显式 `provider = "prisma-client-js"`」因此不再字面成立。
- **同步要求:** 计划明确要求「必须同步更新 02-03 的 COPY 路径与 import 路径」。**02-03 必须知道：client 不再是 `node_modules/.prisma/client`，而是 `apps/api/src/generated/prisma` → 编译后 `apps/api/dist/generated/prisma`。**

**2. [Rule 1 - Bug] Prisma 7 移除 schema 内 datasource `url`**
- **Found during:** Task 2 首次 `prisma validate`
- **Issue:** 计划 Task 2 step 1 写的 `url = env("DATABASE_URL")` 在 7.10.1 上直接 P1012。
- **Fix:** datasource 只留 `provider`；连接串移入 `apps/api/prisma.config.ts`，同步更新 `docs/14` 与 `.env.example` 注释。
- **Verification:** `prisma validate` → `The schema at prisma\schema.prisma is valid 🚀`，exit 0。

**3. [Rule 2 - 一致性] `.env.example` 不写容器绝对路径**
- **Issue:** 计划要求的 `file:/data/homeweave.db` 作为模板默认值会误导本地开发。
- **Fix:** 模板保留 `file:./data/app.db`；容器值以注释形式给出并指向 `docs/21`。`docs/14` 增加一段说明三种形态不可混淆。

### 记账类偏离

**4. [Rule 2 - 记账] 执行器会话在写盘后、提交前耗尽上下文**
- **现象:** 代码与配置全部落盘且实测全绿，但 **0 个提交、无 SUMMARY**，工作树留下 5 个修改 + 5 个未跟踪项。
- **处置:** 由编排侧逐项复验（三条门禁、`prisma validate`、clean build、空库 deploy、probe 两次）后补做 3 个原子提交并撰写本 SUMMARY。
- **影响:** 本计划的提交历史**不是**由执行者的任务流自然产生的，而是补记的。上面的「Task Commits」按内容归属划分，不声称逐 Task 的时序。

**5. [Rule 2 - 记账] Task 1 的依赖钉版落在 02-01 的提交里**
- **Issue:** `apps/` 整目录当时未跟踪，`apps/api/package.json` 与 `pnpm-lock.yaml` 无法按 hunk 拆分。
- **后果:** `251e1c6` 这个 `plan_head_before` 其实**已经包含** Task 1 的成果。02-01-SUMMARY 的 Deviations #2 记录了同一件事的反向视角，两处记述一致。
- **未修:** 不重写历史；两处 SUMMARY 互相指向即可。

## Issues Encountered

- **PowerShell 把 prisma 的正常 stderr 当错误**：`corepack : Loaded Prisma config from prisma.config.ts.` 会触发 `NativeCommandError`，但退出码仍是 0。判断成败只看 `$LASTEXITCODE` 与关键输出行，不看 PowerShell 的红色文本。
- **`migrate deploy` 的相对路径基准是 `apps/api`**，不是仓库根：`DATABASE_URL=file:.tmp/verify.db` 实际落在 `apps/api/.tmp/verify.db`。计划给的验收脚本按仓库根去找会误判「db missing」。**这是本计划实测到的路径陷阱**，`apps/api/.tmp/` 已被 `.gitignore` 的 `.tmp/` 覆盖。
- **`prisma --version` 的 banner 有误导性**：它打印 `Query Compiler : enabled` 同时也打印 `Schema Engine : schema-engine-cli ... schema-engine-windows.exe`。前者说的是 client，后者是 CLI 的构建期工具。若据此判断「有原生引擎」就会得出与探测相反的结论 —— 这正是计划坚持「以生成目录为准」的原因。
- **CRLF 警告**：`git add` 时多处提示 `LF will be replaced by CRLF`（`core.autocrlf`），与 Phase 01 记录一致；diff 未见整文件行尾翻转。

## User Setup Required

None —— 无外部服务配置。`DATABASE_URL` 有默认值，不设置也能 `generate`/`build`/`migrate deploy`。

## Threat Flags

| Threat ID | 处置 | 本计划落地证据 |
|---|---|---|
| T-02-02（amd64 生成的原生引擎进入 arm64 镜像，容器首查即崩，high） | **按计划第 69 行判定 N/A** | `ENGINE_DECISION=RUST_FREE`，证据：`probe:prisma-engine` → `client dir: apps/api/src/generated/prisma` / `files scanned: 9` / `native binaries: 0` / `ok: RUST_FREE`（删 dist 重建后复跑一致）。schema 内无 `binaryTargets`，由 probe 反向校验强制。**02-03 的引擎断言应据此降级为 `- skipped (RUST_FREE)`，不改代码、靠开关。** |

无新增计划外攻击面。`DATABASE_URL` 的三种取值都写进文档，`.env`/`.tmp/`/`.db` 全部 gitignore。

## Known Stubs

无。不含 `TODO`/`FIXME`，无占位实现。四处**有意未验证**的边界已在正文标明，不构成 stub：

- **镜像层未验证**：本机无 Docker。client 能编译、迁移能应用，不等于镜像能构建、容器能跑。
- **arm64 未实测**：`RUST_FREE` 证明「不存在平台相关二进制」，不证明「arm64 容器内查询成功」。
- **`/data` 挂载后行为**：SQLite 在 Windows 与本机文件锁行为与容器内不同，迁移可应用性只证明 SQL 正确（计划「已知风险」第 2 条已注明）。
- **Phase 04 的真实 schema**：当前只有 `AppSetting` 一张低承诺表，业务表结构与迁移策略由 Phase 04 决策。

## Next Phase Readiness

**02-03（Dockerfile）有三个由本计划改变的输入，必须按新事实写，不能照 02-03 计划原文的旧假设：**

1. **COPY 路径变了**：Prisma Client 不在 `node_modules/.prisma/client`，而在 `apps/api/src/generated/prisma`，编译后是 `apps/api/dist/generated/prisma`（9 个 `.js`，`dist` 共 11 个 `.js`）。镜像拷 `apps/api/dist` 即可获得编译后的 client。
2. **运行期仍需要 `@prisma/client` 包**：生成的 `client.ts`/`class.ts`/`prismaNamespace.ts` 都 `import "@prisma/client/runtime/client"`（值导入，非 type-only）。**镜像裁剪不能把 `@prisma/client` 只当类型包删掉**，必须保留其 `runtime/` 子路径。`@prisma/client` 已在 `dependencies`，`prisma` CLI 在 `devDependencies`（不进镜像）。
3. **引擎断言降级为跳过**：读 `apps/api/prisma/ENGINE_DECISION`，值为 `RUST_FREE` 时断言输出 `- skipped (RUST_FREE)`。**不要**在 02-03 里硬编码「检查 libquery_engine 文件名」—— 那个前提已不成立。`scripts/probe-prisma-engine.mjs` 可直接复用，它对不一致会 exit 1。
4. **迁移文件要进镜像，但不执行**：`apps/api/prisma/migrations/` 按 IMG-02 需随镜像分发（D-1：镜像只分发，部署时由外部/CI 执行 `db:migrate:deploy`）。

**02-04（CI）注意**：`probe:prisma-engine` 依赖已生成的 client，CI 里须在 `prisma generate`（或 `build`）之后调用；顺序反了会得到 `generated client dir not found` 并 exit 1（这是设计行为，不是 bug）。

**门禁基线更新**：`test` 由 75 升至 **89**；`lint` 由 19 升至 **21**。任何时候这两个数字下降，说明有用例被删而非被跑过。

---

*Phase: 02-image-release*
*Completed: 2026-10-28*

## Self-Check: PASSED

- `apps/api/prisma/schema.prisma` — FOUND
- `apps/api/prisma.config.ts` — FOUND
- `apps/api/prisma/migrations/20261028000037_init/migration.sql` — FOUND
- `apps/api/prisma/ENGINE_DECISION` — FOUND (content: `RUST_FREE`)
- `scripts/probe-prisma-engine.mjs` — FOUND
- `scripts/probe-prisma-engine.test.mjs` — FOUND
- `.planning/phases/02-image-release/02-02-SUMMARY.md` — FOUND
- commit `b84484f` — FOUND (ancestor of HEAD)
- commit `41e2320` — FOUND (ancestor of HEAD)
- commit `39cb48b` — FOUND (ancestor of HEAD)
