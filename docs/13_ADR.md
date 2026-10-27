# 13 — Architecture Decision Records (ADR)

## ADR-001：模块化单体，而非起步即微服务

**状态：接受。** MVP 单家庭部署优先降低运维与调试复杂度。模块通过接口分层，后续按数据量、部署隔离和团队边界决定拆分。

## ADR-002：Home Assistant 是设备状态事实来源

**状态：接受。** 应用 DB 仅保存配置、快照缓存与任务历史。设备当前状态通过 HA 查询/事件验证。状态缓存必须有 observedAt/stale。

## ADR-003：AI 不直接执行设备调用

**状态：接受。** AI 生成结构化意图/计划；服务端 Tool Registry + Policy Engine 校验并执行。禁止任意 HA 服务、Shell 或 URL 工具。

## ADR-004：Fast-Path 与 LLM 规划并存

**状态：接受。** 简单命令走确定性解析，复杂目标才调用 LLM；固定自动化走规则引擎。LLM 不可用时保持手动控制和支持的 Fast-Path 可用。

## ADR-005：MVP 数据库先用 SQLite

**状态：暂定接受。** 单实例部署易于安装和备份。若需要多进程并发、多用户或多实例，评估 PostgreSQL。任何迁移必须写迁移计划与恢复测试。

## ADR-006：Redis 不是 MVP 的强制依赖

**状态：接受。** 只有需要持久队列、跨进程任务调度或共享缓存时加入。若 Redis 承担可靠队列，任务仍需先持久化于主数据库。

## ADR-007：高风险操作需要确认

**状态：接受。** MVP 禁止 AI 无人值守解锁门锁或关闭安防。确认绑定具体计划版本、用户和短期 nonce，防止重放或计划替换。

## ADR-008：原始 Aura Grid 技术栈的证据边界

**状态：接受。** 部署仓库中的 compose 和安装脚本不能证明原镜像所有内部技术实现。本文档定义的是新项目建议架构，不是对原应用内部技术栈的断言。

## ADR-009：Expo Universal App 作为唯一客户端工程

**状态：接受。** iOS、Android 为一等客户端；Web 通过 React Native Web 支持核心功能。使用 Expo Router、TypeScript、共享 API client/contracts 和平台 adapter。默认不创建独立 React + Vite Web UI，以避免两套界面维护成本。

理由：
- 共享页面和业务逻辑，降低 iOS/Android 维护成本。
- 可以在同一代码库中支持浏览器控制面板。
- 与现有 TypeScript/NestJS 技术体系相容。
- Expo 提供 development build、EAS Build 和原生模块接入路径。

限制：
- Web 与原生平台并非完全等价；相机、推送、安全存储、文件系统、背景执行等要通过适配层处理。
- 不以 iOS/Android 后台任务作为可靠工作执行器。
- 如果未来必须使用大量仅支持 DOM 的 UI 组件或 Web-only 管理功能，应先以实测证明，再通过 ADR 决定是否拆分 Web 项目。

## ADR-010：跨平台认证与凭据存储

**状态：接受。** 原生客户端使用短期 access token（优先内存）和轮换 refresh token（系统安全存储）；Web 使用 HttpOnly、Secure、SameSite cookie 并加入 CSRF 防护。服务端统一身份和权限模型，API 业务端点不因平台而分叉。

## 待决事项

- 是否在 MVP 加入扫码配对？默认 P1；P0 支持手动输入服务器 URL。
- 首发是否启用 Push？默认 P1；App 前台 WebSocket 实时更新为 P0。
- Web 静态包部署在哪里？默认由静态托管或反向代理提供，不强制与 API 同容器。
- 外部模型供应商首选哪家？通过配置选择，不绑定单一厂商。
- MCP 放进 MVP 吗？默认 P1，先稳定 Tool Registry。
