# 07 — Home Assistant 集成

## 原则

- HA 是当前设备状态的事实来源。
- 只有 `HomeAssistantAdapter` 可以访问 HA REST/WebSocket。
- 领域服务只处理归一化模型，不依赖 HA 原始响应结构。
- token 只在后端保存与使用。
- 认证失败、网络故障、实体不可用、服务调用失败应区分。

## 连接顺序

1. 规范化并验证 URL。
2. 检查目标网络地址，应用 SSRF 规则。
3. 检查 HTTP/API 可达性。
4. 验证 token。
5. 拉取区域、设备、实体与能力信息。
6. 建立 WebSocket，完成认证并订阅状态事件。
7. 同步快照并标记观察时间。
8. 定期对账；断开时指数退避重连。

## 能力映射

- `light`：开关；只有支持 brightness/color/color_temp 时才暴露相应能力。
- `switch`：开关。
- `climate`：目标温度、HVAC 模式、风速等按实体属性和支持特征映射。
- `cover`：开关、位置或倾斜角度按能力映射。
- `sensor`：只读，显示单位、device_class 和状态。
- `scene`：激活已存在场景。

不能假设同 domain 的每个实体具有完全相同的能力。参数映射需要单元测试。

## 命令执行与验证

1. 将内部 entity ID 映射到 HA entity_id。
2. 检查权限、可用性、状态新鲜度和能力。
3. 校验命令参数及范围。
4. 调用精确的 HA service handler。
5. 等待状态事件；超时后主动查询一次。
6. 将实际状态与目标进行比较。
7. 返回 succeeded / failed / unknown，并写任务步骤。

HA 接受服务请求并不保证物理设备已达到目标状态。

## 状态一致性

- 收到 WebSocket 事件更新状态快照与 `observedAt`。
- 对重复/乱序事件做防护，不能用旧状态覆盖较新的状态。
- WebSocket 断开时将数据标记 stale。
- 定时或按需 REST 对账，修复事件丢失导致的漂移。
- 客户端重连先拉快照再收增量。

## 自动化

MVP 可执行既有 HA scene。应用侧场景可以保存目标状态并逐项执行。AI 自动化仅生成草稿，需验证数据源、实体、条件、语法与权限，dry-run 后用户确认才发布；不直接运行任意生成 YAML。

## 诊断与错误

至少区分：`INVALID_BASE_URL`、`TARGET_NOT_ALLOWED`、`DNS_RESOLUTION_FAILED`、`CONNECTION_TIMEOUT`、`AUTHENTICATION_FAILED`、`WEBSOCKET_UNAVAILABLE`、`ENTITY_NOT_FOUND`、`ENTITY_UNAVAILABLE`、`CAPABILITY_UNSUPPORTED`、`SERVICE_CALL_FAILED`、`STATE_VERIFICATION_TIMEOUT`。
错误输出脱敏且包含 requestId。
