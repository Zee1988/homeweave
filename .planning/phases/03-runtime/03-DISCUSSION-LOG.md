# Phase 3: 运行时骨架 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-28
**Phase:** 03-runtime
**Areas discussed:** 日志载体与 CI 断言, ready 的就绪边界, DB 注入与 fail-fast

---

## 日志载体与 CI 断言

### 结构化日志载体

| Option | Description | Selected |
|--------|-------------|----------|
| pino + 自写 Nest 适配 | 新增 1 个运行时依赖；redact 是经审计的成熟实现；适配层约 80 行 | ✓ |
| Nest 内置 ConsoleLogger + json | 零新增依赖，但无任何脱敏能力，需外挂拦截层 | |
| 自写零依赖 JSON logger | 完全可控无版本风险，但递归脱敏/循环引用/Error 序列化全部自担漏检风险 | |

**User's choice:** pino + 自写 Nest 适配
**Notes:** 判断依据是 RT-04 这个部位承受不起自写脱敏的漏检风险，而非"少写代码"。

### CI 的"容器已启动"判据

| Option | Description | Selected |
|--------|-------------|----------|
| 改成 HTTP 探针为准 | `node -e fetch('http://127.0.0.1:8099/health/live')`，非 2xx 即失败；断言 8 → 9 | ✓ |
| 保留 grep 文本 | 让 JSON 的 message 仍是 Nest 原文，grep 不动 | |
| 两者都做 | 探针 + grep 附加信号 | |

**User's choice:** 改成 HTTP 探针为准
**Notes:** 镜像内无 curl / 无 wget，只能用 `node -e`。探针必须显式带重试等待——原 grep 依赖"日志出现"的隐式等待，换探针后若不补会假失败。

### RT-04 脱敏策略

| Option | Description | Selected |
|--------|-------------|----------|
| 键名黑名单 + Bearer 值模式 | 键名大小写不敏感递归 + `Bearer`/`Token` 值替换 + 循环引用保护 | ✓ |
| 仅键名黑名单 | 实现简单，覆盖约 90% | |
| 输出白名单 | 只允许预定义字段，最严格但排障能力大降 | |

**User's choice:** 键名黑名单 + Bearer 值模式
**Notes:** 单靠键名会漏掉 `message: "supervisortoken=eyJ..."`，这是 Phase 6 接 HA 后最可能的泄漏形态。

### log_level 来源

| Option | Description | Selected |
|--------|-------------|----------|
| env 优先 + options.json 兜底 | `LOG_LEVEL` → `/data/options.json` 的 `log_level` → `info` | ✓ |
| 只读环境变量 | 一条路径，最简 | |
| 只读 /data/options.json | 直接对应 App 配置面板，但 Compose 用户没有该文件 | |

**User's choice:** env 优先 + options.json 兜底
**Notes:** 非法值降级为 `info` 并留一条 warn。

---

## ready 的就绪边界

### DB 访问路径

| Option | Description | Selected |
|--------|-------------|----------|
| better-sqlite3 adapter | 官方路径最稳；代价是镜像重新出现原生 `.node` | ✓ |
| node:sqlite adapter | 零原生依赖，但 Node 22.17 需 `--experimental-sqlite`，Node 24 才默认开启 | |
| 先不接 Prisma client | 仅用 `node:sqlite` 直查，Phase 4 要重做 | |

**User's choice:** better-sqlite3 adapter
**Notes:** 触发这条讨论的事实是实测发现 `apps/api/src/generated/prisma/prismaNamespace.ts:718` 写明 driver adapter **is required**，且 `pnpm-lock.yaml` 中 `@prisma/adapter-*` 零命中、`prisma@7.10.1` 把 `better-sqlite3` 列为 optional peerDependency。用户同时接受了连带义务：RUST_FREE 探针必须扩展到 `node_modules/**/*.node`，arm64 真实运行从"建议"升为"必须"。

### 迁移到位的处理

| Option | Description | Selected |
|--------|-------------|----------|
| 诊断字段，不影响码 | ready 只判 DB 可打开，`migrations` 报 `pending` | ✓ |
| 本阶段不查迁移 | 整体顺延 Phase 4，无交付物 | |
| 严格判死 + 提前迁移 | 按 RT-02 字面实现，并在 Phase 3 跑 `migrate deploy` | |

**User's choice:** 诊断字段，不影响码
**Notes:** `20261028000037_init` 从未执行，`_prisma_migrations` 表不存在；严格判死会让 Phase 3 容器一直 503。接受 RT-02 第 2 条为**部分交付**，验收时须如实标注。

### 可写性验证位置

| Option | Description | Selected |
|--------|-------------|----------|
| 启动时写一次，ready 只读 | 写测试归入 RT-05 fail-fast，ready 之后只读 | ✓ |
| 每次 ready 都写 | 证据最强，但每次心跳一次写 IO | |
| 只查权限位 | `fs.access(W_OK)`，不真写 | |

**User's choice:** 启动时写一次，ready 只读
**Notes:** 理由是 Supervisor watchdog 会周期访问 ready，SD 卡 / eMMC 上持续写入是真实磨损。由此暴露的缺口（盘满时 ready 仍绿）留到下一区域处理。

### ready 响应结构

| Option | Description | Selected |
|--------|-------------|----------|
| checks 集合 | `{ status, checks: { database, migrations, disk }, uptimeMs, version }` | ✓ |
| 扁平字段 | `{ status, database, migrations }` | |
| 只回状态码 | 无 body | |

**User's choice:** checks 集合
**Notes:** Phase 6 只需新增 `homeAssistant` 一项，不动契约。

---

## DB 注入与 fail-fast

### 容器内 DATABASE_URL 来源

| Option | Description | Selected |
|--------|-------------|----------|
| 镜像 ENV + 代码兜底 | `ENV DATABASE_URL=file:/data/homeweave.db` + 代码兜底 `file:./data/app.db` | ✓ |
| 只靠代码兜底 | 镜像不带路径假设，但容器内会静默落到 `/app/data` 并在 `USER node` 下失败 | |
| 强制显式提供 | 缺失即退出，最严格但本地开发与 Compose 都麻烦 | |

**User's choice:** 镜像 ENV + 代码兜底
**Notes:** 启动日志须打出解析后的最终值（路径非密钥）。`prisma.config.ts` 的兜底是给 CLI 用的，运行时路径必须由代码显式解析后传给 adapter。

### 启动期检查覆盖范围

| Option | Description | Selected |
|--------|-------------|----------|
| 写测试 + 查询 + 余量 | 目录存在、临时文件写测试、`fs.statfs` 余量（50 MB）、真实查询 | ✓ |
| 写测试 + 查询 | 不查磁盘余量 | |
| 只做写测试 | 目录 + 可写 | |

**User's choice:** 写测试 + 查询 + 余量
**Notes:** 明确跳过 SQLite 文件头 magic 校验——真实查询会以更明确的错误暴露损坏，文件头检查冗余。

### 磁盘写满时的可见性

| Option | Description | Selected |
|--------|-------------|----------|
| 加 disk check | ready 增第三项 `disk`，`fs.statfs` 只读 | ✓ |
| 不加 | 盘满由启动期检查与运行日志覆盖 | |
| 检查时临时写一下 | 用写测试代替 statfs | |

**User's choice:** 加 disk check
**Notes:** 补上"ready 只读 → 盘满仍绿"的缺口；`fs.statfs` 不写盘、开销极小。

### fail-fast 退出方式

| Option | Description | Selected |
|--------|-------------|----------|
| 分退出码 | 结构化 error 日志 + 配置类 `78`（EX_CONFIG）/ 其他 `1` | ✓ |
| 一律 exit 1 | 实现最简，外部无法区分失败类型 | |
| 只 throw 不捕获 | 退出码由 Node 决定，日志格式不受控 | |

**User's choice:** 分退出码
**Notes:** HAOS 日志是用户唯一排障入口，退出码让"配置错了"与"崩了"可区分。

---

## Claude's Discretion

- `watchdog` 与 `HEALTHCHECK` 未进入讨论（用户首轮未选）。按 Phase 1 D-08 的授权自行决定：只加 `config.yaml` 的 `watchdog`（`http://[HOST]:[PORT:8099]/health/live`），不加 Dockerfile `HEALTHCHECK`。理由：HAOS 下 `docker health status` 不参与 Supervisor 决策，两套语义会在失败时互相掩盖。因 Phase 1 D-02 的单一来源约束，须从 `homeweave_app/app-metadata.json` 加并重新生成 `config.yaml`。
- `pino` 精确版本（安装时取最新 9.x，不用 `^`）
- 请求日志粒度：只记 `method` / `path` / `status` / `durationMs`，不记 body
- ready 超时预算：单 check 200 ms，整体 1 s
- 写测试临时文件名与清理方式
- `version` 字段来源（`package.json` vs 构建期注入）

## Deferred Ideas

- 迁移执行与 `_prisma_migrations` 判定 → Phase 4
- `ha_url` 的读取与 SSRF 校验 → Phase 6
- `/health/ready` 的限流与外部轮询保护 — 未讨论，当前假设仅 watchdog 与 CI 访问
- 原生模块清单的长期治理流程（谁批准新增 `.node`）→ 文档阶段
- Dockerfile `HEALTHCHECK` → 按决定不加；若出现非 HAOS 的容器运行方再评估
