# Phase 3: 运行时骨架 — Research

**Researched:** 2026-10-28
**Domain:** NestJS 12 启动 / Prisma 7 SQLite driver adapter / pino 结构化日志 / HA App 打包
**Requirement IDs:** RT-01, RT-02, RT-03, RT-04, RT-05

**Confidence 图例**
- `[VERIFIED: <来源>]` — 本次会话实际打开文件 / 解包 npm 产物 / 运行命令确认
- `[CITED: <url>]` — 官方文档原文
- `[ASSUMED]` — 未经本次验证，§11 列出验证方式

---

## 1. 摘要

1. **Prisma 7.10.1 强制 driver adapter**，非可选；`@prisma/adapter-better-sqlite3@7.10.1` **自己会剥 `file:` 前缀**，不要再手写 URL 解析。
2. **`better-sqlite3@13.0.3` 包内嵌全套 prebuild**（含 `linux-arm64`，N-API 产物）—— **CONTEXT D-05b「arm64 缺 prebuild 需源码编译」的前提被推翻**。
3. **pino 主线是 10.4.0（不是 v9）**；`redact` 只吃静态路径、通配符开销大、`**` 未在官方文档出现 → D-03 的递归脱敏**必须自写**，pino `redact` 只作第二道保险。
4. **Nest 12 `enableShutdownHooks()` 默认 `process.kill(pid, signal)` 重放信号**；要 `exit 0` 且让异步 logger flush，须传 `{ useProcessExit: true }`。
5. **SC-2「迁移未完成 → 非 2xx」与 D-06 直接冲突**（§3），研究消解不了，需要规划时定口径。

---

## 2. 依赖与版本（本次全部核实）

| 包 | 当前版本 | 仓库现状 | 证据 |
|---|---|---|---|
| `@nestjs/common` | 12.3.2 | `^12.3.0`，实装 12.3.0 | `[VERIFIED: node_modules/@nestjs/common/package.json]` |
| `@nestjs/core` | 12.3.0 | 已装 | `[VERIFIED: node_modules/.pnpm/@nestjs+core@12.3.0*]` |
| `@prisma/client` | 7.10.1 | `7.10.1` | `[VERIFIED: apps/api/package.json]` |
| `@prisma/adapter-better-sqlite3` | **7.10.1** | 未装 | `[VERIFIED: pnpm view]` |
| `better-sqlite3` | **13.0.3** | 未装 | `[VERIFIED: pnpm view + npm pack]` |
| `pino` | **10.4.0** | 未装 | `[VERIFIED: pnpm view]` |
| `pino-http` | 11.0.0 | 未装 | `[VERIFIED: pnpm view]` |
| `@nestjs/terminus` | 12.1.0 | 未装 | `[VERIFIED: pnpm view]` |

**版本对齐：** adapter 必须与 client **同版**（7.10.1，不用 `^`）。

**Node：** 本地 v22.17.0，`engines.node >= 22`；镜像 `node:22-bookworm-slim`（glibc）。

---

## 3. 必须先解决的冲突：SC-2 与 D-06 不能同时成立

- SC-2：`ready` 在「迁移到位」时 2xx，**「迁移未完成」时非 2xx**
- D-06：`migrations` 只作 `pending` 诊断字段，**不参与状态码**

镜像内**没有 prisma CLI**（`prisma` 是 devDep，`--prod` 不进镜像；`Dockerfile:110` 明确写了 IMG-02），运行时不执行 `migrate deploy`。所以「迁移未到位」在容器里只能被**观察**、不能被**修复** —— 若它参与状态码，一个未迁移的 DB 会永远 ready 失败并被反复重启。

**两个方案，规划时必须显式选定并写进 PLAN：**
- **A（推荐，符合 D-06）**：`ready` 只要求「能连 + 能写探测表 + 磁盘有余量」，`migrations` 作为 body 字段返回 `ok|pending|unknown`，不影响状态码。验收明确记录 SC-2 第 2 分句**未按字面交付**。
- **B**：让 migrations 参与状态码，则必须同时给出启动期迁移方案（塞回 CLI 或自带极简 runner），与 D-01 冲突，显著扩大范围。

---

## 4. Prisma 7 + better-sqlite3

### 4.1 adapter 是强制的

`[VERIFIED: apps/api/src/generated/prisma/internal/prismaNamespace.ts:694-722]`

```ts
export interface PrismaClientOptionsWithAdapter extends PrismaClientBaseOptions {
  /** A driver adapter is **required** unless you connect through Prisma Accelerate */
  adapter: runtime.SqlDriverAdapterFactory
  accelerateUrl?: never
}
export type PrismaClientOptions = PrismaClientOptionsWithAccelerateUrl | PrismaClientOptionsWithAdapter
```

生成的 `client.ts` 顶部示例即 `new PrismaClient({ adapter: new PrismaPg({...}) })`。不存在无 adapter 的分支。

> 这也解释了 `RUST_FREE` 为何诚实（连接全走 JS 驱动），但 `RUST_FREE` 从此**不能**读作「无原生二进制」——`better-sqlite3` 就是原生模块。即 D-05a 的语义收窄。

### 4.2 构造签名（从 7.10.1 实际类型抄写）

`[VERIFIED: 解包 @prisma/adapter-better-sqlite3@7.10.1 dist/index.d.ts]`

```ts
type BetterSQLite3InputParams = Options & { url: ':memory:' | (string & {}) };
export declare class PrismaBetterSqlite3 implements SqlMigrationAwareDriverAdapterFactory {
  readonly provider = "sqlite";
  constructor(config: BetterSQLite3InputParams, options?: PrismaBetterSqlite3Options);
}
type PrismaBetterSqlite3Options = {
  shadowDatabaseUrl?: string;
  timestampFormat?: 'iso8601' | 'unixepoch-ms';
};
```

`Options` 是 `better-sqlite3` 自身选项（`readonly`、`timeout`、`fileMustExist`…），可与 `url` 同对象传入。

### 4.3 `file:` 前缀由 adapter 自己剥

`[VERIFIED: 解包 dist/index.js, createBetterSQLite3Client]`

```js
const { url, ...config } = input;
const dbPath = url.replace(/^file:/, "");
const db = new Database(dbPath, config);
```

**`DATABASE_URL=file:/data/homeweave.db` 可原样透传**，与 `apps/api/prisma.config.ts:16` 的 CLI 解析一致。**不要写 `stripFileProtocol()`**，重复实现剥错一次就会在 cwd 下建出一个 `data:` 目录。

⚠️ 相对路径 `file:./data/app.db` 剥后相对 `process.cwd()`（容器内 `/app`）。ready 的 `disk` 检查必须用**同一个**解析结果，别一个绝对一个相对。

### 4.4 prebuild 矩阵 —— 对 D-05b 的实证反驳

`[VERIFIED: npm pack better-sqlite3@13.0.3 + tar -tzf，本地执行，tarball 10.87 MB]`

```
package/prebuilds/darwin-arm64.node        package/prebuilds/linux-arm64.node
package/prebuilds/darwin-x64.node          package/prebuilds/linux-x64.node
package/prebuilds/linuxmusl-arm64.node     package/prebuilds/linuxmusl-x64.node
package/prebuilds/win32-arm64.node         package/prebuilds/win32-x64.node
package/binding.gyp
```

三条推论：
1. **D-05b 的 build-stage 工具链（python3/make/g++）不是必需路径。** 二进制随包落地，`bookworm-slim` 是 glibc → 命中 `linux-*.node`；HAOS aarch64 命中 `linux-arm64.node`。无编译、无 GitHub 下载。
2. **但这是当前版本的事实，不是永久契约。** 保留一个**廉价断言**即可：镜像构建后校验 `node_modules/better-sqlite3/prebuilds/linux-<arch>.node` 存在，缺失即 fail 并给出明确信息。比重装 g++ 便宜得多，且让「升级后 prebuild 消失」变红而不是运行时崩。
3. musl 不用管（当前非 Alpine）。若将来换 Alpine，prebuild 已内嵌 `linuxmusl-*`。

> **此修正须覆盖 CONTEXT D-05b**，否则执行者会搭一套用不上的编译链。

### 4.5 迁移数据结构（ready 的判据来源）

在仓库既有 `apps/api/.tmp/verify.db`（Phase 2 跑过 `migrate deploy`）上实测：

```
tables: AppSetting,_prisma_migrations
_prisma_migrations rows: 1
   20261028000037_init finished_at= 1793146203798
```

`[VERIFIED: node:sqlite DatabaseSync 只读打开]`

- 表名固定 `_prisma_migrations`，列含 `migration_name`/`started_at`/`finished_at`
- **`finished_at` 是 unixepoch 毫秒数值**，不是 ISO 串（与 `timestampFormat` 默认值相关）
- `prisma/migrations/` 已打进镜像（`Dockerfile:104`），所以「期望迁移数」可在运行时静态数出，与 DB 对比得 `pending` 数，**不需要 CLI**
- 判据：`where finished_at is null` → 中断行；表不存在 → `unknown`（全新库）

### 4.6 SQLite pragma

- `journal_mode=WAL` 的可写探测会留 `-wal` / `-shm` 旁文件 → 用只读目录做负向测试时，失败原因可能是「无法创建 -wal」而非「无法写」，断言消息要能区分 `[ASSUMED]`
- `busy_timeout` 在 better-sqlite3 里就是构造选项 `timeout`（ms）；单写入者 + 启动期一次探测，`5000` 足够 `[ASSUMED]`

---

## 5. 日志与脱敏（SC-4）

### 5.1 NestJS 12 的 `LoggerService` 真实接口

`[VERIFIED: node_modules/@nestjs/common/services/logger.service.d.ts]`

```ts
export interface LoggerService {
  log(message: any, ...optionalParams: any[]): any;
  error(message: any, ...optionalParams: any[]): any;
  warn(message: any, ...optionalParams: any[]): any;
  debug?(...): any; verbose?(...): any; fatal?(...): any;
  setLogLevels?(levels: LogLevel[]): any;
}
```

必需 `log`/`error`/`warn`；`debug`/`verbose`/`fatal`/`setLogLevels` 可选。`fatal` 是 12.x 才有的，pino 有同级，直接映射别丢。
`error()` 的调用约定是 `(message, stack?, context?)`，`log()` 是 `(message, context?)` —— 末尾字符串参数是 context 不是数据 `[ASSUMED]`。

### 5.2 pino 的 `redact` 撑不起 D-03

`[CITED: https://raw.githubusercontent.com/pinojs/pino/main/docs/redaction.md]`

- 路径遵循 ECMAScript path lookup，额外支持 `*`
- **全文未出现 `**`** → 不要假设跨层通配
- `censor` 默认 `'[Redacted]'`（由示例输出体现）
- 通配符开销显著（官方示例：四键两对象约 50%，无通配约 2%）
- 原文明确："Path strings must not originate from user input"（fast-redact 用 VM 做语法检查）

| D-03 要求 | pino `redact` |
|---|---|
| 键名黑名单（任意层级） | ❌ 只能静态路径 |
| `Bearer`/`Token` **值模式** | ❌ 不支持内容匹配 |
| 循环引用保护 | ❌ `JSON.stringify` 会抛 `Converting circular structure` |

→ **必须自写 `sanitize(value)`**（深度上限 + `WeakSet` 环检测 + 键名黑名单 + 值正则），挂在 pino `formatters.log` 或自定义 serializer 上；`redact` 仅保留为静态已知路径的第二道保险。

### 5.3 requestId 与 `req.headers.authorization`

`[CITED: 同上]` 路径作用于**序列化后的对象形状**：只有用 `pino.stdSerializers.req`（`pino-http` 默认）时输出才含 `headers`，路径才命中。

**本阶段建议：不引入 `pino-http`。** SC-4 只要「带 Authorization 的请求走一遍后日志被掩码」+「每条日志有 requestId」。更小的做法：自写极简中间件生成 `crypto.randomUUID()`、经 `AsyncLocalStorage` 或 `req.id` 传递、日志统一 `bindings: { requestId }`，脱敏由 §5.2 的 `sanitize()` 兜住。规划时二选一并写清理由。

### 5.4 级别解析

`LOG_LEVEL` → `/data/options.json` 的 `log_level` → `info`（D-04）。`options.json` 由 Supervisor 写入，直接读文件即可 `[ASSUMED]`；文件缺失/JSON 损坏必须回落 `info` 且不崩。

注意 `app-metadata.json` 的 `optionDefs.logLevel.values` 目前只有 `["info","debug","warn"]` `[VERIFIED: homeweave_app/app-metadata.json:28-36]`，**没有 error/fatal**。代码若接受更多级别，必须同步生成器的 schema DSL，否则 Supervisor 直接拒绝用户输入。

---

## 6. 健康检查

### 6.1 手写，不引入 `@nestjs/terminus`

- 本阶段仅 3 个检查（`database`/`migrations`/`disk`），Terminus 的价值在 10+ 检查与生态集成
- Terminus 响应体固定含 `details`，而 **SC-1 要求 `live` 不含版本细节/内部路径/依赖信息** —— Terminus 天生倾向暴露内部信息，需额外裁剪
- `@nestjs/terminus@12.1.0` 与 Nest 12.3.0 的 peer 兼容性本次未验证 `[ASSUMED]`；不引入同时是风险规避

### 6.2 响应形状

```jsonc
// GET /health/live → 200，恒定，不查任何依赖
{ "status": "ok" }

// GET /health/ready
{
  "status": "ok" | "degraded",
  "checks": {
    "database":   { "status": "ok" | "fail", "detail": "..." },
    "migrations": { "status": "ok" | "pending" | "unknown" },
    "disk":       { "status": "ok" | "low", "freeBytes": 123456 }
  }
}
```

`live` **不得**依赖 DB/磁盘：否则关闭窗口里已断开 DB 的进程会被 watchdog 判死，触发多余重启。

### 6.3 状态码

- 正常 → **200**；DB 不可写 → **503**
- Supervisor watchdog 只认 `<300` 为健康 `[CITED: developers.home-assistant.io/docs/apps/configuration/]`，故 500 与 503 对 Supervisor 等价；但 503 对未来任何前置代理语义正确
- **不要**用 500 表示依赖不可用（会被误读为代码缺陷）

---

## 7. 优雅关闭（SC-3）

### 7.1 Nest 12 的真实行为（最易写错处）

`[VERIFIED: node_modules/.pnpm/@nestjs+core@12.3.0*/node_modules/@nestjs/core/nest-application-context.js:207-263]`

```js
enableShutdownHooks(signals = [], options = {}) {
  if (!signals || isEmptyArray(signals)) signals = Object.values(ShutdownSignal);
  this.listenToShutdownSignals(signals, options);
}
// cleanup:
if (this.receivedSignal) return;              // 防重入
await this.shutdown(signal).finally(() => { this.receivedSignal = false; });
if (options.useProcessExit) {
  // required for async loggers (like Pino with transports) to flush their buffers
  process.exit(0);
} else {
  process.kill(process.pid, signal);          // 默认：重放信号
}
```

结论：
- 不传 options → 关闭后重放 SIGTERM，按 Node 默认行为退出（code 143），且**异步 logger 缓冲可能未刷**
- 要 `exit(0)` + 保证 flush → `app.enableShutdownHooks(Object.values(ShutdownSignal), { useProcessExit: true })`
- `onModuleDestroy` / `beforeApplicationShutdown` 仍会被调用，Prisma `$disconnect()` 放 `OnModuleDestroy` 即可
- **不要再手写 `process.on('SIGTERM')`**：会与 Nest handler 竞争，导致双重 `$disconnect` 或提前 `exit` 使关闭走不完

### 7.2 时间预算

- `docker stop` 在 Linux 容器默认宽限 **10s**，超时 **SIGKILL** `[CITED: https://docs.docker.com/reference/cli/docker/container/stop/]`
- SC-3 要求无被迫 SIGKILL → 内部预算必须 < 10s。建议 **8s**：`server.close()` 停接新连接 → 最多 5s 排空 → `$disconnect()` 最多 2s → 1s 余量
- HA Supervisor 自身停止超时是否更短：**未验证** `[ASSUMED]`，执行阶段应在真实 HAOS 上实测 `ha apps stop homeweave` 耗时并据此收紧

### 7.3 关闭顺序

1. 置 `shuttingDown = true` → `ready` 立即返回 503（先摘流量）
2. `server.close()` 停接新连接
3. 等在途请求排空（`server.close` callback）
4. `prisma.$disconnect()`
5. `logger.flush()`（若有 transport）→ `process.exit(0)`

⚠️ **顺序陷阱：** `$disconnect()` 若早于排空，在途请求会拿 "Cannot use a closed client"，日志里出现一批**假 500**。

---

## 8. 启动期 fail-fast 与文件系统（SC-5）

### 8.1 四步校验（D-09）

1. 目录存在且可写：`fs.accessSync(dir, fs.constants.W_OK)`
2. 写测试：建临时文件再删（**只做一次**，D-06）
3. 磁盘余量：`fs.statfsSync(dir)` → `bsize * bavail`
4. 真实查询：`prisma.$queryRaw\`select 1\`` 或对 `AppSetting` 的一次读

`[VERIFIED: 本地 node v22.17.0，fs.statfsSync 与 fs.statfs 均存在，返回 {bsize, bavail, blocks}]`
`fs.statfs` 自 Node 18.15 加入且被标注 **experimental** `[ASSUMED]`；若日志出现 `ExperimentalWarning`，用 `--no-warnings=ExperimentalWarning` 过滤，别用 `child_process df`。

**overlayfs 陷阱：** HA Supervisor 的 `/data` 是 bind mount，`statfs` 报的是**宿主机分区**余量，不是容器可写层 `[ASSUMED]`。这正是想要的语义，但要写进注释，否则后人以为数错。

### 8.2 退出码

- `78` = 配置类（路径不可写、必需 env 缺失、端口非法）
- `1` = 其他启动失败（DB 连通、迁移读失败）
- 两者都必须在日志里给出**一条**可读原因 + 建议动作；`78` 选自 `EX_CONFIG`，便于将来 Supervisor/systemd 语义化处理 `[ASSUMED]`

### 8.3 端口不一致（现存缺陷，必须一起修）

`[VERIFIED: 本地 grep]`
- `apps/api/src/main.ts:8` 读 `process.env.PORT ?? 8099`
- `.env.example` 写的是 `APP_PORT=8500`
- `homeweave_app/config.yaml` 的 `ingress_port: 8099`

三处不一致。D-08 要求启动期校验端口 → 先统一为 `PORT`（与 `ingress_port` 一致），并把 `.env.example` 的 `APP_PORT` 改掉。否则本地开发按 `.env.example` 配了端口，容器里根本没读。

---

## 9. HA App 打包：watchdog（D-13）

### 9.1 官方语法（`watchdog` 是字符串 URL）

`[CITED: https://developers.home-assistant.io/docs/apps/configuration/]`

```yaml
watchdog: "http://[HOST]:[PORT:8099]/health/live"
```

- 类型是 **string URL**，不是 bool、不是 map
- `[HOST]` 在 watchdog 语境下解析为**应用自身 IP**；`[PORT:8099]` 用的是**容器端口**（除非 `host_network: true`）
- 任何 `<300` 的响应即判健康
- 也支持 `tcp://[HOST]:[PORT:8099]`（仅测连通性）
- **未知键静默忽略、无警告** → `watch_dog` / `watchdog_url` 这类拼写错误会**无声失效**

Supervisor 的探测间隔、连续失败阈值、重启退避**该页未文档化** `[ASSUMED]`，不要编数字。

### 9.2 生成器是硬约束（不能手改 config.yaml）

`[VERIFIED: scripts/generate-app-metadata.mjs]`

- 源真相是 `homeweave_app/app-metadata.json`，`config.yaml` 与 `repository.yaml` 都是生成物
- 生成器有 `assertConsumedKeys()`：**`app` 下出现未被消费的键会直接 fail**，注释里恰好举了 `app.watchdog = true` 这个例子（:322-327）
- key 顺序是契约（`01-PATTERNS.md §4`），插入位置会影响 `--check` 的零 diff 不变量

所以加 watchdog 必须同时改：
1. `app-metadata.json` 的 `app.watchdog`（**按 D-13 是字符串 URL**，不是 `true`）
2. `generate-app-metadata.mjs` 的 `APP_SOURCE_KEYS` + `buildConfigYaml()` 输出行
3. `scripts/validate-app-metadata.mjs`（若它也断言键集合 —— 需读该文件确认 `[ASSUMED]`）
4. 跑 `corepack pnpm generate:app` 重新生成，再 `corepack pnpm check:app` 验零 diff

### 9.3 与 `startup`/`boot` 的交互

`startup` 默认 `application`，`boot` 默认 `auto` `[CITED: 同上]`。该页**未定义** watchdog 与 startup 的交互 `[ASSUMED]`：理论风险是 Prisma 初始化慢 → watchdog 在 `listen()` 之前探测失败 → 重启循环。缓解：**先 `listen()` 再跑重活**，或让 `live` 在 DB 就绪前就返回 200（§6.2 已要求 live 不查依赖）——这条正好由设计规避。

---

## 10. 测试策略

| 目标 | 做法 | 备注 |
|---|---|---|
| `sanitize()` 递归脱敏 | 纯函数单测：黑名单键、Bearer 值、`Token xxx`、嵌套数组、自引用对象、深度超限 | 无需容器，最快 |
| `LoggerService` 适配 | 注入一个假的 pino 实例（记录 calls），断言 level 映射与 context 提取 | 不要 spy stdout |
| 关闭行为 | `child_process.spawn('node', ['dist/main.js'])` → `SIGTERM` → 断言退出码 0 与日志顺序 | **Windows 上 `SIGTERM` 语义不同**（`process.kill` 在 win32 是强制终止）→ 该测试标 CI-only，Windows 上 skip 并记 `SKIPPED`，禁止记成 pass |
| 只读目录 | `chmod 0555`（Linux）+ 清理恢复；Windows 无效 → CI-only | 与 Phase 2 的 `bash -n` 同类处理 |
| 未迁移库 | 指向一个空文件 DB，断言 `migrations.status = unknown` | 跨平台可行 |
| 探针扩展（D-05a） | 单测喂伪造目录树：`node_modules/better-sqlite3/prebuilds/linux-x64.node` 应命中，`prisma/generated/**` 不应误判 | 纯文件系统，跨平台 |

**Windows 宿主的既有先例：** Phase 2 已把 `bash -n` 记为 `SKIPPED (no bash on this host)`。本阶段同类的容器/Linux 专属断言一律照此办理，**SUMMARY 里如实写 SKIPPED，不得写成通过**。

---

## 11. 待现场验证（ASSUMED 清单）

| # | 假设 | 验证方式 | 若为假的影响 |
|---|---|---|---|
| A1 | HA Supervisor 停止超时 ≥ 10s | 真机 `ha apps stop homeweave` 计时 | 关闭预算要收紧，可能 < 5s |
| A2 | `/data` 挂载对容器内 `node` 用户可写 | 真机启动，看 fail-fast 是否误报 | **高风险**：`Dockerfile:112` 是 `USER node`，而 Supervisor 挂载的 `/data` 常属 root → 可能启动即失败 |
| A3 | `/data/options.json` 路径与格式 | 真机读一次文件 | 级别回落逻辑失效，但不会崩 |
| A4 | `fs.statfs` 在 HAOS 容器内返回宿主机卷余量 | 真机打一次日志对比 `df` | disk 检查数值失真 |
| A5 | Terminus 12.1.0 兼容 Nest 12.3.0 | `pnpm view @nestjs/terminus peerDependencies` | 已决定不用，影响为零 |
| A6 | `validate-app-metadata.mjs` 是否也断言 app 键集合 | 读文件 | 漏改会导致 `pnpm lint` 红 |
| A7 | `LoggerService.error()` 的第 2/3 参数语义 | 读 `@nestjs/common/services/logger.js` | context 提取错位，日志字段脏 |

**A2 是本阶段最大的未知风险**：若成立，`ready` 的 `database` 检查会在真实部署里恒 fail，而本地（Windows + 可写目录）全绿。规划时必须安排一次真机验证，或把 `USER node` 改成可配置。

---

## 12. 陷阱清单（写代码前读一遍）

1. 不要手写 `file:` 剥离 —— adapter 已经做了
2. 不要手写 `process.on('SIGTERM')` —— 与 Nest 抢
3. 不要用 pino `redact` 当唯一脱敏 —— 值模式和任意层级它做不到
4. 不要用 `**` 通配符 —— 官方文档没有它
5. 不要假设 `RUST_FREE` 意味着无 `.node` 文件 —— `better-sqlite3` 就是
6. 不要在 `live` 里查 DB —— 关闭窗口会被 watchdog 判死
7. 不要先 `$disconnect()` 后排空 —— 会产生假 500
8. 不要手改 `config.yaml` —— 生成器 `assertConsumedKeys` 会挡住，且 `--check` 会红
9. 不要用 `APP_PORT` —— 代码读 `PORT`
10. 不要把 Windows 上 skip 的容器测试写成通过

---

## 13. Validation Architecture

Nyquist 维度 8 需要：每个计划任务都要能被**独立验证**，且验证手段在本机能跑或能明确标 SKIPPED。

### 13.1 可验证不变量（invariants）

| ID | 不变量 | 验证命令/断言 | 平台 |
|---|---|---|---|
| INV-1 | `live` 不含敏感字段 | 起进程 → `fetch('/health/live')` → 断言 body 键集合 ⊆ `{status}` | 全平台 |
| INV-2 | `ready` 在可写库上 200 且 `checks.database.status==='ok'` | 同上 + 临时 DB | 全平台 |
| INV-3 | `ready` 在不可写目录上 503 | `chmod 0555` 后重启 | Linux/CI |
| INV-4 | `SIGTERM` 后 8s 内退出且 code 0，日志含「停止接收」「prisma disconnected」 | spawn + kill + 断言日志行序 | Linux/CI |
| INV-5 | `Authorization` 值在日志中被掩码 | 单测 `sanitize()` + 一次端到端请求 grep 日志 | 全平台 |
| INV-6 | 每条日志带 `requestId` | 端到端请求后 grep 该请求的全部日志行 | 全平台 |
| INV-7 | 不可写 `DATABASE_URL` → exit 78 + 单条原因 | 指向 `chmod 0555` 目录启动 | Linux/CI |
| INV-8 | `assert-image.sh` 由 8 项变 9 项，第 9 项是 `fetch(/health/live)` 且带重试 | `bash -n` + 静态 grep 断言项 | Linux/CI（Windows 标 SKIPPED） |
| INV-9 | 探针在存在 `better-sqlite3` 二进制时**不再**报 `RUST_FREE` 语义混淆 | 单测喂伪目录树 | 全平台 |
| INV-10 | `watchdog` 出现在生成的 `config.yaml` 且 `check:app` 零 diff | `pnpm generate:app && pnpm check:app` | 全平台 |

### 13.2 测试分层

- **单元（跨平台，Windows 也跑）**：`sanitize()`、级别解析、URL→路径解析复用、探针文件树判定、`LoggerService` 映射
- **进程内集成（跨平台）**：Nest `Test.createTestingModule` 起 app，打两个健康端点
- **容器/信号（CI-only）**：INV-3/4/7/8

### 13.3 Nyquist 覆盖要求

每个 PLAN 任务的 `<acceptance_criteria>` 必须映射到上表至少一个 INV-ID。没有 INV 可映射的任务说明它不可验证，应拆小或改写。

---

## 14. 对 CONTEXT 的修订建议（供 planner 落地时提及）

| CONTEXT 条目 | 修订 | 依据 |
|---|---|---|
| D-01（日志） | `pino` 10.4.0，不是 v9 | §2 |
| D-03（脱敏） | 递归脱敏**必须自写**，pino redact 只作第二道保险 | §5.2 |
| D-05a（`RUST_FREE`） | 语义收窄成立，探针须扩到 `node_modules/**/*.node` | §4.1、§4.4 |
| D-05b（arm64） | **前提不成立**：prebuild 已内嵌含 `linux-arm64`，工具链非必需；改为「断言 prebuild 文件存在」 | §4.4 |
| D-06（migrations） | 与 SC-2 冲突，需在 PLAN 里显式选定方案 A/B | §3 |
| D-13（watchdog） | 值为 URL 字符串；须改生成器三处而非手改 YAML | §9.1、§9.2 |
| D-08（端口） | `.env.example` 的 `APP_PORT` 是错误的，统一为 `PORT` | §8.3 |

