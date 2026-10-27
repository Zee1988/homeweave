# 08 — 安全与隐私规范

## 资产与威胁

资产包括 HA token、模型 API key、用户密码/会话、家庭设备状态/布局/偏好/历史、以及物理设备控制权限。主要威胁包括未授权控制、Prompt Injection、SSRF、密钥泄漏、重放请求、危险自动化、端口暴露和不安全升级。

## 基线要求

- 默认拒绝、最小权限、服务端授权。
- 模型输出和设备/外部文本都视为不可信输入。
- 不提供任意 shell、代码执行、任意 URL 或任意 HA service 工具。
- 密钥不进前端、日志、错误、模型 prompt 或普通任务记录。
- 设备操作与权限变化可审计。
- 高风险操作要求即时明确确认；MVP 不允许无人值守 AI 解锁门锁或关闭安全系统。
- 远程访问建议 VPN 或 HTTPS 反向代理；不要直接暴露管理端口。

## 密钥管理

- `.env` 不提交仓库。
- 存入 DB 的 HA token 使用应用加密密钥加密，或使用外部 secret reference。
- 用环境变量/secret mount 注入主加密密钥，不能把密钥与密文存同一处而无保护。
- 日志字段递归脱敏（token、authorization、password、secret、apiKey、cookie 等）。
- API 不回传凭据；支持更新/轮换并验证。

## SSRF

集成 URL 是潜在 SSRF 入口：
- 限制 scheme；生产优先 HTTPS，局域网 HTTP 必须是明确支持的模式。
- 拒绝 localhost、loopback、link-local、云 metadata 和策略禁止的网段；局域网 HA 目标需通过单独允许策略支持，不能简单将所有私有 IP 一刀切禁止。
- 对域名 DNS 解析结果校验，防 DNS rebinding；连接时重新验证解析后的 IP。
- 默认不跟随重定向；每次重定向重新校验。
- 设置连接/读取超时与响应大小限制。
- 不把用户输入拼接成任意 path。
- 安全测试需覆盖本地开发/家庭局域网的明确允许场景。

## Prompt Injection 与工具

- 实体名称、状态属性、通知文本、对话内容均为不可信数据。
- 工具权限、risk、confirmation 由服务端定义，不能由模型修改。
- 工具调用前重新验证用户权限、目标实体、能力、参数、状态新鲜度和任务确认。
- MCP、Web、自动化使用相同策略与审计。
- 对高风险确认绑定计划 hash、用户、过期时间与单次 nonce，防止确认后计划被替换和重放。

## 跨平台客户端安全

- 原生端 access token 优先只保存在内存；refresh token 进入 iOS Keychain / Android Keystore backed storage（通过已验证的 Expo SecureStore API）。不将长期凭据存 AsyncStorage。
- Web 使用 HttpOnly、Secure、SameSite cookie 和 CSRF 防护；禁止把长期 refresh token 放进 localStorage。
- 客户端 bundle 中的 `EXPO_PUBLIC_*` 变量均视为公开信息，不可放密钥。
- App 与自托管 API 的远程连接要求 HTTPS/WSS；局域网 HTTP 必须显式启用并被地址策略约束，不要全局关闭 iOS ATS 或 Android cleartext 防护。
- 原生深链接中不得包含长期 access/refresh token；配对 URL 仅允许短期、一次性、有 scope 的 pairing code。
- push payload 默认仅包含通知类型与资源 ID，避免在锁屏上泄漏家庭状态；高风险操作不能通过通知 action 绕过确认。
- 服务端要支持 refresh token 轮换、撤销、过期和重放检测；退出登录清除本地凭据并撤销会话。

## 数据隐私

- 默认本地保存家庭状态与偏好。
- 外部 LLM 只发送当前任务必要上下文，设置页显示提供方和数据使用边界。
- 提供关闭 AI 功能的开关。
- 对话、偏好和审计设置不同保留策略。
- 用户删除结构化记忆后，相关记忆不再参与推理；按法规/安全需要保留最少审计摘要并说明原因。
- 不收集无关数据；不把家庭数据用于训练外部模型，除非用户明确选择且服务条件允许。

## 安全验收

- 未认证用户无法访问受保护端点。
- 用户不能调用管理员工具。
- 模型输出低风险标签无法降低服务器风险判断。
- 高风险操作未确认不能执行；过期/重放确认不能执行。
- token 与 API key 不出现在日志、浏览器 bundle、Expo 原生 bundle、错误或任务输入里。
- 原生客户端没有长期 token 存于 AsyncStorage；Web 不把 refresh token 存在 localStorage。
- Push payload 没有敏感设备状态，失效 token 可被注销。
- 目标 URL 不能探测不允许的地址；重定向/DNS 变更也会重新校验。
- Redis/DB 默认不向宿主公网端口暴露。
