# 22 — HomeWeave Home Assistant App 部署实施 Prompt（CodeBuddy）

本 Prompt 用于让 CodeBuddy 将现有 HomeWeave 规格落地为可从 Home Assistant OS 的 Apps 商店安装的后端。先把此文档和 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` 提供给 Agent。

## 可直接复制给 CodeBuddy 的完整 Prompt

```text
你正在开发 HomeWeave（织家）。请先阅读 CODEBUDDY.md、AGENTS.md、README.md、docs/01_PRD.md、docs/02_ARCHITECTURE.md、docs/07_HOME_ASSISTANT_INTEGRATION.md、docs/08_SECURITY_AND_PRIVACY.md、docs/10_TEST_AND_ACCEPTANCE.md、docs/11_IMPLEMENTATION_ROADMAP.md、docs/14_ENV_AND_DEPLOYMENT.md、docs/16_MOBILE_APP_ARCHITECTURE.md、docs/19_CODEBUDDY_WORKFLOW.md、docs/20_INITIAL_PROMPT_CODEBUDDY.md 和 docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md。

目标：把 HomeWeave 的首选家庭部署方式调整为 Home Assistant App（旧称 Add-on），让 Home Assistant OS 用户通过添加 Git 仓库、点击安装即可部署和管理 NestJS 后端。保留 Docker Compose 作为 Home Assistant Container 用户的备用方案。不要把 NestJS 后端误实现为 Python 自定义集成。

先检查 Git 状态、现有实现、工作区未提交修改和当前发布配置。不要覆盖用户修改。先输出实施计划和受影响文件；如果没有真实 HA OS 设备，标记哪些测试不能完成。

目标架构：
- 客户端：Expo + React Native + TypeScript，位于 apps/mobile，支持 iOS、Android 和可选 React Native Web。
- 后端：NestJS + TypeScript，位于 apps/api。
- HA OS 部署：Supervisor 管理 HomeWeave App 容器；SQLite 和应用数据放在 /data。
- 发布：GitHub Actions 构建 amd64/aarch64 镜像并发布到 GHCR；Home Assistant 安装时拉取预构建镜像，不在 HA 主机现场编译完整项目。
- Web：可选通过 HA Ingress 访问，必须适配动态 base path 和 WebSocket。
- 原生 App：通过独立、受保护的 HomeWeave API 连接；不得把 Ingress token 当成原生 API 凭据。
- 备用部署：Home Assistant Container 用户可使用 Docker Compose，但不能声称其拥有 Apps 商店。

实施任务（分阶段完成，不要一次性重写业务）：
1. 创建/更新根目录 repository.yaml 和 homeweave_app/config.yaml、Dockerfile、DOCS.md、README.md、CHANGELOG.md、必要的 AppArmor profile/启动文件。避免在普通目录放置会被 Supervisor 误识别的额外 config.yaml。
2. 参考 Home Assistant 当前官方 apps-example 和官方 builder actions，建立 GitHub Actions CI/CD。先运行静态检查和测试，再构建并发布 amd64、aarch64 镜像及多架构 manifest。
3. 保证 config.yaml version 与 GHCR 镜像版本标签完全一致。发布顺序必须是先发布镜像并验证公开可拉取，再提交版本号更新；不得覆盖已发布的版本标签。
4. 将 NestJS、Prisma 和 SQLite 正确打包进生产镜像。SQLite 使用 /data 下的路径；校验 Prisma engine 与 Node 原生依赖的多架构兼容性。生产启动使用可审计 migration deploy，绝不自动 reset 数据库。
5. 优先使用 Supervisor 提供的 Home Assistant API 代理（仅在确认当前 HA App 规范支持且经过测试后启用）。Supervisor token 只允许存在后端运行环境，不能写入日志、数据库、API 响应、Web bundle 或移动客户端。由于该能力权限较高，必须在文档中解释风险并最小化 App 权限。
6. Ingress 只用于 HA 内嵌 Web UI。Web 需要支持动态路径、刷新和 WebSocket。Ingress 不替代原生 App 的认证。
7. 原生 API 端口默认按最小暴露原则处理。只有当独立认证、授权、审计、速率限制和安全传输策略落实后才启用对宿主机的端口映射。不要无认证开放 API，不要把 HA、Supervisor、数据库端口暴露到公网。
8. 增加 /health/live 和 /health/ready，容器重启策略、日志脱敏、优雅关闭、数据迁移和错误处理。
9. 编写安装、升级、回滚、备份/恢复和排障文档。明确 Home Assistant OS 与 Home Assistant Container 的差异。验证备份是否包含 /data，不要未经测试就承诺自动备份覆盖 App 数据。
10. 更新 README、AGENTS.md、CODEBUDDY.md、docs/14_ENV_AND_DEPLOYMENT.md、docs/11_IMPLEMENTATION_ROADMAP.md、相关测试、OpenAPI 和 SPEC_BUNDLE.md（如果项目使用它）。

安全底线：
- 不在 Git、镜像、客户端或日志中放真实密钥。
- 不使用 chmod -R 777。
- 不允许模型绕过 Tool Registry 和 Policy Engine。
- MVP 不允许 AI 无人值守解锁门锁或关闭安防。
- 命令被接受不代表设备执行成功；无法验证时标记 unknown。
- 所有外部输入进行 schema 验证，HA 地址校验继续防 SSRF。
- 不得因为使用 Supervisor API proxy 而移除服务端权限校验和审计。

验收必须区分：
A. 已通过实际运行的检查；
B. 静态检查通过但未在 HA OS 验证的内容；
C. 因缺少真实设备/凭据而未验证的内容。

至少检查：Docker build、镜像架构、配置/YAML lint、NestJS 测试、Prisma 迁移、/data 持久化、重启后恢复、Ingress 动态路径、WebSocket、HA API 连接、秘密脱敏。真实 HA OS 安装/升级测试缺失时不得宣称完整验收通过。

先完成仓库差距分析和实现计划，等待我确认后按小批次实现。每批交付后报告修改文件、实际运行的命令、测试结果、剩余风险和下一步最小任务。
```

## Phase 0 审查通过后，可发送的下一条任务

```text
根据 docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md 和已确认的实施计划，只实现第一个垂直切片：Home Assistant App 元数据与最小容器启动骨架。先验证官方当前示例和配置格式，创建 repository.yaml、homeweave_app/config.yaml、Dockerfile、DOCS.md、README.md 和最小健康检查。暂不接入真实设备控制和 AI。运行实际可用的 lint/build/test，并列出必须在 HA OS 上手动验证的步骤。不要发布正式版本或覆盖现有 GHCR 标签。
```
