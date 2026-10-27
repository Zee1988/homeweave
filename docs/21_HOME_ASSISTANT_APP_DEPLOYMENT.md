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
ports:
  8124/tcp: 8124
```

注意：
- `image` 指向 GHCR 多架构镜像的通用名称，不包含版本标签；Supervisor 使用 `version` 选择匹配的镜像标签。
- 先发布镜像 `<version>`，再提交包含相同 `version` 的 `config.yaml`。不要复用已发布的版本标签。
- `homeassistant_api: true` 会提供 Supervisor 的 Home Assistant API 访问能力；其令牌可执行高权限操作，必须只留在后端进程，禁止输出到日志、API 响应、前端或移动 App。服务端仍须实现最小权限的 Tool Registry 与 Policy Engine。
- `ports` 示例为原生客户端 API 预留宿主机端口。只有在后端自己的认证与授权完成后才可开放；不要把未经认证的管理 API 暴露在局域网。若版本初期不支持安全的原生 App 连接，可暂不发布该端口并先交付 Ingress Web 体验。
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
3. 添加 `https://github.com/<owner>/<repo>`。
4. 找到 HomeWeave，安装并启动。
5. 查看 Logs/Documentation，完成首次配置并验证 Home Assistant API 连接。
6. 在 HA 内打开 Ingress Web UI；原生 App 需另行配置安全的 HomeWeave API 地址。

发布流程：构建并发布镜像 → 更新 App 版本 → 用户在 Apps 中更新。每次数据库 schema 变化都需要向前迁移和备份策略；禁止启动时静默重置数据库。

必须记录 `/data` 的持久化范围、Home Assistant 备份是否包含该目录（须在目标版本实测确认）、独立备份/恢复命令或 UI 流程、加密密钥备份和恢复验证。不要承诺 Supervisor 备份一定覆盖任意挂载数据，除非实际验证过。

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

## 12. 官方参考

- Apps 开发总览：https://developers.home-assistant.io/docs/apps
- 仓库创建与分发：https://contributors.home-assistant.io/apps/guides/repository/
- App 配置参考：https://contributors.home-assistant.io/apps/reference/configuration/
- 发布 App：https://contributors.home-assistant.io/apps/guides/publishing/
- Ingress 指南：https://contributors.home-assistant.io/apps/guides/ingress/
- 官方示例仓库：https://github.com/home-assistant/apps-example
