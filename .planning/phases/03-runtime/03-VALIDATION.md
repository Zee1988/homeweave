---
phase: "03"
slug: "runtime"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-28"
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> 不变量定义见 `03-RESEARCH.md §13`（INV-1 … INV-10）。

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test`（Node 22 内置，零新增依赖） |
| **Config file** | 无 — `apps/api/tsconfig.json` 的 `include` 仅 `src/**/*.ts`，`test/` 目录天然不被 tsc 摄入，也不污染 `dist/` |
| **Quick run command** | `corepack pnpm@9.15.4 --filter @homeweave/api test` |
| **Full suite command** | `corepack pnpm@9.15.4 test`（= `test:app` + `-r --if-present test`） |
| **Estimated runtime** | quick ~3s / full ~25s |

**执行方式（已实测可行，勿改写成目录参数）：**

- 单元（纯函数，无装饰器）：`node --experimental-strip-types --test "test/**/*.test.ts"`
  - `[VERIFIED: 本地 node v22.17.0 实跑，glob 参数有效；传目录参数会报 "Could not find '.'"]`
- 集成（需 Nest 装饰器元数据）：先 `pnpm --filter @homeweave/api build`，再 `node --test "test/*.dist.test.mjs"` 导入 `dist/`
  - strip-types **不处理 `emitDecoratorMetadata`**，所以装饰器相关测试不能走 strip-types 路径

**接入点：** 只需在 `apps/api/package.json` 增加 `"test": "node --experimental-strip-types --test \"test/**/*.test.ts\""`，根 `test` 脚本的 `-r --if-present test` 会自动拾取，无需改根脚本。

---

## Sampling Rate

- **After every task commit:** `corepack pnpm@9.15.4 --filter @homeweave/api test`
- **After every plan wave:** `corepack pnpm@9.15.4 test`
- **Before `/gsd-verify-work`:** Full suite green + CI-only 容器断言（INV-3/4/7/8）在 CI 结果中为绿
- **Max feedback latency:** 5s

---

## Per-Task Verification Map

> Task ID 由 plan 落地时回填；本表锁定「每个 plan 必须有自动验证」，防止执行期出现不可验证任务。

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *（回填）* | 01 骨架 | 1 | RT-01 | — | `live` 响应体仅 `{status}`，无版本/路径/依赖 | unit | `node --experimental-strip-types --test "test/health-live.test.ts"` | ❌ W0 | ⬜ pending |
| *（回填）* | 02 健康 | 2 | RT-02 | — | `ready` 不因 migrations 泄漏内部路径 | unit+CI | 同上 + `test/health-ready.test.ts` | ❌ W0 | ⬜ pending |
| *（回填）* | 02 健康 | 2 | RT-02 | — | 不可写目录 → 503（CI） | CI-only | `bash scripts/ci/assert-ready-degraded.sh` | ❌ W0 | ⬜ pending |
| *（回填）* | 03 日志 | 2 | RT-04 | T-03-01 凭证落日志 | `Authorization`/`cookie`/`token` 递归掩码，含 `Bearer` 值模式 | unit | `node --experimental-strip-types --test "test/sanitize.test.ts"` | ❌ W0 | ⬜ pending |
| *（回填）* | 03 日志 | 2 | RT-04 | — | 每条日志带 `requestId` | unit | `test/logger-adapter.test.ts` | ❌ W0 | ⬜ pending |
| *（回填）* | 04 关闭 | 3 | RT-03 | — | SIGTERM → 8s 内 exit 0，顺序正确 | CI-only | `node --test "test/shutdown.dist.test.mjs"` | ❌ W0 | ⬜ pending |
| *（回填）* | 04 fail-fast | 3 | RT-05 | — | 不可写 DB → exit 78 + 单条原因 | CI-only | `bash scripts/ci/assert-failfast.sh` | ❌ W0 | ⬜ pending |
| *（回填）* | 01 探针 | 1 | RT-05 | T-03-02 RUST_FREE 误报 | 探针扫到 `better-sqlite3` 的 `.node` 不再报无原生二进制 | unit | `node --test "scripts/**/*.test.mjs"` | ✅ | ⬜ pending |
| *（回填）* | 01 App | 1 | RT-01 | — | `watchdog` 经生成器产出，`--check` 零 diff | unit | `corepack pnpm@9.15.4 run check:app` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/api/test/` 目录 + 首个 `sanitize.test.ts`（证明 strip-types 路径在 CI 的 Linux runner 上也通）
- [ ] `apps/api/package.json` 增加 `"test"` 脚本
- [ ] 安装并锁定：`pino@10.x`、`@prisma/adapter-better-sqlite3@7.10.1`、`better-sqlite3@13.x`
- [ ] 构建期断言 `node_modules/better-sqlite3/prebuilds/linux-<arch>.node` 存在（替代 D-05b 的工具链方案）
- [ ] `scripts/probe-prisma-engine.mjs` 扩展到 `node_modules/**/*.node`，并加对应 `.test.mjs`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HAOS 上 `ha apps stop` 实际耗时 | RT-03 | 无 HAOS 环境，Windows 宿主无 docker daemon | 真机 `time ha apps stop homeweave`，与 8s 预算对比 |
| `/data` 对容器内 `node` 用户可写 | RT-02/RT-05 | Supervisor 挂载权限无法本地复现（RESEARCH A2，**最大未知风险**） | 真机启动，看是否误触 fail-fast |
| `watchdog` 真的触发重启 | RT-01 | 未文档化的探测间隔/阈值 | 真机让 `/health/live` 失败（临时改端口），观察 Supervisor 是否重启 |
| 关闭期间无 SIGKILL | RT-03 | 需真实 `docker stop` | CI 已覆盖；HAOS 上以 Supervisor 日志为准 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
