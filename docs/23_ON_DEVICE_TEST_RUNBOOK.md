# 23. 0.1.3 真机验收执行手册

> 用途：把本文件**整段**交给一个能 SSH 登录 HAOS 的执行方（人或 AI），它不需要读源码即可独立跑完 0.1.3 的真机验收并回报。
>
> 版本史：0.1.2 的真机验收跑到第 8 步失败（F-1，见 `docs/21` §11.3），本文件已按那次实测修正三处口径——容器名、fail-fast 的 `-u node` 口径、优雅关闭取退出码的方式。
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
| slug / 容器名 | `homeweave` / `app_<hash>_homeweave`（真机实测是 `app_7cbb973f_homeweave`，不要假设成 `addon_homeweave`） |
| 端口 | `8099`（仅容器内，不对外发布） |
| 镜像 | `ghcr.io/zee1988/homeweave-ha-app:0.1.3` |
| 数据目录 | `/data`（Supervisor 挂载到宿主 `.../apps/data/<hash>_homeweave`） |

本版要验的三件事：

1. **`/data` 属主接管**：0.1.1 以 uid 1000 直启，而 Supervisor 挂来的 `/data` 为 `root:root`，全新安装必定 `exit 78 / dir_readonly`。0.1.2 改为 root entrypoint → `chown -R node:node /data` → `exec gosu node`，**服务器进程仍是 uid 1000**。
2. **侧边栏入口**：`ingress_panel: true`，装好后侧边栏直接出现 HomeWeave 面板。
3. **F-1 修复**（0.1.3 新增）：Supervisor 在运行期会以 `root:root 0600` 重写 `/data/options.json`，0.1.2 只在 `/data` 目录本身非 1000 时才递归 chown，导致该文件从此不可读、所有 option 静默失效。0.1.3 把判定改为"树里还有不属于 node 的条目就 chown"，并在应用侧区分 `source: "unreadable"`。**步骤 8 就是这条的验证点。**

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
C=$(docker ps --format '{{.Names}}' | grep -i homeweave | head -n 1)
echo "C=$C"
```

下文所有命令用 `$C` 表示容器名，**不要照抄成 `"$C"`**：Supervisor 实际创建的是 `app_<hash>_homeweave`（真机为 `app_7cbb973f_homeweave`），照抄会全部失败。`$C` 只对当前 shell 会话有效，断开重连后需重新定义。

---

## 3. 步骤 0：镜像可得性（阻塞项，先跑）

GHCR 在部分网络下不可达（0.1.1 实测：某加速器 19 分钟 0 字节）。这步不通过就别往下走，否则失败无法区分是代码问题还是镜像没拉到。

```bash
ha apps info homeweave | grep -E 'version|state|boot'
docker image inspect ghcr.io/zee1988/homeweave-ha-app:0.1.3 --format '{{.Id}} created={{.Created}}'
```

- 第二条能打印镜像 ID → 镜像已在本地，HA 不会再去拉。
- 报 `No such image` → 执行 `timeout 120 docker pull ghcr.io/zee1988/homeweave-ha-app:0.1.3`：
  - 出现持续下载进度 → 等它完成；
  - 120 秒无进度 → **停止并回报"镜像拉取不可达"**，不要换代理、不要手工拼 blob、不要本地构建。后续由人决定（历史可行路径见 `docs/21` §11.1）。

安装或升级：

```bash
ha apps install homeweave   # 首次；已有旧版用：ha apps update homeweave
sleep 20
ha apps info homeweave | grep -E 'version|state|boot'
```

预期 `version: 0.1.3`、`state: started`、`boot: auto`。若 `state: error`，先看 `ha apps logs homeweave` 再决定是否继续 V2。

---

## 4. 用例

顺序即执行顺序。阶段 A–D 无破坏性，阶段 E 会停容器，放最后。

### 阶段 A：`/data` 与启动（V1a、V2）

#### V1a 复现 A2 的初始条件（**本手册最关键的一条**）

0.1.1 的 `exit 78` 只在 `/data` 为 `root:root` 时出现。若此前手工 `chown` 过，直接重启**看不出**修复是否生效。所以先把属主改回 `root:root`，人为复现缺陷前提。

```bash
docker exec "$C" stat -c '%U:%G' /data
docker exec "$C" chown -R root:root /data
docker exec "$C" stat -c '%U:%G' /data
ha apps restart homeweave
sleep 20
docker exec "$C" stat -c '%U:%G' /data
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
docker exec "$C" sh -c 'grep -E "^Uid" /proc/1/status'
docker exec "$C" stat -c '%U:%G %a' /data
docker exec -u node "$C" sh -c 'touch /data/.probe && rm /data/.probe && echo writable'
docker exec "$C" ls -l /data
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
docker exec "$C" node -e "fetch('http://127.0.0.1:8099/health/ready').then(r=>r.text().then(t=>console.log(r.status,t)))"
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$C")
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

用 `docker exec` 另起进程，不影响运行中的实例，也不改 `/data`。

**必须带 `-u node`**：`docker exec` 默认以镜像 `USER`（root）执行，而 root 的 `CAP_DAC_OVERRIDE` 会让 `access(W_OK)` 在 `/proc` 上放行，第二例会变成 `write_failed` 而不是 `dir_readonly`。真实服务器是 uid 1000，只有 `-u node` 才是同一口径（真机已踩到）。

```bash
docker exec -u node -e DATABASE_URL=file:/nonexistent/x.db "$C" node dist/main.js; echo "exit=$?"
docker exec -u node -e DATABASE_URL=file:/proc/hw.db "$C" node dist/main.js; echo "exit=$?"
docker exec -u node -e PORT=abc "$C" node dist/main.js; echo "exit=$?"
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
docker exec "$C" node -e "fetch('http://127.0.0.1:8099/health/live',{headers:{authorization:'Bearer LEAK-CANARY-123',cookie:'session=LEAK-CANARY-123'}}).then(r=>console.log('status',r.status))"
docker logs --tail 300 "$C" 2>&1 | grep -c 'LEAK-CANARY-123'
```

预期：请求 `status 200`；`grep -c` 输出 `0`。

> `grep -c` 无匹配时退出码为 1，属正常；**看输出数字，不看退出码**。

**先确认 debug 真的生效，否则结论是假阴性。** 0.1.2 的真机验收就栽在这里：`grep -c` 得到 `0`，但 `log_level` 根本没被读到，`0` 只是因为日志还在 info 级别。重启后先看启动记录：

```bash
ha apps logs homeweave | grep '\"event\":\"startup_ok\"' | tail -n 1
```

必须是 `"logLevel":"debug"` 且 `"logLevelSource":"options"`。若为 `"info"` + `"fallback"`，说明 `/data/options.json` 没被读到（0.1.2 的 F-1），脱敏这一步的结论作废，标记为"未验证"而不是"通过"。

改选项后 Supervisor **不会**自动重启 App，配置只在下次启动时被读取，所以"改完不生效"先确认重启过。

口径：Phase 3 的访问日志本就不记录请求头，`0` 证明的是"日志链路里不存在明文凭证"，不等于"掩码函数在真机上执行过"（后者由单元测试覆盖）。测完把 `log_level` 改回 `info` 并重启。

#### V8 options.json 链路

```bash
docker exec "$C" cat /data/options.json
```

预期 `{"log_level":"info","ha_url":""}`（键顺序可能不同）。再用 UI 把 `ha_url` 填任意非空值（如 `http://example.local:8123`）→ 重启 → 复看同一命令：`ha_url` 值随之变化即链路通。测完清空 `ha_url` 并重启。

### 阶段 D：Ingress（V9，**人工**）

从 HA 侧边栏点开 **HomeWeave** 面板（0.1.2 起 `ingress_panel: true`）。

判据：返回 JSON 404 或 `Cannot GET /` 一类响应 → ✅。Phase 3 没有 UI 路由，404 是正确结果。

| 实际现象 | 判读 |
|---|---|
| 404 / `Cannot GET /` | ✅ 正确，ingress → 8099 通 |
| 未带 HA 会话直接请求 ingress 路径返回 401 | ✅ 正常，说明已进到 HA 的认证层；502 才是路由不通 |
| 502 / 连接被拒 | ❌ ingress 到容器 8099 不通 |
| 登录页 / HA 自身界面 | ❌ ingress 路由指错 |
| 侧边栏没有 HomeWeave 面板 | ❌ `ingress_panel` 未生效 |

若侧边栏没有面板，先 `ha apps info homeweave | grep -i ingress` 看 ingress 是否启用，再查 UI 缓存（刷新页面 / 重启 Core）。

### 阶段 E：watchdog 与优雅关闭（会停容器，放最后）

#### V6 watchdog（平台观测项，非必做）

目的：观测 Supervisor 的 `watchdog` 探活是否真会重启一个失去响应的 App。`config.yaml` 配的是 `http://[HOST]:[PORT:8099]/health/live`。

**0.1.3 已在真机结案，结论是"该版本永久判健康、不会触发"**，只在升级 Supervisor 后才值得重跑：

| 事实 | 证据 |
|---|---|
| 20 分钟、40 次采样全部一致 | `created=2026-10-29T05:22:24…` 40/40 不变、`status=running` 40/40、`state: started` 40/40 |
| 同期 Supervisor 日志 `watchdog` / `not responding` / `homeweave` → 空 | 无探活失败、无重启意图 |
| 冻结状态下 HTTP 探活必失败 | `curl` 输出 `code=000 t=5.002289`（exit 28 超时） |
| 冻结状态下 TCP 握手仍成功 | `t=0.000717` |

两条通道一对比就解释了全部现象：**该版本的 App watchdog 判的是 TCP connect，不是 HTTP**——`pause` / `STOP` 下内核照样完成三次握手，于是永久判健康。"未触发"既不是 App 缺陷，也不是实验手法问题。

**对产品的含义（必须记住）**：Supervisor watchdog 发现不了"进程活着但不响应"的挂死，`watchdog` URL 的路径部分不参与判定，`/health/live` 写得再准也没用。Phase 4+ 若要真实保障，只能靠 App 内自检（后台定时打自己的 `/health/ready`，连续失败后 `process.exit(1)`），不能指望平台。

注入（**必须用 daemon 侧**）：容器内没有 `kill` 二进制，`docker exec "$C" kill -STOP 1` 报 `executable file not found`；`sh` 内建 `kill -STOP 1` 返回 0 但 PID 1 仍是 `S`，信号没落地。

```bash
docker kill -s STOP "$C"
docker exec "$C" sh -c 'grep -E "^State" /proc/1/status'    # 期望 State: T (stopped)
```

区分实验（可选；冻结状态下同时测两条通道）：

```bash
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$C")
curl -s -o /dev/null -w 'http code=%{http_code} t=%{time_total}\n' --max-time 5 "http://$IP:8099/health/live"
time nc -w 3 "$IP" 8099 </dev/null      # busybox nc，连上即返回；无 nc 可跳过这项
```

预期：`code=000` + 约 5 s 超时；`nc` 几毫秒返回。这与上面的实测一致。

观察（每 30 秒采样，最多 20 分钟）：

```bash
date +%T
for i in $(seq 1 40); do
  sleep 30
  printf '%s ' "$(date +%T)"
  ha apps info homeweave | grep -E '^\s*(state|version):' | tr '\n' ' '
  docker inspect -f ' created={{.Created}} status={{.State.Status}}' "$C" 2>/dev/null || echo ' container=gone'
done
ha supervisor logs --lines 400 | grep -i -E 'watchdog|homeweave|not responding'
```

判据（任一即 ✅，记录注入到触发的秒数）：

1. 循环里 `created=` 或 `status=` 变化，且日志出现探活失败/重启行；
2. 20 分钟无变化 → **⬜ 未观测到（平台侧，不判缺陷）**，附采样输出与日志段。

清理：

```bash
docker kill -s CONT "$C" 2>/dev/null
ha apps restart homeweave
```

> 不要用 `kill -9` / `docker kill -s KILL`：那让容器退出，触发的是 Docker restart policy 而非 watchdog，结论会错。

#### V5 优雅关闭

**退出码和关闭日志都必须在 stop 之前开始监听**：Supervisor 在 stop 完成后会**移除容器**，之后 `docker inspect` 取不到 `.State.ExitCode`、`docker logs` 也一并没了（0.1.2 真机已确认 inspect 返回空）。所以两样都要先挂上监听：

```bash
nohup docker logs -f "$C" > /tmp/stop.log 2>&1 &
nohup docker events --filter 'event=die' \
  --format '{{.Actor.Attributes.name}} exit={{.Actor.Attributes.exitCode}}' > /tmp/die.log 2>&1 &
sleep 1
date +%T
time ha apps stop homeweave
sleep 3

cat /tmp/die.log
grep -E 'shutdown|startup' /tmp/stop.log | tail -n 20
```

`docker logs -f` 会在容器被移除时自行结束，`/tmp/stop.log` 里保留的是完整关闭过程。这是唯一能在容器消失后复盘 shutdown 顺序的办法。

四条全中才算通过：

1. `/tmp/die.log` 里 `exit=0` —— 不是 143（`useProcessExit` 未生效），也不是 137（超出 10 s 宽限被 SIGKILL）；
2. `/tmp/stop.log` 里 `shutdown: stop accepting new requests` **早于** `shutdown: prisma disconnected`；
3. 无 `shutdown_forced` / `shutdown: budget exceeded`；
4. 耗时 < 10 s（CI 为 96 ms；真机数百毫秒正常）。

任一条不满足都要贴完整日志尾部——这四项对应完全不同的根因。

测完恢复：

```bash
ha apps start homeweave
```

---

## 5. 看着像失败、其实正常 / 实测环境坑

| 输出 | 正确判读 |
|---|---|
| `/health/ready` 里 `migrations: {status: unknown, reason: table_missing}` | 正常。镜像不含 prisma CLI、不跑迁移，表由 Phase 4 建；按约定不参与状态码，整体仍 200 |
| `/data/homeweave.db` 是 0 字节，`database: ok` 仍成立 | 正常，但这条 `ok` 很弱：SQLite 把 0 字节文件当空库，健康检查用常量查询、不触碰任何表。**不要**据此认为数据库链路已验证，Phase 4 建表后必须重验 |
| 启动日志 `startup: migrations unknown - /health/ready will not report migration state` | 同上，是刻意打的提醒，不是错误 |
| `ports` 未发布、只能用 ingress 访问 | 正常，`config.yaml` 的既定设计，Phase 5 才有自家认证 |

### 5.1 0.1.3 真机踩到的五个环境坑（都与产品无关）

| 现象 | 原因 | 做法 |
|---|---|---|
| `docker pull` 卡在零速率，但 `ghcr.io` API 秒回 | HAOS 的 Docker daemon 配了 mirror（实测 `d.fashgh.com`），blob 走的镜像源拖死 | 加 `--platform linux/arm64` 重试；实测第三次、约 2m22s 成功。不要中途 `Ctrl-C`，半截 blob 只会更慢 |
| `version_latest` 仍是旧版本 | `ha supervisor reload` / `ha apps reload` **不刷新 App 仓库** | 进仓库目录 `git fetch`，再 `ha refresh-updates`，然后 `ha apps info homeweave` 复查 |
| `ha apps options` 命令不存在 | 该 Supervisor 版本 CLI 未提供 | 走 REST：`POST /addons/<slug>/options`，body 必须是 `{"options":{"log_level":"debug"}}`，裸对象返回 400 |
| `docker cp` 到 Core 容器 `/tmp` 返回 0，文件却不可见 | Core 容器的 `/tmp` 与宿主不是同一层 | 改用 `docker exec -e OPT=...` 直接传参 |
| `/tmp` 残留 `hw_*.log`、`stop.log`、`die.log` | 第 11 步的监听文件 | `rm -f /tmp/hw_*.log /tmp/stop.log /tmp/die.log`；HAOS 上 `rm` 可能触发确认弹窗，一次授权即可 |
| 容器内 `kill -STOP 1` 看起来成功却没效果 | 镜像里没有 `kill` 二进制（报 not found）；`sh` 内建 `kill` 返回 0 但信号不落地，PID1 仍是 `S` | 一律走 daemon 侧 `docker kill -s STOP <name>`，用 `docker exec "$C" sh -c 'grep ^State /proc/1/status'` 的 `State: T` 确认；恢复用 `docker kill -s CONT` |

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
| V6 watchdog | ✅ / ⬜ | 触发间隔秒数；⬜ = 20 分钟未触发（平台侧，不判 App 缺陷） |
| V5 优雅关闭 | ✅ / ❌ | 耗时、`exit=`、日志顺序 |

补充信息必填：HAOS 版本、Supervisor 版本、Core 版本、`/data` 属主、`ha apps stop` 耗时、watchdog 间隔。这几项用于回填 `docs/21` §11.1 与 `03-VALIDATION.md`。

---

## 7. 禁止事项

- 为让 V2 通过而删 `USER node`、去掉 entrypoint 或手工 `chown` 掩盖问题——那不是验证，是把缺陷藏起来。
- 覆盖已发布的镜像或 git tag。`0.1.3` 之后任何修复只能发 `0.1.4`。
- 编辑 `/data` 里的数据库文件、删除 `/data` 目录。
- 用 `docker run` 直接跑镜像替代 Supervisor 安装来"证明"能装——真机要验的正是 Supervisor 的挂载、信号投递、探活三条路径。
