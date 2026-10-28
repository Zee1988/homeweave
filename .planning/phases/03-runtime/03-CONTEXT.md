# Phase 3: 运行时骨架 - Context

**Gathered:** 2026-10-28
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段交付的是**容器启动后得到一个能自证健康、能安全停止、配置出错时立刻拒绝启动的后端进程**：

- 结构化日志（JSON 行）+ 敏感字段脱敏 + 级别来源（RT-04）
- `/health/live` 与 `/health/ready`（RT-01 / RT-02）
- SIGTERM 优雅关闭（RT-03）
- `PrismaService` 注入 + SQLite driver adapter + 启动期 fail-fast（RT-05）
- `config.yaml` 的 `watchdog` 落地（兑现 Phase 1 的 D-08）
- `scripts/ci/assert-image.sh` 的启动判据改造（由日志 grep 变为 HTTP 探针）

**不包含**：迁移执行与迁移策略（Phase 4）、应用层认证与鉴权（Phase 5）、HA API 连接与自检（Phase 6）、Ingress Web UI（Phase 5）、完整安装/升级/排障文档（Phase 7）。

</domain>

<decisions>
## Implementation Decisions

### 日志载体与 CI 断言（区域 1）

- **D-01: 日志载体 = `pino` + 自写 Nest `LoggerService` 适配。**
  新增 1 个运行时依赖（`pino`，精确锁版本，与仓库现有的精确锁定风格一致）。适配层用 `NestFactory.create(AppModule, { bufferLogs: true })` 捕获 bootstrap 早期日志，再 `app.useLogger(adapter)` 接管。理由：`redact` 是经过审计的实现（路径式规则、循环引用、Error 序列化），自写递归脱敏在 RT-04 这个部位承担不起漏检风险。
  — **Reversibility:** cheap — 适配层是唯一耦合点，换实现不影响业务代码
- **D-02: `assert-image.sh` 的「容器已启动」判据改为 HTTP 探针。**
  第 6 条保留 `State.Running == true`（进程没立刻死），**新增第 9 条**：`node -e fetch('http://127.0.0.1:8099/health/live')` 非 2xx 即失败。镜像内**没有 curl 也没有 wget**，只能用 `node -e`。断言总数 8 → 9，脚本内所有 `x/8` 标签、头部注释清单需同步改。
  探针必须带**重试等待**（原 grep 依赖「日志出现」隐式等待，改为探针后必须显式写，否则监听尚未就绪会假失败）。
  — **Reversibility:** cheap
- **D-03: 脱敏双层策略。**
  ① 键名黑名单（大小写不敏感，递归）：`authorization` / `token` / `api_key` / `apiKey` / `password` / `secret` / `cookie` → `[REDACTED]`；② 值模式替换：`Bearer <x>`、`Token <x>` 形态；③ 循环引用保护。
  理由：单靠键名会漏掉 `message: "supervisortoken=eyJ..."` 这类最常见泄漏形态（Phase 6 接 HA 时必然出现）。
- **D-04: 级别来源解析顺序。**
  `LOG_LEVEL` 环境变量 → `/data/options.json` 的 `log_level` → 默认 `info`。非法值降级为 `info` 并留一条 warn。env 优先是为了让 Compose / 本地开发走同一条路径。

### ready 的就绪边界（区域 2）

- **D-05: DB 访问 = `@prisma/adapter-better-sqlite3` + `better-sqlite3`。**
  新增 2 个依赖。**依据（已实测，非推断）**：Prisma 7.10.1 生成物 `apps/api/src/generated/prisma/prismaNamespace.ts:718` 明确写 `A driver adapter ... is **required**`；`pnpm-lock.yaml` 中 `@prisma/adapter-*` 零命中；`prisma@7.10.1` 将 `better-sqlite3` 列为 optional peerDependency。
  — **Reversibility:** costly — 见 D-05a 与 D-05b，它改变了镜像的二进制构成
- **D-05a: `RUST_FREE` 的语义收窄，必须同步修订探针与文档。**（跨阶段影响，最重要的一条）
  `apps/api/prisma/ENGINE_DECISION` 仍为 `RUST_FREE`，但它今后只表示「**Prisma 查询引擎**无原生二进制」，不再等于「镜像无任何平台相关二进制」。`scripts/probe-prisma-engine.mjs` 只扫描 `src/generated/prisma`，**扫不到 `node_modules/**/*.node`**，因此引入 `better-sqlite3` 后该探针会**绿着就错**。
  连带义务（本阶段必须一并交付，否则 Phase 2 建立的证据链失效）：
  1. 探针扩展为同时扫描运行时 `node_modules` 下的 `*.node`，并对照一份**预期原生模块清单**（当前仅 `better-sqlite3`）；清单外出现即失败。
  2. `ENGINE_DECISION` 的注释、`Dockerfile:45-49` 的注释、`docs/21` 的相关段落同步改写，说明「RUST_FREE 指引擎，不含 native addon」。
  3. 不得在任何文档里继续声称镜像「无平台相关二进制」。
- **D-05b: arm64 验证从「建议」升为「必须」。**
  `better-sqlite3` 依赖 prebuild-install 下载目标架构二进制。buildx 分平台构建时 `pnpm install` 在各自平台容器内执行，理论上正确；但若某架构缺 prebuild 会回退源码编译，而 `node:22-bookworm-slim` **没有 python3/make/g++**，构建会直接失败。计划阶段必须显式处理：build stage 装编译工具链（仅 build 阶段，不进 runtime）作为回退，并在 CI 记录两架构的实际结果。
- **D-06: 迁移状态只作诊断字段，不参与状态码。**
  事实：`prisma/migrations/20261028000037_init` 存在但从未执行，`_prisma_migrations` 表不存在。若按 RT-02 字面实现（未迁移 = 非 2xx），Phase 3 的容器会一直 503 直到 Phase 4，HAOS 上 App 全程显示不健康。
  故：`/health/ready` 的 200/503 只由 `database` 与 `disk` 决定；`migrations` 以 `status: "pending"` 如实报告，Phase 4 再让它参与判定。
  **RT-02 第 2 条在本阶段为部分交付**，验收时必须如实标注，不得声称已完整覆盖。
- **D-07: 可写性验证只在启动期做一次。**
  用真实临时文件写测试（属于 RT-05 的 fail-fast），ready 之后只执行只读查询。理由：Supervisor watchdog 周期性访问 ready，每次写盘在 SD 卡 / eMMC 的 HAOS 设备上是持续磨损。
- **D-08: ready 响应结构 = `checks` 集合。**

  ```
  {
    "status": "up" | "down",
    "checks": {
      "database":   { "status": "...", "latencyMs": 3, "detail": "..." },
      "migrations": { "status": "pending", "detail": "..." },
      "disk":       { "status": "...", "detail": "..." }
    },
    "uptimeMs": 12345,
    "version": "0.1.0"
  }
  ```

  整体 `status` = 任一**参与判定**的 check 为 `down` 则 `down`。单项状态枚举：`up` / `down` / `pending` / `unknown`（`not_configured` 留给 Phase 6 的 HA 项）。Phase 6 只需新增 `homeAssistant` 一项，不动契约。

### DB 注入与 fail-fast（区域 3）

- **D-09: `DATABASE_URL` 双来源。**
  `Dockerfile` 增加 `ENV DATABASE_URL=file:/data/homeweave.db`（容器开箱即用）；代码层在 env 缺失时兜底 `file:./data/app.db`（与 `docs/14_ENV_AND_DEPLOYMENT.md:20` 一致，本地开发零配置）。Compose 用户用 `environment:` 覆盖。**启动日志必须打出解析后的最终值**（路径不是密钥，可打印）。
  注意 `prisma.config.ts` 的兜底是给 CLI 用的，运行时路径必须由代码显式解析后传给 adapter，两处不得各自演化出不同默认值。
- **D-10: 启动期检查清单（按序执行，任一失败即退出）。**
  ① 父目录存在；② 真实临时文件写测试；③ 磁盘余量 ≥ 阈值（`fs.statfs`，默认 50 MB）；④ 执行一条真实查询确认 DB 能打开。
  **不做** SQLite 文件头 magic 校验：文件损坏时第 ④ 步会以更明确的错误暴露，文件头检查是冗余。
- **D-11: ready 增加 `disk` check。**
  用 `fs.statfs` 读可用字节，低于阈值报 `down`。纯只读系统调用，不写盘。目的：补上「ready 只读 → 磁盘写满时仍绿」的缺口（HAOS 备份与日志堆积是真实成因）。阈值与 D-10 共用同一常量，可用环境变量覆盖。
- **D-12: fail-fast 退出码区分。**
  结构化 error 日志（含检查名、路径、errno）+ 退出码：配置类错误 `78`（sysexits `EX_CONFIG`），其他 `1`。

### watchdog（Phase 1 D-08 的兑现，Claude 自行决定）

- **D-13: 只在 `config.yaml` 加 `watchdog`，不加 `Dockerfile HEALTHCHECK`。**
  取值 `watchdog: http://[HOST]:[PORT:8099]/health/live`（官方模板占位符由 Supervisor 替换）。
  理由：HAOS 下容器生命周期由 Supervisor 管理，`docker health status` 不参与 Supervisor 决策，加 HEALTHCHECK 只是让 `docker inspect` 好看，且与 watchdog 形成两套语义、失败时互相掩盖。`Dockerfile:13-15` 那段「Phase 3 之前没有 HTTP 端点」的注释前提已消失，本阶段必须改写为「由 Supervisor watchdog 负责」。
  因 D-02（Phase 1）的单一来源约束，**`watchdog` 必须加在 `homeweave_app/app-metadata.json` 并重新生成 `config.yaml`**，不得直接手改生成的 YAML。

### Claude's Discretion

- `pino` 的具体版本（安装时取最新 9.x 并锁定精确版本，不用 `^`）
- 请求日志的记录粒度：只记 `method` / `path` / `status` / `durationMs`，**不记 body**、不记 query 原文（query 可能带敏感值，走 D-03 脱敏）
- ready 的超时预算：单 check 上限 200 ms，整体上限 1 s，超时即该 check `down`
- 临时文件写测试的文件名与清理方式
- 日志中 `version` 字段的来源（`package.json` vs 构建期注入）

### Folded Todos

无 —— `todo.match-phase 3` 返回 `todo_count: 0`。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 需求与阶段契约
- `.planning/REQUIREMENTS.md` — RT-01…RT-05 原文；注意 RT-02 第 2 条在本阶段为部分交付（D-06）
- `.planning/ROADMAP.md` — Phase 3 成功标准与「不提前做 Phase 4」的边界
- `.planning/phases/01-app/01-CONTEXT.md` — D-02（元数据单一来源）、D-08（watchdog 推迟到本阶段）
- `.planning/PROJECT.md` — Constraints（凭据边界、`/data` 持久化）与 Key Decisions

### 代码现状
- `apps/api/src/main.ts` — 13 行；`PORT ?? 8099` 已有，`NestFactory.create` 未传 logger
- `apps/api/src/app.module.ts` — 目前是空模块
- `apps/api/prisma/schema.prisma` — 仅 `AppSetting` 一张表；头部注释记录了 Prisma 7 的三条事实
- `apps/api/prisma/ENGINE_DECISION` — 当前内容为 `RUST_FREE`，语义须按 D-05a 收窄
- `apps/api/prisma.config.ts` — CLI 侧的 URL 解析（`DATABASE_URL ?? 'file:./data/app.db'`）
- `scripts/probe-prisma-engine.mjs` — 只扫生成目录，须按 D-05a 扩展
- `scripts/ci/assert-image.sh` — 8 条断言，`x/8` 标签硬编码；第 6 条在第 193 行起
- `Dockerfile` — 第 13-15 行 HEALTHCHECK 注释、第 45-49 行 RUST_FREE 注释、第 91 行 `ENV NODE_ENV`、第 112 行 `USER node`、第 116 行 `CMD`
- `homeweave_app/app-metadata.json` — 元数据单一来源，`watchdog` 从这里加
- `homeweave_app/config.yaml` — **生成物**，不要手改

### 部署与安全边界
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` — `/data` 挂载、`ingress_port: 8099`、arm64 未实机验证的既有说明
- `docs/14_ENV_AND_DEPLOYMENT.md` — 三种部署形态的 `DATABASE_URL` 取值
- `docs/08_SECURITY_AND_PRIVACY.md` — 密钥不落库、不入日志、不进前端产物

### 官方规范（实施时须现场核对，不得凭记忆写）
- https://contributors.home-assistant.io/apps/reference/configuration/ — `watchdog` 字段与 `[HOST]`/`[PORT:8099]` 占位符语法
- Prisma 7 driver adapter 文档 — `@prisma/adapter-better-sqlite3` 的构造与传入方式
- `better-sqlite3` 的 prebuild 支持矩阵 — 用于确认 linux/amd64 与 linux/arm64 是否都有 prebuild（D-05b）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `main.ts` 的 `PORT ?? 8099` 与 `listen(port, '0.0.0.0')` 已正确，不改
- `prisma.config.ts` 的 URL 解析注释可作为运行时解析的写法参照（但两者语义不同，见 D-09）
- `assert-image.sh` 已有的 `pass` / `fail` 计数框架可直接承接第 9 条断言

### Established Patterns
- 依赖精确锁定（`@prisma/client` / `prisma` 均为 `7.10.1`，无 `^`）——`pino`、`better-sqlite3`、adapter 须沿用
- 镜像「只 COPY 四条路径」的纪律：新增依赖走 `dependencies`，若 `better-sqlite3` 的 prebuild 落在非标准位置，必须验证它能随 `pnpm deploy` 一起进入 runtime 的 `node_modules`
- 注释解释「为什么」而非「是什么」，且必须写明未验证的部分（`Dockerfile` 现有的 `VERIFIED LOCALLY` / `NOT VERIFIED` 写法）

### Integration Points
- Phase 4 接管 D-06 的迁移判定与 D-05a 的构建回退细节
- Phase 5 的认证层需要 `/health/live` 与 `/health/ready` 免鉴权，本阶段的路由声明方式要让豁免容易表达
- Phase 6 在 `checks` 里新增 `homeAssistant`，并复用 D-03 的值模式脱敏
- Phase 2 的 `docs/21` 段落因 D-05a 需要回写

</code_context>

<specifics>
## Specific Ideas

- 用户明确要求**不提前做 Phase 4**：迁移执行、迁移失败不清库、升级路径都不在本阶段，即使这让 RT-02 只能部分交付也接受，但必须在验收里写明
- 用户明确要求对「断言绿着就错」保持警惕：D-05a 探针扩展是本阶段的硬性交付物，不是可选项
- 验证结论必须区分静态检查 / 容器模拟 / HAOS 实机：本阶段最多做到容器模拟，arm64 仍是 QEMU 冒烟，不得写成「已在 arm64 验证」

</specifics>

<deferred>
## Deferred Ideas

- **迁移执行与 `_prisma_migrations` 判定** → Phase 4（本阶段仅 `pending` 诊断字段）
- **`ha_url` 的读取与校验**：`config.yaml` 已有该 option，但读取它属于 Phase 6，本阶段不碰
- **`/health/ready` 的限流、外部轮询保护**：未讨论；当前假设仅 Supervisor watchdog 与 CI 访问
- **原生模块清单的长期治理**（谁批准新增 `.node`）：本阶段只建立清单机制与当前唯一条目，流程规则留待文档阶段
- **Dockerfile HEALTHCHECK**：按 D-13 决定不加；若将来出现非 HAOS 的容器运行方（如纯 Docker Compose 生产部署），需重新评估

</deferred>

---

*Phase: 03-Runtime 运行时骨架*
*Context gathered: 2026-10-28*
