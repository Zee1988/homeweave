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
