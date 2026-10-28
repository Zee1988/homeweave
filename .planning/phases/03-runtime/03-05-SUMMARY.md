---
phase: 03-runtime
plan: "05"
status: complete
wave: 3
depends_on: ["01", "02", "03", "04"]
requirements: [RT-03, RT-05]
requirements_partial: []
---

# Phase 3 Plan 05: 启动 fail-fast、优雅关闭与镜像断言 8→9 Summary

## 一句话

进程现在对「环境不可用」说 78、对其他故障说 1，对 `SIGTERM` 说「我先停止接收请求、排空、再断开数据库，8 秒内一定自己走完（退出码 0）」；镜像里该有的东西在构建时就断言，运行时行为在 CI 里用真实容器断言。

## 交付结构

```
apps/api/src/lifecycle/shutdown-state.ts          ~40 行  关闭标志（03-04 建立，本计划复用）
apps/api/src/lifecycle/shutdown.service.ts         79 行  关闭开始：翻标志 + 两条可断言日志 + 触发兜底
apps/api/src/lifecycle/startup-checks.ts        ~150 行  建容器前的目录判定 + 四步校验 + 退出码映射
apps/api/src/config/errors.ts                    ~60 行  ConfigError(78) / StartupError(1)，reason 枚举
apps/api/src/main.ts                             ~230 行  78/1 映射、enableShutdownHooks、8s 预算、导出 bootstrap
apps/api/src/prisma/prisma.service.ts            ~50 行  onApplicationShutdown 内 $disconnect + 日志
apps/api/test/startup-errors.test.ts              ~90 行  退出码映射单测（只依赖 errors.ts）
apps/api/test/startup-exit.dist.test.mjs         ~150 行  产物黑盒：78 / 1 / startup_failed 记录
apps/api/test/shutdown.dist.test.mjs             151 行  产物黑盒：顺序 + 退出码 + 兜底 8s
apps/api/test/fixtures/shutdown-harness.cjs       22 行  用 dist 的 bootstrap 启动并投递 SIGTERM 事件
scripts/ci/assert-image.sh                       检查项 8 → 9（新增容器内 /health/live）
scripts/ci/assert-failfast.sh                    110 行  镜像内的 78 断言（CI-only）
scripts/ci/assert-shutdown.sh                    144 行  docker stop 的退出码/顺序/耗时断言（CI-only）
Dockerfile                                       +ENV DATABASE_URL，+prebuild 断言，修正过时注释
```

## Task Commits

| Task | Commit | 内容 |
|---|---|---|
| 1 | `3861d06` | feat(03-05): exit 78 for a bad configuration and 1 for everything else |
| 2 | `74fc72a` | feat(03-05): drain within an 8s budget on SIGTERM |
| 3 | `cb19ab1` | feat(03-05): default DATABASE_URL, assert the sqlite prebuild, document exit codes |
| 4 | `d588185` | test(03-05): assert image liveness as check 9 |
| 5 | `e4e4a98` | test(03-05): assert fail-fast exits and a clean drain in CI |

## 验证（本机真实输出）

| 命令 | 结果 |
|---|---|
| `pnpm --filter @homeweave/api build` | PASS |
| `pnpm run typecheck` | PASS（`✓ typecheck passed (@homeweave/api)`） |
| `pnpm run lint` | PASS（workflow 22 条 / dockerfile 22 条 / 37 个文件） |
| `pnpm run test` | PASS：脚本层 231、api 单测 66、api 产物测试 15（14 pass + 1 skipped，skip 为既有 Windows 平台跳过项） |
| Task 1 automated 检查（dist 含 78、校验在 `listen` 之前） | PASS |
| Task 2 automated 检查（`useProcessExit`、`8000`、`stop accepting new requests`） | PASS |
| Task 3 automated 检查（`ENV DATABASE_URL`、`better-sqlite3/prebuilds`、`USER node` 仍在、无 `ENV PORT`） | PASS |
| Task 4 automated 检查（无 `x/8`、`/9` 出现 9 次、含 `health/live`） | PASS |
| Task 5 automated 检查（两脚本均 `set -euo pipefail`、78、`prisma disconnected`） | PASS |
| 本机手工实测：缺失数据目录 | 退出码 78，`startup_failed` 含 `reason: "dir_missing"` |
| 本机手工实测：`PORT=abc` | 退出码 78，`reason: "invalid_port"` |
| 本机手工实测：可写目录正常启动 | 存活、`/health/live` 200、单条 `startup_ok` |
| `node --test apps/api/test/shutdown.dist.test.mjs` | PASS：正常排空（顺序正确、无 `shutdown_forced`、远低于 8s）；挂起连接场景在 8s 预算处退出、退出码 0、未触发 SIGKILL |
| Dockerfile prebuild 断言三分支本地复跑（present / pnpm 嵌套 / 缺失） | PASS：前两者打印路径后退出 0，缺失分支退出 1 并指出 prebuild 缺失 |

**未运行（明确列出）**：

- `docker build`、`scripts/ci/assert-image.sh`、`assert-failfast.sh`、`assert-shutdown.sh` 全部**未在本机执行**：本机没有 Docker（`docker --version` 不可用）。它们的结论只能来自 CI 的 `verify-image` job。
- `bash -n` 语法检查同样**未运行**：本机没有 bash / WSL。两个新脚本只经人工审查与 automated 字符串断言，未经 shell 解析器验证。
- 真实 `SIGTERM` 投递：Windows 上 `process.kill(pid,'SIGTERM')` 直接终止进程（实测：子进程退出码 1、无任何日志），因此 dist 测试用 `process.emit('SIGTERM','SIGTERM')` 走同一套 Nest 监听器；真实信号路径只由 `assert-shutdown.sh` 在 Linux CI 覆盖。

## 与计划的偏差（及原因）

1. **Prisma 断连放在 `onApplicationShutdown`，不是计划的 `onModuleDestroy`。** 读 `node_modules/@nestjs/core/nest-application-context.js` 的 `runShutdownSequence`，Nest 12.3 实际顺序是 `onModuleDestroy` → `beforeApplicationShutdown` → `dispose()`（关 HTTP server）→ `onApplicationShutdown` → `process.exit(0)`。在 `onModuleDestroy` 断连会在服务器尚未关闭时抽掉连接（在途请求变假 500），日志顺序也会变成「先 disconnected 再停止接收」，正好违反计划自己的顺序契约。
2. **`main.ts` 导出 `bootstrap()` 并加 `require.main === module` 守卫。** 关闭测试必须启动「与容器相同的接线」，在测试里复制一遍 `enableShutdownHooks` + 预算反而无法证明生产路径。
3. **预算写成 `8000` 而非 `8_000`。** `tsc` 会原样保留数字分隔符，计划里的 automated 检查是对 `dist/main.js` grep `8000`，写成 `8_000` 会让该检查失败。源码内已注释原因。
4. **第 9 项检查用 `docker exec` 而非 `docker run`。** `docker run ... node -e fetch` 会覆盖镜像的 CMD，被探测的容器里根本没有服务在监听。
5. **两处过时注释一并修正**：Dockerfile 的 HEALTHCHECK 理由（原文说「Phase 3 之前没有 HTTP 端点」）与 `docs/23` 的「八项检查」。

## 残余风险

- **`/data` 可写性只在 CI 外验证过**：容器以 `USER node` 运行，`/data` 的属主由 `RUN mkdir -p /data && chown node:node /data` 保证；但真实 HAOS 挂载的卷权限未在真机确认过。若 Supervisor 以不同 uid 挂载，表现是启动即 exit 78（`dir_readonly`）——这是可诊断的失败，不是静默错误，但需要真机验证（计划已明确禁止为此删 `USER node`）。
- **兜底预算只在「排空真的卡住」时才会被看到**：本机用「连接后不发数据」复现并通过，但真实客户端行为（长轮询、SSE、极慢上传）与本次复现不同，8s 是否够用取决于实际请求时长分布。
- **两个 CI 脚本从未被执行过**：语法与分支逻辑只能靠 CI 首次运行来确认。若首个 release run 在它们上面失败，优先怀疑脚本自身而非镜像。

## 下一步

- 在真实 HAOS 主机上安装一次 App，确认 `/data` 权限、`docker stop` 的退出码与日志顺序，并把结论写回 `docs/21`。
- 之后按 `docs/11_IMPLEMENTATION_ROADMAP.md` 进入 Phase 4。
