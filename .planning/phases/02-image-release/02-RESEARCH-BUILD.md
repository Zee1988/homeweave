# Phase 02 研究（容器构建侧）— 02-RESEARCH-BUILD

**日期**: 2026-05-07 ｜ **范围**: Dockerfile / 镜像内容 / Prisma 架构 / 基础镜像 / 非 root / .dockerignore（CI 推送侧见 `02-RESEARCH-CI.md`）｜ **置信度**: MEDIUM（本机无 Docker，容器内结论须 CI 回填）

## 环境实测结论

**本机没有 Docker。** 字面输出（PowerShell，三条命令同一错误）：`docker --version` / `docker buildx version` / `docker info` → `docker : The term 'docker' is not recognized as the name of a cmdlet, function, script file, or operable program. (CommandNotFoundException)` [VERIFIED: 本机实跑]。后果：**IMG-01"仓库内单一命令构建出可启动镜像"在本机无法演示** → 必须标记 **CI-only / 本地未验证**。禁止在任何计划或 SUMMARY 中声称"容器已运行"。

**Node 实测**：22 线最新 **22.23.4**，2024-10-29 入 LTS，活跃支持 2025-10-21 已结束，现维护期，EOL 2027-04-30；当前 Active LTS 是 **Node 24** [CITED: endoflife.date/api/nodejs.json]。仓库 `engines.node: ">=22"` 与本机 `22.17.0` 合法，base 继续用 22 线，本 phase 不顺带升级 Node。

**Prisma 实测**（`npm view` 实跑）：`prisma` 的 `latest` = **8.0.0-rc.27**（RC！），`prev` = **7.10.1**；`@prisma/client` 的 `latest` = **7.10.1** [VERIFIED: npm registry]。**两包必须钉同版 7.10.1**：误装 `prisma@latest` 会踩两坑——其 `engines.node` 为 `^22.18.0 || ^24.11.0 || >=26.0.0`（本机 22.17.0 不满足），且 **Prisma 8 已移除 `migrate deploy`**："It replaces Prisma ORM 7's `prisma migrate deploy`" [CITED: prisma.io/docs/orm/prisma-migrate/workflows/development-and-production]。故 Phase 4 的 `prisma migrate deploy` **仅在 7.x 成立**，钉版本是可执行前提。

## Q1 多阶段 Dockerfile

泄漏机理：`NODE_ENV` 未设时 pnpm 装全量 → `typescript`/`@nestjs/cli`/`jest`/`eslint`/`@types/*` 全进镜像；`COPY . .` 带上 `src/`、`**/*.spec.ts`、`.git/`、`.planning/`；若 `tsc` 开 `sourceMap`，`dist/*.js.map` 内含 `sourcesContent`，**源码换一种形式原样泄漏**。故最终阶段只从构建阶段取 4 个路径。关于 `pnpm fetch`：它只按锁文件预热 store、不解析 workspace，正确用法是把 `COPY pnpm-lock.yaml pnpm-workspace.yaml ./` + `pnpm fetch` 单独成层置于 `COPY . .` 之前以命中缓存（本例为控制篇幅未拆该层，生产实现建议拆）；**若拆出 fetch 层，`pnpm install` 才能加 `--offline`——本例未拆，故下面不带该 flag**。`--prod` 只在 `prod-deps` 用，使 runtime 依赖集成为与构建依赖物理隔离的第二份。

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

- **`prisma generate` 必须在 `prod-deps` 再跑一次**：生成物默认落 `node_modules/.prisma/client`，最终镜像的 `node_modules` 取自 `prod-deps`；只在 `build` 生成则引擎不随行。
- **`prisma migrate deploy` 运行时需要**：`prisma/schema.prisma` + `prisma/migrations/` + `DATABASE_URL` + Prisma **schema engine** 可执行，迁移目录须随镜像分发 [CITED: prisma.io 迁移文档要求整目录提交] → 固定落 `/app/prisma/migrations`。
- **冲突点**：`prisma` CLI 属 devDependencies，装进 runtime 即违反 IMG-02。建议定调：**镜像不含 CLI，迁移在 CI 对数据库执行**（Phase 4 落地），并在计划中显式写出取舍。
- `pnpm deploy` 在 9.15.4 的 `--legacy` 语义属**待实测**；退化方案 `COPY --from=prod-deps /app/node_modules ./node_modules`（提升后的根 `node_modules`，同为 prod-only）。二选一，构建日志留证。

## Q2 四个"缺失"的证明（`IMG=homeweave-api:test`，逐条跑，非 `ok` 即失败）

```bash
docker run --rm $IMG sh -c 'for d in typescript @nestjs/cli jest eslint ts-node; do [ -e node_modules/$d ] && echo LEAK:$d; done; echo ok'   # devDependencies
docker run --rm $IMG sh -c 'find /app -path /app/node_modules -prune -o -name "*.ts" -print; echo ok'    # src/ 与 *.spec.ts
docker run --rm $IMG sh -c 'find /app -path /app/node_modules -prune -o -name "*.map" -print; echo ok'   # source map
docker run --rm $IMG sh -c 'test -f dist/main.js && test -d node_modules/.prisma/client && ls prisma/migrations && echo ok'   # 产物/Client/迁移在位
```

失败信号：前三条第 1 行出现 `LEAK:` 或任何文件路径（`ok` 不是唯一输出）；第四条无 `ok`。

## Q3 Prisma × amd64 / arm64

`binaryTargets` 精确值（Debian 12 bookworm / OpenSSL 3.0.x）[CITED: prisma.io/docs/orm/v7/reference/prisma-schema-reference]：x86_64 → **`debian-openssl-3.0.x`**（`debian-` 前缀即默认 x86_64）；arm64 非 Alpine → **`linux-arm64-openssl-3.0.x`**（**不存在** `debian-arm64-*`）。

`generator client { provider = "prisma-client-js"; binaryTargets = ["native", "debian-openssl-3.0.x", "linux-arm64-openssl-3.0.x"] }`（真实文件里按字段分写多行）。

**不需要按架构各跑一次 generate**：列出双目标后一次 generate 会下载两份引擎 [ASSUMED — CI 用 `ls node_modules/.prisma/client` 确认两份 `.so.node` 均在]。这也是它能与 `buildx` 交叉构建共存的原因：`generate` 跑在宿主架构的 build 容器里，产出却覆盖双架构，无需 QEMU 模拟生成。**失败模式**（漏写 `binaryTargets` 或只写 `native` 却在 amd64 宿主构建 arm64）：**构建成功、容器启动后首次查询才崩**，抛 `PrismaClientInitializationError`（query engine for current platform could not be found）——运行时炸弹而非构建期错误，故 IMG-02 必须含引擎存在性检查。

证明引擎与镜像架构匹配（不依赖 `file`/`readelf`，slim 无 binutils）：

```bash
docker run --rm $IMG sh -c 'node -p process.arch; ls node_modules/.prisma/client'
docker run --rm --platform linux/arm64 $IMG sh -c \
  'test -f node_modules/.prisma/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node && echo ARCH-MATCH'
```

引擎文件名自带 target 串，`process.arch` 与文件名必须成对（amd64 期望 `libquery_engine-debian-openssl-3.0.x.so.node`）。需 ELF 级确认才临时装 `binutils` 跑 `readelf -h <so> | grep Machine`（`AArch64` vs `Advanced Micro Devices X86-64`）；**不要**装进生产镜像。

## Q4 基础镜像

- `node:22-bookworm-slim` 的 **amd64/arm64 双架构发布：UNVERIFIED**——本机 Docker Hub API 三次请求全部 10s 超时。CI 首步固定为 `docker buildx imagetools inspect node:22-bookworm-slim | grep -E 'linux/(amd64|arm64)'`；缺 `linux/arm64` 则 IMG-03 需换 tag。
- **openssl**：引擎名与镜像内 OpenSSL 版本强绑定（bookworm = 3.0.x → `debian-openssl-3.0.x`）。runtime 装 `openssl ca-certificates`；`bookworm-slim` 是否自带 `openssl` CLI 属 [ASSUMED] 缺失，显式安装成本极小且消除不确定性。

## Q5 非 root / HEALTHCHECK / `/data`

- **非 root（现在做）**：`USER node` + 全部 `COPY --chown=node:node`。零成本，对齐 SEC-03。
- **HEALTHCHECK（现在不做，理由须写进 plan）**：应用**当前没有任何 HTTP 端点**，`/health` 是 Phase 3 的事。此刻写 `HEALTHCHECK CMD wget -qO- http://localhost:3000/health` 会让镜像**永久 unhealthy**，属负价值而非占位。诚实做法：Phase 2 不加 HEALTHCHECK，"可启动"用启动日志证明；Phase 3 补端点后再补检查。
- **`/data`（只备位）**：`mkdir -p /data && chown node:node /data`，**不写 `VOLUME /data`**（会产生匿名卷、干扰 HA addon 显式挂载）。`DATABASE_URL` 与 HA `map` 留 Phase 4。

## Q6 `.dockerignore`

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

**真正防泄漏**：`.env` / `.env.*`（`DATABASE_URL`、token）、`*.pem` / `*.key` / `secrets`、`.git`（历史中被删的密钥）。**其余是体积与缓存卫生**：`node_modules`（跨平台 `.bin`/原生模块污染）、`dist`（陈旧产物）、`.planning` 与 `homeweave_app`（内部资料不进产物）、`*.map` 双保险（即便 tsconfig 开 sourceMap 也不经 `COPY . .` 进入构建上下文）。注意 `apps/api/prisma/migrations/` **不得被忽略**。

## 候选验证命令

**IMG-01（可构建 + 可启动）**

```bash
docker buildx build --platform linux/amd64 -t homeweave-api:test --load . \
 && docker run -d --name hw-test homeweave-api:test && sleep 5 \
 && docker logs hw-test 2>&1 | grep -q 'Nest application successfully started' \
 && docker inspect -f '{{.State.Running}}' hw-test | grep -qx true
```

失败含义：`buildx` 非零 = 构建失败；日志无该行 或 `.State.Running` 非 `true` = 镜像不可启动，IMG-01 不成立。**本机不可执行（无 Docker），仅 CI，结果须回填"CI 已验证"。**

**IMG-02（内容合规）**：即 Q2 四条命令的串联，任一输出非 `ok` → exit 非零 → IMG-02 不成立；建议在 CI 里写成一段 `sh -c` 累积 `fail=1` 后 `exit $fail`，一次跑完给全量证据。

## Open Questions

1. **Prisma 7 默认生成器已从 `prisma-client-js` 变为 `prisma-client`**（ESM-first、`output` 必填），后者字段表**未列 `binaryTargets`** [CITED: 同 Q3 文档页]。Phase 2 应在 `schema.prisma` 显式写 `provider = "prisma-client-js"` 锁定行为，否则本文件的引擎方案需重验。
2. `pnpm deploy --prod /prod` 在 pnpm 9.15.4 的实际产物需构建日志确认（退化方案见 Q1）。
3. 迁移由 CI 执行 vs 镜像内含 `prisma` CLI（与 IMG-02 冲突）——plan 阶段须一锤定音。
