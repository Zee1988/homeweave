# 02 — 系统架构

## 架构选择

采用 **Monorepo + 模块化后端单体 + Expo Universal Client**。iOS、Android 和可选 Web 共享主要客户端代码；业务规则、设备控制与 AI 执行逻辑集中在 NestJS 后端。MVP 不拆微服务。

## 系统上下文

```text
┌──────────────────────────────────────────────────┐
│ apps/mobile — Expo + React Native + TypeScript   │
│ iOS / Android / Web (React Native Web)            │
│ Router · UI · API Client · Query Cache            │
└─────────────────────┬────────────────────────────┘
                      │ HTTPS REST + WSS
                      ▼
┌──────────────────────────────────────────────────┐
│ apps/api — NestJS Modular Monolith                │
│ Auth · API · Application Services · Agent         │
│ Tool Registry · Policy Engine · Task Orchestrator │
│ Audit · Event Gateway · Notification Service      │
└────────────┬─────────────────┬────────────────────┘
             │                 │
             ▼                 ▼
       SQLite / Prisma     Model Provider Adapter
       optional Redis      (server-side only)
             │
             ▼
 HomeAssistantAdapter — REST + WebSocket — Home Assistant — Devices
```

## 客户端职责

- 展示 UI、收集用户输入、缓存非权威 UI/查询数据、发送命令请求、展示任务状态。
- 不直接访问 HA，不持有 HA Token 或模型供应商 API Key。
- 不承载可靠后台任务；App 被操作系统挂起时，后端任务仍应继续执行。
- 维护服务器连接配置和认证会话；原生敏感信息写入系统安全存储。
- WebSocket 重连后先拉取 REST 快照，再接收增量事件。
- 客户端状态为服务端缓存/视图模型，不能作为物理设备最终状态的事实来源。

## 后端模块职责

- `auth`：身份、会话、角色和权限上下文。
- `integrations/home-assistant`：HA 协议、token、连接管理、重试、事件归一化。
- `device-registry`：外部实体到内部实体的映射、能力和展示元数据。
- `home-state`：状态快照、区域摘要、数据新鲜度。
- `device-command`：能力校验、参数校验、服务调用、状态验证。
- `scenes`：场景定义、预览、执行和部分失败汇总。
- `dashboard`：默认布局生成、用户覆盖配置。
- `agent`：意图解析、Fast-Path、LLM 结构化计划。
- `tools`：工具 schema、授权、风险和执行 handler。
- `tasks`：持久化任务状态机、步骤、取消、重试和恢复。
- `memory`：可查看和删除的结构化偏好。
- `suggestions`：基于规则/事件的可解释建议。
- `events`：状态变更、任务事件、去重、广播。
- `notifications`：Push token 注册、通知编排和脱敏 payload。
- `audit`：安全操作审计与脱敏。

## 共享包边界

- `packages/contracts`：请求/响应/事件 schema 与共享类型；不包含平台 UI。
- `packages/api-client`：REST/WebSocket 封装、认证刷新、错误转换和 request ID。
- `packages/domain`：纯 TypeScript 领域规则；不得依赖 React Native、DOM 或 Node 专有 API。
- `packages/validation`：Zod schema 与边界验证。
- `packages/design-tokens`：颜色、间距、字号、圆角和层级等跨平台 token。
- `packages/ui`：不依赖具体路由与业务服务的 React Native UI primitives。

共享包必须保持平台无关。原生通知、安全存储和浏览器 cookie 等能力通过客户端 adapter 注入，不可把平台专属 API 泄漏进 domain 层。

## 状态权威原则

- Home Assistant 是设备当前状态的事实来源。
- 数据库里的实体状态只是缓存快照，必须带 `observedAt` 和 `stale`。
- 发送命令成功不代表设备已达到目标状态。
- 优先等 HA 事件，超时后主动查询；不可验证就返回 `unknown`。
- HA 断连时显示最后已知状态和时间，禁止冒充实时状态。

## 任务状态机

```text
draft ──► needs_confirmation ──(confirmed)──► queued ──► running
  │                 │                         │            ├─► succeeded
  │                 └──(expired/cancelled)     │            ├─► partially_succeeded
  └───────────────────────────────────────────┘            ├─► failed
                                                           ├─► unknown
                                                           └─► cancelled
```

约束：`draft` 不执行；过期确认不能执行；running 任务使用持久状态；重启后恢复或标记为 unknown；终态不能静默改为成功。

## 事件机制

事件包含 `eventId`、`eventType`、`occurredAt`、`source`、`correlationId`、`schemaVersion`、`payload`。MVP 可先用进程内事件和持久化任务；若使用 Redis/BullMQ，必须先持久化关键任务状态，再投递队列。处理重复事件、重试与幂等是必需项。

## 故障降级

| 故障 | 预期行为 |
|---|---|
| LLM 超时 | 手动控制/Fast-Path 仍可用；复杂任务提示模型不可用 |
| HA WebSocket 断开 | 退避重连、标 stale、REST 对账 |
| HA REST 调用失败 | 任务失败，不显示成功 |
| DB 不可用 | readiness 失败；拒绝不能持久化的写操作 |
| 客户端失去网络 | 展示最后已知状态并标 stale；默认不排队发送物理控制命令 |
| Push 服务不可用 | App 内任务状态仍可靠；记录通知失败但不回滚设备操作 |
| Redis 不可用（若启用） | 按用途降级；可靠队列不可用时暂停后台任务并告警 |
| 模型输出不合法 | schema 验证失败，有限重试或澄清，不执行 |
| 设备状态验证超时 | unknown，支持后续重新验证 |

## 部署拓扑

- `api`：NestJS API + backend task runner + WebSocket Gateway，Docker Compose 部署。
- `db`：SQLite 持久化文件（单实例）；后续需要时评估 PostgreSQL。
- `redis`：可选，明确需要持久队列/跨进程协调后启用。
- `mobile`：不是服务端容器；通过 EAS / 原生工具链构建 iOS 和 Android 安装包并发布。
- `web`：同一 `apps/mobile` 用 React Native Web 导出静态资源，可部署到独立静态托管/CDN 或反向代理，不另建独立 UI。
- Home Assistant 是外部服务。不得把 Redis 或数据库端口暴露给公网。
