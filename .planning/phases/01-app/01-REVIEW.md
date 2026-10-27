---
phase: 01-app
reviewed: 2026-10-27T07:33:57Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - scripts/validate-app-metadata.mjs
  - scripts/generate-app-metadata.mjs
  - scripts/__tests__/validate-app-metadata.test.mjs
  - scripts/__tests__/generate-app-metadata.test.mjs
  - scripts/__tests__/fixtures.mjs
  - package.json
  - homeweave_app/config.yaml
  - repository.yaml
findings:
  critical: 0
  high: 1
  medium: 3
  low: 5
  total: 9
status: issues_found
---

# Phase 01: Code Review Report（缺口收口轮，`d48eea3..HEAD`）

**Reviewed:** 2026-10-27T07:33:57Z
**Depth:** deep（逐文件通读 diff + 在 `%TEMP%` 隔离副本中跑 4 轮对抗探针、40 余次真实进程调用；工作树未修改）
**Files Reviewed:** 8
**Status:** issues_found

## Gap closure assessment

**两条阻塞缺口已真实关闭 —— 不是「加了代码」，而是「变异会被抓住」。** 每条结论都有独立可复现的证据。

| 项 | 判定 | 证据 |
|---|---|---|
| **HI-02 / GAP-1**（必需键无条件化） | **已关闭** | 在临时树里文本级逐键删除真实 `config.yaml` 的 14 个键（保留注释块以排除 V18 污染）：14/14 均 `exit=1` 且 stdout 含 `✗ V2 ... missing required key "<key>"`。原缺口点名的最小反例 `ingress`+`ingress_port` 同时删除 → `77 checks run, 2 failed`，两条独立 V2。`validate-app-metadata.mjs:163-167` 的 V2 是无条件 `check()`；V4/V5/V6/V9/V10/V11/V16/V17 里残留的 `if (has(...))` 逐条核对后都是值检查而非存在性检查，不构成缺口。 |
| **HI-01 / GAP-2**（drift guard） | **已关闭** | 副本中源 `version` 改 `0.1.9` 不重生成 → `--check` `exit=1`，报文 `Out of date: homeweave_app/config.yaml ... first difference at line 4: expected "version: \"0.1.9\"", found "version: \"0.1.0\""`；`repository.yaml` 单侧漂移、`commentedPortsComment` 文本漂移同样被抓。**链路另做验证**：仓库副本放进 `%TEMP%`、制造 drift 后跑 `corepack pnpm test:app`，`&&` 短路，`node --test` 未执行，整体 `exit=1`。`--check` 只读性实测：drift 树跑完后两产物 SHA256 不变、目录无新增文件、缺失产物未被创建。 |
| **HI-03**（未知键 fail closed） | **部分关闭 → 降级为 MD-06 / MD-07** | 顶层 `app`/`repository` 的未知键确实变成 `Failed: <source>: app.watchdog is not consumed ...`，且写盘前中止（sentinel 存活）。（a）同一处抛出在另外三种输入下退回**原始堆栈**（MD-06）；（b）`assertConsumedKeys` 只查一层，`optionDefs.*` 内部死字段/未知键依然静默，而真实源 JSON 里就带着两个从不被消费的字段（MD-07）。 |
| **MD-04**（`scalar()` 白名单） | **已关闭**（残余一类见 MD-08） | 真实源每个值都原样往返（`name/slug/version/description/url/image/homeassistant` 回读为 string，`arch` 为 array，两个 flag 为 boolean，`ingress_port` 为 number）；`&anchor AI OS`、`HomeWeave:`、`[alpha]`、`* star`、`@at`、前导/尾随空格 7 例全部引号化且回读一致；`value.trim() === value` 守卫确有载荷。 |
| **MD-05**（`engines.node`） | **已关闭** | `package.json:7` 为 `>=22`，覆盖用到的 `Object.hasOwn`、`structuredClone`、`t.after` 与 `node --test "<glob>"`（Node 22 起 glob 才稳定），无更严要求被漏掉。 |

四个附加提问的直接回答（不混入发现列表）：

1. **fixture 盲区（Q2）**：没有。`fixtures.mjs:131` 与 `:146` 是仅有的两条写 `homeweave_app/config.yaml` 的路径，都经过 `withPortsComment()`。`writeExtraConfig()`（`:157-159`）不带尾块是正当的：它只写 V15 夹具（`nested/config.yaml` 造第二份 app；`.hidden/`、`rootfs/` 被扫描器跳过），而 V18 只读 `texts.get(CONFIG_FILE)`，额外文件的注释块从不参与断言；53 例全绿反证这一点（若跳过名单翻转，V15 的 exit-0 用例会红）。
2. **假绿风险（Q3）**：负例都是「exit 1 + 具体码 + 消息点名该键」三件套，没有只断言 exit code 的用例；`assertDetects()`（`validate-app-metadata.test.mjs:40-48`）还先断言 `status !== null`。唯一永不可能失败的断言在生成器测试里（LO-08）；HI-03 的「无堆栈」断言存在覆盖盲区（MD-06）。
3. **drift guard 完整性（Q4）**：`--check` 绝不写盘/建目录（`generate-app-metadata.mjs:266-281` 的 CHECK_ONLY 分支读完即 `return`，`mkdirSync`/`writeFileSync` 在该分支不可达，实测确认）。CRLF 归一**足够窄**：只折叠 `\r\n` → `\n`，单独 `\r` 与任何其它字节差异照旧触发；「整树 CRLF + 一处真实删行」仍 `exit=1`，纯 CRLF 检出 `exit=0`。前提也核实过：`core.autocrlf=true`、无 `.gitattributes`、索引 blob 无 CR，这条归一不是为假想环境写的补丁。
4. **回归（Q6）**：无。`d48eea3..HEAD` 的测试目录 diff 只删了一行注释与两行 fixture 写盘调用，无用例被删除或降级；真实树 `✓ 81 checks passed`（原 58），`node --test` 53 例全绿（原 15 + 新增 38）。

---

## High

### HI-04: `repository.yaml` 没有逐键必需/类型守卫，`maintainer: 42` 能让三道门全绿

**File:** `scripts/validate-app-metadata.mjs:169-178`（V3 是该文件唯一的 repository 断言）、`scripts/generate-app-metadata.mjs:176-180`

**Evidence（实测）：** V2 把 `config.yaml` 的 14 个键无条件化了，但同批交付的另一份**生成物** `repository.yaml` 只有一条 V3（`name` 非空字符串）；`url`、`maintainer` 既无存在性断言也无类型断言，而 `assertConsumedKeys('repository', ...)` 只保证**源 JSON** 里有这三个键，不保证值可用。

```
maintainer: null      validate exit=0  (clean)
url: true             validate exit=0  (clean)
maintainer 整行删除    validate exit=0  (clean)
name: null            validate exit=1  ✗ V3 ... "name" must be a non-empty string, got null

# 从源头注入同样的缺陷（源 JSON repository.maintainer = 42）：
generate:app  exit=0   # 写出 maintainer: 42
check:app     exit=0   # 与源一致，无漂移
validate:app  exit=0   # V3 只查 name
```

**Why it matters:** 这是一条「三道门同时全绿却产出坏产物」的完整路径：改源 → 重生成 → CI 绿 → `repository.yaml` 的 `maintainer` 是整数（或 `url` 是布尔、或整键缺失）。`repository.yaml` 是**整个仓库清单**，一份坏的会让 add-on store 里**所有 app 都不出现**，影响面比单个 app 更大；而 `validate-app-metadata.mjs:12` 自述「Phase 2 CI calls exactly this」，CI 若只跑 `validate:app`，这条路径无人拦。这就是 HI-02/GAP-1 的同一失效类在另一个文件上的残留（注意 `REPOSITORY_ALLOWED_KEYS`（`:62`）已把三个键都当作仓库契约，V8 能拒绝多余的键，却不能要求缺失的键或正确类型 —— 与 GAP-1 修复前的 `config.yaml` 完全同构）。

**Fix:** 与 `CONFIG_REQUIRED_KEYS` 同构，做成无条件、逐键、独立码，并补类型断言：

```js
const REPOSITORY_REQUIRED_KEYS = [...REPOSITORY_ALLOWED_KEYS];

if (repository) {
  for (const key of REPOSITORY_REQUIRED_KEYS) {
    check(has(repository, key), 'V19', REPOSITORY_FILE, `missing required key "${key}"`);
  }
  for (const key of REPOSITORY_REQUIRED_KEYS) {
    if (!has(repository, key)) continue;   // 存在性归上一条，避免同一缺陷报两次
    check(
      typeof repository[key] === 'string' && repository[key].trim() !== '',
      'V19', REPOSITORY_FILE,
      `"${key}" must parse as a non-empty string, got ${describe(repository[key])}`,
    );
  }
}
```

源侧也要 fail closed（`buildRepositoryYaml()` 里加 `assertNonEmptyString(\`repository.${key}\`, ...)`），让坏源在写盘前停下。配套测试：三个键各一条删除、一条 `null`、一条数字，断言 `✗ V19 ` 且消息点名该键。

---

## Medium

### MD-06: `assertConsumedKeys()` 的抛出落在 `Failed:` 格式化器之外，三种输入退回原始堆栈

**File:** `scripts/generate-app-metadata.mjs:360-361`（调用点在 `try` 之外）、`:331-344`、`:349`；对照 `:373-380`（`try` 块）与 `:144-148`（文件自述契约）

**Evidence（实测）：** 文件在 `:145-148` 写下契约「Every one of these throws (main turns the throw into `Failed: <path>: …`)」，HI-03 的验收标准是「formatted message, no stack at all」。但 `assertConsumedKeys` 的两个调用点在 `try` **外**，`assertObject`/`Object.keys` 的抛出直接逃出 `main()`：

```
app: null          -> exit=1
  Error: app must be an object; got null
      at assertObject (...:154:11)
      at assertConsumedKeys (...:332:3)
      at main (...:361:3)

repository: null   -> exit=1   （堆栈指向 main:360）

源文件内容为 null  -> exit=1
  TypeError: Cannot convert undefined or null to object
      at Function.keys (<anonymous>)
      at main (...:349:31)
```

`test('a renamed optionDefs entry fails with a formatted message, not a stack trace')`（`generate-app-metadata.test.mjs:252-270`）用 `assert.doesNotMatch(output, /TypeError/)`、`/at buildSchemaDsl/`、`/\n\s+at /` 把 HI-03 标成「已证明」，但它只走 `try` 里那条路 —— **测试绿而缺陷在**。

**Why it matters:** 退出码仍是 1、也仍在写盘前中止，fail-closed 未破，所以不是 BLOCKER；但（a）报错形状取决于作者错在哪一层，排障成本不一致；（b）一条测试把这个子问题标成已覆盖，会让后续 review 不再看这里 —— 这正是本阶段最怕的假绿。（`app: null` 在 diff 之前也会抛 `TypeError`，不是新引入的退化，但属于新代码声称已修而未修的部分。）

**Fix:** 让 `main()` 只有一个格式化出口：

```js
function main() {
  try {
    const metadata = readSource();
    ...                             // 原本 try 里那段可以合并进来
  } catch (error) {
    fail(SOURCE_PATH, error);       // fail() 自带 process.exit(1)
  }
}
```

`fail()` 已用 `error instanceof Error ? error.message : String(error)`，因此 `assertObject` 的消息会自动变成 `Failed: <源路径>: app must be an object; got null`，无需改 `assertObject`。另在 `readSource()` 里断言解析结果是对象，消掉 `:349` 的 `TypeError`：

```js
const parsed = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
  throw new Error(`source must be a JSON object; got ${parsed === null ? 'null' : typeof parsed}`);
}
```

测试补 3 例（`app: null`、`repository: null`、源文件为 `null`），每例断言 `^Failed: ` 且 `doesNotMatch(/\n\s+at /)`、`doesNotMatch(/TypeError/)`。

### MD-07: `app.optionDefs.*.default` 真实存在却从不被消费；`assertConsumedKeys` 只查一层，嵌套未知键照样静默

**File:** `scripts/generate-app-metadata.mjs:331-344`（单层 `Object.keys`）、`:184-207`（`buildSchemaDsl` 只读 `type`/`values`/`optional`）、`homeweave_app/app-metadata.json:35` 与 `:40`（两处 `default`）

**Evidence（实测）：** HI-03 的原话是「a key the builder never read … was silently dropped: `app.watchdog = true` produced exit 0 and an artifact with no watchdog in it」。把同一个变异下沉一层：

```
optionDefs.logLevel.default = 'warn'        generate exit=0   --check exit=0
optionDefs.haUrl.default    = 'http://…'    generate exit=0   --check exit=0
optionDefs.logLevel.foo     = 'bar'         generate exit=0   （未知嵌套键，静默）
产物回读 options.log_level === "info"       （default 的编辑零效果）
```

`default` 这两个字段**现在就真实存在于源 JSON 中**且从不被读：写进 `config.yaml` 的默认值来自 `app.options.log_level`（`generate-app-metadata.mjs:236-239`）。于是同一事实在源里表达两次（`app.options.log_level` 与 `app.optionDefs.logLevel.default`），**没有任何检查要求二者一致**——把 `default` 改成 `warn` 期待默认值跟着变，得到的是「跑成功了、什么都没变」。

**Why it matters:** 单源设计的全部价值就是「源被应用」。一个显式存在、名叫 `default`、改起来毫无效果的字段，比未知键更容易误导（未知键至少会报 `not consumed`）。它同时是 `assertConsumedKeys` 那句「Both directions matter」的反例：它只覆盖 section 的第一层。

**Fix:** 二选一，不能留现状。

1. **消费它**：让 `options` 的默认值由 `optionDefs` 派生，源里只保留一份事实，并断言一致：

```js
// buildSchemaDsl 之外新增一个 buildOptions(app)，default 与 options 不一致就 fail()
if (app.optionDefs.logLevel.default !== app.options.log_level) {
  throw new Error('app.options.log_level must equal app.optionDefs.logLevel.default (single source of truth)');
}
```

2. **删掉它**：从 `app-metadata.json` 移除两个 `default`（自述字段名 `impliedDefault`/不存在的键都不如直接删）并在注释里写明默认值唯一来源是 `app.options`。

无论选哪条，都把 `assertConsumedKeys` 变成可递归的检查，覆盖 `optionDefs.<name>` 这一层：

```js
assertConsumedKeys('app.optionDefs', app.optionDefs, ['logLevel', 'haUrl']);
assertConsumedKeys('app.optionDefs.logLevel', app.optionDefs.logLevel, ['type', 'values']);   // 不含 default
assertConsumedKeys('app.optionDefs.haUrl', app.optionDefs.haUrl, ['type', 'optional']);
```

这样 `optionDefs.logLevel.foo` 会变成 `Failed: ... app.optionDefs.logLevel.foo is not consumed`，与顶层行为一致。

### MD-08: `scalar()` 的正白名单仍会静默改变值：`null`/`Null`/`true`/`false` 与 YAML 1.1 的 `yes`/`no`/`on`/`off`

**File:** `scripts/generate-app-metadata.mjs:128-138`

**Evidence（实测，逐值生成真实产物再回读）：**

```
description="null"   emitted="description: null"   parsedBack=null    typeof=object   <<< BROKEN
description="Null"   emitted="description: Null"   parsedBack=null    typeof=object   <<< BROKEN
description="true"   emitted="description: true"   parsedBack=true    typeof=boolean  <<< BROKEN
description="false"  emitted="description: false"  parsedBack=false   typeof=boolean  <<< BROKEN
description="yes"/"no"/"on"/"off"  emitted 裸标量, js-yaml 4 回读为 string（YAML 1.2），但 PyYAML（YAML 1.1）回读为 bool
```

`PLAIN_SCALAR = /^[A-Za-z][A-Za-z0-9 _./@()+-]*$/` 允许这些词以首字母开头，`value.trim() === value` 也成立，于是它们被裸着写出 —— 与 MD-04 修掉的 `&anchor` 是**同一个失效类**：字符级白名单解决不了「解析器会重新解释的单词」。现有值不受影响（真实源全部往返正确，见上表 MD-04 一行），但这意味着 `scalar()` 的断言式承诺「不改变值」并不成立。

**Why it matters:** 分两层看，第一层已兜住、第二层没有：

- `config.yaml` 侧：`null`/`true` 会被 V16 抓住（实测 `description: null` → `validate exit=1 ✗ V16 ... got null`），但那是**另一道门**，`generate:app` 与 `check:app` 都是绿的；
- `repository.yaml` 侧**没有任何类型网**（HI-04）：`maintainer: "null"`、`url: "true"` 可以一路绿到底；
- YAML 1.1 分歧是结构性的：`name: yes` 实测 `generate exit=0` + `validate exit=0`（js-yaml 4 读成字符串），而 Supervisor 侧（PyYAML 系）读成 `True` → app 装不上，而三道门全绿。

**Fix:** 在裸标量判定里显式排除「会被解析成非字符串」的词，并把这条规则做成可测的属性：

```js
// YAML 1.1/1.2 都会把这些词解析成非字符串；裸写等于改值
const RESERVED_WORDS = /^(?:~|null|true|false|yes|no|on|off|y|n)$/i;

function scalar(value) {
  ...
  if (value.trim() === value && PLAIN_SCALAR.test(value) && !RESERVED_WORDS.test(value)) return value;
  return JSON.stringify(value);
}
```

再加一条不依赖具体词的守卫测试：对 `['null','Null','true','false','yes','no','on','off','~']` 逐个生成并回读，断言 `typeof parsed === 'string'` 且严格等于输入。`~` 目前落在白名单外（`~` 不在字符类里），保留在列表里是为了让规则集完整。

---

## Low

### LO-06: 注释行是不转义的原始插值，源里一个 `\n` 就能造出活键

**File:** `scripts/generate-app-metadata.mjs:250-255`（`lines.push(\`# ${comment}\`)`）、`:165-174`（`assertStringList` 不拒绝换行）

**Evidence（实测）：** `scalar()` 给普通值加了引号转义，但两个注释循环是裸插值，`assertStringList` 只校验「非空字符串」。源里 `commentedPortsComment = ['note\nimage: ghcr.io/evil/x']` 产出：

```
# note
image: ghcr.io/evil/x          <- 活键
```

`generate:app exit=0`，`--check exit=0`（与生成器自身输出一致，无漂移），只有 `validate:app` 兜住：`✗ V1 ... duplicated mapping key (25:1)`；换成未占用的键则是 `✗ V8 unknown key "ports"`。

**Why it matters:** 目前两类注入都被下游抓住，所以是 Low 而不是更高：注入已存在的键 → 重复键 → V1；注入不存在的键 → V8。但这层保护是**偶然**的（依赖「14 个键都已存在」这个当前事实），而且新增的 drift guard 对此天生失明。文件里已有「字符串会被 `for...of` 拆成单字符注释」的先例说明，换行只是同一问题的另一面。

**Fix:** 在 `assertStringList` 里拒绝控制字符，把不变量放在离数据最近的地方：

```js
for (const item of value) {
  if (typeof item !== 'string' || item === '') throw new Error(`${keyPath} entries must be non-empty strings; got ${JSON.stringify(item)}`);
  if (/[\r\n]/.test(item)) throw new Error(`${keyPath} entries must be single-line (they are emitted as raw comment lines); got ${JSON.stringify(item)}`);
}
```

### LO-07: 同一个缺陷被报三次，与文件自述的「一缺陷一失败」纪律冲突

**File:** `scripts/validate-app-metadata.mjs:431`（`STRING_FIELDS` 含 `version`）、`:183-196`（V4）、`:442-471`（V16）、`:480-490`（V17）

**Evidence（实测）：** 把 `version` 写成未加引号的 `1.0`（**一个**缺陷）：

```
✗ V4 ... "version" must be a string, got number
✗ V16 ... "version" must parse as a non-empty string, got number
✗ V17 ... "version" must be exactly "0.1.0" ..., got number "1"
```

`slug: HomeWeave` 也是 V16 + V17 两条。而 `:158-162` 明确写下「Do not re-add a presence assertion inside those blocks -- one missing key would then be reported twice」，`:479` 也声明 `has()` 只为「避免同一缺失键报两次」。

**Why it matters:** 只影响报文噪声，不影响检出能力（三条都指向同一个键，排障仍可定位）。但它让「一缺陷一失败」这条被写进注释的纪律在 V16/V17 引入后不再成立，后续很难判断重复报文是设计还是回归。

**Fix:** `STRING_FIELDS` 去掉 `version`（V4 拥有它）：

```js
const STRING_FIELDS = ['name', 'slug', 'description', 'url', 'homeassistant'];
```

V16/V17 的重叠是契约检查的固有层叠，保留即可 —— 但要在 `:473-479` 的注释里写明「V17 与 V16 有意层叠：同一个键可能同时报出格式错与契约错」，让这条重复变成显式约定。

### LO-08: 生成器测试里有一处永不可能失败的断言

**File:** `scripts/__tests__/generate-app-metadata.test.mjs:210`

**Issue:** `assert.doesNotMatch(output, /checks passed/, output)` —— `checks passed` 是**校验器**的措辞（`validate-app-metadata.mjs:587`），生成器全文不产出这个字符串，所以这条断言恒真。它看起来在证明「`--check` 不谎报零漂移」，实际什么也没证明。

**Fix:** 换成生成器可能真的说错的话，或者删掉（同一条用例已有 `assert.match(output, /^Failed: /m)` 提供实质保证）：

```js
assert.doesNotMatch(output, /Out of date/, 'a broken source must not be reported as drift');
```

同一用例里 `assert.equal(result.status, 1)` 已覆盖退出码，补一条「不得出现 `Out of date`」才对应注释里「must not silently report zero drift」的意图。

### LO-09: `missingImage` 变量名与实际条件相反

**File:** `scripts/generate-app-metadata.mjs:363-366`

**Issue:**

```js
const missingImage = typeof metadata.app.image === 'string' && metadata.app.image !== metadata.app.image.toLowerCase();
if (missingImage) fail(SOURCE_PATH, new Error('app.image must be lowercase ...'));
```

条件为真时 image **存在且含大写**，变量名读作「image 缺失」。这个文件的其他每一处命名都精确到可以直接当文档读（`assertConsumedKeys`、`describeDrift`、`normaliseLineEndings`），这里是个例外；下一次改这段代码的人需要多花一次往返才能确认。

**Fix:** `const imageHasUppercase = ...`，并顺手合并下一条 `includes(':')` 判断（同属 image 形状检查）。

### LO-10: `withPortsComment` 被导出但没有任何 import

**File:** `scripts/__tests__/fixtures.mjs:116`

**Issue:** 全仓库 grep 只有 `fixtures.mjs` 内部两处调用（`:131`、`:146`），没有任何测试文件 import 它。`fixtures.mjs` 的注释明确「Both writers … go through here, so a future helper cannot forget the block」——这个不变量靠的是**两个调用点**，不是导出。多余的导出会让人以为别处还有第三个组装路径，也让「唯一组装点」这句话显得可疑。

**Fix:** 去掉 `export`，保持模块内部函数；若确实想让测试能直接构造带尾块的基线，则补一条用例去用它（例如断言 `withPortsComment(toYaml(VALID_CONFIG))` 与真实 `config.yaml` 的尾部逐字节一致），否则导出就是死码。

---

## 复核方法与可复现命令

所有负向探针都在 `%TEMP%` 的独立副本中进行，仓库工作树未被修改（唯一改动是本文档）。

```powershell
cd d:/workSpace/HomeWeave/homeweave
corepack pnpm generate:app    # exit 0，产物与提交内容零差异
corepack pnpm check:app       # exit 0，无 drift
corepack pnpm validate:app    # ✓ 81 checks passed
corepack pnpm test:app        # 53 tests / 53 pass / 0 fail
git status --porcelain        # 仅 .planning/ 状态文件与本文档
```

交叉验证过的外部事实：`git config --get core.autocrlf` → `true`，无 `.gitattributes`，`HEAD:homeweave_app/config.yaml` 的 blob 不含 CR（支撑 `normaliseLineEndings()` 的存在理由与窄度）。

---

_Reviewed: 2026-10-27T07:33:57Z_
_Reviewer: CodeBuddy (gsd-code-reviewer)_
_Depth: deep_

## REVIEW COMPLETE

---

# 第三轮评审

## Round 3 — plan 01-06（HI-04 closure）

**结论：** ISSUES FOUND（无 BLOCKER / HIGH；HI-04 本身已真实闭合，遗留 1 条 MEDIUM 属新守卫的**测试覆盖**缺陷，2 条 LOW）

**范围：** `66ec59b~1..HEAD`，4 个源码文件（`+306 / −2`）。只审本轮新增的 V19 守卫、`assertNonEmptyString()` 与配套 11 条用例；01-04 / 01-05 已通过的结论未重审。

**计数复核（纯静态 + 差分核算，不重复实跑）：** `81 + 6 = 87` checks（3 条无条件存在性 + 3 条类型，干净树全跑满）；`53 + 11 = 64` 例（校验器 8 + 生成器 3）。两个实现文件的 diff 为**纯新增**（0 删除），两个测试文件仅有的 2 行删除就是 `b71f7f7` 改写的 CRLF `writeFileSync` 行 —— 因此不存在「合并两条 test 凑数」或「删掉既有 check」的空间。`# pass === # tests` 之外另核：两个测试文件无 `test.skip` / `test.only` / `t.skip` / `describe.`，表驱动循环（`REPOSITORY_SOURCE_FAILURES`，2 项）无条件注册。

| # | severity | 位置 | 问题 | 最小复现 | 建议 |
|---|---|---|---|---|---|
| R3-01 | MEDIUM | `scripts/generate-app-metadata.mjs:202-204` + `scripts/__tests__/generate-app-metadata.test.mjs:288-303` | 三个新断言调用点里**只有 `maintainer` 有行为用例**。删掉 `assertNonEmptyString('repository.name', …)` 或 `assertNonEmptyString('repository.url', …)`，`test:app` 仍 64/64 全绿 | 临时副本中删掉 url 那行 → `# tests 64 / # pass 64 / # fail 0`，exit 0；删 name 那行同样全绿；只有删 maintainer 那行才 → `# pass 62 / # fail 2` | 表驱动里补两条：`['empty name', s => { s.repository.name = ''; }, /repository\.name must be a non-empty string/]` 与 `['numeric url', s => { s.repository.url = 42; }, /repository\.url must be a non-empty string/]` |
| R3-02 | LOW | `scripts/validate-app-metadata.mjs:204-206`、`:208` | V19 注释两处与代码不符：(a)「keeps the total check count from depending on which key happens to be missing」——实际总数 = 3 + 存在键数，删键会让 `checksRun` 变小；(b)「V3 stays untouched **below** this block」——V3 在该块**上方**（178-187 行） | 删 `url` 行 → `85 checks run, 1 failed`；删 `url`+`maintainer` → `83 checks run, 2 failed`；干净树 → `87 checks passed` | (a) 改成「keeps **the failure count** at one per missing key, instead of two」；(b) 把 `below` 改 `above` |
| R3-03 | LOW | `scripts/validate-app-metadata.mjs:226-231`（V19 类型循环）+ `:455-471`（V14） | `url` 只判「非空字符串」，无任何形状校验：一个拼错的 url 能让 87 条检查全绿。这与 HI-04 是同一失败类别（坏值在静态层全绿、故障只在 Supervisor 侧显形），只是不在本计划声明范围内（config 侧同样缺，属既有对称缺口） | 把 `repository.yaml` 的 `url:` 改成 `url: "not-a-url"` 后跑校验器 → `✓ 87 checks passed`，exit 0 | 至少加 `check(/^https?:\/\/\S+$/.test(value), 'V19', …)`；若判定超出本阶段范围，记入下一轮 backlog 并在 V19 注释里显式写明「url 只判类型不判形状」 |

### 五个必答问题（含实测证据）

1. **V19 是否真的无条件？** 是（在「repository 解析成功」这一前提下，与 V2/V16 完全同构）。`212-219` 的存在性循环体是一个裸 `check(has(...))`，不在任何 `if (has(...))` 内；类型循环 `222-233` 是独立 `for`，不消费前一段的结果，只消费 `repository` 本身。**没有任何输入能让 V19 整段跳过而不产生失败**：`repository` 为 falsy 的唯一来源是 `readAndParse()` 返回 `null`，而该函数三条返回 `null` 的路径（读失败 / YAML 解析失败 / 顶层非 mapping）都在返回前 `fail('V1', …)`。
2. **是否存在绕过路径？** 无。隔离树实测：空文件 → `✗ V1 repository.yaml: top level must be a mapping, got undefined`（exit 1）；顶层数组 → `… got a list`（exit 1）；顶层标量 → `… got string`（exit 1）。`maintainer: "   "` → `✗ V19 … got string`（exit 1）；`maintainer: 0` → `✗ V19 … got number`（exit 1）；`maintainer: {a: b}` → `✗ V19 … got object`（exit 1）。「空文件让缺失键变成无键可查」不成立，因为 V19 的前提是 V1 已经放过。
3. **生成器侧顺序是否真的安全？** 是。`buildRepositoryYaml()`（`196-207`）三行 `assertNonEmptyString` 在唯一的 `scalar()` 调用（`206`）之前；`scalar()` 在该函数里没有第二次调用点，`main()` 里也没有 `??` 默认值或插值把源值转成字符串的路径。`assertNonEmptyString` 直接判 `typeof value === 'string' && value.trim() !== ''`，`null` / `undefined` / 数字 / 布尔 / 数组一律抛，不存在「先 stringify 再判空」的窗口。缺键场景更早被 `assertConsumedKeys()`（`367-369`）拦下。
4. **新增的 11 个用例是否非空断言？** 校验器侧 8 条全部三件套（`assertDetects` 断言 `status !== null` + `exit 1` + `✗ <code> `，再单独断言点名键 / 类型词），无一条只断言 exit code。生成器侧 3 条断言 `^Failed: ` + 点名键 + 无 `TypeError` + 两产物哨兵未变，其中「删键」与「坏值」刻意用不同正则（`is missing` vs `must be a non-empty string`）。**唯一实质缺口是 R3-01**：`name` / `url` 两个调用点没有任何用例，属「用例非空但覆盖不到该行」。CRLF 两条在 `b71f7f7` 中**强度未降**：`\r\n→\n→\r\n` 链在数学上保证 fixture 必为纯 CRLF（文件只要含一个 `\n` 就必产 CRLF），第二例仍用 `assert.notEqual(edited, crlf)` 硬校验 `# ports:` 行确被删除，删不掉即红。
5. **87 / 64 是否真实增量？** 是，且可逐项对账。实现文件零删除 → 87 = 81 + 6 只能是新增 V19 的 3+3；测试文件仅 2 行 CRLF 改写被替换 → 64 = 53 + 11 = 53 + 8（校验器）+ 3（生成器）。无 skip/only/todo，表驱动循环项数固定。

### R3-01 证据（临时副本变异，工作树未改）

```text
=== baseline (no mutation)                              -> exit 0  # tests 64 # pass 64 # fail 0
=== delete assertNonEmptyString(repository.url)         -> exit 0  # tests 64 # pass 64 # fail 0
=== delete assertNonEmptyString(repository.name)        -> exit 0  # tests 64 # pass 64 # fail 0
=== delete assertNonEmptyString(repository.maintainer)  -> exit 1  # tests 64 # pass 62 # fail 2
```

变异方法：把 `scripts/`、`homeweave_app/`、`repository.yaml`、`node_modules/js-yaml` 复制到 `%TEMP%`，正则删除目标行后跑 `node --test "scripts/**/*.test.mjs"`。左侧两行「全绿」说明该守卫**可以被静默删除而无人发现** —— 这与 `generate-app-metadata.test.mjs:283-287` 注释自己立的标准（「断言同一个措辞会让两个守卫中的一个被删掉而表仍绿」）直接冲突。

**Fix：**

```js
const REPOSITORY_SOURCE_FAILURES = [
  [
    'null',
    (source) => {
      source.repository.maintainer = null;
    },
    /repository\.maintainer must be a non-empty string/,
  ],
  [
    'empty name',
    (source) => {
      source.repository.name = '';
    },
    /repository\.name must be a non-empty string/,
  ],
  [
    'numeric url',
    (source) => {
      source.repository.url = 42;
    },
    /repository\.url must be a non-empty string/,
  ],
  [
    'missing url',
    (source) => {
      delete source.repository.url;
    },
    /repository\.url is missing/,
  ],
];
```

### R3-02 证据

```text
delete url line          -> exit 1  ✗ V19 … missing required key "url"   | 85 checks run, 1 failed
delete url + maintainer  -> exit 1  ✗ V19 ×2                              | 83 checks run, 2 failed
clean tree               -> exit 0                                        | ✓ 87 checks passed
```

失败路径下 `checksRun` 会被打印（`validate-app-metadata.mjs:644`），所以「检查总数与缺失哪个键无关」是一句可被直接证伪的话。修法只需改注释；这一条之所以值得记，是因为本项目把注释当可审计规格用，后续维护者会据此判断 `continue` 的语义。

### R3-03 证据

```text
url: "not-a-url"  -> exit 0   ✓ 87 checks passed
```

V19 只判 `typeof value === 'string' && value.trim() !== ''`，V14 只在 url 里出现 `/tree/<branch>` 时才判分支名，于是任意字符串 url 都能过。范围判定交回编排者：不在 `01-06-PLAN.md` 声明的 T-01-22 缓解措施内，且 config 侧 `url` 同样无形状校验（既有对称缺口），故记 LOW 而非 MEDIUM。

**对「HI-04 是否真的闭合」的判断：闭合。** 原证词点名的五种篡改（删 `url` / 删 `maintainer` / `maintainer: 42` / `maintainer: null` / `url: true`）现在全部 exit 1 且被 V19 点名正确键名与实测类型，本轮另行补测的纯空白、`0`、嵌套 mapping、空文件、数组顶层、标量顶层 6 种输入也全部 exit 1；`if (has(key))` 静默短路的根因在结构与行为两个层面都已消除。遗留问题不是「守卫失效」，而是「守卫的部分行缺测试」（R3-01）与「同一类坏值仍有下一种形态未守」（R3-03）。

_Reviewed: 2026-10-27T09:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
