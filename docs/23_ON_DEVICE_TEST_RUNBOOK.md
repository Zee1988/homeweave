# 23. 0.1.2 真机验收执行手册

> 用途：把本文件**整段**交给一个能 SSH 登录 HAOS 的执行方（人或 AI），它不需要读源码即可独立跑完 0.1.2 的真机验收并回报。
> 上游契约：`docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §11；用例来源 `.planning/phases/03-runtime/03-VALIDATION.md`。

---

## 0. 交给执行方的指令

把下面这段连同本文件其余部分一起发给执行方：

```
你的任务：在一台 Home Assistant OS 设备上执行本文件的验收用例，并回报结果。

约束：
1. 按 §4 标注的顺序执行，不要跳项、不要重排。
2. 每条命令都保留原始输出，不要只说"通过"；回报时贴关键行。
3. 你是验证者，不是修复者。任何用例失败，立刻停止后续用例并回报。
   不要改代码、不要改 Dockerfile、不要重建镜像、不要发布新版本、不要删除 /data。
4. §5 列了三条"看起来像失败但属正常"的输出，不要误判。
5. 只用本文件给出的命令。标了"人工"的项目由人操作，AI 不要猜 UI 结果。
6. 最终按 §6 模板回报。
```

---

## 1. 被测对象

| 项 | 值 |
|---|---|
| App | HomeWeave（HA OS App / add-on） |
| slug / 容器名 | `homeweave` / `addon_homeweave` |
| 端口 | `8099`（仅容器内，不对外发布） |
| 镜像 | `ghcr.io/zee1988/homeweave-ha-app:0.1.2` |
| 数据目录 | `/data`（Supervisor 挂载到宿主 `.../apps/data/<hash>_homeweave`） |

本版要验的两件 0.1.1 缺陷修复：

1. **`/data` 属主接管**：0.1.1 以 uid 1000 直启，而 Supervisor 挂来的 `/data` 为 `root:root`，全新安装必定 `exit 78 / dir_readonly`。0.1.2 改为 root entrypoint → `chown -R node:node /data` → `exec gosu node`，**服务器进程仍是 uid 1000**。
2. **侧边栏入口**：`ingress_panel: true`，装好后侧边栏直接出现 HomeWeave 面板。

不在本次范围：UI 功能（Phase 5）、数据库建表与迁移（Phase 4）、对外端口（`ports` 故意关闭）。

---

## 2. 环境前提（人工确认）

| 前提 | 检查 | 不满足的后果 |
|---|---|---|
| HAOS ≥ 2026.10 | `ha core info \| grep version` | — |
| SSH App 已装且 **Protection mode 关闭** | `docker ps` 能出结果 | 所有 `docker` 命令报权限错误 |
| 有 `ha` CLI | `ha --version` | 改用 UI 等价操作 |

> CLI 差异：若 `ha apps` 不被识别，全文**整体**替换为 `ha addons`，不要混用。

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i homeweave
```

若打印的不是 `addon_homeweave`，后续命令里的容器名要相应替换。

---

## 3. 步骤 0：镜像可得性（阻塞项，先跑）

GHCR 在部分网络下不可达（0.1.1 实测：某加速器 19 分钟 0 字节）。这步不通过就别往下走，否则失败无法区分是代码问题还是镜像没拉到。

```bash
ha apps info homeweave | grep -E 'version|state|boot'
docker image inspect ghcr.io/zee1988/homeweave-ha-app:0.1.2 --format '{{.Id}} created={{.Created}}'
```

- 第二条能打印镜像 ID → 镜像已在本地，HA 不会再去拉。
- 报 `No such image` → 执行 `timeout 120 docker pull ghcr.io/zee1988/homeweave-ha-app:0.1.2`：
  - 出现持续下载进度 → 等它完成；
  - 120 秒无进度 → **停止并回报"镜像拉取不可达"**，不要换代理、不要手工拼 blob、不要本地构建。后续由人决定（历史可行路径见 `docs/21` §11.1）。

安装或升级：

```bash
ha apps install homeweave   # 首次；已有旧版用：ha apps update homeweave
sleep 20
ha apps info homeweave | grep -E 'version|state|boot'
```

预期 `version: 0.1.2`、`state: started`、`boot: auto`。若 `state: error`，先看 `ha apps logs homeweave` 再决定是否继续 V2。

---

## 4. 用例

顺序即执行顺序。阶段 A–D 无破坏性，阶段 E 会停容器，放最后。

### 阶段 A：`/data` 与启动（V1a、V2）

#### V1a 复现 A2 的初始条件（**本手册最关键的一条**）

0.1.1 的 `exit 78` 只在 `/data` 为 `root:root` 时出现。若此前手工 `chown` 过，直接重启**看不出**修复是否生效。所以先把属主改回 `root:root`，人为复现缺陷前提。

```bash
docker exec addon_homeweave stat -c '%U:%G' /data
docker exec addon_homeweave chown -R root:root /data
docker exec addon_homeweave stat -c '%U:%G' /data
ha apps restart homeweave
sleep 20
docker exec addon_homeweave stat -c '%U:%G' /data
ha apps info homeweave | grep -E 'version|state'
```

三条全中才算通过：

| # | 预期 | 含义 |
|---|---|---|
| 1 | 第二条 `chown` 后显示 `root:root` | 已复现 0.1.1 的缺陷前提 |
| 2 | 重启后显示 `node:node` | entrypoint 的 `chown` 真的执行了 |
| 3 | `state: started`，日志无 `startup_failed` | 该前提不再导致 78 退出 |

任一条不符 → 停止并回报原始输出。**不要**手工 `chown` 回去"修好"，那样就失去验证意义。

#### V2 运行时身份与 `/data` 可写

`docker exec` 默认以镜像 `USER`（root）执行，所以 `docker exec id -u` **恒为 0，不能用来判断降权**；必须读 PID 1。

```bash
docker exec addon_homeweave sh -c 'grep -E "^Uid" /proc/1/status'
docker exec addon_homeweave stat -c '%U:%G %a' /data
docker exec -u node addon_homeweave sh -c 'touch /data/.probe && rm /data/.probe && echo writable'
docker exec addon_homeweave ls -l /data
ha apps logs homeweave | tail -n 40
```

判据：

- `Uid: 1000 1000 1000 1000`（四个数全为 1000；出现 `0` 即降权失效，最高优先级缺陷）；
- `/data` 属主 `node:node`；
- 第三条打印 `writable`；
- `/data` 下有 `homeweave.db`；
- 日志出现 `"event":"startup_ok"`，含 `"port":8099`、`"databasePath":"/data/homeweave.db"`。

失败形态对照：

| 日志现象 | 含义 |
|---|---|
| `"reason":"dir_readonly"` | entrypoint 的 `chown` 未生效，A2 未修复 |
| `"reason":"dir_missing"` | `/data` 没挂上，挂载配置问题 |
| `Uid: 0 0 0 0` 但能启动 | entrypoint 没 `exec gosu`，降权失效 |

### 阶段 B：健康端点（V3）

```bash
docker exec addon_homeweave node -e "fetch('http://127.0.0.1:8099/health/ready').then(r=>r.text().then(t=>console.log(r.status,t)))"
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' addon_homeweave)
curl -s -o /dev/null -w '%{http_code}\n' "http://$IP:8099/health/live"
```

预期（首次安装就是这个，**不要误判成失败**）：

```
200 {"status":"ok","checks":{"database":{"status":"ok"},"migrations":{"status":"unknown","reason":"table_missing"},"disk":{"status":"ok","freeBytes":...}}}
200
```

- 镜像不含 prisma CLI、不跑迁移，库里没有 `_prisma_migrations` 表 → `migrations: unknown`，按约定不参与状态码，**仍应为 200**；启动日志随之有一条 `startup: migrations unknown - ...` 警告，也属预期。
- 若 503：`database.status=fail` = 查询失败；`disk.status=low`（`freeBytes` < 10 MiB）= 空间不足。
- 若第一条通、第二条超时 → 绑定或网络问题，watchdog 同样不会工作，记 ❌ 后继续。

### 阶段 C：fail-fast 与配置链路（V4、V7、V8）

#### V4 启动 fail-fast 三例

用 `docker exec` 另起进程，不影响运行中的实例，也不改 `/data`：

```bash
docker exec -e DATABASE_URL=file:/nonexistent/x.db addon_homeweave node dist/main.js; echo "exit=$?"
docker exec -e DATABASE_URL=file:/proc/hw.db addon_homeweave node dist/main.js; echo "exit=$?"
docker exec -e PORT=abc addon_homeweave node dist/main.js; echo "exit=$?"
```

| 用例 | 预期 `reason` | 预期退出码 |
|---|---|---|
| 目录不存在 | `dir_missing` | `exit=78` |
| 只读目录（`/proc`） | `dir_readonly` | `exit=78` |
| 非法端口 | `invalid_port` | `exit=78` |

预期输出形如（字段顺序可能不同）：

```json
{"level":"error","time":"...","service":"homeweave-api","event":"startup_failed","reason":"dir_missing","exitCode":78,"msg":"data directory /nonexistent does not exist"}
```

判据：三例**各只打印一行** JSON，无堆栈，退出码 78。出现堆栈或 `exit=1` → ❌（异常未被归类，是缺陷）。

> `PORT=abc` 的失败发生在端口绑定之前，不会与已在跑的 8099 冲突，这是预期。

#### V7 日志脱敏（需临时把 `log_level` 改 `debug`）

配置改法（优先 UI）：设置 → 加载项 → HomeWeave → 配置 → `log_level` = `debug` → 保存 → 重启。
CLI 备用（语法随版本变化，报错就用 UI）：`ha apps options homeweave --log_level=debug` 后 `ha apps restart homeweave`。

```bash
docker exec addon_homeweave node -e "fetch('http://127.0.0.1:8099/health/live',{headers:{authorization:'Bearer LEAK-CANARY-123',cookie:'session=LEAK-CANARY-123'}}).then(r=>console.log('status',r.status))"
docker logs --tail 300 addon_homeweave 2>&1 | grep -c 'LEAK-CANARY-123'
```

预期：请求 `status 200`；`grep -c` 输出 `0`。

> `grep -c` 无匹配时退出码为 1，属正常；**看输出数字，不看退出码**。

口径：Phase 3 的访问日志本就不记录请求头，`0` 证明的是"日志链路里不存在明文凭证"，不等于"掩码函数在真机上执行过"（后者由单元测试覆盖）。测完把 `log_level` 改回 `info` 并重启。

#### V8 options.json 链路

```bash
docker exec addon_homeweave cat /data/options.json
```

预期 `{"log_level":"info","ha_url":""}`（键顺序可能不同）。再用 UI 把 `ha_url` 填任意非空值（如 `http://example.local:8123`）→ 重启 → 复看同一命令：`ha_url` 值随之变化即链路通。测完清空 `ha_url` 并重启。

### 阶段 D：Ingress（V9，**人工**）

从 HA 侧边栏点开 **HomeWeave** 面板（0.1.2 起 `ingress_panel: true`）。

判据：返回 JSON 404 或 `Cannot GET /` 一类响应 → ✅。Phase 3 没有 UI 路由，404 是正确结果。

| 实际现象 | 判读 |
|---|---|
| 404 / `Cannot GET /` | ✅ 正确，ingress → 8099 通 |
| 502 / 连接被拒 | ❌ ingress 到容器 8099 不通 |
| 登录页 / HA 自身界面 | ❌ ingress 路由指错 |
| 侧边栏没有 HomeWeave 面板 | ❌ `ingress_panel` 未生效 |

若侧边栏没有面板，先 `ha apps info homeweave | grep -i ingress` 看 ingress 是否启用，再查 UI 缓存（刷新页面 / 重启 Core）。

### 阶段 E：watchdog 与优雅关闭（会停容器，放最后）

#### V6 watchdog

目的：确认 `config.yaml` 的 `watchdog` URL 真的会让 Supervisor 重启一个失去响应的 App，并记录实测间隔（官方未文档化，实测值即事实）。

```bash
date +%T
docker pause addon_homeweave
sleep 90
ha supervisor logs --lines 200 | grep -i homeweave
date +%T
```

判据：90 秒内 Supervisor 日志出现探活失败/重启意图 → ✅，记录从 `pause` 到该日志的秒数。90 秒内无任何相关日志 → 记 ❌（未触发），仍要贴日志。

清理（`pause` 中的容器无法被正常 stop，Supervisor 重启可能失败）：

```bash
docker unpause addon_homeweave 2>/dev/null
ha apps restart homeweave
```

> 若已被 Supervisor 重启，`pause` 随旧容器消失，`unpause` 报错属正常，直接 `ha apps restart`。

#### V5 优雅关闭

```bash
date +%T
time ha apps stop homeweave
docker inspect -f 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' addon_homeweave
docker logs --tail 60 addon_homeweave 2>&1 | tail -n 60
```

四条全中才算通过：

1. `exit=0` —— 不是 143（`useProcessExit` 未生效），也不是 137（超出 10 s 宽限被 SIGKILL）；
2. 日志里 `shutdown: stop accepting new requests` **早于** `shutdown: prisma disconnected`；
3. 无 `shutdown_forced` / `shutdown: budget exceeded`；
4. 耗时 < 10 s（CI 为 96 ms；真机数百毫秒正常）。

任一条不满足都要贴完整日志尾部——这四项对应完全不同的根因。

测完恢复：

```bash
ha apps start homeweave
```

---

## 5. 三条"看着像失败、其实正常"的输出

| 输出 | 正确判读 |
|---|---|
| `/health/ready` 里 `migrations: {status: unknown, reason: table_missing}` | 正常。镜像不含 prisma CLI、不跑迁移，表由 Phase 4 建；按约定不参与状态码，整体仍 200 |
| 启动日志 `startup: migrations unknown - /health/ready will not report migration state` | 同上，是刻意打的提醒，不是错误 |
| `ports` 未发布、只能用 ingress 访问 | 正常，`config.yaml` 的既定设计，Phase 5 才有自家认证 |

---

## 6. 回报模板

先贴这张总表，再按需贴原始输出。

| 用例 | 结果 | 实测值 / 原始输出关键行 |
|---|---|---|
| 步骤 0 镜像 | ✅ / ❌ | version=…, state=…, 镜像 ID=… |
| V1a 属主接管 | ✅ / ❌ | `root:root` → `node:node`；state |
| V2 身份与可写 | ✅ / ❌ | `Uid: …`；`/data` 属主；`writable` |
| V3 ready / live | ✅ / ❌ | HTTP 码 + `checks` 摘要 |
| V4 fail-fast ×3 | ✅ / ❌ | 三个 reason + 三个 exit 码 |
| V7 脱敏 | ✅ / ❌ | `grep -c` 的数字 |
| V8 options.json | ✅ / ❌ | 改前/改后的 `ha_url` |
| V9 ingress | ✅ / ❌ | 实际响应（人工填） |
| V6 watchdog | ✅ / ❌ | 触发间隔秒数 / 未触发 |
| V5 优雅关闭 | ✅ / ❌ | 耗时、`exit=`、日志顺序 |

补充信息必填：HAOS 版本、Supervisor 版本、Core 版本、`/data` 属主、`ha apps stop` 耗时、watchdog 间隔。这几项用于回填 `docs/21` §11.1 与 `03-VALIDATION.md`。

---

## 7. 禁止事项

- 为让 V2 通过而删 `USER node`、去掉 entrypoint 或手工 `chown` 掩盖问题——那不是验证，是把缺陷藏起来。
- 覆盖已发布的镜像或 git tag。`0.1.2` 之后任何修复只能发 `0.1.3`。
- 编辑 `/data` 里的数据库文件、删除 `/data` 目录。
- 用 `docker run` 直接跑镜像替代 Supervisor 安装来"证明"能装——真机要验的正是 Supervisor 的挂载、信号投递、探活三条路径。
