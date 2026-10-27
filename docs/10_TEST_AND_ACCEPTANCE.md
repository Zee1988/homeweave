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
