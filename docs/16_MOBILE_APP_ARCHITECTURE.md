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
