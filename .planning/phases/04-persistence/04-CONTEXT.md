# Phase 4: 数据持久化与受控迁移 - Context

**Gathered:** 2026-10-29
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段交付的是**升级不会毁数据的路径**：`/data` 里的 SQLite 文件在容器重建与版本升级后存活，迁移是受控的四步（判断 → 备份 → 迁移 → 校验），任何一步失败都停住整个启动，绝不出现"清空重建"。

- 迁移执行器：读 `prisma/migrations/*/migration.sql`，在事务里按序应用（DATA-02）
- 迁移前备份 + 保留份数上限 + 备份失败阻断（DATA-03）
- `/health/ready` 的 `migrations` 项从诊断字段升为参与判定，关闭 Phase 3 的 D-06 偏差（DATA-02 / DATA-04）
- schema 版本与迁移结果可见（启动日志 + ready 字段）（DATA-04）
- `/data` 持久化的容器模拟验证（DATA-01）
- 备份恢复 Runbook（DATA-03 的"可恢复"）

**不包含**：业务表结构（随各阶段增量加）、HA 连接与自检（Phase 6）、Web UI（Phase 5）、App 内自检 watchdog 兜底（见 Deferred）、安装/升级的用户文档全量重写（Phase 7）。

**关闭的上游欠账**：Phase 3 的 D-06（`migrations` 只作诊断、RT-02 部分交付）。本阶段结束后 RT-02 第 2 条才算完整覆盖。

</domain>

<decisions>
## Implementation Decisions

### 迁移执行引擎（区域 1）

- **D-01: 自写迁移执行器，写 Prisma 兼容的 `_prisma_migrations` 行。不引入 `prisma` CLI 到运行时。**
  读 `apps/api/prisma/migrations/*/migration.sql`，按目录名（时间戳前缀）升序，跳过已在 `_prisma_migrations` 中 `finished_at` 非空且 `rolled_back_at` 为空的条目；每条迁移在 `BEGIN IMMEDIATE` 中执行，成功后写一行元数据。
  **决定性依据（已实测，非推断）**：`prisma@7.10.1` 依赖 `@prisma/engines@7.10.1`，该包在本机只含 `schema-engine-windows.exe`，**19.8 MB**；仓库内 `.pnpm` 下 `*wasm*` 零命中，即没有任何 wasm 版 schema engine。把 CLI 移入 `dependencies` 等于把 ~20 MB Rust 二进制带进 runtime，会直接推翻 D-05a 建立的 `RUST_FREE` 语义与 `scripts/probe-prisma-engine.mjs` 的预期清单（该探针只识别 `*.node`，`schema-engine-*` 不在其模式内）。
  零新增依赖：`better-sqlite3@^13.0.3` 与 `@types/better-sqlite3` 已在 `apps/api/package.json` 的 `dependencies` / `devDependencies` 中（实测）。
  — **Reversibility:** costly — 若将来必须改用官方 CLI，需重做镜像构成、探针清单与本文 D-12/D-13 的全部细节
- **D-02: SC-4「不存在任何自动 reset/drop 路径」的口径 = 禁止整库级，允许事务内表级搬迁。**
  禁止项（可静态 grep，验收必须为 0 命中）：`migrate reset`、删除或重命名 `*.db` / `*.db-wal` / `*.db-shm`、`DROP DATABASE`、`PRAGMA writable_schema`、任何"清空后重建"的分支。
  允许项：`migration.sql` 内的表级 `DROP TABLE`，但须同时满足：① 在单个事务内；② 同一文件内出现 `DROP TABLE` 时，必须存在对应的 `CREATE TABLE` 与 `INSERT INTO ... SELECT` 搬迁语句。
  **为什么不能按字面理解**：Prisma 对 SQLite 的 schema 变更（改列类型、加约束）生成的 SQL 天然是"建新表 → `INSERT SELECT` → `DROP TABLE` 旧表 → `RENAME`"。按"任何地方不得出现 DROP"验收，从第一次真实表结构变更起就无法成立。
  — **Reversibility:** cheap — 口径写在本文，验收脚本按此实现

### 备份策略（区域 2）

- **D-03: 备份手段 = `VACUUM INTO '<abs path>'`。**
  **不是三选一，是唯一可行项**（实测依据）：`PrismaService` 构造时传的是配置对象 `new PrismaBetterSqlite3({ url })`（`apps/api/src/prisma/prisma.service.ts:35`），`Database` 实例在 adapter 内部创建，**代码拿不到它**，因此 `better-sqlite3` 的 `db.backup()` 不可用（除非改造 adapter 封装，adapter 是否接受外部实例未经验证）。
  `VACUUM INTO` 由 SQLite 自身保证读一致性快照，不需要 `Database` 句柄，且**目标文件必须不存在**，天然防止覆盖旧备份。
  实测：当前 `journal_mode = delete`（非 WAL），全仓库无任何 `journal_mode` 设置。因此"WAL 下 copy 会拿到不可用快照"的担忧**尚未兑现**，但一旦将来开启 WAL 就成立——这是选 `VACUUM INTO` 而非文件复制的长期理由。
  — **Reversibility:** cheap — 单点函数，换实现不影响调用方
- **D-04: 仅在检测到 pending 迁移时备份，保留最近 3 份。**
  按文件名时间戳升序删最旧，超出即删。**不做**每次启动备份、不做定时备份：HAOS 设备重启频繁（Supervisor 重启、断电），每次启动全库复制会在 SD/eMMC 上造成持续写入放大，且 5×库大小会拖大 Supervisor 自身的备份体积。
- **D-05: 备份失败 → 阻断迁移，exit 78。**
  磁盘满、权限不足、`VACUUM INTO` 报错，一律不执行迁移，日志写明备份失败原因。
  例外：**全新安装直接跳过备份**（库文件不存在，或存在但 `_prisma_migrations` 与业务表均不存在）。此时无数据可丢，备份失败也无意义。
  理由：事务回滚理论上兜底，但 SQLite 对 DDL 的事务回滚边界在实践中仍需验证（见 Deferred）；备份是唯一确定的退路。
- **D-06: 恢复路径 = 只写 Runbook，不提供任何自动化恢复入口。**
  写进 `docs/23_ON_DEVICE_TEST_RUNBOOK.md` 新增一节：停容器 → 把 `/data/backups/<时间戳>.db` 拷回 `/data/homeweave.db` → 删掉残留 `-wal` / `-shm` → 起容器。必须写明"为什么必须先停再拷"（运行中的连接会持有 journal，旧快照会被回滚覆盖）。
  **不做**脚本、不做 App 内恢复入口、不做 admin 端点：一个能覆盖当前数据库的自动化入口本身就是危险面，与 D-02 的基调相冲。

### 迁移失败后的姿态（区域 3）

- **D-07: 硬 fail-fast，`exit 78`，不 listen。**
  日志一行结构化 JSON：`reason: "migrate_failed"`、失败的迁移名、SQL 错误摘要（走 Phase 3 的 `sanitize()`）。退出码沿用 D-12（Phase 3）：78 = 需人工介入，不给"重试可能好"的暗示。
  理由：事务已回滚 ⇒ 库完好但 schema 旧；此刻新代码配旧 schema 的任何查询都不可信，唯一安全姿态是不提供服务。
  **不选**"降级只读"：Phase 4 尚无 UI，用户唯一能看到的就是 `/health/ready`，而该接口在 fail-fast 之前就能被打出来（启动日志同理）；为了一个看不到收益的面保持容器 running，却要引入"进程活着但数据库不可用"这个与 D-06/Phase 3 语义冲突的状态，不划算。
  **不选**"同进程重试"：真正的 SQL 错误重试多少次结果相同，只会把启动拖长并让日志出现 N 条重复错误。
  **未验证**：HAOS 下 exit 非 0 后 Supervisor 的重启/退避行为（`Dockerfile` 无 `restart` 指令）。若真机出现日志刷屏，再决定是否加退避——不得在未观测前预设结论。
- **D-08: 不自动从备份恢复，只在日志里给出备份路径与手册位置。**
  事务失败 = 已回滚 = 库是完好的旧 schema，此时自动覆盖只会在"回滚不干净"的罕见情况下与真实数据竞争，并把现场（到底是哪条 SQL 出错）抹掉。自动覆库的代码路径本身就是本项目明确要避免的东西。

### schema 版本可见性与 drift（区域 4）

- **D-09: 可见性 = 启动日志 + `/health/ready` 的 `migrations` 项，两处都给。**
  启动：一行结构化日志，含 `from` → `to`、应用条数、耗时、备份文件名。
  ready：`migrations` 项新增 `current` / `appliedCount` / `status`。
  **两个面都要**的理由：启动失败（exit 78）时没有 ready 可查，恰恰最需要知道"停在哪个迁移"；而容器重启后日志会滚动，只有 ready 是稳定的查询面。UI 留给 Phase 5 直接消费，后端不再动。
- **D-10: 版本标识 = 迁移目录名 + 已应用计数，两者都给。**
  `current` = 最后一条已应用迁移的目录名（如 `20261028000037_init`），`appliedCount` = 已应用条数。两者都从 `_prisma_migrations` 现成行里取，成本为零，分别服务"对应到哪个 SQL 文件"与"共几步"。
- **D-11: drift（已应用迁移被改）→ 启动 fail-fast `exit 78`（`reason: "migration_drift"`），运行期 ready 报 503。**
  比 checksum，不一致即判定 drift，日志写出哪个迁移不符。理由：磁盘 SQL 已与库的实际结构脱钩，后续任何迁移都建立在错误假设上。
  **不选**"只 warn"：`migrations` 一旦按 D-06 参与状态码，"仅告警"就等于把一个已知不可信的 App 报成健康。

### 实现约束（由实测推导，plan 阶段必须遵守）

- **D-12: 迁移执行必须在 Nest bootstrap 之前，且不经过 Prisma Client。**
  建议顺序（plan 阶段细化）：解析 `DATABASE_URL`（复用 `config/database-url.ts`，**不读** `prisma.config.ts`）→ 父目录存在/可写/磁盘余量 → 读 `_prisma_migrations` 判断 pending → 需要时备份 → 事务执行迁移 → drift 校验 → 既有 startup checks（Phase 3 D-10）→ `NestFactory.create` → listen。
  用裸 `better-sqlite3` 打开同一路径，而不是 `$executeRawUnsafe`：迁移期间尚未 listen，不存在并发；且 Prisma 的 client 初始化本身要求 adapter 已就绪，反向依赖会形成循环。执行完必须 `db.close()`，否则 `_prisma_migrations` 写入会停留在 journal 里。
- **D-13: 元数据写入必须精确复刻 Prisma 的格式（全部实测，不得凭记忆）。**
  建表语句（`prisma migrate deploy` 在本机临时库生成的**原文**）：

  ```sql
  CREATE TABLE "_prisma_migrations" (
      "id"                    TEXT PRIMARY KEY NOT NULL,
      "checksum"              TEXT NOT NULL,
      "finished_at"           DATETIME,
      "migration_name"        TEXT NOT NULL,
      "logs"                  TEXT,
      "rolled_back_at"        DATETIME,
      "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
  )
  ```

  行内容实测：

  | 列 | 实测值 | 约束 |
  |---|---|---|
  | `id` | `65c7f8ee-d8dc-4ecc-a828-52e87bb5e453` | UUID v4（`crypto.randomUUID()`） |
  | `checksum` | `626f4670e873e477352e5a07ac5f47688e1a3b05bdb9b2a4094c8fc5c8d37f36` | **`sha256(原始文件字节)`，hex**。已验证：对 `migration.sql` 原始 144 字节做 sha256 与该值完全一致；对 `.trim()` 后的内容做则得到 `e0b542bf…`，**不匹配**。故写入器必须读 Buffer 直接哈希，**不得 trim、不得往返字符串、不得补 BOM** |
  | `finished_at` / `started_at` | `1793256227760` / `1793256227750` | **毫秒整数**（不是 ISO 字符串）。与 Phase 3 `migrations.check.ts` 按毫秒解析的实测一致 |
  | `applied_steps_count` | `1` | 该迁移内实际执行的语句数 |
  | `rolled_back_at` / `logs` | `null` | 成功路径留空 |

- **D-14: 显式偏差记录 —— ROADMAP SC-2 写的是"执行 `prisma migrate deploy`"，本阶段实现为自写执行器。**
  语义目标不变（受控应用、失败 fail-fast、不清库），但实现路径不同，原因是 D-01 的二进制代价。ROADMAP / REQUIREMENTS 的 DATA-02 措辞在验收时应标注这一偏差，**不得声称"已用官方 CLI 验证"**。
- **D-15: D-01 的连带文档义务。** `Dockerfile:154-155` 的注释（`ships but does not run`）与本阶段实现直接冲突，必须同步改写为「镜像随 `prisma/` 携带迁移历史并由 `dist/main.js` 在启动时执行；镜像内仍不含 Prisma CLI」。同时 `apps/api/prisma/ENGINE_DECISION` 若引用该说法也需检查。验收时这类注释与代码的不一致按缺陷处理，不算文档瑕疵。

### Claude's Discretion

- 迁移执行器的文件布局与命名（建议与 Phase 3 的 `health/checks/*.check.ts` 同风格：无装饰器、可被 `--experimental-strip-types` 直接加载做单测）
- 备份目录（建议 `/data/backups/`）、文件名时间戳格式
- 磁盘余量阈值：沿用 Phase 3 的常量还是为"备份 + 迁移峰值"单独设一个更大的值（备份需要约等于库大小的额外空间，**不能直接用 50 MB 那档**）
- 迁移日志的具体字段名
- `migrations` 项在 ready 中的超时预算（沿用 200 ms 还是更长，因为要读表 + 比对文件）

### Folded Todos

无 —— `todo.match-phase 4` 未返回属于本阶段的条目。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 需求与阶段契约
- `.planning/REQUIREMENTS.md` — DATA-01..04 原文（注意 DATA-02 的 `migrate deploy` 措辞与 D-14 的偏差）
- `.planning/ROADMAP.md` — Phase 4 的 4 条成功标准与"预期 3 plans"切片
- `.planning/phases/03-runtime/03-CONTEXT.md` — **D-05a**（RUST_FREE 收窄与原生模块清单）、**D-06**（本阶段要关闭的偏差）、**D-09**（`DATABASE_URL` 双来源）、**D-10**（启动检查清单）、**D-12**（退出码 78/1）
- `.planning/PROJECT.md` — Constraints（`/data` 持久化、不执行未批准的破坏性迁移）

### 代码现状
- `apps/api/src/prisma/prisma.service.ts` — 第 35 行 `new PrismaBetterSqlite3({ url })`，这是 D-03 判定 `db.backup()` 不可用的直接依据
- `apps/api/src/health/checks/migrations.check.ts` — 已能比对目录与表、已按毫秒处理 `finished_at`；本阶段把它从"诊断"升级为"参与判定"
- `apps/api/src/lifecycle/startup-checks.ts` — fail-fast 的实现范式与退出码用法，迁移器应与它同风格并被插在同一阶段
- `apps/api/src/main.ts` — 迁移器插入点：在 `NestFactory.create` 之前
- `apps/api/src/config/database-url.ts` — 唯一的 URL 解析来源，迁移器必须复用
- `apps/api/prisma/migrations/20261028000037_init/migration.sql` — 当前唯一迁移，仅 `CREATE TABLE "AppSetting"`
- `apps/api/package.json` — `better-sqlite3@^13.0.3` 已在 `dependencies`（零新增依赖的依据）；`prisma` 在 `devDependencies`
- `Dockerfile` — 只 COPY `dist` / `node_modules` / `prisma` / `package.json` 四条路径。**已核实**：第 158 行 `COPY --from=build /app/apps/api/prisma ./prisma` 拷的是整个 `prisma/` 目录，因此 `prisma/migrations/` 确实随镜像进入 runtime，D-01 的前提成立。
- `Dockerfile:154-155` — 注释写着 `prisma/ carries the migration history the image ships but does not run (D-1: no prisma CLI in the image)`。**本阶段必须改写**：「不运行」变为假（镜像会执行迁移），而「不含 CLI」仍为真。这是 D-01 的连带文档义务，漏改就会留下一条误导性的架构断言
- `scripts/probe-prisma-engine.mjs` — 原生模块预期清单，本阶段不应新增条目（D-01 的直接后果）
- `scripts/ci/assert-image.sh` — 现有 9 条断言，备份路径与迁移日志可能各需一条

### 部署与安全边界
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` — `/data` 挂载与 `0.1.3` 真机验收数据
- `docs/23_ON_DEVICE_TEST_RUNBOOK.md` — 恢复 Runbook 的落点（D-06）；注意其中"容器内没有 `kill` 二进制"这类既有环境坑
- `docs/14_ENV_AND_DEPLOYMENT.md` — 三种部署形态的 `DATABASE_URL` 取值
- `docs/08_SECURITY_AND_PRIVACY.md` — 备份文件同样不得含明文密钥（库内若有 token 字段，备份即敏感文件）

### 官方规范（实施时须现场核对）
- SQLite `VACUUM INTO` 语义与"目标文件必须不存在"的限制
- `better-sqlite3` 的 `pragma('journal_mode')` 与事务 API（`BEGIN IMMEDIATE` 的写法）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `migrations.check.ts` 的目录扫描 + 表比对逻辑可直接复用为"pending 判定"，只需加上 checksum 比对
- `startup-checks.ts` 的 fail-fast 结构（检查名 + 路径 + errno + exit 78）是迁移器失败路径的模板
- `database-url.ts` 的解析结果同时供 adapter 与迁移器使用，**不得二次解析**

### Established Patterns
- 依赖精确锁定；本阶段**不新增任何依赖**
- 注释写"为什么"并标注未验证部分（`VERIFIED LOCALLY` / `NOT VERIFIED`）
- 无装饰器的纯函数模块便于 `--experimental-strip-types` 直接单测（Phase 3 的做法）

### Integration Points
- Phase 5：`migrations` 已参与状态码，认证层可假设 `/health/*` 免鉴权；UI 直接消费 ready 的版本字段
- Phase 5+ 每新增一张表就新增一条迁移，执行器必须能处理 Prisma 生成的表重定义模式（见 D-02）
- Phase 6：HA 连接失败与迁移失败是两类不同故障，ready 里必须可区分
- Phase 7：恢复 Runbook 会被并入用户文档

</code_context>

<specifics>
## Specific Ideas

- 用户明确要求：**失败绝不清库**是这条 Phase 的第一原则，任何便利性设计（降级服务、自动回滚、脚本化恢复）都不得削弱它
- 用户明确选择"零新增依赖"路线，代价是接受自写执行器；因此**兼容性必须由测试保证**，不能靠"看起来一样"
- 验证结论必须区分静态检查 / 容器模拟 / HAOS 实机；本阶段能做的上限是容器模拟 + 单测

</specifics>

<deferred>
## Deferred Ideas

- **App 内自检兜底**（后台定时打自身 `/health/ready`，连续失败 `process.exit(1)`）：ROADMAP Phase 3 段的措辞只是提示，**不是本阶段范围**。它与 watchdog 的平台盲区有关，属于运维韧性，建议并入 Phase 6 或独立的运维阶段
- **SQLite DDL 事务回滚边界的实验验证**：D-05 把它作为"备份是唯一确定退路"的理由，但该边界本身未验证。若将来要做"备份可选"的优化，必须先补这个实验
- **WAL 模式**：当前 `journal_mode = delete`。开启 WAL 能提升并发读，但会让备份/恢复的文件级操作更复杂，未在讨论中评估
- **迁移的 dry-run / 预演**：未讨论
- **备份加密**：库内若出现敏感字段（Phase 5 的设备凭证），备份文件即敏感文件，是否需要加密留待 `docs/08` 的决定
- **非 HAOS 部署（纯 Compose）下的迁移并发**：多副本同时迁移未讨论；当前假设单容器单进程

</deferred>

---

*Phase: 04-Persistence 数据持久化与受控迁移*
*Context gathered: 2026-10-29*
