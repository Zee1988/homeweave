---
phase: "02"
slug: "image-release"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-27"
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, 零第三方依赖) — 与 Phase 01 一致 |
| **Config file** | none（`node --test scripts/*.test.mjs`） |
| **Quick run command** | `corepack pnpm test:app` |
| **Full suite command** | `corepack pnpm test:app && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm check:app` |
| **Estimated runtime** | ~5 秒（本机实测 Phase 01 基线） |

---

## Sampling Rate

- **After every task commit:** Run `corepack pnpm test:app`
- **After every plan wave:** Run `corepack pnpm test:app && corepack pnpm check:app`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

**Important boundary:** 所有容器内断言（`docker run …`）与 manifest 断言在**本机不可执行**（无 Docker）。它们只能在 CI 上跑，执行时若 CI 不可用必须标 `unknown`，不得声称通过。

---

## Per-Task Verification Map

*Task ID 将在 `plan-checker` 通过后由 PLAN 文件回填；下列为本阶段必须被覆盖的验证面。*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1..T6 | 02-01 | 1 | VER-01 | T-02-01 | 干净 clone 上 lint/typecheck/test 可复现，且 typecheck 无包可查时必须失败 | unit | `corepack pnpm lint` / `typecheck` / `test` 各自 exit 0 | ✅ 可本地 | ⬜ pending |
| 02-02-T3 | 02-02 | 2 | IMG-02 | T-02-02 | Prisma 引擎形态有证据并落盘 `ENGINE_DECISION`，跨架构不致首次查询即崩 | unit | 探测目录 + `ENGINE_DECISION` 一致性断言 | ✅ 可本地（结论本身 CI 侧才被消费） | ⬜ pending |
| 02-02-T4 | 02-02 | 2 | IMG-02 | — | 空库 `migrate deploy` 可应用，迁移文件随镜像分发 | unit | `prisma migrate deploy` + db 内容断言 | ✅ 可本地 | ⬜ pending |
| 02-03-T1/T4 | 02-03 | 3 | IMG-05 | T-02-03 | Dockerfile 静态约束（非 root、无 `COPY . .`、无 `latest`、secret 走 mount） | unit | `corepack pnpm validate:dockerfile` + 6 类红例 | ✅ 可本地 | ⬜ pending |
| 02-03-T2 | 02-03 | 3 | IMG-01 / IMG-02 | T-02-03, T-02-04 | 镜像不含 devDeps/源码/`.map`、产物在位、可启动、无密钥 | container | `bash scripts/ci/assert-image.sh <ref>`（8 条断言） | ❌ CI-only | ⬜ pending |
| 02-04-T1 | 02-04 | 4 | IMG-05 | T-02-05 | tag 已存在则拒绝覆盖（403/未知错误均 fail-closed） | unit | `node --test scripts/check-tag-free.test.mjs` | ✅ 可本地 | ⬜ pending |
| 02-04-T2 | 02-04 | 4 | IMG-04 | T-02-07 | manifest 恰含 amd64+arm64 且 tag == config.yaml version | unit + ci | `node --test scripts/assert-manifest-platforms.test.mjs`；CI 侧真跑 | ✅ 单测可本地 / ❌ 需真实 GHCR | ⬜ pending |
| 02-04-T3/T4/T5 | 02-04 | 4 | IMG-03 / IMG-05 | T-02-06 | 静态门禁阻断发布、权限不越界、依赖图强制「先镜像后 tag」 | unit + ci | `corepack pnpm validate:workflows` + 红例 | ✅ 结构可本地 / ❌ 真实阻断需 CI | ⬜ pending |
| 02-04-T6 | 02-04 | 4 | SEC-03 | T-02-03 | 无密钥进入镜像层/镜像文件系统/workflow | ci + doc | `docker history --no-trunc` grep + 镜像内文件扫描（`assert-image.sh` 第 7、8 条） | ❌ 需 CI | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/*.test.mjs` — 新增断言脚本（tag 判空、manifest 平台集合、dockerignore 内容）的单元测试落位
- [ ] 现有 `node:test` 基础设施已覆盖快速反馈，无需引入框架
- [ ] `apps/api` 的 test 入口在 plan 02-01 内建立（`pnpm --filter @homeweave/api test`）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GHCR 包可见性设为 public | IMG-04 | 需仓库 owner 权限的一次性设置，`GITHUB_TOKEN` 的 `packages` scope 无法改可见性 | `gh api --method PATCH /user/packages/container/homeweave-ha-app -f visibility=public`，然后匿名 `docker pull` 应成功 |
| aarch64 镜像实际运行 | IMG-03 | amd64 主机上 arm64 仅能模拟或仅验证 manifest 存在性 | 有 ARM 设备/QEMU 时实跑；否则如实标 `unknown` |
| HAOS Supervisor 真实拉取安装 | IMG-04 | 需要真机 HAOS | 归 Phase 07 验收，本阶段只证明 manifest 存在且匿名可拉 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

---

## Plan-Checker 结论（2026-10-27）

- **VERDICT: PASS**（第 4 轮复审；前 3 轮共报出 5 个阻断 + 6 个非阻断，均已修）
- 关键修复留痕（避免下次复审重复踩）：
  1. `assert-image.sh` 必须有调用方 → `release.yml` 的 `verify-image` job。
  2. 所有 verify 一律 `cmd; if ($LASTEXITCODE -ne 0) { exit 1 }`，禁止 `cmd; echo "EXIT=$LASTEXITCODE"`（后者恒返回 0）。
  3. workflow 结构断言必须**结构化取值**，禁止 `JSON.stringify()` 子串匹配（YAML 布尔 `false` 序列化为 `"provenance":false`）。
  4. `release.yml` 每个 job 需要 `checkout`；`tag` 需 `fetch-depth: 0` 与 `git push`；`GH_TOKEN` 显式进 `env`。
  5. 首次发布自锁用 `--allow-missing-package`（仅 `auth-error` ∧ 两处 `gh api` 均 404）解开；`resume_from_verify` 走另一条不放宽的通路。
- **仍是 CI-only / unknown 的项**（本机无 Docker，不得声称已验证）：`assert-image.sh` 的真实行为、buildx 双架构产物、GHCR 匿名拉取、GHCR 对缺失 tag 的实际 stderr 文案、aarch64 实机运行。
