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
