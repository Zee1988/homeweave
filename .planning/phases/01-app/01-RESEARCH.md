# Phase 1: App 元数据与仓库可识别性 — Research

**Researched:** 2026-10-27
**Domain:** Home Assistant App（原 Add-on）仓库元数据规范 / Supervisor store 发现机制
**Confidence:** HIGH（字段契约与发现规则）；MEDIUM（最低版本基线）；局部 UNVERIFIED（见各节标注）

> 术语说明：Home Assistant 已把 Add-on 更名为 **App**，字段名未变。本文件沿用 `config.yaml` / `repository.yaml` / `slug` 等实际键名。

---

## Summary

- **`config.yaml` 只有 5 个必填键**：`name`、`version`、`slug`、`description`、`arch`。`image`、`ingress`、`ingress_port`、`homeassistant_api`、`options`、`schema` 全部可选且都有默认值 —— 这支持 D-07 的"最小可识别字段集"，写上是显式声明，不写也能被识别。
- **仓库扫描是递归的**：Supervisor 用 `path.glob("**/config.*")` 在仓库**任意深度**查找，只跳过以 `.` 开头的路径段和名为 `rootfs` 的目录。`.example` 后缀之所以安全，是因为**后缀白名单**（`.example` 不在配置后缀集合内），不是"只扫一层"。
- **`image` 必须不带 tag，拉取 tag 恒等于 `version`**（官方原文 "without a tag" / "pulls the tag that matches `version`"）。这是 Phase 2 镜像命名的硬约束。
- **`/data` 不需要任何配置键**：官方原文说 `data` 挂载类型 "Always mounted read and write"，写进 `map` 只是为改挂载路径。启动/停止/健康由 `init`、`boot`、`startup`、`watchdog`、`stage` 五个彼此独立的键分别控制。
- **`icon.png` / `logo.png` / `DOCS.md` / `CHANGELOG.md` 全部可选**，缺失只影响商店展示细节，不影响条目渲染与安装 —— Phase 7 的推迟是安全的。

---

## Field Contract

必填性与默认值以 Supervisor 源码 `supervisor/apps/validate.py` 的 `_SCHEMA_APP_CONFIG` 为准 `[VERIFIED: https://raw.githubusercontent.com/home-assistant/supervisor/master/supervisor/apps/validate.py]`，语义与允许值以官方参考页为准 `[VERIFIED: https://contributors.home-assistant.io/apps/reference/configuration/]`，`arch` 允许值以 `supervisor/const.py` 为准 `[VERIFIED: https://raw.githubusercontent.com/home-assistant/supervisor/master/supervisor/const.py]`。

| 键 | 必填 | 类型 | 允许值 / 默认 | 来源 |
|---|---|---|---|---|
| `name` | **是** | string | 任意；显示在商店与 UI。`vol.Required(ATTR_NAME): str` | validate.py；配置参考页 |
| `slug` | **是** | string | 官方原文 "only letters, numbers, `-`, `_` and `.`; must be unique in the repository"。校验 `vol.Required(ATTR_SLUG): vol.Match(RE_SLUG_FIELD)`；`RE_SLUG` 本体在 `const`，未读取 → 正则字面量 **UNVERIFIED** | validate.py；配置参考页 |
| `version` | **是** | string（`version_tag`） | 版本字符串。原文 "When you use `image`, this is also the tag the Supervisor pulls. Quote it, so YAML does not read `1.10` as a number." | 配置参考页；publishing 页 |
| `description` | **是** | string | 简短描述。源码常量拼写为 `ATTR_DESCRIPTON`（原文如此） | validate.py |
| `arch` | **是** | list | `vol.Required(ATTR_ARCH): [vol.In(ARCH_ALL_COMPAT)]`。`ARCH_ALL = [ARCH_AARCH64, ARCH_AMD64]`；`ARCH_DEPRECATED = [ARCH_ARMHF, ARCH_ARMV7, ARCH_I386]`；`ARCH_ALL_COMPAT = ARCH_ALL + ARCH_DEPRECATED`。即 `aarch64`/`amd64` 为支持架构，`armhf`/`armv7`/`i386` 已弃用但仍接受（带警告） | const.py；validate.py |
| `url` | 否 | URL | 应用主页。`vol.Optional(ATTR_URL): vol.Url()` | validate.py；配置参考页 |
| `init` | 否 | bool | 默认 **`true`**。原文：镜像自带 init 时设为 `false`（所有 HA 基础镜像即如此，否则 S6 overlay v3 无法启动） | validate.py `default=True`；配置参考页 |
| `image` | 否 | string（`docker_image`） | 无默认。**必须不带 tag**。原文 "The image to pull, without a tag, like `ghcr.io/me/my-app`. The tag is always `version`." 不写 `image` 则设备本地构建 | 配置参考页；publishing 页 |
| `homeassistant` | 否 | string（`version_tag`） | 最低 HA Core 版本，如 `2026.10.0`。`vol.Optional(ATTR_HOMEASSISTANT): version_tag` | validate.py；配置参考页 |
| `homeassistant_api` | 否 | bool | 默认 **`false`**。经 `http://supervisor/core/api` 代理访问 Core API；**通过代理时应用以 HA 管理员身份行动** | validate.py；配置参考页 |
| `ingress` | 否 | bool | 默认 **`false`**。在 HA 内嵌显示 App Web 界面 | validate.py；配置参考页 |
| `ingress_port` | 否 | integer | 默认 **`8099`**。`vol.Any(network_port, vol.Equal(0))`；`0` = 由 Supervisor 在 **62000–65500** 分配。原文 "An app with `ingress_port: 0` must not expose any port between 62000 and 65500 in `ports`" | validate.py；配置参考页 |
| `options` | 否 | mapping | 默认 `{}`。**默认值的唯一表达位置** | validate.py；options 指南 |
| `schema` | 否 | mapping 或 `false` | 默认 `{}`。`vol.Any(vol.Schema({str: SCHEMA_ELEMENT}), False)`；`false` 关闭校验与表单 | validate.py；options 指南 |
| `watchdog` | 否 | string（URL 模板） | **无默认**。正则 `^(?:https?\|\[PROTO:\w+\]\|tcp):\/\/\[HOST\]:(\[PORT:\d+\]\|\d+).*$`。HTTP watchdog 判定健康条件为状态码 **< 300** | validate.py；配置参考页 |
| `boot` | 否 | string | 默认 **`auto`**。`auto` / `manual` / `manual_only`（`AppBootConfig` 三者俱备；运行时 `AppBoot` 仅 `auto`/`manual`） | const.py；validate.py |
| `startup` | 否 | string | 默认 **`application`**。`initialize` / `system` / `services` / `application` / `once` | const.py；validate.py |
| `stage` | 否 | string | 默认 **`stable`**。`stable` / `experimental` / `deprecated` | const.py；validate.py |
| `map` | 否 | list | 无默认。每项 `type` + 可选 `read_only`（默认 `true`）+ 可选 `path`。类型见 `RE_VOLUME`：`data`/`config`/`ssl`/`share`/`media`/`backup`/`homeassistant_config`/`app_config`/`all_app_configs`/`local_apps` | validate.py；配置参考页 |
| `panel_title` | 否 | string | 默认 = `name` | 配置参考页 |
| `panel_icon` | 否 | string | 默认 **`mdi:puzzle`** | validate.py；配置参考页 |
| `panel_admin` | 否 | bool | 默认 `true` | validate.py；配置参考页 |
| `apparmor` | 否 | bool | 默认 **`true`**。有 `apparmor.txt` 用该 profile，否则用 Docker 默认 profile。**未弃用** | validate.py；配置参考页；files 页 |
| `ports` | 否 | mapping | 无默认。`"容器端口/协议": 宿主端口`，协议 `tcp`/`udp`；宿主端口 `null` = 默认关闭、用户可开 | validate.py；配置参考页 |
| `hassio_api` | 否 | bool | 默认 `false`。**与 `homeassistant_api` 是两个不同的键，不是新旧关系** | validate.py；配置参考页 |
| `backup` | 否 | string | 默认 `hot`；`hot` / `cold` | validate.py；配置参考页 |

**一个影响校验器设计的关键细节：** `_SCHEMA_APP_CONFIG` 使用 `extra=vol.REMOVE_EXTRA`，即 **Supervisor 会静默丢弃它不认识的键，不报错、不警告**。参考页也明说多余键被静默忽略、"因此拼写需自行核对"。这意味着 `ingresss: true` 这类拼写错误能 100% 通过 Supervisor 校验，只是静默失效 —— 静态校验器必须自带**键白名单**，否则无法发现此类错误。这与 D-04"官方 schema 字段清单由仓内自行维护"是同一代价的两面，实现时须显式确认。

---

## Conflicts with CONTEXT.md

### B1 — `/data` 持久化与 start/stop/health 的键归属

**问题：** `/data` 是否需要写某个配置键？谁控制启动、停止、健康检查？

**证据：** 配置参考页 `map` 表格中 `data` 一行原文为 "The private data of this app. **Always mounted read and write**; only use this type to change `path`"。即 `/data` 对所有 App **无条件读写挂载**，写 `map: - type: data` 只为改挂载点。五个键各管一件事，互不替代：

| 关注点 | 键 | 取值 / 默认 |
|---|---|---|
| 容器内 PID 1 init 进程 | `init` | bool，默认 `true` |
| 是否随系统开机启动 | `boot` | `auto`(默认) / `manual` / `manual_only` |
| 启动顺序（相对 HA 各阶段） | `startup` | `initialize` / `system` / `services` / `application`(默认) / `once` |
| 周期健康检查 | `watchdog` | URL 模板，无默认 |
| 商店可见性 / 成熟度 | `stage` | `stable`(默认) / `experimental` / `deprecated` |

**UNVERIFIED：** "`/data` 在 App 更新、重建镜像、卸载时保留"这一**持久化语义**未被该页显式声明（页面根本没出现 "persistent" 一词）。唯一正面表述是"私有数据 + 始终读写挂载"。**不得把"跨更新保留"写成已验证结论**；要断言需在 HAOS 实机验证，或另取官方 backup/数据页。

**对 CONTEXT 的影响：** 与 `.planning/PROJECT.md` 的 `/data` 持久化约束不冲突 —— 但该约束在 Phase 1 **不需要任何配置键**来"开启"，它是隐式行为。选项：

- 选项 A：Phase 1 不写任何 `map`，依赖隐式 `/data`（最小面）。
- 选项 B：计划里显式挂账"`/data` 跨更新持久化的实机确认归 Phase 7"，把未验证项写清。

（不做选择。）

### B2 — 仓库发现：递归、目录名、`.example` 后缀

**问题：** 递归还是只扫一层？哪些目录名算 App？`config.yaml.example` 会被误识别吗？

**证据（源码 `supervisor/store/data.py`）** `[VERIFIED: https://raw.githubusercontent.com/home-assistant/supervisor/master/supervisor/store/data.py]`：

```python
    async def _find_app_configs(self, path: Path, repository: str) -> list[Path] | None:
        """Find apps in the path."""

        def _get_apps_list() -> list[Path]:
            # Generate a list without artefact, safe for corruptions
            return [
                app
                for app in path.glob("**/config.*")
                if not [
                    part
                    for part in app.parts
                    if part.startswith(".") or part == "rootfs"
                ]
                and app.suffix in FILE_SUFFIX_CONFIGURATION
            ]
```

由此确定三件事：

1. **递归**：`**/config.*` 是任意深度 glob。仓库里**任何**非隐藏、非 `rootfs` 目录下的 `config.yaml`/`config.yml`/`config.json` 都会成为 App 候选。
2. **没有目录名约定**：无任何"必须叫 `addon/`"之类的目录名限制，目录名任意，判定依据只有文件。仓库根 `repository.yaml` 的定位是**非递归**的：`find_one_filetype(path, "repository", FILE_SUFFIX_CONFIGURATION)`，只查仓库根。
3. **`.example` 后缀确实足够**，但原因是后缀白名单而非层级：`config.yaml.example` 能被 `config.*` 这个 glob 匹配（`*` 匹配 `yaml.example`），随后被 `app.suffix in FILE_SUFFIX_CONFIGURATION` 过滤 —— 其 `Path.suffix` 是 `.example`，不在配置后缀集合内。官方 files 页亦说明只接受 `config.yaml`/`config.yml`/`config.json`。
   - **UNVERIFIED：** `FILE_SUFFIX_CONFIGURATION` 的字面值在 `const.py` 中，本次未逐字读取；上述结论依赖"该常量恰为配置后缀集合（json/yaml/yml）"这一文档侧旁证。

**对 CONTEXT 的影响（真实风险）：** D-05 明确"不做仓库内 `config.yaml` 唯一性扫描"。在递归扫描下，后续阶段只要有人在 `docs/`、`tests/fixtures/`、`docker/` 下放一个示例 `config.yaml`，它就会被 Supervisor 当成**第二个 App** 去校验，可能整体报错或被静默丢弃。现有 `examples/home-assistant-app/homeweave_app/config.yaml.example` 是安全的，但**新建任何示例文件都必须保留 `.example` 后缀**。选项：

- 选项 A：维持 D-05（不扫描），把"新增 `config.yaml` 需人工评审"写入 Phase 2 的 CI/贡献说明。
- 选项 B：把 D-05 的"不做唯一性扫描"降级为"只做一条廉价断言：全仓 `config.yaml` 命中数恰好为 1"，代价约 5 行代码，可消除整类事故。

（不做选择；建议计划评审时由用户定。）

### B3 — `apparmor` 的必填性与 `apparmor.txt`

**证据：** `vol.Optional(ATTR_APPARMOR, default=True): vol.Boolean()`；参考页 `apparmor` 默认 `true`，并说明有 `apparmor.txt` 时用该 profile、否则用 Docker 默认 profile；files 页表格中 `apparmor.txt` **必需性 = 否**，作用是"自定义 AppArmor 配置文件，替代默认配置加载"。

**结论：** `apparmor` 可选、**未弃用**、默认 `true` 即启用（默认 profile 存在，故不需要 `apparmor.txt` 也能运行）。D-07"不写 `apparmor`"**不会关闭**安全约束 —— 不写等于 `true`。若将来确要关闭，才需显式 `apparmor: false`（属安全面变更）。

**对 CONTEXT 的影响：** 无冲突。但 `apparmor: true`（默认）意味着**容器必须能在 Docker 默认 AppArmor profile 下运行**，这是 Phase 2 Dockerfile 的隐含约束，需在 Phase 2 计划留一句。

### B4 — `watchdog` 缺失 vs 存在但失败

**证据：** `vol.Optional(ATTR_WATCHDOG): vol.Match(...)` —— `vol.Optional` 且**无 default**，缺失时 Supervisor 不持有任何健康检查目标，也就不会因健康检查停用/重启 App。存在时：参考页"HTTP watchdog 将状态码 **< 300** 视为健康"，`tcp://` 形式"仅检查端口可连接"；`watchdog` 额外允许 `tcp://`，`webui` 不允许。

**UNVERIFIED：** "存在但持续失败 → Supervisor 标记 unhealthy 并自动重启/停止 App"这一**后果链**本次未取到官方原文。可引用到的只是判定阈值（< 300 为健康）与"缺失即无检查"。因此：

- D-08 的前提"提前写入会让 Supervisor 持续判定 App 不健康"**方向正确但未经官方原文证实**；能确证的是"该端点尚不存在时，指向它的健康检查必然失败"。
- 计划中应把 watchdog 的行为结论标注为"未在 HAOS 实测"，Phase 3 落地 `/health/live` 后再验证。

**对 CONTEXT 的影响：** D-08（把 `watchdog` 推到 Phase 3）在证据上仍然成立 —— 缺失 watchdog 无副作用。无需改决策，只需按上面修正表述。

### A 级意外（与 D-01..D-09 相关，需用户裁决）

**S1 — GHCR 镜像路径的大小写。** D-01 定的 GHCR `owner` 是 `Zee1988`，而参考页与 publishing 页给出的 `image` 实例全部是小写（`ghcr.io/me/my-app`、`ghcr.io/home-assistant/app-example`）。容器镜像仓库路径按规范必须全小写 `[ASSUMED]`（本次未取得官方逐字规则），GitHub Container Registry 对含大写字母的镜像名会拒绝推送 `[ASSUMED]`。若按 `image: ghcr.io/Zee1988/homeweave-ha-app` 写入，Phase 2 的推送很可能直接失败。选项：

- 选项 A：`image` 用小写 `ghcr.io/zee1988/homeweave-ha-app`（GHCR 对 owner 大小写不敏感，`url`/`maintainer` 仍保留 `Zee1988` / `Zee`）。
- 选项 B：坚持 `Zee1988`，Phase 2 首次推送时再按报错修正（代价：`image` 前缀变更属 costly reversibility）。

（不做选择；这是本阶段最需要用户确认的取值。）

**S2 — `ingress: true` 在 Phase 1 的可见后果。** D-07 要求写 `ingress: true` + `ingress_port: 8099`，但 Web UI 要到 Phase 5 才存在。后果：App 详情页的 "Open Web UI" 按钮在 Phase 5 之前指向一个无人监听的端口，点击得到空白/错误页。这不影响仓库被识别与安装，但会让早期实机验证看起来"坏了"。选项：

- 选项 A：Phase 1 维持 `ingress: true`（元数据先完整，接受 Phase 5 前的空按钮）。
- 选项 B：Phase 1 先写 `ingress: false`，Phase 5 再翻为 `true`（每次翻转都改变已安装用户的界面，需一次重载）。
（D-07 已锁定写法，此处仅登记后果，供计划中写进验收说明。）

**S3 — `ingress_port: 8099` 是 Supervisor 默认值。** `vol.Optional(ATTR_INGRESS_PORT, default=8099)`：显式写 8099 与不写完全等价。写上更自解释，成本为零，**不构成冲突**，仅登记以免误以为是"必须显式声明"。

**S4 — 问题 E 的前提有误：`hassio_api` 并未被 `homeassistant_api` 取代。** 二者在 `_SCHEMA_APP_CONFIG` 中并列存在、各自默认 `false`，语义不同：`hassio_api` = 访问 Supervisor API（受 `hassio_role` 限制），`homeassistant_api` = 经 `supervisor/core/api` 代理访问 HA Core API。不存在 rename。真正被弃用的键是 `advanced`、`codenotary`、`snapshot*`（读作 `backup*`）、`auto_uart`，以及 `startup: before/after`（读作 `services`/`application`）。

---

## Minimum Viable config.yaml

路径：`homeweave_app/config.yaml`。取值全部按 D-01（真实取值、分支 `master`）+ D-07（字段边界）+ D-09（options/schema）。**无占位符**。

```yaml
# https://contributors.home-assistant.io/apps/reference/configuration/
name: HomeWeave
slug: homeweave
version: "0.1.0"
description: AI Home Operating System for Home Assistant
url: "https://github.com/Zee1988/homeweave/tree/master/homeweave_app"
arch:
  - amd64
  - aarch64
init: false
image: "ghcr.io/zee1988/homeweave-ha-app"
homeassistant: "2024.1.0"
homeassistant_api: true
ingress: true
ingress_port: 8099
options:
  log_level: info
  ha_url: ""
schema:
  log_level: "list(info|debug|warn)"
  ha_url: "str?"
```

逐项理由（每条都可回溯到上表）：

- `name` / `slug` / `version` / `description` / `arch` —— 5 个必填键，缺任一则 `vol.Required` 失败，仓库识别时该 App 被丢弃。
- `version: "0.1.0"` 加引号：原文明确"Quote it, so YAML does not read `1.10` as a number"。
- `arch` 用 `amd64` + `aarch64`：二者属 `ARCH_ALL`（当前支持），不含 `ARCH_DEPRECATED` 的 `armhf`/`armv7`/`i386`，因此不会触发弃用警告。D-05 校验器的枚举应取这个**更严格**的子集，而非 `ARCH_ALL_COMPAT`。
- `init: false`：Phase 2 将基于 `ghcr.io/home-assistant/base`（S6 overlay v3），原文要求此时设 `false`。
- `image` 不带 tag；大小写问题见 S1，此处按小写 `zee1988` 呈现，**待用户裁决**。
- `homeassistant: "2024.1.0"`：见下节"Minimum HA Version"，此处填入的是保守基线；若用户判定仍需实机验证，可先删掉该行（可选键），由 Phase 7 回填。
- `homeassistant_api: true`：Phase 6 的 HA API 自检需要经 `supervisor/core/api` 访问 Core；**注意官方原文警告：通过代理时应用以 HA 管理员身份行动**，因此该开关同时是一条安全边界，Phase 6 必须在文档中说明。
- `ingress: true` + `ingress_port: 8099`：Phase 5 的 Web UI 端口约定（8099 恰为默认值，见 S3）。
- `options` / `schema`：见下节"schema DSL"。
- 刻意**不写** `watchdog`（D-08）、`panel_title`、`panel_icon`（默认 `mdi:puzzle`，Phase 5 再定图标）、`map`（`/data` 隐式，见 B1）、`apparmor`（默认 `true` 即启用，见 B3）、`ports`（`8124/tcp` 保持注释，Phase 5 决定）。

## Minimum Viable repository.yaml

路径：**仓库根** `repository.yaml`（`find_one_filetype(path, "repository", FILE_SUFFIX_CONFIGURATION)`，非递归，只认根目录）`[VERIFIED: https://raw.githubusercontent.com/home-assistant/supervisor/master/supervisor/store/data.py]`。

```yaml
name: HomeWeave Apps
url: "https://github.com/Zee1988/homeweave"
maintainer: "Zee"
```

字段契约（`[VERIFIED: https://contributors.home-assistant.io/apps/reference/files/]`）：

| 键 | 必需 | 说明 |
|---|---|---|
| `name` | **是** | 仓库名称，显示在 App 商店 |
| `url` | 否 | 仓库主页 |
| `maintainer` | 否 | 维护者及联系方式 |

原文："没有有效的 `repository.yaml`，Supervisor **不会加载该仓库**"。因此 `name` 是唯一硬门槛；`url`/`maintainer` 写上是为了商店可读性与 D-01 的"无占位符"要求。`maintainer` 官方示例写作 `"Jane Doe <jane@example.com>"`，用纯 `Zee` 也合法（无校验）。

> 注：`repository.yaml` 的 schema（`SCHEMA_REPOSITORY_CONFIG`）在 `supervisor/store/` 内，本次**未逐字读取**其必填集合；上表来自官方 files 页。若校验器要做严格键白名单，需再核对一次源码 → `SCHEMA_REPOSITORY_CONFIG` 的必填项 **UNVERIFIED**。

---

## schema DSL Support Required

`schema` 是 Home Assistant 自有的 mini-DSL，**不是 JSON Schema**。类型表与可选性规则 `[VERIFIED: https://contributors.home-assistant.io/apps/guides/options/]`：

本阶段只需要两个构造：

| 需求 | DSL 写法 | 依据 |
|---|---|---|
| `log_level` 为 `info`/`debug`/`warn` 三选一 | `"list(info\|debug\|warn)"` | 类型表原文：`list(a\|b\|c)` → "One of the listed values"，表单控件为 Dropdown |
| `ha_url` 可选字符串、默认空 | `"str?"`，并在 `options` 中写 `ha_url: ""` | 类型表 `str` → "Any text"；原文 "Every key in `schema` is required, unless its type ends with `?`" |

其余规则（校验器实现需要知道，但本阶段不必支持全部）：

- **`?` 是后缀修饰符，不是类型**。原文示例 `api_key: "str?"`；因含 `?`，整串在 YAML 中**必须加引号**，否则 YAML 解析异常。
- **默认值只写在 `options` 里**，`schema` 只承载类型。原文："`options` holds the default values... `schema` holds the type of every option."
- **可选键的最佳实践是"只写进 `schema`、不写进 `options`"**（原文："Leave optional options out of `options`, so they stay unset until the user fills them in."）。
  - ⚠️ 与 D-09 的张力：D-09 要求 `ha_url` "默认空字符串"。若严格遵循官方建议，`ha_url` 应**只出现在 `schema`**，此时它在 `/data/options.json` 中处于 "unset" 状态（键缺席或空值，官方**未明确规定**呈现形式 → **UNVERIFIED**）；若写 `ha_url: ""` 进 `options`，则得到一个明确的空字符串默认值。
  - 两种写法都合法：`""` 满足 `str` 校验（长度 0）。差别在运行时读取语义 —— 空字符串与"键不存在"在 Node 侧必须都能被同等处理为"走 Supervisor 自动发现"。**建议实现时按"取值缺失或为空串均视为未配置"处理，并优先采用 `options: ha_url: ""` 以满足 D-09 的"默认空"表述**（此为建议，最终由用户定）。
- 完整可用的类型集合（供校验器做允许值白名单，本阶段无需全部支持）：`str`、`str(min,max)`、`password`、`bool`、`int`、`int(min,max)`、`float(min,max)`、`email`、`url`、`port`、`match(regex)`、`list(a|b|c)`、`device`、`device(subsystem=tty)`；`?` 可加在任一类型末尾。**官方类型表中不存在 `select`**。
- 结构限制：支持嵌套映射与映射列表，但**列表不能直接嵌套列表**（`SCHEMA_ELEMENT` 源码注释"A list may not directly contain another list"）。
- 校验器最小实现建议：只需断言 (1) `schema` 能按上述语法切分；(2) `schema` 中出现的每个键在 `options` 中有同类型默认值或带 `?`；(3) `options` 中出现的键都在 `schema` 中声明。第 (2)(3) 条能捕获"schema 有键但 options 漏默认"这类用户可感知的错误。

---

## Minimum HA Version

**结论：** 推荐 `homeassistant: "2024.1.0"`，并把它标注为"待实机确认"而非已证实兼容性。理由与证据分层如下。

**本阶段用到的 13 个键中，哪些在 2024.x 时代就已存在？**

| 键 | 判断 | 证据强度 |
|---|---|---|
| `name` / `version` / `slug` / `description` / `arch` / `url` | 早已存在（App/Add-on 机制最初即有的核心键） | **MEDIUM** —— 本次只读取了当前源码，历代 Supervisor 的历史未核对。属训练记忆 → 标 `[ASSUMED]` |
| `init` | 早已存在 | `[ASSUMED]` |
| `image` | 早已存在（预构建镜像机制的基础） | `[ASSUMED]` |
| `homeassistant_api` | 早已存在；**且不是 `hassio_api` 的改名**（见 S4） | 二者在当前 schema 中并列 → `[VERIFIED]` 其"非改名"；历史存在性 `[ASSUMED]` |
| `ingress` / `ingress_port` | ingress 为 2020 年前后引入的长期稳定特性；`ingress_port` 默认 8099 | `[ASSUMED]`（当前 schema 已确认默认值 8099） |
| `options` / `schema` | App 机制最初即有 | `[ASSUMED]` |
| `homeassistant`（最低 Core 版本） | 当前 schema 接受 `vol.Optional(ATTR_HOMEASSISTANT): version_tag` | `[VERIFIED]` 当前存在；**在 2024.x 的 Supervisor 上是否被接受 = UNVERIFIED** |

**一条降低风险的关键性质：** `_SCHEMA_APP_CONFIG` 用 `extra=vol.REMOVE_EXTRA` —— 旧版 Supervisor 遇到它不认识的键（如 `homeassistant`）会**静默移除**，而不是报错 `vol.Invalid`。因此写入 `homeassistant: "2024.1.0"` 在未知旧版本上的最坏后果是"该约束被忽略"，不是"App 无法加载"。这使得加这一行属于低风险 `[VERIFIED: validate.py extra=vol.REMOVE_EXTRA]`。

**推荐值 `2024.1.0` 的证据边界（必须如实标注）：**

- 支持它的：本阶段所用全部键都在当前 schema 中为可选键且带默认值，无一依赖新近引入的机制；`arch` 的 `amd64`/`aarch64` 属 `ARCH_ALL`（非弃用）。
- **不支持它的**：本次**没有**取得任何 2024.x 版本期的官方文档或 Supervisor 源码快照，因此"2024.x 完全支持这套键"是**未被正面验证**的。按缺证规则，不能把"没有反对证据"当作"已证实支持"，也不能据此宣称"支持到某个更低的版本"。
- 唯一能从缺证走向验证的路径是**正面证伪**：在 2024.x 的 HAOS 上添加仓库并尝试安装，粘贴失败输出。本次无 HAOS 环境，故未执行。

**因此：**

1. `homeassistant: "2024.1.0"` 应作为**声明的兼容性下限**写入，而在项目文档与 Phase 7 验收中标明"未在 HAOS 实机验证"（与 CONTEXT `<specifics>` 的"任何'能被 Supervisor 识别'的说法都要标注为未在真实 HAOS 上验证"一致）。
2. 若用户不接受"未验证就声明"，可选做法：Phase 1 先不写 `homeassistant`（可选键），Phase 7 实机验证通过后再回填 —— 但 D-03 已把"先核实再写入"定为决策，因此回填路径本身符合 D-03 的精神。**这是需要用户裁决的一个点：写 `2024.1.0`（保守声明 + 标注未验证）vs 暂不写（零声明）**。
3. **不要**为了显得兼容而调低到 2023.x 或更早：那是在声称本次更无法验证的兼容性，风险对称甚至更大。

---

## Deferred Artifact Cost

问题：`icon.png` / `logo.png` / `DOCS.md` / `CHANGELOG.md` 是否为商店条目渲染的必需件？缺失会坏什么？

**必需性 `[VERIFIED: https://contributors.home-assistant.io/apps/reference/files/]`：**

| 文件 | 必需 | Supervisor 用途 | 缺失后果 |
|---|---|---|---|
| `config.yaml` | **是** | App 配置文件（也接受 `.yml`/`.json`） | 该目录不会被识别为 App |
| `Dockerfile` | 仅本地构建时 | 无 `image` 时用于构建设备侧镜像；有 `image` 则不读 | 无影响（本项目用预构建 `image`） |
| `README.md` | 否 | 商店中的 App **介绍（intro）** | 商店条目无介绍文案，仍可安装 |
| `DOCS.md` | 否 | App 的 **Documentation 标签页** | 该标签页为空 |
| `CHANGELOG.md` | 否 | **有更新可用时**显示的变更内容 | 更新时无变更说明 |
| `icon.png` | 否 | 方形图标 | 无图标（占位/空白） |
| `logo.png` | 否 | App 页面展示的 logo | 详情页无大图 |
| `apparmor.txt` | 否 | 自定义 AppArmor profile，替代默认 | 用 Docker 默认 profile |
| `translations/` | 否 | 选项与端口的本地化名称/描述 | UI 回退到英文（用 `schema` 键名） |

**结论：四件套全部可选，缺失不影响"仓库被识别"与"条目可安装"。** 缺 `DOCS.md` 时详情页 Documentation 入口为空；缺 `icon.png`/`logo.png` 时条目仍渲染但无图；缺 `CHANGELOG.md` 只影响"发现更新时的说明"。

**对 CONTEXT `<deferred>` 的回应：** 那里记录的风险（"缺 `DOCS.md` 时 App 详情页 Documentation 入口为空，若实机验证发现条目因此不可用需在 Phase 7 前回补"）在官方文档层面**已被排除**——渲染与安装都不依赖这些文件。因此推迟到 Phase 7 是安全的，无需在 Phase 1 预置占位文件（预置还违反 D-07 的最小面原则）。唯一值得在 Phase 1 写进计划的是：`translations/en.yaml` 缺省时表单标签会显示 `log_level`/`ha_url` 原始键名，不是错误，Phase 7 再做本地化。

---

## Validation Architecture

### 可被静态证明（无需 HAOS）

| # | 断言 | 手段 | 失败即 |
|---|---|---|---|
| V1 | 两个 YAML 文件语法合法、能被解析为 mapping | `js-yaml` `load()` | 非零退出 |
| V2 | `config.yaml` 含 5 个必填键 `name`/`version`/`slug`/`description`/`arch` | 键存在性 + 类型 | 非零退出 |
| V3 | `repository.yaml` 含 `name`（string） | 同上 | 非零退出 |
| V4 | `version` 是**字符串**且符合版本形态（`"0.1.0"`），非数字 | `typeof === 'string'` + 语义化版本正则；**能捕获 `version: 1.10` 这类 YAML 数字陷阱** | 非零退出 |
| V5 | `arch` 是数组、非空、元素 ∈ {`amd64`,`aarch64`}（D-05 的严格子集，比 Supervisor 的 `ARCH_ALL_COMPAT` 更严） | 集合成员检查 | 非零退出 |
| V6 | `image` 不含 tag（冒号后无 tag 段）且无 `{arch}` 占位符，前缀为 `ghcr.io/` | 正则 | 非零退出 |
| V7 | `image` 与 `slug`/`version` 的一致性：`image` 无 tag ⇒ 无 mismatch 可能，此项退化为"image 无 tag" | 同 V6 | — |
| V8 | 未知键白名单：`config.yaml` 出现的每个键都 ∈ 仓内维护的允许键集合 | 差集检查 | 非零退出（**这条是本阶段最有价值的检查**，因为 Supervisor 会静默丢弃未知键，见 Field Contract 末段） |
| V9 | 布尔键（`init`/`ingress`/`homeassistant_api`）确为 boolean，不是字符串 `"true"` | 类型检查 | 非零退出 |
| V10 | `ingress_port` 为整数且 ∈ 1..65535（或 0） | 类型 + 范围 | 非零退出 |
| V11 | `schema` 中每个键都在 `options` 中有默认值，或该类型以 `?` 结尾；反之 `options` 中每个键都在 `schema` 中声明 | 两组键的差集 | 非零退出 |
| V12 | `schema` 的 `log_level` 恰为 `list(info|debug|warn)`；`ha_url` 恰为可选字符串 | 字符串精确匹配 / `list(...)` 解析 | 非零退出 |
| V13 | 占位符缺席：递归扫描两文件全文，不得出现 `<owner>`、`<repo>`、`<maintainer name or contact>`、`tree/main` | 子串扫描 | 非零退出 |
| V14 | `repository.yaml.url` 与 `config.yaml.url` 的分支段均为 `master`（D-01） | 子串/正则 | 非零退出 |
| V15 | （D-05 排除，见 B2）全仓 `config.yaml` 命中数恰好为 1 | `**/config.*` + 后缀白名单，跳过 `.`* 与 `rootfs` | — |

### 不可静态证明（必须 HAOS 实机 / 官方工具）

| # | 无法证明的事 | 原因 | 归属 |
|---|---|---|---|
| N1 | Supervisor **真的接受**这份 `config.yaml` | `vol.Schema` 的完整语义（`RE_SLUG` 正则、`version_tag`、`docker_image` 的实际校验逻辑）只能由 Supervisor 运行时裁决；本次未逐字读取 `RE_SLUG`/`FILE_SUFFIX_CONFIGURATION` | Phase 7 |
| N2 | 仓库能被添加并在商店**渲染出条目** | 依赖 Supervisor store 流程与网络可达性 | Phase 7 |
| N3 | 安装 / 启动 / 升级 / 卸载全链路 | 需 Docker 镜像（Phase 2）与 HAOS | Phase 7 |
| N4 | `ingress` 面板实际可打开 | Phase 5 才有 UI | Phase 5 |
| N5 | `/data` 跨更新持久化的真实语义 | 官方文档未显式声明（见 B1） | Phase 7 |
| N6 | `homeassistant: "2024.1.0"` 在 2024.x 上生效 | 缺历史证据；按缺证规则不得宣称 | Phase 7 |
| N7 | `watchdog` 失败时的重启/停用行为 | 未取得官方原文（见 B4） | Phase 3 |

### 测试与执行面

| 项目 | 值 |
|---|---|
| 测试框架 | 无（本阶段是仓内第一批可执行文件）。建议用 Node 内置 `node --test`，避免为校验器再引入第二个依赖（D-04 只允许 `js-yaml`） |
| 配置文件 | 无既有测试配置 |
| 快速命令 | `pnpm validate:app` |
| 全量命令 | `pnpm validate:app`（本阶段唯一入口；Phase 2 CI 直接复用） |
| 退出码约定 | 逐项列出失败原因，任一失败即非零退出（CONTEXT 已给建议，采纳） |

**Wave 0 缺口：**

- [ ] `package.json`（仓根最小）+ `"validate:app"` script —— V1..V14 的执行入口
- [ ] `scripts/validate-app-metadata.mjs` —— 上述检查项实现
- [ ] 允许键白名单常量（V8/V11 依赖；对应 D-04"字段清单由仓内维护"的代价）
- [ ] `pnpm install` 引入唯一的 `js-yaml`
- [ ] 若采纳 B2 的选项 B：唯一性断言（V15）

**关键判断：** 本阶段能产出的最高等级结论是"静态检查通过"。**"仓库被 Supervisor 识别""条目可安装"不能被本阶段的任何证据证明** —— 这与 CONTEXT `<specifics>` 的要求一致，必须在 Phase 1 的计划与完成说明中原样保留这句话。

---

## Sources

### Primary（本次实取，HIGH）
- `https://raw.githubusercontent.com/home-assistant/supervisor/master/supervisor/apps/validate.py` —— 必填/可选键、默认值、`extra=vol.REMOVE_EXTRA`、`watchdog` 正则、`ingress_port` 默认 8099
- `https://raw.githubusercontent.com/home-assistant/supervisor/master/supervisor/const.py` —— `ARCH_ALL` / `ARCH_DEPRECATED` / `ARCH_ALL_COMPAT`、`AppBootConfig` / `AppBoot` / `AppStartup` / `AppStage` 枚举原文
- `https://raw.githubusercontent.com/home-assistant/supervisor/master/supervisor/store/data.py` —— `_find_app_configs` 递归 glob 与跳过规则；仓库根 `repository.yaml` 定位
- `https://contributors.home-assistant.io/apps/reference/configuration/` —— 各键语义与允许值、`image` 不带 tag 原文、`/data` "Always mounted read and write"
- `https://contributors.home-assistant.io/apps/reference/files/` —— 文件清单与必需性表、`repository.yaml` 字段必需性
- `https://contributors.home-assistant.io/apps/guides/options/` —— schema DSL 类型表、`?` 后缀规则、`options` 与 `schema` 分工
- `https://developers.home-assistant.io/docs/apps/publishing` —— "without a tag"、"pulls the tag that matches `version`"、mismatch 后果
- `https://github.com/home-assistant/apps-example` + `https://raw.githubusercontent.com/home-assistant/apps-example/main/example/config.yaml` —— 官方示例实际写入的键集合（`name`/`version`/`slug`/`description`/`url`/`arch`/`init`/`map`/`options`/`schema`/`image`，**无 `ingress`、无 `homeassistant_api`、无 `watchdog`、无 `apparmor`**）

### 未取得（仍待核对）
- `SCHEMA_REPOSITORY_CONFIG` 的必填集合（`supervisor/store/`）→ `repository.yaml` 严格键白名单依据
- `RE_SLUG` / `FILE_SUFFIX_CONFIGURATION` / `RE_SCHEMA_ELEMENT` 的字面值（均在 `supervisor/const.py`、`supervisor/apps/options.py`）
- 2024.x 版本期的官方文档或 Supervisor 源码快照（最低版本基线的正面证据）
- `watchdog` 失败后的行为链（unhealthy / 自动重启）

**Confidence breakdown：** 字段契约 HIGH（源码 + 官方参考页双证）；仓库发现 HIGH（源码原文）；schema DSL HIGH（官方类型表原文）；最低 HA 版本 MEDIUM（当前态已证，历史态缺证）；`/data` 持久化语义与 `watchdog` 行为链 LOW/UNVERIFIED。



