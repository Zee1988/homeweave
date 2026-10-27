---
phase: 01-app
reviewed: 2026-10-27T14:28:04Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - homeweave_app/app-metadata.json
  - scripts/generate-app-metadata.mjs
  - scripts/validate-app-metadata.mjs
  - scripts/__tests__/validate-app-metadata.test.mjs
  - scripts/__tests__/fixtures.mjs
  - repository.yaml
  - homeweave_app/config.yaml
  - package.json
findings:
  critical: 0
  high: 3
  medium: 5
  low: 5
  total: 13
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-10-27T14:28:04Z
**Depth:** deep（逐文件通读 + 跨文件调用链 + 在 `%TEMP%` 隔离副本中做 20 余组对抗式变异实测）
**Files Reviewed:** 8（另对照阅读 `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` 的两处编辑）
**Status:** issues_found

## Summary

**当前产物是好的。** 在仓库外的临时副本里跑两次 `generate:app`，产出与已提交的 `homeweave_app/config.yaml`、`repository.yaml` **SHA256 完全相同**；`validate:app` 在当前树 `✓ 58 checks passed`、exit 0；`node --test` 15 个用例全绿。契约 #1/#2/#3 在当前产物上全部成立（字段集与顺序符合最小集、`ports` 仅注释、`image` 无 tag、`version: 0.1.0`、`homeassistant` 回读为字符串、无占位符）。契约 #4 的机制落实到位：脚本无任何 `js-yaml` 引用、逐行字符串拼接、统一 `\n` 与单一尾换行。契约 #5 的绝大部分成立：单入口 ESM、收集式无 fail-fast、退出码只有 0/1、**无 quote-style 断言**（逐行确认；只有 V13 扫原文，那是内容不是引号）、Windows 路径用 `toPosix(relative())` + `sep` 正确。契约 #6 成立：夹具在 `os.tmpdir()` + `t.after(cleanup)` + closing gate 兜底。

问题集中在**「守卫的守卫」这一层**：写出来的检查本身是对的，但有几处**该检查的地方没检查**，且都落在本阶段自己写明的核心失效模式上。最要紧三条：(1) 没有任何代码把「已提交生成物」与「源 JSON 的生成结果」做对比，而 `01-VALIDATION.md:49` 把幂等/零漂移指派给了测试；(2) 校验器的 V6/V9/V10 都包在 `if (has(config, key))` 里，键整段消失时静默通过 —— 实测删掉 `image` 仍 `✓ 53 checks passed`、exit 0；(3) 生成器对源 JSON fail-open，`app` 下未知键静默忽略，改名则抛未捕获 `TypeError` 且此时 `repository.yaml` 已被写过。

critical 计 0：上述问题都还没有在当前提交的产物里造成错误值或数据损失，我不把「缺守卫」写成「已出错」。

## High

### HI-01: 无「生成物 vs 源 JSON」一致性守卫，幂等性零回归测试

**File:** `scripts/generate-app-metadata.mjs:154-173`、`scripts/__tests__/fixtures.mjs:30-36`、`package.json:9-13`、`.planning/phases/01-app/01-VALIDATION.md:49`

**Issue:** `01-VALIDATION.md:49` 把「重复执行产出逐字节一致（幂等、无手改漂移）」列为自动化验证项、命令 `node --test scripts/`；但测试目录从未 import/spawn 生成器（grep 只命中注释），`package.json` 无 check 类脚本，`validate-app-metadata.mjs` 全文不含 `app-metadata.json`。后果链：把源 JSON 的 `version` 改成 `0.1.1` 却忘了重生成 → V4 只校验 `x.y.z` 形状、closing gate 只断言 exit 0 → **全部 73 项检查（58 + 15）依旧全绿**，而镜像 tag 由产物驱动。这正是本阶段的核心失效模式，目前完全靠人工纪律。

**Fix:** 加 `--check` 模式并接进测试/CI：

```js
const CHECK_ONLY = process.argv.includes('--check');
function writeLines(path, lines) {
  const next = lines.join(LINE_END) + LINE_END;
  if (CHECK_ONLY) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current !== next) {
      console.error(`Out of date: ${path} (run \`pnpm generate:app\`)`);
      process.exitCode = 1;
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, 'utf8');
}
```

```json
"check:app": "node scripts/generate-app-metadata.mjs --check",
"test:app": "node scripts/generate-app-metadata.mjs --check && node --test scripts/"
```

### HI-02: 校验器「出现才检查」，必需字段整段缺失时静默通过（删掉 `image` 仍 exit 0）

**File:** `scripts/validate-app-metadata.mjs:30`、`:191-216`、`:219-228`、`:243-266`

**Issue:** `CONFIG_REQUIRED_KEYS` 只有 5 个通用键；`V6`（image）、`V9`（init/ingress/homeassistant_api）、`V10`（ingress_port）全部包在 `if (has(config, key))` 里；V8 按 `01-02-SUMMARY.md:42` 有意「不反向要求 14 个键都存在，必填性由 V2 负责」，但 V2 只要求 5 个 —— 于是必填性实际无人负责。实测：

| 变异 | 结果 |
|---|---|
| 删掉 `image:` | `✓ 53 checks passed`，exit 0 |
| 删掉 `ingress:` + `ingress_port:` | `✓ 54 checks passed`，exit 0 |
| 删掉 `init:` | `✓ 56 checks passed`，exit 0 |
| 删掉 `homeassistant:` | `✓ 57 checks passed`，exit 0 |

无 `image`（或 `build`）的 config.yaml 在 Supervisor 侧装不起来，而本阶段静态层是唯一防线（`docs/21` §11 自己写明「HAOS 未验证」）。

**Fix:** 把必需集提升为精确键集，一次覆盖契约 #1 的存在性与 V8 白名单：

```js
const CONFIG_MINIMAL_KEYS = new Set([
  'name', 'slug', 'version', 'description', 'url', 'arch', 'init', 'image',
  'homeassistant', 'homeassistant_api', 'ingress', 'ingress_port', 'options', 'schema',
]);
if (config) {
  for (const key of CONFIG_MINIMAL_KEYS) {
    check(has(config, key), 'V2', CONFIG_FILE, `missing required key "${key}"`);
  }
  for (const key of Object.keys(config)) {
    check(CONFIG_MINIMAL_KEYS.has(key), 'V2', CONFIG_FILE, `unexpected key "${key}" (contract requires the minimal field set)`);
  }
}
```

### HI-03: 生成器对源 JSON 的输入校验 fail-open —— `app` 下未知/改名键静默忽略

**File:** `scripts/generate-app-metadata.mjs:157-161`、`:102-143`

**Issue:** 只校验了顶层键恰为 `repository, app` 与 `app.image` 小写无 tag，`app` 内部无白名单；`buildConfigYaml` 只按硬编码列表取值。实测：

```
=== 往 app 下加 watchdog / enable_auth
exit=0            # 产物里既无 watchdog 也无 enable_auth
```

真实后果与 HI-01 叠加后无人兜底：把 `commentedPortsComment` 手误成 `commentedPortBlock` → ports 注释块静默消失、exit 0，而注释块被删校验器也不管（见 LO-01）；反方向改名会崩，但崩法不合格 —— `optionDefs.haUrl` → `haURL` 抛出未捕获的 `TypeError: Cannot read properties of undefined (reading 'type')` at `buildSchemaDsl (...:91:13)`，不是脚本自己 `fail()` 的 `Failed: <path>: <message>` 格式，读者拿不到「哪个键错了」。

**Fix:** 在 `main()` 加与产物白名单对称的源键白名单，并给 `buildSchemaDsl` 加显式守卫：

```js
const APP_SOURCE_KEYS = new Set([
  'name', 'slug', 'version', 'description', 'url', 'arch', 'init', 'image',
  'homeassistant', 'homeassistant_api', 'ingress', 'ingress_port',
  'options', 'optionDefs', 'commentedPortsComment', 'commentedPortsBlock',
]);
for (const key of Object.keys(metadata.app)) {
  if (!APP_SOURCE_KEYS.has(key)) {
    fail(SOURCE_PATH, new Error(`app.${key} is not consumed by the generator (add it to buildConfigYaml or delete it)`));
  }
}
// buildSchemaDsl 开头
if (!logLevel) fail(SOURCE_PATH, new Error('app.optionDefs.logLevel is missing'));
if (!haUrl) fail(SOURCE_PATH, new Error('app.optionDefs.haUrl is missing'));
if (!Array.isArray(logLevel.values) || logLevel.values.length === 0) {
  fail(SOURCE_PATH, new Error('app.optionDefs.logLevel.values must be a non-empty list'));
}
```

## Medium

### MD-01: 写入顺序使「崩溃 = 两文件不一致」成为可能

**File:** `scripts/generate-app-metadata.mjs:171-172`

**Issue:** `writeLines(REPOSITORY_YAML_PATH, ...)` 在 `:171` 先落盘，`buildConfigYaml` 在 `:172` 才构建。构建抛错（HI-03 任一路径）时 `repository.yaml` 已被覆盖、`config.yaml` 保持旧内容，仓库进入半更新状态。实测：

```
gen exit = 1
repository.yaml now = "name: HomeWeave Apps CHANGED\n..."   # 已写
config.yaml still old = true                                # 未写
```

**Fix:** 两阶段提交 —— 先全部构建到内存，成功后统一写盘：

```js
const repositoryLines = buildRepositoryYaml(metadata.repository);
const configLines = buildConfigYaml(metadata.app); // 抛错则什么都没写
writeLines(REPOSITORY_YAML_PATH, repositoryLines);
writeLines(CONFIG_YAML_PATH, configLines);
```

### MD-02: `name` / `slug` / `description` / `url` / `homeassistant` 无类型与格式校验

**File:** `scripts/validate-app-metadata.mjs:129-133`、`:243-254`

**Issue:** V4 的注释自己解释了「`1.10` 被解析成数字会静默丢信息」，但同类陷阱只对 `version` 设防。实测以下变异全部 exit 0：

| 变异 | 结果 |
|---|---|
| `slug: HomeWeave bad`（Supervisor `RE_SLUG` 是 `^[a-z0-9-_]+$`） | `✓ 58 checks passed` |
| `name: 12345`（数字） | `✓ 58 checks passed` |
| `homeassistant: 2026.1`（未引号 → float，与 V4 描述的陷阱相同） | `✓ 58 checks passed` |
| `description: [alpha]`（列表） | `✓ 58 checks passed` |

当前生成物都对（`scalar()` 给 `homeassistant` 加了引号），但静态校验是唯一验收层。

**Fix:** 加 V16 类型断言（`url` 可选，出现则必须是字符串）：

```js
for (const key of ['name', 'slug', 'version', 'description', 'url', 'homeassistant']) {
  if (has(config, key)) {
    check(typeof config[key] === 'string' && config[key].trim() !== '', 'V16', CONFIG_FILE,
      `"${key}" must be a non-empty string, got ${describe(config[key])}`);
  }
}
check(/^[a-z0-9][a-z0-9_-]*$/.test(String(config?.slug)), 'V16', CONFIG_FILE,
  `"slug" must match Supervisor's RE_SLUG, got "${config?.slug}"`);
check(/^\d+\.\d+\.\d+$/.test(String(config?.homeassistant)), 'V16', CONFIG_FILE,
  `"homeassistant" must be a quoted x.y.z string, got ${describe(config?.homeassistant)}`);
```

### MD-03: 只有「形状」断言，没有「契约字面值」断言 —— `image` 仓库路径可静默改成任何东西

**File:** `scripts/validate-app-metadata.mjs:191-216`、`:149-162`

**Issue:** V6 只断言 `image` 以 `ghcr.io/` 开头且末段无 tag，V4 只断言 `version` 形状。契约 #2 的确切值（`ghcr.io/zee1988/homeweave-ha-app` / `0.1.0` / `2026.10.0`）在任何自动检查里都不存在。实测：

```
=== image: ghcr.io/somebody-else/totally-different
✓ 58 checks passed    # exit 0
```

风险不在手改产物（会被重生成覆盖），而在**改源 JSON 时的拼写错误**：`ghcr.io/zee1988/homeweave-ha-apl` 会原样进入产物、通过 V6、通过 closing gate，然后在 HAOS 上表现为镜像拉取失败 —— 而 HAOS 在本阶段被明确标记未验证。另外 `config.yaml` 的 `version` 与 `package.json:3` 的 `0.1.0` 是两份独立副本，无一致性检查。

**Fix:** 在读**真实产物**（而非 `fixtures.mjs:36-51` 的镜像副本）的测试里钉死契约字面值：

```js
test('contract: shipped artifacts carry the exact required values', () => {
  const cfg = yaml.load(readFileSync(join(REPO_ROOT, 'homeweave_app/config.yaml'), 'utf8'));
  assert.equal(cfg.image, 'ghcr.io/zee1988/homeweave-ha-app');
  assert.equal(cfg.version, '0.1.0');
  assert.equal(cfg.homeassistant, '2026.10.0');
  assert.equal(cfg.slug, 'homeweave');
});
```

### MD-04: 生成器 `scalar()` 用 denylist 判断引号，可静默产出错误值或不可解析的 YAML

**File:** `scripts/generate-app-metadata.mjs:57-72`

**Issue:** `needsQuotes` 未覆盖若干「行首即语义」的字符。实测（改 `description` → 重生成 → js-yaml 回读）：

| 源值 | 生成的 `description:` 行 | 回读结果 |
|---|---|---|
| `&anchor AI OS` | `description: &anchor AI OS` | **`"AI OS"` —— 静默丢前缀，exit 0** |
| `HomeWeave:` | `description: HomeWeave:` | YAML 解析错误 |
| `[alpha] AI OS` | `description: [alpha] AI OS` | YAML 解析错误 |
| `* HomeWeave notes` | `description: * HomeWeave notes` | YAML 解析错误（alias 名非法） |
| `@HomeWeave` | `description: @HomeWeave` | YAML 解析错误 |

`&` 那一行最危险：**生成器 exit 0、YAML 合法、校验器 58 项全绿，但值被改掉了**。解析错误那几种会被 V1 抓到，但生成器仍「成功」写出坏文件。同一 `scalar()` 也用于 `options` 值。

**Fix:** 反转成 plain-scalar 白名单（与 `scripts/__tests__/fixtures.mjs:59` 的 `PLAIN_SCALAR` 同思路）：

```js
const PLAIN_SCALAR = /^[A-Za-z][A-Za-z0-9 _./@()+-]*$/;
return PLAIN_SCALAR.test(value) ? value : JSON.stringify(value);
```

（白名单覆盖现有全部值，我在临时副本里验证过改完仍是零 diff。）

### MD-05: `engines: node >=20` 与 `node --test "<glob>"` 冲突

**File:** `package.json:6-8`、`package.json:12`（对照 `01-VALIDATION.md:24`）

**Issue:** `node --test` 的 glob 参数支持是 **v21.0.0** 才加入的（官方文档：globs 需要 node v21+）。`package.json` 声明 `>=20`，Node 20 上 `node --test "scripts/**/*.test.mjs"` 会把该字符串当字面路径、找不到文件而失败 —— Phase 2 CI 若按 `engines` 选 Node 20 LTS，门禁会红在「找不到测试文件」而非真实缺陷。旁证：`01-VALIDATION.md:24` 自己写的命令是目录形式 `node --test scripts/`，与 `package.json` 不一致。

**Fix:**
```json
"engines": { "node": ">=22" },
"test:app": "node --test scripts/"
```

## Low

### LO-01: 「`ports` 只以注释存在」只覆盖一半 —— 注释被删掉不会红

**File:** `scripts/validate-app-metadata.mjs:218-228`、`homeweave_app/config.yaml:23-26`

**Issue:** 「活的 `ports:` 键」这一半覆盖得好（实测解开注释 → `✗ V8 ... unknown key "ports"`、exit 1）。但「注释块必须存在」没人管：把 `# ports stays closed ...` 到文件尾整段删掉，实测 `✓ 58 checks passed`、exit 0。D-07 写进产物的警示可静默消失（这也是 HI-03 里 `commentedPortsComment` 拼错能一路过关的原因）。

**Fix:** 加原文断言（内容断言，非 quote-style 断言）：

```js
check(configText.includes('# ports:') && configText.includes('8124/tcp'),
  'V16', CONFIG_FILE, 'the commented-out ports block (D-07) must survive in the generated artifact');
```

### LO-02: `describe()` 让失败消息自相矛盾

**File:** `scripts/validate-app-metadata.mjs:88-92`、`:168`

**Issue:** `describe([])` 返回 `'a list'`，空 `arch` 的报错是 `✗ V5 ... "arch" must be a non-empty list, got a list`。实测确认（`arch: []`）。

**Fix:** `if (Array.isArray(value)) return value.length === 0 ? 'an empty list' : 'a list';`

### LO-03: 负向测试只覆盖 15 个 code 里的 7 个；SUMMARY 表述略超事实

**File:** `scripts/__tests__/validate-app-metadata.test.mjs:64-194`、`01-03-SUMMARY.md:109`

**Issue:** 有负例的是 V2/V5/V6/V8/V11/V13/V15；V1/V3/V4/V9/V10/V12/V14 无负例。我手工实测 V1（重复键）、V4（`version: 1.0`）、V10（`"8099"` 字符串）、V11（options 缺 schema）**都确实会红**，所以这是覆盖缺口而非实现缺陷；但 `01-03-SUMMARY.md:109`「把 V1–V15 从『未被证伪的断言』变成『已证伪的反例』」的措辞强于事实（`:122` 的列举才是准确的）。V9（`ingress: "true"`）与 V14（`url` 指向 `/tree/main`）尤其值得补，二者都对应真实的手误。

**Fix:** 按现有 `assertDetects` 模式补 4 条：V9 `config.ingress = 'true'`、V14 `url = '.../tree/main/homeweave_app'`、V3 `repository.name = ''`、V10 `config.ingress_port = '8099'`。

### LO-04: `fixtures.mjs` 关于测试发现的注释不准确

**File:** `scripts/__tests__/fixtures.mjs:20-21`

**Issue:** 注释称「Only functions are exported -- no `test()` is registered here -- so `node --test scripts/` never treats this module as a test file」。真实原因是**文件名不匹配测试发现规则**（`*.test.mjs` 等），与是否注册 `test()` 无关：若把它改名为 `fixtures-test.mjs`，runner 仍会加载它并报「0 tests」。这条注释会让后来者以为可以把夹具放进任何文件。

**Fix:** 改为「文件名不以 `.test.mjs` 结尾，因此不被 `node --test` 的文件发现规则匹配；请勿改名」。

### LO-05: V15 的 `MAX_DEPTH = 12` 静默截断

**File:** `scripts/validate-app-metadata.mjs:396-400`

**Issue:** 超过 12 层的 `config.yaml` 不会被发现，也不会有任何提示（`if (depth > MAX_DEPTH) return found;`）。当前树最深不过 3 层，风险低，但这是一条静默假阴性通道。

**Fix:** 触顶时 `fail('V15', CONFIG_FILE, \`scan truncated at depth ${MAX_DEPTH} in ${directory}\`)`，或把上限提到 24。

## 已逐项验证通过的部分（供后续阶段参考，勿重复怀疑）

1. **幂等性**：临时副本跑两次 `generate:app`，`config.yaml`(74C90B30…) 与 `repository.yaml`(E1943DF0…) 均与仓库文件字节相同 → 当前零漂移（但无回归守卫，见 HI-01）。
2. **无 `js-yaml.dump()`**：生成器无 `js-yaml` 引用；换行全为显式 `\n`、单一尾换行、无 `---`、列表一律 block style。
3. **校验器读的是生成物**：`CONFIG_PATH`/`REPOSITORY_PATH` 指向 `homeweave_app/config.yaml` 与根 `repository.yaml`，不是源 JSON（这是本阶段约定要核对的点，方向正确）。
4. **无 fail-fast**：`failures` 数组收集、末尾统一输出；一次运行可同时报多条。
5. **退出码只有 0/1**：只用 `process.exitCode = 1`，无 `process.exit(` 调用。
6. **无 quote-style 断言**：测试全部改解析对象后断言退出码与 `✗ <code>`，未断言任何引号字符。
7. **V15 复刻 Supervisor 语义正确**：跳过点开头路径段 + `rootfs`，`node_modules` 豁免有注释说明其只管本地假阳性；`.planning/config.json` 因点目录被正确跳过。
8. **Windows 路径**：`toPosix(relative(ROOT, full))` + `sep` 处理正确，`candidates[0] === CONFIG_FILE` 的等值比较在 win32 下成立（实测 `✓ 58 checks passed`）。
9. **夹具不污染仓库**：全部在 `os.tmpdir()`，`t.after(cleanup)`，并有 closing gate 把「夹具泄漏」变为自动化结论；测试跑完 `git status` 仅剩 `?? .planning/.tmp/`、`?? .planning/state.json`（非本次测试产生）。
10. **安全面**：无硬编码密钥、无 `eval`/`exec`、无 shell 字符串拼接（`spawnSync(process.execPath, [VALIDATOR_PATH], {cwd})` 用 argv 数组）；YAML 解析为只读，唯一写操作在 `%TEMP%`。
11. `docs/21` 两处编辑与产物一致：§5 `ports` 回到注释态（与 `config.yaml:23-26` 一致），§11 新增条目明确标注「HAOS 未验证」并预先声明「Open Web UI 空端口属 S2 已知后果」，不会与 Phase 1 的验收判定冲突。

## 探测记录（可复现）

在 `%TEMP%` 下建两个隔离副本（`hw-review-gen`：生成器 + 源 JSON；`hw-review-val`：校验器 + 产物 + 指向仓库 `node_modules` 的 junction 以便解析 `js-yaml`），对副本做变异后运行真实脚本。**未修改仓库中任何文件。**

- 基线：`hw-review-val` → `✓ 58 checks passed`、exit 0；仓库树 `node --test "scripts/**/*.test.mjs"` → `# pass 15 / # fail 0`。
- C1 `image` 换成别的 owner → exit 0（MD-03）
- C2 `homeassistant: 2026.1` → exit 0（MD-02）
- C3 `slug: HomeWeave bad` → exit 0（MD-02）
- C4 解开 `ports` 注释 → `✗ V8`、exit 1（正确，契约 #1 的另一半成立）
- C5 整段删除 ports 注释块 → exit 0（LO-01）
- C6 `name: 12345` → exit 0（MD-02）
- C7 注入重复 `slug` 键 → `✗ V1 duplicated mapping key`、exit 1（正确）
- D1 `description: [alpha]` → exit 0（MD-02）
- D2 `version: 1.0` → `✗ V4`、exit 1（正确）
- D3 `options` 多一个无 schema 的键 → `✗ V11`、exit 1（正确）
- D4 `ingress_port: "8099"` → `✗ V10`、exit 1（正确）
- D5 `arch: []` → `✗ V5 ... got a list`、exit 1（正确，消息见 LO-02）
- E1 删 `image` / E2 删 `ingress*` / E3 删 `init` / E4 删 `homeassistant` → 全部 exit 0（HI-02）
- 生成器加未知键 `app.watchdog` → exit 0、产物不变（HI-03）
- 生成器改名 `optionDefs.haUrl`→`haURL` → 未捕获 `TypeError` at `:91`（HI-03）
- 生成器同时改 `repository.name` 并破坏 `optionDefs` → `repository.yaml` 已写、`config.yaml` 未写（MD-01）
- 生成器 6 组 `description` 引号探测 → `&anchor` 静默丢前缀；`:`/`[`/`*`/`@` 产出不可解析 YAML（MD-04）

---

_Reviewed: 2026-10-27T14:28:04Z_
_Reviewer: CodeBuddy (gsd-code-reviewer)_
_Depth: deep_

