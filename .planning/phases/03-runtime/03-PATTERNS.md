# Phase 3: 运行时骨架 - Pattern Map

**Mapped:** 2026-10-28
**Files analyzed:** 33（17 新增 / 16 修改）
**Analogs found:** 26 / 33 有可复用 analog（7 项无 analog，给出结构先例）

> 下表所有 analog 路径均经 `git ls-files` 核验为 **tracked source**，无 gitignore 的生成目录。`apps/api/src/generated/prisma/**` 是 gitignored 生成物，仅作**引证**，不得作为 analog 引用。

---

## File Classification

### 新增（`apps/api/src/`）

| New File（建议路径） | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/config/database-url.ts` | utility | transform | `apps/api/prisma.config.ts` | exact（同一问题的 CLI 侧解法） |
| `src/config/log-level.ts` | utility | file-I/O→transform | `scripts/probe-prisma-engine.mjs`（`readDecisionFile`） | role-match |
| `src/logging/sanitize.ts` | utility | transform（递归） | `scripts/probe-prisma-engine.mjs`（`stripComments`） | flow-match（只有纯函数形状对得上） |
| `src/logging/pino-logger.service.ts` | provider | transform | `scripts/build-image.mjs`（`probeBuildx({spawn})`）+ `scripts/lint-workspace.mjs`（`runLint({write})`） | flow-match |
| `src/logging/request-id.middleware.ts` | middleware | request-response | 无 | **none** |
| `src/prisma/prisma.service.ts` | service | CRUD/连接生命周期 | 无 | **none** |
| `src/health/health.controller.ts` | controller | request-response | 无（仓库零 controller） | **none**（先例见 §6） |
| `src/health/health-checks.ts` | service | 聚合诊断 | `scripts/lint-workspace.mjs`（`runLint`）+ `scripts/probe-prisma-engine.mjs`（`checkDecision`） | role-match |
| `src/health/health.module.ts` | config | — | `apps/api/src/app.module.ts` | role-match（唯一模块声明先例） |
| `src/lifecycle/startup-checks.ts` | service | batch（有序 fail-fast） | `scripts/generate-app-metadata.mjs`（`main()`：校验→构造→写盘） | flow-match |
| `src/lifecycle/shutdown.ts` | hook | event-driven | 无 | **none** |

### 新增（`apps/api/test/`、`scripts/ci/`）

| New File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `apps/api/test/sanitize.test.ts` | test | transform | `scripts/probe-prisma-engine.test.mjs` | role-match（`.mjs`→`.ts` 是新的） |
| `apps/api/test/log-level.test.ts` | test | file-I/O | `scripts/probe-prisma-engine.test.mjs`（`withFixture` 临时树） | role-match |
| `apps/api/test/logger-adapter.test.ts` | test | transform | `probe-prisma-engine.test.mjs` 断言风格 + 注入式测试点 | role-match |
| `apps/api/test/health-live.test.ts`、`health-ready.test.ts` | test | request-response | 无（首次用 `Test.createTestingModule`） | **none** |
| `apps/api/test/shutdown.dist.test.mjs` | test | event-driven | `probe-prisma-engine.test.mjs`（`cli()` 用 `spawnSync` 断言 `status`） | flow-match（改 spawn+kill） |
| `scripts/ci/assert-failfast.sh` | script | batch | `scripts/ci/assert-image.sh` | role-match |
| `scripts/ci/assert-ready-degraded.sh` | script | request-response | `scripts/ci/assert-image.sh` 第 6 条 | exact |

### 修改

| Modified File | 关键参照位置 |
|---|---|
| `apps/api/src/main.ts` | 现有骨架 `main.ts:5-12`；改造点 `:6`（未传 logger）、`:8`（`PORT ?? 8099`） |
| `apps/api/src/app.module.ts` | `app.module.ts:6-7`（唯一模块声明形状） |
| `apps/api/package.json` | `:7-13` 脚本块、`:18` 精确锁版本风格 |
| `Dockerfile` | `:12-20` deliberately-absent 注释范式、`:44-49` RUST_FREE 注释、`:94-105`、`:112-116` |
| `apps/api/prisma/ENGINE_DECISION` | **文件内容不变**（仍 `RUST_FREE`），语义收窄；注释载体在 Dockerfile 与 docs/21 |
| `scripts/probe-prisma-engine.mjs` | 自身 `NATIVE_MARKERS:28-33`、`listFiles:81-92`、`probe:105-120`、`checkDecision:148-179` |
| `scripts/probe-prisma-engine.test.mjs` | 自身 `withFixture:27-54`、`cli:56-59` |
| `scripts/ci/assert-image.sh` | 自身第 6 条 `:192-218` 是第 9 条的模板；计数框架 `:45-54`；尾注 `:249-254` |
| `homeweave_app/app-metadata.json` | `:23-49` |
| `scripts/generate-app-metadata.mjs` | `APP_SOURCE_KEYS:328-345`、`buildConfigYaml:236-285`、`assertConsumedKeys:358-371` |
| `scripts/validate-app-metadata.mjs` | `CONFIG_ALLOWED_KEYS:35-60`、V2 `:167-176`、V8 `:308-318`、V12 `:404-422` |
| `scripts/__tests__/fixtures.mjs` | `VALID_CONFIG:36-51` |
| `scripts/__tests__/generate-app-metadata.test.mjs` | `makeTempTree:60-82`、`app.watchdog` 负例 `:219-243` |
| `scripts/validate-dockerfile.mjs` | D5 `:297-307`、D9 `:356-367` |
| `scripts/validate-dockerfile.test.mjs` | D9 断言 `:239-244` |
| `.env.example`、`docs/14_ENV_AND_DEPLOYMENT.md` | `.env:3`、`.env:7-14`、`docs/14:14-34`、`:36` 同步义务、`:38` |

---

## Pattern Assignments

### §1 配置解析 — `config/database-url.ts`、`config/log-level.ts`

**Analog:** `apps/api/prisma.config.ts`

**要复制的是「顺序 + 单一默认常量 + 为什么不引依赖」这个结构**（`prisma.config.ts:6-16`）：

```ts
// Resolution order:
//   1. DATABASE_URL from the environment (CI, container, exported shell var)
//   2. documented local-dev default (docs/14_ENV_AND_DEPLOYMENT.md)
//
// No `dotenv` dependency: Prisma 7 no longer auto-loads `.env`, and we do not want
// to add a package just for the CLI.
const databaseUrl = process.env.DATABASE_URL ?? 'file:./data/app.db'
```

⚠️ **D-09**：`prisma.config.ts` 是 CLI 侧，运行时必须由代码显式解析后传给 adapter。新文件导出 `resolveDatabaseUrl()`，两处**共用同一常量**，不得各自演化出不同默认值。

**「读不到就返回 null，由调用方决定」的容错形状**（`probe-prisma-engine.mjs:136-142`）：

```js
export function readDecisionFile(decisionPath) {
  try {
    return readFileSync(decisionPath, 'utf8').trim();
  } catch {
    return null;
  }
}
```

`log-level.ts` 读 `/data/options.json` 照此办理：**文件缺失 / JSON 损坏 → `null` → 下一级回落 → `info`**（D-04）。**不要**套用 `generate-app-metadata.mjs:52-56` 的 `fail()`（直接 `process.exit(1)`）—— D-04 要求「非法值降级为 `info` 并留一条 warn」，不是致命错误。

**边界注释**：`/data/options.json` 由 Supervisor 写入，本仓库无生成方（RESEARCH §5.4 / A3）。按 `probe-prisma-engine.mjs:35-45` 的写法把「为什么这样解析」写在函数上方。

---

### §2 脱敏纯函数 — `logging/sanitize.ts`

**Analog:** `scripts/probe-prisma-engine.mjs` 的 `stripComments`（`probe-prisma-engine.mjs:128-134`）

```js
export function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').replace(/\s+$/, ''))
    .join('\n');
}
```

**借的是「无副作用、无 I/O、导出即被测」的纪律**：`sanitize(value)` 必须纯（不读 `process.env`、不读文件、不写 stdout），因为 RESEARCH §5.2 判定它**必须自写**，它独自承担 RT-04 的风险。

**常量提顶 + 测试引用常量**（`probe-prisma-engine.mjs:24-33` / `.test.mjs:9-17`）：

```js
export const NATIVE_ENGINE = 'NATIVE_ENGINE';
export const RUST_FREE = 'RUST_FREE';
const NATIVE_MARKERS = [ (name) => name.endsWith('.node'), ... ];
```

→ 键名黑名单（`authorization`/`token`/`api_key`/`apiKey`/`password`/`secret`/`cookie`）与 `[REDACTED]` 占位串放模块顶部**导出**，测试 import 而非重抄字面量。

签名与算法见 RESEARCH §5.2（深度上限 + `WeakSet` 环检测 + 键名黑名单 + 值正则 `Bearer|Token`），本表不重复。

---

### §3 日志适配器 — `logging/pino-logger.service.ts`

**Analog:** 仓库的**注入式可测**惯例，两处同源：

```js
export function probeBuildx({ spawn = spawnSync } = {}) {     // build-image.mjs:56-60
  const result = spawn('docker', ['buildx', 'version'], { encoding: 'utf8' });
```
```js
export function runLint({ root = process.cwd(), write = () => {} } = {}) {  // lint-workspace.mjs:105
```

**这是本仓库处理「不可测副作用」的唯一既定做法：副作用作为可选参数注入，默认值是真实现。** 适配器照办 —— 构造函数接收 pino 实例（或写入函数），测试注入假实例断言 level 映射与 context 提取，**绝不 spy stdout**（RESEARCH §10）。

外部契约（RESEARCH §5.1，非本仓库代码）：必需 `log`/`error`/`warn`，可选 `debug`/`verbose`/`fatal`/`setLogLevels`。

**注释纪律**：`fatal()` 是同名映射不得丢、`error()` 的尾部字符串参数是 context 不是数据（RESEARCH A7 未核验）—— 按 `Dockerfile:72-79` 的 `VERIFIED LOCALLY` / `NOT VERIFIED` 格式标注哪部分是实测、哪部分是假设。

---

### §4 请求日志中间件 — `logging/request-id.middleware.ts`

**无 analog。** 仓库无任何 Nest middleware/guard/interceptor；`apps/api/src/` 只有 `main.ts` + `app.module.ts`。

**结构先例**：不新造生命周期概念，用 Nest 原生 `NestMiddleware` + `AsyncLocalStorage`（对 Phase 5 认证层、Phase 6 HA 客户端天然透传）。RESEARCH §5.3 已给出「不引入 `pino-http`」的选择，plan 需写明理由。

**必须进注释的两个否定约束**（CONTEXT *Discretion* + D-03）：只记 `method`/`path`/`status`/`durationMs`；**不记 body、不记 query 原文**。

---

### §5 `PrismaService` — `prisma/prisma.service.ts`

**无 analog**（仓库零 provider、零 `OnModuleDestroy`）。三条约束全来自外部事实，逐条进注释：

1. **adapter 强制** —— 引证 `apps/api/src/generated/prisma/internal/prismaNamespace.ts:694-722`（RESEARCH §4.1）。该目录 gitignored，**只引证不引用**。
2. **`file:` 前缀由 adapter 自己剥**（RESEARCH §4.3）—— `DATABASE_URL` 原样透传，**禁止写 `stripFileProtocol()`**（陷阱 §12.1）。
3. **`$disconnect()` 放 `OnModuleDestroy`，禁止手写 `process.on('SIGTERM')`**（RESEARCH §7.1，陷阱 §12.2）。

**构造照 §3 的注入惯例**：

```js
export function probeBuildx({ spawn = spawnSync } = {}) { ... }   // build-image.mjs:56
```

→ `@Injectable()` + `useFactory` 传入 `resolveDatabaseUrl()` 的结果，或构造函数可选参数；**解析结果必须只有一处**（D-09）。

---

### §6 健康检查 — `health/health.controller.ts` + `health/health-checks.ts`

**controller 无 analog**（仓库零 controller）。**check 聚合器有两个强 analog。**

**Analog A — 收集诊断、返回结构化结果、不 fail-fast**（`lint-workspace.mjs:105-125`）：

```js
export function runLint({ root = process.cwd(), write = () => {} } = {}) {
  const files = collectFiles(root);
  const problems = [];
  for (const relativePath of files) {
    const problem = lintFile(root, relativePath);
    if (problem !== null) problems.push({ file: toPosix(relativePath), reason: problem });
  }
  if (problems.length > 0) {
    write(`✗ lint failed (${problems.length} problem${problems.length === 1 ? '' : 's'})`);
    return { ok: false, files, problems };
  }
  write(`✓ lint passed (${files.length} files)`);
  return { ok: true, files, problems };
}
```

这正是 D-08 `checks` 集合需要的形状：**每个 check 独立跑完 → 收集 → 最后统一算整体 `status`**。plan 应把「一个 check 抛错不得吞掉其它 check」写成验收点（对照 `validate-app-metadata.mjs:13-15` 的同一条契约表述）。

**Analog B — `{ok, reason}` 而非 throw**（`probe-prisma-engine.mjs:148-179`）：

```js
export function checkDecision({ root = process.cwd(), schemaPath, decisionPath } = {}) {
  const result = probe({ root, schemaPath: schema });
  if (result.decision === null) {
    return { ok: false, reason: 'generated client dir not found; run prisma generate first', probe: result };
  }
  ...
  return { ok: true, reason: `ok: ${recorded}`, probe: result };
}
```

**`migrations` 判据**（RESEARCH §4.5）：期望迁移数从 `prisma/migrations/*/` 静态数出（镜像已 `COPY prisma`，`Dockerfile:104`），与 `_prisma_migrations.finished_at` 对比；表不存在 → `unknown`。**D-06：不参与状态码。**

**`disk` 判据**（D-11）：`fs.statfsSync` → `bsize * bavail`，纯只读，阈值与 D-10 共用同一常量。overlayfs/bind mount 语义必须进注释（RESEARCH §8.1）。

**controller 结构建议**：`/health/live` 与 `/health/ready` 声明在**同一 controller、集中在文件头部**，使 Phase 5 加免鉴权豁免是一个局部改动（CONTEXT Integration Points）。超时预算按 CONTEXT *Discretion*：单 check 200 ms、整体 1 s，`Promise.race` 超时即该 check `down`。

---

### §7 启动期 fail-fast — `lifecycle/startup-checks.ts`

**Analog:** `scripts/generate-app-metadata.mjs:373-418` 的 `main()` —— **先全量校验、再构造、最后落地**，失败信息点名到具体项。

```js
  // Full source validation first, artifact construction second, disk writes last.
  //
  // Build-then-write is the minimal mitigation for the non-atomic two-file write: if anything
  // below throws, neither artifact has been touched yet.
  assertConsumedKeys('repository', metadata.repository, REPOSITORY_SOURCE_KEYS);
  assertConsumedKeys('app', metadata.app, APP_SOURCE_KEYS);
  ...
  } catch (error) {
    // Fail closed with the generator's normal `Failed: <source>: <msg>` shape, never a raw
    // stack trace: the message has to name the source key the author mistyped.
    fail(SOURCE_PATH, error);
  }
```

**借两条**：① 有序、每步具名（D-10 的 ①②③④）；② 失败信息点名「哪一步 + 哪个路径 + errno」，绝不裸抛 stack（D-12）。

**退出码纪律**（D-12：`78`=`EX_CONFIG`，其余 `1`）。仓库现有两种风格：

| 风格 | 出处 | 适用 |
|---|---|---|
| `process.exitCode = 1`（自然退出） | `probe-prisma-engine.mjs:210`、`lint-workspace.mjs:142`、`generate-app-metadata.mjs:416` | 可跑完再报告 |
| `process.exit(1)`（立刻中止） | `build-image.mjs:88,96,100,109` | 前置条件不满足 |

fail-fast 属第二类，但用 `78`/`1` 区分。⚠️ `process.exit()` 跳过异步 logger flush（与 RESEARCH §7.1 同一个坑）：退出前先同步写 stderr，或 `await logger.flush()`。

---

### §8 优雅关闭 — `lifecycle/shutdown.ts`

**无 analog。** RESEARCH §7.1 是唯一事实来源（Nest 12.3.0 `@nestjs/core/nest-application-context.js:207-263`）：

```js
if (options.useProcessExit) {
  // required for async loggers (like Pino with transports) to flush their buffers
  process.exit(0);
} else {
  process.kill(process.pid, signal);          // default: 重放信号 → code 143
}
```

**必须落进计划的四条**：
- `app.enableShutdownHooks(Object.values(ShutdownSignal), { useProcessExit: true })`
- **不写** `process.on('SIGTERM')`（会与 Nest handler 抢，双重 `$disconnect`）
- 顺序：`shuttingDown=true`（ready 立刻 503 → 先摘流量）→ `server.close()` → 排空 → `$disconnect()` → flush → `exit(0)`
- 预算 8s（`docker stop` 默认 10s 宽限，RESEARCH §7.2），常量提顶并注释来源

---

### §9 测试 — `apps/api/test/*.test.ts`（`node:test` + `--experimental-strip-types`）

**Analog:** `scripts/probe-prisma-engine.test.mjs`（**仓库唯一的 `node:test` 方言**）

**导入与断言风格**（`probe-prisma-engine.test.mjs:1-17`）：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NATIVE_ENGINE, RUST_FREE, checkDecision, isNativeEngineFile, probe } from './probe-prisma-engine.mjs';
```

**临时树 fixture 的写法**（`probe-prisma-engine.test.mjs:27-54`）：`mkdtempSync(path.join(tmpdir(),'hw-probe-'))` + `try/finally rmSync`。`log-level.test.ts` 完全复用（伪造 `/data/options.json`）。

**失败信息必须点名预期与实得**（`:61-68`）：

```js
test('resolves the generator output relative to the schema file, not the repo root', () => {
  withFixture({ generatorOutput: '../src/generated/prisma' }, (root) => {
    assert.equal(
      readGeneratorOutput(path.join(root, SCHEMA_PATH)),
      path.join(root, 'apps/api/src/generated/prisma'),
    );
  });
});
```

**CLI/进程级断言用 `spawnSync` 读 `status`**（`:56-59`、`:220-234`）：

```js
function cli(root) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
```

`shutdown.dist.test.mjs` 把这个 `spawnSync` 换成 `spawn` + `child.kill('SIGTERM')` + 断言 `code === 0` 与日志行序（INV-4）。

**`.ts` 而非 `.mjs` 的唯二差异**（`03-VALIDATION.md:28-35`，已实测）：
- 命令形状 `node --experimental-strip-types --test "test/**/*.test.ts"`（glob，**不能传目录**）
- strip-types **不处理 `emitDecoratorMetadata`** → 依赖装饰器元数据的集成测试必须走 `test/*.dist.test.mjs` 导 `dist/`

**Windows skip 纪律**（RESEARCH §10）：Windows 上 `SIGKILL` 语义不同、`chmod 0555` 无效 → 这些用例标 CI-only 并输出 `SKIPPED`，**SUMMARY 里如实写 SKIPPED，不得写通过**（先例：Phase 2 的 `bash -n`）。

---

### §10 CI shell 断言 — `scripts/ci/assert-image.sh` 改造 + 新 `assert-*.sh`

**Analog:** 同一个文件。

**头部契约块**（`assert-image.sh:15-27`）—— 改 8→9 时必须同步改这里的三处：

```sh
# Eight checks, in order:
#   1. devDependencies absent ...
#   6. the container starts         (startup log line + State.Running == true)
...
# Exit codes: 0 = all checks passed, 1 = at least one failed or a precondition was
# not met. There is no third outcome and no "skipped" exit path: an unrunnable check
# is a failure, because a green run that verified nothing is worse than a red one.
```

**计数框架**（`:45-54`）：

```sh
failures=0
pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1"; failures=$((failures + 1)); }
```

**第 6 条就是第 9 条的模板**（`:192-218`）—— deadline 循环 + 提前 break + 失败时打日志：

```sh
cid=$(docker run -d "$IMAGE")
deadline=$(( $(date +%s) + 90 ))
started=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if docker logs "$cid" 2>&1 | grep -q 'Nest application successfully started'; then
    started=1; break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)" != "true" ]; then break; fi
  sleep 2
done
```

第 9 条照抄这个循环骨架，把 `grep` 换成 `docker exec "$cid" node -e "fetch('http://127.0.0.1:8099/health/live').then(r=>process.exit(r.ok?0:1))"`，**保留 retry**（D-02 明确：原 grep 自带隐式等待，换成探针必须显式重试）。镜像内无 curl/wget。

**收尾**（`:249-254`）改 `all 9 image assertions passed`；**行内 `x/8` 标签共 8 处**（`pass`/`fail` 各半）需全改。

**新脚本 `assert-ready-degraded.sh` / `assert-failfast.sh`** 复用同一 `pass`/`fail`/`trap cleanup EXIT` 骨架（`:56-69` 的 `cid=${cid:-}` 防 `set -u` 自毁写法必须保留）。⚠️ **仓库自己的戒律**（`:11-13`）：「an assertion nobody invokes is a comment with extra steps」—— 新脚本必须在 `.github/workflows/release.yml` 的 `verify-image` job 里被调用（现有调用点 `release.yml:278-281`），否则应写进 plan 的 deferred 而不是凭空加文件。

---

### §11 `watchdog` 落地 — 元数据三步链

**Analog:** 生成器自身，`generate-app-metadata.mjs`。

**源文件**（`homeweave_app/app-metadata.json:23-49`）—— 加 `app.watchdog`，值按 D-13 是**字符串 URL**（不是 `true`）：

```json
    "ingress": true,
    "ingress_port": 8099,
    "options": { "log_level": "info", "ha_url": "" },
```

**四步链，缺一即红**（RESEARCH §9.2）：

1. **`app-metadata.json`** 加 `watchdog`（key 顺序影响 `--check` 零 diff 不变量，`01-PATTERNS.md §4`）
2. **`APP_SOURCE_KEYS`**（`:328-345`）加 `'watchdog'` —— 否则 `assertConsumedKeys`（`:358-371`）直接 fail：

```js
const APP_SOURCE_KEYS = [ 'name', 'slug', 'version', ... 'optionDefs', 'commentedPortsComment', 'commentedPortsBlock' ];
```

3. **`buildConfigYaml()`** 的 `lines` 数组（`:245-261`）插入输出行 —— 这个数组**就是** key 顺序契约：

```js
  const lines = [
    CONFIG_REFERENCE_COMMENT,
    `name: ${scalar(app.name)}`,
    ...
    `ingress: ${scalar(app.ingress)}`,
    `ingress_port: ${scalar(app.ingress_port)}`,
  ];
```

新值走 `scalar()`（`:130-138`）—— URL 含 `:` 与 `/`，**必然**落到 `JSON.stringify(value)` 的双引号分支，这是正确行为，不要为它特判。

4. **`scripts/validate-app-metadata.mjs`** 的 `CONFIG_ALLOWED_KEYS`（`:35-50`）加 `'watchdog'`。**因为 `CONFIG_REQUIRED_KEYS = [...CONFIG_ALLOWED_KEYS]`（`:60`），一处编辑同时生效于 V2（必填，`:167-176`）与 V8（白名单，`:308-318`）** —— 这正是该文件设计的「one deliberate, paired edit」。同时要改 `:52-59` 那段声明 `required == allowed` 的注释（它写着「D-07 excludes boot / watchdog / map」，此刻起不成立）。

5. 跑 `corepack pnpm generate:app` 生成，再 `corepack pnpm check:app` 验零 diff（INV-10）。

**`Dockerfile` 不加 HEALTHCHECK**（D-13）。**不要手改 `config.yaml`**（陷阱 §12.8）。

---

### §12 探针扩展 — `scripts/probe-prisma-engine.mjs`（D-05a）

**Analog:** 文件自身，已有三层结构**原样保留、只加一层**：

| 层 | 现有位置 | 扩展方式 |
|---|---|---|
| 判定常量 | `NATIVE_MARKERS:28-33` | 不变 |
| 目录扫描 | `listFiles:81-92`（递归 `readdirSync`） | **追加** `node_modules` 扫描根 |
| 结论合成 | `probe():105-120` → `checkDecision():148-179` | 新增「预期原生模块清单」对照 |
| CLI | `parseRoot:181-189` + `isCliEntry:191-211` | 不变 |

**关键设计约束（都是现有代码已经建立的，照抄即可）**：

```js
/** All files under `dir`, recursively, as absolute paths. */
export function listFiles(dir) { ... }                    // :81-92 —— 递归器现成，直接复用

if (result.decision === null) {
  return { ok: false, reason: 'generated client dir not found; run prisma generate first', probe: result };
}                                                          // :153-155 ——「找不到」≠「没问题」
```

**「找不到目录不得报绿」是本文件的核心教训**（`:35-45` 注释记录了曾因解析错 base 目录而假绿）。扩展时必须继承同一不变式：`node_modules` 不存在 → fail，不是 pass。

**清单机制**（当前唯一合法条目 `better-sqlite3`，清单外 `.node` 即失败）本质上是 `assertConsumedKeys`（`generate-app-metadata.mjs:358-371`）的同构思想：**双向断言**（列出清单外出现项 + 清单内缺失项）。plan 里应把「清单是常量数组 + 双向断言」写成实现要求，与 `:361-370` 的结构对齐。

**同步义务（D-05a 连带，本阶段硬性交付）**：
- `Dockerfile:44-49` 注释改写（RUST_FREE 只指**查询引擎**，不含 native addon）
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` 相关段落回写
- **不得**在任何文档继续声称镜像「无平台相关二进制」

**测试照 `withFixture`（`.test.mjs:27-54`）**：喂伪造目录树，断言 `node_modules/better-sqlite3/prebuilds/linux-x64.node` 命中、`prisma/generated/**` 不误判（INV-9）。

---

### §13 Dockerfile / 环境变量

**Analog:** `Dockerfile` 自身。

**注释范式（`deliberately absent` 列表）**（`:12-20`）—— `:13-15` 那段「Phase 3 之前没有 HTTP 端点」的前提已消失，按 D-13 改写为「由 Supervisor watchdog 负责」，**保留同一段落形态**：

```dockerfile
# Deliberately absent, with reasons:
#   - no HEALTHCHECK: the API exposes no HTTP endpoint until Phase 3, so a probe
#     would make the container report unhealthy forever (D-7). "It started" is
#     proven by the startup log line in scripts/ci/assert-image.sh instead.
```

**`ENV DATABASE_URL` 的落点**：runtime stage 的 `ENV NODE_ENV=production`（`:91`）之后，与 `:94-97` 的 `/data` 注释同段，理由写在旁边（D-09：容器开箱即用）。

⚠️ **静态门禁会盯这一行**：`validate-dockerfile.mjs:38-39, 297-307` 的 D5 规则禁止 `ARG`/`ENV`/`COPY`/`ADD` 出现 `token|secret|password|private_key|api_key`。`DATABASE_URL` 不含这些词，**通过**；但若有人顺手写 `ENV DATABASE_URL=...?api_key=` 之类会直接红。这是要写进 plan 的一句提醒。

⚠️ **D9 规则与测试必须一起改**：`validate-dockerfile.mjs:356-367` 的 D9 断言「无 HEALTHCHECK」，其消息文本是 `no HEALTHCHECK may be declared yet: the API has no HTTP endpoint until Phase 3 ...`，而 `validate-dockerfile.test.mjs:239-244` **断言了这句原文**：

```js
test('D9: a HEALTHCHECK fails while the API has no HTTP endpoint', () => {
  ...
  assert.match(result.failures.find((f) => f.code === 'D9').message, /no HTTP endpoint until Phase 3/);
});
```

结论：
- **D9 规则本身保留**（D-13 决定不加 HEALTHCHECK），但理由从「暂无端点」改为「Supervisor watchdog 是唯一存活判据，Docker HEALTHCHECK 会形成两套语义」→ 消息文本与 `:357-359` 注释、
- `validate-dockerfile.test.mjs` 的断言正则**三处必须同批改**，否则 `pnpm lint`/`pnpm test` 红。

**`.env.example:3` `APP_PORT=8500` → `PORT=8099`**（RESEARCH §8.3）。⚠️ `docs/14_ENV_AND_DEPLOYMENT.md:16` 有同一行副本，且 `:36` 明写「新增变量必须同步更新本文档和 `.env.example`」→ **两个文件同批改**。`.env.example:7-14` 的 `DATABASE_URL` 注释块已经是三种部署形态的说明，D-09 的兜底值 `file:./data/app.db` 与它一致，无需改动。

---

## Shared Patterns（跨文件横切）

### S-1 依赖精确锁定
`apps/api/package.json:18` 是唯一先例：`"@prisma/client": "7.10.1"`（**无 `^`**），对照 `:15-17` 的 Nest 用 `^`。规则：**Prisma 生态三件套（client / adapter / CLI）严格同版且无 `^`**；`pino`、`better-sqlite3` 同样精确锁（CONTEXT D-01）。`adapter` 必须 `7.10.1`（RESEARCH §2）。

### S-2 零依赖倾向
`scripts/*.mjs` 全部只用 `node:` 内置 + 已存在的 `js-yaml`（`lint-workspace.mjs:10-11`、`build-image.mjs:17-19`、`probe-prisma-engine.mjs:18` 均有明文声明）。应用到本阶段：**不引 `@nestjs/terminus`、不引 `pino-http`、不引 `dotenv`**（RESEARCH §6.1 / §5.3 / `prisma.config.ts:10-11`）。

### S-3 CLI 骨架（新 `.mjs` 脚本照抄）
四个脚本共用同一骨架，`probe-prisma-engine.mjs:181-211` 是最完整的一份：

```js
function parseRoot(argv) {
  const index = argv.indexOf('--root');
  if (index === -1) return process.cwd();
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.length === 0) throw new Error('--root requires a directory argument');
  return path.resolve(value);
}
const isCliEntry = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCliEntry) { ... if (!result.ok) process.exitCode = 1; }
```

`isCliEntry` 守卫是**必须**的：它让同一文件既能被 `import` 进测试，又能当 CLI 跑（`.test.mjs:9-17` 正是靠它 import 纯函数）。

### S-4 失败信息与报告风格
- 每条失败**点名对象 + 预期 + 实得**（`probe:153-166`、`validate-dockerfile:303-307`）
- 收集后统一报告，不 fail-fast（`lint-workspace:114-121`、`validate-app-metadata.mjs:13-15`）
- 输出用 `✓` / `✗` 前缀（`assert-image.sh:47-54`、`lint-workspace:115-123`）
- **禁止裸 stack**：`generate-app-metadata.mjs:404-406` 的注释说明得最清楚

### S-5 注释只写「为什么」+ 标注未验证
`Dockerfile:72-79` 是模板（`VERIFIED LOCALLY: ... NOT VERIFIED: ... Fallback if the first CI run fails here: ...`）。本阶段必须按此标注：`/data` 对 `node` 用户可写（RESEARCH **A2，最大未知风险**）、`fs.statfs` experimental、`LoggerService.error()` 参数语义（A7）、arm64 仅 QEMU 冒烟（不得写「已在 arm64 验证」）。

### S-6 单一来源 / 生成物禁手改
`app-metadata.json` → 生成器 → `config.yaml`+`repository.yaml`（`generate-app-metadata.mjs:1-12`）。任何直接编辑生成物的改动都会被 `--check` 与 `assertConsumedKeys` 挡住。

---

## ⚠️ 回归陷阱：本阶段会**打破**的既有测试（planner 必须排进任务）

| 会红的文件 | 原因 | 必改点 |
|---|---|---|
| `scripts/__tests__/generate-app-metadata.test.mjs:219-243` | 该负例用 `source.app.watchdog = true` 作为「未被消费的键」。`watchdog` 一旦进 `APP_SOURCE_KEYS`，它**变成合法键**，`assertConsumedKeys` 不再 fail → 测试红。而 `makeTempTree`（`:60-82`）复制的是**真实的** `app-metadata.json`，无法靠 fixture 绕开 | 换成真正不存在的键（如 `source.app.watchdogUrl`），保持「键名被点名」的断言 `/app\.<key> is not consumed/` |
| `scripts/__tests__/fixtures.mjs:36-51` | `VALID_CONFIG` 是 `config.yaml` 的镜像基线；`CONFIG_REQUIRED_KEYS` 加上 `watchdog` 后 V2 报 missing | 同步加 `watchdog`，与生成物逐字节一致 |
| `scripts/validate-dockerfile.test.mjs:239-244` | 断言 D9 消息含 `/no HTTP endpoint until Phase 3/` | 与 `validate-dockerfile.mjs:356-367` 的措辞同批改 |
| `scripts/ci/assert-image.sh` 全文件 | 8 处 `x/8` 标签 + 头部 `# Eight checks` + 尾行 `all 8 image assertions passed`（`:15`、`:88,101,115,136,173,185,214,229,244,254`） | 全部 8→9（D-02） |
| `scripts/probe-prisma-engine.test.mjs` | 现有 13 个用例全部假设 `probe()` 只看生成目录；扩到 `node_modules` 后 `withFixture` 需能造 `node_modules` 树 | 新增用例，**不改**老用例的目录布局假设（老 fixture 无 `node_modules` → 必须仍返回 `RUST_FREE`） |
| `docs/14_ENV_AND_DEPLOYMENT.md:16` | `APP_PORT=8500` | 改 `PORT=8099`（与 `.env.example:3` 同批） |

---

## No Analog Found

| File | Role | Data Flow | 建议的结构先例 |
|---|---|---|---|
| `src/health/health.controller.ts` | controller | request-response | 仓库零 controller。用 `runLint()`/`checkDecision()` 的「返回结构化结果」契约定义 controller 的输出，HTTP 层只做映射（D-08 的 `checks` 形状） |
| `src/logging/request-id.middleware.ts` | middleware | request-response | 无先例。按 RESEARCH §5.3 用 `AsyncLocalStorage` + Nest `NestMiddleware`，不引 `pino-http` |
| `src/prisma/prisma.service.ts` | service | CRUD/生命周期 | 无先例。三条约束全部来自外部核验（RESEARCH §4.1/§4.3/§7.1），逐条写注释而非发明模式 |
| `src/lifecycle/shutdown.ts` | hook | event-driven | 无先例。**只用** Nest 12 的 `enableShutdownHooks(..., { useProcessExit: true })`，顺序见 §8 |
| `apps/api/test/health-*.test.ts` | test | request-response | 无先例（首次 `Test.createTestingModule`）。若装饰器元数据不可用，退化到 `spawnSync` + `fetch` 的黑盒集成测试（`probe-prisma-engine.test.mjs:56-59` 的进程外断言风格） |
| `src/logging/sanitize.ts`（算法部分） | utility | transform | 算法无先例，必须自写（RESEARCH §5.2）。**形状**照 `stripComments`（纯函数、导出、常量提顶） |
| `apps/api/test/*.test.ts`（strip-types 路径） | test | — | 仓库只有 `.mjs` 测试。新路径的唯一已实测依据是 `03-VALIDATION.md:28-35`；Wave 0 必须先跑通一个 `sanitize.test.ts` 再铺开 |

---

## Metadata

**Analog 搜索范围：** `apps/api/src`、`apps/api`（root）、`scripts/`（含 `__tests__/`、`ci/`）、`homeweave_app/`、`Dockerfile`、`.env.example`、`docs/`、`.github/workflows/`
**Files scanned：** 21（全部读过实际内容，非 grep 片段）
**Pattern extraction date：** 2026-10-28
**Tracked-source 核验：** 21 个 analog 路径全部 `git ls-files` 命中；`apps/api/src/generated/prisma/**` 与 `dist/` 为 gitignored 生成物，仅作引证未作 analog

---

*Phase: 03-Runtime 运行时骨架*

