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
