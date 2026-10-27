# 03 — 技术选型与仓库结构

> 本文是新项目推荐实现栈，不代表 Aura Grid 原始部署仓库内部使用了这些技术。若目标仓库已有成熟代码，先审查复用成本，不可静默迁移。

## 1. 客户端：一套 Expo Universal App

- **Expo + React Native + TypeScript**：iOS/Android 正式客户端。
- **React Native Web**：由同一个 `apps/mobile` 项目提供 Web 目标；不默认创建独立 `apps/web`。
- **Expo Router**：文件路由、深链接和跨平台导航。
- **TanStack Query**：服务器数据缓存、请求失效、重试和状态协调。
- **Zustand（可选）**：只管理纯 UI 状态，如当前选中房间、弹层和临时筛选；不作为设备状态事实来源。
- **Zod**：运行时校验表单、API 边界数据和结构化计划。
- **React Native StyleSheet + `design-tokens`**：首版用平台中立的样式方案。可在确有生产力收益时引入 NativeWind 等跨平台样式库，但不得直接套用依赖 DOM/CSS 的 Web UI 组件库。
- **`expo-secure-store`**：原生端 refresh token 安全存储；Web 使用 HttpOnly cookie，不依赖 SecureStore。
- **Expo Notifications**：客户端通知集成；后端负责任务执行和推送发送策略。
- **React Native Testing Library + Jest / `jest-expo`**：组件与客户端逻辑测试。
- **Playwright**：Web 导出目标的浏览器 E2E；**Maestro**（或经 ADR 选择的原生 E2E 工具）用于 iOS/Android 真机/模拟器流程。
- **EAS Build / Submit**：原生构建与商店发布；正式发布前使用 development build 验证原生模块，而不是只依赖 Expo Go。

依赖版本策略：不在文档中手工锁定可能过期的 Expo SDK 版本。创建/升级项目时选用当前稳定 SDK，所有 Expo 模块使用 `npx expo install`，并运行 `npx expo-doctor` 和 `npx expo install --check`（若当前 SDK 提供）。不要忽略 SDK 的 peer dependency 警告。

## 2. 后端

- Node.js LTS + TypeScript `strict` + NestJS 模块化单体。
- REST + WebSocket Gateway。
- Prisma；MVP SQLite；后续并发与部署需求明确时评估 PostgreSQL。
- Pino 或同类结构化日志；统一 requestId / correlationId。
- Jest/Vitest + Supertest；沿用 NestJS 现有工具链，避免为同一目的维护两套测试 runner。
- OpenAPI 作为 API 契约；通过生成或校验共享 contracts，降低前后端类型漂移。

## 3. AI 与集成

- `ModelProvider` 抽象；首个 adapter 可为 OpenAI-compatible API，模型 key 只存在后端。
- Home Assistant REST + WebSocket 封装在 `HomeAssistantAdapter`。
- `ToolRegistry`、`PolicyEngine`、`TaskOrchestrator` 是唯一设备操作执行通路。
- Docker Compose 用于后端与持久化服务；Redis/BullMQ 可选。
- MCP 作为可选 adapter，复用相同工具和策略服务。

## 4. Monorepo 结构

```text
homeweave/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── apps/
│   ├── mobile/                      # 唯一跨平台 UI：iOS / Android / Web
│   │   ├── app/                     # Expo Router routes/layouts
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── features/             # dashboard, rooms, devices, scenes...
│   │   │   ├── hooks/
│   │   │   ├── providers/
│   │   │   ├── platform/             # secure storage, notifications, linking
│   │   │   ├── services/
│   │   │   └── theme/
│   │   ├── assets/
│   │   ├── app.config.ts
│   │   ├── eas.json
│   │   └── package.json
│   └── api/
│       ├── src/modules/              # NestJS modules
│       ├── prisma/
│       └── package.json
├── packages/
│   ├── contracts/                    # API/event schemas and types
│   ├── api-client/                   # REST/WS client + auth adapter
│   ├── domain/                       # platform-neutral domain logic
│   ├── validation/                   # Zod schemas
│   ├── design-tokens/                # shared tokens, no DOM dependency
│   └── ui/                           # optional shared RN primitives
├── infra/{docker,scripts}/
├── docs/
├── pnpm-workspace.yaml
├── package.json
├── .env.example
└── docker-compose.yml
```

默认不创建 `apps/web`。`apps/mobile` 的 Web 目标通过 Expo / React Native Web 构建；如未来有确切证据表明后台管理 UI 无法适配，再用 ADR 决定是否新增单独 Web 应用。

## 5. 平台文件规则

- 默认使用共享 `.tsx` 文件。
- 仅有少量系统差异时使用 `Platform.select` 或 platform adapter。
- 复杂差异才使用 `.ios.tsx`、`.android.tsx`、`.web.tsx` / `.native.tsx` 文件。
- 不应为了差异化复制整页；差异组件必须有相同的 props/契约与对应测试。
- domain/contracts 包不得导入 `react-native`、`window`、`document`、Node `fs` 等平台 API。
- 使用 `expo install` 管理 Expo SDK 相关包；新增原生模块后重新构建 development build 并验证。

## 6. 工程规则

- TypeScript `strict: true`。
- Controller 只做传输层适配；业务逻辑放 Application Service。
- 客户端不直接访问 HA；Agent 不直接访问 HA 或数据库。
- API schema/types 优先从共享契约或 OpenAPI 生成，禁止无控制地复制接口定义。
- `unknown` + schema validation 优先于无约束 `any`。
- 不记录 token、密码、Cookie、API key 或家庭敏感属性。
- 新增 env 必须更新 `.env.example` 和部署文档。
- DB schema 变化提供 migration 和测试。
- 不引入没有明确需求的向量数据库、Kafka、微服务或多 Agent 框架。
