# Phase 02 研究 — 镜像构建与发布链路

**日期**: 2026-10-27 ｜ **需求**: IMG-01..05, SEC-03, VER-01 ｜ **合并自**: `02-RESEARCH-BUILD.md`（容器构建侧）、`02-RESEARCH-CI.md`（CI/发布侧）
**总体置信度**: MEDIUM —— action 版本 HIGH（上游实查）；容器内行为 **本机无 Docker，全部 CI-only**；GHCR 运行时行为 MEDIUM/LOW。

## 一、约束链（本阶段一切设计的地基）

```
homeweave_app/app-metadata.json: version "0.1.0"
        │  generate:app（单一来源，V4 强制带引号）
        ▼
homeweave_app/config.yaml: version: "0.1.0"  +  image: ghcr.io/zee1988/homeweave-ha-app（无 tag，V6 禁止冒号）
        │  Supervisor 拼接 image + ":" + version
        ▼
真实拉取引用 ghcr.io/zee1988/homeweave-ha-app:0.1.0   ← 必须是 amd64+aarch64 的 manifest list
```

推论（硬约束）：tag 必须**恰好** `0.1.0` —— 不是 `v0.1.0`、不是 `0.1`、不是 `latest`。`docker/metadata-action` 的 `type=semver` 会同时产出 `v0.1.0`/`0.1`/`0.1.0` 一整套，**必须改用 `type=raw,value=<version>`**。

## 二、环境实测事实

| 项 | 实测 | 后果 |
|---|---|---|
| **Docker（本机）** | `docker --version` / `docker buildx version` / `docker info` 全部 `CommandNotFoundException` | **IMG-01 无法在本机演示**，必须标 CI-only/本地未验证；任何"容器已运行"的表述都是造假 |
| Node | 本机 v22.17.0；22 线最新 22.23.4，活跃支持 2025-10-21 结束，维护期至 2027-04-30；Active LTS 已是 24 | 按 `engines.node: ">=22"` 继续用 22 线，本阶段不顺带升级 |
| pnpm | 9.15.4（corepack）；根 `package.json` **无 `packageManager` 字段** | `pnpm/action-setup` 会报 `No pnpm version is specified` → 必须 `with: { version: 9.15.4 }`；不要为此改 `package.json` |
| **Prisma 版本** | `npm view` 实跑：`prisma@latest` = **8.0.0-rc.27（RC）**，`prev` = **7.10.1**；`@prisma/client@latest` = **7.10.1** | 两包**必须钉同版 7.10.1**。误装 latest 会同时踩两坑：`engines.node` 为 `^22.18.0 \|\| ^24.11.0 \|\| >=26`（本机 22.17.0 不满足），且 **Prisma 8 已移除 `migrate deploy`** |
| 仓库骨架 | `apps/` 与 `.github/` 均不存在；无 pnpm-workspace.yaml / tsconfig / Dockerfile / .dockerignore | 本阶段从零创建全部 |
| 现有工具链 | Phase 1 零依赖 `scripts/*.mjs`，唯一第三方依赖 `js-yaml@^4.1.0` | 新脚本沿用零依赖约定 |

## 三、构建侧结论

### 3.1 多阶段 Dockerfile（最终阶段只取 4 个路径）

泄漏机理：`NODE_ENV` 未设时 pnpm 装全量 → `typescript`/`@nestjs/cli`/`jest`/`eslint` 全进镜像；`COPY . .` 带上 `src/`、`**/*.spec.ts`、`.git/`、`.planning/`；若 `tsc` 开 `sourceMap`，`dist/*.js.map` 内含 `sourcesContent`，**源码换一种形式原样泄漏**。

```dockerfile
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @homeweave/api exec prisma generate
RUN pnpm --filter @homeweave/api build

FROM base AS prod-deps
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter @homeweave/api...
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
RUN pnpm --filter @homeweave/api exec prisma generate
RUN pnpm --filter @homeweave/api deploy --prod /prod

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build     --chown=node:node /app/apps/api/dist  ./dist
COPY --from=prod-deps --chown=node:node /prod/node_modules  ./node_modules
COPY --from=build     --chown=node:node /app/apps/api/prisma ./prisma
COPY --from=prod-deps --chown=node:node /prod/package.json  ./package.json
USER node
CMD ["node", "dist/main.js"]
```

- `prisma generate` **必须在 `prod-deps` 再跑一次**：生成物落 `node_modules/.prisma/client`，而最终镜像的 `node_modules` 取自 `prod-deps`；只在 `build` 生成则引擎不随行。
- `pnpm deploy --prod /prod` 在 9.15.4 的 `--legacy` 语义**待构建日志确认**；退化方案 `COPY --from=prod-deps /app/node_modules ./node_modules`（提升后的根 `node_modules`，同为 prod-only）。
- `pnpm fetch` 只按锁文件预热 store、不解析 workspace；若要拆出 fetch 层命中缓存，`pnpm install` 才可加 `--offline`。上面未拆，故不带该 flag。

### 3.2 四个「缺失」的可否证证明（逐条跑，`ok` 不是唯一输出即失败）

```bash
docker run --rm $IMG sh -c 'for d in typescript @nestjs/cli jest eslint ts-node; do [ -e node_modules/$d ] && echo LEAK:$d; done; echo ok'   # devDependencies
docker run --rm $IMG sh -c 'find /app -path /app/node_modules -prune -o -name "*.ts" -print; echo ok'    # src/ 与 *.spec.ts
docker run --rm $IMG sh -c 'find /app -path /app/node_modules -prune -o -name "*.map" -print; echo ok'   # source map
docker run --rm $IMG sh -c 'test -f dist/main.js && test -d node_modules/.prisma/client && ls prisma/migrations && echo ok'  # 产物/Client/迁移在位
```

### 3.3 Prisma × 双架构

`binaryTargets` 精确值（Debian 12 bookworm / OpenSSL 3.0.x）：x86_64 → **`debian-openssl-3.0.x`**；arm64 非 Alpine → **`linux-arm64-openssl-3.0.x`**（**不存在** `debian-arm64-*`）。

```prisma
generator client {
  provider      = "prisma-client-js"          // 显式锁定：Prisma 7 默认生成器已变为 prisma-client
  binaryTargets = ["native", "debian-openssl-3.0.x", "linux-arm64-openssl-3.0.x"]
}
```

- **不需按架构各跑一次 generate**：列出双目标后一次 generate 下载两份引擎 [ASSUMED — CI 用 `ls node_modules/.prisma/client` 确认两份 `.so.node` 均在]。这也是它能与 buildx 交叉构建共存的原因：generate 跑在宿主架构的 build 容器里，产出覆盖双架构。
- **失败模式**：漏写 `binaryTargets` 或只写 `native` 却在 amd64 宿主构建 arm64 → **构建成功、容器首次查询才崩**，抛 `PrismaClientInitializationError`。运行时炸弹而非构建期错误，故 IMG-02 必须含引擎存在性检查。
- 架构匹配证明（slim 无 binutils，靠引擎文件名 + `process.arch` 成对断言）：

```bash
docker run --rm --platform linux/arm64 $IMG sh -c \
  'test -f node_modules/.prisma/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node && node -p process.arch && echo ARCH-MATCH'
```

### 3.4 基础镜像 / 非 root / HEALTHCHECK / `/data`

- `node:22-bookworm-slim` 的 **amd64+arm64 双架构发布 = UNVERIFIED**（Docker Hub API 三次 10s 超时）。CI 首步固定：`docker buildx imagetools inspect node:22-bookworm-slim | grep -E 'linux/(amd64|arm64)'`；缺 arm64 则换 base tag。
- `openssl`：引擎名与镜像内 OpenSSL 版本强绑定（bookworm = 3.0.x）。runtime 显式装 `openssl ca-certificates`（成本极小，消除 slim 是否自带的 [ASSUMED]）。
- **非 root（现在做）**：`USER node` + 全部 `COPY --chown=node:node`。
- **HEALTHCHECK（现在不做，理由必须写进 plan）**：应用当前**没有任何 HTTP 端点**，`/health` 是 Phase 3 的事。现在写 `HEALTHCHECK CMD wget -qO- http://localhost:3000/health` 会让镜像**永久 unhealthy**，是负价值而非占位。「可启动」用启动日志证明。
- **`/data`（只备位）**：`mkdir -p /data && chown node:node /data`，**不写 `VOLUME /data`**（会产生匿名卷、干扰 HA addon 显式挂载）。`DATABASE_URL` 与 HA `map` 留 Phase 4。

### 3.5 `.dockerignore`

```
node_modules
dist
.git
.planning
homeweave_app
*.map
**/*.spec.ts
**/*.test.*
.env
.env.*
*.pem
*.key
secrets
```

**真正防泄漏**：`.env` / `.env.*`、`*.pem` / `*.key` / `secrets`、`.git`（历史中被删的密钥）。其余是体积与缓存卫生：`node_modules`（跨平台 `.bin`/原生模块污染）、`dist`（陈旧产物）、`.planning` 与 `homeweave_app`（内部资料不进产物）、`*.map` 双保险。**`apps/api/prisma/migrations/` 不得被忽略**。

## 四、CI / 发布侧结论

### 4.1 已验证的 Action 版本（`git ls-remote --tags --refs --sort=-v:refname` 实查上游）

| Action | 推荐写法 | 上游最新 tag |
|---|---|---|
| `actions/checkout` | `@v7` | `v7.0.1` |
| `actions/setup-node` | `@v7` | `v7.1.0` |
| `pnpm/action-setup` | `@v6` | `v6.1.0` |
| `docker/setup-qemu-action` | `@v4` | `v4.4.0` |
| `docker/setup-buildx-action` | `@v4` | `v4.4.1` |
| `docker/login-action` | `@v4` | `v4.7.0` |
| `docker/metadata-action` | `@v6` | `v6.2.0` |
| `docker/build-push-action` | `@v7` | `v7.4.0` |
| `gitleaks/gitleaks-action` | `@v3` | `v3.0.0` |

禁用 `@main`。要更强供应链保证可钉上表 commit SHA。

### 4.2 发布顺序强制（本阶段的核心难题）

| 机制 | 失效方式 |
|---|---|
| (a) 版本只来自 `workflow_dispatch`/`RELEASE_VERSION`，改 `config.yaml` 只是记账 | input 与 `config.yaml` 漂移 → CI 全绿，运行期 `manifest unknown`。**无输出，正是问题** |
| (b) 读 `config.yaml` 且要求 git tag == 该值 | 等值只证明两字符串相同，不证明镜像存在；且顺序天然反转（为比对必须先打 tag → tag 先于镜像，恰违反需求） |
| (c) 先推镜像再同 run 校验 | 只拦重复发布，不拦顺序；无法区分"本次构建"与"上次遗留的同版本镜像" |

**推荐 = (b) 定版本来源 + 结构性 job 依赖 + (c) 作附加断言。** 顺序不靠文档靠依赖图：

```
guard (读 config.yaml → version/ref，校验无 v 前缀、confirm_version 一致)
  → static (元数据校验 → lint → typecheck → unit；任一非零则下游不启动)
  → publish (首个 step：tag 必须空闲的 fail-closed 断言；然后 buildx 双架构 push)
  → verify (断言 manifest list 恰好 {amd64, arm64})
  → tag    (needs: [guard, verify]，只有镜像已在 GHCR 才允许打 git tag)
```

`tag` job 存在的前提是 `verify` 绿，而 `verify` 绿的前提是镜像真实存在于 GHCR —— 这就是「先镜像、后版本号」的可观测检查点。审计口径：任意 `vX.Y.Z` tag 的 commit 时间必须晚于对应 GHCR manifest 的 `created_at`。

### 4.3 「tag 是否已存在」必须 fail-closed

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

**这是最容易写错的地方**：`docker manifest inspect` 对「不存在」和「未授权」**都返回 exit 1**。只判退出码会把 403 当成"tag 空闲"，从而允许覆盖。另：`gh api /user/packages/container/<pkg>/versions` 对缺失 tag 返回 **200**（需自己遍历 tags），单用它判"不存在"比 auth 误读更危险 —— 只作交叉校验与 `created_at` 审计。

### 4.4 多架构策略

| 方案 | wall clock | `type=gha` 缓存 | 复杂度 |
|---|---|---|---|
| 单 job + QEMU，`platforms: linux/amd64,linux/arm64` | arm64 全程模拟，慢 3–8× | 每 arch 独立 scope，单 job 一次导入导出，命中率最高 | 最低 |
| 并行原生 per-arch + `imagetools create` 合并 | 两 arch 并行，墙钟接近慢者，多两个 job 的检出/排队开销 | 必须显式 `scope=amd64`/`scope=arm64`，否则相互污染 | 高（push-by-digest + artifact 传 digest + merge job） |

**推荐单 job + QEMU**：镜像产物小（非编译重负载），单 job 让 gha 缓存语义最简。

**必须 `provenance: false` + `sbom: false`**：`build-push-action` v6+ 默认 `provenance: mode=min`，会往 index 追加 `unknown/unknown` 平台的 attestation manifest → `manifests.length` 变成 3，"恰好 2 个平台"断言误报；`imagetools create` 合并时 attestation 也易嵌套。签名/attestation 留给后续里程碑。

### 4.5 公共可拉取证明（SC2）

用 `GITHUB_TOKEN` 推到 GHCR 的 package，即使源仓库公开，**初始可见性仍是 private**。需一次性改公开：Web UI，或
`gh api --method PATCH /user/packages/container/homeweave-ha-app -f visibility=public`。

CI 证明匿名可拉**必须先清凭据**，否则只证明"带 token 能拉"：

```bash
docker logout ghcr.io || true
printf '{}' > "$HOME/.docker/config.json"     # 关键：清掉残留 auths
docker pull ghcr.io/zee1988/homeweave-ha-app:0.1.0   # 必须成功；私有时 stderr 为 unauthorized
```

未签名镜像不阻塞 Supervisor 拉取 = [ASSUMED]（Supervisor 走普通 registry pull，不校验 cosign/notation）。

### 4.6 门禁顺序与 fork 安全（SC3 / SEC-03）

- 顶层 `permissions: { contents: read }`；仅 `publish` 提权 `packages: write`，仅 `tag` 提权 `contents: write`，`verify` 只 `packages: read`。`publish` 加 `if: github.event_name != 'pull_request'`。
- **一律不用 `pull_request_target`**：那等于用可写 token 执行陌生人代码。fork PR 的 `GITHUB_TOKEN` 天然只读，`packages: write` 会被降级 → push 403（安全但会红，可接受）。
- 密钥门禁两条：Dockerfile 内用 `RUN --mount=type=secret` 而非 `ARG`/`ENV`/`COPY`（泄漏无法事后修补）；`docker history --no-trunc <ref> | grep -Ei 'ghp_|github_pat_|password=|BEGIN [A-Z ]*PRIVATE KEY'` 命中即失败。`gitleaks/gitleaks-action@v3` 需 `fetch-depth: 0`（否则扫不到历史），发现泄漏 exit 1。
- [ASSUMED] `gitleaks-action@v3` 对个人仓库免 license；若需 license 则回退 CLI（镜像 tag UNVERIFIED）。

### 4.7 VER-01 的可复现入口（本阶段创建）

| 期望命令 | 状态 | 实现 |
|---|---|---|
| `corepack pnpm lint` | **待创建** | `node scripts/lint-workspace.mjs`：对 `.mjs` 跑 `node --check` + JSON/YAML 解析校验，零依赖 |
| `corepack pnpm typecheck` | **待创建** | 当前无 TS 源 → 输出 `no TypeScript workspace yet` 并 exit 0；`apps/api` 落地后改 `pnpm -r typecheck` |
| `corepack pnpm test` | **待创建** | 聚合到 `pnpm -r test`（保留 `test:app`） |

README 必须写明「`typecheck` 目前是显式跳过而非真实类型检查」，避免被误读为已通过。

## 五、两份研究的冲突与修正（规划时必须采用修正后的口径）

| # | 冲突 | 修正 |
|---|---|---|
| C-1 | CI 侧写 `context: ./homeweave_app` | **错**：Dockerfile 在仓库根，pnpm workspace 跨根 + `apps/api`，`COPY pnpm-lock.yaml` 在 `./homeweave_app` 下根本取不到文件。**构建上下文必须是仓库根 `.`** |
| C-2 | `guard` job 用 `require('js-yaml')` 读版本，但该 job 未安装依赖 | 要么 guard 也 `pnpm install --frozen-lockfile`，要么改用零依赖严格正则读 `config.yaml` 的带引号 version 行。**plan 必须选定其一**，否则 guard 必崩 |
| C-3 | BUILD 侧说「镜像不含 prisma CLI」，但 `migrate deploy` 通常需要 CLI | 定调：**镜像不含 CLI**（CLI 属 devDependencies，装进去直接违反 IMG-02），迁移由 CI 或后续阶段执行；`prisma/migrations/` 仍随镜像分发。此项必须在 PLAN 里写出取舍 |

## 六、Validation Architecture（Nyquist）

| 需求 | 自动化检查 | 失败信号 | 可验证边界 |
|---|---|---|---|
| IMG-01 | `docker buildx build --platform linux/amd64 --load` → `docker run -d` → 日志含 `Nest application successfully started` 且 `docker inspect -f '{{.State.Running}}'` 为 `true` | buildx 非零；日志缺该行；`.State.Running` ≠ true | **本机无 Docker → CI-only**，本地未验证 |
| IMG-02 | 3.2 的四条 `docker run ... echo ok` 串联，任一输出非 `ok` 即 `exit 1` | 出现 `LEAK:` 或文件路径；缺 `ok` | CI-only |
| IMG-03 | 静态门禁 `check:app` + `validate:app` + `lint` + `typecheck` + `test:app` 全绿后才进 publish；`static` job 任一非零则 `publish` 不启动 | 任一 job 非零；故意注错提交若仍发布则门禁无效 | 门禁逻辑可本地模拟；**真实阻断需 GHCR/CI** |
| IMG-04 | `docker manifest inspect <ref>` → 解析 `manifests[].platform`，断言集合 == `{amd64, arm64}` 且 tag == `config.yaml` 的 version | `::error::need exactly amd64+arm64`；`no such manifest` = 未发布；version 不等 = 断言失败 | **存在性与匿名拉取部分需真实 GHCR**；本地可验断言脚本分支逻辑（喂假 stderr） |
| IMG-05 | `tag must be free` fail-closed 分支 + 门禁顺序；三机制对照见 4.2 | 覆盖已存在 tag；403 被误判为"空闲"；`tag` job 在 `verify` 前启动 | 分支逻辑可本地单测；真实 GHCR 行为需 CI |
| SEC-03 | `docker history --no-trunc` grep 无命中 + gitleaks exit 0 + `.dockerignore` 含 `.env*`/`*.pem`/`*.key`/`secrets` | 任一命中即失败 | 可本地验 grep 与 dockerignore；镜像层需 CI |
| VER-01 | `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test` 在干净 clone 上 exit 0 | `ERR_PNPM_NO_SCRIPT`（脚本缺失）；`node --check` 语法错误 | **可本地全验**，本阶段唯一能在本机闭环的需求 |

## 七、规划前必须一锤定音的决策

- **D-1 迁移执行位置**：镜像不含 `prisma` CLI；`migrate deploy` 由 CI/Phase 4 执行，镜像只带 `prisma/migrations/`。（见 C-3）
- **D-2 Prisma 版本**：`prisma` 与 `@prisma/client` 钉同版 **7.10.1**；`schema.prisma` 显式 `provider = "prisma-client-js"`。
- **D-3 `guard` 取版本方式**：零依赖正则 vs 装依赖。（见 C-2）
- **D-4 发布顺序**：(b) 定版本来源 + 结构性 job 依赖 + (c) 附加断言。
- **D-5 多架构**：单 job + QEMU，`provenance: false`、`sbom: false`，`tags: type=raw`。
- **D-6 构建上下文**：仓库根 `.`。（见 C-1）
- **D-7 HEALTHCHECK**：本阶段不加，Phase 3 补端点后再加。
- **D-8 诚实边界**：本机无 Docker → IMG-01/IMG-02 及所有容器内断言标 CI-only；aarch64 运行结果在 amd64 主机不可得时标未验证。

## 八、未验证项（UNVERIFIED / ASSUMED）

| # | 内容 | 风险 |
|---|---|---|
| A1 | `node:22-bookworm-slim` 是否发布 linux/arm64（Docker Hub API 三次超时） | 缺 arm64 则 IMG-03 需换 base tag；CI 首步证明 |
| A2 | 一次 `prisma generate` 生成双架构引擎 | 若否，需按架构各 generate 一次，交叉构建方案要改 |
| A3 | `pnpm deploy --prod` 在 9.15.4 的产物 | 失败则用根 `node_modules` 退化方案 |
| A4 | `gitleaks-action@v3` 对个人仓库免 license | 需 license 则 CI 红，改 CLI |
| A5 | Supervisor 不校验镜像签名 | 若校验需补签名步骤（本阶段不做） |
| A6 | `docker manifest inspect` 的具体 stderr 文案 | 文案变更会让 fail-closed 分支**安全地**报错（宁可红，不可覆盖） |
| A7 | `skopeo` 是否预装于 `ubuntu-latest` | 不影响推荐方案 |

## Sources

- **HIGH**：`git ls-remote` 实查 9 个上游 action 仓库；`npm view prisma` / `@prisma/client`；`endoflife.date` Node 22 生命周期；本机 `docker --version` 三条字面失败输出；仓库内 `config.yaml` / `package.json` 实证。
- **MEDIUM**：Prisma 官方文档（binaryTargets 表、Prisma 8 移除 `migrate deploy`）；GHCR 默认 private 与 `GITHUB_TOKEN` 推包行为。
- **LOW/UNVERIFIED**：见第八节 A1–A7。
