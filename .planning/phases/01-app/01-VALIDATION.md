---
phase: "01"
slug: "app"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-27"
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test`（Node.js 内置，零额外依赖；与 D-04「只引入 js-yaml」一致） |
| **Config file** | none — Wave 0 创建仓根 `package.json`、`scripts/validate-app-metadata.mjs` 与测试目录 |
| **Quick run command** | `corepack pnpm validate:app` |
| **Full suite command** | `corepack pnpm validate:app` 与 `corepack pnpm test:app`（后者含漂移守卫前置环节） |
| **Drift guard** | `corepack pnpm check:app`（`test:app` 的先决环节，失败则 `node:test` 不执行） |
| **Estimated runtime** | ~2 秒（纯静态 YAML 解析，无网络、无 Docker） |

---

## Sampling Rate

- **After every task commit:** Run `corepack pnpm validate:app`
- **After every plan wave:** Run `corepack pnpm validate:app` 与 `corepack pnpm test:app`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 秒

---

## Per-Task Verification Map

任务 ID 由规划者最终确定；下表按**验收要求**预先绑定验证手段，任务落地后回填 ID。

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | APP-03 | — | `repository.yaml` 仅存在于仓库根，无 `<owner>` 类占位符 | unit | `pnpm validate:app` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | APP-02 | — | `config.yaml` 必填键齐全、`arch` 仅 `amd64`/`aarch64`、`image` 不带 tag | unit | `pnpm validate:app` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | APP-02 | — | 全仓递归只有一份 `config.{yaml,yml,json}`（跳过点目录与 `rootfs`） | unit | `pnpm validate:app` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | APP-04 | — | `options`/`schema` 两项通过 schema DSL 子集校验，默认值存在 | unit | `pnpm validate:app` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | APP-02 | — | 校验器负向用例：篡改必填键/大小写/多份 config 时必须非零退出 | unit | `corepack pnpm test:app` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | APP-01 | — | 生成脚本重复执行产出逐字节一致的 YAML（幂等，无手改漂移） | unit | `corepack pnpm check:app`、`corepack pnpm test:app` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json`（仓根，最小形态 + `js-yaml` 依赖 + `validate:app` 脚本）— 本阶段此前无任何 Node 工程文件
- [ ] `scripts/validate-app-metadata.mjs` — 校验器骨架，先让 `pnpm validate:app` 可执行（哪怕只报「未实现」）
- [ ] `scripts/__tests__/` 或 `scripts/*.test.mjs` — 校验器负向用例（缺字段、非法 `arch`、双份 `config.yaml`）
- [ ] 测试夹具（临时目录内构造坏 YAML 样例），不得在仓库里留下真实的第二份 `config.yaml`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HAOS 添加仓库后 Apps 列表出现 HomeWeave 条目 | APP-01 | 无 HAOS 实机环境；Supervisor 行为无法静态证明 | 设置 → 加载项商店 → 右上角仓库 → 添加 `https://github.com/Zee1988/homeweave` → 刷新 → 确认列表出现 `HomeWeave` → 记录截图与 Supervisor 版本 |
| 安装后 App 详情页渲染正常、日志页可打开 | APP-01 | 同上，依赖 Phase 2 镜像 | 安装 App → 打开日志与配置页 → 确认 `log_level`/`ha_url` 两项可见且有默认值 |
| 「Open Web UI」按钮在 Phase 5 前指向空端口 | APP-02 | 已知后果（S2），需在实机核对是否被误判为缺陷 | 点击按钮 → 预期空白/错误页 → 记录为已知限制，不记为失败 |

*静态检查与实机结论必须分开记录；本阶段交付的自动化结论仅覆盖静态层。*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
