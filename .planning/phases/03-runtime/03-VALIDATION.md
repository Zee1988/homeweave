---
phase: "03"
slug: "runtime"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: true
created: "2026-10-28"
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> 不变量定义见 `03-RESEARCH.md §13`（INV-1 … INV-10）。

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test`（Node 22 内置，零新增依赖） |
| **Config file** | 无 — `apps/api/tsconfig.json` 的 `include` 仅 `src/**/*.ts`，`test/` 目录天然不被 tsc 摄入，也不污染 `dist/` |
| **Quick run command** | `corepack pnpm@9.15.4 --filter @homeweave/api test` |
| **Full suite command** | `corepack pnpm@9.15.4 test`（= `test:app` + `-r --if-present test`） |
| **Estimated runtime** | quick ~3s / full ~25s |

**执行方式（已实测可行，勿改写成目录参数）：**

- 单元（纯函数，无装饰器）：`node --experimental-strip-types --test "test/**/*.test.ts"`
  - `[VERIFIED: 本地 node v22.17.0 实跑，glob 参数有效；传目录参数会报 "Could not find '.'"]`
- 集成（需 Nest 装饰器元数据）：先 `pnpm --filter @homeweave/api build`，再 `node --test "test/*.dist.test.mjs"` 导入 `dist/`
  - strip-types **不处理 `emitDecoratorMetadata`**，所以装饰器相关测试不能走 strip-types 路径

**接入点：** 只需在 `apps/api/package.json` 增加 `"test": "node --experimental-strip-types --test \"test/**/*.test.ts\""`，根 `test` 脚本的 `-r --if-present test` 会自动拾取，无需改根脚本。

---

## Sampling Rate

- **After every task commit:** `corepack pnpm@9.15.4 --filter @homeweave/api test`
- **After every plan wave:** `corepack pnpm@9.15.4 test`
- **Before `/gsd-verify-work`:** Full suite green + CI-only 容器断言（INV-3/4/7/8）在 CI 结果中为绿
- **Max feedback latency:** 5s

---

## Per-Task Verification Map

> Task ID 由 plan 落地时回填；本表锁定「每个 plan 必须有自动验证」，防止执行期出现不可验证任务。

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *（回填）* | 01 骨架 | 1 | RT-01 | — | `live` 响应体仅 `{status}`，无版本/路径/依赖 | unit | `node --experimental-strip-types --test "test/health-live.test.ts"` | ❌ W0 | ⬜ pending |
| *（回填）* | 02 健康 | 2 | RT-02 | — | `ready` 不因 migrations 泄漏内部路径 | unit+CI | 同上 + `test/health-ready.test.ts` | ❌ W0 | ⬜ pending |
| *（回填）* | 03 日志 | 2 | RT-04 | T-03-01 凭证落日志 | `Authorization`/`cookie`/`token` 递归掩码，含 `Bearer` 值模式 | unit | `node --experimental-strip-types --test "test/sanitize.test.ts"` | ❌ W0 | ⬜ pending |
| *（回填）* | 03 日志 | 2 | RT-04 | — | 每条日志带 `requestId` | unit | `test/logger-adapter.test.ts` | ❌ W0 | ⬜ pending |
| *（回填）* | 04 关闭 | 3 | RT-03 | — | SIGTERM → 8s 内 exit 0，顺序正确 | CI-only | `node --test "test/shutdown.dist.test.mjs"` | ❌ W0 | ⬜ pending |
| *（回填）* | 04 fail-fast | 3 | RT-05 | — | 不可写 DB / 只读目录 / 非法端口 → exit 78 + 单条原因 | CI-only | `bash scripts/ci/assert-failfast.sh` + `node --test "test/startup-exit.dist.test.mjs"` | ❌ W0 | ⬜ pending |
| *（回填）* | 01 探针 | 1 | RT-05 | T-03-02 RUST_FREE 误报 | 探针扫到 `better-sqlite3` 的 `.node` 不再报无原生二进制 | unit | `node --test "scripts/**/*.test.mjs"` | ✅ | ⬜ pending |
| *（回填）* | 01 App | 1 | RT-01 | — | `watchdog` 经生成器产出，`--check` 零 diff | unit | `corepack pnpm@9.15.4 run check:app` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `apps/api/test/` 目录 + 首个 `sanitize.test.ts`（证明 strip-types 路径在 CI 的 Linux runner 上也通）
- [x] `apps/api/package.json` 增加 `"test"` 脚本（现为 `prisma generate && tsc` 后再跑 ts / dist 两轮，自包含，干净检出可直接跑）
- [x] 安装并锁定：`pino@10.x`、`@prisma/adapter-better-sqlite3@7.10.1`、`better-sqlite3@13.x`
- [x] ~~构建期断言 `node_modules/better-sqlite3/prebuilds/linux-<arch>.node` 存在~~ **该假设已被 0.1.1 的构建证伪**：`13.0.3` 没有可用的 linux prebuild，install 脚本回退 `node-gyp rebuild`（release run 40653948207，`gyp ERR! Could not find any Python installation`）。实际做法是 build / prod-deps 阶段装 `python3 make g++`（编译器不进 runtime，D-05b 仍成立），并在 `/prod` 断言 `require('better-sqlite3')` 后建表插查——覆盖 `build/Release/better_sqlite3.node`，与 pnpm 布局无关。
- [x] `scripts/probe-prisma-engine.mjs` 扩展到 `node_modules/**/*.node`，并加对应 `.test.mjs`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | 实测结果（0.1.1） |
|----------|-------------|------------|-------------------|-------------------|
| `/data` 对容器内 `node` 用户可写 | RT-02/RT-05 | Supervisor 挂载权限无法本地复现（RESEARCH A2，**最大未知风险**） | 见 V2：启动日志出现 `startup_ok`，且以 `node` 用户在 `/data` 建删探针文件成功（命令见该节，勿留下探针文件） | ⬜ 待执行 |
| HAOS 上 `ha apps stop` 实际耗时 | RT-03 | 无 HAOS 环境，Windows 宿主无 docker daemon | 见 V5：`time ha apps stop homeweave`，与 8 s 预算和 10 s SIGKILL 宽限对比 | ⬜ 待执行 |
| 关闭期间无 SIGKILL | RT-03 | 需真实 `docker stop` | 见 V5：`docker inspect` 的 `ExitCode` 必须为 0（非 137/143），且日志无 `shutdown_forced` | ⬜ 待执行 |
| `watchdog` 真的触发重启 | RT-01 | 未文档化的探测间隔/阈值 | 见 V6：`docker pause` 让 `/health/live` 失联，记录到 Supervisor 重启的间隔 | ⬜ 待执行 |
| 日志里不出现明文凭证（真实 Supervisor 链路） | RT-04 | 无 HAOS 环境，且该断言需要真实容器日志 | 见 V7：金丝雀请求后 `docker logs \| grep -c` 为 0（掩码函数本身由 `sanitize.test.ts` 覆盖） | ⬜ 待执行 |

---

## 真机执行清单（0.1.1，待执行）

> 前置：HAOS ≥ 2026.10；SSH App 已安装且 **Protection mode 关闭**——否则 `docker` 命令全部不可用，本清单一半步骤跑不了；容器名固定为 `addon_homeweave`。若 CLI 不认 `ha apps`，全文换 `ha addons`。
>
> 定位：CI（run 40654684908）已在 Linux 容器内验过镜像内容、fail-fast 与排空。真机要验的是 Supervisor 的**挂载、信号投递、探活**三条路径，不是把 CI 重跑一遍。

### V1 添加仓库、安装与版本

首次安装必须先把仓库交给 Supervisor，否则商店里没有 HomeWeave Apps。UI 等价路径：设置 → 加载项 → 加载项商店 → 右上角 ⋮ → 仓库 → 粘贴 URL。重复 `add` 会报 already exists，无害，跳过即可。

```bash
ha store add https://github.com/Zee1988/homeweave
ha store reload
ha apps info homeweave | grep -E 'version|state'   # 商店已列出该 App 后再装
ha apps install homeweave
ha apps info homeweave | grep -E 'version|state'
```

预期 `version: 0.1.1`、`state: started`。不是则先看 `ha apps logs homeweave`。

安装拉的是 GHCR 镜像，不在 HA 上编译：`config.yaml` 的 `image` 不带 tag，HA 用 `version` 补成 `ghcr.io/zee1988/homeweave-ha-app:0.1.1`。所以 master 上的代码改动不影响已装实例，只有换版本号才会产生新镜像。仓库结构三项已核对：根目录有 `repository.yaml`；`config.yaml` 仅存在于一级子目录 `homeweave_app/`（根目录不能再放一份，HA 会冲突）；两者都在 git 树里、未被 ignore。匿名拉取能力由 CI 的 `verify-image` 保证——它先 `docker logout` 并清空 credential 再 `docker pull`。

| 现象 | 判读 |
|---|---|
| 商店里没有 HomeWeave Apps 分区 | HA 访问不到 GitHub：`ha supervisor logs \| grep -i -E 'repository\|git'` |
| 安装报 `unauthorized` / `manifest unknown` | GHCR 包被改回 private，去包设置里设为 Public |
| 报 `Dockerfile not found` | 镜像拉取已失败、HA 回退本地构建；`homeweave_app/` 下没有 Dockerfile，根因仍是拉取失败 |

### V2 启动与 `/data` 可写（A）

```bash
ha apps logs homeweave | tail -n 40
docker exec addon_homeweave ls -ld /data
docker exec -u node addon_homeweave sh -c 'touch /data/.probe && rm /data/.probe && echo writable'
```

- 通过：日志出现 `event:"startup_ok"`，`port:8099`、`databasePath:"/data/homeweave.db"`；`/data` 属主为 `node`；第二条打印 `writable`。
- 失败：`event:"startup_failed"` + `reason:"dir_readonly"` → A2 命中，**停下**。不要删 `USER node` 或改 `chown` 绕过，把原始输出留档；需要改的是挂载权限方案。

### V3 健康端点（E）

```bash
docker exec addon_homeweave node -e "fetch('http://127.0.0.1:8099/health/ready').then(r=>r.text().then(t=>console.log(r.status,t)))"
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' addon_homeweave)
curl -s -o /dev/null -w '%{http_code}\n' "http://$IP:8099/health/live"
```

首次安装的预期输出（**`migrations: unknown` 是正确的，别误判**）：

```json
200 {"status":"ok","checks":{"database":{"status":"ok"},"migrations":{"status":"unknown","reason":"table_missing"},"disk":{"status":"ok","freeBytes":...}}}
```

镜像不含 prisma CLI、不跑迁移（D-1），所以库里还没有 `_prisma_migrations` 表；D-06 规定它不参与状态码，因此仍是 200。启动日志会伴随 `startup: migrations unknown - /health/ready will not report migration state` 警告，属预期。

503 时看 `checks` 哪一维异常：`database.status=fail` = 查询失败；`disk.status=low` = 剩余空间 < 10 MiB。第二条预期 `200`；若超时而上一条正常，是网络/绑定问题，watchdog 同样不会工作。

### V4 启动 fail-fast 三例（B）

用 `docker exec` 覆盖环境变量另起进程，不碰运行中的实例、不动 `/data`：

```bash
docker exec -e DATABASE_URL=file:/nonexistent/x.db addon_homeweave node dist/main.js; echo "exit=$?"
docker exec -e DATABASE_URL=file:/proc/hw.db addon_homeweave node dist/main.js; echo "exit=$?"
docker exec -e PORT=abc addon_homeweave node dist/main.js; echo "exit=$?"
```

| 用例 | 预期 reason | 预期退出码 |
|---|---|---|
| 目录不存在 | `dir_missing` | 78 |
| 只读目录（`/proc`） | `dir_readonly` | 78 |
| 非法端口 | `invalid_port` | 78 |

三例都应只打印**一行** JSON（`event:"startup_failed"`），无 Nest 堆栈。出现堆栈或退出码 1 = 异常未被 `toStartupFailure` 归类，是缺陷。

### V5 优雅关闭（C）

```bash
time ha apps stop homeweave
docker inspect -f 'exit={{.State.ExitCode}}' addon_homeweave
docker logs --tail 40 addon_homeweave 2>&1 | tail -n 40
```

四条全中才算通过：

1. `exit=0`——不是 143（`useProcessExit` 未生效），也不是 137（超出 10 s 宽限被 SIGKILL）；
2. `shutdown: stop accepting new requests` **早于** `shutdown: prisma disconnected`；
3. 无 `shutdown_forced` / `budget exceeded`；
4. 耗时 < 10 s（CI 为 96 ms，真机数百毫秒属正常）。

任一条不满足都要捞出完整日志尾部——这四项对应完全不同的根因。

### V6 watchdog（D）

```bash
docker pause addon_homeweave; date +%T
ha supervisor logs | grep -i homeweave | tail -n 20
```

预期若干秒到一分钟内 Supervisor 判定探活失败并重启该 App，**记录间隔**（官方未文档化，实测值即事实）。清理：

```bash
docker unpause addon_homeweave 2>/dev/null; ha apps start homeweave
```

若已被 Supervisor 重启，`pause` 随旧容器消失，`unpause` 报错属正常。

### V7 日志脱敏（F）

先把 `log_level` 调成 `debug` 并重启，然后发一个带金丝雀凭证的请求：

```bash
docker exec addon_homeweave node -e "fetch('http://127.0.0.1:8099/health/live',{headers:{authorization:'Bearer LEAK-CANARY-123',cookie:'session=LEAK-CANARY-123'}}).then(r=>console.log(r.status))"
docker logs --tail 200 addon_homeweave 2>&1 | grep -c 'LEAK-CANARY-123'
```

预期 `0`。≥1 即脱敏失效，优先级高于本阶段其余项。

口径要说清：Phase 3 的访问日志本就不记录请求头，所以 `0` 证明的是「日志链路里不存在明文凭证」，**不等于**「掩码函数在真机上被执行过」——后者由 `test/sanitize.test.ts` 的单元测试覆盖，真机不重复验证。测完把 `log_level` 改回 `info` 并重启。

### V8 options.json（G）

```bash
docker exec addon_homeweave cat /data/options.json
```

预期 `{"log_level":"info","ha_url":""}`（顺序可能不同）。再把 `ha_url` 填任意值、重启、复看——值变化才证明 Supervisor 的 options → `/data/options.json` 链路通。

### V9 Ingress（H）

从侧栏点开 HomeWeave 面板。预期 JSON 404 / `Cannot GET /` 一类响应，**不是** 502、连接被拒或登录页：Phase 3 没有 UI 路由，404 是正确结果；502 说明 ingress → 8099 不通。

### 结果回填

- 本文件 Manual-Only 表的「实测结果」列逐条改 `✅ / ❌` 并写实测数字；
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` 增「0.1.1 真机验证记录」：HAOS 版本、`/data` 属主、stop 耗时、watchdog 间隔。

**禁止**：为让 V2 通过而删 `USER node` 或改 `chown`；重跑同一版本号的 release（tag 不可覆盖，只能发 `0.1.2`）。

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
