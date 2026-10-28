---
phase: 03-runtime
plan: 03-03
status: complete
wave: 2
depends_on: ["03-01"]
---

# Phase 3 Plan 03: 日志脱敏与 requestId 关联 Summary

## 一句话

所有出站日志在离开进程前先过一遍纯函数 `sanitize()`（键名黑名单 + 值模式 + 环/深度防护），每条日志带上经校验的 `requestId`；一条黑盒 E2E 证明请求头里的 `Bearer` 与 cookie 明文永远不会出现在 stdout。

## 交付结构

```
apps/api/src/logging/
  sanitize.ts              227 行  纯函数递归脱敏，无 Nest/pino 依赖
  logger-core.ts           217 行  createLoggerCore(pino, {getRequestId})，无装饰器
  pino-logger.service.ts   ~30 行  @Injectable() 薄包装，转发 7 个方法
  request-context.ts        32 行  AsyncLocalStorage 存 requestId
  request-id.middleware.ts  58 行  校验/生成 x-request-id，写响应头
apps/api/src/app.module.ts         configure() 注册中间件到 '*'
apps/api/src/health/health.controller.ts  加一条 debug 日志（method/path/requestId）
```

## Task Commits

| Task | Commit | 内容 |
|---|---|---|
| 1 | `f319420` | feat(03-03): redact secrets recursively before they reach the log |
| 2 | `2942b68` | refactor(03-03): extract a decorator-free logger core |
| 3 | `42c29df` | feat(03-03): correlate log lines with an x-request-id |
| 4 | `1d81cdd` | test(03-03): prove bearer tokens never reach stdout |

## 验证（本机真实输出）

Windows 11 / PowerShell 7 / Node v22.17.0 / `corepack pnpm@9.15.4`。

| 检查 | 命令 | 结果 |
|---|---|---|
| 构建 | `corepack pnpm --filter @homeweave/api build` | **pass**，exit 0 |
| 类型 | `corepack pnpm --filter @homeweave/api typecheck` | **pass**，exit 0，无输出 |
| 单测（.ts） | `corepack pnpm --filter @homeweave/api test` 前半段 | **pass**，36/36，fail 0 |
| 黑盒（.dist） | 同一命令后半段 | **pass**，5/5，fail 0 |
| 脱敏 E2E | `node --test "apps/api/test/redaction-e2e.dist.test.mjs"` | **pass**，4/4，fail 0 |

单测分布：`sanitize` 13、`logger-core` 9、`database-url` 5、`log-level` 9（= 36）。

脱敏 E2E 的四个用例（真实用例名）：

1. `a bearer token and a cookie value sent to the API never reach stdout`
2. `the response carries a uuid x-request-id and its log line carries the same id`
3. `a well-formed inbound x-request-id is reused, so an upstream trace survives`
4. `a malformed or oversized inbound x-request-id is replaced with a fresh uuid`

## 关键实现决定

### `sanitize()` 为什么不能用 pino 的 `redact`

pino 的 `redact` 只接受**静态路径**（`*.password` 这样的通配也仅限层级），它既不能按值模式匹配（`Bearer xxx`、`sk-…`、JWT），也不能安全处理环引用与超深嵌套。因此脱敏必须是自己的递归函数：`REDACTED='[REDACTED]'`、`MAX_DEPTH=6`、`WeakSet` 记已访问 → `'[Circular]'`、`depth > MAX_DEPTH` → `'[MaxDepth]'`，并且**始终返回新对象、从不改入参**（`JSON.stringify(原对象)` 不变）。

### `logger-core.ts` 无装饰器

核心层刻意不 import 任何 `@nestjs/*`，这样它能被 `node --experimental-strip-types --test` 直接跑，不必先编译。`pino-logger.service.ts` 退化成薄包装，`getRequestId` 以回调注入，单测里喂假 pino 即可断言 `error(msg, stack, ctx)` → `{msg, context, err:{stack}}`。

### requestId 只在形态合法时复用

入站 `x-request-id` 仅当匹配 `/^[A-Za-z0-9-]{8,64}$/` 才沿用，否则 `randomUUID()`。含 `../`、超长、或其他字符的头部一律丢弃并替换 —— 否则上游可以污染日志索引，甚至把路径片段塞进日志结构。响应头**始终**写回最终采用的 id。

### `/health/live` 的最小侵入

E2E 需要一条带 requestId 的日志才能验证关联，而 `/health/live` 原本不打日志。做法是在 live handler 里加**一条** `debug` 级日志（`method`/`path`/`requestId`），响应体保持恰好 `{status:'ok'}` —— 03-01 的 `health-live.dist.test.mjs` 断言 body 键深度等于 `['status']`，该断言仍然通过，说明 SC-1 未被破坏。

## Deviations

1. **Task 1 由上一个中断会话留下草稿。** 首次派发的执行器在网络中断前已写出 `sanitize.ts` / `sanitize.test.ts`（12 个用例通过），续跑时按计划 §Task 1 逐条审计后补齐到 13 个用例并提交（`f319420`）。未重写、未丢弃已工作代码。
2. **`request-context.ts` 在 Task 2 提交里落地，而非 Task 3。** `logger-core.ts` 的默认 `getRequestId` 依赖它，先建才能编译。文件归属计划的 Task 3，提交归属 Task 2 —— 文件与提交的边界不完全对齐，内容无重复。
3. **本 SUMMARY 由编排器补写。** 执行器在第 4 个任务提交后上下文耗尽，未及写 SUMMARY。门禁命令由编排器重跑并记录上表真实输出。

## 遗留

- 仓库根仍有一个未跟踪的 `.tmp-tsprobe/`（中断的执行器留下的 ts 解析探针），不属任何计划的 `files_modified`，未提交；删除需用户批准。
- 本计划未验证真实 HAOS 环境下的日志落盘行为；`/data` 可写性风险仍由 03-05 承担（见 STATE 阻塞项 A2）。
