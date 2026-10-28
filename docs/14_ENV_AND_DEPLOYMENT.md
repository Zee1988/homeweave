# 14 — 环境与部署

> 部署优先级：Home Assistant OS 用户优先使用 Home Assistant App（见 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`）；Home Assistant Container 或通用 Linux 用户使用 Docker Compose 作为备用方式。

## 部署边界

- **后端自托管（首选 HAOS）**：Home Assistant OS 通过 Supervisor 安装和管理 HomeWeave App 容器；Home Assistant Container / 通用 Linux 可使用 Docker Compose 备用部署。
- **iOS/Android**：作为独立二进制使用 EAS Build 或合规的本地原生工具链构建与发布；不由 Docker 运行。
- **Web**：由 `apps/mobile` 通过 React Native Web 导出静态资源。可部署至静态托管/CDN，或由反向代理提供；不要求另写一套 React DOM 应用。
- **Home Assistant**：既是设备状态来源，也可在 Home Assistant OS 上通过 Supervisor API proxy 为 App 提供受控的 Core API 访问能力；具体实现见 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`。

## 后端环境变量示例

```dotenv
NODE_ENV=development
PORT=8099
APP_BASE_URL=http://localhost:8099
SESSION_SECRET=replace-with-long-random-secret
APP_ENCRYPTION_KEY=replace-with-supported-key-format
DATABASE_URL=file:./data/app.db
HA_CONNECT_TIMEOUT_MS=5000
HA_REQUEST_TIMEOUT_MS=10000
AI_ENABLED=false
AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=30000
LOG_LEVEL=info
ALLOW_INSECURE_LOCAL_HTTP=true
# Optional: only set when server-side push notifications are enabled
PUSH_PROVIDER=
EXPO_ACCESS_TOKEN=
```

环境变量名称以实际实现为准；新增变量必须同步更新本文档和 `.env.example`。生产启动检查必需变量；占位值不可用于生产；`.env` 不得提交。`ALLOW_INSECURE_LOCAL_HTTP` 不能绕过 SSRF 地址策略。

`DATABASE_URL` 的取值随部署形态变化，不要混淆：本机开发用相对的 `file:./data/app.db`（`data/` 已 gitignore）；一次性校验库用 `file:.tmp/dev.db`；Home Assistant OS App 容器内必须用持久卷上的绝对路径 `file:/data/homeweave.db`（见 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`）。Prisma 7 起连接串不写在 `schema.prisma`，而由 `apps/api/prisma.config.ts` 读取该变量。

## 客户端公开配置

- 服务器 URL 应通过用户连接流程保存；不应假设一个统一的部署 URL。
- 如使用 `EXPO_PUBLIC_*` 配置，只允许公开值（例如公开的产品名称、非敏感 API build-time default）；绝不放 token、secret、私有 provider key。
- `app.config.ts` 中可包含 bundle identifier、scheme、图标、权限说明和插件配置；不能包含私密凭据。
- `eas.json` 至少定义 development、preview、production profiles。实际账号、signing secrets 和提交凭据由受控环境管理。
- 原生 app 与自托管 API 版本可能独立升级；客户端应对未知 API capability/version 提供兼容性错误提示。

## Home Assistant App 设计要求（首选）

遵循 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`，包括 `repository.yaml`、App `config.yaml`、多架构镜像发布、Ingress、`/data` 持久化、API 安全边界和 HAOS 实机验收。Ingress 只服务浏览器 Web UI，不是原生客户端 API 认证方案。

## Compose 设计要求（备用）

- 持久化数据库数据目录和加密凭据所需的 key 管理说明。
- app/API 使用非 root 用户（若基础镜像允许）。
- 配置 healthcheck 与 restart policy。
- 数据库/Redis 默认不映射公网端口。
- secrets 以环境变量或 secret mount 注入，不写入镜像层。
- 明确端口、卷、备份、升级和回滚方法。
- 不把 `.ipa` / `.aab` 产物放进后端容器镜像。

## 本地开发

1. 安装项目指定 Node LTS 和 pnpm 版本。
2. 安装 Xcode（iOS 本地构建）和/或 Android Studio / Android SDK；也可对支持的目标使用 EAS Build。
3. 复制 `.env.example` 为 `.env`，填充仅供本地开发的配置。
4. 安装 workspace 依赖并运行 DB migration。
5. 启动 NestJS API。
6. 在 `apps/mobile` 启动 Expo；分别验证 iOS、Android 与 Web 目标。具体脚本以仓库 `package.json` 为准。
7. 先用 mock HA 测试，再连接测试 Home Assistant。
8. 原生模块增加或配置更改后重建 development build。

可考虑的命令（以当前 Expo SDK/脚本为准，agent 必须实际验证）：
- `npx expo start`
- `npx expo start --web`
- `npx expo export --platform web`
- `npx expo-doctor`
- `npx expo install --check`
- `eas build --platform android --profile preview`
- `eas build --platform ios --profile preview`

不要假定任何未实际配置的脚本或凭据已存在。

## 网络与 HTTPS

- 手机必须能访问自托管 API 地址；localhost 指向手机自身而不是开发电脑/家庭服务器。
- 生产远程网络使用 HTTPS/WSS。局域网 HTTP 是受控例外，需明确目标地址、设备信任和平台安全设置。
- API 不应依赖客户端与服务器处于同一局域网；远程访问可通过 VPN 或安全反向代理。
- 不在客户端直接连接 HA；客户端只连接 HomeWeave API。

## 备份与恢复

必须说明哪些卷含 DB、配置和加密数据；备份前如何保证一致性；如何备份并恢复应用加密密钥；恢复后如何验证 HA 连接、dashboard、场景、任务历史和认证会话。密钥丢失可能导致加密凭据无法解密。

## 升级策略

- 后端升级前备份数据库。
- 每次 schema 变化包含 migration。
- 原生依赖、Expo SDK 或 config plugin 变化时重新 build 并验证 iOS/Android；不能假设 JavaScript OTA 可以替代所有原生升级。
- Web export 需要通过目标浏览器的 smoke test。
- 不静默删除用户数据；失败时按文档回滚并恢复备份。
