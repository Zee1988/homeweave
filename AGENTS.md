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
