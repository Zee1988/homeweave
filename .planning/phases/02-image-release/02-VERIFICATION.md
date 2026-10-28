---
phase: 02-image-release
verified: 2026-10-28
verdict: partial
verified_by: orchestrator (gsd-verifier subagent exhausted its context without writing a report)
---

# Phase 02 Verification: 镜像构建与发布链路

**结论：`partial`。** 四个计划全部落地，本地可执行的门禁全绿，但 Phase 02 的**目标本身**尚未被证明 —— 它要求"存在一个公开可拉取、多架构、标签与 App `version` 完全一致的预构建镜像"，而本仓库**从未构建过一次镜像，从未运行过一次 CI，GHCR 上不存在任何 tag**。

本机 `docker`、`bash`、`gh` 全部不可用，且从未 push 到 GitHub。因此本次核验能证明的最强命题是：**发布链路的结构正确、失败路径可辨、门禁闭环**。它不能证明"发布链路能跑通"。

## Phase 目标回溯

> Goal: 存在一个公开可拉取、多架构、标签与 App `version` 完全一致的预构建镜像，"先镜像、后版本号"的发布顺序由 CI 强制而非靠人记得。

| # | Success criterion | 判定 | 证据 |
|---|---|---|---|
| 1 | 仓库内单一命令即可构建出可启动的生产镜像；镜像内部检查可证明含构建产物/Prisma Client/迁移，不含 devDeps/源码/sourcemap | **partial** | `Dockerfile` 四阶段，runtime 仅拷 `dist`、`/prod/node_modules`、`prisma`、`package.json`（`Dockerfile:88-116`）。结构由 `pnpm validate:dockerfile` 校验（22 条规则，exit 0）。**镜像从未构建**，`pnpm build:image` 在本机 exit 1 并打印 `image builds are CI-only` —— 这是设计行为，不是"构建通过"。 |
| 2 | 打 tag 后 GHCR 同时存在 amd64 与 aarch64 及指向两者的 manifest list，标签与 `config.yaml` 的 `version` 一字不差 | **not achieved** | 机制已就位但从未运行。`release.yml` 的 `publish` 用 `platforms: linux/amd64,linux/arm64`、`provenance: false`（布尔）、`sbom: false`（布尔）、`tags: type=raw,value=...`；`verify-image` 调 `assert-manifest-platforms.mjs` 做集合相等断言；`tag` 仅在 `verify-image` 绿后创建。**GHCR 上无任何 tag**，manifest list 不存在。 |
| 3 | CI 在构建前依次执行元数据/Dockerfile 校验、lint、typecheck、unit，任一步失败即阻断发布（可用一次故意注错的提交证明阻断生效） | **partial** | `ci.yml` 含 7 个门禁 token（`validate:workflows`/`validate:app`/`validate:dockerfile`/`lint`/`typecheck`/`test`/`check:app`），`release.yml` 的 `static` 为 `publish` 的唯一上游。**阻断未被实测**：没有故意注错的提交，也没有一次真实 CI 运行。 |
| 4 | 镜像层、构建缓存、workflow 文件与仓库中不存在硬编码密钥；密钥扫描与镜像历史检查是发布门禁 | **partial** | `assert-image.sh` 第 7 条 `docker history --no-trunc` 扫 `ghp_`/`github_pat_`/`password=`/`BEGIN ... PRIVATE KEY`，第 8 条扫文件系统 `.env`/`*.pem`/`*.key`；`.dockerignore` 挡 `.env*`/`*.pem`/`*.key`/`secrets`。**从未在镜像上执行**。`docs/23` §7 明确列出未覆盖项（git 历史、仓库 secrets 配置、编码密钥）。 |

## Requirement 覆盖

| Requirement | 判定 | 说明 |
|---|---|---|
| IMG-01（镜像含构建产物与 Prisma Client） | **partial** | Dockerfile 拷 `dist`（含 `dist/generated/prisma`），`assert-image.sh` 第 4 条断言 `dist/main.js`、`dist/generated/prisma/client.js`、`prisma/migrations/*/migration.sql`。断言未运行。 |
| IMG-02（不含源码/devDeps/sourcemap） | **partial** | 第 1/2/3 条断言 + `tsconfig` `sourceMap: false`。断言未运行。 |
| IMG-03（多架构） | **unknown** | `platforms` 已写死双架构；manifest list 从未产出。 |
| IMG-04（公开可拉） | **unknown** | `verify-image` 用 `docker logout` + 覆写 `~/.docker/config.json` 后匿名 `docker pull`，顺序正确；**从未执行**。GHCR 包可见性仍未设置。 |
| IMG-05（镜像构建与版本号单一来源） | **verified** | `pnpm build:image` 在本机 exit 1 且信息含 `image builds are CI-only`；版本号只读 `homeweave_app/config.yaml`（`version: "0.1.0"`），读不到即 exit 1；`config.yaml` 的 `image: ghcr.io/zee1988/homeweave-ha-app` 与 workflow tag 规则一致，无 `v` 前缀。 |
| SEC-03（无硬编码密钥进入镜像） | **partial** | 断言与 `.dockerignore` 就位，未在镜像上执行；`docs/23` §7 已声明未覆盖范围。 |
| VER-01（CI 门禁） | **verified（结构性）** | `pnpm lint` exit 0（20 rules + 22 rules + 32 files）、`pnpm test` 219/219、`pnpm typecheck` exit 0、`pnpm validate:workflows` exit 0。门禁存在且可阻断合并；**未证明能阻断发布**，因为 release workflow 未运行。 |

## 本次核验实际执行的命令

| 命令 | 结果 |
|---|---|
| `corepack pnpm lint` | exit 0 — `✓ workflow checks passed (20 rules)` / `✓ dockerfile checks passed (22 rules)` / `✓ lint passed (32 files)` |
| `corepack pnpm typecheck` | exit 0 — `✓ typecheck passed (@homeweave/api)` |
| `corepack pnpm test` | exit 0 — 219 tests / 219 pass / 0 fail |
| `corepack pnpm validate:workflows` | exit 0（`--profile all`，两个文件均存在） |
| `corepack pnpm validate:dockerfile` | exit 0（22 条规则） |
| `corepack pnpm validate:app` / `check:app` | exit 0 |
| `corepack pnpm build:image` | **exit 1**，输出含 `image builds are CI-only` —— 预期失败 |
| `node .planning/tmp/inspect-workflows.mjs`（临时解析脚本，未入库） | 见下 |

解析 `release.yml` 得到的实际值（不是子串匹配）：

- `on` 恰为 `[workflow_dispatch]`；inputs：`version`(required) / `confirm_version`(required) / `resume_from_verify`(boolean, default false)
- 顶层 `permissions: {contents: read}`
- job 依赖：`static→[guard]`、`publish→[static]`、`verify-image→[publish, static]`、`tag→[guard, verify-image]`
- `publish.if = !inputs.resume_from_verify`；`verify-image.if` 表达"publish 成功 **或** (resume 且 publish 被 skipped)"，**不含** `!= 'skipped'`
- `with.push` / `with.provenance` / `with.sbom` 三者 `typeof` 均为 **boolean**（字符串 `"false"` 不生效，已验证校验器对此有红例）
- `tag` job 的 checkout `with: {fetch-depth: 0}`；tag 推送前会拒绝移动已存在的 tag

## `assert-image.sh` 的引擎分支（静态判断，非执行）

`decision=""` 初始化后，`if [ -f ... ]` 仅用于读值；随后 `case "$decision"` 的 `NATIVE_ENGINE` / `RUST_FREE` / `*)` 三分支中 **`*)` 是 fail**（`scripts/ci/assert-image.sh:159-190`）。即：**文件缺失、为空、取值非法一律 exit 1**，不存在"跳过"出口。`RUST_FREE` 打印 `- skipped (RUST_FREE)` 但计为该条通过。

本机无 `bash`，因此这是**代码阅读结论，不是运行结论**。

## 不可本地验证（不得据此声称通过）

1. 镜像构建是否成功（含 `pnpm deploy --prod` 的实际产物形态）。
2. 容器能否启动、`Nest application successfully started` 是否出现。
3. `assert-image.sh` 的 8 条断言的实际判定。
4. 双架构 manifest list 是否产出、是否公开可拉（GHCR 上无 tag）。
5. workflow 的 YAML 是否被 GitHub Actions 接受（action 版本 `actions/checkout@v7`、`pnpm/action-setup@v6`、`docker/build-push-action@v7` 等来自计划与研究文档，**未向上游核对是否存在**）。
6. `classifyTagState` 的关键字是否与 GHCR 真实文案吻合（`docs/23` §9 已列为 unknown）。
7. 阻断是否生效（没有故意注错的提交跑过 CI）。

## 核验中发现并已修正的问题

| 问题 | 处理 |
|---|---|
| `docs/23` §8 写成「引擎检查是条件性的，只有当 `ENGINE_DECISION` 存在时才断言」，与脚本的 `*)` → fail 矛盾 | 已改写为按取值分支 + 明确「缺失/为空/非法 → exit 1」（`8d6874a`） |
| `02-04-SUMMARY.md` 的 `key-files.created` 只列了 3 个文件，把本计划新建的 6 个脚本列进 `modified` | 已归位（`8d6874a`） |
| 编排侧过程：`gsd-verifier` 子代理 30 次工具调用后触及上下文上限，未产出报告；本文件由编排侧重做核验并撰写 | 记录于此，不代表存在独立第三方验证 |

## 判定

Phase 02 **不能标记为完成**。计划层面 4/4 已交付，但 Phase goal 的第二、三条 success criterion 需要**一次真实的 CI 运行 + GHCR 上的 manifest** 才能成立。在首次发布实际跑通之前，正确状态是：

> 发布链路已构建、结构自洽、门禁闭环；镜像与 CI 从未运行。首次发布必须有人值守，预期会在 `verify-image` 的匿名 pull 处因 GHCR 包默认 private 而失败（`docs/23` §2 → §4）。
