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
