---
phase: 02-image-release
plan: "04"
subsystem: ci-release
tags: [github-actions, ghcr, workflow-validation, release-runbook]
title: GitHub Actions 发布链路、结构化 workflow 校验与发布手册
requires:
  - 02-03 (scripts/ci/assert-image.sh、Dockerfile、pnpm 门禁)
  - 02-01/02-02 (homeweave_app/config.yaml 的 version 单一来源、Dockerfile 与 .dockerignore)
provides:
  - ".github/workflows/ci.yml: PR/push 静态门禁（7 个门禁，顶层 permissions 恰为 contents: read）"
  - ".github/workflows/release.yml: guard → static → publish → verify-image → tag 依赖图；resume_from_verify 例外通路"
  - "scripts/validate-workflows.mjs 的 20 条结构规则由 lint 执行（不再依赖人工检查 YAML）"
  - "docs/23_IMAGE_RELEASE_RUNBOOK.md: 发布顺序、GHCR 可见性、resume、回滚、六种失败判读与未覆盖面"
affects:
  - package.json lint 门禁
  - README 文档索引与 lint 说明
key-files:
  created:
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
    - docs/23_IMAGE_RELEASE_RUNBOOK.md
    - scripts/check-tag-free.mjs
    - scripts/check-tag-free.test.mjs
    - scripts/assert-manifest-platforms.mjs
    - scripts/assert-manifest-platforms.test.mjs
    - scripts/validate-workflows.mjs
    - scripts/validate-workflows.test.mjs
  modified:
    - package.json
    - README.md
key-decisions:
  - "ci.yml 的 push/pull_request 分支写成 [master, main]：仓库实际默认分支是 master（本地分支 master、无 remote、config.yaml 的 url 用 tree/master、02-RESEARCH-CI.md 写 branches: [master]），计划文本的 [main] 单独使用会让门禁永不触发"
  - "release.yml 的 tag 注解用镜像引用 + run URL，不使用 digest：tag job 拿不到 digest（assert-manifest-platforms.mjs 不输出它），不编造"
  - "resume 分支保留 always() + needs.publish.result == skipped 的显式写法，禁止 != skipped 的反转形式"
  - "provenance 与 sbom 写成布尔 false（不是字符串），否则 buildx 追加 unknown/unknown attestation，平台集合相等断言必红"
  - "verify-image 不申请 packages: read，且先 docker logout + 覆盖 .docker/config.json 再 docker pull"
  - "guard 不安装依赖、用零依赖正则读 config.yaml 的带引号 version 行（研究 C-2），避免 require('js-yaml') 崩溃"
  - "lint = validate-workflows --profile all + validate-dockerfile + lint-workspace，workflow 结构检查进入本地门禁"
requirements-completed: [IMG-03, IMG-04, IMG-05, SEC-03, VER-01]
coverage:
  - requirement: IMG-03
    status: partial
    verification: "ci.yml/release.yml 的 static job 串起七个门禁且 publish needs static；本地 validate:workflows 断言 job 图与门禁 token（20 rules, exit 0）。真实阻断需 GitHub 运行，未验证"
  - requirement: IMG-04
    status: partial
    verification: "publish 的 with.platforms 被结构化断言恰为 linux/amd64,linux/arm64；verify-image 调用 assert-manifest-platforms.mjs；平台集合与 version 匹配的纯函数用例本地通过。真实 manifest 需 GHCR，未验证"
  - requirement: IMG-05
    status: partial
    verification: "guard 与 publish 各自跑 check-tag-free.mjs（--expect free / --expect exists / --allow-missing-package），tag job 仅在 verify-image 之后；fail-closed 分类有单测。真实 GHCR 报错文案未验证"
  - requirement: SEC-03
    status: partial
    verification: "verify-image 执行 scripts/ci/assert-image.sh（history/文件系统/.dockerignore 断言）；手册 §7 明确未覆盖 git 历史密钥、仓库 secrets、编码密钥。镜像层检查需 Docker，未验证"
  - requirement: VER-01
    status: complete
    verification: "本地实测 pnpm lint（20 workflow rules + 22 dockerfile rules + 32 files）、pnpm typecheck、pnpm test（219/219）全部 exit 0"
duration: "~15 min（08:31:41 → 08:45 local，按首个计划提交到 SUMMARY 记录时间估算）"
completed: 2026-10-28
status: complete
plan_head_before: 2922d07a0351b34844d47d27b4f65e97278a7320
plan_head_after: b528d02006f425577eeae5928a5e2780a0bdf30a
commits: 7
metrics:
  tasks_completed: 7
  tests: "219/219 pass（未新增用例，全部为 02-04 Task 1-3 已交付的用例）"
---

# Phase 02 Plan 04: GitHub Actions 发布链路、结构化 workflow 校验与发布手册 Summary

把「先镜像、后版本号」从文档约定变成 job 依赖图强制：两个 workflow 入库，20 条结构规则由 `lint` 执行，发布手册写清顺序、GHCR 可见性、resume 例外与未覆盖面。

## 完成内容

- **Task 1-3（前一次派发，本 SUMMARY 采信其基线）**：`check-tag-free.mjs`（fail-closed tag 存在性判定，27 用例）、`assert-manifest-platforms.mjs`（平台集合 + 版本一致性，21 用例）、`validate-workflows.mjs`（20 条结构规则，55 用例）。
- **Task 4**：`.github/workflows/ci.yml` —— 单一 `static` job，顶层 `permissions: {contents: read}`，七个门禁各自独立 `run`，不含任何镜像构建。
- **Task 5**：`.github/workflows/release.yml` —— `guard → static → publish → verify-image → tag`；`publish` 独享 `packages: write`，`tag` 独享 `contents: write`；`verify-image` 匿名 pull + `assert-image.sh` + manifest 断言；`tag` 只建 tag 不重建镜像。
- **Task 6**：`docs/23_IMAGE_RELEASE_RUNBOOK.md`（八节，含六种失败判读与 SEC-03 未覆盖面）+ README 索引补入 docs 21/22/23。
- **Task 7**：`lint` 接入 `validate:workflows`，README 的 lint 行同步；七条门禁实测全绿；本 SUMMARY。

## 实测命令与结果

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `node scripts/validate-workflows.mjs --profile ci` | 0 | `✓ workflow checks passed (7 rules)` |
| `node scripts/validate-workflows.mjs --profile release` | 0 | `✓ workflow checks passed (14 rules)` |
| `corepack pnpm validate:workflows` | 0 | `✓ workflow checks passed (20 rules)` |
| `corepack pnpm validate:app` | 0 | `✓ 87 checks passed` |
| `corepack pnpm validate:dockerfile` | 0 | `✓ dockerfile checks passed (22 rules)` |
| `corepack pnpm check:app` | 0 | 无输出，exit 0（元数据同步） |
| `corepack pnpm lint` | 0 | `✓ workflow checks passed (20 rules)` + `✓ dockerfile checks passed (22 rules)` + `✓ lint passed (32 files)` |
| `corepack pnpm typecheck` | 0 | `✓ typecheck passed (@homeweave/api)` |
| `corepack pnpm test` | 0 | `# tests 219 / # pass 219 / # fail 0` |
| Task 6 关键字校验（`visibility=public`/`docker logout`/`resume_from_verify`/`assert-image.sh`/`unknown`） | 0 | `ok` |

`lint` 的文件数从 30 增至 32，正是两个新增 `.yml`（`lint-workspace.mjs` 会把 `*.yml` 交给 js-yaml 解析）。

## 偏离计划之处

**1. [Rule 1 - 与事实冲突] `ci.yml` 的分支写成 `[master, main]`，而非计划文本的 `[main]`**
- 发现于：Task 4
- 依据：本地分支名为 `master`、仓库无 remote、`homeweave_app/config.yaml` 的 `url` 用 `tree/master`、`02-RESEARCH-CI.md` 第 54 行写 `branches: [master]`。只写 `main` 会让 CI 在真实默认分支上永不触发 —— 门禁形同不存在。
- 处理：同时列出 `master` 与 `main`；文件头注释写明原因。`validate-workflows.mjs` 不校验分支，无需改规则。

**2. [Rule 1] `tag` 的 tag 注解不含 digest**
- 计划写 `-m "<digest> <run url>"`，但 `tag` job 拿不到镜像 digest（`assert-manifest-platforms.mjs` 只校验平台集合与版本，不输出 digest；引入 digest 需要新的跨 job output）。
- 处理：注解改为 `"<image-ref> verified at <run url>"`，不编造 digest。若要 digest，需要在 verify-image 增加一个写 `$GITHUB_OUTPUT` 的 step —— 属新增契约，留给后续计划。

**3. [Rule 1] `publish` 的 setup-node 不带 `cache: pnpm`**
- 计划要求 `publish` 的第二 step 是 `actions/setup-node@v7`，但 `cache: pnpm` 需要 pnpm 已安装（`pnpm/action-setup` 在第三步）。因此 `publish` 的 setup-node 省略 `cache`，`static` 与 `ci.yml` 则保持 pnpm → setup-node（cache 生效）。代价只是 `publish` 少一次缓存，正确性不受影响。

**4. [流程偏离] 本计划被拆成两次派发**
- Tasks 1-3 由前一次执行完成（提交 `c759863`、`8dfd8d1`、`7bcde21`），Tasks 4-7 由本次执行完成（`c70983f`、`d19062c`、`af7cc46`、`b528d02`，加本 SUMMARY 的提交）。
- 影响：本次执行**没有重做也未修改** `scripts/validate-workflows.mjs` 的任何规则；20 条规则原样作为裁判，`ci.yml`/`release.yml` 是按规则输出逐条修正出来的，而不是反过来放宽规则。

**5. [Rule 2] README 文档索引补入 `docs/21` 与 `docs/22`**
- 索引原本缺这两个已存在的文件；新增 `docs/23` 时一并补齐，避免索引继续误导。

## 验证边界（务必按此口径引用）

- **两个 workflow 从未在 GitHub 上运行过。** 本机无 Docker、无 `gh` CLI，且未 push（仓库无 remote）。因此 `publish` 的双架构推送、`verify-image` 的匿名 pull、`assert-image.sh` 的八项检查、`tag` 的 `git push`，**全部未运行**。
- **`validate:workflows` 只证明结构自洽**（依赖图、权限、布尔取值、必含 token、每个 job 首个 step 是 checkout），**不证明 CI 会通过**。它无法证明：action 的 `@vN` 在 GitHub 上确实存在、`pnpm install --frozen-lockfile` 在 runner 上成功、GHCR 的实际报错文案与 `classifyTagState` 关键字吻合。
- **`docker`/`gh` 相关的实测一项都没有做。** `check-tag-free.mjs`、`assert-manifest-platforms.mjs` 的行为只由纯函数单测覆盖（固定字符串喂入）。
- **预期第一次真实运行会在 `verify-image` 的匿名 pull 处变红**（GHCR 包默认 private）。这是设计意图，按手册 §2 → §4 处理。

## 已知风险/待办（不隐藏）

- `scripts/build-image.mjs` 第 34 行的注释写着 `docs/23 does not exist in this repository`，本计划创建了 `docs/23_IMAGE_RELEASE_RUNBOOK.md` 后该注释已过时。未修改（不在本计划 files_modified 内，且不影响任何断言：`DOCKER_MISSING_MESSAGE` 指向 docs/21 是被单测锁定的）。下次触碰该文件时应删掉那半句。
- 首次运行若 GHCR 的实际文案与 `classifyTagState` 的关键字不匹配，按 `unknown-error` fail-closed 处理并**补关键字**，不得放宽为「非零即空闲」。
- 「私有但存在」的包在两处 `gh api` 端点都 404 时会被判 `absent`，从而被 `--allow-missing-package` 放行，理论上可能覆盖同名 tag。run 日志会留下 `::warning::package has never been published` 可事后审计。这是本阶段接受的残余风险。
- `gitleaks` 未纳入 job 清单：SEC-03 的覆盖仅限 `docker history --no-trunc` 断言、镜像文件系统扫描与 `.dockerignore`；**git 历史中的密钥不在覆盖内**（手册 §7 已明写）。

## Self-Check: PASSED

- 文件存在：`.github/workflows/ci.yml`、`.github/workflows/release.yml`、`docs/23_IMAGE_RELEASE_RUNBOOK.md`、`.planning/phases/02-image-release/02-04-SUMMARY.md`（本文件）。
- 提交存在且是本计划提交：`c70983f`、`d19062c`、`af7cc46`、`b528d02` 均在 `2922d07..HEAD` 上（`git rev-list --count 2922d07..HEAD` = 7）。
- 工作区无遗留未提交的计划内文件（仅 `.planning/tmp/` 为既有未跟踪目录，按约定未触碰）。
