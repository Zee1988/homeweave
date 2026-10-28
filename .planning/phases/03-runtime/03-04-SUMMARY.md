---
phase: 03-runtime
plan: 03-04
status: complete
wave: 2
depends_on: ["03-01"]
requirements_partial: ["RT-02"]
---

# Phase 3 Plan 04: `/health/ready` 三维检查 Summary

## 一句话

`/health/ready` 用三个可独立归因的检查（database / migrations / disk）回答"这个进程现在能不能真正服务"，不就绪时返回 503 并指出是哪一维坏了；`/health/live` 保持只有 `{status:'ok'}` 不变。

## 交付结构

```
apps/api/src/health/checks/migrations.check.ts  143 行  读目录 + 查 _prisma_migrations，缺表/缺目录返回 null
apps/api/src/health/checks/database.check.ts    195 行  连接 + 一次轻量查询
apps/api/src/health/checks/disk.check.ts         84 行  statfs bsize*bavail，区分 dir_missing / not_writable / low
apps/api/src/health/health-checks.ts            136 行  聚合 + 状态码判定
apps/api/src/health/health.controller.ts        +94 行  GET /health/ready
apps/api/src/health/health.module.ts             +72 行  装配
apps/api/src/lifecycle/shutdown-state.ts         31 行  与 03-05 共享的关闭标志
apps/api/test/migrations-check.test.ts          143 行
apps/api/test/disk-check.test.ts                301 行
apps/api/test/health-ready.dist.test.mjs        257 行  黑盒 A/B/C/D/E 五场景
```

## Task Commits

| Task | Commit | 内容 |
|---|---|---|
| 1 | `7c266a9` | feat(03-04): compare migrations without a prisma CLI |
| 2 | `721ed76` | feat(03-04): split writable-dir and free-space failures apart |
| 3 | `e082fac` | feat(03-04): answer /health/ready with an actionable 503 |
| 4 | `c4d906d` | test(03-04): prove a fresh volume is ready and a full disk is not |

## 验证（本机真实输出）

Windows 11 / PowerShell 7 / Node v22.17.0 / `corepack pnpm@9.15.4`。

| 检查 | 命令 | 结果 |
|---|---|---|
| 构建 | `corepack pnpm --filter @homeweave/api build` | **pass**，exit 0 |
| 类型 | `corepack pnpm --filter @homeweave/api typecheck` | **pass**，exit 0 |
| 单测（.ts） | `corepack pnpm --filter @homeweave/api test` 前半段 | **pass**，60/60，fail 0 |
| 黑盒（.dist） | 同一命令后半段 | **pass**，10 个用例：9 pass / 0 fail / **1 skipped** |
| ready 黑盒 | `node --test "apps/api/test/health-ready.dist.test.mjs"` | **pass**，4 pass / 0 fail / 1 skipped |

单测从 03-03 的 36 增至 60（+24：`migrations-check` 与 `disk-check`）。

ready 黑盒的五个场景（真实用例名与结果）：

| 场景 | 用例名 | 结果 |
|---|---|---|
| A | A: a fresh volume is ready, and migrations:unknown does not gate it (D-06) | pass |
| B | B: a migrated database reports migrations:ok | pass |
| C | C: a read-only data directory answers 503 without leaking the host | **SKIPPED**（"chmod 0555 does not restrict writes on win32 — unverified here, tracked as 03-VALIDATION.md A2"） |
| D | D: a volume below DISK_MIN_FREE_BYTES answers 503 with the disk dimension blamed | pass |
| E | E: the status-code decision never consults migrations (D-06) | pass |

场景 C 在 Windows 上 `chmod` 对目录不生效，测试主动 `skip` 并打印原因，**不计为通过**。真实只读卷下的 503 行为仍未在 Linux 上验证。

## 关键实现决定

### D-06：migrations 只做诊断，不参与状态码

空的 `/data` 卷上 `_prisma_migrations` 表不存在，如果 migrations 参与就绪判定，一个健康的新装实例会永远 503。所以 `runChecks()` 的 200/503 判定只看 `database` 与 `disk`；`migrations` 作为字段返回，值为 `ok` / `pending:n` / `unknown`。

代价是**空库场景下 `status:'degraded'` 永远不会出现**，运维可观察性偏弱。这一点未在本计划补偿 —— 按 D-06，真正的迁移诊断靠 03-05 启动日志里的一行 `migrations: unknown` 警告，且 **RT-02 只是部分交付，不得宣称 SC-2 完整覆盖**。场景 A 与场景 E 是对这个口径的回归锁：A 证明空库仍是 200，E 断言判定表达式不引用 migrations。

### disk 检查必须能分辨三种坏法

一个笼统的 `catch` 会把"目录不存在"、"目录不可写"、"空间不足"糊成同一条 503，运维拿不到可执行的下一步。`disk.check.ts` 因此分开返回 `dir_missing` / `not_writable` / `low`，可用空间用 `statfs` 的 `bsize * bavail` 计算（单测锁定了这个乘法，因为 `bavail` 与 `bfree` 在预留块语义上不同，用错会在接近满盘时误报）。阈值由 `DISK_MIN_FREE_BYTES` 控制。

### `shutdown-state.ts`：与 03-05 的显式接缝

`/health/ready` 需要在开始关闭时立刻停止宣称就绪，否则 Supervisor 会继续把流量路由给一个马上要停止监听的进程。这个标志放在独立模块里，**不是 `@Global()`**：只有 03-04 与 03-05 两个模块需要它，做成隐式全局容易在某处再 provide 一次而出现第二个实例。

**给 03-05 的约束**：SIGTERM 处理器顶部调用 `ShutdownState.beginShutdown()`，不要在 03-05 里重新定义第二个关闭标志。

## Deviations

1. **`apps/api/src/lifecycle/shutdown-state.ts` 不在本计划的 `files_modified` 里。** 计划把关闭标志留给 03-05，但 ready 的语义需要它（见上）。新增文件而非把标志塞进 `health-checks.ts`，是为了让 03-05 能复用而不反向依赖 health 模块。文件内注释写明了这个理由。
2. **`health.controller.ts` 在 Task 3 与 Task 4 都被改。** Task 4 的黑盒测试暴露了 503 body 里带绝对路径的问题，修复并入 Task 3 的提交（`e082fac`），未单独拆提交。
3. **场景 C 无法在本机验证。** 见验证表；这是平台限制，不是实现缺陷，已与 03-VALIDATION.md 的 A2 记录对齐。
4. **执行器上下文耗尽。** 前三个任务提交后中断，Task 4 的测试文件已写但未提交；由编排器验证（4 pass / 1 skip）后提交并补写本 SUMMARY。

## 已知残余风险

- 空库永远 `ready`，缺迁移的新版本也能通过就绪检查 —— 这是 D-06 的自觉取舍，靠启动日志告警补偿（03-05）。
- 只读卷下的 503 路径未在 Linux/CI 验证（场景 C 在 win32 skip）。
- `apps/api/.tmp/` 是 gitignored 的测试残留，场景 B 在测试内复制到 `os.tmpdir()`，不要把 `.tmp/verify.db` 当 fixture 提交。
