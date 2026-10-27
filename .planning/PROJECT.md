# HomeWeave（织家）

## What This Is

HomeWeave（织家）是一个基于 Home Assistant 的 AI Home Operating System。用户用自然语言表达意图，系统在服务端完成意图理解、权限与风险评估、设备执行、结果验证和审计。

本里程碑交付的是它的**家庭部署地基**：把 HomeWeave 后端做成一个可从 Home Assistant OS 自定义 App 仓库一键安装的 Supervisor App，用户在 HA 侧边栏打开即可使用，无需手动装 Node.js、Docker、SQLite 或登录主机执行命令。Home Assistant Container 用户保留 Docker Compose 备用方式。

## Core Value

**HAOS 用户添加仓库 → 安装 → 启动 → 在 HA 侧边栏打开一个能跑的 HomeWeave。**

其他一切（AI、设备控制、原生移动端）都必须建立在这条链路真实可用之上。如果一键部署装不上、升级丢数据、或 Ingress 页面打不开，本项目的其余部分都没有意义。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 用户能在 HAOS 添加 HomeWeave 自定义仓库并在 Apps 页面看到它
- [ ] 用户点击安装后自动拉取预构建多架构镜像（amd64 / aarch64）
- [ ] 启动后可通过 HA 侧边栏（Ingress）打开 Web UI，动态 basePath 下资源、刷新、WebSocket 均正常
- [ ] 服务能自检并展示与 Home Assistant API 的连接状态，同时暴露 `live` / `ready` 探针
- [ ] SQLite 数据落在 `/data`，容器重启与版本升级后数据保留，迁移受控且可审计
- [ ] GitHub Actions 构建并发布 GHCR 多架构 manifest，镜像标签与 App 版本号一致
- [ ] Supervisor 凭据、token 与 API Key 不进入日志、API 响应或前端产物
- [ ] 安装、升级、备份、恢复、回滚与故障排查文档可被非专家用户按步执行
- [ ] 静态检查、容器模拟测试与 HAOS 实机验证的证据被明确区分，不混淆结论

### Out of Scope

- 设备控制与 Tool Registry / Policy Engine 执行链路 — 属于后续里程碑，本里程碑只保证部署与运行时骨架成立
- AI Agent、ModelProvider、Fast-Path 规划能力 — 依赖已可用的运行时与认证边界
- Expo 移动客户端（iOS / Android）与原生认证 — Ingress 是 Web 侧入口，原生端需要独立认证体系
- MCP Server、自动化发布、通知与语音 — 后续阶段
- 多用户 / 家庭权限模型 — 本里程碑只建立默认拒绝的认证边界骨架
- Home Assistant Container 的全自动化安装体验 — 仅提供 Compose 文档化备用路径

## Context

- 仓库当前状态：只有 22 份规格文档、`openapi.yaml`、`AGENTS.md`、`CLAUDE.md`、`CODEBUDDY.md` 与 `examples/home-assistant-app/*.example` 模板，**没有任何可运行代码**。本里程碑是从零建立最小后端与发布链路。
- 规格来源：`docs/01_PRD.md`（产品与验收）、`docs/02_ARCHITECTURE.md`（模块边界与任务模型）、`docs/07_HOME_ASSISTANT_INTEGRATION.md`（HA 集成）、`docs/08_SECURITY_AND_PRIVACY.md`（安全）、`docs/11_IMPLEMENTATION_ROADMAP.md`（阶段计划）、`docs/14_ENV_AND_DEPLOYMENT.md`（环境与部署）、`docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`（App 部署设计）、`docs/22_INITIAL_PROMPT_HA_APP_CODEBUDDY.md`（实现 Prompt）。
- 技术选型已在文档中定稿：Expo + React Native + TypeScript 客户端；NestJS + TypeScript 后端；Prisma + SQLite；pnpm workspaces monorepo；GHCR 发布；Supervisor App 为首选家庭部署。
- 文档中仍是占位符、实施时必须确定或实测的信息：GHCR `owner`、Git 仓库 URL、`maintainer`、Home Assistant 最低支持版本。
- 当前没有真实 Home Assistant OS 测试环境。因此验证结论必须分成三类：静态检查、容器模拟测试、HAOS 实机测试（未验证的要显式标注为未验证）。
- 官方 HA App 元数据格式、builder actions 与 `config.yaml` 字段会随 HA 版本演进，实施时须以官方文档与仓库示例现场核对，不能凭记忆写。

## Constraints

- **Tech stack**: Expo + React Native + TypeScript（客户端）；NestJS + TypeScript（后端）；Prisma + SQLite（数据）；pnpm workspaces（monorepo）。改动不得引入与之冲突的第二套栈。
- **Deployment**: 家庭首选部署是 HAOS Supervisor App，Home Assistant Container 走 Docker Compose 备用。App 元数据必须能被 Supervisor 识别。
- **Persistence**: SQLite 数据文件必须在 `/data`；任何升级路径都不得静默清空数据库。
- **Release order**: 必须"先发布镜像、再更新用户可见版本号"，避免用户看到装不上的新版本。
- **Security — credential boundary**: Supervisor API 凭据只保留在后端；Ingress token 不得作为原生 iOS/Android API 凭据；原生 API 需要独立认证、授权、审计与速率限制。
- **Security — no secrets**: HA token、provider API key、密码不得出现在前端代码、Expo public 环境变量、日志、错误详情、截图或模型 Prompt 中。
- **Security — single control path**: UI、Agent、MCP、自动化必须共用同一个服务端 Tool Registry / Policy Engine；不得复制设备控制路径。
- **Security — MVP guardrails**: 不允许 AI 无人值守解锁门锁或关闭安防；不允许自动发布未经用户确认的 AI 自动化。
- **Security — network exposure**: 不得把未受保护的设备控制接口暴露到公网；不得公开 Redis 或数据库端口。
- **Result honesty**: 命令被接受不等于设备状态已改变；无法确认时必须标记 `unknown`。测试未运行时不得声称通过。
- **Process**: 按 `docs/11_IMPLEMENTATION_ROADMAP.md` 分阶段交付，一次只完成可验收的小任务；不覆盖未提交的用户修改；不执行未经批准的破坏性迁移。
- **Docs sync**: 变更 API、数据模型、工具、权限策略或环境变量时，同步更新相关文档、`openapi.yaml` 与 `.env.example`。

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 家庭部署首选 HAOS Supervisor App，Compose 作备用 | 目标用户不该为了用 AI 家庭系统去学 Docker 与主机命令行；App 安装体验是产品的一部分 | — Pending |
| 本里程碑只做"部署优先垂直切片" | 一键部署是其余能力的前提；先让安装→启动→打开页面这条链路真实可用，再叠设备控制与 AI | — Pending |
| 排除 Expo 移动客户端与设备控制 | 保持单次交付可验收，避免在认证与权限边界尚未成形时扩张攻击面 | — Pending |
| 镜像经 GitHub Actions 推 GHCR 多架构 manifest | 用户安装时由 Supervisor 拉预构建镜像，不在家庭主机上编译 | — Pending |
| SQLite 落在 `/data`，启动时受控迁移 | `/data` 是 Supervisor 保证持久化的目录；迁移前置备份可避免升级丢数据 | — Pending |
| 后端同源服务 Ingress Web UI | Ingress 由 HA 反向代理注入动态路径前缀，避免额外域名、证书与 CORS 复杂度 | — Pending |
| 初始化 git 并原子提交规划产物 | 便于回溯每份规划与每阶段改动的来源，支持回滚 | — Pending |
| 跳过项目级领域研究，规划前按阶段做研究 | `docs/01-22` 已是完整规格，重复做项目级调研价值低；官方 builder actions 与 App 配置格式留到 Phase 1 现场核对 | — Pending |
| 验证结论分三类（静态 / 容器模拟 / HAOS 实机） | 没有真实 HAOS 环境时，不能把容器模拟结果当成实机通过 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-27 after initialization*
