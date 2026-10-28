---
phase: 02-image-release
plan: "03"
subsystem: build
tags: [docker, multi-stage, dockerfile, assertions, fail-fast, line-endings, ci-only]

requires:
  - "02-01 的 pnpm workspace 与可构建的 `apps/api`（`build` = `tsc`，`dist/main.js`）"
  - "02-02 的 Prisma Client（编译后位于 `apps/api/dist/generated/prisma`）、`apps/api/prisma/migrations/`、`ENGINE_DECISION=RUST_FREE`"
  - "`apps/api/package.json`：`@prisma/client@7.10.1` 在 dependencies，`prisma@7.10.1` 在 devDependencies"
provides:
  - "`Dockerfile`：base → build → prod-deps → runtime 四阶段，runtime 只拷四条路径"
  - "`.dockerignore`：泄露防线（`.env`/`*.pem`/`*.key`/`secrets`）+ 上下文卫生，且**不**忽略 `apps/api/prisma/migrations`"
  - "`scripts/ci/assert-image.sh`：8 条镜像内容断言，供 02-04 的 `verify-image` job 调用"
  - "`scripts/build-image.mjs` + `build:image`：本机 fail-fast（exit 1），CI 唯一构建入口"
  - "`scripts/validate-dockerfile.mjs` + 27 个用例：零依赖静态校验，22 条规则，本地可闭环"
  - "`pnpm lint` 现包含 `validate:dockerfile`，结构错误的 Dockerfile 无法合入"
  - "`.gitattributes`：`*.sh` / `Dockerfile` / `*.mjs` 固定 LF"
affects: [02-04 CI workflows（verify-image 调用 assert-image.sh）, Phase 07 HAOS 实机安装]

actuals:
  tokens: 13600
  tasks: 5
  commits: 5

plan_head_before: 28318fb5c63c4b92ebcad43bf46d1517a0babfcf
plan_head_after: 948240ea1fe3a6401c0ef2c4cf4b99f41d011a27

tech-stack:
  added: []
  patterns:
    - "四阶段镜像：build 阶段看得到整棵树，runtime 阶段只从 build/prod-deps 各拷固定路径，`COPY . .` 永不出现在最终阶段"
    - "`pnpm deploy --prod` 产出自包含 bundle，而不是直接拷 `/app/node_modules`：后者带 `.pnpm/` 与指向 `/app` 的绝对链接，relocate 到 runtime 的 `/app` 后无法解析"
    - "断言脚本的容器清理用 `trap ... EXIT`，不用末尾一行：`set -e` 下失败即刻退出，末尾清理在失败路径不可达，会泄漏容器"
    - "`${cid:-}` 而非 `$cid`：`set -u` 下早期退出时 trap 自身会因 unbound variable 失败，掩盖真实错误"
    - "条件性断言由**文件**（`ENGINE_DECISION`）驱动，不由「记得删掉那段代码」驱动；`RUST_FREE` 打印显式 `- skipped` 并仍计为 pass，文件缺失/非法则 exit 1"
    - "Dockerfile 静态校验进 `lint`，把「本地无 Docker」这个硬限制降级为「结构错误仍然拦得住」"

key-files:
  created:
    - Dockerfile
    - .dockerignore
    - .gitattributes
    - scripts/ci/assert-image.sh
    - scripts/build-image.mjs
    - scripts/validate-dockerfile.mjs
    - scripts/validate-dockerfile.test.mjs
  modified:
    - package.json
    - .planning/STATE.md

key-decisions:
  - "runtime 只拷四条路径（`dist`、`/prod/node_modules`、`prisma`、`package.json`），不拷 `src`、不拷 devDependencies、不拷 `*.map`"
  - "不写 `HEALTHCHECK`：Phase 03 之前没有任何 HTTP 端点，探针会让容器永久 unhealthy；「启动成功」由启动日志行 + `State.Running` 证明（D-7）"
  - "不声明 `VOLUME /data`：Supervisor 自己 bind-mount，声明 VOLUME 会额外造一个无人备份的匿名卷"
  - "密钥只走 `RUN --mount=type=secret`，不走 `ARG`/`ENV`/`COPY`：图层一旦泄漏无法修补（T-02-03）"
  - "`build:image` 的版本号**只**从 `homeweave_app/config.yaml` 读取，读不到就 exit 1，拒绝给镜像打 `undefined` 标签"
  - "`assert-image.sh` 用 `/bin/sh` 而非 bash：runtime 镜像基于 `node:22-bookworm-slim`，不保证 bash"
  - "`.gitattributes` 只钉三类文件，不用 `* text=auto`：后者会重排全仓库行尾，把本次改动埋在空白 diff 里"

patterns-established:
  - "凡「本机无法运行」的检查，落地为两条：静态校验（本地绿）+ 运行时断言（CI 调用），并在文档里写明各自证明了什么"
  - "断言与配置的一致性由文件开关强制（`ENGINE_DECISION` ↔ `binaryTargets`），而不是由散文约定"
  - "构建入口一律脚本化：裸命令无法解释「为什么失败」，只能把 PowerShell 的 `'docker' 不是内部或外部命令` 甩给用户"

requirements-completed: [IMG-05]
requirements-partial: [IMG-01, IMG-02, SEC-03]

coverage:
  - id: D1
    description: "Dockerfile 为多阶段且最终阶段以非 root 运行，`COPY . .` 不出现在最终阶段"
    requirement: IMG-01
    verification:
      - kind: other
        ref: "`pnpm validate:dockerfile` → `✓ dockerfile checks passed (22 rules)`，exit 0；4 个 FROM：base / build / prod-deps / runtime"
        status: pass
      - kind: other
        ref: "`USER node` 存在，`USER root` 不存在，`EXPOSE 8099`，`CMD [\"node\",\"dist/main.js\"]`"
        status: pass
    human_judgment: false
  - id: D2
    description: "镜像内容有 8 条断言，且脚本被真实调用而非孤立存在"
    requirement: IMG-01
    verification:
      - kind: other
        ref: "`scripts/ci/assert-image.sh`（254 行，LF）：1 devDeps / 2 源码 / 3 sourcemap / 4 产物 / 5 引擎（条件）/ 6 启动 / 7 history 密钥 / 8 文件系统密钥"
        status: pass
      - kind: other
        ref: "字面存在性检查按计划 verify 脚本执行通过（`history --no-trunc`、`Nest application successfully started`、`ENGINE_DECISION`、`.env`、`*.map`、`migrations`、`trap `、`RUST_FREE` 全部命中）"
        status: pass
    human_judgment: true
    rationale: "脚本无人调用就等于注释——调用方是 02-04 的 `verify-image` job，本计划只保证函数体与调用契约，尚不存在可运行的调用点。"
  - id: D3
    description: "本机 `build:image` 以 exit 1 fail-fast 且错误信息可辨"
    requirement: IMG-05
    verification:
      - kind: other
        ref: "`corepack pnpm build:image` → EXIT=1，输出含 `image builds are CI-only`"
        status: pass
      - kind: other
        ref: "`probeBuildx()` 以 `result.status === 0 && !result.error` 判定；`docker` 不在 PATH 时 `spawnSync` 返回 `error` 而非 status 0，已覆盖"
        status: pass
    human_judgment: false
  - id: D4
    description: "Dockerfile 结构缺陷在本地被拦住（6 类缺陷各有红例）"
    requirement: IMG-05
    verification:
      - kind: unit
        ref: "`node --test scripts/validate-dockerfile.test.mjs` → 27 tests / 27 pass / 0 fail，exit 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "三条统一门禁全绿，用例数只增不减"
    requirement: IMG-05
    verification:
      - kind: other
        ref: "`pnpm lint` → `✓ dockerfile checks passed (22 rules)` + `✓ lint passed (24 files)`，exit 0"
        status: pass
      - kind: other
        ref: "`pnpm test` → 116 tests / 116 pass / 0 fail，exit 0（89 → 116，+27）"
        status: pass
      - kind: other
        ref: "`pnpm check:app` exit 0；`pnpm typecheck` → `✓ typecheck passed (@homeweave/api)`，exit 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "镜像真的能构建、容器真的能启动、8 条断言真的跑过"
    requirement: IMG-01
    verification:
      - kind: other
        ref: "NOT RUN — 本机 `Get-Command docker` 为空，`Get-Command bash` 也为空"
        status: unknown
    human_judgment: true
    rationale: "全部容器内事实（build 成功、`pnpm deploy` 产物形态、启动日志、history 扫描、8 条断言的实际判定）在本机不可执行，只能由 02-04 的 CI 首跑给出。本计划证明的是「结构正确」与「失败路径可辨」，不是「镜像可用」。"
  - id: D7
    description: "`.sh` 不会因 Windows 的 autocrlf 以 CRLF 进入 CI"
    requirement: IMG-05
    verification:
      - kind: other
        ref: "`.gitattributes`：`*.sh text eol=lf`；`git add` 时的 `LF will be replaced by CRLF` 警告即该风险的实测证据"
        status: pass
      - kind: other
        ref: "工作树字节扫描：`scripts/ci/assert-image.sh` `crlf: false`，255 行"
        status: pass
    human_judgment: false

duration: ~50min（两次执行器会话 + 编排侧补完）
completed: 2026-10-28
status: complete
---

# Phase 2 Plan 03: 镜像构建与发布链路 Summary

**本机没有 Docker，所以这份计划的真实交付不是「一个能构建的镜像」，而是两件更硬的东西：一个结构上不可能把源码和密钥带进最终阶段的 Dockerfile，和一套失败路径全部显式的构建入口 —— 构建不了就 exit 1 并说清楚原因，引擎判定未知也 exit 1 而不是绿灯放行。**

## Performance

- **Duration:** ~50 min（两次执行器会话均因上下文上限中断，第三次由编排侧补完 Task 2/3/5）
- **Completed:** 2026-10-28
- **Tasks:** 5/5
- **Files modified:** 10（7 新增、3 修改）
- **Commits (measured):** 5（`28318f..948240`）
- **actuals.tokens 口径：** 新增 1,283 行 × 平均 42 字符 / 4 ≈ 13,600 tokens。估算值，非逐字节统计。计划未给 estimate，不计算偏差比。

## Accomplishments

- **四阶段镜像，最终阶段只认四条路径**：`dist`（已含编译后的 Prisma Client）、`/prod/node_modules`（`pnpm deploy --prod` 的自包含 bundle）、`prisma`（迁移历史，只分发不执行）、`package.json`。`src/`、devDependencies、`*.map`、spec 文件在结构上无处可进。
- **为什么不用 `COPY /app/node_modules`**：那是 pnpm 的 store 布局（`.pnpm/` + 指向 `/app` 的链接），relocate 到 runtime 后解析不到。`pnpm deploy` 是唯一自洽的解法，Dockerfile 里把这条推理和「首次 CI 若失败如何退化」都写在同一段注释里。
- **断言脚本的清理是 trap，不是末尾一行**：`set -e` 下任何一步失败都立即退出，写在末尾的 `docker rm` 永不执行 —— 每次红灯都会泄漏一个容器。`${cid:-}` 同理：`set -u` 下早期退出会让 trap 自己报 unbound variable，把真错误埋掉。
- **引擎检查由文件开关驱动**：`ENGINE_DECISION=RUST_FREE` → 打印 `- skipped (RUST_FREE)` 并计为 pass（这是 02-02 的实测结论，不是猜测）；文件缺失或取值非法 → exit 1。**没有第三条「跳过」出口**：一个什么都没验证的绿灯比红灯更危险。
- **本机能验的已验**：`validate:dockerfile` 22 条规则、27 个用例全绿；`build:image` exit 1 且信息含 `image builds are CI-only`；`lint` 24 files、`test` 116/116、`check:app` / `typecheck` 均 0。
- **CRLF 陷阱在提交前被拦住**：`git add scripts/ci/assert-image.sh` 打印 `LF will be replaced by CRLF`，`core.autocrlf=true` 会让 CI 里的 shebang 变成 `#!/bin/sh\r` 并报 `bad interpreter`。加 `.gitattributes` 钉死 `*.sh`/`Dockerfile`/`*.mjs` 为 LF，范围刻意收窄。
- **无新增第三方依赖**：`validate-dockerfile.mjs` 与 `build-image.mjs` 只用 `node:` 内置模块；`config.yaml` 的 `version` 用行级匹配而非引入 YAML 解析器。

## Task Commits

1. **Task 4（Dockerfile 静态校验）** — `3d22035` `test(02-03): add zero-dependency Dockerfile validator with red cases`（3 files, +686）
2. **Task 1（Dockerfile + .dockerignore）** — `373b487` `feat(02-03): add multi-stage production Dockerfile and build-context guard`（3 files, +180）
3. **Task 2（8 条镜像断言）** — `d504251` `feat(02-03): add image content assertions with conditional engine check`（1 file, +254）
4. **Task 3 + Task 5（构建入口 + 门禁接入）** — `3be7ad7` `feat(02-03): add fail-fast build:image command and gate lint on dockerfile checks`（2 files, +114/−1）
5. **行尾策略** — `948240e` `chore(02-03): pin LF endings for shell scripts and Dockerfile`（1 file, +17）

执行顺序刻意是 Task 4 → 1 → 2 → 3 → 5：Task 1 的 verify 依赖 Task 4 的校验器存在。

## Files Created/Modified

- `Dockerfile`（新增，116 行）- 四阶段；文件头把「刻意不做的事」（无 `HEALTHCHECK`、无 `VOLUME`、无密钥 plumbing）连同理由写死，防止后续「补齐」时重新引入。
- `.dockerignore`（新增，46 行）- 泄露防线 + 上下文卫生；显式注明 **不** 忽略 `apps/api/prisma/migrations`，因为 runtime 阶段从 build 阶段拷 `prisma/`，忽略它会产生一个「没有任何检查会红」的无迁移镜像。
- `.gitattributes`（新增，17 行）- `*.sh` / `Dockerfile` / `*.mjs` → `text eol=lf`。
- `scripts/ci/assert-image.sh`（新增，254 行，`/bin/sh`）- 8 条断言；`set -eu`；`trap cleanup EXIT`；`docker` 缺失 exit 1；`RUST_FREE` 分支显式 skip。
- `scripts/build-image.mjs`（新增，112 行）- `probeBuildx()` / `readAppVersion()` / `buildArgs()`；缺失 docker 时 exit 1；版本只读 `homeweave_app/config.yaml`。
- `scripts/validate-dockerfile.mjs`（新增，436 行）+ `scripts/validate-dockerfile.test.mjs`（新增，267 行，27 用例）- 22 条静态规则，6 类缺陷各一红例，喂临时字符串、不改真实 Dockerfile。
- `package.json`（修改，+3/−1）- 新增 `build:image`；`lint` 改为 `validate:dockerfile && lint-workspace`。
- `.planning/STATE.md`（修改）- 执行器与编排侧的进度同步。

## Decisions Made

- **`HEALTHCHECK` 写进注释而不是镜像**：Phase 03 之前 API 没有 HTTP 端点，任何探针都会让容器永久 `unhealthy`，而 App 的健康状态会因此永远显示异常。改用启动日志行 + `State.Running` 证明「起来了」。
- **`VOLUME /data` 不声明**：Supervisor 自己 bind-mount `/data`；声明 VOLUME 会额外造一个匿名卷，备份策略覆盖不到，等于给用户埋一个静默的数据丢失点。改为 `RUN mkdir -p /data && chown node:node /data`，保证非 root 首写成功。
- **`pnpm deploy --prod /prod` 而非拷 `node_modules`**：见上。`--legacy` 在 9.15.4 不存在（10 才有），脚本里已按 9.15.4 的 CLI 面写；产物形态留了退化方案注释。
- **`assert-image.sh` 用 `/bin/sh`**：runtime 是 `bookworm-slim`，bash 不保证存在；用 bash 会写出一个只在 CI 镜像里才暴露的 `not found`。
- **版本号单一来源**：`build:image` 只读 App 清单，读不到 exit 1。镜像标签与 Supervisor 看到的 App 版本不一致，是最难在事后发现的那类漂移。

## Deviations from Plan

### 自动修复 / 必要偏离

**1. [Rule 3 - 阻塞] 计划引用的 `docs/23` 不存在**
- **Issue:** Task 3 action 要求错误信息写成 `(see docs/23)`，但 `docs/` 下没有 23，镜像与 HAOS 部署说明在 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`。
- **Fix:** 信息改为指向 `docs/21_...`；`image builds are CI-only` 这一被断言的部分保持原样。
- **影响:** 计划 verify 只匹配 `image builds are CI-only`，仍然通过。

**2. [Rule 2 - 关键正确性] 计划未要求 `.gitattributes`，但缺了它 `.sh` 会以 CRLF 进 CI**
- **Found during:** `git add scripts/ci/assert-image.sh` 打印 `LF will be replaced by CRLF`。
- **Issue:** `core.autocrlf=true` 会在 checkout 时把 `.sh` 变成 CRLF，Linux 上 shebang 变 `#!/bin/sh\r` → `bad interpreter`。本机从不执行该文件，所以这个缺陷只会在 CI 首次运行时暴露。
- **Fix:** 新增 `.gitattributes`，只钉 `*.sh` / `Dockerfile` / `*.mjs`。

**3. [Rule 1 - Bug] 执行器两次因上下文上限中断，Task 2/3/5 由编排侧补完**
- **现象:** 第一次只提交了 Task 4 与 Task 1（`3d22035`、`373b487`）后中断；第二次同样在 Task 1 汇报点截断。`assert-image.sh` 已写盘但未提交，`build-image.mjs`、SUMMARY 完全缺失。
- **处置:** 编排侧逐项复验已提交部分（22 条规则、27 用例、Dockerfile 关键属性、CRLF 扫描），再补完 Task 2 提交、Task 3 脚本、Task 5 门禁接入与 SUMMARY。
- **影响:** 提交历史的时序不代表任务执行顺序；上面「Task Commits」按内容归属划分。

**4. [Rule 2 - 记账] `test` 未改动，因为 glob 已覆盖**
- **说明:** 计划 Task 5 要求「`pnpm test` 收编 `validate-dockerfile.test.mjs`」。现有 `test:app` 是 `node --test "scripts/**/*.test.mjs"`，新测试文件自动被收集（实测 116 用例含其 27 个）。因此未修改 `test` 脚本 —— 加一条显式路径只会让同一批测试被跑两次。
- **同步:** `lint-workspace.mjs` 未改，改的是 `package.json` 的 `lint` 组合方式，效果相同且更少改动面。

## Issues Encountered

- **`Get-Command docker` / `Get-Command bash` 均为空**：这决定了整份计划的验证边界。`build:image` 的 exit 1 与 `assert-image.sh` 的 exit 1 都是**设计行为**，不是缺陷。
- **`bash -n scripts/ci/assert-image.sh` 未执行**（本机无 bash）。计划 Task 2 的 verify 明确允许该分支，并要求记为 unknown。脚本语法只能由首次 CI Linux runner 实际执行时验证。**这不是「语法已校验」。**
- **PowerShell 会把多行 `Get-Content` 的调用拦下来**（项目 hook 要求显式 `-Encoding`），读取文件改用 read_file / node，避免反复踩同一个坑。
- **Dockerfile 工作树为 CRLF**：已由 `.gitattributes` 固化，Git 入库为 LF；Docker 对 CRLF 有容错，但不依赖该容错。
- **`.planning/tmp/` 仍为未跟踪**（GSD 临时产物，按规则不入库）。

## User Setup Required

None —— 本地无需 Docker 即可跑 `lint`/`typecheck`/`test`/`validate:dockerfile`/`build:image`（后者按设计失败）。

## Threat Flags

| Threat ID | 处置 | 落地证据 |
|---|---|---|
| T-02-03（密钥进入镜像图层，泄漏后无法修补） | mitigate | `.dockerignore` 挡 `.env`/`.env.*`/`*.pem`/`*.key`/`secrets`；Dockerfile 无 `ARG`/`ENV`/`COPY` 密钥通道，仅留 `RUN --mount=type=secret`；`assert-image.sh` 第 7/8 条在 CI 侧复查 history 与文件系统 |
| T-02-04（devDependencies、源码、sourcemap 进入生产镜像） | mitigate | runtime 只拷 4 条路径；`*` 断言脚本第 1/2/3 条复查；`tsconfig` 已 `sourceMap:false`，`.dockerignore` 再挡 `*.map` |

**新增攻击面：无。** 未新增外部入口、未新增依赖、未引入网络请求。`verify-image` 调用契约由 02-04 建立，本计划未提前创建 workflow 文件。

## Known Stubs

无。无 `TODO`/`FIXME`，无占位实现。**未验证项**（计划「已知风险」已列，非 stub）：

- **镜像从未构建**：`docker` 不存在。
- **`pnpm deploy --prod` 产物形态**：9.15.4 的 CLI 面已核对（`deploy --help` 列出 `-P, --prod`，无 `--legacy`），实际目录结构需首次 CI 确认。Dockerfile 注释里写了退化路径。
- **容器启动、8 条断言的实际判定**：全部未运行。
- **多架构（arm64）**：本计划只 `--platform linux/amd64`；跨架构 manifest 属 02-04。

## Next Phase Readiness

**02-04（CI 与发布）依赖本计划的三个契约：**

1. **`scripts/ci/assert-image.sh <image-ref>` 是唯一调用入口**：`verify-image` job 必须真实调用它（`sh scripts/ci/assert-image.sh <ref>`），否则脚本退化成注释 —— 这是本计划上一版的实际缺陷。脚本自身在 `docker` 缺失时 exit 1，所以 CI 里不要试图「跳过 docker 检查后再调用」。
2. **`build:image` 是本地唯一构建入口**，CI 可复用 `docker buildx build` 命令但**必须保持 `--platform linux/amd64` 与标签约定**；跨架构构建需要单独加 `--platform linux/amd64,linux/arm64` 并去掉 `--load`（改用 `--push`）。
3. **`ENGINE_DECISION=RUST_FREE` 仍是当前状态**：`assert-image.sh` 第 5 条会打印 `- skipped (RUST_FREE)`。若 02-04 或后续改用 NATIVE_ENGINE，**必须同时**让 `prod-deps` 阶段重新执行 `prisma generate`，否则镜像里没有引擎文件（Dockerfile 第 46–49 行已写明）。
4. **`.sh` 在 CI 中依赖 LF**：已由 `.gitattributes` 保障，不要用 `sed -i` 之类会重写行尾的工具批量改这些文件。

**门禁基线更新**：`lint` = 22 rules + **24 files**；`test` = **116**（89 → 116，+27）。这两个数字在 02-04 之后只能升不能降。

---

*Phase: 02-image-release*
*Completed: 2026-10-28*

## Self-Check: PASSED

- `Dockerfile` — FOUND
- `.dockerignore` — FOUND
- `.gitattributes` — FOUND
- `scripts/ci/assert-image.sh` — FOUND (LF, 254 lines)
- `scripts/build-image.mjs` — FOUND
- `scripts/validate-dockerfile.mjs` — FOUND
- `scripts/validate-dockerfile.test.mjs` — FOUND
- commit `3d22035` — FOUND
- commit `373b487` — FOUND
- commit `d504251` — FOUND
- commit `3be7ad7` — FOUND
- commit `948240e` — FOUND
