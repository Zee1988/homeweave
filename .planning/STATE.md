---
gsd_state_version: "1.0"
milestone: v1.0
current_phase: 03
current_phase_name: 运行时骨架
status: executing
stopped_at: Completed 03-05-PLAN.md
last_updated: "2026-10-28T00:00:00.000Z"
last_activity: 2026-10-28
last_activity_desc: 0.1.1 镜像已发布（双架构，9 项镜像断言 + fail-fast + 优雅关闭全通过），等待真机验证
state_head: 19ec03d5badbfe45b284b5af3664f920263e330c
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 15
  completed_plans: 15
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-27)

**Core value:** HAOS 用户添加仓库 → 安装 → 启动 → 在 HA 侧边栏打开一个能跑的 HomeWeave。
**Current focus:** Phase 03 — 运行时骨架

## Current Position

Phase: 03 (运行时骨架) — EXECUTING
Plan: 5 of 5
Status: Ready to verify
Last activity: 2026-10-28 — 0.1.1 发布成功（run 40654684908：9 项镜像断言、exit 78、96 ms 排空、双架构 manifest）

Progress: [██░░░░░░░░] 28%  (2/7 phases verified, 15/15 plans executed)

## Performance Metrics

**Velocity:**
- Total plans completed: 15
- Average duration: ~33 min
- Total execution time: ~7.5 hours（含 Phase 02 的 CI 首跑与缺陷修复 ~2 h，不属于任何计划）

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 6 | ~0.4 h | ~7 min |
| 02 | 4 | ~7.1 h | ~107 min |

**Recent Trend:**
- Last 4 plans: 02-01 (~45 min), 02-02 (~60 min), 02-03 (~50 min), 02-04 (~150 min)
- Phase 02 额外投入 ~2 h 在「首次真实 CI 运行」上：三次真实失败各暴露一个本机绝无可能发现的缺陷（pnpm 版本漂移、`needs` 缺边、metadata-action 语法），另有两次校验器缺口
- Trend: 上升（Phase 02 计划均为跨文件 + 门禁接线；02-04 额外被两次执行器上下文上限打断，由编排侧复验补账）

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 12 min | 2 tasks | 6 files |
| Phase 01 P02 | 10 min | 3 tasks | 2 files |
| Phase 01 P03 | 4 min | 3 tasks | 4 files |
| Phase 02 P01 | ~45 min | 6 tasks | 12 files |
| Phase 02 P02 | ~60 min | 6 tasks | 12 files |
| Phase 02 P03 | ~50 min | 5 tasks | 10 files |
| Phase 02 P04 | ~150 min | 7 tasks | 11 files |
| Phase 03-runtime P02 | ~25min continuation | 4 tasks | 10 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- [Roadmap] 阶段按风险倒序：Phase 1 先验证 Supervisor 是否识别仓库与 App 元数据，而非先做运行时
- [Roadmap] 单条需求只映射到一个阶段；SEC-03 与 VER-01 归入 Phase 2（CI 与镜像门禁），其余 VER 归入 Phase 7
- [Roadmap] Phase 5 的 Web UI 载体（Expo Web 导出 vs 最小静态页）有意留白，须在 Phase 5 讨论时决策并记录
- [Roadmap] 需求总数由文档记录的 37 修正为实际清点的 38，Traceability 已按 38 条填满
- [Approval] 2026-10-27 用户批准 7 阶段路线图与需求映射，Phase 1 可进入规划
- [Phase 01]: App metadata generator uses line-by-line string templates, never js-yaml serialisation (a serialiser silently drops the D-07 commented ports block and cannot guarantee key order)
- [Phase 01]: app-metadata.json stores semantic values only; schema DSL strings (list(info|debug|warn), str?) are composed at generation time so the DSL text is never duplicated between source and artifact
- [Phase 01]: V7 (image tag vs version mismatch) is folded into V6 instead of being its own check code, because an untagged image cannot disagree with `version` — a separate code would have nothing to verify
- [Phase 01]: validator whitelists are Set constants used as a forward diff only; required-key presence stays with V2 so no failure is reported twice
- [Phase 01]: V13 scans exactly the two generated files, never the whole repo, because examples/*.example keep `<owner>`/`<repo>` on purpose (examples/README.md)
- [Phase 01]: V15 skips node_modules as a local false-positive guard only (commented as NOT a Supervisor rule); Supervisor's own filter is dot-segments + rootfs
- [Phase 01]: `test:app` is `node --test "scripts/**/*.test.mjs"` — a bare directory argument (`node --test scripts/`) is treated as a single test file on Node 22.17/win32 and fails with MODULE_NOT_FOUND
- [Phase 01]: negative tests inject the tree through spawnSync's `cwd` instead of adding a test-only branch to the validator; the file CI runs stays byte-identical to the file under test
- [Phase 01]: every negative assertion is the triple exit-1 / non-null status / check-code-in-stdout; a spawn failure must fail the case, never pass as a detection
- [Phase 01]: V15 and V11 each get a paired positive case (skip-list semantics; optional-key needn't have a default) so an over-strict implementation cannot pass unnoticed
- [Phase 01]: docs/21 §5 keeps `ports` commented and §11 carries a HAOS entry labelled 未在 HAOS 实机验证 / HAOS 未验证; §7's conditional "if 8124/tcp is exposed" clause is left untouched because it does not contradict the commented state
- [Phase 02]: 裸 `pnpm` 在本机不可解析（未 `corepack enable`），一律用 `corepack pnpm@9.15.4` 或经 `npm run` 转发；`typecheck` 在「没有任何包声明 typecheck」时必须判红，否则删掉包级脚本就能静默变绿（VER-01）
- [Phase 02]: Prisma 7 的 `generator prisma-client-js` 通过 `validate` 但**不生成任何代码**；必须用 `prisma-client` + 显式 `output`。任何「探测生成目录」的脚本若不按 schema 所在目录解析 `output`，会得到假的 `RUST_FREE`
- [Phase 02]: `ENGINE_DECISION=RUST_FREE`（client 目录 9 文件 / 0 原生二进制），`binaryTargets` 整条配置作废；02-03 的引擎断言据此降级为 skipped，而不是靠人改代码
- [Phase 02]: `migrate deploy` 的相对 `DATABASE_URL` 基准是 `apps/api`（config 所在目录），不是仓库根 —— 验收脚本按仓库根找 `.tmp/verify.db` 会误判「db missing」
- [Phase 02]: 镜像的「结构正确」与「可用」必须分开断言：`validate:dockerfile`（本地可闭环，22 条规则 / 27 用例）管前者，`scripts/ci/assert-image.sh`（CI-only，8 条）管后者。本机 `docker` 与 `bash` 均不存在，任何「镜像已验证」的说法都是虚报
- [Phase 02]: `pnpm deploy --prod` 是唯一自洽的运行时依赖形态 —— 直接拷 `node_modules` 会带上 `.pnpm/` 与指向 `/app` 的绝对链接，relocate 到 runtime 后解析不到；`--legacy` 是 pnpm 10 的旗标，9.15.4 没有
- [Phase 02]: `core.autocrlf=true` 会让 `.sh` 以 CRLF 检出，Linux CI 报 `bad interpreter`（本机从不执行该文件，缺陷只在 CI 暴露）；`.gitattributes` 只钉 `*.sh`/`Dockerfile`/`*.mjs`，不用 `* text=auto` 以免全仓库行尾重排
- [Phase 02]: 镜像标签的版本号单一来源是 `homeweave_app/config.yaml`；读不到就 exit 1，拒绝给镜像打 `undefined` 标签
- [Phase 02]: workflow 断言一律用 `js-yaml` 解析后按对象取值，禁止 `JSON.stringify().includes()` —— 字符串匹配无法区分 `provenance: false`（布尔，有效）与 `provenance: "false"`（字符串，buildx 会产出 `unknown/unknown` 平台）
- [Phase 02]: workflow 校验器同时被单测（fixture 全绿 + 单点变异必红）与 lint 门禁调用；fixture 自身必须是全绿基线，否则红例无法归因
- [Phase 02]: `verify-image` 用匿名 `docker pull` 作为「公开可拉」的唯一证据，因此 GHCR 包若为 private 首次发布会在此步失败 —— 这是有意暴露的边界，不用 `--allow-missing-package` 把它抹平
- [Phase 02]: `tag` 步骤需要 `fetch-depth: 0`（默认浅克隆拿不到历史 tag）；发布顺序门禁依赖历史 tag 的存在性判断
- [Phase 02]: `package.json` 必须显式声明 `packageManager`。缺它时 corepack 解析 `pnpm@latest`，而本机与 CI 的隐式默认值不同（本机 9.15.4、CI 12.15.0），同一命令在两处得到不同版本；pnpm 12 的 `minimumReleaseAge` 随后拒绝了 5 个当日发布的包
- [Phase 02]: 任何 `needs.X.outputs` 引用的 job 必须把 X 列进自己的 `needs`。GitHub 不报错，而是展开成空串，错误在下游以完全不相干的形态出现（`docker manifest inspect ""` → `invalid reference format`）。规则 F13 已覆盖声明性、存在性与自引用三种情况
- [Phase 02]: `build-push-action` 的 `tags` 只接受镜像引用；`type=raw,value=...` 是 `docker/metadata-action` 语法，会被原样交给 buildx 并被拒。`tags: needs.guard.outputs.ref` 同时消除镜像名的第二处硬编码
- [Phase 02]: **校验器断言错误事实比没有规则更危险**。原 `checkBuildPushFlags` 强制 `tags` 含 `type=raw,value=`，等于给这个 bug 盖章；同类问题第二次出现在 `docs/23` §8。新增/修改规则时必须能追溯到被验证对象的真实语义，不能凭记忆写「应该长这样」
- [Phase 02]: 从 public 仓库 workflow 推送的 GHCR 包实测可直接匿名拉取，因此原预期「首次发布在 verify-image 失败」没有发生；不需要手动改包可见性。该结论只在 `verify-image` 的匿名 pull 上成立，未用 API 复核（token 缺 `read:packages`）
- [Phase 03]: pino 现行为 **10.x**，CONTEXT 记的 v9 不成立；`LoggerService` 适配必须自己实现 `log/error/warn/debug/verbose/fatal`，`bufferLogs: true` 必须先于 `app.useLogger()` 之前的任何 provider 实例化
- [Phase 03]: pino 的 `redact` 只支持静态路径（`a.b.c` / `a[*].b`），无法按键名模式或值模式脱敏；因此脱敏是自写的纯函数 `sanitize()`（键名黑名单 + 值模式 + 循环引用与深度上限），不依赖 pino 配置
- [Phase 03]: `better-sqlite3@13.0.3` 自带 N-API prebuild 且**包含 linux-arm64**，D-05b 的「arm64 需要工具链回退编译」前提为假 → 改为 Dockerfile 构建期断言 `prebuilds/linux-<arch>.node` 存在，缺失即失败
- [Phase 03]: HA App 的 `watchdog` 是 URL 字符串（`http://[HOST]:[PORT:8099]/health/live`），不是命令探针；它同样必须经 `app-metadata.json` → `generate-app-metadata.mjs` 生成，`assertConsumedKeys` 会拒绝未消费键
- [Phase 03]: App `options` 里的端口变量是 `PORT=8099`，不是 `APP_PORT`；`DATABASE_URL` 默认 `file:/data/homeweave.db` 由镜像 `ENV` 与代码默认值双保险
- [Phase 03]: **D-06 显式偏差**：migrations 只作为 `/health/ready` 的 `checks.migrations` 诊断字段，不参与状态码 → RT-02 为部分交付，在补齐前禁止宣称 SC-2 完整覆盖
- [Phase 03]: 退出码语义固定为：配置/参数错误 **78**（EX_CONFIG），其他启动失败 **1**，正常信号关闭 **0**；这些是 Supervisor 唯一可读信号
- [Phase 03]: 关闭预算 8s 小于 `docker stop` 的 10s SIGKILL 窗口；用 `enableShutdownHooks(Object.values(ShutdownSignal), { useProcessExit: true })`，不手写 `process.on('SIGTERM')`
- [Phase 03-runtime]: watchdog emitted immediately after ingress_port, before options/schema — only slot that preserves the 01-PATTERNS key order while keeping it adjacent to the port it probes

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1] GHCR `owner`、Git 仓库 URL、`maintainer`、最低 HA / Supervisor 版本均为占位符，必须在 Phase 1 落盘为显式决策，不得沿用 `<owner>` 模板值
- [All] 无真实 Home Assistant OS 环境：所有"安装/升级成功"结论只能在静态或容器模拟层给出，HAOS 实机项一律记录为未验证
- [Phase 2] 本机无 Docker：镜像能否构建、多架构 manifest 是否正确，只能由 CI 给出；`RUST_FREE` 只证明「不存在平台相关二进制」，不证明「arm64 容器已跑通」
- [Phase 2] **arm64 镜像从未运行过**：`verify-image` 在 amd64 runner 上 `docker run`，拉取的是 amd64 镜像；arm64 只被构建与推送。Phase 03 在 HAOS（常见 aarch64）上的启动必须在真机验证，不能用 `verify-image` 的绿来代替
- [Phase 2] `resume_from_verify=true` 路径（`check-tag-free --expect exists`）从未真实触发；负向运行只覆盖了「tag 已存在 → 拒绝」这一支
- [Phase 2] 只有一个发布版本 `0.1.0`，未验证 0.1.1 的升级行为
- [Phase 3] **`/data` 可写性未验证（A2）**：`Dockerfile` 为 `USER node`，Supervisor 挂载的 `/data` 常属 root；真机上可能启动即 exit 78，而本地与 CI 全绿。03-VALIDATION.md 已列为 Manual-Only 项，必须真机确认
- [Phase 3] `/health/ready` 的 migrations 维度只做诊断（D-06 偏差），RT-02 部分交付；不得据此宣称 SC-2 完整覆盖
- [Phase 5] Web UI 载体未定，可能影响镜像体积与 Phase 2 的构建产物边界

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-10-28T00:00:00.000Z
Stopped at: Completed 03-05-PLAN.md
Resume file: .planning/phases/03-runtime/03-05-SUMMARY.md

**Next action:** 在真实 HAOS 上安装 `0.1.1` 并做 Phase 3 阶段验证（`/gsd-verify-work`），三项只能在真机确认：`/data` 属主是否让 `node` 可写、Supervisor 的 `docker stop` 投递与耗时、watchdog 是否真的重启。CI 已覆盖容器级别的同类断言，但不能替代 Supervisor 的挂载与信号路径。不要先开 Phase 4。

执行前必须先接受这三条事实：

1. **arm64 从未运行过**。`verify-image` 只执行了 amd64 镜像；HAOS 常见为 aarch64，因此「镜像在真实设备上能启动」仍是 Phase 03 的待验证项，不是已完成的结论。
2. Phase 1 的 HAOS 实机项同样未验证。前两个阶段的静态结论尚未合流为一次真机验收。
3. **`/data` 归属未知（研究期 A2，最大残余风险）**：`Dockerfile` 是 `USER node`，而 Supervisor 挂载的 `/data` 常属 root；若真机如此，进程会启动即 exit 78 而本地全绿。03-05 已把它列入「残余风险」，要求真机确认后再决定是否改权限，禁止未验证就把 `USER node` 删掉。

发布链路的运维细节见 `docs/23_IMAGE_RELEASE_RUNBOOK.md`；再次发布只需 `gh workflow run release.yml -f version=<v> -f confirm_version=<v>`。
