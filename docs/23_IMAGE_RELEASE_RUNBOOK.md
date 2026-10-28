# 23 — 镜像发布手册（GitHub Actions + GHCR）

> 适用范围：把 HomeWeave 后端镜像发布到 `ghcr.io/zee1988/homeweave-ha-app`，并交给 Home Assistant Supervisor 拉取。
>
> **本手册的所有步骤都在 CI（GitHub Actions）上执行，没有任何一步在作者本机验证过。**
> 本机没有 Docker、没有 `gh` CLI，两个 workflow 从未在 GitHub 上运行过（详见 §9）。

---

## 1. 发布顺序，以及为什么不能反转

发布不是「跑一堆命令」，而是一张依赖图。`.github/workflows/release.yml` 的 job 结构：

```
guard        读 homeweave_app/config.yaml → version / ref；校验格式；校验与两个 input 一致
  └─ static  七个静态门禁（validate:workflows / validate:app / validate:dockerfile / lint / typecheck / test / check:app）
       └─ publish       if: !inputs.resume_from_verify
                        重新断言 tag 空闲 → buildx 双架构 push（provenance / sbom 关闭）
            └─ verify-image   if: always() 且 static 绿 且（publish 成功 或（resume 且 publish 被跳过））
                             docker logout → 清 ~/.docker/config.json 的 auths → 匿名 docker pull
                             → bash scripts/ci/assert-image.sh <ref>
                             → node scripts/assert-manifest-platforms.mjs <ref> <version>
                 └─ tag   needs: [guard, verify-image] → 此刻才创建并推送 git tag
```

反转的后果：如果先打 git tag 再推镜像，那么「版本号存在」不再意味着「可部署的镜像存在」。Supervisor 只会按 `config.yaml` 的 `image` + `version` 拼引用去拉，拉不到就是升级失败，而此时仓库里已经有一个看似成功的 tag。

因此顺序由 `needs` 强制，而不由文档约束：`tag` 的唯一上游是 `verify-image`，而 `verify-image` 绿的前提是**在没有凭据的状态下能拉到该镜像**。

**审计口径**：任意版本 tag 的 commit 时间必须晚于对应 GHCR manifest 的 `created_at`。若相反，说明有人绕过 workflow 手工打了 tag。

**已发布版本**：`0.1.0`（Phase 2 骨架）、`0.1.1`（Phase 3 运行时行为：启动 fail-fast 与 8 秒优雅关闭，决策 D-01b）。tag 一经发布不复用，所以任何运行时行为变更都必须换版本号——这也是 `0.1.0` 的镜像永远拿不到 Phase 3 修复的原因。

## 2. 包的可见性：先测，不要预设 private

> **实测修正（2026-10-28）**：本节原先断言「用 `GITHUB_TOKEN` 推送的 package 即使源仓库公开，初始可见性仍是 private」。**首次真实发布证伪了这条**：在 `Zee1988/homeweave`（public）上推送 `0.1.0` 后，`verify-image` 的匿名 `docker pull` 直接成功，无需任何手动改可见性操作。
>
> 因此正确做法是**让 `verify-image` 自己回答**：它绿就说明包已可匿名拉取，不需要 §2 的任何操作；它红在 `unauthorized` / `denied` 时才执行下面的步骤。

如果确实需要改：

```bash
gh api --method PATCH /user/packages/container/homeweave-ha-app -f visibility=public
```

或 GitHub Web UI：个人头像 → Your packages → `homeweave-ha-app` → Package settings → Danger Zone → Change visibility。

注意 `gh api /user/packages/...` 需要 `read:packages` 作用域；默认的 `gh auth login` token 通常没有，会返回 403 `You need at least read:packages scope`。那只影响**查询**，不影响 `verify-image` 的匿名 pull 结论。

改完之后**不要**重新走完整流程（会卡在 guard 的「tag 必须空闲」），按 §4 用 resume 重跑。

```bash
gh api --method PATCH /user/packages/container/homeweave-ha-app -f visibility=public
```

或 GitHub Web UI：个人头像 → Your packages → `homeweave-ha-app` → Package settings → Danger Zone → Change visibility。

改完之后**不要**重新走完整流程（会卡在 guard 的「tag 必须空闲」），按 §4 用 resume 重跑。

## 3. 「公开可拉」的证据必须是匿名拉取

只证明「带 token 能拉」是无效证据：CI runner 上残留的凭据会让 `docker pull` 以已登录身份成功，从而完全验证不到 Supervisor 的真实前提（Supervisor 不持有你的 GHCR 凭据）。

`verify-image` 的顺序因此是固定的：

```bash
docker logout ghcr.io || true
printf '{}' > "$HOME/.docker/config.json"   # 关键：清掉残留的 auths
docker pull ghcr.io/zee1988/homeweave-ha-app:<version>
```

`docker logout` 之后仍可能残留 `~/.docker/config.json` 里的 `auths` 条目（其它 registry、credential helper），所以覆写该文件才是真正的清凭据动作。这一步失败时 stderr 通常为 `unauthorized` 或 `denied` —— 那说明包还是 private，回到 §2。

## 4. resume 例外流程（首次发布的正常路径之一）

场景：第一次 `publish` 成功 → `verify-image` 的匿名 pull 因包为 private 变红 → `tag` 被跳过。

此时**不要**改 `validate-workflows.mjs` 的规则、也不要把 `check-tag-free` 放宽。「不重建、只复核」被做成了一个显式、可审计的 input：

1. 按 §2 把包设为 public。
2. 在 GitHub 上重新触发 `release`，输入同一个 `version` 与 `confirm_version`，并把 **`resume_from_verify` 勾选为 true**。
3. 该次运行的 job 行为：
   - `guard` 走 resume 分支：`check-tag-free.mjs <ref> --expect exists` —— 镜像**必须真的已存在**，否则 resume 无意义。
   - `publish` 被 `if: ${{ !inputs.resume_from_verify }}` 整体跳过，**不重写镜像**。
   - `verify-image` 走 `always()` 分支继续验证；其条件是「`publish` 结果为 `skipped`」，**不是**「`publish` 结果不是 `skipped`」。因此 `publish` 失败时 resume 不会把发版洗成绿色。
   - `tag` 在 `verify-image` 绿之后创建并推送 tag。
4. run 记录里保留着 `resume_from_verify: true`，审计可直接查。

## 5. 回滚

**已发布的镜像 tag 不允许覆盖。** `guard` 与 `publish` 各自运行 `scripts/check-tag-free.mjs --expect free`，tag 已存在即 fail-closed 退出。

回滚做法：

- 旧版本镜像**保持不动**。要回到旧版本，把 `homeweave_app/config.yaml` 的 `version` 改回旧版本号并重新发布 App 元数据（`corepack pnpm generate:app`），Supervisor 会重新拉取仍然存在的旧镜像。
- 要发新版本，就把 `config.yaml` 的 `version` 提到下一个未发布过的版本号，走完整流程。
- 想「修正一个已发布的版本」在机制上不存在；只能发新版本号。

## 6. 六种失败模式的判读

| # | 现象（CI 日志） | 发生在 | 含义与处置 |
|---|---|---|---|
| 1 | `✗ tag already exists in GHCR; bump config.yaml version` | `guard` 或 `publish` | 该版本号已发布过。不要重跑、不要覆盖：把 `config.yaml` 的 `version` 提到下一个未发布值。若镜像其实没变，仍需新版本号。 |
| 2 | `✗ ... failed for an authentication reason`（403 / `unauthorized` / `insufficient_scope`） | `guard` 或 `publish` | `docker manifest inspect` 的**非零退出码不等于「tag 空闲」**。认证类失败一律 fail-closed，只有「明确 not-found 文案」才判为空闲。检查 `GH_TOKEN` 是否真的传给了该 step、token 是否具备 `packages: read`。 |
| 3 | `::warning::package has never been published; treating tag as free` | `guard`（首发） | 这是**唯一**被 `--allow-missing-package` 豁免的场景：`docker manifest inspect` 返回认证错误，且两处 `gh api` 端点（`/repos/<owner>/<repo>/packages/container/<pkg>` 与 `/users/<owner>/packages/container/<pkg>`）都返回 404，即包确实从未存在。**豁免边界**：只覆盖「认证错误 + 包不存在」。包状态为 `present` 或 `unknown` 时一律不放行；`unknown-error`（网络/工具/其它）与 flag 无关，始终 fail-closed。 |
| 4 | `✗ manifest platforms must be exactly [linux/amd64, linux/arm64]`（实际含 `unknown/unknown` 或只有单架构） | `verify-image` | 若列表里出现 `unknown/unknown`，说明 buildx 产出了 attestation manifest —— 即 `provenance` 没有被真正关掉（`provenance: false` 必须是布尔，不能是字符串 `"false"`）。若只有单架构，说明 `platforms` 被改过。 |
| 5 | `✗ version mismatch` / guard 的 `input version does not match the config.yaml version` | `guard` / `verify-image` | 触发 workflow 时手输的版本与 `homeweave_app/config.yaml` 的 `version` 不一致，或镜像 tag 与 `config.yaml` 不一致。镜像 tag 与 git tag 必须**一字不差**等于 `config.yaml` 的 `version`，且不带 `v` 前缀。 |
| 6 | `docker pull` 输出 `unauthorized` / `denied` | `verify-image` | 包仍是 private，或可见性刚改完但缓存未生效。按 §2 改 public，按 §4 用 `resume_from_verify=true` 重跑（**不要**重跑完整流程）。 |

## 7. SEC-03 的实际覆盖范围（以及明确未覆盖的部分）

已覆盖（在 `verify-image` → `scripts/ci/assert-image.sh` 内执行）：

- `docker history --no-trunc <ref>` 断言镜像历史中无 `ghp_` / `github_pat_` / `password=` / `BEGIN ... PRIVATE KEY` 等明文痕迹；
- 镜像文件系统中的 `.env` / `.env.*` / `*.pem` / `*.key` 断言（排除 `node_modules`）；
- `.dockerignore` 必须排除 `.env*`、`*.pem`、`*.key`、`secrets`；
- 镜像不含 devDependencies、不含源码 / `*.spec.ts` / `*.map`（IMG-01 / IMG-02）；
- `/health/live` 在运行中的容器内返回 200（`assert-image.sh` 第 9 项）。

运行时行为另由两个脚本在 `verify-image` 的同一 job 内断言（03-05）：

- `scripts/ci/assert-failfast.sh`：以 `DATABASE_URL=file:/nonexistent-dir/x.db` 与 `PORT=abc` 启动镜像，要求退出码为 **78** 且日志含 `startup_failed` 与对应 `reason`（`dir_missing` / `invalid_port`）。它同时证明镜像内 `ENV DATABASE_URL` 可被覆盖——若覆盖失效，第一个用例会正常启动而不是失败。
- `scripts/ci/assert-shutdown.sh`：等到 `/health/live` 返回 200 后执行 `docker stop`，要求退出码 0、日志顺序为 `stop accepting new requests` → `prisma disconnected`、无 `shutdown_forced`、耗时低于 10 s。这是唯一在真实 `SIGTERM` 下验证关闭链路的地方：Windows 上 `process.kill(pid,'SIGTERM')` 直接终止进程，unit/dist 测试只能通过事件派发覆盖同一套监听器。

**未覆盖，必须知道**：

- **git 历史中的密钥**：本阶段没有接入独立的历史扫描 job（`gitleaks` 未纳入 job 清单，见 §9）。历史上提交过又删掉的密钥不在任何断言范围内。
- **仓库级 secrets / 环境变量**：workflow 只引用仓库级 `GITHUB_TOKEN`，但仓库 secrets 的配置本身没有被校验。
- **非文件形式的编码密钥**：以 base64 / 十六进制等形式内联在代码或构建参数里的密钥，文本 grep 命中不了。

## 8. aarch64 的验证边界

`assert-image.sh` 的引擎架构检查由 `apps/api/prisma/ENGINE_DECISION` 的**取值**决定，不是由「文件在不在」决定：

- `NATIVE_ENGINE` → 在容器内读 `process.arch`，再按 `debian-openssl-3.0.x` / `linux-arm64-openssl-3.0.x` 查找原生引擎文件；
- `RUST_FREE` → 打印 `- skipped (RUST_FREE)` 并计为该条通过（Prisma 7 走 WASM query compiler，没有原生引擎文件可匹配）；
- **文件缺失、为空、或取值不是上面两个 → exit 1**。没有第三条「跳过」出口：`缺文件` 走的是 `case` 的 `*)` 分支，也就是失败。

即便如此，若在 amd64 主机（或仅 amd64 的 runner）上无法真实运行 aarch64 产物，结论一律标 **unknown**，不得写成「已验证」。同理，`docker pull` 成功只证明 manifest list 存在且可下载，**不**证明 arm64 位下的运行时行为。

## 9. 本阶段「已验证 / 未验证」的诚实边界

| 项目 | 状态 |
|---|---|
| `validate:workflows`（20 条结构规则，本地可跑） | **已验证**：本地 `pnpm validate:workflows` exit 0。它只证明两个 workflow 的结构自洽（依赖图、权限、布尔取值、必含 token），**不证明 CI 会通过**。 |
| `check-tag-free.mjs` / `assert-manifest-platforms.mjs` 的判定分支 | **已验证**：纯函数单测覆盖（固定字符串喂入，不依赖 Docker / `gh`）。 |
| 两个 workflow 的真实运行 | **未验证**：从未在 GitHub 上运行过一次。 |
| `publish` 的 buildx 双架构推送 | **未验证**：本机无 Docker。 |
| `verify-image` 的匿名 pull、`assert-image.sh` 九项检查 | **未验证**：本机无 Docker（含第 9 项 `/health/live` 容器内探测，脚本自身只在 CI 跑过）。 |
| GHCR 的实际报错文案与 `classifyTagState` 关键字是否吻合 | **未知（unknown）**：本机无 Docker、无 `gh`。若首次运行显示文案不匹配，按 `unknown-error` fail-closed 处理并补关键字，**不得**放宽为「非零即空闲」。 |
| 第二次发布（包已存在、token 带 `packages: write`）时远端对缺失 tag 返回的文案 | **未知（unknown）**：需实测后补判据，不得靠豁免绕过。 |

`pnpm build:image` 在本机会 exit 1 并打印 `✗ docker is not available on this machine; image builds are CI-only` —— 这是设计行为：本机**无法**构建镜像，所有构建与发布都只能走 GitHub Actions。

**首次真实发布必须有人值守**：预期第一次运行会在 `verify-image` 的匿名 pull 处变红（package 默认 private），按 §2 → §4 处置。
