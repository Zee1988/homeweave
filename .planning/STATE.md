---
gsd_state_version: "1.0"
milestone: v1.0
current_phase: 02
current_phase_name: 镜像构建与发布链路
status: verifying
stopped_at: Phase 02 wave 4 complete — all 4 plans executed; phase verdict is partial (image never built, CI never ran)
last_updated: "2026-10-28T00:46:00.000Z"
last_activity: 2026-10-28
last_activity_desc: 02-04 landed — ci.yml + release.yml + validate-workflows (20 rules / 55 cases), 219 tests green, image release is CI-only
state_head: 8d6874a563a0d15c8ee6547573c807a64fc9e2d1
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 10
  completed_plans: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-27)

**Core value:** HAOS 用户添加仓库 → 安装 → 启动 → 在 HA 侧边栏打开一个能跑的 HomeWeave。
**Current focus:** Phase 02 — 镜像构建与发布链路

## Current Position

Phase: 02 (镜像构建与发布链路) — VERIFYING (partial)
Plan: 4 of 4（全部计划已执行；阶段结论为 partial）
Status: wave 4 complete — **镜像从未构建，CI 从未运行，GHCR 无任何 tag**（本机无 docker、无 bash；发布链路是 CI-only）
Last activity: 2026-10-28 — 02-04 landed; ci.yml/release.yml 与 `validate:workflows` 已闭环，首次真实构建待 CI 首跑

Progress: [█░░░░░░░░░] 14%  (1/7 phases verified, 10/10 plans executed)

## Performance Metrics

**Velocity:**
- Total plans completed: 10
- Average duration: ~33 min
- Total execution time: ~5.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 6 | ~0.4 h | ~7 min |
| 02 | 4 | ~5.1 h | ~77 min |

**Recent Trend:**
- Last 4 plans: 02-01 (~45 min), 02-02 (~60 min), 02-03 (~50 min), 02-04 (~150 min)
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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1] GHCR `owner`、Git 仓库 URL、`maintainer`、最低 HA / Supervisor 版本均为占位符，必须在 Phase 1 落盘为显式决策，不得沿用 `<owner>` 模板值
- [All] 无真实 Home Assistant OS 环境：所有"安装/升级成功"结论只能在静态或容器模拟层给出，HAOS 实机项一律记录为未验证
- [Phase 2] 本机无 Docker：镜像能否构建、多架构 manifest 是否正确、arm64 容器内 Prisma 查询是否成功，全部只能由 02-03/02-04 与 CI 给出；`RUST_FREE` 只证明「不存在平台相关二进制」，不证明「arm64 容器已跑通」
- [Phase 2] **镜像从未构建、CI 从未运行、GHCR 无任何 tag**：`ci.yml`/`release.yml` 只经过静态校验（20 条 workflow 规则 + 55 用例）。02-VERIFICATION.md 判定为 `partial`，在首次真实 CI 运行前不得宣称 Phase 2 通过
- [Phase 2] 首次发布预期在 `verify-image` 的匿名 pull 处失败（GHCR 包默认 private）；处理方式是把包改为 public 后重跑，而不是给匿名拉取加豁免
- [Phase 5] Web UI 载体未定，可能影响镜像体积与 Phase 2 的构建产物边界

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-10-28T00:46:00.000Z
Stopped at: Completed 02-04-PLAN.md (phase 02 wave 4 done, 4/4 plans); phase verdict = partial
Resume file: `.planning/phases/02-image-release/02-VERIFICATION.md`

**Next action:** Phase 2 剩余的是**不可在本机完成**的部分，按顺序：

1. 把 `release.yml` 的 `workflow_dispatch` 跑一次（`resume_from_verify=false`），确认 `static → guard → publish → verify-image → tag` 全链路；预期首次在 `verify-image` 的匿名 `docker pull` 处失败（GHCR 包 private）。
2. 失败后把 GHCR 包改为 public 并重跑，直到匿名 pull 成功、manifest 同时列出 `amd64` 与 `arm64`，再勾选 Phase 2 为完成。
3. 之后才讨论 Phase 3（运行时骨架）：`/gsd-discuss-phase 3`。

未验证清单与逐条判据见 02-VERIFICATION.md，不要在没有 CI 运行记录的情况下把任何一条改写成「通过」。
