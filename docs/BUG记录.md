# BUG 记录

> 最后修改：2026-11-15 02:41（UTC+08:00）

> **这份文档记"发现了但还没查清 / 还没修"的问题。**
> 与另外两份的分工，不要混：
>
> | 文档 | 记什么 |
> |---|---|
> | **本文** | **具体的、还没解决的缺陷**：现象、证据、推断、下一步怎么查 |
> | [`教训.md`](lessons.md) | **已经想明白的普遍规律**（"组件的内部状态不是关于世界的事实"这类） |
> | [`待办清单.md`](01-规划.md) §3 | **要做的功能与改进**，不是缺陷 |
>
> **⚠️ 每条都必须把"实测证据"与"我的推断"分开写。**
> 混在一起的记录，下一个人会把它当结论用——而这个项目已经为此付过代价。
>
> **⚠️ 不要在本文里写凭据**（邀请码、口令、私钥）。设备 id 用字母代替。

---

## BUG-001 · 协作者改了明细，本人看到的仍是旧值

| 项 | 值 |
|---|---|
| **发现时间** | 2026-10-16 约 06:02–06:06 UTC（北京时间 14:02–14:06） |
| **状态** | ⚠️ **现象已消失，根因未确定** |
| **影响** | 多人账本里，被邀请的编辑者改金额后**可能不生效** |
| **严重度** | 中高——**同一件事重做一次就好了**，但当事人会以为"我没有权限" |
| **环境** | 生产 <https://libevra.com>，账本 `家庭账本` #40000004（属于 `naeor`，成员 `naeor` + `hai`） |
| **对象** | 一笔流水，`seq = 1`，备注 `test01` |

### 现象（所有者报告）

> 让母亲把那笔账从 **20 改成 21**，改了**两次都没成功**；
> 而所有者自己改**一次就成功**，编辑记录里也看得到。
> 母亲的权限确实是 **editor**（`book_members.role = 'editor'`，在册）。

**⚠️ 用户提出的怀疑**："会不会因为账本是我创建的，所以只有我能改？"
**→ 已排除**：`book_members` 决定权限，与"谁创建的账本"无关。她的请求**确实到达了服务器并返回成功**（见下）。

### 实测证据（服务器端，只读查询 API 日志）

时间线（UTC）。设备 A = 母亲的设备，设备 B = 所有者的设备：

| 时间 | 设备 | 结果 |
|---|---|---|
| 06:01:45 | — | 流水创建（记 `created` 事件） |
| 06:02:26 | **A** | `PATCH` 被接受，**只写入 `occurredAt`**，`amountCents` **未被写入** |
| 06:02:43 | **A** | 同上，**只写入 `occurredAt`** |
| 06:06:01 | B | `PATCH` 被接受，写入 `occurredAt` **+ `amountCents`** |
| 06:06:02 | B | `PATCH` 被接受，只写入 `occurredAt` |
| **06:06:03** | — | 库中 `amount_cents = 2100`，`version = 5` |

**日志里的原文（关键一行）**：

```
{"transactionId":"01a1434d-…","deviceId":"aa803c9f-…","settlesConflict":false,
 "amountCents":2000,"writtenFields":["occurredAt"],"msg":"conflict-write-confirmed"}
```

**→ `writtenFields` 只有 `occurredAt`。**

**最终状态（06:06:03 之后，实测）**：

```
value_history = [{"at":"2026-10-16T06:06:02.654Z","values":{"amountCents":2100},
                  "version":4,"deviceId":"e655cf99-…"}]
amount_cents  = 2100    version = 5    updated_at = 06:06:03
transaction_conflicts = 0 行    conflict_resolutions = 0 行
transaction_events    = 只有 created（+1 条 member_changed）
```

**⚠️ 两个结论可以直接下**：

1. **服务端权限没有问题**：她的请求**返回成功**（不是 403/404）。若被拒，`transaction_events` 会是空。
2. **最终值就是 21**：她的改动**最终成功落库**了（06:06:03）。
   所以所有者当时看到 20，是**更早**的读数；而"再改一次就成功了"与此一致。

### 推断（**未证实**）

`amountCents` 没被写入，只可能是 `judge()` 的判定结果不是 `accept`。四条规则里：

| 规则 | 结果 | 与观测是否相符 |
|---|---|---|
| `base == 服务器当前值`（正常在线编辑） | 写 | ❌ 没写，所以不成立 |
| `wanted == 服务器当前值` | 服务器为准，不写 | ✅ 相符 |
| `wanted 在历史里` | 服务器为准，不写 | ✅ 相符 |
| 其他 | **抛冲突** | ❌ 库里 0 条冲突，所以不成立 |

**→ 因此她那次请求里，`amountCents` 这一项要么"想要的等于服务器当时的值"，要么"想要的是服务器走过的历史值"，
要么她设备的 `changes` 数组里根本没有 `amountCents`。**

**⚠️ 最后一种最可能，而且它指向客户端而不是服务端**：
她设备上那笔账的**本地缓存**当时已经是 21（乐观更新过），于是：
1. 界面上"改成 21"→ 本地值**没变化**，**没有生成待上传的改动**；
2. 她看到的"没成功"是**另一台设备/服务器**仍是 20；
3. 直到本地缓存被重新拉到 20，再改成 21，才产生真正的 `PATCH`。

**⚠️ 这只是推断。** 现有的服务端日志**不足以区分这几种情况**，因为
`conflict-write-confirmed` 只记录了 `writtenFields` 与最终的 `amountCents`，
**没有记录客户端声称的 `base` 与 `wanted`**。

### 下一步怎么查（给下一个人）

| # | 做法 | 能回答什么 |
|---|---|---|
| 1 | 在 `conflict-write-confirmed` 日志里**加上客户端声称的 `base` / `wanted`**（`changes` 数组） | **决定性的**：立刻能区分"没发"与"发了但被判服务器为准" |
| 2 | 复现时**在客户端导出 `logOffline` 诊断日志**（`DIAGNOSTIC:sync-request` 已记录 `amountCents` 与 `chain` 的字段名） | 客户端到底有没有把它放进队列 |
| 3 | 检查共享账本下**本地缓存的作用域**：另一个人的改动如何进入本设备的缓存（拉取时机） | "本地已是新值所以不再上传"这条推断成立与否 |
| 4 | 认真考虑**给用户一个可见的失败信号** | 现在"改了没生效"**界面上没有任何提示**，只能靠人去比 |

**⚠️ 第 4 条其实是最重要的。** 见 [`教训.md`](lessons.md) §3.1：
**"没有反馈"和"没有生效"在用户看来没有区别。**
这次的所有者第一反应是"我母亲没有权限"——**而这正是缺少反馈时的合理猜想。**

### ⚠️ 不要从这条记录推出的结论

- ❌ **不是权限问题**。`book_members` 的判定与账本创建者无关，她的编辑权限有效。
- ❌ **不是"编辑器不能改"**。她的改动**有过成功落库的记录**。
- ❌ **不能断定是客户端 bug**。服务端日志不足以区分，见上面的推断部分。

---

## BUG-002 · 明细搜索框获得焦点时两侧出现竖线

| 项 | 值 |
|---|---|
| **发现时间** | 2026-11-13（所有者 iPhone 截图，北京时间约 08:49） |
| **状态** | ⬜ 未查 |
| **环境** | 生产 1.19.56，iPhone Safari，深色模式，明细页搜索 |
| **严重度** | 低——视觉瑕疵，不影响搜索 |

**实测证据**：截图中搜索框获得焦点后，输入区左侧（占位文字之前）和“取消”按钮之前各有一条浅色竖线。

**推断（未查代码）**：输入框自身的左右边框或焦点描边露在了胶囊容器里。

**下一步**：深色模式重做时一并检查明细搜索栏的边框与焦点样式；对照浅色与各风格是否同样出现。

## BUG-003 · 首次点开账目的展开动画会卡一下

| 项 | 值 |
|---|---|
| **发现时间** | 2026-11-13（所有者报告） |
| **状态** | ⬜ 未查 |
| **环境** | 生产 1.19.56，iPhone，明细列表点开账目（对象展开） |
| **严重度** | 低——之后再点基本正常 |

**实测证据**：所有者描述，第一次点击时展开动画先停顿再展开，之后几次点击较为正常。

**推断（未验证）**：首次需要加载展开相关模块或准备画面快照。

**下一步**：用浏览器性能记录对比首次与再次点击的起始等待；必要时按[开发与验收规范](ops/开发与验收规范.md)的 Diagnostic Mode 排查。

## BUG-004 · 手机上偶尔点返回没有动画

| 项 | 值 |
|---|---|
| **发现时间** | 2026-11-13（所有者报告） |
| **状态** | ⬜ 未复现，未记录发生页面 |
| **环境** | 生产 1.19.56，iPhone |
| **严重度** | 低 |

**实测证据**：所有者描述“偶尔”点击返回时没有转场动画，未记录具体页面。

**推断（未验证）**：可能与从弹出面板发起导航时被判为“有弹窗打开”有关，也可能与返回键 300ms 防连点有关；见 [S19 审查后续待办](specs/design/S19-审查后续待办与弹出面板模板-20261114.md) §5。

**下一步**：所有者再遇到时记下页面与操作顺序，再复现。

## BUG-005 · 几处警告颜色类不存在，警告文字和标签没有颜色

| 项 | 值 |
|---|---|
| **发现时间** | 2026-11-14（S19 只读审查，源码复核确认） |
| **状态** | ✅ 已修（1.19.71，仅本机，未部署） |
| **环境** | 账本导入页、OCR 核对详情页、分析异常标记图 |
| **严重度** | 中——用户能看到警告信息失去琥珀色，但文字本身仍在 |

**实测证据（代码）**：`LedgerImportPage.tsx`（9 处 `text-warning-dark`、3 处 `bg-warning/10`）与 `OcrReviewDetailPage.tsx`（1 处 `text-warning-dark`）、`AnomalyMarkerChart.tsx`（1 处 `text-ink-3`）；`index.css` 只定义了 `warn*` 系列与 `ink`，没有 `warning`、`ink-3`。这些类分别在 1.14 系列与 S17 引入，不是 S19 造成的。Tailwind 4 遇到不认识的类不报错、不生成 CSS，所以构建、类型检查与测试全部通过；原有颜色守卫只检查写死的颜色值。

**全仓库盘点（1.19.71）**：把 `index.css` 的 `--color-*` 令牌当作“存在的颜色名”，扫描 `apps/web` 全部 `.ts` / `.tsx` / `.html`（去注释、跳过测试与 `i18n/`）里 `text / bg / border(-方向) / ring / ring-offset / fill / stroke / outline / divide / from / via / to / shadow / decoration / accent / caret / placeholder` 带颜色名的类。结果：不存在的颜色名只有上面三个文件的 14 处，没有其他；用构建产物交叉验证，修后 `.text-warn-dark`、`.bg-warn-soft`、`.text-muted` 规则都在产物里。

**根因**：写这些页面时凭印象用了别的设计系统的命名（`warning`、`ink-3`），主题里没有对应令牌，而没有任何检查会核对颜色名是否存在。

**修法（1.19.71）**：`text-warning-dark` → `text-warn-dark`；`bg-warning/10` → `bg-warn-soft`（警告浅底的正式令牌，随主题、与其他警告处一致，不再手写 10% 透明度）；`text-ink-3`（图表说明的次要文字）→ `text-muted`。只改颜色类。

**守卫**：`tools/check-color-classes.mjs`，`pnpm check:build`（因而 `check:delivery`）在构建前调用，`apps/web/src/lib/colorClasses.test.ts` 也调用同一个函数。发现不存在的颜色名就失败并列出文件、行号与类名；显式豁免写在脚本的 `ALLOWLIST` 里并注明理由（现有一项：`PeriodComparisonCard` 的 `text-caption`，见下）。修复前的代码上守卫报 14 处并失败，修复后通过。

**附带发现（未改，非颜色）**：`PeriodComparisonCard.tsx` 用了 `text-caption`，`@theme` 里没有这个字号令牌，该元素没有预期字号。不属于本 bug（颜色），守卫用 `ALLOWLIST` 豁免并注明；修字号时一并去掉豁免。

**未验证**：账本导入页与 OCR 核对详情游客到不了，没有截图；只确认了源码类名、构建产物里的规则与渲染前的守卫结果。

## BUG-007 · 退出登录不清本机账目副本

| 项 | 值 |
|---|---|
| **发现时间** | 2026-11-15（数据流向只读调查中发现，负责人按代码复核） |
| **状态** | ✅ 已修（1.19.83，仅本机，未部署；所有者 2026-11-15 要求立即修复）。线上 1.19.56 仍有，部署后才消除 |
| **环境** | 所有外观、所有设备的 Web 客户端；线上 1.19.56 存在（相关两处自 `v1.19.56` 未改动），本机 1.19.82 同样存在 |
| **严重度** | 高（隐私）——共用设备上，退出后账目副本仍留在浏览器里；应用本身不会把它显示给另一个账号（副本按账号区分），但能打开开发者工具或直接读浏览器存储的人可以读到 |

**证据（代码，未在浏览器实测）**：

- 离线查询缓存写在带账号 / 账本区分的键下：`apps/web/src/lib/offline/cache.ts:215`（`scopedKey(CACHE_KEY)`，形如 `query-cache:<作用域>`）。
- 退出登录调用的 `clearQueryCache` 删除的是不带区分的旧键：`apps/web/src/lib/offline/cache.ts:399`（`removeValue(CACHE_KEY)`），调用处 `apps/web/src/auth/AuthProvider.tsx:142`。该处注释说明本意是“普通退出照旧清理”，与实际行为相反。
- 同样留下的还有离线月份与标记（`ledger-months:*`、`ledger-marks:*`）；待上传附件库 `libevra-attachments-v1` 在退出、注销、清本机数据时都不清（调查 H7，未逐行复核）。

**修复（1.19.83）**：退出登录与登录失效走同一个清理 `clearSignedOutAccountData`（`apps/web/src/lib/offline/localCleanup.ts`，接在 `auth/AuthProvider.tsx` 的 `forgetLocalState`）——逐个账本处理这个账号的全部本机键：没有未同步改动的账本全部删除；`ledger-marks` 里有 `pending` / `deleted` 的账本只删查询缓存，保留未同步的记录（未同步的账就存在月份与标记里，删掉等于悄悄丢账），下次同一账号登录后同步。查询缓存落盘有 1 秒节流，1.5 秒后再清一次（`clearSignedOutQueryCache`）。同意门禁的受限退出仍保留本机数据（所有者早先决定）。退出确认文案改为如实说明。验证：单元测试 `lib/offline/signOutCleanup.test.ts`；开发服务器真实 IndexedDB 中按应用键格式写入两个账号的副本后执行清理，结果符合预期。未做真实账号的完整登录 → 退出实测。

**仍未处理**：待上传附件库 `libevra-attachments-v1` 在退出、注销、清本机数据时都不清（调查 H7，见下方清单）；它存的是还没上传的原件，与“不丢未同步的东西”有关，需单独决定。详见[实际数据流向与隐私事实调查](specs/product/Libevra-实际数据流向与隐私事实调查-V0.1.md) §6.8、§9 H1 / H7。

## BUG-006 · 生产构建丢掉无前缀的 `backdrop-filter`，Chromium 内核浏览器上 B2 没有背景模糊

| 项 | 值 |
|---|---|
| **发现时间** | 2026-11-14（1.19.62 实施 agent 对比改动前后的构建产物时发现） |
| **状态** | ✅ 已修（1.19.64，仅本机，未部署；2026-11-14 复现并确认根因） |
| **环境** | 生产构建；安卓 Chrome、电脑版 Chrome / Edge 等 Chromium 内核浏览器。生产 1.19.49（四种视觉风格首次随正式版本发布）起的源码里就有触发写法，现行生产 1.19.56 仍有（见下方“存在范围”） |
| **严重度** | 中——B2 弹出面板等处没有背景模糊，后方页面的字直接透过来，可读性下降；iPhone Safari 不受影响（Safari 18 以前只认带前缀写法，之后两种都认） |

**实测证据（2026-11-14 复现）**：

- 修复前在主目录 `f52c0607` 真实构建：源码里同一规则同时写两种写法的共 41 条，其中 9 条是“先无前缀、后带前缀”；进生产构建的 6 条在产物里**全部只剩 `-webkit-backdrop-filter`**，另外 3 条在只在开发服务器上打开的实验页（`s19/adaptation-lab/lab.css`），不进生产构建。“先带前缀”的 32 条两种写法都在。
- 受影响的 6 条与源文件：`s19/overlays.css` 两条——B2 弹出面板操作面的模糊（`[data-overlay-surface]::before`，**本 bug 的主要现象**）与浮层根节点的“不模糊”重置（`[data-overlay-root]`，没有别的规则给根节点设模糊，丢了看不出差别）；`s19/material-components.css` 的 B2 磨砂（frosted）展示材质（正式页面目前没有用到这个变体，只在开发用组件样板页出现）；`s19/motion/objectExpand.css` 的 B2 点开账目转场容器；`s19/wallpaper.css` 的外观设置里 B2 壁纸样张；`pages/theme-appearance.css` 的外观设置里 B2 风格图标。
- 本机 Google Chrome（无头）里 `CSS.supports('-webkit-backdrop-filter', 'blur(1px)')` 为 `false`、无前缀为 `true`；用修复前的构建打开 B2 明细筛选面板，面板 `::before` 的计算值是 `backdrop-filter: none`，修复后是 `blur(9.1px) saturate(1.5)`。
- 开发服务器不经过 Lightning CSS，所以开发时两种写法都在、看不出问题。

**根因（已用最小样例与开关对照验证）**：构建里有两步用 Lightning CSS 处理 CSS——Tailwind 4 的优化步骤（`@tailwindcss/vite` 构建时调用，Lightning CSS 1.32，只处理以 `index.css` 为入口、由它 `@import` 进来的样式，例如 `wallpaper.css`）与 Vite 8 默认的 CSS 压缩（`build.cssMinify` 默认 `lightningcss`，1.33，处理所有 CSS）。Lightning CSS 把 `backdrop-filter` 与 `-webkit-backdrop-filter` 当成同一个属性的两种前缀：**后写的是带前缀那条时，它认为带前缀那条覆盖了前面的无前缀写法，只输出带前缀的一条**；后写的是无前缀那条时，它合并成一条，再按目标浏览器补出 `-webkit-`（目标里有 Safari / iOS 16.4）。最小样例在两个版本上表现一致，并且：

- **与浏览器目标无关**：Vite 解析后的 `build.cssTarget` 本来就是 `chrome111, edge111, firefox114, safari16.4, ios16.4`（默认 `baseline-widely-available`），已经包含 Chromium；不给目标、默认目标、只给 Safari 18 都一样丢；
- **与是否压缩无关**：`minify: false` 也丢（合并发生在转换阶段，不是去空格那一步）；关掉 Tailwind 优化只让 `wallpaper.css` 那条晚一步在 Vite 压缩里丢；
- **没有单独关掉这项合并的开关**：`exclude: Features.VendorPrefixes` 也照样丢；同样反着写的 `user-select`、`mask-image`、`background-clip` 不受影响，是 `backdrop-filter` 特有的处理。

**存在范围**：触发写法（`overlays.css` 的 B2 面板规则）在 2026-11-08 的 `7b03582d` 引入；`v1.19.49`、`v1.19.53`、`v1.19.56` 三个生产标签的源码里都有，项目一直是 Vite 8 + Lightning CSS，所以推断这些生产构建同样丢失（没有逐版重新构建验证）。

**修法（1.19.64）**：把 9 条反序规则改成“先 `-webkit-backdrop-filter`、后 `backdrop-filter`”（CSS 的通行顺序，其余 32 条本来就是这样），取值不变。选这个而不是改配置，是因为配置层面没有可用的修法：目标浏览器已经包含 Chromium，Lightning CSS 也没有只关这一项的开关；要绕开只能整体停用 Tailwind 优化与 Vite 的 CSS 压缩，或关掉全部自动前缀——前者让 CSS 变大并失去嵌套展开等降级处理，后者让 iPhone Safari 18 以前丢掉其他属性的前缀，代价都远大于问题本身。修复后产物与修复前相比，CSS 只有这 6 条规则各多出一条与带前缀取值相同的 `backdrop-filter`，其余 CSS 逐字相同；JS 去掉构建时间戳与文件名哈希后逐字相同。带前缀写法全部保留，iPhone Safari 不受影响。

**守卫**：新增 `tools/check-built-css.mjs`，`pnpm check:build`（因而 `check:delivery`）在构建成功后自动扫描 `apps/web/dist` 的全部 CSS：同一规则里只有带前缀、只有无前缀，或两种取值不同都算失败，并列出文件与规则。已验证修复前的产物与修复前的源码跑 `check:build` 都失败（列出上面 6 条），修复后通过（38 条成对）。守卫自带自检样例，并在一条 `backdrop-filter` 都找不到或 CSS 解析没有回到顶层时报错，不会因为扫描失效而“永远通过”。也可以单独检查已有的构建目录：`node tools/check-built-css.mjs [目录]`。

**未验证**：安卓真机与电脑版 Edge 没有看过，只在本机 Chrome（同为 Chromium 内核）里用生产构建截图对比；安卓上多出的真实背景模糊对低端机流畅度的影响没有测。

---

## 数据流向调查发现的问题清单（2026-11-15）

来源：[实际数据流向与隐私事实调查 V0.1](specs/product/Libevra-实际数据流向与隐私事实调查-V0.1.md) §9。这里只列清单；某一项开始修复时再单独建 BUG-0xx 条目。H1 已单独登记为 BUG-007。

| 编号 | 问题 | 级别 | 线上是否存在 | 类型 | 依据 | 建议的下一步 |
|---|---|---|---|---|---|---|
| H1 | 退出登录不清本机账目副本 | 高 | 是（1.19.83 本机已修，未部署） | 缺陷 | 见 BUG-007 | 见 BUG-007 |
| H2 | 生产没有生效的协议门禁，也不产生同意记录 | 高 | 是 | 待决定 | `packages/shared/src/consent.ts:253-255`；`api/consent/policy.ts:41-43`；`api/app.ts:149-150` | 起草政策前先决定上线协议文档的方式与时间，再如实写同意事实 |
| H3 | 注销并不抹去个人信息（账号编号、会话、共享账本账目与附件、关键事件、COS 副本、备份等仍保留） | 高 | 是 | 待决定 | `api/lifecycle/account.ts:691-755`；`api/routes/auth.ts:435-439` | 决定哪些保留项需要缩减或改写（如冻结昵称是否回写），并在政策里列出保留清单 |
| H4 | 「删除」基本是软删除，且删除后仍存在于备份 | 高 | 是（备份期限待核实） | 待决定 | `api/routes/transactions.ts:1090-1197`；`api/routes/attachments.ts:238-256`；`deploy/README.md` | 政策中分别写「应用内删除」「永久清理」「备份到期」三层；核实第 8 节 5 |
| H5 | 业务库与本机备份为明文，附件内容明文存在数据库（仅异地副本 gpg 加密） | 高 | 是 | 待决定 | `deploy/backup.sh:47-50,139-143`；`schema:2120-2160` | 政策如实写明运维可访问范围；评估是否需要附件加密或访问审计（决策归所有者） |
| H6 | 过期会话没有清理任务，每行带 IP 与 UA 累积；注销后会话行保留；`last_seen_at` 从不更新 | 高 | 是 | 待决定 | `api/auth/guard.ts:31-52`；`api/lifecycle/account.ts:691-694` | 评估增加过期会话清理与注销时清除 IP / UA 的策略 |
| H7 | 待上传附件原件没有任何清理入口（IDB `libevra-attachments-v1/pending` 在退出、注销、切换账号等下都保留） | 高 | 是 | 缺陷 | `apps/web/src/lib/attachments.ts:34-65`；`apps/web/src/components/Attachments.tsx:30-60` | 在清理链路中补上该库，或在界面与政策中说明 |
| M1 | 分享链接令牌进入请求日志（令牌在路径中，Fastify 默认记录完整 URL） | 中 | 是（日志去向与保留待核实） | 待决定 | `apps/api/src/routes/share.ts:231,242`；`fastify@5.12.5/lib/log-controller.js:50` | 评估对请求 URL 做日志脱敏，或把令牌移出路径；同时核实日志保留 |
| M2 | 请求日志含客户端 IP 与完整 URL（含查询串），保存期限无上限的可能 | 中 | 是；保留期待核实 | 待核实 | `api/server.ts:25`；`deploy/docker-compose.prod.yml`（无 `logging:`） | 核实 Docker 日志驱动，评估配置轮转与 URL 脱敏；政策如实写日志内容与期限 |
| M3 | 账本清理后遗留的元数据与孤儿行（`ledger_*` 无外键，关键事件等永久保留） | 中 | 是 | 待决定 | `api/lifecycle/book.ts:752-835`；迁移中无 `REFERENCES` | 抽查 `result` 字段内容，决定是否补清理 |
| M4 | 共享账本信息暴露面较宽（成员可导出全部账目、下载全部附件、看到全部成员用户名与账号编号等） | 中 | 是 | 待决定 | `api/routes/export.ts:171-291`；`api/routes/attachments.ts:94,296-323`；`api/routes/consent.ts:217-305` | 政策与邀请界面如实说明成员可见范围；评估软删附件内容读取是否要加 `deletedAt` 检查 |
| M5 | 用户枚举：任一登录用户凭账号编号或精确用户名可查到对方昵称、用户名、账号编号 | 中 | 是 | 待决定 | `api/routes/directory.ts:64-130` | 评估对该接口单独限流 |
| M6 | 登录 / 恢复码失败限流只在进程内存，重启清零，多实例不共享 | 中 | 是 | 待决定 | `api/auth/login-throttle.ts:15-56` | 评估持久化限流（实现属后续决定） |
| M7 | 注销时本机清理有遗漏（偏好键、导入任务日志等未清） | 中 | 是 | 缺陷 | `apps/web/src/lib/offline/localCleanup.ts:81-91`；`apps/web/src/lib/ledgerImport/journal.ts:10-45` | 补全清单 |
| M8 | 设备 UUID 常驻并随每个请求外发，退出 / 注销 / 清游客都不清 | 中 | 是 | 待决定 | `apps/web/src/lib/offline/device.ts:17-44`；`apps/web/src/lib/api.ts:109-122` | 政策如实说明；评估注销 / 退出时是否轮换 |
| M9 | 识别结果（含识别原文、账户字段）存 sessionStorage，退出不清 | 中 | 是 | 待决定 | `apps/web/src/lib/ocr/types.ts:12-37`；`apps/web/src/lib/ocr/batchStore.ts` | 退出时清该键 |
| M10 | 「清除本应用的全部本地数据」范围与名称不符（不清 LS、SS、游客库、待上传附件） | 中 | 是 | 缺陷 | `apps/web/src/pages/DownloadMorePage.tsx:313`；`apps/web/src/lib/offline/reset.ts:31-62` | 评估改名或在文案中说明范围 |
| M11 | 诊断日志含金额分值、账目 id 前缀、设备 id，退出 / 注销不清，复制报告时会带出 | 中 | 是 | 待决定 | `apps/web/src/lib/offline/sync.ts:229-232,692-694`；`apps/web/src/lib/runtimeInfo.ts:5` | 复制报告前提示或脱敏 |
| M12 | S17-A 等旧文档与代码不符（「后端无外网请求」「退出会清掉缓存」、角色只写 editor / viewer） | 中 | 是 | 缺陷 | `S17-A:198,184,484`；`api/fx/provider.ts:14-15`；`schema:918-927` | 在 S17-A 或后续文档里更正（本文不改其他文档） |
| M13 | 整份 `.env` 注入 API 与 relay 容器，并被子进程继承 | 中 | 是 | 待决定 | `deploy/docker-compose.prod.yml:94-96`；`api/ocr/client.ts:222-224` | 评估只传必要变量给子进程 |
| M14 | 本机 `.dump.gpg` 副本无清理逻辑，随天数增长 | 中 | 是（实际数量待核实） | 待核实 | `deploy/backup.sh:263-276` | 核实数量后决定补清理 |
| L1 | 邀请码明文存库（`registration_invites.code`），其它凭证存哈希 | 低 | 是 | 待决定 | `schema:419-` | — |
| L2 | `transaction_events.source_ip` 很可能只是代理内网 IP，且无读取路径 | 低 | 待核实 | 待核实 | `api/ledger/auditContext.ts:12-22` | 核实 `AUDIT_TRUSTED_PROXY_IPS` |
| L3 | `UPLOAD_DIR`、`SESSION_SECRET` 出现在 compose 中，但源码无引用 | 低 | 是 | 缺陷 | `deploy/docker-compose.prod.yml:107-108` | 供部署核对 |
| L4 | 告警邮件经 Resend 发送，正文可能含内部任务 id / 账本 id | 低 | 待核实 | 待核实 | `deploy/alert-mail.sh:169-202` | — |
| L5 | 语音失败日志记录客户端声明的文件名；OCR 异常行最多 200 字符进日志 | 低 | 是 | 待决定 | `api/routes/voice.ts:85`；`api/ocr/client.ts:299-302` | — |
| L6 | `Permissions-Policy` 没有 `microphone=()`，而语音用 `getUserMedia` | 低 | 是 | 待决定 | `deploy/Caddyfile:85` | — |
| L7 | 密钥与口令文件（`.backup.key`、COS 上传身份）与应用同机 | 低 | 是（服务器权限待核实） | 待决定 | `deploy/README.md` | — |
| L8 | 游客「清除游客数据」后 `libevra.stats-workbench*:v1:guest:*` 等偏好残留 | 低 | 是 | 缺陷 | `apps/web/src/lib/guest/cleanup.ts:27-45` | — |
| L9 | 本机明文存储且不过期是有意设计；1.19.81 的同意状态本机缓存在退出 / 「清本机」时不清 | 低 | 前者线上有，后者仅本机 | 待决定 | `apps/web/src/lib/offline/cache.ts:42`；`apps/web/src/lib/consent.ts:88-114` | — |

统计：缺陷 7 条（H1、H7、M7、M10、M12、L3、L8）；待决定 19 条；待核实 4 条（M2、M14、L2、L4）。共 30 条。
