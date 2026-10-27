# 11 — 实施路线图与任务拆分

## 总体策略

采用一个 Expo Universal Client + 一个 NestJS 后端，不先建两套前端。每阶段都必须有可运行的软件、测试和清晰退出标准。先可信设备控制，再增加 AI 复杂度。

## Phase 0 — 仓库审查与决策锁定

任务：
- 检查现有仓库、依赖、分支、未提交更改、测试和部署。
- 确认是否从空仓库创建 Expo Universal App；如已有 Web UI，估算复用/迁移成本并形成 ADR。
- 采用 pnpm workspace（若无现有包管理器约束）。
- 建立统一环境模板、日志、错误格式、requestId 和 CI 基础。
- 输出现有实现与规格差距报告。

完成标准：技术路线固定；无静默破坏；CI 可执行 lint/typecheck/unit test；差距及迁移决策已记录。

## Phase 1 — Monorepo、Expo 客户端与后端骨架

任务：
- 建立 `apps/mobile`（Expo + TypeScript + Expo Router）与 `apps/api`（NestJS）。
- 建立 `packages/contracts`、`packages/api-client`、`packages/domain`、`packages/validation`、`packages/design-tokens`。
- 建立共享 lint/format/typecheck/test 脚本。
- 后端 health/live、health/ready、首次管理员设置、认证与 DB migrations。
- 客户端实现服务器地址设置、登录/登出、空/错误/加载状态。
- 建立 development build 配置；同时验证 Expo Web export。

完成标准：iOS/Android development build 可启动并连接本地 API；Web 可由同一工程导出；认证安全存储按平台适配；无第二套 Web UI。

## Phase 2 — Home Assistant 连接与设备目录

任务：
- 后端集成配置和连接测试。
- HA REST/WS adapter。
- 区域/设备/实体同步、幂等性与能力映射。
- 状态快照和新鲜度。
- 自动生成初始 dashboard。
- Expo 客户端展示家庭摘要、房间/设备列表。

完成标准：连接成功后 iOS/Android/Web 可显示房间与设备；断连 stale；重复同步不重复创建；用户布局覆盖项保留。

## Phase 3 — 可靠手动控制与场景

任务：
- DeviceCommandService。
- 灯光、开关、climate、cover、scene 的能力感知工具。
- 命令后状态验证、task history 与审计。
- 场景列表、预览和执行。
- WebSocket 状态/任务事件订阅、断线重连和快照对账。
- 组件层与端到端控制测试。

完成标准：mock HA 覆盖 succeeded/failed/unknown；至少在 iOS Simulator/Android Emulator 与 Web 完成真实 API smoke test；不误报成功。

## Phase 4 — AI Fast-Path 与结构化规划

任务：
- ModelProvider 抽象和一个供应商 adapter。
- Fast-Path：设备查询、灯光开关、亮度控制、已知场景。
- LLM 结构化输出、schema 验证与澄清流程。
- Tool Registry、Policy Engine、Task Orchestrator。
- 多设备计划预览/编辑/确认/逐项执行。

完成标准：LLM 未配置时 Fast-Path 工作；模型伪造工具/参数被拒绝；部分失败正确呈现；App 关闭后后端任务仍可完成并在重开后同步结果。

## Phase 5 — 易用性与 P1

任务：
- 自动化草稿 + dry-run + 用户确认。
- 结构化偏好与记忆管理。
- 主动建议（默认只建议）。
- Push 注册/通知服务（若启用）。
- MCP adapter（如确定需要）。

完成标准：建议可追溯证据；记忆可删除；MCP 无法绕过权限；自动化未确认不发布；push 失败不影响任务正确性。

## Phase 6 — 发布与运营准备

部署决策：Home Assistant OS 用户优先通过 Supervisor App 安装后端；Home Assistant Container 用户使用 Docker Compose。详细规范见 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md`。
任务：
- `app.config.ts`、`eas.json`、bundle/package identifiers、icons/splash/permissions。
- iOS/Android development、preview、production profiles。
- 隐私说明、数据处理披露、账户登出/删除策略。
- EAS 或本地构建流程及商店提交步骤。
- Home Assistant OS 的 App 仓库、GHCR 多架构发布、Ingress 与升级说明（首选家庭部署）。
- Home Assistant Container / 通用 Linux 的 Docker Compose 备用部署说明。
- 备份恢复和升级演练。

完成标准：iOS、Android 生产候选包可构建；Web 目标可部署；所有 secrets 不在 bundle；核心旅程和权限拒绝路径通过测试。HAOS 安装/升级未在真实设备验证时，必须明确标记为未验证。

## 推荐单任务格式

每个 coding agent issue/prompt 应包含目标、依赖模块、涉及接口/DB/API、必需测试、不在范围内的内容与验收命令。一次完成一个可审查的 vertical slice，不要同时重写 UI、认证、AI 和 HA adapter。

## 开发优先级

P0：工程骨架、认证、服务器连接、HA 接入、设备目录、能力控制、状态验证、任务记录、安全策略。
P1：原生 push、主动建议、高级记忆、多集成、高级自动化、语音。
P2：语音唤醒、预测式主动管家、更多设备适配器和高级个性化。

不要先做语音唤醒、复杂长期记忆、多 Agent 或炫技动画；这些都依赖可靠设备服务层。
