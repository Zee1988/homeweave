# 06 — Agent、Fast-Path 与 Tool Registry

## 设计原则

Agent 是理解、规划与解释层，不是设备执行层。所有工具调用必须经过服务端 Tool Registry、schema 校验、Policy Engine、统一 Application Service 和结果验证。

## 三条执行路径

### A. Fast-Path
处理明确、简单、实体映射唯一的命令，例如“打开客厅灯”“把书房灯调到 30%”“客厅现在多少度”。过程：文本规范化 → 意图/实体匹配 → schema 校验 → 服务端策略 → 查询/执行 → 状态验证。低置信度或多候选必须澄清，不得对敏感操作使用模糊匹配直接执行。

### B. LLM Planning
处理跨设备目标、模糊意图和多约束请求。LLM 输出经过严格 JSON schema 校验的计划；服务端重新计算权限、风险和确认要求。模型不能输出任意 URL、shell、代码或任意 HA 服务调用。

### C. Automation Engine
处理已确认的定时/事件规则；执行逻辑应确定性运行。LLM 只辅助生成草稿、解释或建议，不应每天重新规划一条固定规则。

## ModelProvider 接口建议

```ts
interface ModelProvider {
  generateStructured<T>(input: {
    systemPrompt: string;
    userPrompt: string;
    schema: unknown;
    timeoutMs: number;
  }): Promise<{
    data: T;
    usage?: { inputTokens?: number; outputTokens?: number };
  }>;
}
```

要求：API key 只在后端；超时、最大 token 和限流保护；结构化输出必须校验；记录供应商/模型/耗时/用量但不记录密钥；可禁用与替换提供方；发送最小必要上下文。

## 提供给模型的上下文

只提供当前任务所需的用户请求、相关房间设备/能力/状态、状态时间与 stale 标记、明确确认的偏好、可用工具 schema、风险规则摘要及必要对话上下文。不要发送全屋所有实体、完整审计历史或无关个人数据。

## 计划结构示意

```json
{
  "intent":"prepare_movie_environment",
  "summary":"准备观影环境并保留过道灯",
  "clarificationQuestions":[],
  "steps":[
    {
      "tool":"light.set_power",
      "arguments":{"entityId":"internal-entity-id","power":"off"},
      "reason":"关闭客厅主灯"
    }
  ],
  "assumptions":[],
  "limitations":[]
}
```

模型不需要也不应该拥有最终的 `riskLevel` 或 `requiresConfirmation` 权限。服务端根据工具定义和策略重新计算。

## Tool Registry 最低字段

`name`、`description`、`inputSchema`、`permissionPolicy`、`riskLevel`、`requiresConfirmation`、`timeoutMs`、`idempotencyPolicy`、`verificationStrategy`、`handler`、`version`。

建议 MVP 工具：
- `home.get_summary`
- `area.get_state`
- `entity.get_state`
- `light.turn_on`
- `light.turn_off`
- `light.set_brightness`
- `switch.set_power`
- `climate.set_temperature`
- `cover.set_position`
- `scene.preview`
- `scene.execute`

不要提供 `ha.call_any_service` 这类无边界的高权限工具。支持新领域应通过经过测试的 adapter 与工具定义扩展。

## 风险策略

- `low`：状态查询、普通灯光；按授权可直接执行。
- `medium`：温控、窗帘、多设备场景；根据影响范围和设置决定是否确认。
- `high`：门锁、安防、危险设备；MVP 禁止 AI 无人值守执行，需显式确认及额外权限。
- `critical`：MVP 不向 Agent 暴露。

风险等级只能由后端定义。不得因模型说“风险低”而降低等级。

## Task Orchestrator

1. 持久化任务与步骤。
2. 检查计划版本、权限、设备能力、参数与状态新鲜度。
3. 对需确认任务生成短期、单次、绑定 plan hash 的确认记录。
4. 逐步骤执行并持久化状态。
5. 等 HA 事件或主动查询验证结果。
6. 有限重试；重试前重读状态，非幂等操作不得盲重试。
7. 汇总 succeeded / failed / unknown / partially_succeeded。
8. 广播 task events，写入审计。

## 结果可信度

- `succeeded`：有证据目标状态已达到。
- `failed`：明确失败。
- `unknown`：无法确认最终状态。
- `partially_succeeded`：多步骤有成功也有失败/未知。

摘要必须根据服务端执行结果生成；模型可润色语句，但不能自行声称设备已成功执行。

## 记忆

持久化结构化偏好，包含来源（explicit/confirmed/inferred）、置信度、确认时间、启用状态。推测记忆默认不改变设备状态。用户能查看、编辑、禁用和删除。

## MCP（P1）

MCP 仅暴露经审核的工具；使用与 UI/Agent 相同的注册表和策略。每个调用必须有身份与权限上下文，执行记录进入审计。不能因为入口是 MCP 绕过确认。
