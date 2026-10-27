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

