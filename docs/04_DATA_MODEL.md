# 04 — 数据模型

> 逻辑设计；实际 Prisma schema 需按实现版本细化，JSON 字段必须版本化和校验。

## User
`id`、`username/email`、`passwordHash`、`role`、`isActive`、`createdAt`、`updatedAt`。

## AuthSession / RefreshSession
`id`、`userId`、`refreshTokenHash`、`clientType`（ios/android/web）、`installationId?`、`expiresAt`、`revokedAt?`、`rotatedFrom?`、`createdAt`、`lastUsedAt?`。仅保存 refresh token 的 hash，不存明文；每次 refresh 轮换并检测重放。

## ClientInstallation（P1，或需推送时启用）
`id`、`userId`、`platform`（ios/android/web）、`installationId`、`pushProvider`、`pushTokenCiphertext?`、`notificationsEnabled`、`lastSeenAt`、`revokedAt?`、时间字段。约束：`userId + installationId` unique；token 轮换后应更新；登出/注销时可撤销。

## Integration
`id`、`type`（MVP `home_assistant`）、`name`、`baseUrl`、`credentialCiphertext` 或 secret reference、`status`、`lastSuccessfulSyncAt`、`lastErrorCode`、时间字段。

## Area
`id`、`integrationId`、`externalId`、`name`、`icon`、`sortOrder`。

## Device
`id`、`integrationId`、`externalId`、`areaId?`、`name`、`manufacturer?`、`model?`、`availability`、`lastSeenAt`。

## Entity
`id`、`deviceId?`、`integrationId`、`externalId`（HA entity_id）、`domain`、`name`、`areaId?`、`capabilitiesJson`、`attributesJson`（过滤敏感字段）、`stateValue`、`stateJson`、`stateObservedAt`、`isStale`、`isHidden`、`sortOrder`。
约束：`integrationId + externalId` unique。

## Dashboard
`id`、`name`、`ownerId`、`layoutJson`、`isDefault`、时间字段。布局中的用户覆盖项与自动生成项应可区分。

## Scene
`id`、`name`、`description`、`source`（HA/app）、`externalId?`、`definitionJson`、`riskLevel`、`createdBy`、时间字段。

## Task
`id`、`createdBy`、`source`（ui/agent/mcp/automation）、`userGoal`、`status`、`planJson`、`planVersion`、`confirmationRequired`、`confirmedAt?`、`startedAt?`、`finishedAt?`、`summary?`、`errorCode?`、`correlationId`、时间字段。

## TaskStep
`id`、`taskId`、`index`、`toolName`、`inputJson`（脱敏）、`status`、`riskLevel`、`startedAt?`、`finishedAt?`、`resultJson`（脱敏）、`verificationStatus`、`errorCode?`、`retryCount`。约束：`taskId + index` unique。

## ToolDefinition
`id`、`name` unique、`description`、`inputSchemaJson`、`riskLevel`、`requiresConfirmation`、`enabled`、`version`。
MVP 可以在代码中注册工具，数据库表可延后；不可允许用户任意上传可执行 handler。

## Conversation / Message
Conversation：`id`、`userId`、`title`、时间字段。
Message：`id`、`conversationId`、`role`、`content`、`metadataJson`、`createdAt`。敏感内容保留策略需配置。

## Preference
`id`、`userId`、`key`、`valueJson`、`source`（explicit/confirmed/inferred）、`confidence`、`confirmedAt?`、`enabled`、时间字段。约束：`userId + key` unique，或采用支持多条带 scope 的复合键。

## Suggestion
`id`、`kind`、`title`、`description`、`evidenceJson`、`status`、`dedupeKey`、`createdAt`、`expiresAt?`。

## AuditEvent
`id`、`actorUserId?`、`source`、`action`、`resourceType`、`resourceId?`、`result`、`correlationId`、`metadataJson`（脱敏）、`createdAt`。

## 通用规则
- 外部 ID 与内部主键分离。
- 状态缓存必须带时间和 stale 标记。
- API key/token/password 不能进入普通 JSON 日志或任务参数。
- 原生 refresh token 只以安全存储保存在客户端；服务端只保存 hash/可撤销会话元数据。
- Push token 按安装记录管理并支持撤销，不能用作认证凭据。
- 重要任务和审计不要因删除实体而级联丢失。
- 任务和工具输入采用白名单字段与 schema version。
- 保留期限可配置，提供导出/删除个人偏好机制。
- 关键约束、索引：`Entity(integrationId, externalId)`、`Task(status, createdAt)`、`TaskStep(taskId,index)`、`AuditEvent(createdAt)`、`Suggestion(dedupeKey,status)`。
