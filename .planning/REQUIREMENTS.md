# Requirements: HomeWeave（织家）

**Defined:** 2026-10-27
**Core Value:** HAOS 用户添加仓库 → 安装 → 启动 → 在 HA 侧边栏打开一个能跑的 HomeWeave。

## v1 Requirements

本里程碑（部署优先垂直切片）的可验收范围。每条需求映射到且仅映射到一个 roadmap 阶段。

### App 元数据与仓库可识别性（APP）

- [ ] **APP-01**: 用户可以在 HAOS App 商店添加 HomeWeave Git 仓库 URL，并在 Apps 列表看到名为 HomeWeave 的条目
- [ ] **APP-02**: App 的 `config.yaml` 声明 `amd64` / `aarch64` 架构、Ingress 入口与端口、`/data` 持久化、Home Assistant API 访问权限与启动/停止/健康相关字段，且可被 Supervisor schema 校验通过
- [ ] **APP-03**: 仓库根 `repository.yaml` 提供仓库名称、URL 与 maintainer，使 Supervisor 能识别为有效 App 仓库
- [ ] **APP-04**: App 暴露用户可配置选项（至少日志级别与可选 Home Assistant URL 覆盖），并在 `config.yaml` 中给出 `options` + `schema` 及默认值

### 镜像构建与发布（IMG）

- [ ] **IMG-01**: 开发者可用仓库内单一脚本/命令在本地构建出可启动的生产镜像
- [ ] **IMG-02**: 生产镜像包含 NestJS 构建产物、Prisma Client 与迁移文件，不含 devDependencies、源码与 source map
- [ ] **IMG-03**: GitHub Actions 构建 `amd64` 与 `aarch64` 镜像，推送到 GHCR 并生成多架构 manifest
- [ ] **IMG-04**: 镜像 tag 与 App 版本号一致，且发布顺序为"先镜像、后用户可见版本号"
- [ ] **IMG-05**: CI 在构建前校验 App 元数据与 Dockerfile（YAML/字段合法性、必填项、版本一致性），失败即阻断发布

### 运行时服务（RT）

- [ ] **RT-01**: `GET /health/live` 无需认证即可返回进程存活状态，且不泄露内部细节
- [ ] **RT-02**: `GET /health/ready` 校验数据库可读写与迁移版本，未就绪时返回非 2xx 并说明原因
- [ ] **RT-03**: 进程收到 `SIGTERM` / `SIGINT` 时优雅关闭：停止接收新请求、关闭连接与 Prisma、在限定时间内退出
- [ ] **RT-04**: 日志为结构化格式，且 HA token、API Key、`Authorization` 头等敏感字段被脱敏
- [ ] **RT-05**: 数据库路径通过配置注入（App 中默认 `/data/homeweave.db`），启动时校验目录可写并在不可写时 fail-fast

### 数据持久化与迁移（DATA）

- [ ] **DATA-01**: Prisma + SQLite 数据文件位于 `/data`，容器删除重建后数据仍保留
- [ ] **DATA-02**: 启动时执行受控迁移（`prisma migrate deploy`），迁移失败则 fail-fast 且不删除或重建数据库
- [ ] **DATA-03**: 迁移前自动生成数据库备份并保留有限份数，备份路径可见、可恢复
- [ ] **DATA-04**: 版本升级路径不静默清空数据，能展示当前 schema 版本与迁移结果

### Home Assistant 集成（HA）

- [ ] **HA-01**: 在 Supervisor 环境下自动发现 Home Assistant 地址与凭据（`SUPERVISOR_TOKEN`），无需用户手工填写
- [ ] **HA-02**: 启动自检调用 Home Assistant API 并输出连接结果，该结果体现在 `ready` 状态与 Web UI 上
- [ ] **HA-03**: HA token 仅存在于后端进程环境/内存，不出现在 API 响应、日志、错误详情或前端产物中
- [ ] **HA-04**: 非 Supervisor 部署（Compose）可用配置覆盖 HA URL，并具备 SSRF 防护、超时与重定向校验

### Ingress Web UI（ING）

- [ ] **ING-01**: 通过 HA 侧边栏打开 Web UI 时，静态资源在动态 basePath 前缀下正确加载（无 404 / 无硬编码绝对路径）
- [ ] **ING-02**: 在 Ingress 下刷新页面或直接访问子路径不返回 404（SPA fallback 正确）
- [ ] **ING-03**: WebSocket 经 Ingress 建立连接并完成一次 echo 往返，断线后能重连
- [ ] **ING-04**: 绕过 Ingress 直接访问服务时行为明确且安全：只有健康探针与显式允许的路径可见，其余默认拒绝

### 安全边界（SEC）

- [ ] **SEC-01**: Ingress 请求与原生 API 请求在服务端被区分处理，Ingress token 不被当作原生客户端 API 凭据
- [ ] **SEC-02**: 服务默认拒绝未认证访问，并提供可复用的认证/速率限制中间件骨架（供后续原生 API 使用）
- [ ] **SEC-03**: 镜像、仓库与 CI 中不存在硬编码密钥；构建过程不把密钥写入镜像层或构建缓存

### 文档（DOC）

- [ ] **DOC-01**: `DOCS.md` 提供安装步骤：添加仓库 → 安装 → 启动 → 从侧边栏打开，并有配置选项说明
- [ ] **DOC-02**: 文档给出升级与回滚步骤（版本标签对应关系、镜像可用性检查）
- [ ] **DOC-03**: 文档给出备份与恢复步骤（`/data` 快照、恢复后验证方法）
- [ ] **DOC-04**: 文档给出故障排查清单：看不到仓库、安装失败、启动失败、Ingress 404、WebSocket 断开、数据库不可写
- [ ] **DOC-05**: 文档给出 Home Assistant Container 用户的 Docker Compose 备用部署方式与差异说明
- [ ] **DOC-06**: `CHANGELOG.md` 与 `README.md` 记录版本、变更内容与已知限制

### 验证与证据（VER）

- [ ] **VER-01**: 仓库提供可复现的 lint / typecheck / unit 命令，并在 CI 中执行
- [ ] **VER-02**: 提供容器模拟验证：`docker run` + `/data` 挂载、重启与升级后数据保留、模拟 Ingress 前缀头下页面与 WebSocket 可用
- [ ] **VER-03**: HAOS 实机验证清单文档化，并明确标注哪些项尚未在真实 HAOS 上验证

## v2 Requirements

已识别但不在本里程碑路线图中。

### 设备控制与工具层

- **TOOL-01**: 服务端 Tool Registry 注册受控设备工具，模型不能定义权限或风险等级
- **TOOL-02**: Policy Engine 在服务端重算权限、风险与确认要求
- **TOOL-03**: 设备操作结果按 `succeeded` / `failed` / `unknown` / 部分成功分类并验证

### AI 与 Agent

- **AI-01**: ModelProvider 抽象与 Fast-Path 意图理解
- **AI-02**: 任务编排（Task Orchestrator）与执行审计
- **AI-03**: 高风险操作（门锁、安防）强制人工确认

### 客户端

- **MOB-01**: Expo 客户端与原生认证、授权、审计、速率限制
- **MOB-02**: 移动端安全存储凭据（不使用 `localStorage` 存长期凭据）

### 运维

- **OPS-01**: MCP Server 对外暴露受控能力
- **OPS-02**: 自动化发布与通知链路

## Out of Scope

| Feature | Reason |
|---------|--------|
| 设备控制执行链路 | 依赖认证与工具层先成立；本里程碑只做部署与运行时 |
| AI Agent / ModelProvider | 需先在可运行运行时与安全边界之上建设 |
| Expo 原生客户端 | Ingress 已覆盖 Web 入口；原生端需要独立认证体系 |
| 多用户与家庭权限模型 | 本里程碑只建立默认拒绝的认证边界骨架 |
| HA Container 全自动安装 | Supervisor App 是首选路径，Compose 仅文档化备用 |
| 公网暴露设备控制 API | 违反安全约束，任何阶段都不做未受保护的公网设备控制 |
| 在家庭主机上源码编译安装 | 由预构建镜像替代，避免要求用户装 Node.js/Docker |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| APP-01 | TBD | Pending |
| APP-02 | TBD | Pending |
| APP-03 | TBD | Pending |
| APP-04 | TBD | Pending |
| IMG-01 | TBD | Pending |
| IMG-02 | TBD | Pending |
| IMG-03 | TBD | Pending |
| IMG-04 | TBD | Pending |
| IMG-05 | TBD | Pending |
| RT-01 | TBD | Pending |
| RT-02 | TBD | Pending |
| RT-03 | TBD | Pending |
| RT-04 | TBD | Pending |
| RT-05 | TBD | Pending |
| DATA-01 | TBD | Pending |
| DATA-02 | TBD | Pending |
| DATA-03 | TBD | Pending |
| DATA-04 | TBD | Pending |
| HA-01 | TBD | Pending |
| HA-02 | TBD | Pending |
| HA-03 | TBD | Pending |
| HA-04 | TBD | Pending |
| ING-01 | TBD | Pending |
| ING-02 | TBD | Pending |
| ING-03 | TBD | Pending |
| ING-04 | TBD | Pending |
| SEC-01 | TBD | Pending |
| SEC-02 | TBD | Pending |
| SEC-03 | TBD | Pending |
| DOC-01 | TBD | Pending |
| DOC-02 | TBD | Pending |
| DOC-03 | TBD | Pending |
| DOC-04 | TBD | Pending |
| DOC-05 | TBD | Pending |
| DOC-06 | TBD | Pending |
| VER-01 | TBD | Pending |
| VER-02 | TBD | Pending |
| VER-03 | TBD | Pending |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 0
- Unmapped: 37 ⚠️（roadmap 创建时填写）

---
*Requirements defined: 2026-10-27*
*Last updated: 2026-10-27 after initial definition*
