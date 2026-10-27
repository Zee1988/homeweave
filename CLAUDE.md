# Claude Code Project Instructions

`AGENTS.md` 是本项目唯一的 coding-agent 规则源。开始前先阅读它，并按任务阅读 `docs/` 中相关规格。

新项目/空前端的默认客户端方案是 Expo + React Native + TypeScript + React Native Web，入口位于 `apps/mobile/`；后端位于 `apps/api/`。不要另外创建 React + Vite 的第二套 UI，除非先提出 ADR 并说明无法用 Expo Web 满足的具体需求。

首次工作遵循 `docs/12_CODING_AGENT_GUIDE.md` 和 `docs/11_IMPLEMENTATION_ROADMAP.md` 的 Phase 0：审查当前仓库、确认未提交改动、报告差距和风险，再做小范围基线工作。不要在没检查现状前大规模重写。

关键约束：
- Home Assistant 是设备当前状态的事实来源。
- AI 负责理解/规划；服务端负责授权、执行、验证。
- UI、Agent、MCP、自动化共用 Tool Registry 和 Policy Engine。
- 未验证的操作结果必须是 `unknown`，不能报成功。
- 模型不能改变服务端权限、风险等级和确认要求。
- 不在前端、日志、prompt 或代码仓库泄漏秘密。
- MVP 不自动解锁门锁或关闭安防。
- 手机后台执行不作为可靠任务系统；任务由后端持久化执行。
- 运行相关测试并准确报告实际通过/失败的命令。
