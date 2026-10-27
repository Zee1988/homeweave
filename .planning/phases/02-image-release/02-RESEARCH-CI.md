# Phase 02: 镜像发布 — CI/Release 半侧研究

**研究时间:** 本次会话 | **范围:** 仅 CI/release（`.github/workflows/*`、发布顺序强制、GHCR 存在性断言、多架构构建、公共可拉取证明、脚本入口）
**Confidence:** MEDIUM（action 版本 HIGH；GHCR 运行时行为 MEDIUM/LOW，见假设日志）

## Summary

Supervisor 用 `image + ":" + version` 拼拉取引用：`image: ghcr.io/zee1988/homeweave-ha-app` + `version: "0.1.0"` → 真实引用 `ghcr.io/zee1988/homeweave-ha-app:0.1.0`。故必须发布**恰好** `0.1.0`，且是 amd64+aarch64 的 manifest list。

**主要建议:** 用显式 job 依赖图（`guard → static → publish → verify → tag`）把"先镜像、后版本号"变成结构性事实，而非文档纪律。版本唯一来源 = `config.yaml`；`workflow_dispatch` 只能"确认"不能"另给版本"。存在性断言必须 fail-closed：任何非 "not found" 的失败都报错退出。

## Standard Stack — 已验证 Action 版本

全部经 `git ls-remote --tags --refs --sort=-v:refname <repo>` 实查上游（本次会话），下表 tag 与 SHA 均来自真实返回。

| Action | 推荐写法 | 上游最新 tag | commit SHA |
|--------|----------|--------------|------------|
| `actions/checkout` | `@v7` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `@v7` | `v7.1.0` | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `pnpm/action-setup` | `@v6` | `v6.1.0` | `d9184bf108216479bc5a137cc391f4d7b14c870b` |
| `docker/setup-qemu-action` | `@v4` | `v4.4.0` | `99012661954931238ded8c8b007157a8430204e1` |
| `docker/setup-buildx-action` | `@v4` | `v4.4.1` | `f87e5991a6d7451dcb8d9637bfbc97413f497069` |
| `docker/login-action` | `@v4` | `v4.7.0` | `81c6f93d4bc991e510b342a00b419b3bb4efc5c6` |
| `docker/metadata-action` | `@v6` | `v6.2.0` | `dc802804100637a589fabce1cb79ff13a1411302` |
| `docker/build-push-action` | `@v7` | `v7.4.0` | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` |
| `gitleaks/gitleaks-action` | `@v3` | `v3.0.0` | `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` |

**pin 策略:** 用移动主标签（`@v7`）；若要更强供应链保证，改用上表 SHA 加 `# v7.0.1` 注释。禁用 `@main`。

**pnpm 坑（必然踩）:** 根 `package.json` 无 `packageManager` 字段 → `pnpm/action-setup` 报 `No pnpm version is specified`。必须 `with: { version: 9.15.4 }`，不要为此改 `package.json`（会扰动 `corepack pnpm` 解析路径与 lockfileVersion）。

## 发布顺序强制（crux）

**需求的可观测翻译:** 任何"版本标记"（git tag `v0.1.0`、CHANGELOG、release）出现时，`ghcr.io/...:0.1.0` 必须已同时具备 `linux/amd64` 与 `linux/arm64`。

| 机制 | 失效方式 | 失败输出 |
|------|----------|----------|
| (a) 版本只来自 `workflow_dispatch`/`RELEASE_VERSION`，改 `config.yaml` 只是记账 | input 与 `config.yaml` 漂移：用 input 发 `0.2.0` 却忘记改 `config.yaml:0.1.0` → Supervisor 仍拉 `0.1.0`，拿到旧镜像或 `manifest unknown`。**CI 全绿，运行期才炸** | 无输出（这正是问题）。运行期：`pull access denied ... manifest unknown` |
| (b) 读 `config.yaml` 且要求 git tag == 该值 | 等值只证明两字符串相同，不证明镜像存在；且顺序天然反转——为比对必须先打 tag，**tag 先于镜像**，恰违反需求 | `Error: git tag v0.1.0 does not match config.yaml version 0.1.0`（能抓拼写漂移，抓不到顺序） |
| (c) 先推镜像再同 run 校验（宽松"已存在 → 拒绝"） | 只拦重复发布，不拦顺序；无法区分"本 commit 构建"与"上次遗留的同版本镜像"。作为唯一机制 = 没有顺序保证 | `Error: ghcr.io/...:0.1.0 already exists; refusing to overwrite` |

**推荐 = (b) 定版本来源 + 结构性 job 依赖 + (c) 作附加断言。** 顺序不靠文档靠依赖图：`tag` job 声明 `needs: [verify]`，GHCR 不存在则 `verify` 非零退出 → `tag` 永不启动。这是唯一绕不过的实现。

```yaml
name: release
on:
  workflow_dispatch:
    inputs:
      confirm_version:
        description: '必须与 homeweave_app/config.yaml 的 version 完全一致'
        required: true
        type: string
  push:
    branches: [master]
    paths-ignore: ['.planning/**', 'docs/**', '*.md']
permissions: { contents: read }
concurrency: { group: 'release-${{ github.ref }}', cancel-in-progress: false }

jobs:
  guard:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.v.outputs.version }}
      ref: ${{ steps.v.outputs.ref }}
    steps:
      - uses: actions/checkout@v7
      - id: v
        run: |
          set -euo pipefail
          V=$(node -e "const y=require('js-yaml'),f=require('fs');process.stdout.write(y.load(f.readFileSync('homeweave_app/config.yaml','utf8')).version)")
          IMG=$(node -e "const y=require('js-yaml'),f=require('fs');process.stdout.write(y.load(f.readFileSync('homeweave_app/config.yaml','utf8')).image)")
          echo "version=$V" >> "$GITHUB_OUTPUT"; echo "ref=$IMG:$V" >> "$GITHUB_OUTPUT"
          echo "resolved: $IMG:$V"
          case "$V" in v*) echo "::error::version must not start with 'v'"; exit 1;; esac
          if [ -n "${{ inputs.confirm_version }}" ] && [ "${{ inputs.confirm_version }}" != "$V" ]; then
            echo "::error::confirm_version != config.yaml version"; exit 1; fi
```
> 只用 `devDependencies.js-yaml@^4.1.0`（已在仓库），不新增依赖。

  static:
    needs: guard
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
        with: { version: 9.15.4 }
      - uses: actions/setup-node@v7
        with: { node-version: '22', cache: pnpm }
      - run: corepack enable && corepack pnpm install --frozen-lockfile
      - run: corepack pnpm check:app && corepack pnpm validate:app   # 元数据/Dockerfile 校验先行
      - run: corepack pnpm lint
      - run: corepack pnpm typecheck
      - run: corepack pnpm test:app
```
门禁顺序固定为 **元数据 → lint → typecheck → unit**，任一步非零则后续步骤与下游全部 job 不启动（`needs` 传递性）。

### 构建前的存在性断言（fail-closed，作为 `publish` 的首个 step）
```yaml
      - name: tag must be free
        run: |
          set -euo pipefail
          set +e; out=$(docker manifest inspect "${{ needs.guard.outputs.ref }}" 2>&1); rc=$?; set -e
          echo "$out"
          if [ "$rc" -eq 0 ]; then echo "::error::tag already exists in GHCR; bump config.yaml version"; exit 1; fi
          case "$out" in
            *"no such manifest"*|*"manifest unknown"*|*"not found"*) echo "OK: tag free";;
            *) echo "::error::inspect failed for a NON-not-found reason (auth/network); refusing to continue"; exit 1;;
          esac
```
> 这段就是第 3 问的 auth-misread 落点：`docker manifest inspect` 对"不存在"和"未授权"**都返回 exit 1**，只判退出码会把 403 当"tag 空闲"，从而允许覆盖。

### 检测 GHCR tag 是否存在 — 四种手段对比

| 手段 | `ubuntu-latest` 预装 | 需要 token | 存在 | 不存在 | 认证失败 |
|------|---------------------|-----------|------|--------|----------|
| `docker manifest inspect <ref>` | ✓（docker 自带） | 私有包需 `docker login`；公开包可匿名 | exit 0 + OCI JSON | exit 1，stderr 含 `no such manifest` / `manifest unknown` | exit 1，stderr 含 `unauthorized` / `denied` / `authentication required` |
| `crane manifest <ref>` | ✗ 需自装（`go install`/下载 release） | 同上（走 docker keychain） | exit 0 + JSON | exit 1，`MANIFEST_UNKNOWN` | exit 1，`UNAUTHORIZED` |
| `skopeo inspect docker://<ref>` | ✗ 需 `apt install skopeo` | `--creds` 或 `docker login` | exit 0 | exit 1，`manifest unknown` | exit 1，`unauthorized: authentication required` |
| `gh api /user/packages/container/homeweave-ha-app/versions` | ✓（`gh` 预装） | 需 `packages: read` | 200 + JSON 数组（含 `created_at`、`metadata.container.tags`） | 包存在但无该 tag：**200**，需自己遍历 tags —— 最易误判 | **403**（token 无权限/包未关联仓库）或 404（包不存在） |

**建议:** 主用 `docker manifest inspect` + 上文的 stderr 分支；`gh api` 作交叉校验与审计（取 `created_at` 证明"镜像早于 tag"）。**不要**用 `gh api` 单独判"tag 不存在"——它对缺失 tag 返回 200，是比 auth 误读更隐蔽的坑。

### `verify` → `tag` 顺序闸门
```yaml
  verify:
    needs: [guard, publish]
    permissions: { contents: read, packages: read }
    runs-on: ubuntu-latest
    steps:
      - uses: docker/login-action@v4
        with: { registry: ghcr.io, username: '${{ github.actor }}', password: '${{ secrets.GITHUB_TOKEN }}' }
      - run: |
          set -euo pipefail
          docker manifest inspect "${{ needs.guard.outputs.ref }}" > /tmp/index.json
          node -e 'const m=JSON.parse(require("fs").readFileSync("/tmp/index.json","utf8"));
            const a=(m.manifests||[]).filter(x=>x.platform&&x.platform.os==="linux").map(x=>x.platform.architecture).sort();
            console.log("platforms:",a.join(","));
            if(a.length!==2||!a.includes("amd64")||!a.includes("arm64")){console.error("::error::need exactly amd64+arm64");process.exit(1);}'

  tag:                                    # 只有 verify 绿了才会存在 —— 这就是"先镜像、后版本号"的证据
    needs: [guard, verify]
    if: github.event_name == 'workflow_dispatch'
    permissions: { contents: write }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: |
          set -euo pipefail
          git tag -a "v${{ needs.guard.outputs.version }}" -m "image already in GHCR"
          git push origin "v${{ needs.guard.outputs.version }}"
```
审计口径：任意 `vX.Y.Z` tag 的 commit 时间必须晚于对应 GHCR manifest 的 `created_at`。

## 多架构构建策略

| 方案 | wall clock | `type=gha` 缓存 | 复杂度 |
|------|-----------|------------------|--------|
| 单 job + QEMU，`platforms: linux/amd64,linux/arm64` | arm64 全程模拟，慢 3–8×；总时长 ≈ amd64 + 3~8×arm64 | 每 arch 独立 scope，单 job 内一次导入导出，命中率最高 | 最低 |
| 并行原生 per-arch + `docker buildx imagetools create` 合并 | 两 arch 并行，墙钟接近慢者，但多两个 job 的检出/排队开销 | 必须显式 `scope=amd64`/`scope=arm64`，否则相互污染 | 高（`push-by-digest` + artifact 传 digest + merge job） |

**建议: 单 job + QEMU。** 镜像产物小（HA app 容器，非编译重负载）；单 job 让 gha 缓存语义最简；per-arch 拆分只在构建逼近 runner 超时才值得。

```yaml
  publish:
    needs: [guard, static]
    if: github.event_name != 'pull_request'
    permissions: { contents: read, packages: write }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-qemu-action@v4
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with: { registry: ghcr.io, username: '${{ github.actor }}', password: '${{ secrets.GITHUB_TOKEN }}' }
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/zee1988/homeweave-ha-app
          tags: type=raw,value=${{ needs.guard.outputs.version }}   # 只要裸版本号
          labels: org.opencontainers.image.source=https://github.com/Zee1988/homeweave
      - uses: docker/build-push-action@v7
        with:
          context: ./homeweave_app
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: false
          sbom: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
```
**禁止 `type=semver`:** 它会产出 `v0.1.0`/`0.1`/`0.1.0` 一整套，Supervisor 拿到 `v0.1.0` 就拉不到。`type=raw` 原样输出 `0.1.0`。

**provenance/SBOM × manifest list:** `build-push-action` v6+ 默认 `provenance: mode=min`，会往 index 追加 `unknown/unknown` 平台的 attestation manifest。后果：`manifests.length` 变成 3，上文"恰好 2 个平台"断言误报；`imagetools create` 合并时 attestation 被一并搬运易嵌套；老客户端遇未知平台可能回退。**本阶段设 `provenance: false` + `sbom: false`**，让 tag 严格等于 `{linux/amd64, linux/arm64}`。签名/attestation 留给后续里程碑。

## 公共可拉取证明（SC2）

- **默认是 private。** 用 `GITHUB_TOKEN` 推到 GHCR 的 package，即使源仓库公开，初始可见性仍为 **private**，需一次性改公开：Web UI（Packages → Package settings → Change visibility）或
  `gh api --method PATCH /user/packages/container/homeweave-ha-app -f visibility=public`（本仓库为个人账号，用 `/user/`；组织则 `/orgs/<org>/`）。
- **CI 证明匿名可拉:** 必须先清 runner 凭据，否则"成功"只证明"带 token 能拉"：
  ```bash
  docker logout ghcr.io || true
  printf '{}' > "$HOME/.docker/config.json"     # 关键：清掉残留 auths
  docker pull ghcr.io/zee1988/homeweave-ha-app:0.1.0   # 必须成功
  ```
  私有时该命令 stderr 为 `unauthorized`（正是判据）。
- **未签名镜像不阻塞 Supervisor 拉取** —— `[ASSUMED]`：HA Supervisor 走普通 registry pull，不校验 cosign/notation 签名。故签名不是本阶段的前置条件。

## Gating order 与 fork 安全（SC3 / SEC-03）

- 结构：`guard → static（校验→lint→typecheck→unit）→ publish（tag 空闲断言 + buildx push）→ verify → tag`，全部 `needs:` 串联；`publish` 加 `if: github.event_name != 'pull_request'`。
- **为什么 fork PR 不能拿 `packages: write`:** fork 的 `GITHUB_TOKEN` 天然只读，即便 workflow 里写了 `packages: write` 也会被降级为 read → push 失败并 403（安全，但会红）。真正的雷是 `pull_request_target` + 检出 PR head：那等于用**可写 token** 执行陌生人代码。本阶段一律不用 `pull_request_target`。
- **最小权限:** 顶层 `permissions: { contents: read }`；仅 `publish` job 提权 `packages: write`，仅 `tag` job 提权 `contents: write`，`verify` 只 `packages: read`。
- **`docker history --no-trunc` 泄漏检查:**
  ```bash
  if docker history --no-trunc "ghcr.io/zee1988/homeweave-ha-app:0.1.0" | grep -Ei 'ghp_|github_pat_|password=|BEGIN [A-Z ]*PRIVATE KEY'; then
    echo "::error::secret material found in image history"; exit 1; fi
  ```
  已泄漏无法事后修补 —— Dockerfile 内必须用 `RUN --mount=type=secret` 而非 `ARG`/`ENV`/`COPY`。
- **gitleaks CI 调用与退出语义:** `gitleaks/gitleaks-action@v3`，需要 `permissions: { contents: read, pull-requests: read }` + 检出 `fetch-depth: 0`（否则扫不到历史）。**发现泄漏 exit 1 → job 失败**；无泄漏 exit 0。**注意** `[ASSUMED]`：v3 对**组织**账号需 `GITLEAKS_LICENSE` secret，个人账号免费。若本仓库被判为需 license，回退方案是直接跑 CLI 免 license：`docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect -s /repo --no-git -v`（其 tag 未验证 → `UNVERIFIED`）。

## README / package.json 脚本（VER-01）

现状：`scripts` 只有 `generate:app`/`validate:app`/`check:app`/`test:app`；**`apps/api` 尚不存在**。本阶段必须补齐可复现入口，且不新增依赖（零依赖 `scripts/*.mjs`）：

| 期望命令 | 状态 | 实现方式（本阶段创建） |
|----------|------|------------------------|
| `corepack pnpm lint` | **待创建** | `node scripts/lint-workspace.mjs` —— 对全部 `.mjs` 跑 `node --check`，并对 JSON/YAML 做解析校验；零依赖 |
| `corepack pnpm typecheck` | **待创建** | `node scripts/typecheck-workspace.mjs` —— 当前无 TS 源，输出 `no TypeScript workspace yet` 并 exit 0；`apps/api` 落地后改为 `pnpm -r typecheck` |
| `corepack pnpm test` | **待创建** | 现为 `node --test "scripts/**/*.test.mjs"`；后续聚合为 `pnpm -r test` |
| `corepack pnpm test:app` | 已存在 | 66 用例 + drift check，保持不变 |

README 需写明三条命令与"`typecheck` 目前是显式跳过而非真实类型检查"这一事实，避免误读为已通过类型检查。

## 候选验证命令

| 需求 | 自动化检查 | 失败输出 |
|------|-----------|----------|
| IMG-03 | `corepack pnpm check:app && corepack pnpm validate:app` | `drift detected` / `check failed`，exit≠0 |
| IMG-04 | `docker manifest inspect ghcr.io/zee1988/homeweave-ha-app:0.1.0 \| node -e '…过滤 linux 平台…'` 断言集合 == `{amd64,arm64}` | `::error::need exactly amd64+arm64`；stderr `no such manifest` = 镜像未发布 |
| IMG-05 | `docker logout ghcr.io; printf '{}' > ~/.docker/config.json; docker pull ghcr.io/…:0.1.0` | `unauthorized` / `denied` = 包仍 private |
| SEC-03 | `docker history --no-trunc <ref> \| grep -Ei 'ghp_\|github_pat_\|password='` 无输出；`gitleaks` exit 0 | 命中即失败；history 出现 `ARG`/`ENV` 值即失败 |
| VER-01 | `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test` 在干净 clone 上 exit 0 | `ERR_PNPM_NO_SCRIPT`（脚本缺失）/ `node --check` 语法错误 |

**无法在无真实 GHCR 访问时验证（必须标注）:**
- **IMG-04/IMG-05 的"存在性/匿名可拉"部分** —— 需要真实 GHCR 凭据与已发布 package；本地只能验证 workflow 语法（`actionlint`）与断言脚本的**分支逻辑**（用假的 stderr 字符串喂入）。
- **package 可见性 PATCH 与 `gh api` 200/403/404 判别** —— 需要 token 的实际权限，本地不可复现。
- **`provenance`/SBOM 对 index 元素数的影响** —— 需要一次真实 buildx push 才能观察到 3 vs 2 个 manifest。

## 假设日志 / 未验证项

| # | 内容 | 风险 |
|---|------|------|
| A1 | Supervisor 不校验镜像签名，未签名可正常拉取 | 若校验则需补 cosign 签名步骤 |
| A2 | `gh api /user/packages/…` 在个人账号下的路径与权限行为 | 路径错则审计命令失败 |
| A3 | `gitleaks-action@v3` 对个人仓库免 license | 需 license 时 CI 红，改用 CLI 回退 |
| A4 | `docker manifest inspect` 的具体 stderr 文案（`no such manifest` 等）| 文案变更会让 fail-closed 分支误判为"其他原因"并**安全地**报错（宁可红，不可覆盖），故可接受 |
| A5 | `skopeo` 未预装于 `ubuntu-latest` | **UNVERIFIED**，若预装则多一个可选手段；不影响推荐方案 |

## Sources

- **HIGH:** `git ls-remote --tags --refs --sort=-v:refname` 实查 9 个上游仓库（表内 tag/SHA 逐条来自返回）
- **HIGH:** 仓库内实证：`homeweave_app/config.yaml`（`version: "0.1.0"`、`image: ghcr.io/zee1988/homeweave-ha-app`、`arch: [amd64,aarch64]`）、根 `package.json`（脚本清单、`devDependencies.js-yaml@^4.1.0`、无 `packageManager`）
- **MEDIUM:** GHCR 可见性默认 private、`GITHUB_TOKEN` 推包行为（官方文档常识，本次未拉取原文）
- **LOW/UNVERIFIED:** `skopeo` 预装情况、`gitleaks-action` license 判定、zricethezav/gitleaks 镜像 tag

