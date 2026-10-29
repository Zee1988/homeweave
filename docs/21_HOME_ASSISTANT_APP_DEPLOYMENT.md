# 21 — Home Assistant App 部署架构（首选自托管方式）

## 1. 决策摘要

HomeWeave 的首选家庭自托管安装方式是 **Home Assistant App**（旧称 Add-on），通过 Home Assistant Supervisor 安装、启动、停止、重启和升级后端。该方式适用于 **Home Assistant OS** 用户；Home Assistant Container 没有 Supervisor Apps 商店，应继续提供 Docker Compose 作为替代部署方式。

部署体验目标：用户把 HomeWeave 的 App 仓库添加到 Home Assistant，在 Apps 页面点击安装即可。用户不应需要 SSH 登录 HA 主机、手工安装 Node.js、手工执行 Docker 命令或在设备上编译整个后端。

**重要区别：** 用户添加的是包含 `repository.yaml` 的 Git 仓库；Supervisor 根据 App 的 `config.yaml` 找到应用，并拉取开发者预先构建发布的容器镜像。Git 仓库并不是直接作为运行时源代码执行。生产发布应采用 GitHub Actions + GitHub Container Registry（GHCR）的预构建多架构镜像。

## 2. 部署拓扑

```text
GitHub source repository
  ├── apps/api (NestJS)
  ├── apps/mobile (Expo Universal App)
  ├── homeweave_app/config.yaml
  ├── homeweave_app/Dockerfile
  ├── repository.yaml
  └── .github/workflows/publish-ha-app.yml
                 │
                 ▼
GitHub Actions: test → build amd64/aarch64 → publish manifest
                 │
                 ▼
GHCR: ghcr.io/<owner>/homeweave-ha-app:<version>
                 │
                 ▼
Home Assistant OS / Supervisor
  └── HomeWeave App container
       ├── NestJS API + task orchestrator
       ├── Ingress web UI (optional, when web bundle is included)
       ├── /data persistent storage (SQLite, app data)
       └── Home Assistant API proxy integration
```

原生 iOS / Android App 仍由 Expo/EAS 或支持的本地原生工具链构建发布，不放入 HA App 容器。Web 目标可以由 `apps/mobile` 通过 React Native Web 导出，并在 HA App 内由后端或轻量静态服务器提供；若启用 Ingress，必须支持动态子路径，不能假定应用总是部署在 `/`。

## 3. 支持范围

- **主要目标：Home Assistant OS**，使用 Settings → Apps 管理 App。
- **替代目标：Home Assistant Container**，使用 Docker Compose 自行部署；不要声称 Container 安装有 Apps 商店。
- 不把 NestJS 后端实现成 Python 自定义集成。自定义集成是 Core 内的 Python 集成机制，不是运行 Node.js 服务的容器机制。
- 具体最低 Home Assistant / Supervisor 版本应在 CI 和真实设备测试后确定并写入 `DOCS.md`；不得凭空宣称支持所有版本。

## 4. 仓库布局

```text
homeweave/
├── repository.yaml
├── homeweave_app/
│   ├── config.yaml
│   ├── Dockerfile
│   ├── DOCS.md
│   ├── README.md
│   ├── CHANGELOG.md
│   ├── apparmor.txt              # 按实际权限设计生成
│   ├── rootfs/                   # 仅在确需启动脚本/S6 服务时使用
│   └── icon.png / logo.png
├── apps/api/                     # NestJS API
├── apps/mobile/                  # Expo Universal App
├── packages/*
└── .github/workflows/publish-ha-app.yml
```

仓库根目录只能有一个用于仓库识别的 `repository.yaml`。避免把普通文档命名为 `config.yaml`，因为 Supervisor 会递归查找 App 配置文件。示例文件使用 `.example` 后缀，防止规格文档本身被误当作可安装仓库。

## 5. Home Assistant App 元数据

`repository.yaml` 示例：

```yaml
name: HomeWeave Apps
url: https://github.com/<owner>/<repo>
maintainer: <maintainer name or contact>
```

`homeweave_app/config.yaml` 核心字段示例（最终值必须在实现和测试后确定）：

```yaml
name: HomeWeave
slug: homeweave
version: "0.1.0"
description: AI Home Operating System for Home Assistant
url: https://github.com/<owner>/<repo>/tree/main/homeweave_app
arch:
  - amd64
  - aarch64
init: false
image: ghcr.io/<owner>/homeweave-ha-app
homeassistant_api: true
ingress: true
ingress_port: 8099
# ports:
#   8124/tcp: 8124
```

注意：
- `image` 指向 GHCR 多架构镜像的通用名称，不包含版本标签；Supervisor 使用 `version` 选择匹配的镜像标签。
- 先发布镜像 `<version>`，再提交包含相同 `version` 的 `config.yaml`。不要复用已发布的版本标签。
- `homeassistant_api: true` 会提供 Supervisor 的 Home Assistant API 访问能力；其令牌可执行高权限操作，必须只留在后端进程，禁止输出到日志、API 响应、前端或移动 App。服务端仍须实现最小权限的 Tool Registry 与 Policy Engine。
- `ports` 示例为原生客户端 API 预留宿主机端口。只有在后端自己的认证与授权完成后才可开放；不要把未经认证的管理 API 暴露在局域网。若版本初期不支持安全的原生 App 连接，可暂不发布该端口并先交付 Ingress Web 体验。
- 上例中的 `ports` 与 `8124/tcp` 处于**注释状态**，被刻意排除在生效字段之外。按 D-07，`ports` 保持注释直到 Phase 5 交付 HomeWeave 自己的认证与授权；对外开放宿主机端口意味着局域网内任何设备都能直连 API，必须先有独立 API 认证、速率限制、授权与审计（S2 已登记该后果）。解除注释时须同时更新本节与 D-07 记录。
- Ingress 令牌/路径是浏览器会话入口，不可当作原生 App 的长期 API 凭据。
- App 默认持久化路径是 `/data`。SQLite 路径必须设为例如 `file:/data/homeweave.db`，并通过重启和升级测试验证。
- 不需要为 SQLite 单独运行容器；Redis 不是 MVP 必需组件。

## 6. Home Assistant API 连接

优先评估 Supervisor 提供的 Home Assistant API 代理和 `homeassistant_api: true`。后端在运行时从受控的容器环境读取 Supervisor 提供的凭据，不将其持久化到 SQLite、不返回给前端、不记录原始环境变量。

若实现选择直接连接 Core API，必须说明原因、认证机制和用户设置流程；不得默认要求用户把长期令牌粘贴到手机 App。无论采用哪种方案，设备操作都必须通过统一的服务层、权限策略和结果验证。

## 7. Ingress 与原生 App 网络边界

- Ingress 用于 HA UI 中的 Web 体验，由 Home Assistant 处理用户登录并反向代理到 App 内部端口。
- Web 客户端应支持动态 base path、WebSocket 代理和刷新/深链接；不要把 Ingress token写入长期存储。
- 原生 iOS/Android 客户端必须配置自己的 HomeWeave API 服务器地址和认证会话。不能复用浏览器 Ingress URL/token。
- 如果暴露 `8124/tcp`，必须实现独立 API 认证、速率限制、授权和审计。局域网 HTTP 只可作为明确标注的开发/受控场景；生产远程访问应采用 HTTPS/WSS 或用户配置的 VPN/安全代理。
- 不要直接在路由器转发 API、HA Core 或 Supervisor 端口到公网。

## 8. 镜像构建与发布

使用 Home Assistant 官方 App 示例仓库和当前官方 builder actions 作为起点，不自行猜测过时的 workflow API。CI 应：

1. 验证 `config.yaml`、Dockerfile、shell、YAML 和 TypeScript。
2. 运行后端测试和构建。
3. 构建 `amd64` 与 `aarch64` 镜像（需先验证 Node 原生依赖和 Expo Web 产物可在目标架构工作）。
4. 推送架构镜像并发布多架构 manifest 到 GHCR。
5. 使用不可变版本标签；需要时同时发布 `latest`，但安装配置以版本号为准。
6. 先确认镜像公开可拉取，再更新 `config.yaml` 的 `version`。
7. 使用最小 GitHub Actions permissions；发布镜像所需 `packages: write`，不需要的权限不得授予。

Node.js 原生模块、Prisma engine 与 SQLite 相关依赖必须针对目标容器架构正确安装/生成；不可在 amd64 容器中生成后假定 aarch64 一定可用。生产镜像应固定可控的基础镜像版本，避免盲目依赖 `latest`。

## 9. 配置与密钥

- App 用户可配置项放在 `config.yaml` 的 `options` / `schema`，由 `/data/options.json` 或 Bashio 读取；只放非敏感偏好或明确理解的配置。
- AI Provider API Key、用户集成凭据和应用加密密钥不得出现在镜像、Git、构建日志、客户端 bundle 或诊断日志中。
- 对用户输入的 provider key 应由后端加密存储，并备份 `APP_ENCRYPTION_KEY`；密钥丢失可能导致加密数据不可恢复。
- Supervisor API token 是运行时凭据，不得写入 options、数据库、配置导出或客户端。
- 仅申请必需的 App 权限；按实际能力配置 AppArmor profile，并在安全文档中解释高权限能力。

## 10. 安装、升级、备份和恢复

用户安装步骤：
1. 打开 Home Assistant OS 的 Settings → Apps。
2. 在 Apps 商店右上角菜单选择 Repositories。
3. 添加仓库地址，两个源任选其一，内容一致（`master` 与 `0.1.0`–`0.1.2` tag 同步）：
   - GitHub：`https://github.com/Zee1988/homeweave`
   - Gitee 镜像：`https://gitee.com/zee638716/homeweave`（HAOS 所在网络访问不到 GitHub 时用这个）
4. 找到 HomeWeave，安装并启动。
5. 查看 Logs/Documentation，完成首次配置并验证 Home Assistant API 连接。
6. 侧边栏会出现 HomeWeave 面板（0.1.2 起 `ingress_panel: true`），点开即 Ingress 入口；Phase 5 之前该面板返回 404，属预期。原生 App 需另行配置安全的 HomeWeave API 地址。

发布流程：构建并发布镜像 → 更新 App 版本 → 用户在 Apps 中更新。每次数据库 schema 变化都需要向前迁移和备份策略；禁止启动时静默重置数据库。

必须记录 `/data` 的持久化范围、Home Assistant 备份是否包含该目录（须在目标版本实测确认）、独立备份/恢复命令或 UI 流程、加密密钥备份和恢复验证。不要承诺 Supervisor 备份一定覆盖任意挂载数据，除非实际验证过。

### 10.1 仓库源与镜像源是两件事

Supervisor 装 App 时分两步走两条网络路径，**换仓库源不能替代换镜像源**：

| 步骤 | 目标 | 由谁决定 |
|---|---|---|
| 读 App 元数据 | clone 仓库，读 `repository.yaml` / `homeweave_app/config.yaml` | 用户在「Repositories」里填的仓库地址 |
| 拉镜像 | `ghcr.io/zee1988/homeweave-ha-app:<version>` | `config.yaml` 的 `image:` 字段，与仓库源无关 |

所以：GitHub 不可达但 GHCR 可达 → 加 Gitee 源即可；两者都不可达 → 仍要解决镜像来源。GHCR 拉不动时按 §11.1 已走通的办法处理（`ghcr.dockerproxy.net` 逐 blob 下载 + `sha256sum` 校验 + `docker load`，Supervisor 见到本地同名镜像即跳过拉取）。

`repository.yaml` 与 `config.yaml` 的 `url:` 仍是 GitHub 主页链接，纯展示用途，不参与 clone，也不影响从 Gitee 安装。

Gitee 仓库是**镜像**，不是第二主源：代码与 tag 从 GitHub 单向推送（`git push gitee master --tags`），两边 version/tag 必须一致。改版本号时两边都要推，否则 Gitee 上会出现指向不存在镜像的 `version`。

## 11. 验收标准

- 仓库结构和 `repository.yaml` 能被 Home Assistant Supervisor 识别。
- CI 能构建并发布 `amd64` / `aarch64` 镜像，且镜像标签与 App version 一致。
- Home Assistant OS 可以从自定义仓库安装、启动、停止、重启和更新 App。
- `/data` 中 SQLite 数据在重启与升级后保留；迁移失败不会清空数据。
- Ingress Web UI 可在动态路径下加载、刷新并建立 WebSocket 连接。
- 后端能通过已选定的 HA API 方式读取实体并调用授权的低风险服务。
- Supervisor token、HA token、模型 API key 不会出现在客户端、日志或 API 响应。
- 原生 API 若启用，需通过独立认证、未授权访问拒绝、速率限制和安全传输测试。
- 如果没有真实 Home Assistant OS 设备，必须把安装/升级验证标记为未验证，不能用普通 Docker Compose 测试替代。
- 实机条目（**已验证**，2026-10-29 / HA Green / `aarch64` / Supervisor 2026.10.4）：在 Apps 商店添加自定义仓库 `https://github.com/Zee1988/homeweave` 后，列表中出现 `HomeWeave` 条目并可安装，`0.1.1` 装成 `state: started`、`boot: auto`。Phase 1 结束时该项没有任何实机证据，只能记为"待验证"；该结论已在 0.1.1 上关闭，逐项结果见 §11.1。注意侧边栏面板（0.1.2 起为 `ingress_panel: true`）在 Phase 5 之前打开的是空路由，返回 404 属既定后果（S2），不应记为缺陷。

### 11.1 真机验证记录（0.1.1 → 0.1.2）

环境：HA Green、`aarch64`、Supervisor 2026.10.4、Core 2026.10.2。

| 项 | 0.1.1 实测 |
|---|---|
| 安装 | ✅ `state: started`、`boot: auto`。GHCR 直连经 `d.fashgh.com` 加速器拉取 19 分钟 0 字节；改用 `ghcr.dockerproxy.net` 手工下载 13 个 blob、逐个 `sha256sum` 校验后组装 `docker load`，Supervisor 见到本地镜像即跳过拉取。**属网络环境问题，不是镜像缺陷** |
| `/data` 可写 | ❌ `/data` 为 `root:root`，进程 uid 1000 无法写入，启动即 `exit 78 / dir_readonly`。手工 `chown -R 1000:1000 /mnt/data/supervisor/apps/data/<slug>` 后启动成功 |
| `/health/ready` | ✅ 200，`database ok`、`disk ok`（99 GiB 空闲）、`migrations: unknown (table_missing)` |
| `/health/live` | ✅ `{"status":"ok"}` 200 |
| 镜像健康检查 | ✅ 容器 `Up`，健康检查通过 |
| `ha apps stop` 耗时 / `ExitCode` / 日志顺序 | ⬜ 未执行 |
| watchdog 探活重启 | ⬜ 未执行 |
| 日志脱敏（金丝雀） | ⬜ 未执行 |
| `options.json` 落盘 | ⬜ 未执行 |
| ingress 打开后的响应 | ⬜ 未记录（应为 404，不是 502） |

**0.1.1 的缺陷**：`/data` 属主由 Supervisor 决定，镜像内 `USER node` 在全新安装上必然失败。Dockerfile 里构建期的 `chown node:node /data` 会被 Supervisor 的 bind mount 遮蔽，所以它只能让无挂载的 `docker run` 通过，掩盖了真机行为。0.1.2 改为：镜像以 root 启动 → `docker/entrypoint.sh` 把 `/data` 交给 `node` → `exec gosu node` 降权运行服务；D2 规则只有在读到该脚本并确认它 `chown -R node:node /data` 且 `exec gosu node "$@"` 时才允许 root，`assert-image.sh` 的第 10 项断言容器内 `id -u` 为 1000 且 `/data` 可写。

`migrations: unknown` 不是缺陷：镜像不含 prisma CLI、不执行迁移（D-06），表由 Phase 4 建；该状态不参与 `/health/ready` 的状态码。

### 11.2 `0.1.2` 发布记录（2026-10-29）

| 项 | 结果 |
|---|---|
| GHCR 镜像 | `ghcr.io/zee1988/homeweave-ha-app:0.1.2`，`amd64` + `arm64` |
| git tag | `0.1.2`（`e8c4f16`），由 release 工作流的 `tag` job 创建 |
| 匿名拉取 | ✅ 无凭证 `docker pull` 成功 |
| 内容断言 | ✅ 10/10，含第 10 项「`/proc/1/status` 的 Uid 为 1000 且 `/data` 可写」 |
| fail-fast / 停机预算 / manifest | ✅ 全部通过 |

两次 run 的经过，保留下来是因为两者都是**门禁在起作用**，不是流程噪音：

1. `40793337869`：镜像已推上 GHCR 且内容正确，但 `verify-image` 在断言脚本上失败——脚本用 `docker exec id -u` 读 uid，而 `docker exec` 从镜像 `USER`（root）起，恒为 0。失败的是断言，不是镜像。修法是读 `PID 1` 的 `/proc/1/status`（提交 `3337449`）。
2. `40794597502`：走 `resume_from_verify=true` 只重验已有镜像，`verify-image` 全绿，但 `tag` job 被**静默跳过**，整轮 run 仍报 `success`——一次"绿色但没打 tag"的发布。原因是 GitHub 对 job 的隐式 `success()` 会评估整个依赖闭包，而 resume 按设计跳过了 `publish`。修法是给 `tag` 写明条件 `always() && needs.guard.result == 'success' && needs.verify-image.result == 'success'`（提交 `e8c4f16`），并把该条件变成校验规则 F14，防止回退。
3. `40796348597`：同上 resume 路径，`verify-image` 与 `tag` 全绿，`0.1.2` tag 落库。

镜像内容自 `40793337869` 的 `publish` 起未变：`3337449` 只改了 `scripts/ci/assert-image.sh`，`e8c4f16` 只改了工作流与校验器，二者都不进镜像。因此 `resume_from_verify=true` 重验的就是本应发布的那个镜像，而不是"另一个构建"。

`0.1.2` 在真机上的复验（V2 与 V4–V9）仍是**未执行**项，见 `.planning/phases/03-runtime/03-VALIDATION.md`。可交给执行方的自包含步骤见 `docs/23_ON_DEVICE_TEST_RUNBOOK.md`。

### 11.3 `0.1.2` 真机验收：1–7 通过，F-1 阻断第 8 步

在 HA Green 上实机执行（容器 `app_7cbb973f_homeweave`，`state: started`、`/health/live` 与 `/health/ready` 均 200、`/data` 挂载正常）。

| 步骤 | 结果 | 说明 |
|---|---|---|
| 1–6 安装 / 启动 / 健康 / 持久化 | ✅ | — |
| 7 fail-fast | ✅ | 须用 `docker exec -u node` 口径，见 §11.3.2 |
| 8 日志脱敏 | ❌ | canary 计数 0，但 `logLevel` 实为 `info`——假阴性 |
| 9–11 | ⏸ | 按"失败即停"未执行 |

#### 11.3.1 F-1（阻断，`0.1.3` 已修）：运行期改写的 `options.json` 属主未被回收

**现象。** 经 Supervisor 把 `log_level` 改成 `debug`（HTTP 200）后重启，`/data/options.json` 内容已是 `debug`，启动日志却是 `"logLevel":"info","logLevelSource":"fallback"`。以 `-u node` 读文件直接 `Permission denied`：

```
-rw------- 1 root root 41 Oct 29 11:09 options.json
```

`stop → start` 确定性复现，不是竞态。

**根因（两处叠加）。**

1. `docker/entrypoint.sh` 的短路只看 `/data` 目录本身的 uid。首次安装时 `/data` 是 root，递归 `chown` 生效；此后目录已是 1000，**任何重启都跳过递归 chown**，而 Supervisor 在运行期改选项时会以 `root:root 0600` 重写 `options.json`，该文件从此对 uid 1000 永久不可读。
2. `apps/api/src/config/log-level.ts` 把 `EACCES` 与"文件不存在"同样当作"没有配置"，静默回落 `info`，不产生任何日志。注释中的假设 A3（"options 文件归 Supervisor 所有，应用可读"）在 HAOS 上不成立。

后果是所有运行期可改的 option（`log_level`、`ha_url` 及后续新增项）都会静默失效，只能靠 `logLevelSource` 反推。

**修法（`0.1.3`）。**

| 文件 | 改动 |
|---|---|
| `docker/entrypoint.sh` | 短路条件改为"`/data` 目录本身或其下任一条目不属于 node"，才执行 `chown -R` |
| `apps/api/src/config/log-level.ts` | `readOptionsFile` 仅在 `EACCES`/`EPERM` 时抛出；`resolveLogLevel` 据此返回新值 `source: 'unreadable'`，不再与 `fallback` 合并 |
| `apps/api/src/main.ts` | `unreadable` 时输出 `event: "options_unreadable"` 的 warn |
| `scripts/ci/assert-image.sh` | 新增第 11 项：向运行中的容器写入 `root:root 0600` 的 `options.json`，`docker restart` 后断言 `-u node` 可读且启动日志为 `logLevelSource: "options"` |

第 11 项是这次的关键产出：1–10 项都不重启容器，因此 0.1.2 的 `verify-image` 10/10 全绿却漏掉了这个必现缺陷。

**顺带确认的语义**：Supervisor 改选项后**不会**自动重启 App，配置只在下次启动时被读取。所以"改完不生效"要先确认重启过，再怀疑属主。

#### 11.3.2 F-2（手册口径问题，非产品缺陷）

`ha apps stop` 之后 Supervisor 会移除容器，`docker inspect -f '{{.State.ExitCode}}'` 返回空。第 11 步的退出码改从 `docker events` 的 `die` 事件取，见 `docs/23` §4。

同理，fail-fast 三例必须用 `docker exec -u node` 跑：以 root 跑时 `access(W_OK)` 被 `CAP_DAC_OVERRIDE` 放行，`/proc` 上的写入失败会落到 `write_failed` 而非 `dir_readonly`，判据就不成立了。

#### 11.3.3 F-3（预期行为，但要记住它证明得很少）

`/data/homeweave.db` 为 0 字节、`migrations: unknown` 是设计使然：镜像不含 prisma CLI、不执行迁移（D-06），表由 Phase 4 建。

要注意 `database: ok` 在空库上是**弱证据**：SQLite 打开 0 字节文件视为空库，`/health/ready` 的 database 检查用的是常量查询，不触碰任何表，因此照样返回 `ok`。Phase 4 建表后必须重验一次，不能把这次的 `ok` 当作"数据库链路已验证"。

### 11.4 `0.1.3` 发布记录（2026-10-29）

| 项 | 结果 |
|---|---|
| run | `40813153148`（`guard` → `static` → `publish` → `verify-image` → `tag` 全绿） |
| 镜像 | `ghcr.io/zee1988/homeweave-ha-app:0.1.3`，`amd64` + `arm64`，匿名拉取成功 |
| index digest | `sha256:60e96e89a26643cb2448d50c22f1cd7a9559e1e916e26de629a36fdebe6d5164`（含 `linux/amd64`、`linux/arm64` 两个 variant；2026-10-29 以匿名 token 复核，manifest 返回 200，包为 public） |
| 内容断言 | ✅ 11/11（新增第 11 项） |
| git tag | `0.1.3`，已同步到 Gitee |
| 契约护栏 | `scripts/validate-app-metadata.mjs` 的 `CONTRACT.version` 同步改为 `0.1.3`（该值必须与已发布版本完全一致） |

第 11 项在真实镜像上的输出：

```
✓ 11/11 a root:root 0600 options.json is reclaimed on restart (log_level=debug took effect, logLevelSource=options)
✓ all 11 image assertions passed
```

这条断言是 0.1.2 那次真机失败的机械复现：向运行中的容器写入 `root:root 0600` 的 `options.json`，`docker restart` 后要求 `-u node` 能读到、且启动记录为 `logLevelSource: "options"`。旧镜像在这条上必然失败，新镜像必须通过。

`0.1.3` 相对 `0.1.2` 不改任何 API、schema 或 config：改动只有 entrypoint 的 chown 判定、日志级别的错误归类（新增 `source: "unreadable"`）、一条 warn，以及断言脚本。

#### 11.4.1 `0.1.3` 真机验收（2026-10-29，HA Green / `aarch64`）

12 步按序执行完毕，**10 通过、1 项待人工确认、1 项平台侧未观测到**。

| 步骤 | 结果 | 关键值 |
|---|---|---|
| 1 镜像 | ✅ | `sha256:60e96e89…5164`、`created=2026-10-29T03:42:59Z`、`version_latest: 0.1.3` |
| 2 升级 | ✅ | `0.1.3` / `started` / `auto` |
| 3 属主接管 | ✅ | `node:node` → 手工打回 `root:root` → 重启后自动回到 `node:node`（含 `options.json`），无 `startup_failed` |
| 4 身份与可写 | ✅ | `Uid: 1000 1000 1000 1000`、`node:node 755`、`writable`、`port:8099` |
| 5 健康端点 | ✅ | `ready` 200（`database ok` / `migrations unknown` / `disk ok`）、`live` 200 |
| 6 fail-fast ×3 | ✅ | `dir_missing/78`、`dir_readonly/78`、`invalid_port/78`，各一行 JSON |
| 7 日志脱敏 | ✅ | `logLevel:"debug"` + `logLevelSource:"options"`，canary 计数 `0`，且存在 `level:20` 请求日志——**debug 真生效，不是假阴性** |
| 8 options 链路 | ✅ | `ha_url` 改后文件跟随，属主仍 `node:node 600`，`logLevelSource` 未回落 |
| 9 ingress | ⏳ | 无会话直连返回 401（已进 HA 认证层，非 502）、容器内 `/` 返 404 `Cannot GET /`；仅剩"点侧边栏面板"一步人工确认 |
| 10 watchdog | ⬜ | `pause` 后 4.5 分钟仍未触发，Supervisor 无探活失败/重启日志——**平台侧未观测到，不判 App 缺陷**，复测方式见 `docs/23` §4 V6 |
| 11 优雅关闭 | ✅ | 耗时 1 s、`die exitCode=0`、`stop accepting`(56.558) 早于 `prisma disconnected`(56.581)、无 `forced`/`budget` |
| 12 环境 | ✅ | OS 18.3.1 / Supervisor 2026.10.4 / Core 2026.10.2 |

**F-1 双向确认关闭**：第 3 步人为把 `/data` 打回 `root:root` 后重启能自动纠正；第 8 步 Supervisor 经 REST 重写 `options.json` 后文件仍为 `node:node 600`、`logLevelSource` 保持 `options`。0.1.2 阻断第 8 步的缺陷不再复现。

第 9 步的 401 是**正确**结果：ingress 已把请求送到 HA 的认证层，浏览器带会话点面板才会落到容器的 404。

第 10 步给后续的结论只有一条：**Supervisor 的探活周期大于 4.5 分钟，且未在 `pause` 下触发重启**。这既不能证明 watchdog 失效，也不能证明有效；App 侧已用第 5 步证明 `/health/live` 正常，故不阻塞 Phase 3 验收。复测须把观察窗口拉到 20 分钟并优先用 `kill -STOP 1`。

## 12. 官方参考

- Apps 开发总览：https://developers.home-assistant.io/docs/apps
- 仓库创建与分发：https://contributors.home-assistant.io/apps/guides/repository/
- App 配置参考：https://contributors.home-assistant.io/apps/reference/configuration/
- 发布 App：https://contributors.home-assistant.io/apps/guides/publishing/
- Ingress 指南：https://contributors.home-assistant.io/apps/guides/ingress/
- 官方示例仓库：https://github.com/home-assistant/apps-example
