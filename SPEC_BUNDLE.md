# HomeWeave（织家）完整规格整合版 — CodeBuddy + Home Assistant App

> 自动整合分文件规格。以 `docs/*.md`、`docs/openapi.yaml` 和项目规则为准。


---

# Source: README.md

# HomeWeave（织家）— 跨平台开发规格文档包（CodeBuddy 专用增强版）

> 面向腾讯 CodeBuddy、Codex、Claude Code 等 coding agent 的产品、架构与工程规格。默认客户端架构已统一为 **Expo + React Native + TypeScript + React Native Web**；后端采用 NestJS 模块化单体。

## 产品品牌

- 产品名称：**HomeWeave**
- 中文名称：**织家**
- 产品定位：AI Home Operating System
- 项目目录建议：`homeweave/`

## 核心技术决策

- iOS、Android 为正式客户端目标；Web 使用同一 Expo 应用的 React Native Web 目标，桌面管理界面尽量复用组件，但不承诺所有原生能力在 Web 上完全一致。
- 客户端代码位于 `apps/mobile/`，不创建第二套独立的 `apps/web/` 前端，除非未来经过 ADR 明确批准。
- 后端位于 `apps/api/`，通过 REST + WebSocket 提供能力。客户端不得直接连接 Home Assistant。
- UI、AI Agent、MCP 和自动化共用同一套服务层、Tool Registry 与 Policy Engine。
- 使用 pnpm workspaces 管理 Monorepo；不强制引入 Turborepo，除非构建规模需要。
- 具体依赖版本以创建项目时 Expo SDK 的兼容矩阵为准；使用 `npx expo install` 管理 Expo 相关依赖，不在文档里锁定可能过期的版本号。

## 文档索引

| 文件 | 用途 |
|---|---|
| `AGENTS.md` | 跨工具统一开发规则（CodeBuddy / Codex / Claude Code 等） |
| `CODEBUDDY.md` | CodeBuddy 项目上下文入口 |
| `.codebuddy/rules/*/RULE.mdc` | CodeBuddy IDE 项目规则（架构、安全、流程、Expo 专项） |
| `INITIAL_PROMPT_CODEBUDDY.md` | CodeBuddy 初始开发 Prompt 快捷入口 |
| `.env.example` | 后端环境变量模板（仅占位值，不含真实密钥） |
| `CLAUDE.md` | Claude Code 入口，引用统一规则 |
| `SPEC_BUNDLE.md` | 可整体提供给只接收单文件的 agent 的整合版 |
| `docs/00_PRODUCT_BRIEF.md` | 产品愿景、用户与成功指标 |
| `docs/01_PRD.md` | PRD、用户旅程、优先级与验收标准 |
| `docs/02_ARCHITECTURE.md` | 系统架构、模块职责、状态机与降级策略 |
| `docs/03_TECH_STACK_AND_REPO.md` | Expo 技术栈、Monorepo 和工程规范 |
| `docs/04_DATA_MODEL.md` | 数据模型、会话、推送设备与审计 |
| `docs/05_API_SPEC.md` | REST、认证、推送注册和 WebSocket 契约 |
| `docs/06_AGENT_AND_TOOLING.md` | Fast-Path、LLM 规划、Tool Registry 与任务执行 |
| `docs/07_HOME_ASSISTANT_INTEGRATION.md` | HA 接入、同步、能力映射和结果验证 |
| `docs/08_SECURITY_AND_PRIVACY.md` | 安全、密钥、SSRF、提示注入和隐私 |
| `docs/09_UI_UX_SPEC.md` | 跨平台导航、布局、交互与无障碍 |
| `docs/10_TEST_AND_ACCEPTANCE.md` | 前端、后端、原生构建、E2E 与安全测试 |
| `docs/11_IMPLEMENTATION_ROADMAP.md` | 分阶段实施计划与退出标准 |
| `docs/12_CODING_AGENT_GUIDE.md` | 可复制给 Codex / Claude Code 的指令模板 |
| `docs/13_ADR.md` | 架构决策记录 |
| `docs/14_ENV_AND_DEPLOYMENT.md` | 本地开发、Docker 后端、EAS 构建和发布 |
| `docs/15_GLOSSARY.md` | 统一术语 |
| `docs/16_MOBILE_APP_ARCHITECTURE.md` | 跨平台客户端、认证存储、离线、通知、深链接、构建细则 |
| `docs/18_INITIAL_PROMPT_CLAUDE_CODE_CODEX.md` | 可直接复制给 Claude Code / Codex 的初始开发 Prompt |
| `docs/19_CODEBUDDY_WORKFLOW.md` | CodeBuddy 规则加载、工作流和推荐斜杠命令 |
| `docs/20_INITIAL_PROMPT_CODEBUDDY.md` | CodeBuddy 初始 Prompt 与 Phase 1 Prompt |
| `docs/openapi.yaml` | API 契约起始文件 |
| `docs/agent-checklist.json` | 可供自动化和 coding agent 使用的验收清单 |

## 推荐开发顺序

1. 将该目录放到项目根目录。
2. 使用 CodeBuddy 时先检查 `CODEBUDDY.md` 与 `.codebuddy/rules/` 是否加载；让 agent 先阅读 `AGENTS.md`、`docs/01_PRD.md`、`docs/02_ARCHITECTURE.md`、`docs/03_TECH_STACK_AND_REPO.md`、`docs/16_MOBILE_APP_ARCHITECTURE.md` 和 `docs/18_INITIAL_PROMPT_CLAUDE_CODE_CODEX.md`。
3. 先完成 Phase 0 仓库审查，不要立即大规模重写。
4. 按 `docs/11_IMPLEMENTATION_ROADMAP.md` 分阶段实现，每阶段运行检查和测试后再继续。

## MVP 总体边界

- iOS/Android 共用 Expo 客户端；React Native Web 提供可复用的 Web 目标。
- 首次设置、认证、Home Assistant 接入、实体同步、自动生成仪表盘。
- 灯光、开关、空调、窗帘和场景的能力感知控制。
- 自然语言查询、Fast-Path、结构化多设备规划、任务记录和结果验证。
- 首选部署：Home Assistant OS 通过 Supervisor 安装/更新 HomeWeave App 容器，GHCR 提供预构建多架构镜像；Home Assistant Container / 通用 Linux 保留 Docker Compose 备用方案。EAS 或受支持的原生构建流程负责移动应用构建与商店发布。
- MVP 不允许 AI 无人值守解锁门锁或关闭安防，也不允许未经用户确认发布 AI 自动化。

## 单一事实来源

`docs/*.md` 与 `docs/openapi.yaml` 是分文件规范的事实来源；`SPEC_BUNDLE.md` 由它们自动整合，便于把全部规格一次性提供给 coding agent。若两者发生冲突，以分文件规格和最新 ADR 为准，并修正整合版。

## 官方参考

- [Expo Universal App 教程](https://docs.expo.dev/tutorial/introduction/)
- [Expo Router](https://docs.expo.dev/router/introduction/)
- [Expo Development Builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [EAS Build](https://docs.expo.dev/build/introduction/)
- [React Native 平台专用代码](https://reactnative.dev/docs/platform-specific-code.html)


## CodeBuddy 专用说明

本包增加了腾讯 CodeBuddy IDE 使用入口 `CODEBUDDY.md`、项目规则目录 `.codebuddy/rules/` 和 `docs/19_CODEBUDDY_WORKFLOW.md` / `docs/20_INITIAL_PROMPT_CODEBUDDY.md`。规则格式按 CodeBuddy 官方规则文档组织；不同 IDE/CLI 版本的加载行为可能有差异，首次使用请在 CodeBuddy Rules 页面确认 Always / Agent Requested / Manual 的启用情况，并在规则变化后新建会话。首次任务请先执行 Phase 0 仓库审查。

官方参考：
- CodeBuddy 规则：https://www.codebuddy.ai/docs/zh/ide/User-guide/Rules
- CodeBuddy 快速开始：https://www.codebuddy.ai/docs/ide/Getting-Started/Quickstart
- CodeBuddy 斜杠命令：https://www.codebuddy.ai/docs/zh/ide/User-guide/Slash-Commands

## 首选家庭部署方式

Home Assistant OS 用户优先使用 Home Assistant App（旧称 Add-on）：添加包含 `repository.yaml` 的 Git 仓库，在 Apps 中点击安装；Supervisor 拉取 GHCR 中预构建镜像。用户无需 SSH 到 HA 主机或手动运行 Docker 命令。Home Assistant Container 不提供 Apps 商店，使用 Compose 备用方案。详见 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`。


---

# Source: AGENTS.md

# HomeWeave — Unified Coding Agent Rules (CodeBuddy / Codex / Claude Code / OpenCode / DSH)

你正在开发 HomeWeave（织家）。先阅读 `README.md` 与 `docs/` 中相关规格。本文档是跨工具统一规则源；`CODEBUDDY.md`、`CLAUDE.md` 等入口文件只能引用或摘要本规则，不得引入冲突约束。

## 1. 工作流程

1. **先检查，再修改**：检查仓库、分支、未提交改动、依赖、测试、构建配置和当前架构。不要覆盖用户工作。
2. **先计划后编码**：复杂任务先给出简短计划、影响文件与验收方式，然后执行当前能安全完成的工作。
3. **小批量交付**：一次只实现一个可验收阶段；运行对应 lint、typecheck、unit/integration/E2E 测试。
4. **尊重已有实现**：若仓库已存在成熟前端，先报告与 Expo 目标的差距，不得静默大规模迁移。新项目/空前端默认使用 `apps/mobile` 中的 Expo Universal App。
5. **不虚报**：没有运行的测试不能声称通过。真实 HA、原生设备、APNs/FCM 和商店发布未验证时要明确说明。
6. **维护规格**：修改 API、DB、工具、权限或环境变量时同步更新相关 docs、OpenAPI 和 `.env.example`。

## 2. 不可违反的架构规则

- iOS、Android 和可选 Web 共用 `apps/mobile` 的 Expo / React Native 代码；除 ADR 批准，不创建第二套独立 Web UI。
- 前端不能直接访问 Home Assistant 或持有 HA token / LLM API key。
- AI 模块不能直接请求 HA API、直接写数据库或执行任意代码。
- UI、Agent、MCP 和自动化必须通过同一组 Application Services / Tool Registry。
- 权限、风险等级、确认要求由服务器端定义；不能信任模型输出中的权限或风险字段。
- 所有外部输入都要做 schema 校验；TypeScript 使用 `strict`，边界数据从 `unknown` 开始验证。
- Home Assistant 是设备状态事实来源；命令发送成功不等于设备状态成功。
- 无法验证结果时返回 `unknown`，不得生成虚假的成功摘要。
- 高风险动作不得由 AI 无人值守执行。MVP 禁止 Agent 自动解锁门锁或关闭安防。
- 不提供通用任意 URL、Shell、代码执行或未受控 HA service call 工具。
- 日志和错误响应不得包含密码、token、API key、Cookie 或完整敏感上游响应。
- 原生客户端使用系统安全存储保存 refresh token / 必要的秘密；Web 目标采用安全 cookie 策略，不将长期凭据放进 `localStorage`。
- 不依赖 iOS/Android 后台进程持续运行家庭自动化；可靠任务必须在后端执行。
- 家庭部署首选 Home Assistant OS App（Supervisor 管理容器），规范见 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`；Home Assistant Container 使用 Compose 备用部署。
- HA Ingress 只用于浏览器 UI；原生 App 不得使用 Ingress token 作为 API 凭据。Supervisor API proxy token 必须留在服务端且按高权限秘密处理。

## 3. 工程规则

- 默认使用 pnpm workspaces；除非仓库现有包管理器明确不同。
- Expo 相关依赖使用 `npx expo install` 或等价的 Expo 兼容命令，运行 `npx expo install --check` 和 `npx expo-doctor`（若当前 SDK 支持）。不凭空固定过期版本。
- 客户端只依赖 `packages/contracts` / `packages/api-client` 与后端契约；不得复制 API schema。
- 共享包不得无意引入 Node-only API、DOM-only API 或 React Native 不支持的模块。
- 尽量共享平台无关业务与可跨平台 UI；平台差异集中于 `.web.tsx` / `.native.tsx` / `.ios.tsx` / `.android.tsx` 或 platform adapter。
- UI 必须处理 loading、empty、error、offline、stale、unauthorized 和 partial result 状态。
- 不提交真实密钥、`.env`、家庭个人数据或真实 HA 导出。
- DB migration 必须有测试；关键权限、状态转移、幂等、参数校验和失败路径必须有回归测试。
- 不无故增加依赖；交付时说明新增依赖原因。

## 4. 每次交付必须汇报

1. 已完成内容和未完成项。
2. 改动文件与重要设计决定。
3. 实际运行过的命令和测试结果。
4. 未执行测试、真实设备验证缺口、风险与下一项最小任务。

## 5. 推荐首条任务

“阅读 `docs/12_CODING_AGENT_GUIDE.md`，先检查仓库和未提交改动，确认现有代码是否适合直接采用 Expo Universal App。输出差距报告和分阶段计划；若是空项目，按文档以 `apps/mobile` + `apps/api` + `packages/*` 建立基础骨架。不要一次性实现所有功能。”


---

# Source: CODEBUDDY.md

# HomeWeave（织家）— CodeBuddy Project Context

你正在开发 HomeWeave（织家），一个基于 Home Assistant 的 AI Home Operating System。

## 首次进入项目必须阅读
- `AGENTS.md`：跨工具统一开发与安全规则（事实上的详细工程约束）。
- `README.md`：项目概览与文档导航。
- `docs/01_PRD.md`：产品需求与验收标准。
- `docs/02_ARCHITECTURE.md`：模块边界、状态与任务模型。
- `docs/03_TECH_STACK_AND_REPO.md`：技术栈和目录结构。
- `docs/08_SECURITY_AND_PRIVACY.md`：安全与隐私要求。
- `docs/10_TEST_AND_ACCEPTANCE.md`：测试和验收。
- `docs/11_IMPLEMENTATION_ROADMAP.md`：阶段计划。
- `docs/16_MOBILE_APP_ARCHITECTURE.md`：Expo 跨平台架构。
- `docs/19_CODEBUDDY_WORKFLOW.md`：CodeBuddy 使用方式。
- `docs/20_INITIAL_PROMPT_CODEBUDDY.md`：CodeBuddy 初始开发 Prompt。
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`：Home Assistant OS App 首选部署设计。
- `docs/22_INITIAL_PROMPT_HA_APP_CODEBUDDY.md`：实现 HA App 发布与安装体验的专用 Prompt。

## 核心架构
- 客户端：Expo + React Native + TypeScript，位于 `apps/mobile/`；iOS/Android 共用代码，Web 可用 React Native Web。
- 后端：NestJS + TypeScript，位于 `apps/api/`；家庭首选部署为 Home Assistant OS 的 Supervisor App，Container 用户使用 Compose 备用方案。
- Monorepo：pnpm workspaces；共享契约/校验/领域模型放在 `packages/`。
- Home Assistant 是设备状态事实来源；客户端只访问自家后端，不直接保存 HA token 或模型 API key。
- UI、Agent、MCP 与自动化共用服务端 Tool Registry、Policy Engine 和 Application Services。

## 不可违反的安全规则
- AI 负责理解和规划；服务端负责 schema 校验、授权、风险评估、执行、审计与结果验证。
- 模型输出的权限、风险等级和确认字段都不可信，必须由服务端重算。
- 命令被接受不代表设备已执行；不能确认时结果必须是 `unknown`。
- MVP 不允许 AI 无人值守解锁门锁或关闭安防，也不允许自动发布未确认的 AI 自动化。
- 禁止任意 Shell、任意 URL、任意代码执行和未受控 Home Assistant service call 工具。
- 不覆盖用户未提交修改；不执行未批准的破坏性迁移；不虚报测试结果。

## 工作约定
1. 先检查 Git 状态、仓库现状和相关文档，再规划并修改。
2. 按 `docs/11_IMPLEMENTATION_ROADMAP.md` 分阶段交付，一次只完成可验收的小任务。
3. 对新增/修改的 API、数据模型、工具、权限或环境变量同步更新相关文档、OpenAPI 和 `.env.example`。
4. 运行实际适用的 lint、typecheck、unit/integration/E2E 测试；未运行的检查要明确列出。
5. 每次汇报：改动摘要、改动文件、测试命令和真实结果、风险、未完成项、下一步建议。

## CodeBuddy 规则提示
项目专属规则位于 `.codebuddy/rules/`。新增或修改规则后，按 CodeBuddy 当前版本的行为开启新会话，并在需要时到 IDE 的 Rules 设置中确认规则类型（Always / Agent Requested / Manual）与启用状态。


---

# Source: docs/00_PRODUCT_BRIEF.md

# 00 — Product Brief

## 产品品牌

- 产品名称：**HomeWeave**
- 中文名称：**织家**
- 品牌定位：AI Home Operating System
- 品牌主张：One Home. One Intent. Everything in Sync.
- 中文表达：一个家庭，一个意图，让所有设备协同工作。

## 产品愿景

让用户不必学习智能家居系统，而是让智能家居系统理解用户的需求。产品从传统设备控制面板，演进为基于 Home Assistant 的家庭操作系统：确定性的可视化控制、自然语言目标驱动任务、可解释执行和可控的主动建议并存。

## 平台策略

- **iOS 与 Android：** 正式一等客户端，以 Expo + React Native + TypeScript 维护一套主要 UI/业务代码。
- **Web：** 使用同一 Expo 应用的 React Native Web 目标，覆盖核心仪表盘、房间、设备、场景、AI、任务与设置。复杂管理功能应验证 Web 体验，不要求每项移动原生能力都在 Web 里实现。
- **平板：** 通过响应式布局支持墙面平板、桌面浏览器或原生平板 App。
- **后端：** NestJS 模块化单体；Docker Compose 部署后端、DB 和必要依赖；移动 App 独立构建与发布。

## 用户与问题

- 普通家庭用户：不了解实体 ID、服务调用和自动化语法，希望简单可靠。
- Home Assistant 爱好者：希望快速生成可自定义的仪表盘，并通过自然语言控制多个设备。
- 高级用户/维护者：需要调试信息、可扩展集成、权限边界与可恢复任务记录。

关键痛点：设备多、设置复杂、意图和设备状态割裂、跨设备操作需要手动编排、AI 操作不可验证、错误难诊断。

## 价值主张

1. 以目标而非单一设备为交互中心。
2. 首次连接后尽量自动生成可用 UI。
3. AI 可以建议和规划，但执行必须受到确定性安全层约束。
4. 每个任务都有步骤、执行结果、验证结果和可追溯记录。
5. iOS、Android 与 Web 尽量共享同一客户端工程，减少重复维护。
6. UI、API、Agent 和 MCP 使用同一套设备能力与策略服务。

## 产品原则

- 可靠性优先于“看起来聪明”。
- 聊天不是唯一入口；常用操作必须可以直接点按。
- 区分事实、推断、假设和未知。
- 主动程度由用户控制；默认不自主修改规则。
- 设备状态以 Home Assistant 为准。
- 默认局部部署、最少外传数据。
- 先模块化单体，按真实需求拆分。
- 尽量统一代码，允许有限且清晰的 iOS/Android/Web 差异。

## 成功指标

- 首次 HA 连接成功率、首次设备可控制耗时。
- 基础命令成功率、多步骤任务完成率、误操作率。
- 任务结果错误标记成功的比例（目标为 0）。
- 未确认高风险操作数（目标为 0）。
- 自动生成面板后无需大量手工修复的比例。
- iOS/Android 核心旅程通过率与崩溃率。
- 用户修正 AI 计划的比例、任务完成耗时、单次成功任务模型成本。

建议初始目标：基础控制任务成功率 ≥98%（排除设备本身离线等外部因素）；未授权操作和高风险未确认操作为 0。真实运行后根据基线调整。


---

# Source: docs/01_PRD.md

# 01 — 产品需求文档（PRD）

- 产品名：HomeWeave（织家）
- 版本：1.1（Expo Universal App 统一架构）
- 状态：MVP 开发基线
- 客户端：Expo Universal App（iOS / Android 为一等目标；通过 React Native Web 支持 Web；手机、平板、桌面自适应）
- 客户端单一工程：`apps/mobile/`；不维护独立 React + Vite Web UI，除非通过 ADR 批准
- 移动 App 通过 REST + WebSocket 连接自托管 NestJS 后端，绝不直接连接 Home Assistant
- 核心集成：Home Assistant
- 部署：本地/家庭服务器/NAS 上的 Docker Compose

## 1. 产品目标

以家庭状态为上下文，使用户能够通过设备卡片、场景或自然语言可靠地完成家庭任务。产品必须在可用性、可解释性、安全性和维护成本之间保持平衡。

## 2. MVP 范围

### P0 必须
- 首次设置管理员与登录/登出。
- 配置、测试、禁用和重新同步 Home Assistant 集成。
- 同步区域、设备、实体、属性、能力及状态新鲜度。
- 自动生成基础仪表盘；支持隐藏、排序、固定常用设备。
- 支持灯光、开关、空调、窗帘、场景控制；传感器只读。能力按实际实体属性判断。
- 支持状态查询、单设备自然语言控制、有限多设备计划。
- 提供 Fast-Path；没有 LLM 时支持的简单命令仍可工作。
- 统一 Tool Registry、schema 校验、权限策略、任务编排与结果验证。
- 多设备计划可预览、编辑、确认；逐步骤展示结果。
- 提供任务历史、错误说明、健康检查和基本诊断。
- 在前台通过 WebSocket 接收家庭状态与任务实时更新；断线后重新获取快照。
- Docker Compose、持久化数据、备份/恢复说明。
- Expo 客户端在 iOS 与 Android 可启动、可连接后端并完成核心设备控制旅程；Web 通过同一工程构建。
- 默认不开放未受控的通用服务调用；不允许 AI 无人值守解锁门锁或关闭安防。

### P1 建议随后实现
- 结构化用户偏好与可管理记忆。
- 主动建议（默认建议而非自动执行）。
- AI 自动化草稿、dry-run、确认后发布。
- 原生推送通知（APNs/FCM 经通知服务转发；配置供应商凭据后启用）。
- MCP server，复用同一工具和权限层。
- 基本国际化（简体中文/英文）。

### 不在 MVP 范围
- 多租户 SaaS 与计费。
- 本地模型推理服务或模型训练。
- 自动解锁、关闭警报或其他高风险动作的无人值守执行。
- 未确认直接发布 AI 自动化。
- 复杂人脸识别、全自主长期规划、多 Agent 协作框架。

## 2.1 客户端平台要求（跨平台专项）

- 所有核心功能优先实现于 `apps/mobile/` 中的共享 React Native 组件与业务模块。
- iOS 与 Android 是 MVP 正式目标；Web 是同一代码库的支持目标，用于家庭浏览器/桌面管理。
- 平台特定文件仅用于真实平台差异（如通知权限、系统分享、安全存储、原生设置）；不得复制整套业务页面。
- 远程 API 地址必须可由用户配置。首次启动支持手动填写；QR 配对作为后续增强项。不得假设手机一定能解析 `homeassistant.local` 或能够自动发现服务器。
- App 使用安全存储保护 refresh token；Web 使用安全 cookie 策略。客户端不保存 HA token。
- 网络断开时可以展示带时间戳的缓存状态，但不允许默认排队执行物理设备控制命令。恢复连接后先刷新状态，再接受新命令。
- iOS/Android 后台任务不可作为可靠执行器；任务由后端持久化执行。推送只是通知，不是设备状态事实来源。
- 需要原生权限时，按需请求、说明原因并优雅降级。

## 3. 用户角色

- **管理员**：配置集成、模型、用户、权限和安全设置；查看全部任务与日志。
- **家庭用户**：操作授权范围内的设备与场景，查看任务记录和个人偏好。MVP 可先单管理员，但内部数据模型应为多用户留出空间。
- **访客（未来）**：只使用显式开放的设备/场景，无配置权限。

## 4. 核心用户旅程与验收

### A. 初次安装
1. 首次进入显示安装向导；未初始化时只开放创建管理员接口。
2. 设置管理员凭据。
3. 输入 HA base URL 与 token，选择连接名称。
4. 服务端测试 URL、认证、REST 与 WebSocket。
5. 展示发现的区域/实体预览并确认导入。
6. 自动生成仪表盘，进入首页。

验收：token 永不回传；连接失败提供可行动错误；导入幂等；无连接时不得伪造真实设备数据。

### B. 手动控制
1. 用户打开房间/设备卡片。
2. 发起控制操作，UI 显示执行中状态并暂时防止重复提交。
3. 后端检查权限、能力和参数。
4. HA 接受操作后，服务监听状态事件或查询状态。
5. 返回 succeeded/failed/unknown 并更新 UI。

验收：HA 接受请求但设备未达到目标状态时，不能显示为成功；设备离线和未知状态需要明确呈现。

### C. 自然语言命令
例：“把客厅主灯调到 30%。”
1. Agent 解析意图并解析实体候选。
2. 候选唯一且能力明确时尝试 Fast-Path；否则通过 LLM 生成结构化计划或请求澄清。
3. 服务端校验参数、权限和风险。
4. 执行并验证状态。
5. 返回简洁结果及任务详情。

验收：实体歧义不可猜；不支持能力明确告知；没有模型服务时 Fast-Path 仍能工作。

### D. 多设备任务
例：“准备观影环境，保留过道灯。”
1. 获取相关区域、设备能力、状态与明确偏好。
2. 生成结构化计划和假设列表。
3. 服务端重新计算权限、风险和确认要求。
4. 预览中允许移除/修改步骤。
5. 确认后创建任务并逐步执行。
6. 汇总各步骤成功、失败和未知项。

验收：部分成功不得显示全部成功；未经确认的步骤不能执行；模型输出不得触发任意代码或任意 API。

### E. AI 生成自动化
例：“每天晚上 11 点，如果客厅无人，就关闭客厅灯。”
1. 转换成结构化草稿（触发器/条件/动作/异常行为）。
2. 检查每个条件是否有数据源支持。
3. 展示预览与 dry-run 结果。
4. 用户确认后才发布。

验收：无可靠 presence 源时阻止发布并说明原因；不得把“没有检测到活动”当成“确认无人”。

### F. 移动端首次连接与服务器配置
1. 用户安装 iOS 或 Android App 并打开。
2. 未配置服务器时显示欢迎/连接向导，用户输入服务器 URL；未来可扫码导入一次性配对配置。
3. App 验证 URL 格式和服务器健康状态。生产远程连接要求 HTTPS；允许 HTTP 的开发/家庭局域网例外必须有明确安全约束。
4. 用户登录；native access token 仅保留在内存，refresh token 存储于系统安全存储。
5. 获取家庭摘要和仪表盘，允许更换服务器或退出登录。

验收：连接失败有可读诊断；重新启动后安全恢复登录；登出后删除本机 token；服务器 URL 变更后清理原服务的缓存与连接。

### G. 跨平台状态与重连
1. App 连接 WebSocket 并获取最新快照。
2. 状态更新由后端事件推送到客户端缓存。
3. 断线时标记数据 stale，并退避重连。
4. 恢复后重新拉取快照，再应用增量事件。

验收：断线缓存不显示为实时状态；不在客户端后台维持关键任务；重连后不能把旧事件覆盖新状态。



## 5. 功能需求清单

### F-001 认证与设置
- 首次管理员初始化只能成功一次；竞争请求应安全失败。
- 密码采用 Argon2id 或 bcrypt 等成熟算法存储哈希。
- 会话有过期与退出机制；生产环境不使用默认弱密码。
- 开发环境允许显式开启无认证模式，但生产启动必须拒绝该配置。

### F-002 HA 集成
- 创建、测试、编辑、禁用、同步、删除连接。
- token 在服务端安全存储，不在 API 响应和日志中出现。
- 显示连接状态、最近成功同步时间和脱敏错误码。
- 网络请求有超时、有限重试和请求 ID。

### F-003 设备目录
- 同步区域、设备、实体、支持属性、状态和可用性。
- 内部 ID 与 HA entity_id 分离；`integrationId + externalId` 唯一。
- 支持未分类区域；设备能力按实际属性动态生成。
- 重新同步不得覆盖用户的布局或显示名覆盖项。

### F-004 仪表盘
- 按区域自动生成初始布局；未分类实体放到未分类分组。
- 用户可隐藏、排序、固定设备和场景。
- 支持 loading/empty/error/offline/stale 视觉状态。
- 不将所有实体属性堆到首页。

### F-005 设备控制
- 支持灯光、开关、climate、cover、scene；sensor 为只读。
- 能力必须由 HA 实际属性推导，不能假设同 domain 设备都支持相同功能。
- 控制前校验实体、参数范围、权限与状态新鲜度。
- 控制后监听状态事件并在超时后查询；最终不明则 `unknown`。
- 记录来源、任务 ID、执行耗时、脱敏参数摘要和验证结果。

### F-006 场景
- 查看和激活 HA 场景。
- 可创建应用侧场景（目标设备和目标状态）。
- 执行前显示影响范围；部分失败逐项呈现。
- 编辑/删除具备权限检查和审计记录。

### F-007 AI 助手
- 处理普通问答、状态查询、单设备命令、有限多设备任务和场景建议。
- 区分 answer / clarification_required / plan_ready / needs_confirmation / executing / result。
- 结构化模型输出必须经 schema 验证。
- LLM 超时、限流或格式错误时安全降级，不得绕过工具策略。

### F-008 Tool Registry 与任务
- 工具定义包含 schema、权限、风险、确认、超时、幂等和验证策略。
- 所有入口复用同一执行服务。
- 任务状态至少包括 `draft`、`needs_confirmation`、`queued`、`running`、`succeeded`、`partially_succeeded`、`failed`、`unknown`、`cancelled`。
- 关键状态变更持久化；重启后能发现并恢复/标记中断任务。

### F-009 执行历史和审计
- 记录目标、计划版本、工具调用、步骤状态、结果验证和错误码。
- 日志与 UI 对敏感字段脱敏。
- 可按时间/状态/来源筛选。
- 保留期限可配置。

### F-010 偏好/记忆（P1）
- 只将明确偏好、用户确认规则或经确认的建议存入可影响执行的记忆。
- 推断型记忆要标记来源/置信度，默认不能驱动设备执行。
- 用户可查看、修改、禁用、删除。

### F-011 主动建议（P1）
- 默认建议模式，不主动执行。
- 建议需有证据、触发原因、时间和去重键。
- 支持接受、忽略、稍后提醒和关闭同类建议。
- 设冷却时间，避免同一建议反复打扰。

### F-012 自动化草稿（P1）
- 生成 schema 化规则草稿，校验触发、条件、动作与数据源。
- 提供 dry-run 和用户确认；支持版本和关闭。
- 不接受任意模型生成 YAML 直接执行。

### F-013 实时状态（P0）
- HA WebSocket 状态更新同步到应用与授权客户端。
- 客户端重连先获取快照再订阅增量。
- 定期对账以修复漏事件导致的漂移；断连状态标记 stale。

### F-014 诊断与健康
- `health/live` 与 `health/ready`。
- 管理员诊断 HA、DB、模型提供方和后台任务状态。
- 错误消息清楚且不泄露内部敏感信息。

### F-015 跨平台客户端工程
- 使用 Expo + React Native + TypeScript，入口 `apps/mobile/`，通过 React Native Web 生成 Web 目标。
- 用 Expo Router 管理路由；用 TanStack Query 管理服务器数据，用轻量 UI store 管理本地界面状态。
- API schema/types 从共享契约包或 OpenAPI 生成，避免客户端和服务端手写重复类型。
- 核心页面至少包含首页、房间、设备详情、场景、AI 助手、任务详情和设置。
- iOS/Android 的核心用户旅程必须一致；平台差异集中在 adapter 或平台专用文件。

### F-016 客户端安全存储与通知
- 原生端使用 `expo-secure-store` 或项目验证过的安全存储库保存 refresh token；access token 默认仅在内存中。
- Web 使用 HttpOnly、Secure、SameSite cookie 与 CSRF 防护；不得将长期 refresh token 放入 localStorage。
- Push token 绑定到用户与安装实例，支持失效、注销和轮换；push payload 不包含敏感设备状态或凭据。
- Push 为提示机制；用户打开 App 后仍需从后端获取权威任务结果。
- 通知权限在需要时解释后申请；拒绝权限不得阻断核心控制功能。

## 6. 非功能需求

- **安全**：默认拒绝、最小权限、密钥不进前端、高风险需确认。
- **可靠**：超时、有限重试、幂等、可恢复任务、结果验证。
- **性能**：本地 API P95 目标 <500ms（不含 HA 和 LLM 上游延迟；需基准测试确认）。
- **可观测性**：结构化日志、requestId、correlationId、任务步骤耗时。
- **可维护性**：模块边界明确，外部系统通过 adapter 接入。
- **可访问性**：键盘支持、语义控件、状态不限于颜色表达。
- **隐私**：外部模型只发送必要上下文；可禁用 AI。
- **部署**：后端容器健康检查、持久化、备份/恢复、版本升级说明；移动端用 EAS Build 或经验证的原生构建流程发布。
- **跨平台**：共享代码为主，明确记录 `.ios` / `.android` / `.web` 差异；不能因为 Web 渲染成功就宣称原生行为已验证。
- **客户端性能**：设备列表和任务列表分页/虚拟化；实时状态增量更新，不因每个状态事件重新渲染整棵页面。

## 7. 边界情况

- HA 断连：停止新控制或明确拒绝；缓存状态显示过期时间。
- LLM 不可用：手动控制和受支持 Fast-Path 继续工作。
- 状态验证超时：unknown，并支持重新查询。
- 部分执行失败：逐项展示，不无限重试。
- 实体歧义：澄清，而不是猜测。
- 能力不支持：说明限制，不生成虚假操作。
- 权限不足：拒绝执行并记录审计。
- 高风险操作：即时明确确认；MVP 不支持无人值守 AI 自动执行。


---

# Source: docs/02_ARCHITECTURE.md

# 02 — 系统架构

## 架构选择

采用 **Monorepo + 模块化后端单体 + Expo Universal Client**。iOS、Android 和可选 Web 共享主要客户端代码；业务规则、设备控制与 AI 执行逻辑集中在 NestJS 后端。MVP 不拆微服务。

## 系统上下文

```text
┌──────────────────────────────────────────────────┐
│ apps/mobile — Expo + React Native + TypeScript   │
│ iOS / Android / Web (React Native Web)            │
│ Router · UI · API Client · Query Cache            │
└─────────────────────┬────────────────────────────┘
                      │ HTTPS REST + WSS
                      ▼
┌──────────────────────────────────────────────────┐
│ apps/api — NestJS Modular Monolith                │
│ Auth · API · Application Services · Agent         │
│ Tool Registry · Policy Engine · Task Orchestrator │
│ Audit · Event Gateway · Notification Service      │
└────────────┬─────────────────┬────────────────────┘
             │                 │
             ▼                 ▼
       SQLite / Prisma     Model Provider Adapter
       optional Redis      (server-side only)
             │
             ▼
 HomeAssistantAdapter — REST + WebSocket — Home Assistant — Devices
```

## 客户端职责

- 展示 UI、收集用户输入、缓存非权威 UI/查询数据、发送命令请求、展示任务状态。
- 不直接访问 HA，不持有 HA Token 或模型供应商 API Key。
- 不承载可靠后台任务；App 被操作系统挂起时，后端任务仍应继续执行。
- 维护服务器连接配置和认证会话；原生敏感信息写入系统安全存储。
- WebSocket 重连后先拉取 REST 快照，再接收增量事件。
- 客户端状态为服务端缓存/视图模型，不能作为物理设备最终状态的事实来源。

## 后端模块职责

- `auth`：身份、会话、角色和权限上下文。
- `integrations/home-assistant`：HA 协议、token、连接管理、重试、事件归一化。
- `device-registry`：外部实体到内部实体的映射、能力和展示元数据。
- `home-state`：状态快照、区域摘要、数据新鲜度。
- `device-command`：能力校验、参数校验、服务调用、状态验证。
- `scenes`：场景定义、预览、执行和部分失败汇总。
- `dashboard`：默认布局生成、用户覆盖配置。
- `agent`：意图解析、Fast-Path、LLM 结构化计划。
- `tools`：工具 schema、授权、风险和执行 handler。
- `tasks`：持久化任务状态机、步骤、取消、重试和恢复。
- `memory`：可查看和删除的结构化偏好。
- `suggestions`：基于规则/事件的可解释建议。
- `events`：状态变更、任务事件、去重、广播。
- `notifications`：Push token 注册、通知编排和脱敏 payload。
- `audit`：安全操作审计与脱敏。

## 共享包边界

- `packages/contracts`：请求/响应/事件 schema 与共享类型；不包含平台 UI。
- `packages/api-client`：REST/WebSocket 封装、认证刷新、错误转换和 request ID。
- `packages/domain`：纯 TypeScript 领域规则；不得依赖 React Native、DOM 或 Node 专有 API。
- `packages/validation`：Zod schema 与边界验证。
- `packages/design-tokens`：颜色、间距、字号、圆角和层级等跨平台 token。
- `packages/ui`：不依赖具体路由与业务服务的 React Native UI primitives。

共享包必须保持平台无关。原生通知、安全存储和浏览器 cookie 等能力通过客户端 adapter 注入，不可把平台专属 API 泄漏进 domain 层。

## 状态权威原则

- Home Assistant 是设备当前状态的事实来源。
- 数据库里的实体状态只是缓存快照，必须带 `observedAt` 和 `stale`。
- 发送命令成功不代表设备已达到目标状态。
- 优先等 HA 事件，超时后主动查询；不可验证就返回 `unknown`。
- HA 断连时显示最后已知状态和时间，禁止冒充实时状态。

## 任务状态机

```text
draft ──► needs_confirmation ──(confirmed)──► queued ──► running
  │                 │                         │            ├─► succeeded
  │                 └──(expired/cancelled)     │            ├─► partially_succeeded
  └───────────────────────────────────────────┘            ├─► failed
                                                           ├─► unknown
                                                           └─► cancelled
```

约束：`draft` 不执行；过期确认不能执行；running 任务使用持久状态；重启后恢复或标记为 unknown；终态不能静默改为成功。

## 事件机制

事件包含 `eventId`、`eventType`、`occurredAt`、`source`、`correlationId`、`schemaVersion`、`payload`。MVP 可先用进程内事件和持久化任务；若使用 Redis/BullMQ，必须先持久化关键任务状态，再投递队列。处理重复事件、重试与幂等是必需项。

## 故障降级

| 故障 | 预期行为 |
|---|---|
| LLM 超时 | 手动控制/Fast-Path 仍可用；复杂任务提示模型不可用 |
| HA WebSocket 断开 | 退避重连、标 stale、REST 对账 |
| HA REST 调用失败 | 任务失败，不显示成功 |
| DB 不可用 | readiness 失败；拒绝不能持久化的写操作 |
| 客户端失去网络 | 展示最后已知状态并标 stale；默认不排队发送物理控制命令 |
| Push 服务不可用 | App 内任务状态仍可靠；记录通知失败但不回滚设备操作 |
| Redis 不可用（若启用） | 按用途降级；可靠队列不可用时暂停后台任务并告警 |
| 模型输出不合法 | schema 验证失败，有限重试或澄清，不执行 |
| 设备状态验证超时 | unknown，支持后续重新验证 |

## 部署拓扑

- `api`：NestJS API + backend task runner + WebSocket Gateway，Docker Compose 部署。
- `db`：SQLite 持久化文件（单实例）；后续需要时评估 PostgreSQL。
- `redis`：可选，明确需要持久队列/跨进程协调后启用。
- `mobile`：不是服务端容器；通过 EAS / 原生工具链构建 iOS 和 Android 安装包并发布。
- `web`：同一 `apps/mobile` 用 React Native Web 导出静态资源，可部署到独立静态托管/CDN 或反向代理，不另建独立 UI。
- Home Assistant 是外部服务。不得把 Redis 或数据库端口暴露给公网。


---

# Source: docs/03_TECH_STACK_AND_REPO.md

# 03 — 技术选型与仓库结构

> 本文是新项目推荐实现栈，不代表 Aura Grid 原始部署仓库内部使用了这些技术。若目标仓库已有成熟代码，先审查复用成本，不可静默迁移。

## 1. 客户端：一套 Expo Universal App

- **Expo + React Native + TypeScript**：iOS/Android 正式客户端。
- **React Native Web**：由同一个 `apps/mobile` 项目提供 Web 目标；不默认创建独立 `apps/web`。
- **Expo Router**：文件路由、深链接和跨平台导航。
- **TanStack Query**：服务器数据缓存、请求失效、重试和状态协调。
- **Zustand（可选）**：只管理纯 UI 状态，如当前选中房间、弹层和临时筛选；不作为设备状态事实来源。
- **Zod**：运行时校验表单、API 边界数据和结构化计划。
- **React Native StyleSheet + `design-tokens`**：首版用平台中立的样式方案。可在确有生产力收益时引入 NativeWind 等跨平台样式库，但不得直接套用依赖 DOM/CSS 的 Web UI 组件库。
- **`expo-secure-store`**：原生端 refresh token 安全存储；Web 使用 HttpOnly cookie，不依赖 SecureStore。
- **Expo Notifications**：客户端通知集成；后端负责任务执行和推送发送策略。
- **React Native Testing Library + Jest / `jest-expo`**：组件与客户端逻辑测试。
- **Playwright**：Web 导出目标的浏览器 E2E；**Maestro**（或经 ADR 选择的原生 E2E 工具）用于 iOS/Android 真机/模拟器流程。
- **EAS Build / Submit**：原生构建与商店发布；正式发布前使用 development build 验证原生模块，而不是只依赖 Expo Go。

依赖版本策略：不在文档中手工锁定可能过期的 Expo SDK 版本。创建/升级项目时选用当前稳定 SDK，所有 Expo 模块使用 `npx expo install`，并运行 `npx expo-doctor` 和 `npx expo install --check`（若当前 SDK 提供）。不要忽略 SDK 的 peer dependency 警告。

## 2. 后端

- Node.js LTS + TypeScript `strict` + NestJS 模块化单体。
- REST + WebSocket Gateway。
- Prisma；MVP SQLite；后续并发与部署需求明确时评估 PostgreSQL。
- Pino 或同类结构化日志；统一 requestId / correlationId。
- Jest/Vitest + Supertest；沿用 NestJS 现有工具链，避免为同一目的维护两套测试 runner。
- OpenAPI 作为 API 契约；通过生成或校验共享 contracts，降低前后端类型漂移。

## 3. AI 与集成

- `ModelProvider` 抽象；首个 adapter 可为 OpenAI-compatible API，模型 key 只存在后端。
- Home Assistant REST + WebSocket 封装在 `HomeAssistantAdapter`。
- `ToolRegistry`、`PolicyEngine`、`TaskOrchestrator` 是唯一设备操作执行通路。
- Docker Compose 用于后端与持久化服务；Redis/BullMQ 可选。
- MCP 作为可选 adapter，复用相同工具和策略服务。

## 4. Monorepo 结构

```text
homeweave/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── apps/
│   ├── mobile/                      # 唯一跨平台 UI：iOS / Android / Web
│   │   ├── app/                     # Expo Router routes/layouts
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── features/             # dashboard, rooms, devices, scenes...
│   │   │   ├── hooks/
│   │   │   ├── providers/
│   │   │   ├── platform/             # secure storage, notifications, linking
│   │   │   ├── services/
│   │   │   └── theme/
│   │   ├── assets/
│   │   ├── app.config.ts
│   │   ├── eas.json
│   │   └── package.json
│   └── api/
│       ├── src/modules/              # NestJS modules
│       ├── prisma/
│       └── package.json
├── packages/
│   ├── contracts/                    # API/event schemas and types
│   ├── api-client/                   # REST/WS client + auth adapter
│   ├── domain/                       # platform-neutral domain logic
│   ├── validation/                   # Zod schemas
│   ├── design-tokens/                # shared tokens, no DOM dependency
│   └── ui/                           # optional shared RN primitives
├── infra/{docker,scripts}/
├── docs/
├── pnpm-workspace.yaml
├── package.json
├── .env.example
└── docker-compose.yml
```

默认不创建 `apps/web`。`apps/mobile` 的 Web 目标通过 Expo / React Native Web 构建；如未来有确切证据表明后台管理 UI 无法适配，再用 ADR 决定是否新增单独 Web 应用。

## 5. 平台文件规则

- 默认使用共享 `.tsx` 文件。
- 仅有少量系统差异时使用 `Platform.select` 或 platform adapter。
- 复杂差异才使用 `.ios.tsx`、`.android.tsx`、`.web.tsx` / `.native.tsx` 文件。
- 不应为了差异化复制整页；差异组件必须有相同的 props/契约与对应测试。
- domain/contracts 包不得导入 `react-native`、`window`、`document`、Node `fs` 等平台 API。
- 使用 `expo install` 管理 Expo SDK 相关包；新增原生模块后重新构建 development build 并验证。

## 6. 工程规则

- TypeScript `strict: true`。
- Controller 只做传输层适配；业务逻辑放 Application Service。
- 客户端不直接访问 HA；Agent 不直接访问 HA 或数据库。
- API schema/types 优先从共享契约或 OpenAPI 生成，禁止无控制地复制接口定义。
- `unknown` + schema validation 优先于无约束 `any`。
- 不记录 token、密码、Cookie、API key 或家庭敏感属性。
- 新增 env 必须更新 `.env.example` 和部署文档。
- DB schema 变化提供 migration 和测试。
- 不引入没有明确需求的向量数据库、Kafka、微服务或多 Agent 框架。


---

# Source: docs/04_DATA_MODEL.md

# 04 — 数据模型

> 逻辑设计；实际 Prisma schema 需按实现版本细化，JSON 字段必须版本化和校验。

## User
`id`、`username/email`、`passwordHash`、`role`、`isActive`、`createdAt`、`updatedAt`。

## AuthSession / RefreshSession
`id`、`userId`、`refreshTokenHash`、`clientType`（ios/android/web）、`installationId?`、`expiresAt`、`revokedAt?`、`rotatedFrom?`、`createdAt`、`lastUsedAt?`。仅保存 refresh token 的 hash，不存明文；每次 refresh 轮换并检测重放。

## ClientInstallation（P1，或需推送时启用）
`id`、`userId`、`platform`（ios/android/web）、`installationId`、`pushProvider`、`pushTokenCiphertext?`、`notificationsEnabled`、`lastSeenAt`、`revokedAt?`、时间字段。约束：`userId + installationId` unique；token 轮换后应更新；登出/注销时可撤销。

## Integration
`id`、`type`（MVP `home_assistant`）、`name`、`baseUrl`、`credentialCiphertext` 或 secret reference、`status`、`lastSuccessfulSyncAt`、`lastErrorCode`、时间字段。

## Area
`id`、`integrationId`、`externalId`、`name`、`icon`、`sortOrder`。

## Device
`id`、`integrationId`、`externalId`、`areaId?`、`name`、`manufacturer?`、`model?`、`availability`、`lastSeenAt`。

## Entity
`id`、`deviceId?`、`integrationId`、`externalId`（HA entity_id）、`domain`、`name`、`areaId?`、`capabilitiesJson`、`attributesJson`（过滤敏感字段）、`stateValue`、`stateJson`、`stateObservedAt`、`isStale`、`isHidden`、`sortOrder`。
约束：`integrationId + externalId` unique。

## Dashboard
`id`、`name`、`ownerId`、`layoutJson`、`isDefault`、时间字段。布局中的用户覆盖项与自动生成项应可区分。

## Scene
`id`、`name`、`description`、`source`（HA/app）、`externalId?`、`definitionJson`、`riskLevel`、`createdBy`、时间字段。

## Task
`id`、`createdBy`、`source`（ui/agent/mcp/automation）、`userGoal`、`status`、`planJson`、`planVersion`、`confirmationRequired`、`confirmedAt?`、`startedAt?`、`finishedAt?`、`summary?`、`errorCode?`、`correlationId`、时间字段。

## TaskStep
`id`、`taskId`、`index`、`toolName`、`inputJson`（脱敏）、`status`、`riskLevel`、`startedAt?`、`finishedAt?`、`resultJson`（脱敏）、`verificationStatus`、`errorCode?`、`retryCount`。约束：`taskId + index` unique。

## ToolDefinition
`id`、`name` unique、`description`、`inputSchemaJson`、`riskLevel`、`requiresConfirmation`、`enabled`、`version`。
MVP 可以在代码中注册工具，数据库表可延后；不可允许用户任意上传可执行 handler。

## Conversation / Message
Conversation：`id`、`userId`、`title`、时间字段。
Message：`id`、`conversationId`、`role`、`content`、`metadataJson`、`createdAt`。敏感内容保留策略需配置。

## Preference
`id`、`userId`、`key`、`valueJson`、`source`（explicit/confirmed/inferred）、`confidence`、`confirmedAt?`、`enabled`、时间字段。约束：`userId + key` unique，或采用支持多条带 scope 的复合键。

## Suggestion
`id`、`kind`、`title`、`description`、`evidenceJson`、`status`、`dedupeKey`、`createdAt`、`expiresAt?`。

## AuditEvent
`id`、`actorUserId?`、`source`、`action`、`resourceType`、`resourceId?`、`result`、`correlationId`、`metadataJson`（脱敏）、`createdAt`。

## 通用规则
- 外部 ID 与内部主键分离。
- 状态缓存必须带时间和 stale 标记。
- API key/token/password 不能进入普通 JSON 日志或任务参数。
- 原生 refresh token 只以安全存储保存在客户端；服务端只保存 hash/可撤销会话元数据。
- Push token 按安装记录管理并支持撤销，不能用作认证凭据。
- 重要任务和审计不要因删除实体而级联丢失。
- 任务和工具输入采用白名单字段与 schema version。
- 保留期限可配置，提供导出/删除个人偏好机制。
- 关键约束、索引：`Entity(integrationId, externalId)`、`Task(status, createdAt)`、`TaskStep(taskId,index)`、`AuditEvent(createdAt)`、`Suggestion(dedupeKey,status)`。


---

# Source: docs/05_API_SPEC.md

# 05 — API 契约（MVP）

Base path：`/api/v1`。业务端点在 iOS、Android、Web 之间保持一致。认证采用平台适配：原生使用 Bearer access token + rotating refresh token；Web 使用 HttpOnly、Secure、SameSite cookie 与 CSRF 防护。具体 JSON 类型应由 `docs/openapi.yaml` 与 `packages/contracts` 维护，不能由不同客户端分别手写。

## 统一错误

```json
{
  "error": {
    "code": "HA_CONNECTION_UNAVAILABLE",
    "message": "无法连接 Home Assistant。",
    "requestId": "req_xxx",
    "details": {}
  }
}
```

`details` 不可包含凭据或敏感上游响应。错误码稳定，用户文案由客户端国际化映射。

## Setup / Auth

- `GET /setup/status` — 是否已经完成首次初始化。
- `POST /setup/admin` — 仅首次初始化可调用。
- `POST /auth/login` — 验证凭据并创建会话。
- `POST /auth/refresh` — 原生端在 JSON 中提交 refresh token，Web 使用安全 cookie；每次刷新都轮换 refresh token。
- `POST /auth/logout` — 撤销当前会话，并清除 Web cookie。
- `GET /auth/me` — 当前用户信息与权限摘要。
- `POST /auth/sessions/revoke` — 管理员或会话所有者按策略撤销会话。

原生登录响应可返回短期 `accessToken`、`expiresIn` 和 `refreshToken`；refresh token 只写入系统安全存储，access token 默认只留在内存。Web 登录通过 Set-Cookie 设置 HttpOnly 会话 cookie，不应把长期 token 写进 `localStorage`。服务端只保存 refresh token hash/会话状态，并支持轮换、过期、撤销与重放检测。

## Server / Integration

- `GET /health/live`
- `GET /health/ready`
- `GET /health/diagnostics`（管理员）
- `GET /integrations`
- `POST /integrations/home-assistant`
- `POST /integrations/:id/test`
- `PATCH /integrations/:id`
- `POST /integrations/:id/sync`
- `DELETE /integrations/:id`

创建集成示例：

```json
{"name":"Home","baseUrl":"http://homeassistant.local:8123","token":"secret input only"}
```

HA token 仅提交到后端并安全存储，不得回传。URL、DNS、重定向和网络目标必须经过服务端 SSRF 策略检查。手机客户端配置的是 HomeWeave **服务端 URL**，不是 HA URL。

## Home State / Devices

- `GET /home/summary`
- `GET /areas`
- `GET /devices?areaId=...`
- `GET /entities?areaId=...&domain=light`
- `GET /entities/:id`
- `POST /entities/:id/commands`

命令示例：

```json
{
  "command": "set_brightness",
  "parameters": {"brightnessPercent": 30},
  "idempotencyKey": "client-generated-unique-key"
}
```

响应可返回 `202 Accepted` 和 command/task ID；除非已验证最终状态，否则不能用响应暗示操作已完成。

## Scenes / Dashboard

- `GET /scenes`、`POST /scenes`、`GET /scenes/:id`、`PATCH /scenes/:id`
- `POST /scenes/:id/preview`、`POST /scenes/:id/execute`
- `GET /dashboards`、`GET /dashboards/:id`
- `PATCH /dashboards/:id/layout`
- `POST /dashboards/generate`
- `POST /dashboards/:id/reset-layout`

自动生成 dashboard 不得覆盖用户已保存的布局覆盖项。

## Agent / Tasks

- `POST /assistant/messages`
- `POST /assistant/plan`
- `GET /tasks`、`GET /tasks/:id`、`GET /tasks/:id/steps`
- `POST /tasks/:id/confirm`
- `POST /tasks/:id/cancel`
- `POST /tasks/:id/retry-step`
- `POST /tasks/:id/verify`

消息示例：

```json
{"conversationId":"optional","message":"帮我准备观影环境，保留过道灯"}
```

响应 `mode` 可为 `answer`、`clarification_required`、`plan_ready`、`needs_confirmation` 或 `executing`。需要确认的计划必须返回 task ID 和步骤，不得自动执行。

## Preferences / Suggestions（P1）

- `GET /preferences`、`POST /preferences`、`PATCH /preferences/:id`、`DELETE /preferences/:id`
- `GET /suggestions`
- `POST /suggestions/:id/accept`
- `POST /suggestions/:id/dismiss`
- `POST /suggestions/:id/snooze`

## Client Installation / Push（P1）

- `POST /client-installations/register` — 注册 `installationId`、平台与可选 push token。
- `PATCH /client-installations/:id` — 更新 push token、通知偏好或最后活跃时间。
- `DELETE /client-installations/:id` — 注销安装记录/关闭该安装的推送。

APNs、FCM 或 Expo Push 凭据由服务端持有。Push payload 不包含敏感设备状态，客户端收到通知后必须通过已认证 API 获取详情。Push 失败不影响任务本身的结果。

## WebSocket 事件

事件类型：`home.state.updated`、`integration.status.changed`、`task.created`、`task.updated`、`task.step.updated`、`suggestion.created`、`system.health.changed`。

```json
{
  "eventId":"evt_xxx",
  "type":"task.updated",
  "occurredAt":"2026-10-26T12:00:00Z",
  "correlationId":"task_xxx",
  "payload":{}
}
```

WebSocket 必须验证身份和授权范围。原生端不得把长期 token 放入 URL；优先使用受保护的握手认证或短期一次性 WS ticket。客户端重连后先拉取快照，再订阅增量。客户端按事件 ID/时间防重，并避免旧事件覆盖新状态。


---

# Source: docs/06_AGENT_AND_TOOLING.md

# 06 — Agent、Fast-Path 与 Tool Registry

## 设计原则

Agent 是理解、规划与解释层，不是设备执行层。所有工具调用必须经过服务端 Tool Registry、schema 校验、Policy Engine、统一 Application Service 和结果验证。

## 三条执行路径

### A. Fast-Path
处理明确、简单、实体映射唯一的命令，例如“打开客厅灯”“把书房灯调到 30%”“客厅现在多少度”。过程：文本规范化 → 意图/实体匹配 → schema 校验 → 服务端策略 → 查询/执行 → 状态验证。低置信度或多候选必须澄清，不得对敏感操作使用模糊匹配直接执行。

### B. LLM Planning
处理跨设备目标、模糊意图和多约束请求。LLM 输出经过严格 JSON schema 校验的计划；服务端重新计算权限、风险和确认要求。模型不能输出任意 URL、shell、代码或任意 HA 服务调用。

### C. Automation Engine
处理已确认的定时/事件规则；执行逻辑应确定性运行。LLM 只辅助生成草稿、解释或建议，不应每天重新规划一条固定规则。

## ModelProvider 接口建议

```ts
interface ModelProvider {
  generateStructured<T>(input: {
    systemPrompt: string;
    userPrompt: string;
    schema: unknown;
    timeoutMs: number;
  }): Promise<{
    data: T;
    usage?: { inputTokens?: number; outputTokens?: number };
  }>;
}
```

要求：API key 只在后端；超时、最大 token 和限流保护；结构化输出必须校验；记录供应商/模型/耗时/用量但不记录密钥；可禁用与替换提供方；发送最小必要上下文。

## 提供给模型的上下文

只提供当前任务所需的用户请求、相关房间设备/能力/状态、状态时间与 stale 标记、明确确认的偏好、可用工具 schema、风险规则摘要及必要对话上下文。不要发送全屋所有实体、完整审计历史或无关个人数据。

## 计划结构示意

```json
{
  "intent":"prepare_movie_environment",
  "summary":"准备观影环境并保留过道灯",
  "clarificationQuestions":[],
  "steps":[
    {
      "tool":"light.set_power",
      "arguments":{"entityId":"internal-entity-id","power":"off"},
      "reason":"关闭客厅主灯"
    }
  ],
  "assumptions":[],
  "limitations":[]
}
```

模型不需要也不应该拥有最终的 `riskLevel` 或 `requiresConfirmation` 权限。服务端根据工具定义和策略重新计算。

## Tool Registry 最低字段

`name`、`description`、`inputSchema`、`permissionPolicy`、`riskLevel`、`requiresConfirmation`、`timeoutMs`、`idempotencyPolicy`、`verificationStrategy`、`handler`、`version`。

建议 MVP 工具：
- `home.get_summary`
- `area.get_state`
- `entity.get_state`
- `light.turn_on`
- `light.turn_off`
- `light.set_brightness`
- `switch.set_power`
- `climate.set_temperature`
- `cover.set_position`
- `scene.preview`
- `scene.execute`

不要提供 `ha.call_any_service` 这类无边界的高权限工具。支持新领域应通过经过测试的 adapter 与工具定义扩展。

## 风险策略

- `low`：状态查询、普通灯光；按授权可直接执行。
- `medium`：温控、窗帘、多设备场景；根据影响范围和设置决定是否确认。
- `high`：门锁、安防、危险设备；MVP 禁止 AI 无人值守执行，需显式确认及额外权限。
- `critical`：MVP 不向 Agent 暴露。

风险等级只能由后端定义。不得因模型说“风险低”而降低等级。

## Task Orchestrator

1. 持久化任务与步骤。
2. 检查计划版本、权限、设备能力、参数与状态新鲜度。
3. 对需确认任务生成短期、单次、绑定 plan hash 的确认记录。
4. 逐步骤执行并持久化状态。
5. 等 HA 事件或主动查询验证结果。
6. 有限重试；重试前重读状态，非幂等操作不得盲重试。
7. 汇总 succeeded / failed / unknown / partially_succeeded。
8. 广播 task events，写入审计。

## 结果可信度

- `succeeded`：有证据目标状态已达到。
- `failed`：明确失败。
- `unknown`：无法确认最终状态。
- `partially_succeeded`：多步骤有成功也有失败/未知。

摘要必须根据服务端执行结果生成；模型可润色语句，但不能自行声称设备已成功执行。

## 记忆

持久化结构化偏好，包含来源（explicit/confirmed/inferred）、置信度、确认时间、启用状态。推测记忆默认不改变设备状态。用户能查看、编辑、禁用和删除。

## MCP（P1）

MCP 仅暴露经审核的工具；使用与 UI/Agent 相同的注册表和策略。每个调用必须有身份与权限上下文，执行记录进入审计。不能因为入口是 MCP 绕过确认。


---

# Source: docs/07_HOME_ASSISTANT_INTEGRATION.md

# 07 — Home Assistant 集成

## 原则

- HA 是当前设备状态的事实来源。
- 只有 `HomeAssistantAdapter` 可以访问 HA REST/WebSocket。
- 领域服务只处理归一化模型，不依赖 HA 原始响应结构。
- token 只在后端保存与使用。
- 认证失败、网络故障、实体不可用、服务调用失败应区分。

## 连接顺序

1. 规范化并验证 URL。
2. 检查目标网络地址，应用 SSRF 规则。
3. 检查 HTTP/API 可达性。
4. 验证 token。
5. 拉取区域、设备、实体与能力信息。
6. 建立 WebSocket，完成认证并订阅状态事件。
7. 同步快照并标记观察时间。
8. 定期对账；断开时指数退避重连。

## 能力映射

- `light`：开关；只有支持 brightness/color/color_temp 时才暴露相应能力。
- `switch`：开关。
- `climate`：目标温度、HVAC 模式、风速等按实体属性和支持特征映射。
- `cover`：开关、位置或倾斜角度按能力映射。
- `sensor`：只读，显示单位、device_class 和状态。
- `scene`：激活已存在场景。

不能假设同 domain 的每个实体具有完全相同的能力。参数映射需要单元测试。

## 命令执行与验证

1. 将内部 entity ID 映射到 HA entity_id。
2. 检查权限、可用性、状态新鲜度和能力。
3. 校验命令参数及范围。
4. 调用精确的 HA service handler。
5. 等待状态事件；超时后主动查询一次。
6. 将实际状态与目标进行比较。
7. 返回 succeeded / failed / unknown，并写任务步骤。

HA 接受服务请求并不保证物理设备已达到目标状态。

## 状态一致性

- 收到 WebSocket 事件更新状态快照与 `observedAt`。
- 对重复/乱序事件做防护，不能用旧状态覆盖较新的状态。
- WebSocket 断开时将数据标记 stale。
- 定时或按需 REST 对账，修复事件丢失导致的漂移。
- 客户端重连先拉快照再收增量。

## 自动化

MVP 可执行既有 HA scene。应用侧场景可以保存目标状态并逐项执行。AI 自动化仅生成草稿，需验证数据源、实体、条件、语法与权限，dry-run 后用户确认才发布；不直接运行任意生成 YAML。

## 诊断与错误

至少区分：`INVALID_BASE_URL`、`TARGET_NOT_ALLOWED`、`DNS_RESOLUTION_FAILED`、`CONNECTION_TIMEOUT`、`AUTHENTICATION_FAILED`、`WEBSOCKET_UNAVAILABLE`、`ENTITY_NOT_FOUND`、`ENTITY_UNAVAILABLE`、`CAPABILITY_UNSUPPORTED`、`SERVICE_CALL_FAILED`、`STATE_VERIFICATION_TIMEOUT`。
错误输出脱敏且包含 requestId。


---

# Source: docs/08_SECURITY_AND_PRIVACY.md

# 08 — 安全与隐私规范

## 资产与威胁

资产包括 HA token、模型 API key、用户密码/会话、家庭设备状态/布局/偏好/历史、以及物理设备控制权限。主要威胁包括未授权控制、Prompt Injection、SSRF、密钥泄漏、重放请求、危险自动化、端口暴露和不安全升级。

## 基线要求

- 默认拒绝、最小权限、服务端授权。
- 模型输出和设备/外部文本都视为不可信输入。
- 不提供任意 shell、代码执行、任意 URL 或任意 HA service 工具。
- 密钥不进前端、日志、错误、模型 prompt 或普通任务记录。
- 设备操作与权限变化可审计。
- 高风险操作要求即时明确确认；MVP 不允许无人值守 AI 解锁门锁或关闭安全系统。
- 远程访问建议 VPN 或 HTTPS 反向代理；不要直接暴露管理端口。

## 密钥管理

- `.env` 不提交仓库。
- 存入 DB 的 HA token 使用应用加密密钥加密，或使用外部 secret reference。
- 用环境变量/secret mount 注入主加密密钥，不能把密钥与密文存同一处而无保护。
- 日志字段递归脱敏（token、authorization、password、secret、apiKey、cookie 等）。
- API 不回传凭据；支持更新/轮换并验证。

## SSRF

集成 URL 是潜在 SSRF 入口：
- 限制 scheme；生产优先 HTTPS，局域网 HTTP 必须是明确支持的模式。
- 拒绝 localhost、loopback、link-local、云 metadata 和策略禁止的网段；局域网 HA 目标需通过单独允许策略支持，不能简单将所有私有 IP 一刀切禁止。
- 对域名 DNS 解析结果校验，防 DNS rebinding；连接时重新验证解析后的 IP。
- 默认不跟随重定向；每次重定向重新校验。
- 设置连接/读取超时与响应大小限制。
- 不把用户输入拼接成任意 path。
- 安全测试需覆盖本地开发/家庭局域网的明确允许场景。

## Prompt Injection 与工具

- 实体名称、状态属性、通知文本、对话内容均为不可信数据。
- 工具权限、risk、confirmation 由服务端定义，不能由模型修改。
- 工具调用前重新验证用户权限、目标实体、能力、参数、状态新鲜度和任务确认。
- MCP、Web、自动化使用相同策略与审计。
- 对高风险确认绑定计划 hash、用户、过期时间与单次 nonce，防止确认后计划被替换和重放。

## 跨平台客户端安全

- 原生端 access token 优先只保存在内存；refresh token 进入 iOS Keychain / Android Keystore backed storage（通过已验证的 Expo SecureStore API）。不将长期凭据存 AsyncStorage。
- Web 使用 HttpOnly、Secure、SameSite cookie 和 CSRF 防护；禁止把长期 refresh token 放进 localStorage。
- 客户端 bundle 中的 `EXPO_PUBLIC_*` 变量均视为公开信息，不可放密钥。
- App 与自托管 API 的远程连接要求 HTTPS/WSS；局域网 HTTP 必须显式启用并被地址策略约束，不要全局关闭 iOS ATS 或 Android cleartext 防护。
- 原生深链接中不得包含长期 access/refresh token；配对 URL 仅允许短期、一次性、有 scope 的 pairing code。
- push payload 默认仅包含通知类型与资源 ID，避免在锁屏上泄漏家庭状态；高风险操作不能通过通知 action 绕过确认。
- 服务端要支持 refresh token 轮换、撤销、过期和重放检测；退出登录清除本地凭据并撤销会话。

## 数据隐私

- 默认本地保存家庭状态与偏好。
- 外部 LLM 只发送当前任务必要上下文，设置页显示提供方和数据使用边界。
- 提供关闭 AI 功能的开关。
- 对话、偏好和审计设置不同保留策略。
- 用户删除结构化记忆后，相关记忆不再参与推理；按法规/安全需要保留最少审计摘要并说明原因。
- 不收集无关数据；不把家庭数据用于训练外部模型，除非用户明确选择且服务条件允许。

## 安全验收

- 未认证用户无法访问受保护端点。
- 用户不能调用管理员工具。
- 模型输出低风险标签无法降低服务器风险判断。
- 高风险操作未确认不能执行；过期/重放确认不能执行。
- token 与 API key 不出现在日志、浏览器 bundle、Expo 原生 bundle、错误或任务输入里。
- 原生客户端没有长期 token 存于 AsyncStorage；Web 不把 refresh token 存在 localStorage。
- Push payload 没有敏感设备状态，失效 token 可被注销。
- 目标 URL 不能探测不允许的地址；重定向/DNS 变更也会重新校验。
- Redis/DB 默认不向宿主公网端口暴露。


---

# Source: docs/09_UI_UX_SPEC.md

# 09 — UI/UX 规格（Expo Universal Client）

## 目标

- 高频设备操作直达，不强迫聊天。
- 首次连接后尽可能自动生成可用面板。
- AI 的计划可查看、修改、拒绝与确认。
- 状态陈旧、离线、未知、成功、失败有清晰区分。
- iPhone、Android 手机、墙面平板、桌面 Web 使用同一信息架构，并按屏幕与平台调整布局。

## 主导航

主导航：
1. 首页
2. 房间
3. 场景
4. AI 助手
5. 任务记录
6. 设置

手机可采用底部 Tab + Stack；较宽屏幕可以使用侧边栏或双栏布局。Expo Router 负责路由，路由结构不能绑死在某一个尺寸布局上。

设置：服务器连接、Home Assistant 集成、仪表盘、模型、偏好/记忆、主动建议、安全/权限、系统诊断。

## 首页

模块：家庭摘要、常用场景、房间卡片、异常与待处理任务、AI 输入框。避免在首页铺满所有实体。用户可以固定常用设备/场景。

## 设备卡片

展示友好名称、当前状态、主要动作、实际支持的次级能力、离线/stale/未知提示。能力按实体实际属性动态显示。执行中禁止重复提交；完成后明确反馈。状态不能只通过颜色传达。

## AI 对话状态

界面需区分：普通回答、查询结果、等待澄清、计划预览、等待确认、执行中、部分成功、失败、未知结果。

计划示例：

```text
观影环境计划
- 关闭客厅主灯
- 氛围灯调至 20%
- 保留过道灯
- 关闭窗帘

[编辑计划] [确认执行]
```

每一步可以被编辑/移除；执行后显示实际验证结果。高风险确认应说明影响设备、风险原因、可恢复性和取消入口。

## 移动端专属交互

- 首页和房间高频按钮按触控设计，常见目标尺寸约 44×44 CSS px 或平台等效触控尺寸。
- 支持安全区域、键盘弹出、屏幕旋转和系统字体缩放。
- 破坏性/高风险确认不可只依赖手势或通知动作完成；打开 App 后需展示明确目标和确认上下文。
- 系统通知只提供最小必要内容，例如“有一个家庭任务需要查看”，不要在锁屏消息中默认暴露家庭状态细节。
- App 切换服务器/登出时，清空关联 Query Cache、WebSocket 与用户范围数据。
- 无网络时标明“离线/最后更新时间”；不默认发送缓存期间积压的物理控制命令。

## Web / 平板布局

- 手机：单列，底部导航，控制入口靠近拇指区域。
- 平板：两列或房间网格，主要场景大按钮，适合墙面展示。
- 桌面 Web：可以提供左侧导航、主内容与可选细节面板；确保键盘和鼠标可用。
- 组件要用 React Native 公共组件实现；避免依赖 DOM-only 交互。Web 专属辅助 UI 可放 `.web.tsx`，但业务语义和共享合同保持一致。

## 任务记录

列表字段：时间、目标、来源、总体状态、成功/失败/未知数量。详情包括原始目标、计划版本、步骤、工具名称、脱敏参数摘要、结果、验证方式、失败原因和 request/correlation ID。

## 响应式与可访问性

- 使用一致的 design tokens；字体、间距、颜色不可散落在组件中。
- 支持键盘导航、焦点可见、屏幕阅读器标签、reduced motion。
- 支持系统浅色/深色模式，用户可设置应用主题。
- loading、empty、error、offline、stale、permission denied、partial result 必须分别设计。
- 动画不得成为展示成功/失败状态的唯一方式。
- 文案国际化，中文与英文字符串不可硬编码在业务逻辑中。


---

# Source: docs/10_TEST_AND_ACCEPTANCE.md

# 10 — 测试策略与验收

## 测试层次

### Shared / Domain Unit
- 能力映射与参数验证。
- 实体解析与 Fast-Path 匹配阈值。
- Tool Registry schema、权限和风险策略。
- 任务状态机合法转移、幂等键、重试和确认过期。
- 状态验证 succeeded/failed/unknown 的判断。
- 日志脱敏、URL/SSRF 校验。
- `packages/domain` 与 `packages/contracts` 不意外依赖 Node-only 或 DOM-only API。

### Client Component / Hook
- Expo Router 的鉴权/初始化路由行为。
- TanStack Query 状态、WebSocket 事件更新与 stale 状态。
- 设备卡片对不同能力/权限/错误状态的渲染。
- 计划预览、编辑、确认、部分成功与 unknown 状态。
- 服务器地址切换后缓存隔离。
- secure storage adapter 与 web cookie adapter 的接口行为（通过 mocks/contract tests）。
- loading/empty/error/offline/stale/permission denied 状态。

推荐工具：Jest + `jest-expo` + React Native Testing Library。共享纯 TypeScript 包也可使用 Jest/Vitest，但不要为同一个 app 无故维护多个 test runner。

### Backend Integration
- Prisma migrations、repository 和事务。
- HA adapter 使用 mock server 覆盖 REST、WebSocket、断连、超时、认证失败。
- 命令服务从工具调用到执行结果验证。
- LLM adapter schema 不合规、超时、限流和网络错误。
- WebSocket 授权和事件重连。
- refresh token rotation / revocation / replay detection。
- push registration、失效 token、通知发送失败不影响任务最终状态。

### E2E — Web
- 使用 Playwright 验证 Expo Web 导出目标的关键流程。
- 首次初始化、登录、配置服务器/集成、生成仪表盘、设备控制、AI 计划和任务详情。
- 检查浏览器 cookie、CSRF、错误和 stale 状态。

### E2E — Native
- 使用 Maestro（或 ADR 批准的原生 E2E 工具）在 iOS Simulator、Android Emulator 或真实设备上测试。
- 首次启动、服务器 URL 配置、登录恢复、登录登出、核心设备控制、WebSocket 重连、设备旋转/安全区。
- 通知权限允许/拒绝两条路径；push 真正送达属于集成环境测试，不可仅用 mock 证明。
- iOS 与 Android 的构建必须分别跑通；单纯 `expo start` 不算 native build 验收。

### Security
- 未登录访问受保护 API。
- 越权用户调用管理员功能。
- Prompt injection 试图覆盖策略。
- 伪造 tool 参数、风险等级、工具名。
- 重放 idempotency key 和确认 nonce。
- SSRF/重定向/DNS 解析边界。
- 敏感信息检查日志、Web bundle 与原生 bundle。
- 不允许 refresh token 出现在普通 storage/log 或深链接里。
- push payload 不含敏感家庭数据。

## 构建健康检查

每次涉及客户端依赖或 Expo 配置的阶段至少检查（脚本名按实际 package scripts 为准）：
- `npx expo-doctor`（若当前 SDK 支持）。
- `npx expo install --check`（若当前 SDK 支持）。
- TypeScript typecheck。
- 客户端单元测试。
- `npx expo export --platform web`（Web 支持目标）。
- Android development/preview build。
- iOS build（本地 macOS/Xcode 或 EAS Build）。

CI 可以对 PR 运行轻量级测试；原生签名构建和真实设备 smoke test 可放在受控 workflow，但必须记录最后一次验证版本与平台。

## 验收门槛（每个阶段）

- format/lint 通过。
- typecheck 通过。
- 所有新增/受影响 unit 和 integration 测试通过。
- 高风险策略相关测试覆盖关键拒绝路径。
- 无新的高危依赖漏洞（使用项目已有扫描工具）。
- 文档与 `.env.example` 同步。
- 手动测试步骤记录在交付摘要。

## MVP 关键验收标准

1. 配置有效的 HA URL/token 可成功同步实体；失败原因可理解且 token 不泄漏。
2. 重复同步不创建重复实体，不覆盖用户布局覆盖项。
3. 控制命令经统一服务执行，并基于实际状态确定最终结果。
4. HA 接受命令但未达到目标状态时不会误报成功。
5. 简单 Fast-Path 不需要 LLM；LLM 不可用时控制页面仍可用。
6. 多步骤任务能清晰展示成功、失败、unknown 与部分成功。
7. 模型生成不存在的 entity、工具或不合法参数时不会执行。
8. 高风险操作没有有效确认时被拒绝。
9. HA 状态过期时 UI 明确显示 stale 与观测时间。
10. 程序重启后未完成任务能恢复、重新验证或标记 unknown，不凭空变成功。
11. API key、HA token、密码不会出现在普通日志、Web bundle 或原生 bundle。
12. Docker Compose 部署有健康检查和持久化路径说明。
13. 同一 `apps/mobile` 可导出 Web 并通过原生 iOS/Android 构建；不通过引入第二套 UI 项目达成平台支持。
14. iOS、Android 的服务器配置、登录、设备状态、单设备控制、任务详情等核心旅程分别通过 native E2E / smoke test。
15. 无网络时缓存状态标记 stale，客户端不自动回放积压的物理设备命令。

## 需要手动验证的外部条件

实际物理设备行为、特定 HA integration 属性与时序，需要测试 HA 实例/设备验证。iOS 推送需 APNs/Expo credentials 与真实设备环境；Android 推送需 FCM/Expo credentials。mock 测试不能替代真实设备 smoke test。


---

# Source: docs/11_IMPLEMENTATION_ROADMAP.md

# 11 — 实施路线图与任务拆分

## 总体策略

采用一个 Expo Universal Client + 一个 NestJS 后端，不先建两套前端。每阶段都必须有可运行的软件、测试和清晰退出标准。先可信设备控制，再增加 AI 复杂度。

## Phase 0 — 仓库审查与决策锁定

任务：
- 检查现有仓库、依赖、分支、未提交更改、测试和部署。
- 确认是否从空仓库创建 Expo Universal App；如已有 Web UI，估算复用/迁移成本并形成 ADR。
- 采用 pnpm workspace（若无现有包管理器约束）。
- 建立统一环境模板、日志、错误格式、requestId 和 CI 基础。
- 输出现有实现与规格差距报告。

完成标准：技术路线固定；无静默破坏；CI 可执行 lint/typecheck/unit test；差距及迁移决策已记录。

## Phase 1 — Monorepo、Expo 客户端与后端骨架

任务：
- 建立 `apps/mobile`（Expo + TypeScript + Expo Router）与 `apps/api`（NestJS）。
- 建立 `packages/contracts`、`packages/api-client`、`packages/domain`、`packages/validation`、`packages/design-tokens`。
- 建立共享 lint/format/typecheck/test 脚本。
- 后端 health/live、health/ready、首次管理员设置、认证与 DB migrations。
- 客户端实现服务器地址设置、登录/登出、空/错误/加载状态。
- 建立 development build 配置；同时验证 Expo Web export。

完成标准：iOS/Android development build 可启动并连接本地 API；Web 可由同一工程导出；认证安全存储按平台适配；无第二套 Web UI。

## Phase 2 — Home Assistant 连接与设备目录

任务：
- 后端集成配置和连接测试。
- HA REST/WS adapter。
- 区域/设备/实体同步、幂等性与能力映射。
- 状态快照和新鲜度。
- 自动生成初始 dashboard。
- Expo 客户端展示家庭摘要、房间/设备列表。

完成标准：连接成功后 iOS/Android/Web 可显示房间与设备；断连 stale；重复同步不重复创建；用户布局覆盖项保留。

## Phase 3 — 可靠手动控制与场景

任务：
- DeviceCommandService。
- 灯光、开关、climate、cover、scene 的能力感知工具。
- 命令后状态验证、task history 与审计。
- 场景列表、预览和执行。
- WebSocket 状态/任务事件订阅、断线重连和快照对账。
- 组件层与端到端控制测试。

完成标准：mock HA 覆盖 succeeded/failed/unknown；至少在 iOS Simulator/Android Emulator 与 Web 完成真实 API smoke test；不误报成功。

## Phase 4 — AI Fast-Path 与结构化规划

任务：
- ModelProvider 抽象和一个供应商 adapter。
- Fast-Path：设备查询、灯光开关、亮度控制、已知场景。
- LLM 结构化输出、schema 验证与澄清流程。
- Tool Registry、Policy Engine、Task Orchestrator。
- 多设备计划预览/编辑/确认/逐项执行。

完成标准：LLM 未配置时 Fast-Path 工作；模型伪造工具/参数被拒绝；部分失败正确呈现；App 关闭后后端任务仍可完成并在重开后同步结果。

## Phase 5 — 易用性与 P1

任务：
- 自动化草稿 + dry-run + 用户确认。
- 结构化偏好与记忆管理。
- 主动建议（默认只建议）。
- Push 注册/通知服务（若启用）。
- MCP adapter（如确定需要）。

完成标准：建议可追溯证据；记忆可删除；MCP 无法绕过权限；自动化未确认不发布；push 失败不影响任务正确性。

## Phase 6 — 发布与运营准备

部署决策：Home Assistant OS 用户优先通过 Supervisor App 安装后端；Home Assistant Container 用户使用 Docker Compose。详细规范见 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`。
任务：
- `app.config.ts`、`eas.json`、bundle/package identifiers、icons/splash/permissions。
- iOS/Android development、preview、production profiles。
- 隐私说明、数据处理披露、账户登出/删除策略。
- EAS 或本地构建流程及商店提交步骤。
- Home Assistant OS 的 App 仓库、GHCR 多架构发布、Ingress 与升级说明（首选家庭部署）。
- Home Assistant Container / 通用 Linux 的 Docker Compose 备用部署说明。
- 备份恢复和升级演练。

完成标准：iOS、Android 生产候选包可构建；Web 目标可部署；所有 secrets 不在 bundle；核心旅程和权限拒绝路径通过测试。HAOS 安装/升级未在真实设备验证时，必须明确标记为未验证。

## 推荐单任务格式

每个 coding agent issue/prompt 应包含目标、依赖模块、涉及接口/DB/API、必需测试、不在范围内的内容与验收命令。一次完成一个可审查的 vertical slice，不要同时重写 UI、认证、AI 和 HA adapter。

## 开发优先级

P0：工程骨架、认证、服务器连接、HA 接入、设备目录、能力控制、状态验证、任务记录、安全策略。
P1：原生 push、主动建议、高级记忆、多集成、高级自动化、语音。
P2：语音唤醒、预测式主动管家、更多设备适配器和高级个性化。

不要先做语音唤醒、复杂长期记忆、多 Agent 或炫技动画；这些都依赖可靠设备服务层。


---

# Source: docs/12_CODING_AGENT_GUIDE.md

# 12 — Codex / Claude Code 使用指南

## 初始开发 Prompt

请使用 `docs/18_INITIAL_PROMPT_CLAUDE_CODE_CODEX.md` 中的完整初始开发 Prompt。它是 Claude Code 与 Codex 共用的启动规范，已经统一使用 HomeWeave（织家）命名和 Expo Universal App 架构。

首次任务只应完成 Phase 0 仓库审查与工程基线，不要立即大规模重写。

## 每个阶段的提示词模板

```text
执行 docs/11_IMPLEMENTATION_ROADMAP.md 中的 Phase N，只实现该阶段范围。
先检查当前代码并列出计划，然后修改代码。必须遵守 AGENTS.md 和相关 docs 规格。
要求：
- 所有输入有 schema 校验；
- 关键逻辑有测试；
- 不破坏既有接口和用户数据；
- 更新相关文档、环境变量和 migration；
- 运行 format/lint/typecheck/相关测试；若涉及 Expo，增加 Expo dependency checks、Web export 和对应平台构建检查；
- 最后列出改动文件、测试实际结果、未覆盖情况、风险和下一项最小任务。
```

## 调试/修复提示词模板

```text
先复现并定位问题，不要先重写相关模块。给出最小根因分析，然后实现最小修复。
新增回归测试，确保修复覆盖原始失败路径。运行相关测试并明确报告结果。若问题源于规格冲突，先指出冲突并采取最安全的默认行为。
```

## Code review 提示词

```text
请以安全和可靠性优先审查本次 diff。重点检查：权限绕过、提示注入、未经验证的模型输出、HA token/API key 泄漏、SSRF、重复执行、非幂等重试、任务状态错误、将命令发送误判为成功、陈旧状态覆盖新状态、数据库 migration 风险和 UI 未处理错误状态。只报告具体可复现问题并给出严重级别与文件/行号。
```

## 重要实践

- 使用小而可验证的任务，不要提示“把完整项目一次生成完”。
- 对涉及真实设备控制的改动先用 mock HA 测试，再在测试家庭/沙盒设备做 smoke test。
- 需要破坏性 DB migration、框架迁移或安全策略变化时先提交 ADR。
- Agent 生成代码不等于代码已验证；人类需审查涉及物理设备与凭据的改动。


## Expo 客户端专用任务模板

```text
本任务只修改 `apps/mobile` 或相关共享包。请先阅读 `docs/03_TECH_STACK_AND_REPO.md` 与 `docs/16_MOBILE_APP_ARCHITECTURE.md`。

- 共享优先：不要复制整页来实现平台差异；必要时使用 platform adapter 或 `.ios/.android/.web` 文件。
- API 请求必须经过 `packages/api-client`；不得在 screen 组件里散落 URL、token 刷新或 WebSocket 重连逻辑。
- 远端数据用 TanStack Query；Zustand 仅管理纯 UI 状态。
- 原生 refresh token 用 SecureStore adapter；Web auth 使用安全 cookie adapter；不得把长期 token 放入 AsyncStorage/localStorage。
- 需明确支持 offline/stale/empty/error/loading/permission denied。
- 如新增 Expo native module，使用兼容当前 Expo SDK 的安装命令，并说明需要重建 development build。
- 运行相关 unit tests、typecheck、Expo doctor/check（若支持）、Web export；涉及原生行为时分别记录 iOS 和 Android build/smoke test 状态。
```


---

# Source: docs/13_ADR.md

# 13 — Architecture Decision Records (ADR)

## ADR-001：模块化单体，而非起步即微服务

**状态：接受。** MVP 单家庭部署优先降低运维与调试复杂度。模块通过接口分层，后续按数据量、部署隔离和团队边界决定拆分。

## ADR-002：Home Assistant 是设备状态事实来源

**状态：接受。** 应用 DB 仅保存配置、快照缓存与任务历史。设备当前状态通过 HA 查询/事件验证。状态缓存必须有 observedAt/stale。

## ADR-003：AI 不直接执行设备调用

**状态：接受。** AI 生成结构化意图/计划；服务端 Tool Registry + Policy Engine 校验并执行。禁止任意 HA 服务、Shell 或 URL 工具。

## ADR-004：Fast-Path 与 LLM 规划并存

**状态：接受。** 简单命令走确定性解析，复杂目标才调用 LLM；固定自动化走规则引擎。LLM 不可用时保持手动控制和支持的 Fast-Path 可用。

## ADR-005：MVP 数据库先用 SQLite

**状态：暂定接受。** 单实例部署易于安装和备份。若需要多进程并发、多用户或多实例，评估 PostgreSQL。任何迁移必须写迁移计划与恢复测试。

## ADR-006：Redis 不是 MVP 的强制依赖

**状态：接受。** 只有需要持久队列、跨进程任务调度或共享缓存时加入。若 Redis 承担可靠队列，任务仍需先持久化于主数据库。

## ADR-007：高风险操作需要确认

**状态：接受。** MVP 禁止 AI 无人值守解锁门锁或关闭安防。确认绑定具体计划版本、用户和短期 nonce，防止重放或计划替换。

## ADR-008：原始 Aura Grid 技术栈的证据边界

**状态：接受。** 部署仓库中的 compose 和安装脚本不能证明原镜像所有内部技术实现。本文档定义的是新项目建议架构，不是对原应用内部技术栈的断言。

## ADR-009：Expo Universal App 作为唯一客户端工程

**状态：接受。** iOS、Android 为一等客户端；Web 通过 React Native Web 支持核心功能。使用 Expo Router、TypeScript、共享 API client/contracts 和平台 adapter。默认不创建独立 React + Vite Web UI，以避免两套界面维护成本。

理由：
- 共享页面和业务逻辑，降低 iOS/Android 维护成本。
- 可以在同一代码库中支持浏览器控制面板。
- 与现有 TypeScript/NestJS 技术体系相容。
- Expo 提供 development build、EAS Build 和原生模块接入路径。

限制：
- Web 与原生平台并非完全等价；相机、推送、安全存储、文件系统、背景执行等要通过适配层处理。
- 不以 iOS/Android 后台任务作为可靠工作执行器。
- 如果未来必须使用大量仅支持 DOM 的 UI 组件或 Web-only 管理功能，应先以实测证明，再通过 ADR 决定是否拆分 Web 项目。

## ADR-010：跨平台认证与凭据存储

**状态：接受。** 原生客户端使用短期 access token（优先内存）和轮换 refresh token（系统安全存储）；Web 使用 HttpOnly、Secure、SameSite cookie 并加入 CSRF 防护。服务端统一身份和权限模型，API 业务端点不因平台而分叉。

## 待决事项

- 是否在 MVP 加入扫码配对？默认 P1；P0 支持手动输入服务器 URL。
- 首发是否启用 Push？默认 P1；App 前台 WebSocket 实时更新为 P0。
- Web 静态包部署在哪里？默认由静态托管或反向代理提供，不强制与 API 同容器。
- 外部模型供应商首选哪家？通过配置选择，不绑定单一厂商。
- MCP 放进 MVP 吗？默认 P1，先稳定 Tool Registry。


---

# Source: docs/14_ENV_AND_DEPLOYMENT.md

# 14 — 环境与部署

> 部署优先级：Home Assistant OS 用户优先使用 Home Assistant App（见 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`）；Home Assistant Container 或通用 Linux 用户使用 Docker Compose 作为备用方式。

## 部署边界

- **后端自托管（首选 HAOS）**：Home Assistant OS 通过 Supervisor 安装和管理 HomeWeave App 容器；Home Assistant Container / 通用 Linux 可使用 Docker Compose 备用部署。
- **iOS/Android**：作为独立二进制使用 EAS Build 或合规的本地原生工具链构建与发布；不由 Docker 运行。
- **Web**：由 `apps/mobile` 通过 React Native Web 导出静态资源。可部署至静态托管/CDN，或由反向代理提供；不要求另写一套 React DOM 应用。
- **Home Assistant**：既是设备状态来源，也可在 Home Assistant OS 上通过 Supervisor API proxy 为 App 提供受控的 Core API 访问能力；具体实现见 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`。

## 后端环境变量示例

```dotenv
NODE_ENV=development
APP_PORT=8500
APP_BASE_URL=http://localhost:8500
SESSION_SECRET=replace-with-long-random-secret
APP_ENCRYPTION_KEY=replace-with-supported-key-format
DATABASE_URL=file:./data/app.db
HA_CONNECT_TIMEOUT_MS=5000
HA_REQUEST_TIMEOUT_MS=10000
AI_ENABLED=false
AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=30000
LOG_LEVEL=info
ALLOW_INSECURE_LOCAL_HTTP=true
# Optional: only set when server-side push notifications are enabled
PUSH_PROVIDER=
EXPO_ACCESS_TOKEN=
```

环境变量名称以实际实现为准；新增变量必须同步更新本文档和 `.env.example`。生产启动检查必需变量；占位值不可用于生产；`.env` 不得提交。`ALLOW_INSECURE_LOCAL_HTTP` 不能绕过 SSRF 地址策略。

## 客户端公开配置

- 服务器 URL 应通过用户连接流程保存；不应假设一个统一的部署 URL。
- 如使用 `EXPO_PUBLIC_*` 配置，只允许公开值（例如公开的产品名称、非敏感 API build-time default）；绝不放 token、secret、私有 provider key。
- `app.config.ts` 中可包含 bundle identifier、scheme、图标、权限说明和插件配置；不能包含私密凭据。
- `eas.json` 至少定义 development、preview、production profiles。实际账号、signing secrets 和提交凭据由受控环境管理。
- 原生 app 与自托管 API 版本可能独立升级；客户端应对未知 API capability/version 提供兼容性错误提示。

## Home Assistant App 设计要求（首选）

遵循 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`，包括 `repository.yaml`、App `config.yaml`、多架构镜像发布、Ingress、`/data` 持久化、API 安全边界和 HAOS 实机验收。Ingress 只服务浏览器 Web UI，不是原生客户端 API 认证方案。

## Compose 设计要求（备用）

- 持久化数据库数据目录和加密凭据所需的 key 管理说明。
- app/API 使用非 root 用户（若基础镜像允许）。
- 配置 healthcheck 与 restart policy。
- 数据库/Redis 默认不映射公网端口。
- secrets 以环境变量或 secret mount 注入，不写入镜像层。
- 明确端口、卷、备份、升级和回滚方法。
- 不把 `.ipa` / `.aab` 产物放进后端容器镜像。

## 本地开发

1. 安装项目指定 Node LTS 和 pnpm 版本。
2. 安装 Xcode（iOS 本地构建）和/或 Android Studio / Android SDK；也可对支持的目标使用 EAS Build。
3. 复制 `.env.example` 为 `.env`，填充仅供本地开发的配置。
4. 安装 workspace 依赖并运行 DB migration。
5. 启动 NestJS API。
6. 在 `apps/mobile` 启动 Expo；分别验证 iOS、Android 与 Web 目标。具体脚本以仓库 `package.json` 为准。
7. 先用 mock HA 测试，再连接测试 Home Assistant。
8. 原生模块增加或配置更改后重建 development build。

可考虑的命令（以当前 Expo SDK/脚本为准，agent 必须实际验证）：
- `npx expo start`
- `npx expo start --web`
- `npx expo export --platform web`
- `npx expo-doctor`
- `npx expo install --check`
- `eas build --platform android --profile preview`
- `eas build --platform ios --profile preview`

不要假定任何未实际配置的脚本或凭据已存在。

## 网络与 HTTPS

- 手机必须能访问自托管 API 地址；localhost 指向手机自身而不是开发电脑/家庭服务器。
- 生产远程网络使用 HTTPS/WSS。局域网 HTTP 是受控例外，需明确目标地址、设备信任和平台安全设置。
- API 不应依赖客户端与服务器处于同一局域网；远程访问可通过 VPN 或安全反向代理。
- 不在客户端直接连接 HA；客户端只连接 HomeWeave API。

## 备份与恢复

必须说明哪些卷含 DB、配置和加密数据；备份前如何保证一致性；如何备份并恢复应用加密密钥；恢复后如何验证 HA 连接、dashboard、场景、任务历史和认证会话。密钥丢失可能导致加密凭据无法解密。

## 升级策略

- 后端升级前备份数据库。
- 每次 schema 变化包含 migration。
- 原生依赖、Expo SDK 或 config plugin 变化时重新 build 并验证 iOS/Android；不能假设 JavaScript OTA 可以替代所有原生升级。
- Web export 需要通过目标浏览器的 smoke test。
- 不静默删除用户数据；失败时按文档回滚并恢复备份。


---

# Source: docs/15_GLOSSARY.md

# 15 — 术语表

- **Home Assistant (HA)**：本产品首要的家庭设备与自动化集成平台。
- **Entity / 实体**：HA 中代表一个设备能力或状态的对象，例如某盏灯或温度传感器。
- **Device / 设备**：承载一个或多个实体的物理/逻辑设备。
- **Area / 区域**：HA 中表示房间或空间的分类。
- **Capability / 能力**：实体当前真实支持的可执行/读取操作。
- **Dashboard / 仪表盘**：用于查看和控制设备的 UI 布局。
- **Scene / 场景**：一组目标状态或 HA 场景调用，用于一次性执行。
- **Automation / 自动化规则**：由触发器、条件和动作组成的长期规则。
- **Fast-Path**：确定性解析明确简单命令的低延迟路径。
- **Agent Planning**：LLM 根据目标和有限上下文提出结构化执行计划。
- **Tool Registry**：已注册并有 schema、权限、风险与处理器的工具目录。
- **Policy Engine**：服务端决定调用是否被允许、需不需要确认的策略模块。
- **Task / 任务**：一个用户目标及其执行状态、步骤和结果。
- **Task Step / 步骤**：任务中一次工具调用或动作。
- **Verification / 验证**：通过 HA 实际状态确认目标是否达到。
- **Unknown**：请求可能已发出，但不能可靠确认最终状态。
- **Stale**：状态快照可能过期，不能当成实时状态。
- **Source of Truth**：权威事实来源；本产品中设备当前状态以 HA 为准。
- **Prompt Injection**：外部内容试图影响模型越过原始指令或安全边界。
- **MCP**：Model Context Protocol；作为可选扩展入口，必须复用同一安全工具层。
- **Idempotency**：相同请求重复执行不会造成重复副作用或错误状态。
- **ADR**：Architecture Decision Record，架构决策记录。

- **Expo Universal App**：单一 Expo/React Native 工程，面向 iOS、Android，并可用 React Native Web 提供 Web 版本。
- **React Native Web**：将 React Native primitives 映射到浏览器的实现；不代表原生平台能力与 Web 完全一致。
- **Expo Router**：基于文件的跨平台路由。
- **Development Build**：包含应用自身原生配置/模块的开发客户端，用于替代长期依赖 Expo Go 的生产开发方式。
- **EAS Build**：Expo 提供的云端/自动化原生构建服务。
- **Platform Adapter**：在统一接口下封装原生与 Web 的差异，例如 SecureStore 与 cookie、Push 与 WebSocket。
- **Refresh Token Rotation**：每次刷新时换发新 refresh token，并使旧 token 失效。


---

# Source: docs/16_MOBILE_APP_ARCHITECTURE.md

# 16 — Expo Universal App 架构与发布规范

## 1. 目标与明确边界

项目使用 **一套主要客户端代码库** 构建：
- iOS App
- Android App
- Web（基于 React Native Web，作为同一 Expo 工程的输出）

入口是 `apps/mobile/`。不要默认新建 `apps/web/`，也不要把 React DOM 组件直接当成 React Native 组件使用。

后端 `apps/api/` 负责家庭集成、AI、任务执行、权限、审计和 push dispatch。移动应用只是控制/观察客户端；不负责可靠的持续后台任务。

## 2. 推荐依赖职责

- Expo + React Native + TypeScript：跨平台 UI 基础。
- Expo Router：文件路由、深链接与导航。
- React Native Web：Web 目标的 React Native primitives 实现。
- TanStack Query：API 数据缓存与失效。
- Zustand（可选）：纯 UI 状态，不承载权威设备状态。
- Zod：运行时校验。
- `expo-secure-store`：iOS/Android refresh token 等敏感本地值。
- Expo Notifications：通知权限、通知响应和客户端 token 注册；真正的推送供应商凭据和发送工作留在后端。
- `expo-linking` / Expo Router linking：deep links / universal links，最终配置由实际 app ID 和域名决定。
- React Native Testing Library + `jest-expo`：组件/客户端测试。
- Playwright：Web export 的 browser E2E。
- Maestro：首选原生端主要旅程 E2E；若仓库现有 Detox 等工具，先评估复用。
- EAS Build / Submit：原生构建与发布；正式项目使用 development build 验证原生模块。

版本需与当前 Expo SDK 兼容。不要自行编造固定版本号；使用 `npx expo install` 管理 Expo packages，运行当前 SDK 提供的兼容性检查。

## 3. 路由与布局

建议路由（可按 UX 调整，但须保持语义一致）：

```text
apps/mobile/app/
├── _layout.tsx
├── index.tsx                      # redirect based on setup/auth
├── (auth)/
│   ├── login.tsx
│   ├── connect-server.tsx
│   └── setup.tsx
├── (app)/
│   ├── _layout.tsx                # tabs / responsive shell
│   ├── index.tsx                  # dashboard
│   ├── rooms/index.tsx
│   ├── rooms/[roomId].tsx
│   ├── devices/[entityId].tsx
│   ├── scenes/index.tsx
│   ├── scenes/[sceneId].tsx
│   ├── assistant/index.tsx
│   ├── tasks/index.tsx
│   ├── tasks/[taskId].tsx
│   └── settings/
│       ├── index.tsx
│       ├── server.tsx
│       ├── integrations.tsx
│       └── preferences.tsx
└── +not-found.tsx
```

Routes 只负责组装 screen/feature，不放设备业务逻辑。把 API hooks、状态转换和控制逻辑放 `src/features` / `src/services`。

## 4. 服务端 URL 与初次配对

- P0 支持用户手动输入自托管 server base URL；校验 scheme、host、port 和 `/api/v1` 约定。
- 可以选择后续实现一次性 QR pairing；二维码只包含服务器 URL 与短时一次性配对码，不得包含 HA token、LLM key 或长期 bearer token。
- 不假设局域网 DNS 自动发现一定有效。手机与服务器可能在不同 VLAN、Guest Wi-Fi、VPN 或移动网络。
- 用户可以测试连接、保存多个服务器（如后续支持），切换当前服务器并明确注销。
- 服务端 URL 不是秘密，但缓存 key 必须包含 `serverId/baseUrl`，切换服务端后清空所有旧服务端的数据缓存。
- 生产远程连接必须 HTTPS/WSS。局域网 HTTP 只能作为显式配置的开发/家庭模式，并做地址与证书策略说明；iOS ATS 例外和 Android cleartext 例外不得无范围地全局开启。

## 5. 认证与存储

### iOS / Android
- access token 尽可能只保存在内存中。
- refresh token 使用 `expo-secure-store` 或经过安全审查的系统 Keychain/Keystore 封装保存。
- refresh token 必须轮换并可服务端撤销；检测到 token 重放时撤销相关会话。
- 不在 AsyncStorage、普通 SQLite、日志、埋点或 crash 文本中保存长期秘密。
- 不存 Home Assistant token；HA 凭据只存在后端。

### Web
- 使用 HttpOnly、Secure、SameSite cookie 和适当的 CSRF 防护。
- 不将长期 refresh token 保存到 `localStorage` 或可被任意 JS 读取的持久存储。
- API client 通过平台 auth adapter 调用相同业务端点；业务 API 不因平台复制一套。

### 共用原则
- `AuthSessionStore` 提供 `getAccessToken`、`refresh`、`logout` 等平台无关接口，底层实现使用 `.native` / `.web` adapter。
- refresh 失败时清空本地会话并回到登录/连接流程。
- 登出应在服务端撤销 refresh session，客户端删除凭据和缓存。
- 多个并发请求遇到 401 时只允许单次 refresh，避免 refresh token 竞争。

## 6. API 与实时状态

- 所有 API 调用经过 `packages/api-client`，不得在组件内散落 URL 字符串和认证逻辑。
- REST 用于读取快照、提交命令和读取任务详情；WebSocket 用于收到状态更新与任务进展。
- WebSocket 断线用指数退避重连。连接恢复后先 REST refetch，再处理增量事件。
- 事件应携带事件 ID、时间和相关对象 ID；客户端忽略已处理的重复事件，并避免旧数据覆盖新数据。
- TanStack Query 管理 server state；WebSocket 事件应精确更新/invalidate 相关 query，不要每次事件刷新所有数据。
- 多设备任务由后端执行，即使 App 退出也能完成；App 回到前台时拉取最新 task snapshot。
- 无网络时可以显示缓存，但需标 stale 和最后更新时间。物理设备操作不默认进入离线队列。

## 7. 通知

- P0：前台应用通过 WebSocket 接收任务状态和设备更新。
- P1：使用系统 push 通知用户任务结束、需要确认或重要异常；APNs/FCM/Expo push 凭据由服务端持有。
- 数据模型应把 push token 与具体 app installation 绑定，支持刷新、注销、平台、最后活跃时间与用户关联。
- Push payload 尽量只包含不敏感的类型、资源 ID 和通用文案；App 打开后从已认证 API 拉取真实内容。
- Push 发送失败不影响任务执行结果；通知不是状态真相来源。
- 不把高风险设备动作放在锁屏通知的一键 action 中绕过二次确认。

## 8. iOS / Android 平台差异

- 使用 React Native `Platform` 或文件后缀，将差异集中在 `src/platform/` 或单个适配组件。
- 需要原生模块时先评估 Expo SDK 兼容插件，配置写在 `app.config.ts`；新增原生依赖后要重新 build development client。
- 不要为小型差异复制整页；平台专用组件保持同样的数据契约。
- 运行时权限按需请求，给出用途说明；拒绝通知权限不能阻断主功能。
- iOS 与 Android 的通知、深链接、系统后退、权限与存储行为都要分别做测试。
- 必须验证安全区域、键盘、状态栏、旋转、不同屏幕尺寸、系统字体和深浅色模式。

## 9. 背景执行与离线约束

- 不能依赖 iOS/Android 进程常驻来执行自动化、重试或长任务。
- App 进入后台或被操作系统终止后，后台任务仍由服务器完成，客户端重新打开时读取结果。
- 不为所有设备命令设计乐观离线队列。过期状态、其他家庭成员操作或设备真实状态变化会使排队命令危险。
- 对只读数据可使用有限缓存；操作按钮在断网时应禁用或提示连接恢复。
- 必须区分网络断开、服务器不可用、HA 集成不可用和实体 stale。

## 10. 构建、发布与版本

- 每个环境配置明确的 `scheme`、bundle identifier、Android package、API base URL 来源和 build channel。
- 不把秘密写进 `app.config.ts`、`EXPO_PUBLIC_*` 或客户端 bundle；`EXPO_PUBLIC_*` 只能用于公开配置。
- 配置 development / preview / production build profiles。
- development build 用于开发原生模块与调试；Expo Go 只适合早期验证，不作为正式验收的唯一环境。
- EAS 或本地构建的签名凭据按团队权限管理；不提交 keystore、p12、provisioning profile 或证书私钥。
- 生产构建至少验证 iOS 与 Android 核心流程；Web 单独运行导出与浏览器 E2E。
- 只在原生二进制配置、插件或 native dependency 变化时评估是否需要完整原生重建；不能假设所有更新都能通过 OTA 更新。
- 遵循商店规则、隐私披露、数据删除/账户管理要求与推送权限政策。

## 11. 必须维护的官方参考

- Expo universal app: https://docs.expo.dev/tutorial/introduction/
- Expo Router: https://docs.expo.dev/router/introduction/
- Development builds: https://docs.expo.dev/develop/development-builds/introduction/
- EAS Build: https://docs.expo.dev/build/introduction/
- React Native platform-specific code: https://reactnative.dev/docs/platform-specific-code.html


---

# Source: docs/18_INITIAL_PROMPT_CLAUDE_CODE_CODEX.md

# 18 — Claude Code / Codex 初始开发 Prompt

本文件是一份可直接复制到 **Claude Code** 或 **OpenAI Codex** 的项目启动提示词。推荐在新仓库或已有仓库的根目录运行。

## 使用前准备

1. 将本规格包放到项目仓库根目录，或把 `AGENTS.md`、`CLAUDE.md`、`README.md` 和 `docs/` 复制到根目录。
2. 确认当前目录是正确的 Git 仓库。
3. 对已有项目，先提交或备份当前工作；不要让 Agent 覆盖未提交改动。
4. 把下面完整提示词粘贴给 Claude Code 或 Codex。Codex 应遵循 `AGENTS.md`；Claude Code 还应读取 `CLAUDE.md`，后者指向统一规则源。

## 初始开发 Prompt（复制下面内容）

```text
你正在开发 HomeWeave（织家），一个基于 Home Assistant 的 AI Home Operating System。

产品核心目标：让用户通过直观 UI、场景和自然语言，以安全、可解释、可验证的方式完成家庭任务。客户端采用 Expo + React Native + TypeScript，iOS 与 Android 共用一套主要客户端代码，Web 由 React Native Web 支持；后端采用 NestJS 模块化单体。UI、AI Agent、MCP 和自动化必须共用服务端的工具注册、权限策略与执行服务。

请先读取以下文件：
- 根目录 AGENTS.md
- 根目录 CLAUDE.md（仅 Claude Code 使用；它应引用 AGENTS.md，不创建冲突规则）
- README.md
- docs/00_PRODUCT_BRIEF.md
- docs/01_PRD.md
- docs/02_ARCHITECTURE.md
- docs/03_TECH_STACK_AND_REPO.md
- docs/05_API_SPEC.md
- docs/06_AGENT_AND_TOOLING.md
- docs/08_SECURITY_AND_PRIVACY.md
- docs/10_TEST_AND_ACCEPTANCE.md
- docs/11_IMPLEMENTATION_ROADMAP.md
- docs/12_CODING_AGENT_GUIDE.md
- docs/16_MOBILE_APP_ARCHITECTURE.md
- docs/18_INITIAL_PROMPT_CLAUDE_CODE_CODEX.md

本轮执行 Phase 0：仓库审查与工程基线。不要一开始就一次性实现完整产品，也不要未经分析就大规模重写。

任务：
1. 检查 Git 状态、分支、未提交改动、项目结构、包管理器、Node/Expo/NestJS 版本、依赖、scripts、测试、数据库、Docker、CI 和构建配置。
2. 判断仓库是空仓库、已有部分实现，还是已有成熟产品代码。明确区分“已实现”“部分实现”“未实现”和“无法验证”。
3. 对照 PRD 与架构文档，输出差距清单、可复用模块、冲突、风险和依赖关系。
4. 若仓库已有实现，优先复用；任何框架迁移、破坏性数据库迁移或大规模目录重组都必须先提出理由与 ADR，不得静默执行。
5. 若仓库为空，建议的目标结构是 apps/mobile（Expo Universal App）、apps/api（NestJS）和 packages/contracts、packages/api-client、packages/domain、packages/validation、packages/design-tokens。不要创建独立的 React + Vite Web UI，除非经过 ADR 证明有必要。
6. 制定按依赖关系排序的 Phase 0–6 计划。每项写明目标、拟修改路径、测试/验证命令、验收标准和不在范围内的事项。
7. 检查是否存在秘密泄漏、弱默认密码、未受保护的设备控制入口或把模型输出直接当作权限依据的问题。不要打印或复制真实秘密到报告。
8. 在这次任务中只执行安全、可逆的审查与基线工作。除非仓库完全为空且建立基础配置不会破坏现有内容，否则先输出计划，不要创建大量业务代码。

不可违反的原则：
- Home Assistant 是设备当前状态的事实来源；命令发送成功不等于设备已达到目标状态。
- 无法验证执行结果时必须标记 unknown，不能报告为成功。
- AI 负责理解和规划；服务端负责参数验证、授权、风险判断、执行、审计和结果验证。
- 模型输出中的 riskLevel、requiresConfirmation 或 permission 字段不可信，必须由服务端策略重新计算。
- 客户端不得直接连接 Home Assistant，也不得打包 HA token 或模型 API key。
- 所有设备操作都必须通过统一 Tool Registry / Policy Engine / Application Services。
- MVP 不允许 AI 无人值守解锁门锁或关闭安防，也不允许未经用户确认发布 AI 生成的自动化。
- 所有外部输入必须做 schema 验证；禁止提供任意 Shell、任意代码执行或任意 URL 工具。
- 不覆盖用户未提交改动；不虚报测试；不得声称运行了实际未运行的命令。

完成后请按以下格式汇报：
A. 仓库现状与判断
B. 已实现 / 部分实现 / 缺失 / 无法验证的功能
C. 与规格的主要差距及风险
D. 推荐实施顺序和每阶段验收命令
E. 本轮实际执行的命令和结果
F. 未执行的测试与原因
G. 下一步最小可执行任务

本轮不需要实现完整 HomeWeave。以准确理解现状、避免破坏已有工作、形成可靠开发路径为首要目标。
```

## Phase 0 完成后的下一条 Prompt

```text
请根据刚完成的仓库审查报告，执行 docs/11_IMPLEMENTATION_ROADMAP.md 的 Phase 1（Monorepo、Expo 客户端与 NestJS 后端骨架）。先列出具体改动计划，然后只实现 Phase 1，不提前实现 Home Assistant 控制或 AI Agent 功能。

必须提供可运行的最小纵向切片：workspace、apps/mobile、apps/api、shared contracts、健康检查、基本配置、登录/首次设置的骨架、错误处理、基础测试和本地启动说明。创建前确认现有技术栈与规格没有冲突。

完成后运行实际可执行的 lint、format check、typecheck、unit tests、Expo doctor/dependency check（若当前 SDK 支持）和 Web export；报告 iOS/Android 原生构建是否实际执行及未验证原因。不要声称未经运行的检查已通过。
```

## 专门给 Codex 的使用提示

- 以仓库根目录打开 Codex，并确保它能读取 `AGENTS.md` 和 `docs/`。
- 先使用只读/计划型审查完成 Phase 0，再把 Phase 1 作为独立任务。
- 如果 Codex 当前界面有批准或命令执行权限设置，涉及安装依赖、删除文件、数据库迁移和设备操作的命令应先审查再批准。

## 专门给 Claude Code 的使用提示

- 在项目根目录启动 Claude Code。
- 开始前确保它读取 `CLAUDE.md` 与 `AGENTS.md`；统一工程约束以 `AGENTS.md` 为准。
- 使用 Plan/规划流程审阅改动范围，Phase 0 通过后再开始 Phase 1。



---

# Source: docs/19_CODEBUDDY_WORKFLOW.md

# 19 — CodeBuddy 工作流与项目规则

> 适用于腾讯 CodeBuddy IDE / CodeBuddy Code。项目规则格式与加载行为可能随产品版本变化；首次打开项目时请在 CodeBuddy 的 Rules 页面确认规则启用情况。

## 1. CodeBuddy 如何读取项目上下文

- 根目录 `CODEBUDDY.md`：CodeBuddy IDE 的项目说明入口，保持简洁，链接到完整规格。
- 根目录 `AGENTS.md`：跨工具统一工程规则，给 Codex、Claude Code、OpenCode 等共用；CodeBuddy 文档也说明当不存在 `CODEBUDDY.md` 时可以回退加载 `AGENTS.md`。
- `.codebuddy/rules/<rule-name>/RULE.mdc`：CodeBuddy IDE 项目规则，适合将架构、安全、开发流程和 Expo 平台细则拆分管理。
- `docs/`：正式产品和技术规格；规则文件不应重复复制整份 PRD。
- `SPEC_BUNDLE.md`：适用于单文件上下文受限场景的整合规格，不替代分文件文档。

官方资料：
- CodeBuddy 规则： https://www.codebuddy.ai/docs/zh/ide/User-guide/Rules
- CodeBuddy 快速开始： https://www.codebuddy.ai/docs/ide/Getting-Started/Quickstart
- CodeBuddy 斜杠指令： https://www.codebuddy.ai/docs/zh/ide/User-guide/Slash-Commands

## 2. 规则分层

- Always：核心架构、安全约束、交付工作流；默认随每个会话应用。
- Agent Requested / Manual：Expo 原生平台细则等专项规则，适用时由 Agent 调用或用户在 Rules UI 中手动启用。
- CodeBuddy 文档说明，规则更改后需要新建会话，才能确保新的规则进入会话上下文。
- 若你的 CodeBuddy 版本未自动发现仓库里的规则文件，请通过 IDE 的 Rules 设置导入/创建项目规则，并保持文件内容与仓库一致；不要假设文件存在就代表已经加载。

## 3. 推荐启动流程

1. 使用 CodeBuddy 打开整个 HomeWeave 项目根目录，而非只打开 `apps/mobile` 或 `apps/api`。
2. 检查 `CODEBUDDY.md`、`AGENTS.md` 是否可读，以及 `.codebuddy/rules/` 中的规则是否启用。
3. 开始新会话；先粘贴 `docs/20_INITIAL_PROMPT_CODEBUDDY.md` 的 Phase 0 提示词。
4. 让 Agent 先审查 Git 状态、现有实现、测试、依赖和安全风险；Phase 0 只做审查和规划。
5. 审阅规划后，再单独下达 Phase 1 的开发任务；每次只做一个可验收阶段。
6. 运行测试和检查。报告只能包含真实执行过的命令和结果。

## 4. CodeBuddy 常用能力建议

CodeBuddy 官方文档目前介绍了项目规则、`CODEBUDDY.md`、`/init`、`/rules`、`/explain`、`/fix`、`/tests` 与 `/cr` 等能力。界面和命令支持以安装的版本为准。

建议用法：
- `/init`：如项目还未配置 CodeBuddy 项目说明，可查看其建议；不要直接覆盖已有 `CODEBUDDY.md`，应先审阅差异。
- `/rules`：可辅助生成规则，但应与仓库 `.codebuddy/rules` 统一，避免在 IDE 内产生只存在本机的漂移规则。
- `/explain`：了解现有模块或任务状态流。
- `/tests`：为关键逻辑生成测试；生成后仍需实际运行并审阅。
- `/fix`：对具体测试/类型/lint 错误进行有范围的修复。
- `/cr`：交付前做代码审查，特别关注权限、任务幂等、HA 状态验证与泄密。

不要假设斜杠命令可以组合在同一条消息中；按当前界面支持的方式逐个执行。

## 5. 工程策略

HomeWeave 的唯一规范源仍是分文件 `docs/*.md`、`docs/openapi.yaml`、`AGENTS.md` 和 `.codebuddy/rules/*/RULE.mdc`。任何 API、数据库、权限策略或技术选型变更都要同步规格，并在需要时增加 ADR。

## Home Assistant OS 一键安装部署

如果当前任务涉及部署、发布或 HAOS 安装，必须先阅读 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`，并使用 `docs/22_INITIAL_PROMPT_HA_APP_CODEBUDDY.md`。首选 Supervisor App + GHCR 预构建多架构镜像；Home Assistant Container 用户继续使用 Compose。HAOS 真实安装/升级未经验证时不得宣称通过。


---

# Source: docs/20_INITIAL_PROMPT_CODEBUDDY.md

# 20 — HomeWeave CodeBuddy 初始开发 Prompt

适用于腾讯 CodeBuddy IDE / CodeBuddy Code。建议先打开项目根目录，并确认 `CODEBUDDY.md` 与 `.codebuddy/rules/` 中的规则已加载。

## 初始 Prompt（完整复制到 CodeBuddy）

```text
你正在开发 HomeWeave（织家），一个基于 Home Assistant 的 AI Home Operating System。

请首先读取根目录 CODEBUDDY.md、AGENTS.md、README.md，以及以下规格：
- docs/00_PRODUCT_BRIEF.md
- docs/01_PRD.md
- docs/02_ARCHITECTURE.md
- docs/03_TECH_STACK_AND_REPO.md
- docs/05_API_SPEC.md
- docs/06_AGENT_AND_TOOLING.md
- docs/08_SECURITY_AND_PRIVACY.md
- docs/10_TEST_AND_ACCEPTANCE.md
- docs/11_IMPLEMENTATION_ROADMAP.md
- docs/16_MOBILE_APP_ARCHITECTURE.md
- docs/19_CODEBUDDY_WORKFLOW.md
- docs/20_INITIAL_PROMPT_CODEBUDDY.md
- docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md
- docs/22_INITIAL_PROMPT_HA_APP_CODEBUDDY.md

请在需要时显式读取 .codebuddy/rules/ 下适用的 RULE.mdc，并确认 CodeBuddy 当前会话实际加载了哪些项目规则。不要假设规则文件存在就必定已启用。

本轮只执行 Phase 0：仓库审查与工程基线，不修改业务代码。

检查：
1. 当前工作目录、Git 分支、未提交修改和是否存在已有代码。
2. 仓库目录、包管理器、Node/TypeScript/Expo/NestJS 版本、依赖和脚本。
3. lint、format、typecheck、unit/integration/E2E tests、原生构建、Web export、Docker 和 CI 的现状。
4. 与 PRD、架构、OpenAPI 和数据模型的差距，哪些已实现、部分实现、未实现或无法验证。
5. 可复用模块、架构冲突、迁移风险、依赖风险、秘密泄漏风险和设备操作安全风险。
6. 若仓库为空，说明如何按 pnpm workspaces、apps/mobile（Expo Universal App）、apps/api（NestJS）和 packages/* 初始化；本轮不直接创建大量业务代码。
7. 对部署方案优先采用 Home Assistant OS Supervisor App + GHCR 预构建多架构镜像；Home Assistant Container 继续支持 Docker Compose。先阅读 docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md，不要在本轮实现部署代码。

不可违反的原则：
- iOS/Android 共用 Expo + React Native + TypeScript；Web 可用 React Native Web。不要默认创建第二套 React + Vite 前端。
- Home Assistant 是设备状态事实来源；客户端只访问 HomeWeave 后端。
- AI 负责理解和规划；服务端负责 schema validation、授权、风险重算、执行、审计和状态验证。
- UI、AI、MCP 与自动化共用 Tool Registry、Policy Engine 和 Application Services。
- 命令被接受不代表操作已完成；未能验证结果时必须标记 unknown。
- MVP 不允许 AI 无人值守解锁门锁或关闭安防；未经用户确认不得发布 AI 生成的自动化。
- 模型输出中的 riskLevel、permission、requiresConfirmation 字段不可信，服务端必须重新计算。
- 不允许任意 Shell、任意代码执行、任意 URL 或未受控的 HA service call 工具。
- 不打印、复制或提交任何真实密钥；不覆盖用户未提交修改；不执行未经批准的破坏性迁移。
- 不虚报测试结果，必须区分实际运行、通过、失败、跳过与未验证。

请按以下结构汇报：
A. 仓库现状和 Git 状态
B. 已实现 / 部分实现 / 未实现 / 无法验证功能矩阵
C. 与规格的差距及可复用模块
D. 安全、架构、依赖与迁移风险
E. Phase 0–6 计划：每阶段目标、涉及目录、依赖、验收标准和测试命令
F. 本轮实际运行的命令和结果
G. 下一项最小可执行任务

本轮只审查并形成计划，等待我审阅后再执行 Phase 1。不要一次性构建完整产品。
```

## Phase 0 审阅通过后的 Phase 1 Prompt

```text
根据已审阅的差距分析和 docs/11_IMPLEMENTATION_ROADMAP.md，只执行 Phase 1：Monorepo 工程骨架与最小可运行纵向切片。

先列出计划和受影响文件。严格尊重未提交修改。不要提前实现 Home Assistant 设备控制、复杂 AI Agent 或主动自动化。

目标（依赖当前仓库现状调整）：
- pnpm workspace 与共享配置；
- apps/mobile 的 Expo Universal App 最小启动页；
- apps/api 的 NestJS health/live 和 health/ready 端点；
- packages/contracts、packages/validation 和 packages/api-client 的最小骨架；
- 环境变量模板、统一错误处理、日志脱敏基础；
- lint、typecheck、unit tests 及适用的 Expo 检查；
- README 中的本地启动、测试与排障说明。

请先确认 Expo SDK 兼容的依赖版本，不要随意固定过期版本。实际运行适用的测试并汇报结果；无法执行的原生构建或设备测试要说明原因。不要声称未经运行的检查通过。
```


---

# Source: docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md

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


---

# Source: docs/22_INITIAL_PROMPT_HA_APP_CODEBUDDY.md

# 22 — HomeWeave Home Assistant App 部署实施 Prompt（CodeBuddy）

本 Prompt 用于让 CodeBuddy 将现有 HomeWeave 规格落地为可从 Home Assistant OS 的 Apps 商店安装的后端。先把此文档和 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` 提供给 Agent。

## 可直接复制给 CodeBuddy 的完整 Prompt

```text
你正在开发 HomeWeave（织家）。请先阅读 CODEBUDDY.md、AGENTS.md、README.md、docs/01_PRD.md、docs/02_ARCHITECTURE.md、docs/07_HOME_ASSISTANT_INTEGRATION.md、docs/08_SECURITY_AND_PRIVACY.md、docs/10_TEST_AND_ACCEPTANCE.md、docs/11_IMPLEMENTATION_ROADMAP.md、docs/14_ENV_AND_DEPLOYMENT.md、docs/16_MOBILE_APP_ARCHITECTURE.md、docs/19_CODEBUDDY_WORKFLOW.md、docs/20_INITIAL_PROMPT_CODEBUDDY.md 和 docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md。

目标：把 HomeWeave 的首选家庭部署方式调整为 Home Assistant App（旧称 Add-on），让 Home Assistant OS 用户通过添加 Git 仓库、点击安装即可部署和管理 NestJS 后端。保留 Docker Compose 作为 Home Assistant Container 用户的备用方案。不要把 NestJS 后端误实现为 Python 自定义集成。

先检查 Git 状态、现有实现、工作区未提交修改和当前发布配置。不要覆盖用户修改。先输出实施计划和受影响文件；如果没有真实 HA OS 设备，标记哪些测试不能完成。

目标架构：
- 客户端：Expo + React Native + TypeScript，位于 apps/mobile，支持 iOS、Android 和可选 React Native Web。
- 后端：NestJS + TypeScript，位于 apps/api。
- HA OS 部署：Supervisor 管理 HomeWeave App 容器；SQLite 和应用数据放在 /data。
- 发布：GitHub Actions 构建 amd64/aarch64 镜像并发布到 GHCR；Home Assistant 安装时拉取预构建镜像，不在 HA 主机现场编译完整项目。
- Web：可选通过 HA Ingress 访问，必须适配动态 base path 和 WebSocket。
- 原生 App：通过独立、受保护的 HomeWeave API 连接；不得把 Ingress token 当成原生 API 凭据。
- 备用部署：Home Assistant Container 用户可使用 Docker Compose，但不能声称其拥有 Apps 商店。

实施任务（分阶段完成，不要一次性重写业务）：
1. 创建/更新根目录 repository.yaml 和 homeweave_app/config.yaml、Dockerfile、DOCS.md、README.md、CHANGELOG.md、必要的 AppArmor profile/启动文件。避免在普通目录放置会被 Supervisor 误识别的额外 config.yaml。
2. 参考 Home Assistant 当前官方 apps-example 和官方 builder actions，建立 GitHub Actions CI/CD。先运行静态检查和测试，再构建并发布 amd64、aarch64 镜像及多架构 manifest。
3. 保证 config.yaml version 与 GHCR 镜像版本标签完全一致。发布顺序必须是先发布镜像并验证公开可拉取，再提交版本号更新；不得覆盖已发布的版本标签。
4. 将 NestJS、Prisma 和 SQLite 正确打包进生产镜像。SQLite 使用 /data 下的路径；校验 Prisma engine 与 Node 原生依赖的多架构兼容性。生产启动使用可审计 migration deploy，绝不自动 reset 数据库。
5. 优先使用 Supervisor 提供的 Home Assistant API 代理（仅在确认当前 HA App 规范支持且经过测试后启用）。Supervisor token 只允许存在后端运行环境，不能写入日志、数据库、API 响应、Web bundle 或移动客户端。由于该能力权限较高，必须在文档中解释风险并最小化 App 权限。
6. Ingress 只用于 HA 内嵌 Web UI。Web 需要支持动态路径、刷新和 WebSocket。Ingress 不替代原生 App 的认证。
7. 原生 API 端口默认按最小暴露原则处理。只有当独立认证、授权、审计、速率限制和安全传输策略落实后才启用对宿主机的端口映射。不要无认证开放 API，不要把 HA、Supervisor、数据库端口暴露到公网。
8. 增加 /health/live 和 /health/ready，容器重启策略、日志脱敏、优雅关闭、数据迁移和错误处理。
9. 编写安装、升级、回滚、备份/恢复和排障文档。明确 Home Assistant OS 与 Home Assistant Container 的差异。验证备份是否包含 /data，不要未经测试就承诺自动备份覆盖 App 数据。
10. 更新 README、AGENTS.md、CODEBUDDY.md、docs/14_ENV_AND_DEPLOYMENT.md、docs/11_IMPLEMENTATION_ROADMAP.md、相关测试、OpenAPI 和 SPEC_BUNDLE.md（如果项目使用它）。

安全底线：
- 不在 Git、镜像、客户端或日志中放真实密钥。
- 不使用 chmod -R 777。
- 不允许模型绕过 Tool Registry 和 Policy Engine。
- MVP 不允许 AI 无人值守解锁门锁或关闭安防。
- 命令被接受不代表设备执行成功；无法验证时标记 unknown。
- 所有外部输入进行 schema 验证，HA 地址校验继续防 SSRF。
- 不得因为使用 Supervisor API proxy 而移除服务端权限校验和审计。

验收必须区分：
A. 已通过实际运行的检查；
B. 静态检查通过但未在 HA OS 验证的内容；
C. 因缺少真实设备/凭据而未验证的内容。

至少检查：Docker build、镜像架构、配置/YAML lint、NestJS 测试、Prisma 迁移、/data 持久化、重启后恢复、Ingress 动态路径、WebSocket、HA API 连接、秘密脱敏。真实 HA OS 安装/升级测试缺失时不得宣称完整验收通过。

先完成仓库差距分析和实现计划，等待我确认后按小批次实现。每批交付后报告修改文件、实际运行的命令、测试结果、剩余风险和下一步最小任务。
```

## Phase 0 审查通过后，可发送的下一条任务

```text
根据 docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md 和已确认的实施计划，只实现第一个垂直切片：Home Assistant App 元数据与最小容器启动骨架。先验证官方当前示例和配置格式，创建 repository.yaml、homeweave_app/config.yaml、Dockerfile、DOCS.md、README.md 和最小健康检查。暂不接入真实设备控制和 AI。运行实际可用的 lint/build/test，并列出必须在 HA OS 上手动验证的步骤。不要发布正式版本或覆盖现有 GHCR 标签。
```


---

# Source: docs/agent-checklist.json

{
  "version": "1.0",
  "principles": [
    "Home Assistant remains the source of truth for device state",
    "AI proposes; deterministic server-side services authorize, execute and verify",
    "All control entry points share ToolRegistry and PolicyEngine",
    "Never equate command submission with verified success",
    "High-risk operations require explicit confirmation and are not autonomous in MVP",
    "Use one Expo + React Native + React Native Web client under apps/mobile; do not create a second web UI without an ADR",
    "Native refresh tokens use secure storage; web refresh sessions use HttpOnly secure cookies and CSRF protection",
    "Reliable tasks execute on the server, never depend on mobile background execution",
    "Validate iOS, Android and Web targets separately; Web export alone does not prove native builds work"
  ],
  "mvp_acceptance": [
    "First-run admin setup and secure authentication",
    "Home Assistant connection test and idempotent entity sync",
    "Capability-aware dashboard and controls",
    "Post-command state verification with succeeded/failed/unknown states",
    "Fast-Path works without an LLM for supported commands",
    "Structured LLM plans are schema-validated server-side",
    "Task steps and audit summaries persist across restart",
    "Secrets are redacted from logs and never sent to the browser",
    "Docker deployment includes health checks and persistent storage",
    "The same apps/mobile project exports Web and builds iOS and Android targets",
    "Server URL can be configured and switched without leaking or mixing cached household data",
    "Offline state is marked stale and physical device commands are not silently queued",
    "Native and Web authentication storage follow platform-specific security policies"
  ]
}


---

# Source: docs/openapi.yaml

openapi: 3.1.0
info:
  title: HomeWeave API
  version: 1.0.0
  description: Initial contract template. Business endpoints are shared across Expo native and Web clients. Native uses bearer access tokens; Web uses secure cookie sessions with CSRF protection.
servers:
  - url: /api/v1
security:
  - sessionCookie: []
  - bearerAuth: []
paths:
  /setup/status:
    get:
      summary: Get initial setup status
      security: []
      responses:
        '200':
          description: Setup status
          content:
            application/json:
              schema:
                type: object
                required: [initialized]
                properties:
                  initialized: { type: boolean }
  /health/live:
    get:
      summary: Liveness check
      security: []
      responses:
        '200': { description: Process is alive }
  /auth/login:
    post:
      summary: Login (platform adapter determines cookie/body token delivery)
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [username, password, clientType]
              properties:
                username: { type: string }
                password: { type: string, writeOnly: true }
                clientType: { type: string, enum: [ios, android, web] }
                installationId: { type: string }
      responses:
        '200':
          description: Authenticated; native clients receive a short-lived access token and rotating refresh token in the response body, while Web receives HttpOnly secure cookies
          content:
            application/json:
              schema:
                type: object
                properties:
                  accessToken: { type: string }
                  refreshToken: { type: string, writeOnly: true }
                  expiresIn: { type: integer }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /auth/refresh:
    post:
      summary: Refresh auth session; rotate native refresh token or use secure Web cookie
      security: []
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                refreshToken: { type: string, writeOnly: true }
      responses:
        '200':
          description: Session refreshed; native response includes rotated refresh token, Web response sets secure cookies
          content:
            application/json:
              schema:
                type: object
                properties:
                  accessToken: { type: string }
                  refreshToken: { type: string, writeOnly: true }
                  expiresIn: { type: integer }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /auth/logout:
    post:
      summary: Revoke the current auth session and clear Web cookies
      responses:
        '204': { description: Session revoked }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /auth/me:
    get:
      summary: Get current user and permission summary
      responses:
        '200': { description: Current user }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /auth/sessions/revoke:
    post:
      summary: Revoke the current or an authorized selected session
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                sessionId: { type: string }
      responses:
        '204': { description: Session revoked }
        '401': { $ref: '#/components/responses/Unauthorized' }


  /client-installations/register:
    post:
      summary: Register a client installation and optional push token
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [installationId, platform]
              properties:
                installationId: { type: string }
                platform: { type: string, enum: [ios, android, web] }
                pushToken: { type: string, writeOnly: true }
                notificationsEnabled: { type: boolean }
      responses:
        '200': { description: Installation registered }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /client-installations/{id}:
    patch:
      summary: Update a client installation or rotate its push token
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                pushToken: { type: string, writeOnly: true }
                notificationsEnabled: { type: boolean }
      responses:
        '200': { description: Installation updated }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
    delete:
      summary: Revoke a client installation and disable its push registration
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string }
      responses:
        '204': { description: Installation revoked }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }

  /health/ready:
    get:
      summary: Readiness check
      security: []
      responses:
        '200': { description: Service is ready }
        '503': { description: Service is not ready }
  /home/summary:
    get:
      summary: Get home summary
      responses:
        '200':
          description: Home summary
          content:
            application/json:
              schema:
                type: object
                properties:
                  integrationStatus: { type: string }
                  observedAt: { type: string, format: date-time }
                  stale: { type: boolean }
                  areas:
                    type: array
                    items: { type: object, additionalProperties: true }
  /entities:
    get:
      summary: List normalized entities
      parameters:
        - in: query
          name: areaId
          schema: { type: string }
        - in: query
          name: domain
          schema: { type: string }
      responses:
        '200':
          description: Entity list
          content:
            application/json:
              schema:
                type: object
                required: [items]
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/Entity' }
  /entities/{id}/commands:
    post:
      summary: Submit a validated device command
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [command, parameters, idempotencyKey]
              properties:
                command: { type: string }
                parameters: { type: object, additionalProperties: true }
                idempotencyKey: { type: string, minLength: 8, maxLength: 200 }
      responses:
        '202':
          description: Command accepted for execution; not proof of success
          content:
            application/json:
              schema:
                type: object
                required: [commandId, status]
                properties:
                  commandId: { type: string }
                  status: { type: string, enum: [queued, running, needs_confirmation] }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { description: Conflict, stale plan, or idempotency conflict }
  /assistant/messages:
    post:
      summary: Submit a message for answer, query, or planning
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [message]
              properties:
                conversationId: { type: string }
                message: { type: string, minLength: 1, maxLength: 10000 }
      responses:
        '200':
          description: Answer or structured plan response
          content:
            application/json:
              schema:
                type: object
                required: [mode]
                properties:
                  mode:
                    type: string
                    enum: [answer, clarification_required, plan_ready, needs_confirmation, executing]
                  conversationId: { type: string }
                  taskId: { type: string }
                  message: { type: string }
                  plan: { type: object, additionalProperties: true }
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
    sessionCookie:
      type: apiKey
      in: cookie
      name: session
  schemas:
    Entity:
      type: object
      required: [id, externalId, domain, name, capabilities, stale]
      properties:
        id: { type: string }
        externalId: { type: string }
        domain: { type: string }
        name: { type: string }
        areaId: { type: [string, 'null'] }
        state: {}
        observedAt: { type: [string, 'null'], format: date-time }
        stale: { type: boolean }
        capabilities:
          type: array
          items: { type: string }
    Error:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message, requestId]
          properties:
            code: { type: string }
            message: { type: string }
            requestId: { type: string }
            details: { type: object, additionalProperties: true }
  responses:
    BadRequest:
      description: Invalid request
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Unauthorized:
      description: Authentication required
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Forbidden:
      description: Permission denied
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }


---

# Source: INITIAL_PROMPT_CODEBUDDY.md

# HomeWeave CodeBuddy 初始 Prompt 快捷入口

第一次打开仓库时，请复制 `docs/20_INITIAL_PROMPT_CODEBUDDY.md` 中的 Phase 0 Prompt。它只要求审查仓库和制定计划。

如果仓库审查完成并希望实现一键安装的 Home Assistant OS 部署，请先阅读 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`，再复制 `docs/22_INITIAL_PROMPT_HA_APP_CODEBUDDY.md` 中的完整 Prompt。不要把两轮任务混在一起：先审查，审阅计划，再实施部署。


---

# Source: INITIAL_PROMPT_HA_APP_CODEBUDDY.md

# HomeWeave — CodeBuddy Home Assistant App 部署 Prompt

完整指令见 `docs/22_INITIAL_PROMPT_HA_APP_CODEBUDDY.md`。请将该文件全文复制到 CodeBuddy。先审查仓库并等待确认，再分阶段实现 Home Assistant OS App、GHCR 多架构镜像发布、Ingress、持久化、安全、备份恢复和 Compose 备用部署。
