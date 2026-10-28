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
| `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` | HA App 部署、Supervisor 安装与镜像引用 |
| `docs/22_INITIAL_PROMPT_HA_APP_CODEBUDDY.md` | HA App 专项 Prompt |
| `docs/23_IMAGE_RELEASE_RUNBOOK.md` | 镜像发布手册：顺序强制、GHCR 可见性、resume 例外、回滚与失败判读 |
| `docs/openapi.yaml` | API 契约起始文件 |
| `docs/agent-checklist.json` | 可供自动化和 coding agent 使用的验收清单 |

## 推荐开发顺序

1. 将该目录放到项目根目录。
2. 使用 CodeBuddy 时先检查 `CODEBUDDY.md` 与 `.codebuddy/rules/` 是否加载；让 agent 先阅读 `AGENTS.md`、`docs/01_PRD.md`、`docs/02_ARCHITECTURE.md`、`docs/03_TECH_STACK_AND_REPO.md`、`docs/16_MOBILE_APP_ARCHITECTURE.md` 和 `docs/18_INITIAL_PROMPT_CLAUDE_CODE_CODEX.md`。
3. 先完成 Phase 0 仓库审查，不要立即大规模重写。
4. 按 `docs/11_IMPLEMENTATION_ROADMAP.md` 分阶段实现，每阶段运行检查和测试后再继续。

## 本地命令

仓库根目录执行。首次需 `corepack pnpm install`；`corepack` 随 Node 22 提供，不要求全局安装 pnpm。

| 命令 | 作用 |
|---|---|
| `corepack pnpm generate:app` | 由 `homeweave_app/config.yaml` 重新生成 `homeweave_app/app-metadata.json` |
| `corepack pnpm check:app` | 校验元数据与配置是否同步（只读，不写文件） |
| `corepack pnpm validate:app` | 按 HA App 规则校验配置与元数据 |
| `corepack pnpm test:app` | `check:app` + 全部脚本单元测试 |
| `corepack pnpm lint` | `validate:workflows`（workflow 结构 20 条规则）+ `validate:dockerfile` + 全仓库零依赖 lint（`*.mjs` 语法、`*.yaml`、`*.json`） |
| `corepack pnpm typecheck` | 递归执行各包 `typecheck`；`apps/api` 真跑 `tsc --noEmit`，无包声明时判失败 |
| `corepack pnpm test` | `test:app` + 递归执行各包 `test` |
| `corepack pnpm --filter @homeweave/api build` | 编译后端到 `apps/api/dist`（`sourceMap` 关闭，镜像内无 `.map`） |

两条事实：

- `apps/api/package.json` 的 `version` 恒为 `0.0.0`，与 HA App 的 `0.1.0`（`homeweave_app/config.yaml`）刻意解耦：镜像 tag 只由 App version 推导，API version 既不参与计算，也不被 `config.yaml` 读取。
- 本机没有 Docker，镜像构建、GHCR 推送、多架构清单与密钥扫描只能由 CI 验证；本地能闭环的只有编译与启动冒烟。

### 启动冒烟（实测）

2026-10-27，Node v22.17.0，Windows：

```powershell
$p = Start-Process node -ArgumentList 'apps/api/dist/main.js' -PassThru -RedirectStandardOutput apps/api/dist/boot.log
Start-Sleep -Seconds 6
Get-Content apps/api/dist/boot.log -Raw
Stop-Process -Id $p.Id -Force
```

输出（已去掉 ANSI 颜色转义）：

```text
[Nest] 22548  - 10/27/2026, 5:32:52 PM     LOG [NestFactory] Starting Nest application...
[Nest] 22548  - 10/27/2026, 5:32:52 PM     LOG [InstanceLoader] AppModule dependencies initialized +11ms
[Nest] 22548  - 10/27/2026, 5:32:52 PM     LOG [NestApplication] Nest application successfully started +12ms
```

默认端口 8099，对齐 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` 的 `ingress_port`，可用 `PORT` 覆盖。当前应用没有路由也没有 `/health`，属 Phase 03 范围。

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
