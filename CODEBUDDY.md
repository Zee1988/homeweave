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
