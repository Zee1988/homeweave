# Phase 1: App 元数据与仓库可识别性 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-27
**Phase:** 1-App 元数据与仓库可识别性
**Areas discussed:** 占位符取值方式, 校验命令形态, config.yaml 字段边界

---

## 占位符取值方式

| Option | Description | Selected |
|--------|-------------|----------|
| 用探测值 | owner=Zee1988，url=https://github.com/Zee1988/homeweave，maintainer=Zee，源码路径用 tree/master | ✓ |
| 仓库名不同 | 仓库名/URL 不是 homeweave（在 Other 里填真实 Git 仓库 URL） | |
| 暂不确定 | 先保留占位符，Phase 1 末尾由用户补；校验命令必须失败以阻断后续阶段 | |

**User's choice:** 用探测值
**Notes:** 探测依据为 `gh auth status`（GitHub 账号 `Zee1988`）、`git log -1`（作者 `Zee <92412912+Zee1988@users.noreply.github.com>`）、`git symbolic-ref`（默认分支 `master`）。仓库当前未配置 remote，URL 按目录名推断，若仓库尚未创建需在 Phase 1 建仓时确认。

| Option | Description | Selected |
|--------|-------------|----------|
| 单一来源 + 生成 | 值只写一份（`homeweave_app/app-metadata.json`），由脚本生成两份 YAML | ✓ |
| 直接写死 | 真值直接写进两份 YAML，重复处靠人肉同步 | |
| 占位 + 门禁失败 | 保留 `<owner>` 占位，校验命令遇占位符即失败 | |

**User's choice:** 单一来源 + 生成
**Notes:** 目标是消除"仓内两份元数据不一致"的风险，同时保留可被 Supervisor 识别的真实值。

| Option | Description | Selected |
|--------|-------------|----------|
| 保守基线 | 写克制的最低值（HA 2024.x 级别），不依赖很新的字段 | ✓ |
| 当前最新稳定 | 按 2026 年当前稳定版写最低值 | |
| 交研究定 | 本阶段不写死，由 researcher 核对官方文档后给推荐值 | |

**User's choice:** 保守基线
**Notes:** 用户接受"先核实该基线版本下字段可用性"这一前置动作。

---

## 校验命令形态

| Option | Description | Selected |
|--------|-------------|----------|
| Node 自写 | 仓内自写 Node 校验，只引入 js-yaml；本地与 CI 一致、不依赖 Docker | ✓ |
| 官方容器 | `home-assistant/builder` 或官方 addon-linter 容器，最接近 Supervisor 真实行为，但需要 Docker | |
| 两者混合 | Node 快检本地必跑 + 官方 linter 作 CI 兜底 | |

**User's choice:** Node 自写
**Notes:** 明确接受"官方 schema 字段清单由仓内自行维护"这一代价。

| Option | Description | Selected |
|--------|-------------|----------|
| 只格式与必填 | YAML 语法 + 必填字段 + 类型与枚举（arch 仅 amd64/aarch64） | ✓ |
| 加仓库唯一性 | 再加递归扫描，断言只有一份被 Supervisor 识别的 config.yaml | |
| 加交叉一致性 | 再加 url / image 前缀 / tree 分支与 git remote 的一致性校验 | |

**User's choice:** 只格式与必填
**Notes:** 用户未选择唯一性扫描，因此 docs/21 §4 的"根目录只能有一个 repository.yaml、避免普通文档命名 config.yaml"在本阶段仍靠 `.example` 约定与人工评审保障，不做自动化断言。

| Option | Description | Selected |
|--------|-------------|----------|
| 脚本 + pnpm script | 仓根最小 `package.json` + `scripts/validate-app-metadata.mjs`，入口 `pnpm validate:app` | ✓ |
| 仅脚本本体 | 不建 package.json，Phase 2 建 workspace 后再挂入口 | |
| 只交规则 | 本阶段只写校验规则文档，脚本留给 Phase 2 | |

**User's choice:** 脚本 + pnpm script
**Notes:** Phase 1 由此成为全仓第一批可执行文件（`package.json` + `scripts/`）。

---

## config.yaml 字段边界

| Option | Description | Selected |
|--------|-------------|----------|
| 最小可识别 | 只写 APP-02 字段 + APP-04 的 options/schema | ✓ |
| 加展示与健康 | 最小集 + panel_title/panel_icon/watchdog | |
| 全部预留 | 连 map/watchdog/backup/apparmor/devices/ports 一并写上 | |

**User's choice:** 最小可识别
**Notes:** `ports: 8124/tcp` 保持注释状态，与 docs/21 §5 的"认证授权完成前不开放原生 API 端口"一致。

| Option | Description | Selected |
|--------|-------------|----------|
| 先不写 | 等 Phase 3 的 `/health/live` 真实存在后再加 | ✓ |
| 先写指向探针 | 写 `http://[HOST]:[PORT:8099]/health/live`，Phase 3 前会持续标红 | |
| 写但注释掉 | 字段模板放注释里，激活时机写进 CONTEXT.md | |

**User's choice:** 先不写
**Notes:** 避免 Supervisor 对不存在的健康端点持续告警。

| Option | Description | Selected |
|--------|-------------|----------|
| 两个都落 | log_level（枚举）+ ha_url（默认空 = Supervisor 自动发现） | ✓ |
| 只落 log_level | ha_url 覆盖留到 Phase 6（HA-04） | |
| 两个都落但限定 | ha_url 增加格式约束，真正 SSRF 防护仍在 Phase 6 | |

**User's choice:** 两个都落
**Notes:** 与 APP-04 原文一致；`ha_url` 的安全约束由 Phase 6 的 HA-04 承担，本阶段只保证默认值为空（安全）。

---

## Claude's Discretion

- 单一来源文件最终名称、生成脚本调用方式、`pnpm` script 命名（`validate:app` 除外）
- `slug`（预计 `homeweave`）、初始 `version`（预计 `0.1.0`）、`description` 文案、`url` 子路径深度
- 校验命令的输出格式与退出码约定

## Deferred Ideas

- App 条目完整度（`icon.png` / `logo.png` / 最小 `DOCS.md` / `README.md` / `CHANGELOG.md`）——本阶段未选入讨论，暂归 Phase 7（DOC-01 / DOC-06），并记录"若 HAOS 实机验证发现缺 `DOCS.md` 导致条目不可用，需提前回补最小占位"的风险
- `watchdog` 字段 → Phase 3
- `ha_url` 的 SSRF 防护与超时/重定向校验 → Phase 6
- `config.yaml` 唯一性自动化断言 → 本阶段不做，留作 Phase 2 或 Phase 7 评估
- 官方 addon-linter / builder 校验作为 CI 兜底 → Phase 2 评估
- AppArmor、`backup`、`map`、`devices`、原生 API `ports` 开放 → Phase 2 / Phase 5 及之后
