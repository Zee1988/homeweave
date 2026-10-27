# Roadmap: HomeWeave（织家）

## Overview

本里程碑是**部署优先的垂直切片**：把「HAOS 添加仓库 → 安装 → 启动 → 在 HA 侧边栏打开一个能跑的 HomeWeave」这条链路做成真实可用。阶段按风险倒序排列——第一阶段就验证最不确定的问题（Supervisor 是否认得我们的仓库与 App 元数据），之后每个阶段叠加一层可独立验收的能力：可拉取的镜像、可控的进程生命线、不丢数据的升级、侧边栏里的可用页面、可自证的 HA 连接，最后是让非专家用户照着文档走完的安装/升级/回滚/排障与三类验证证据。

设备控制、AI/Agent、Expo 原生客户端、MCP 均不在本路线图内（见 REQUIREMENTS.md 的 v2 段落）。

## Global Conventions

**验证类（每个阶段必须标明结论属于哪一类，不得混用）：**

| 类 | 含义 | 允许的结论措辞 |
|----|------|----------------|
| 静态 | lint / typecheck / unit / YAML 与元数据 schema 校验 / 官方文档比对 | "静态校验通过" |
| 容器模拟 | `docker build` + `docker run`、卷挂载、模拟 Ingress 前缀头、mock HA | "容器模拟通过（非 HAOS）" |
| HAOS 实机 | 真实 Home Assistant OS + Supervisor | "HAOS 实机通过"；无环境时只能记录为**未验证** |

**硬性约束（贯穿所有阶段，不得让步）：** SQLite 在 `/data`；先发布镜像再更新用户可见版本号；Supervisor 凭据只在后端；Ingress token 不作为原生客户端凭据；无密钥进入前端/环境示例/日志/镜像层；单一控制面路径；不做未受保护的公网设备控制。

**必须由实现阶段确定、不得凭记忆编造的占位符：** GHCR `owner`、Git 仓库 URL、`maintainer`、最低支持的 Home Assistant / Supervisor 版本。这些在 Phase 1 作为显式决策落盘（决策记录 + 文档同步），后续阶段只引用不重定义。

**里程碑边界：** 单一 milestone（v1.0），阶段编号从 1 连续；插入需求走 `/gsd-phase --insert`。

## Phases

- [ ] **Phase 1: App 元数据与仓库可识别性** - 让 Supervisor 认得出这个仓库与 HomeWeave 条目
- [ ] **Phase 2: 镜像构建与发布链路** - 先镜像后版本号，多架构 manifest 公开可拉取，CI 作门禁
- [ ] **Phase 3: 运行时骨架** - 进程能自证健康、日志脱敏、可优雅停止、配置错就 fail-fast
- [ ] **Phase 4: 数据持久化与受控迁移** - `/data` 数据跨重启与升级保留，迁移失败不清库
- [ ] **Phase 5: Ingress Web UI 与认证边界** - 侧边栏打开可用页面，绕过 Ingress 默认拒绝
- [ ] **Phase 6: Home Assistant 连接与自检** - 自动发现凭据、自检连接、并把状态展示给用户
- [ ] **Phase 7: 文档与三类验证证据** - 非专家用户按文档完成安装/升级/回滚/排障

## Phase Details

### Phase 1: App 元数据与仓库可识别性

**Goal**: 仓库结构与 App 元数据达到"Supervisor 能识别为有效 App 仓库并渲染出可安装条目"的条件，并锁死全部占位符决策。
**Depends on**: Nothing (first phase)
**Requirements**: APP-01, APP-02, APP-03, APP-04
**Success Criteria** (what must be TRUE):
  1. 开发者执行仓库内单一校验命令，即可确认 `repository.yaml` 与 `homeweave_app/config.yaml` 满足**当前官方** App 配置参考的必填字段与取值约束（依据现场核对的上游文档与官方示例，而非记忆）。
  2. 仓库中不存在第二份会被 Supervisor 递归识别的 `config.yaml`（规格示例保持 `.example` 后缀），校验命令能发现此类冲突文件。
  3. `config.yaml` 中 `image`、`version`、`arch`、`ingress_port`、`homeassistant_api` 与 `/data` 相关字段值全部来自已落盘的显式决策；仓库内不存在未替换的 `<owner>` / `<repo>` / `<maintainer>` 占位符。
  4. App 用户在配置页可见至少「日志级别」与「HA URL 覆盖」两个选项，带 `options` + `schema` 类型与默认值（配置文件层面可校验）。
  5. 「在 HAOS 添加仓库并看到 HomeWeave 条目」被写入实机验证清单，并明确标注为 **HAOS 未验证**。
**Plans**: 1/3 plans executed
- [x] 01-01-PLAN.md
- [ ] 01-02-PLAN.md
- [ ] 01-03-PLAN.md

计划切片（供 plan-phase 细化，预期 4 plans）：
- 现场核对官方 apps-example / 配置参考 / builder actions 的当前格式，输出差异备忘
- 决策并记录 GHCR owner、Git 仓库 URL、maintainer、最低 HA 版本；同步 `.example` 模板
- `repository.yaml` + `homeweave_app/config.yaml` + `apparmor`/启动文件的最小可用形态
- 元数据校验脚本与「不得出现第二份 config.yaml」检查，接入本地命令

**验证类**: 静态（YAML / schema / 官方文档比对）；HAOS 实机 = 未验证。

### Phase 2: 镜像构建与发布链路

**Goal**: 存在一个公开可拉取、多架构、标签与 App `version` 完全一致的预构建镜像，"先镜像、后版本号"的发布顺序由 CI 强制而非靠人记得。
**Depends on**: Phase 1（`image` 名称与 `version` 的单一来源）
**Requirements**: IMG-01, IMG-02, IMG-03, IMG-04, IMG-05, SEC-03, VER-01
**Success Criteria** (what must be TRUE):
  1. 仓库内单一命令即可构建出可启动的生产镜像；对镜像内部的检查可证明它包含 NestJS 构建产物、Prisma Client 与迁移文件，且不含 devDependencies、源码与 source map。
  2. 打 tag 触发 CI 后，GHCR 上同时存在 amd64 与 aarch64 镜像以及指向两者的多架构 manifest list，标签与 `config.yaml` 的 `version` 一字不差。
  3. CI 在构建前依次执行元数据/Dockerfile 校验、lint、typecheck、unit，任一步失败即阻断发布（可用一次故意注错的提交证明阻断生效）。
  4. 镜像层、构建缓存、workflow 文件与仓库中不存在硬编码密钥；密钥扫描与镜像历史检查是发布门禁，不是可选步骤。
  5. 当目标版本标签在 GHCR 已存在时 CI 拒绝覆盖/复用，并要求先发布镜像再提交版本号（发布顺序存在可观测检查点）。
**Plans**: TBD

计划切片（供 plan-phase 细化，预期 4 plans）：
- monorepo 骨架 + 最小 NestJS/Prisma 工程（仅够产出真实构建产物与迁移文件）
- 生产 Dockerfile（多架构友好的 Node 运行时、Prisma engine 目标架构校验、非 root 运行）
- GitHub Actions：静态门禁 → 双架构构建 → manifest 发布 → 权限最小化
- 版本/标签一致性与「标签已存在即拒绝」的发布顺序检查

**验证类**: 静态（CI 校验、workflow/YAML lint）+ 容器模拟（本地 build 与运行、manifest 拉取）；aarch64 运行结果在 amd64 主机上不可得时须标注为未验证。

### Phase 3: 运行时骨架

**Goal**: 容器启动后有一个可自证健康、可安全停止、配置错就立刻拒跑的后端进程。
**Depends on**: Phase 2
**Requirements**: RT-01, RT-02, RT-03, RT-04, RT-05
**Success Criteria** (what must be TRUE):
  1. `GET /health/live` 无需认证返回 200，响应体不含版本细节、内部路径或依赖信息（对照响应断言验证）。
  2. `GET /health/ready` 在数据库可读写且迁移到位时返回 2xx；数据库不可写或迁移未完成时返回非 2xx 并给出可理解原因（分别用只读数据目录与未迁移库实测）。
  3. 发送 `SIGTERM` 后进程在限定时间内自行退出：日志显示停止接收新请求并关闭连接与 Prisma，无被强制 SIGKILL 的记录。
  4. 走过一条带 `Authorization` 头与 token 的请求后，结构化日志中该字段已被脱敏为掩码，且每条日志都带可用于串联的 requestId。
  5. `DATABASE_URL` 指向不可写目录时进程 fail-fast 退出并给出明确错误，而不是带着半可用状态继续服务。
**Plans**: TBD

计划切片（供 plan-phase 细化，预期 4 plans）：
- NestJS 最小运行骨架 + 配置加载（含 App `options` 读取路径）
- `health/live` 与 `health/ready`（含数据库读写与迁移版本检查）
- 结构化日志 + 递归脱敏 + requestId 串联
- 优雅关闭与启动期 fail-fast 校验（端口、数据目录、必需配置）

**验证类**: 容器模拟（探针、`docker stop`、日志脱敏断言）+ 静态（脱敏与校验单测）。

### Phase 4: 数据持久化与受控迁移

**Goal**: `/data` 中的数据在容器重启与版本升级后仍然存在，迁移过程中失败不会静默清空或重建数据库。
**Depends on**: Phase 3（数据路径注入、`ready` 探针、启动校验）
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. 挂载 `/data` 写入数据后删除容器、以同一卷重建，数据仍在（容器模拟可复现）。
  2. 启动时执行 `prisma migrate deploy`；迁移失败时进程 fail-fast，数据库文件与既有数据未被删除、重建或 reset。
  3. 每次迁移前自动生成备份，备份落在可枚举与可读的路径、保留份数上限生效，并能用该备份恢复后验证数据一致。
  4. 从旧 schema 升级到新 schema 后，用户可见当前 schema 版本与迁移结果（日志或页面可见），且代码中不存在任何自动 reset / drop 的路径。
**Plans**: TBD

计划切片（供 plan-phase 细化，预期 3 plans）：
- Prisma schema 与初始迁移、`/data` 路径固化
- 启动迁移流程：备份 → `migrate deploy` → 结果记录 → 失败 fail-fast
- 升级/恢复演练脚本与容器模拟测试（重启保留、升级保留、失败注入）

**验证类**: 容器模拟（卷重建、旧库升级、迁移失败注入）+ 静态（备份保留策略与迁移脚本单测）。

### Phase 5: Ingress Web UI 与认证边界

**Goal**: 从 HA 侧边栏能打开一个真实可用的 Web UI，且绕过 Ingress 直接访问时默认拒绝。
**Depends on**: Phase 2（镜像内含 Web 产物）+ Phase 3（进程与探针）
**Requirements**: ING-01, ING-02, ING-03, ING-04, SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. 在模拟 Ingress 前缀（动态 basePath）下，页面引用的静态资源全部加载成功，无因硬编码 `/` 绝对路径造成的 404。
  2. 在该前缀下直接访问子路由并刷新返回 200（服务端 fallback 生效，而非仅在客户端兜底）。
  3. WebSocket 在该前缀下完成一次 echo 往返；连接断开后能自动重连并恢复（容器模拟）。
  4. 绕过 Ingress 直接访问非白名单路径返回 401/403，仅显式允许的探针类路径可匿名访问；未认证访问默认被拒绝。
  5. 服务端明确区分 Ingress 请求与原生 API 请求：Ingress 令牌不被接受为原生客户端凭据，且已具备可复用的认证/速率限制中间件骨架（集成测试可证）。
**Plans**: TBD

计划切片（供 plan-phase 细化，预期 5 plans）：
- 决策并记录 Web UI 载体（`apps/mobile` Expo Web 导出 vs 本里程碑最小静态页）与演进路径
- 静态资源动态 basePath 注入与 SPA fallback
- WebSocket gateway + echo + 重连
- 认证/速率限制中间件骨架与默认拒绝策略
- 绕过 Ingress 的暴露面收敛与集成测试（含 Ingress 与原生请求分流）

**UI hint**: yes

**验证类**: 容器模拟（模拟 `X-Ingress-Path` 前缀、刷新与 WebSocket）+ 静态（分流与拒绝路径的单测/集成测试）。

### Phase 6: Home Assistant 连接与自检

**Goal**: 后端在 Supervisor 环境下无需用户填写即可连上 Home Assistant，并把连接状态如实展示给用户，同时 token 不逸出后端。
**Depends on**: Phase 4（`ready` 探针与持久化）+ Phase 5（承载状态展示的 Web UI）
**Requirements**: HA-01, HA-02, HA-03, HA-04
**Success Criteria** (what must be TRUE):
  1. 在模拟 Supervisor 环境变量存在时，后端自动发现 HA 地址与 `SUPERVISOR_TOKEN`，用户无需在配置页填写任何凭据。
  2. 启动自检真实调用 HA API，结果（已连接 / 连接失败及原因 / 未配置）同时体现在 `ready` 状态与 Web UI 上，三态均可被判读。
  3. 断言与扫描可证明 HA token 不出现在任何 API 响应、日志、错误详情与前端产物中。
  4. 非 Supervisor 部署可通过配置覆盖 HA URL；localhost、link-local、云 metadata 与重定向到禁止地址被拒绝，超时与响应大小受限（单测覆盖允许的家庭局域网例外）。
**Plans**: TBD

计划切片（供 plan-phase 细化，预期 4 plans）：
- `HomeAssistantAdapter`：地址规范化、SSRF 校验、超时与重定向策略
- Supervisor 环境凭据发现与后端内存使用边界（不落库、不回传）
- 启动自检与 `ready` 联动、错误分类可读化
- Web UI 连接状态展示（三态）与脱敏断言测试

**验证类**: 容器模拟（mock HA 服务、模拟 Supervisor 环境变量）+ 静态（SSRF/重定向/脱敏单测）；真实 HA 连接 = **未验证**（无真实 HAOS 与凭据）。

### Phase 7: 文档与三类验证证据

**Goal**: 一个非专家用户能照着文档完成安装、升级、回滚、备份恢复与排障，且仓库里所有验证结论都明确属于哪一类证据。
**Depends on**: Phase 1–6（全部能力就位后才能写出可执行的文档与证据清单）
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06, VER-02, VER-03
**Success Criteria** (what must be TRUE):
  1. 按 `DOCS.md` 可从零走完「添加仓库 → 安装 → 启动 → 侧边栏打开」，其中容器模拟可执行的部分被实际跑通，HAOS 部分明确标注未验证。
  2. 升级与回滚步骤给出镜像可用性检查与版本对应关系，步骤可逐步执行而不需要用户猜测。
  3. 备份与恢复步骤包含 `/data` 快照方式、恢复后验证方法，并说明 Home Assistant 自身备份是否覆盖该目录需实测确认。
  4. 排障清单覆盖六类故障（看不到仓库、安装失败、启动失败、Ingress 404、WebSocket 断开、数据库不可写），每条都有可执行的判据而非泛泛建议。
  5. 仓库中存在可复现的容器模拟验收脚本（`docker run` + `/data` 挂载、重启与升级后数据保留、模拟 Ingress 前缀下页面与 WebSocket），以及一份区分「已运行 / 仅静态 / 未验证」的 HAOS 实机清单，且没有任何把容器模拟结论写成 HAOS 通过的地方。
  6. `README.md` 与 `CHANGELOG.md` 记录版本、变更内容与已知限制，Container 用户的 Compose 备用路径与 App 路径差异有明确说明。
**Plans**: TBD

计划切片（供 plan-phase 细化，预期 4 plans）：
- `DOCS.md` 安装与配置选项章节 + `README.md` / `CHANGELOG.md`
- 升级、回滚、备份/恢复章节（含版本对应与验证方法）
- 故障排查清单与 Compose 备用路径说明
- 容器模拟验收脚本 + 三类证据清单与 HAOS 实机验证表

**验证类**: 文档评审 + 容器模拟（按文档执行可执行部分）；HAOS 实机 = 未验证清单。

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. App 元数据与仓库可识别性 | 1/3 | In Progress | - |
| 2. 镜像构建与发布链路 | 0/TBD | Not started | - |
| 3. 运行时骨架 | 0/TBD | Not started | - |
| 4. 数据持久化与受控迁移 | 0/TBD | Not started | - |
| 5. Ingress Web UI 与认证边界 | 0/TBD | Not started | - |
| 6. Home Assistant 连接与自检 | 0/TBD | Not started | - |
| 7. 文档与三类验证证据 | 0/TBD | Not started | - |

## Notes

- **Phase 1 是风险前置阶段**：本路线图刻意把"Supervisor 是否能识别并安装"放在最前，而不是先做运行时再补元数据。若 Phase 1 的静态核对发现官方格式与 `docs/21` 的示例不一致，先更新规格与决策记录，再继续后续阶段。
- **Phase 5 的 Web UI 载体尚未决策**（`apps/mobile` Expo Web 导出 vs 本里程碑最小静态页），这是有意留白：该决策需要在 Phase 5 讨论时基于实际成本与 Ingress 技术要求作出并记录，路线图不预设结论。
- **需求总数修正**：REQUIREMENTS.md 顶部写 37 条，逐条清点为 38 条（APP 4 + IMG 5 + RT 5 + DATA 4 + HA 4 + ING 4 + SEC 3 + DOC 6 + VER 3）。本路线图按 38 条全覆盖映射，并已在 Traceability 中修正计数。
- **aarch64 与 HAOS 的诚实边界**：本路线图任何阶段的完成都不代表"已在真实 HAOS 上装过"。只有 Phase 7 的实机清单在真实设备上被勾选后，才能使用 HAOS 实机通过的措辞。
