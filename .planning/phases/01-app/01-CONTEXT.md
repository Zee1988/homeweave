# Phase 1: App 元数据与仓库可识别性 - Context

**Gathered:** 2026-10-27
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段交付的是**让 Supervisor 能把这个仓库识别为有效 App 仓库、并在 Apps 列表渲染出可安装的 HomeWeave 条目**所需的全部元数据与取值决策：

- 仓库根 `repository.yaml`（真实 URL 与 maintainer，无占位符）
- `homeweave_app/config.yaml`（最小可识别字段集 + `options`/`schema`）
- 一份可执行的元数据校验命令（`pnpm validate:app`）

**不包含**：Dockerfile 与镜像构建（Phase 2）、`/health` 运行时端点（Phase 3）、SQLite 迁移（Phase 4）、Ingress Web UI（Phase 5）、HA API 连接自检（Phase 6）、完整安装/升级/排障文档与 HAOS 实机验证（Phase 7）。

</domain>

<decisions>
## Implementation Decisions

### 占位符取值方式

- **D-01:** 采用探测到的真实取值，仓库内不得残留 `<owner>` 类占位符：
  - GHCR `owner` = `Zee1988`
  - Git 仓库 URL = `https://github.com/Zee1988/homeweave`
  - `maintainer` = `Zee`
  - 源码路径分支用 **`master`**（当前默认分支），**不是** `main` — 模板里的 `tree/main` 会 404
  - **镜像路径必须全小写**：`image` = `ghcr.io/zee1988/homeweave-ha-app`（owner 小写 `zee1988`）；`repository.yaml` 的 `url` 与 `maintainer` 仍为 `Zee1988` / `Zee`。见 D-01a
  — **Reversibility:** costly — `repository.yaml` 的 `url` 与 `image` 前缀一旦被用户添加为自定义仓库，改名会让已安装用户的更新源失效，需用户重新添加仓库
- **D-02:** 单一来源 + 生成。真实值只在**一份**元数据源文件（`homeweave_app/app-metadata.json`）中维护，由生成脚本产出 `repository.yaml` 与 `homeweave_app/config.yaml`；仓库内禁止出现两份手工维护、可能互相不一致的元数据
- **D-03:** 最低 Home Assistant 版本取**当前稳定版**（覆盖原“保守基线”方案，见 D-03a）：`homeassistant: "2026.10.0"`。依据是 2026-10-27 实取的官方 `https://version.home-assistant.io/stable.json`（`homeassistant.default=2026.10.4`、`supervisor=2026.10.4`、`channel=stable`）。代价：放弃对 2026.10 之前版本的兼容声明，换取“声明值即当前可核验态”。仍然**不得**声称已在 HAOS 实机验证
  — **Reversibility:** costly — `homeassistant` 是已发布的安装契约，后续调高会让低版本用户无法安装，调低则等于宣称未验证的兼容性

### 校验命令形态

- **D-04:** 校验命令**自写 Node 实现**，只引入 `js-yaml` 一个依赖；不使用 `home-assistant/builder` 或官方 addon-linter 容器（本地与 CI 都不必装 Docker，秒级完成）。代价：官方 schema 的字段清单由仓内自行维护
- **D-05:** 校验范围**只做格式与必填 + 一项唯一性断言**（见 D-05a）：
  - YAML 语法、必填字段（`name`/`slug`/`version`/`arch`/`image`/`ingress_port` 等）、类型与枚举（`arch` 仅允许 `amd64`/`aarch64`）
  - **唯一性**：递归扫描 `**/config.{yaml,yml,json}`（跳过 `.` 开头路径段与 `rootfs`），断言全仓只有一份——这是唯一被纳入的“结构类”检查，直接对应 ROADMAP 成功标准 2 与 APP-02 的“不得有第二份会被 Supervisor 递归识别的 config.yaml”
  - **仍然不做**交叉一致性校验（`repository.yaml.url` vs `git remote`、源码 `tree/<branch>` 真实性），那属于人工/后续阶段
- **D-06:** 交付形态为仓根最小 `package.json` + `scripts/validate-app-metadata.mjs`，统一入口 `pnpm validate:app`，Phase 2 的 CI 直接调用该入口，不再重构

### config.yaml 字段边界

- **D-07:** 只写**最小可识别字段集**：`name`、`slug`、`version`、`description`、`url`、`arch`、`init`、`image`、`homeassistant`、`homeassistant_api`、`ingress`、`ingress_port`，加上 `options`/`schema`。**不写** `watchdog`、`panel_title`、`panel_icon`、`map`、`backup`、`devices`、`apparmor`、`ports`（`ports: 8124/tcp` 保持注释状态）
  - `boot` 与 `startup` **不显式写**（D-07a）：默认值分别为 `auto` 与 `application`，显式写出与省略在行为上完全等价
  - `/data` 持久化**不需要任何字段**：官方参考明确其为 “Always mounted read and write”，故 APP-02 的“`/data` 持久化”由平台隐式满足，无需 `map`
  - `apparmor` 不写等于默认 `true`（即启用默认 profile），不是“关闭安全约束”；这意味着 Phase 2 的容器必须能在 Docker 默认 AppArmor profile 下运行
- **D-08 [deferred]:** `watchdog` 推迟到 Phase 3 —— 它要指向 `/health/live`，该端点在 Phase 3 才存在；提前写入会让 Supervisor 持续判定 App 不健康
- **D-09:** `options`/`schema` 落两项，与 APP-04 原文一致：
  - `log_level`：枚举 `info` / `debug` / `warn`
  - `ha_url`：`string`，默认空字符串，空值语义 = 走 Supervisor 自动发现
  — `ha_url` 的格式约束与 SSRF 防护（超时、重定向校验、内网地址拒绝）**不在本阶段**，由 Phase 6 的 HA-04 承担；本阶段只保证字段存在且默认值安全（空）

### Claude's Discretion

- 单一来源文件的最终文件名与生成脚本的调用方式（`pnpm` script 名称除 `validate:app` 外可自定）
- `slug`（预计 `homeweave`）、初始 `version`（预计 `0.1.0`）、`description` 文案、`url` 具体指向的子路径深度
- 校验命令的输出格式与退出码约定（建议：逐项列出失败原因，任一失败即非零退出）

### Folded Todos

无 —— `todo.match-phase 1` 返回 0 条待办。

### 研究裁决修订（2026-10-27，规划前）

`01-RESEARCH.md` 现场核对官方参考与 Supervisor 源码后，暴露出 4 处需要重新裁决的点。以下修订**覆盖**上文对应决策，规划者以本节为准：

- **D-01a: 镜像路径小写化（修订 D-01）。** `image` 必须全小写 `ghcr.io/zee1988/homeweave-ha-app`；`url` 与 `maintainer` 保留 `Zee1988` / `Zee`。理由：OCI/GHCR 镜像仓库路径不接受大写，按 `Zee1988` 写入会在 Phase 2 首推失败，且 `image` 前缀属 costly 变更（会改变已安装用户的更新源）。
- **D-03a: 最低版本 = 当前稳定版（修订 D-03）。** `homeassistant: "2026.10.0"`，证据为 2026-10-27 实取 `https://version.home-assistant.io/stable.json`。放弃 2024.x 保守基线，因为该基线在 2024.x 期没有任何正向证据（研究仅能标 `[ASSUMED]`），而“未验证却声明兼容”违背项目规则。降级风险可控：`_SCHEMA_APP_CONFIG` 使用 `extra=vol.REMOVE_EXTRA`，旧版 Supervisor 遇到不认识的键会静默忽略而非拒绝加载。
- **D-05a: 把唯一性断言加回校验器（修订 D-05）。** 研究以 `supervisor/store/data.py` 的 `glob("**/config.*")` 证明仓库发现是**递归**的，`.example` 后缀仅靠后缀白名单逃过识别；任何新增的真实 `config.yaml` 都会变成第二个 App。因此唯一性检查从“人工评审”升级为自动化断言，ROADMAP 成功标准 2 由此满足。
- **D-07a: `boot` / `startup` 不显式写（确认 D-07）。** 二者默认 `auto` / `application`，省略与显写等价；APP-02 所称“启动/停止字段”由 `init: false`、隐式 `/data` 挂载与平台默认值共同满足。
- **S2 登记（不改变决策）：** `ingress: true` 在 Phase 5 之前会让 App 详情页出现一个指向空端口的 “Open Web UI” 按钮。这是既定后果，需写进验收说明，不得在实机验证时误判为缺陷。
- **S4 更正：** `hassio_api` 与 `homeassistant_api` **不是**改名关系，二者语义不同且各自默认 `false`。本阶段只写 `homeassistant_api: true`。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### App 元数据与部署设计
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §4 — 仓库布局（根 `repository.yaml` 唯一、`homeweave_app/` 目录、`.example` 后缀防误识别）
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §5 — `repository.yaml` 与 `config.yaml` 字段清单、`image` 不带 tag、`version` 与镜像标签的关系
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §3 — 支持范围与"最低版本须实测后写入，不得凭空宣称"
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §9 — `options`/`schema` 只放非敏感偏好
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §11 — 验收标准与"无 HAOS 设备须标注未验证"
- `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §12 — 官方参考链接（Apps 配置参考、repository 指南、apps-example）

### 仓库内既有模板（现状事实来源）
- `examples/home-assistant-app/repository.yaml.example` — 三字段仓库清单的当前占位形态
- `examples/home-assistant-app/homeweave_app/config.yaml.example` — 字段集当前占位形态（含 `tree/main` 与 `image: ghcr.io/<owner>/homeweave-ha-app`）
- `examples/home-assistant-app/README.md` — `.example` 后缀的存在理由与"禁止把 `<owner>/<repo>` 复制进发布"

### 项目级约束
- `.planning/PROJECT.md` — Constraints（凭据边界、release order、`/data` 持久化）与 Key Decisions
- `.planning/REQUIREMENTS.md` — APP-01..APP-04 的原文验收口径
- `docs/08_SECURITY_AND_PRIVACY.md` — 密钥不落库、不入日志、不进前端产物的边界
- `docs/14_ENV_AND_DEPLOYMENT.md` — 环境变量与部署约定

### 官方规范（实施时须现场核对，不得凭记忆写）
- https://contributors.home-assistant.io/apps/reference/configuration/ — `config.yaml` 字段与 `schema` 语法
- https://contributors.home-assistant.io/apps/guides/repository/ — `repository.yaml` 与仓库识别规则
- https://github.com/home-assistant/apps-example — 官方示例仓库当前结构

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `examples/home-assistant-app/homeweave_app/config.yaml.example`：字段名已列出，可作为最小字段集的起点（但值全部要按 D-01 替换，分支改 `master`）
- `examples/home-assistant-app/repository.yaml.example`：三字段骨架可直接沿用

### Established Patterns
- `.example` 后缀是仓库内既有的"防被 Supervisor 递归识别"约定，本阶段新增的规格样本必须延续该后缀
- 文档与实现同步（`docs/` 改动须回写）已在项目规则中确立

### Integration Points
- Phase 2 的 CI 将直接调用 `pnpm validate:app`，因此脚本入口与退出码在本阶段即需稳定
- 生成脚本产出的 `config.yaml` 的 `image` 字段是 Phase 2 镜像命名与 tag 规则的输入，`version` 字段是 IMG-04"先镜像后版本号"的另一端
- 无任何既有源码，本阶段是全仓第一批可执行文件（`package.json` + `scripts/`）

</code_context>

<specifics>
## Specific Ideas

- 用户明确要求**不得凭记忆写官方元数据格式**，官方字段以现场核对为准；本阶段的校验器字段清单若与官方文档冲突，以官方文档为准并同步修正
- 用户明确要求**不提前构建后续阶段**：`watchdog`（Phase 3）、`ha_url` 的 SSRF 防护（Phase 6）、完整文档（Phase 7）都不得在 Phase 1 提前实现
- 验证结论必须区分静态检查 / 容器模拟 / HAOS 实机；本阶段只能产出**静态检查**结论，任何"能被 Supervisor 识别"的说法都要标注为未在真实 HAOS 上验证

</specifics>

<deferred>
## Deferred Ideas

- **App 条目完整度**（`icon.png` / `logo.png` / 最小 `DOCS.md` / `README.md` / `CHANGELOG.md`）：本阶段未选入讨论，暂按 DOC-01 / DOC-06 归 Phase 7。风险记录：缺 `DOCS.md` 时 App 详情页"Documentation"入口为空，若 HAOS 实机验证发现条目因此不可用，需在 Phase 7 之前回补最小占位
- **`watchdog` 字段** → Phase 3（依赖 `/health/live`）
- **`ha_url` 的 SSRF 防护、超时与重定向校验** → Phase 6（HA-04）
- ~~**仓库内 `config.yaml` 唯一性的自动化断言**：本阶段明确不做（D-05），仅靠 `.example` 后缀约定 + 人工评审~~ → **已改判**：按 D-05a 纳入本阶段校验器
- **官方 addon-linter / builder 校验**：作为 CI 可选兜底留待 Phase 2 评估
- **AppArmor profile、`backup`、`map`、`devices`、原生 API `ports` 开放** → Phase 2 / Phase 5 及之后

</deferred>

---

*Phase: 01-App 元数据与仓库可识别性*
*Context gathered: 2026-10-27*
