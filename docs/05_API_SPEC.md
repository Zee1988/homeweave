# 05 — API 契约（MVP）

Base path：`/api/v1`。业务端点在 iOS、Android、Web 之间保持一致。认证采用平台适配：原生使用 Bearer access token + rotating refresh token；Web 使用 HttpOnly、Secure、SameSite cookie 与 CSRF 防护。具体 JSON 类型应由 `docs/openapi.yaml` 与 `packages/contracts` 维护，不能由不同客户端分别手写。

## 统一错误

```json
{
  "error": {
    "code": "HA_CONNECTION_UNAVAILABLE",
    "message": "无法连接 Home Assistant。",
    "requestId": "req_xxx",
    "details": {}
  }
}
```

`details` 不可包含凭据或敏感上游响应。错误码稳定，用户文案由客户端国际化映射。

## Setup / Auth

- `GET /setup/status` — 是否已经完成首次初始化。
- `POST /setup/admin` — 仅首次初始化可调用。
- `POST /auth/login` — 验证凭据并创建会话。
- `POST /auth/refresh` — 原生端在 JSON 中提交 refresh token，Web 使用安全 cookie；每次刷新都轮换 refresh token。
- `POST /auth/logout` — 撤销当前会话，并清除 Web cookie。
- `GET /auth/me` — 当前用户信息与权限摘要。
- `POST /auth/sessions/revoke` — 管理员或会话所有者按策略撤销会话。

原生登录响应可返回短期 `accessToken`、`expiresIn` 和 `refreshToken`；refresh token 只写入系统安全存储，access token 默认只留在内存。Web 登录通过 Set-Cookie 设置 HttpOnly 会话 cookie，不应把长期 token 写进 `localStorage`。服务端只保存 refresh token hash/会话状态，并支持轮换、过期、撤销与重放检测。

## Server / Integration

- `GET /health/live`
- `GET /health/ready`
- `GET /health/diagnostics`（管理员）
- `GET /integrations`
- `POST /integrations/home-assistant`
- `POST /integrations/:id/test`
- `PATCH /integrations/:id`
- `POST /integrations/:id/sync`
- `DELETE /integrations/:id`

创建集成示例：

```json
{"name":"Home","baseUrl":"http://homeassistant.local:8123","token":"secret input only"}
```

HA token 仅提交到后端并安全存储，不得回传。URL、DNS、重定向和网络目标必须经过服务端 SSRF 策略检查。手机客户端配置的是 HomeWeave **服务端 URL**，不是 HA URL。

## Home State / Devices

- `GET /home/summary`
- `GET /areas`
- `GET /devices?areaId=...`
- `GET /entities?areaId=...&domain=light`
- `GET /entities/:id`
- `POST /entities/:id/commands`

命令示例：

```json
{
  "command": "set_brightness",
  "parameters": {"brightnessPercent": 30},
  "idempotencyKey": "client-generated-unique-key"
}
```

响应可返回 `202 Accepted` 和 command/task ID；除非已验证最终状态，否则不能用响应暗示操作已完成。

## Scenes / Dashboard

- `GET /scenes`、`POST /scenes`、`GET /scenes/:id`、`PATCH /scenes/:id`
- `POST /scenes/:id/preview`、`POST /scenes/:id/execute`
- `GET /dashboards`、`GET /dashboards/:id`
- `PATCH /dashboards/:id/layout`
- `POST /dashboards/generate`
- `POST /dashboards/:id/reset-layout`

自动生成 dashboard 不得覆盖用户已保存的布局覆盖项。

## Agent / Tasks

- `POST /assistant/messages`
- `POST /assistant/plan`
- `GET /tasks`、`GET /tasks/:id`、`GET /tasks/:id/steps`
- `POST /tasks/:id/confirm`
- `POST /tasks/:id/cancel`
- `POST /tasks/:id/retry-step`
- `POST /tasks/:id/verify`

消息示例：

```json
{"conversationId":"optional","message":"帮我准备观影环境，保留过道灯"}
```

响应 `mode` 可为 `answer`、`clarification_required`、`plan_ready`、`needs_confirmation` 或 `executing`。需要确认的计划必须返回 task ID 和步骤，不得自动执行。

## Preferences / Suggestions（P1）

- `GET /preferences`、`POST /preferences`、`PATCH /preferences/:id`、`DELETE /preferences/:id`
- `GET /suggestions`
- `POST /suggestions/:id/accept`
- `POST /suggestions/:id/dismiss`
- `POST /suggestions/:id/snooze`

## Client Installation / Push（P1）

- `POST /client-installations/register` — 注册 `installationId`、平台与可选 push token。
- `PATCH /client-installations/:id` — 更新 push token、通知偏好或最后活跃时间。
- `DELETE /client-installations/:id` — 注销安装记录/关闭该安装的推送。

APNs、FCM 或 Expo Push 凭据由服务端持有。Push payload 不包含敏感设备状态，客户端收到通知后必须通过已认证 API 获取详情。Push 失败不影响任务本身的结果。

## WebSocket 事件

事件类型：`home.state.updated`、`integration.status.changed`、`task.created`、`task.updated`、`task.step.updated`、`suggestion.created`、`system.health.changed`。

```json
{
  "eventId":"evt_xxx",
  "type":"task.updated",
  "occurredAt":"2026-10-26T12:00:00Z",
  "correlationId":"task_xxx",
  "payload":{}
}
```

WebSocket 必须验证身份和授权范围。原生端不得把长期 token 放入 URL；优先使用受保护的握手认证或短期一次性 WS ticket。客户端重连后先拉取快照，再订阅增量。客户端按事件 ID/时间防重，并避免旧事件覆盖新状态。
