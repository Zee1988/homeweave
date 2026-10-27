# Phase 1: App 元数据与仓库可识别性 — Pattern Map

**Mapped:** 2026-10-27
**Files analyzed:** 8（5 新增、2 生成、1 待裁决）
**Analogs found:** 4 / 8（2 exact、2 role-match；Node 代码类文件 0 个 analog）

> 前置事实：本仓**没有任何可执行代码** —— `search_file("package.json")` 全仓命中 0，无 `scripts/`、无 lockfile、无 CI、无测试。所有脚本类约定必须**从零建立**，不得伪造先例。唯一相关既有物是 `examples/home-assistant-app/` 下 3 个 `.example` 模板与 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` §4/§5。

## File Classification

| 新增/修改文件 | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `homeweave_app/app-metadata.json` | config（单一数据源） | transform | `examples/home-assistant-app/homeweave_app/config.yaml.example` | role-match |
| `scripts/generate-app-metadata.mjs` | utility | transform（JSON→2 YAML） | 无 | none |
| `repository.yaml`（仓根） | config（生成物） | transform | `examples/home-assistant-app/repository.yaml.example` | exact |
| `homeweave_app/config.yaml` | config（生成物） | transform | `examples/home-assistant-app/homeweave_app/config.yaml.example` | exact |
| `scripts/validate-app-metadata.mjs` | utility（校验器） | file-I/O + transform | 无（行为参照：Supervisor `store/data.py`） | none |
| `package.json`（仓根最小） | config | n/a | 无 | none |
| `pnpm-lock.yaml` | config（锁定） | n/a | 无 | none |
| `examples/home-assistant-app/*.example` | config（规格样本） | n/a | 自身 | 存在，待裁决 |

---

## 1. `homeweave_app/app-metadata.json`（config，transform）

**Analog（role-match）:** `examples/home-assistant-app/homeweave_app/config.yaml.example` 第 1-13 行

```yaml
name: HomeWeave
slug: homeweave
version: "0.1.0"
description: AI Home Operating System for Home Assistant
url: https://github.com/<owner>/<repo>/tree/main/homeweave_app
arch:
  - amd64
  - aarch64
init: false
image: ghcr.io/<owner>/homeweave-ha-app
homeassistant_api: true
ingress: true
ingress_port: 8099
```

**Reuse：** 上述 11 个键的**名称与相对顺序**即元数据源的键序契约；`arch` 两项及顺序；`version: "0.1.0"` 的字符串形态（避免 YAML 读成数字）；`slug: homeweave`。

**Establish（无先例）：**
- JSON 分层（flat 还是 `{"repository":{…},"app":{…}}` 两段）。仓内 `docs/agent-checklist.json`、`docs/openapi.yaml` 是文档产物，非可执行数据源，不能当规范。建议两段，因为本文件同时喂两个不同契约。
- 新增键（模板没有）：`homeassistant: "2026.10.0"`（D-03a）、`options`/`schema`（D-09）。**建议只存语义值**（如枚举数组 `["info","debug","warn"]`、`haUrlDefault: ""`），由生成器拼出 `"list(info|debug|warn)"` / `"str?"` 这类 DSL 串；否则 DSL 字符串会在源里存一遍、在生成物里再出现一遍，违背 D-02 单一来源。

**必须写进 PLAN 的风险：** 数据源 basename **绝不可为 `config`**。Supervisor 用 `path.glob("**/config.*")` 递归发现，`.json` 在 `FILE_SUFFIX_CONFIGURATION` 内（RESEARCH B2，源 `supervisor/store/data.py`）。`app-metadata.json` 的 basename 不匹配 `config.*`，安全；命名成 `config.json` 会当场变成第二个 App。

---

## 2. `scripts/generate-app-metadata.mjs`（utility，transform）

**Analog:** 无。仅可沿用键序契约与书写风格。

**书写风格可继承项**（来自 3 个模板）：
- 2 空格缩进；**不写** `---`；文件末尾单个换行、无多余空行。
- 列表写法 `key:` 换行后 `  - item`（`config.yaml.example` 6-8 行），不用流式 `[a, b]`。
- 注释风格：英文整句、`#` 后一个空格、紧贴所说明块的上方（`config.yaml.example:14`、`Dockerfile.example:1-3`）。模板用散文式注释表达"待办"，**没有任何 `TODO:`/`FIXME:` 机器标记**——不要引入。

**Establish（Wave 0 主要成本）：**

| 约定 | 建议 | 理由 |
|---|---|---|
| 模块系统 | `.mjs` + ESM（`import yaml from 'js-yaml'`） | 与 D-06 的 `.mjs` 一致；`.mjs` 无需 `"type":"module"` 兜底 |
| shebang | **不加** | 唯一入口是 pnpm script；无脚本先例，且当前 OS 为 win32，shebang 徒增 CRLF 风险 |
| 调用 | `"generate:app": "node scripts/generate-app-metadata.mjs"` | 与 `validate:app` 同构 |
| 退出码 | 失败打印 `Failed: <path>: <msg>` 后 `process.exit(1)`；成功 0 | 与校验器约定统一 |
| 输出确定性 | 不写时间戳 / commit hash / 随机值；文件头只写固定来源说明 | 否则 `git diff` 永不为空，D-02 不可审计 |

**必须提前裁决的技术冲突（最易翻车处）**
- 模板 `config.yaml.example` 14-16 行有一段被注释掉的块：
  ```yaml
  # Enable only after HomeWeave's own API authentication and authorization are implemented.
  # ports:
  #   8124/tcp: 8124
  ```
  **`js-yaml.dump()` 无法输出注释**。纯 `dump()` 会丢失这个"D-07 要求保留的 `ports` 注释锚点"。三个解法择一：
  1. **字符串模板生成**（推荐）：逐行拼字符串，注释与键序 100% 可控；
  2. `dump()` + append 静态注释尾块（约定"注释永远在文件末尾"）；
  3. 放弃该注释（最小面，但丢失 D-07 的显式意图）。
- `dump()` 默认引用风格会把 `version: "0.1.0"` 写成 `'0.1.0'`、`ha_url: ""` 写成 `''`，与模板双引号不一致。若要逐字节对齐需 `{ lineWidth: -1, quotingType: '"' }` 并对 `version` 特判，或直接用解法 1。**校验器不得断言引号类型**（单/双引号语义等价），只在 V4 断言"解析后为 string"。

---

## 3. `repository.yaml`（仓根，生成物）

**Analog（exact）:** `examples/home-assistant-app/repository.yaml.example`（全文 3 行）

```yaml
name: HomeWeave Apps
url: https://github.com/<owner>/<repo>
maintainer: <maintainer name or contact>
```

**Reuse：** 键名、键序（`name`→`url`→`maintainer`）、3 行无空行、无注释的极简写法，全部照抄。

**Establish：** 值按 D-01/D-01a 落地 —— `url: https://github.com/Zee1988/homeweave`、`maintainer: Zee`（大写 `Zee1988` 保留，**只有 `image` 走小写**）；`name: HomeWeave Apps` 不变。占位符全消失（V13）。

**位置是硬约束：** `repository.yaml` **只能在仓库根**（`find_one_filetype(path, "repository", …)` 非递归，RESEARCH「Minimum Viable repository.yaml」）。`examples/` 那份因 `.example` 后缀不被识别。

---

## 4. `homeweave_app/config.yaml`（生成物）

**Analog（exact）:** `examples/home-assistant-app/homeweave_app/config.yaml.example`

**键序契约（生成器与校验器共同遵守）：**

```
name → slug → version → description → url → arch → init → image
→ homeassistant → homeassistant_api → ingress → ingress_port
→ options → schema
[注释尾块：ports]
```

依据：`config.yaml.example` 1-13 行为 `name, slug, version, description, url, arch, init, image, homeassistant_api, ingress, ingress_port`；RESEARCH「Minimum Viable config.yaml」块（165-187 行）在同一序列中于 `image` 后插入 `homeassistant`、末尾追加 `options`/`schema`。**两份样本天然同序 ⇒ 这就是唯一规范顺序**，生成器不得另辟顺序（否则每次改动都产生无意义 diff）。

**Reuse：** 上述键序；`arch` 两项；`init: false`；`homeassistant_api: true`；`ingress: true`；`ingress_port: 8099`。

**需修正模板之处：**
- `url`：`tree/main` → `tree/master`（D-01，`main` 会 404）。
- `image`：`ghcr.io/<owner>/…` → `ghcr.io/zee1988/homeweave-ha-app`（全小写，D-01a），**保持不带 tag**（V6）。
- 模板**缺** `homeassistant`（补 `"2026.10.0"`）、`options`/`schema`（补 D-09 两项）。
- 模板**有**但需保持注释的 `ports`（见第 2 节冲突）。

**与 `docs/21` §5 的既有分歧（PLAN 必须处理）：** `docs/21` 第 80-96 行的示例把 `ports:` 写成**未注释**活字段（`8124/tcp: 8124`），且缺 `homeassistant`/`options`/`schema`，与 D-07 冲突。`AGENTS.md` §1 第 6 条要求规格同步。建议 PLAN 排一步最小同步：把 docs/21 §5 示例改为与生成物一致或加"`ports` 默认关闭"标注——只做最小同步，不扩张到 Phase 7 文档工作。

**生成物 vs 提交物（证据：提交）：**
- `docs/21` §4 布局树（48-64 行）把 `repository.yaml` 与 `homeweave_app/config.yaml` 列为仓库常规文件，无 `.example`、无忽略标注。
- `docs/21` §5 第 100 行原文：「先发布镜像 `<version>`，再**提交**包含相同 `version` 的 `config.yaml`」。
- `.planning/config.json` 的 `commit_docs: true` 只约束 `.planning/` 文档，**不是**本结论的依据。
- 推论：生成物入库 ⇒ "源与产物不一致"可被 `git diff` 发现。PLAN 应加一步验收：运行 `pnpm generate:app` 后 `git diff --exit-code` 为空（D-02 唯一可自动化的守护）。

---

## 5. `scripts/validate-app-metadata.mjs`（utility，file-I/O + transform）

**Analog:** 无（仓内零 Node 代码）。可复用的不是代码，而是两条外部契约：

**(a) 递归发现与跳过规则** —— 唯一可"照译"的逻辑，来自 RESEARCH 引用的 `supervisor/store/data.py`：

```python
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

V15 唯一性扫描必须是它的 JS 等价物：递归遍历、跳过**任一路径段**以 `.` 开头者、跳过名为 `rootfs` 的目录、只接受 `.yaml`/`.yml`/`.json`。

**(b) 字段/默认值/枚举表** —— RESEARCH「Field Contract」：5 个必填键；`arch` 取更严子集 `{amd64, aarch64}`；`init` 默认 `true`、`ingress_port` 默认 `8099`、`homeassistant_api` 默认 `false`；`extra=vol.REMOVE_EXTRA` 使未知键被**静默丢弃** ⇒ V8 键白名单是本阶段最有价值的检查（拼错 `ingresss` 能 100% 通过 Supervisor）。

**Establish（从零）：**

| 约定 | 建议取值 |
|---|---|
| 模块系统 | `.mjs` + ESM；依赖仅 `js-yaml`（D-04） |
| 递归遍历 | `node:fs` 的 `readdirSync(dir, { withFileTypes: true })` 手写递归；**不得**引 `globby`/`fast-glob`（违反单依赖约束） |
| 跳过清单 | `.` 开头段 + `rootfs`（与 Supervisor 对齐）+ **`node_modules`**（本地运行防假阳性；Supervisor 扫的是干净克隆，故此偏差须在注释里说明理由） |
| 断言组织 | 收集式 `const failures = []`，每条 push `{ code:'V8', file, message }`，末尾统一打印再置 `process.exitCode = 1`。**不要 fail-fast**（Discretion 要求逐项列出失败原因） |
| 输出格式 | 无先例 → 建议每行 `✗ V8 homeweave_app/config.yaml: unknown key "ingresss"`，全通过打印 `✓ 14 checks passed`；纯文本，不引 reporter |
| 退出码 | 仅 `0` / `1`；Phase 2 CI 只区分零/非零 |
| 占位符检查范围 | 只扫**两个生成物**，不扫全仓 —— 否则 `examples/*.example` 里刻意保留的 `<owner>` 会让 V13 恒失败（见第 7 节） |
| schema↔options 交叉检查 | V11/V12 两组键差集 + DSL 串匹配（`"list(info\|debug\|warn)"`、`"str?"` 精确比对），见 RESEARCH 246 行 |
| 测试 | 建议 `node --test`（避免第二个依赖）。**测试夹具的 `config.yaml` 必须放临时目录（`os.tmpdir()`）或带 `.example` 后缀**，否则 V15 唯一性断言会对自己的夹具报错 |

**check 清单直接照搬 RESEARCH V1–V14**（V15 唯一性按 D-05a 一并实现），不另设计；V8 键白名单常量单独放脚本内常量对象，注释标注"来源：contributors.home-assistant.io 配置参考，须随官方变更核对"。

---

## 6. `package.json`（仓根最小，config）

**Analog:** 无（全仓 0 个 `package.json`）。

**Establish：**
- `"private": true`（不是发布包）、`"name": "homeweave"`、`"version": "0.1.0"`（与 `config.yaml` 的 `version` 同源；注意二者是**两份**值，Phase 1 只能靠约定+V14 类断言约束，不能真做到单一来源 —— 这点须在 PLAN 里如实记录）。
- `scripts`: `"validate:app": "node scripts/validate-app-metadata.mjs"`（D-06 固定入口，Phase 2 CI 直接调用）、`"generate:app": "node scripts/generate-app-metadata.mjs"`。
- `devDependencies`: 仅 `js-yaml`（D-04 明示唯一依赖）。`AGENTS.md` §3 要求"不无故增加依赖；交付时说明新增依赖原因" ⇒ PLAN 的完成汇报里要写这一句理由。
- **不建 `pnpm-workspace.yaml`**：`AGENTS.md` §3 的 pnpm workspaces 约定服务于后续 `apps/*` + `packages/*`，Phase 1 只有仓根一个最小包，提前建 workspace 属超出边界。
- 是否加 `"packageManager"` / `engines.node`：无先例，建议加 `engines.node >= 20`（`node --test` 与 ESM 均需 18+，取 20 更稳），不加 `packageManager`（会把 pnpm 版本钉死在无 CI 的阶段）。
- **CRLF 风险（win32）**：生成 YAML 与 JSON 时必须用 `\n`，不能依赖默认写入；建议 `.gitattributes` 属 Phase 2 范畴，本阶段至少在生成器里显式 `\n`，否则 git 会因行尾产生虚假 diff。

---

## 7. `examples/home-assistant-app/*.example`（是否存在，待裁决）

**现状：** `repository.yaml.example`（3 行占位）、`homeweave_app/config.yaml.example`（13 行 + 3 行 `ports` 注释）、`homeweave_app/Dockerfile.example`（Phase 2 用，本阶段不动）、`README.md`（明确声明"这些是 specification examples，不是可安装发布"）。

**裁决点（PLAN 必须显式选一个，不要默认沉默）：**
- D-01 说「仓库内不得残留 `<owner>` 类占位符」，但 `examples/README.md` 第 5 行又明确「Do not copy placeholder `<owner>/<repo>` values into a release」——即这些占位符是**故意保留的通用样本**。RESEARCH V13 把占位符扫描范围限定在「两文件全文」（即两个生成物），说明研究者按"examples 保留占位"理解。
- 建议（保守、最小面）：**不改 `.example`**，但把 V13 的扫描范围在 PLAN 里写死为两个生成物，并在完成汇报中记录"examples 保留占位是有意的，理由见 examples/README.md"。
- 若用户坚持 D-01 全仓生效：只能做**通用化**处理（保留 `<owner>` 语义）或删除 `.example` 样本，**绝不可**把 `examples/` 下的文件改名为 `config.yaml` —— 那会变成第二个 App（RESEARCH B2）。**任何情况下 `.example` 后缀不能去掉。**

---

## Shared Patterns

### 占位符禁令
**来源：** `examples/home-assistant-app/README.md:5` + CONTEXT D-01
**适用：** `repository.yaml`、`homeweave_app/config.yaml`（及元数据源）
样本原话："Do not copy placeholder `<owner>/<repo>` values into a release." 校验器 V13 落地为子串扫描：`<owner>`、`<repo>`、`<maintainer name or contact>`、`tree/main`。

### `.example` 后缀约定
**来源：** `docs/21` §4 第 66 行 + `examples/README.md:3` + RESEARCH B2
**适用：** 一切"非发布态"的 App 元数据样本、测试夹具
doc 原文：「示例文件使用 `.example` 后缀，防止规格文档本身被误当作可安装仓库。」机制不是层级而是后缀白名单（`Path.suffix` 为 `.example` 不在 `FILE_SUFFIX_CONFIGURATION` 内）。

### YAML 书写风格
**来源：** `config.yaml.example` / `repository.yaml.example`
2 空格缩进、无 `---`、列表为 `  - item`、末尾单换行、英文整句注释置于块上方。生成器必须复刻，否则每次生成都产生风格 diff。

### 生成物入库 + 幂等
**来源：** `docs/21` §4 布局树与 §5 第 100 行「再提交包含相同 `version` 的 `config.yaml`」
**适用：** `repository.yaml`、`homeweave_app/config.yaml`
验收方式：`pnpm generate:app` 后 `git diff --exit-code` 为空。

### 退出码与失败呈现
**来源：** RESEARCH「测试与执行面」（CONTEXT Discretion 已采纳）
`0` 成功 / `1` 失败；逐项列出失败原因，非 fail-fast。两个脚本共用同一约定。

### 文档-实现同步
**来源：** `AGENTS.md` §1 第 6 条「修改 API、DB、工具、权限或环境变量时同步更新相关 docs」
**适用：** `docs/21` §5 的 `ports` 分歧必须在本阶段显式处理（见第 4 节）。

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `scripts/validate-app-metadata.mjs` | utility | file-I/O + transform | 全仓零 Node 代码、零测试框架 |
| `scripts/generate-app-metadata.mjs` | utility | transform | 同上 |
| `package.json` | config | n/a | 全仓 0 个 `package.json` |
| `pnpm-lock.yaml` | config | n/a | 无包管理器产物先例 |

planner 对这 4 个文件应直接采用本文件第 2/5/6 节的"Establish"表，**不要**在 RESEARCH.md 里另找代码范式（RESEARCH 只给字段契约与检查清单，没有代码）。

## Metadata

**Analog search scope：** 仓根、`examples/home-assistant-app/`（含 `homeweave_app/`）、`docs/`（仅 `docs/21` 与 `docs/` 文件名清单）、`AGENTS.md`、`.planning/config.json`
**Files scanned：** 10（`01-CONTEXT.md`、`01-RESEARCH.md`、`repository.yaml.example`、`config.yaml.example`、`Dockerfile.example`、`examples/README.md`、`AGENTS.md`、`docs/21`、`.planning/config.json`、`search_file` 全仓 package.json 扫描）
**Pattern extraction date：** 2026-10-27

