---
phase: 02-image-release
verified: 2026-10-28
verdict: passed
verified_by: orchestrator, against real GitHub Actions runs (three failing, one green, one deliberate negative)
---

# Phase 02 Verification: 镜像构建与发布链路

**结论：`passed`。** Phase goal 的全部五条判据现在都有**真实运行证据**，不再有结构推断。

镜像已发布为 `ghcr.io/zee1988/homeweave-ha-app:0.1.0`，双架构 manifest list 经**匿名拉取**验证，git tag `0.1.0` 指向 `ccbc180`，且「tag 已存在即拒绝覆盖」由一次真实的负向运行证明。

唯一仍然未验证的一项是 **aarch64 镜像的实际运行**（见「未验证清单」），这不属于 Phase 02 的判据范围，但会影响 Phase 03。

## 真实运行记录

| Run | 触发 | 结果 | 结局 |
|---|---|---|---|
| 40612028289 | push master | `Install dependencies` exit 1 | 暴露缺陷 1（pnpm 版本漂移） |
| 40612379906 | push 修复 | **绿**（static gate 25s，9 步全过） | 首个真实 CI 证据 |
| 40612479283 | release 首跑 | `Tag must still be free` exit 1，`REF:` 为空 | 暴露缺陷 2（needs 缺 guard） |
| 40614006254 | release 二跑 | `invalid tag "type=raw"` | 暴露缺陷 3（metadata-action 语法） |
| 40614562404 | release 三跑 | **全绿** — guard 9s / static 24s / publish 3m46s / verify-image 23s / tag 6s | 发布完成 |
| 40615618681 | 同版本重跑（负向） | 11s 在 guard 失败 | 证明拒绝覆盖 |

## Phase 目标回溯

> Goal: 存在一个公开可拉取、多架构、标签与 App `version` 完全一致的预构建镜像，"先镜像、后版本号"的发布顺序由 CI 强制而非靠人记得。

| # | Success criterion | 判定 | 证据（run 40614562404，除注明外） |
|---|---|---|---|
| 1 | 单一命令构建出可启动的生产镜像，内含构建产物/Prisma Client/迁移，不含 devDeps/源码/sourcemap | **verified** | `publish` 真实构建成功（3m46s）。`verify-image` 的 8/8 断言：`1/8 devDependencies absent (typescript, @nestjs/cli, jest, eslint, ts-node, prisma)`、`2/8 sources absent (no /app/src, no *.ts, no *.spec.ts outside node_modules)`、`3/8 no *.map outside node_modules`、`4/8 artifacts present (OK:dist/main.js OK:dist/generated/prisma OK:prisma/migrations)`、`6/8 container started and is still running (startup log line seen, State.Running=true)` |
| 2 | GHCR 同时存在 amd64 与 aarch64 及指向两者的 manifest list，标签与 `config.yaml` 的 `version` 一字不差 | **verified** | `✓ manifest matches: platforms [linux/amd64, linux/arm64], tag 0.1.0 == config version 0.1.0`。第二次独立确认来自负向 run：`docker manifest inspect` 打印出的 index 同时含 `"architecture": "amd64"` 与 `"architecture": "arm64"` |
| 3 | CI 在构建前依次执行元数据/Dockerfile 校验、lint、typecheck、unit，任一步失败即阻断 | **verified** | `static gate` 的 7 个门禁在 CI 上真实执行：`✓ workflow checks passed (22 rules)` / `✓ 87 checks passed`（App 元数据）/ `✓ dockerfile checks passed (22 rules)` / `✓ lint passed (32 files)` / `✓ typecheck passed (@homeweave/api)` / unit tests / `check:app`。阻断由两次真实失败证明：publish 失败导致 verify-image 与 tag 跳过；guard 失败导致四个下游 job 全部跳过（run 40615618681，11s） |
| 4 | 镜像层、构建缓存、workflow 与仓库中不存在硬编码密钥；密钥扫描与历史检查是发布门禁 | **verified** | `7/8 no secret pattern in docker history --no-trunc`、`8/8 no .env / .env.* / *.pem / *.key outside node_modules`。仓库侧：`git ls-files` 122 个文件无 `ghp_`/`gho_`/`sk-`/`PRIVATE KEY` 命中；唯一命中 `.env.example` 是空模板 |
| 5 | 目标版本 tag 已存在时 CI 拒绝覆盖/复用，要求先发布镜像再提交版本号 | **verified（负向运行）** | run 40615618681：`✗ tag already exists in GHCR; bump config.yaml version`，exit 1，下游 `publish`/`verify-image`/`tag` 全部 skipped。同一脚本的 `--expect exists` 分支服务于 `resume_from_verify` 路径 |

## Requirement 覆盖

| Requirement | 判定 | 说明 |
|---|---|---|
| IMG-01（镜像含构建产物与 Prisma Client） | **verified** | `4/8 artifacts present`，含 `dist/main.js`、`dist/generated/prisma`、`prisma/migrations` |
| IMG-02（不含源码/devDeps/sourcemap） | **verified** | 断言 1/2/3 全过 |
| IMG-03（多架构） | **verified** | manifest `[linux/amd64, linux/arm64]`，集合相等断言。**运行**仅 amd64 —— 见未验证清单 |
| IMG-04（公开可拉） | **verified** | `verify-image` 先 `docker logout` 并覆写 `~/.docker/config.json`，随后匿名 `docker pull` 成功。这是「公开可拉」的定义性证据，比 API 查询更强 |
| IMG-05（镜像构建与版本号单一来源） | **verified** | `build:image` 本机 exit 1（`image builds are CI-only`）；版本只读 `homeweave_app/config.yaml`；`tags` 现在是 `needs.guard.outputs.ref`，镜像名在 workflow 里没有第二处硬编码 |
| SEC-03（无硬编码密钥进入镜像） | **verified** | 断言 7/8 |
| VER-01（CI 门禁） | **verified** | 门禁在 CI 上真实执行并真实阻断过 |

## 三次真实失败暴露的缺陷（本机全部不可见）

这三个缺陷都**不可能**在本地被发现：本机无 docker、无 bash、且从未有过远端。

| # | 缺陷 | 逃逸原因 | 修复 |
|---|---|---|---|
| 1 | `package.json` 缺 `packageManager`，corepack 解析到 `pnpm@latest`（12.15.0），其 `minimumReleaseAge` 拒绝 5 个 2026-10-27 发布的包 | 本机 corepack 对同一命令解析出 9.15.4，两边都依赖隐式默认值 | `"packageManager": "pnpm@9.15.4"`；不放宽供应链策略 |
| 2 | `publish` / `verify-image` 读 `needs.guard.outputs` 却**没有在 `needs` 里声明 `guard`**，GitHub 把它展开成空串 | 没有任何本地检查看 `needs` 表达式；`validate-workflows` 的 20 条规则全是字段值与依赖边，不解析表达式引用 | 补 `needs`；新增规则 F13 `checkNeedsReferences`（引用必须已声明、必须存在、不得自引用）+ 4 个用例 |
| 3 | `with.tags: type=raw,value=...` 是 `docker/metadata-action` 语法，buildx 原样接收后报 `invalid reference format` | **校验器本身在强制这个错误值** —— 原规则要求 `tags` 必须含 `type=raw,value=` | `tags: ${{ needs.guard.outputs.ref }}`；规则反转：禁止 `type=`，要求引用 `needs.guard.outputs.ref` |

缺陷 3 是最值得记住的一条：**一个断言了错误事实的校验器，比没有规则更危险**，因为它会给 bug 盖章。同类问题在本次核验中第二次出现（`docs/23` §8 的引擎检查描述），说明「校验器的断言必须能追溯到被验证对象的真实语义」是这个仓库反复踩的坑。

## 未验证清单（不得据此声称通过）

1. **aarch64 镜像的实际运行**。`verify-image` 在 `ubuntu-24.04`（amd64）runner 上 `docker run`，拉取并执行的是 amd64 镜像；arm64 只被构建与推送，从未执行。Phase 03 若要在 HAOS（常见为 aarch64）上跑，必须在那台设备上验证启动。
2. **`classifyTagState` 对 GHCR 其他文案的适应性**。负向运行覆盖了「tag 存在」，`--expect exists`（resume 路径）分支仍未真实触发。
3. **`resume_from_verify=true` 路径**。设计用于「verify 失败后仅重跑 verify」，从未真实走过。
4. **长期稳定性**：镜像只有一个版本 `0.1.0`，未验证第二次版本升级（0.1.1）时 guard/verify 的行为。
5. `docs/23` §7 声明的未覆盖项（git 历史中的密钥、仓库 secrets 配置、编码后的密钥）仍然成立。

## 核验中发现并已修正的问题

| 问题 | 处理 |
|---|---|
| `docs/23` §8 写成「引擎检查是条件性的」，与脚本 `*)` → fail 矛盾 | 已改写（`8d6874a`） |
| `02-04-SUMMARY.md` 的 `key-files.created` 只列 3 个文件 | 已归位（`8d6874a`） |
| 校验器缺 `needs` 表达式规则，且强制 `type=raw,value=` | 已修（规则 F13 新增；tags 规则反转） |
| 编排侧过程：`gsd-executor` 两次、`gsd-verifier` 一次触及上下文上限 | 缺口由编排侧复验补账，未放宽任何断言 |

## 判定

Phase 02 **完成**。判据 1-5 全部由真实运行证明，其中判据 5 由负向运行证明。

发布产物：`ghcr.io/zee1988/homeweave-ha-app:0.1.0`，manifest `[linux/amd64, linux/arm64]`，匿名可拉，git tag `0.1.0` → `ccbc180`。

进入 Phase 03 前必须先读「未验证清单」第 1 条：**arm64 从未运行过**。
