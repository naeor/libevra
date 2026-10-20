# S15-C 本机（localhost）两处体验问题 — 诊断与处理记录

> **最后核对**：`7133082`（A）+ `c3b1dde`（B）/ 2026-10-20
> **分支**：`s15c-localhost`（基线 `84a1caa`，含已合并的 S15-C 明细主页改动）
> **环境**：隔离 worktree `worktrees/s15c-localhost`；隔离 dev server `http://127.0.0.1:5174`（`LIBELLUM_WEB_PORT=5174`），`/api` 代理仍指向 `127.0.0.1:3000`（只读查询）。主工作区、5173 与 3000 的进程未动。
> **边界**：未 push、未联网上传、未部署、未合并；未创建/修改/删除任何真实账目；未清任何队列或缓存。
> **浏览器**：本机 Chrome 155 headless + CDP（`127.0.0.1:9333`），视口 1440×900 与 360×740。

---

## 一、问题 A：明细主页右上三个按钮点不到（已修）

### 1.1 复现路径（真实点击，不是推断）

1. `http://127.0.0.1:5174/login` → 点「以游客身份继续」→ 落到 `/`，`RequireSession` 放行，渲染真实 `DetailPage`（游客是真实路由，见 `App.tsx` 的 `RequireSession`）。
2. 用**真实滚轮事件**（`Input.dispatchMouseEvent` type=`mouseWheel`，`deltaY=100`×30）把明细从展示态推到列表态：`--p=1.0000`、`.detail-hero[data-pinned=true]`、hero 高 140px。
3. 在页面里执行 `document.elementFromPoint(按钮中心)`，并用 CDP 派发真实鼠标点击。

> 游客态 `DetailTools` 只渲染「刷新」（`guest ? null` 隐藏批量与更多），所以另两个按钮是对**它们所在的整条 36px 横带**做命中扫描（右侧三个 36px 圆、8px 间距，中心分别在行右边界 −106 / −62 / −18）。

### 1.2 证据（列表态，1440×900）

| 元素 | 位置（CSS px） | 说明 |
|---|---|---|
| `.detail-hero` | x 515–963，y 0–140 | `position: sticky; z-index: 20` |
| `.detail-tools`（按钮行） | x 903–939，**y 6–42** | `position: static` |
| `.detail-month-row` | x 539–939，**y 5–21** | `position: relative`，高 16px |
| `.detail-month-controls`（其子元素） | x 539–939，**y 5–37** | `position: static`，32px 高，**溢出**父行 |

- `elementFromPoint(921, 24)`（刷新按钮正中心）→ **`div.detail-month-controls`**，不是按钮。
- 真实鼠标点击打在按钮中心 → `click` 只落在 `.detail-month-row` 上，`.detail-tools` 收到 **0 次**。
- 同一按钮的 center / top / left / right 四个探测点全部命中 `detail-month-controls`，只有 bottom（y=38，按钮最后 4px）命中按钮本身。
- 沿横带扫描（x 取行左右两端、y 每 6px）：`y=6…36` 全部是 `detail-month-controls`，`y=42` 才是 hero。
- 展示态（`--p=0`）同一按钮五个点**全部**命中按钮本身 —— 与「展示态好点、明细态点不到」完全一致。
- 360×740 结果与 1440×900 相同（同一规则、同一 y 区间），说明这个层叠问题**与屏幕宽度无关**。

### 1.3 根因

`detail-motion.css` 里 `.detail-month-row` 是 `position: relative`，而工具行是 `static`，**于是月份行连同其子元素绘制在按钮之上**（与 z-index 无关）。列表态月份行被 translate 到按钮同一行（`--p-month` 与额外 −13px），**行本身 16px 高，内部 `.detail-month-controls` 却 32px 高并向下溢出**，两者叠起来盖住按钮 y 6–42 里的 5–37（31/36 像素）。

历史上记过的那次覆盖（`SyncBanner` sticky `z-30` vs pinned hero `z-20` + 按钮上移 4px）确实已修（`.detail-tools { transform: none }`），但列表态还有这第二个覆盖层，且它盖住的是**几乎整个按钮**，所以表现为「点了没反应」。

### 1.4 改动（1 处 CSS）

`apps/web/src/detail-motion.css`（+29 行，含注释）：

```css
.detail-month-row { pointer-events: none; }
.detail-month-row .detail-month { pointer-events: auto; }
```

- 只让月份行的**空白区域**不再拦截指针，真正可点的月份入口自己保留 `pointer-events`（两个箭头的 `pointer-events` 本来就写在 `.detail-arrow` 上，不受影响）。
- **不抬按钮 `z-index`** —— 沿用 `.detail-tools` 那里已写下的结论：靠层叠打架才能点的控件，下次还会输。
- 不改布局、颜色、间距、动画时长。

### 1.5 改完的验证

- 五个探测点（center/top/bottom/left/right）**全部**命中按钮或其图标。
- 真实点击按钮中心 → `.detail-tools` 收到 1 次 `click`，并出现刷新反馈：「已重新读取本机账目（游客账本没有云端可同步）。」
- 月份入口仍可点：点月份按钮打开月份选择器（1–12 月 + 回到本月）。
- 月份箭头仍可点：点右箭头 2026 年 10 月 → 11 月，再点左箭头回到 10 月。
- **视觉零变化**：在同一会话里注入/移除「旧规则」开关各截一张图（1440×900 与 360×740），两两 **SHA256 完全相同**。
- 控制台无 JS 异常；只有 4 条 401（来自未登录的 `/api/auth/me`，与本次改动无关）。

### 1.6 未验证（需所有者在 5173 复核）

- **批量模式下的「取消」**：游客态没有批量按钮，未能在浏览器实测。它与三个按钮同处 `.detail-tools`、同一 36px 行、同一层叠上下文，且横带扫描显示整条带已不再被月份行拦截 → 预期一并修好，但**未经浏览器验证**。
- 非 headless 的桌面浏览器、真机 360px 未验；只验了 headless Chrome 的同尺寸视口。

---

## 二、问题 B：本地执行看起来都被当成「离线操作」（只诊断 + 一处提示修复）

### 2.1 状态是怎么判定的（代码事实）

- `isAccountOffline() = !navigator.onLine || lastRequestFailed`（`lib/offline/connectivity.ts:77`）。
- `lastRequestFailed` 只由 `withLocalFallback` 写：**只有「真的没有答复」**（status 0 / 抛出）才置真，**只有一次成功的 fallback 请求**才能清掉。
- 全仓 `withLocalFallback` 只有 4 处调用，都在 `lib/queries.ts`：`useSummary` / `useTransactions` / `useTransaction` / `useStats`。
- `syncAll` / `syncMonth` / `pullConflicts` 全部直接 `apiFetch`（且 `.catch(() => null)`）——**它们成功不会清离线，失败也不会置离线**。所以按「刷新」并不能改变离线判定。
- `navigator.onLine === false` 时（本机没网、或浏览器报离线），即使 `127.0.0.1:3000` 一切正常也**必然**判离线：按设计「浏览器同意 + 请求成功」才算在线，而一次成功的本机请求不会把 `browserOnline` 改回 true。
- 新建账目：`createEntry` 在 `isAccountOffline()` 为真时**根本不发请求**，只打 pending 标记（`write.ts:320-324`）。「新操作像是默认走了本地队列」= 那一刻判了离线。
- 行底色（`LedgerEntryRow.tsx:50-56`）：**淡红 = 已删除、服务器还不知道**；淡黄 = 冲突；**淡绿 = 已新建、服务器还不知道**。

### 2.2 为什么标记一直不消失（本次查到的两条可证明原因）

1. **投递只有四个时机**：启动、`online` 事件、`visibilitychange` 回前台、以及（非离线时）每次本地写入（`syncController.ts:147-154`）。**API 重启不会让浏览器触发 `offline→online`**，所以「API 又好了」不会自动推动队列 —— 要么刷新页面，要么再写一笔，要么切一次前台。
2. **会话内失败计数**：同一行失败 5 次即在本会话内跳过；永久拒绝也跳过（`sync.ts:53/163-171`）。`failures` 是**内存表**，只有投递成功才 `delete`。
   ⚠️ `syncController.ts` 顶部注释写「人按刷新时先清掉放弃标记」，但代码里**没有**这样的清除调用 —— **按刷新不会让被跳过的行重试，只有刷新页面（模块重新加载）才会**。
3. 另有既有的「取回中断」提示来源：`fill.ts:411` 的「这次没能全部取回，已取回的部分离线时可以用。下次联网会自动继续。」—— 这是**历史下载（fill）**被中断时的 10 秒提示，不是待同步行本身的状态。

### 2.3 结论

- **历史遗留的待同步标记：是。** 之前 API 抖动（`--watch` 因 `node_modules` 变化反复重启）窗口里产生的写入只写本地；窗口过后没有触发点，加上会话内 attempts 用尽，就会一直红/绿到下次刷新页面。
- **新操作默认离线：不是「默认」，而是「那一刻判了离线」。** 触发条件只有两个：`navigator.onLine === false`（本机确实没网 / 浏览器报离线），或 `lastRequestFailed` 还没被 4 个 fallback 查询里任意一个成功请求清掉。后者的典型窗口正是 API 重启前后；前者会一直成立，且本机请求无法把它改回来。
- 与问题 A 的关系：A 让「刷新」按不动，等于把唯一一个「人主动要求重试」的入口也断掉了；A 修好后刷新可用，但**刷新本身不清 attempts**（见 2.2 第 2 条），所以旧行仍可能需要一次页面刷新才会重投。

### 2.4 修了什么（最小、不碰核心）

`apps/web/src/components/ledger/refreshFeedback.ts` + `refreshFeedback.test.ts` + `DetailPage.tsx`：
刷新结束时读一次 `pendingCount()`，只要还有改动没送上去，就在提示里补一句「还有 N 条改动没有送到云端，已保留在本机，下次联网会继续尝试。」

- 之前「投递 0 条」无论原因（队列本来就空 / 被跳过 / 被拒绝）都输出同一句「没有待投递的改动」，与屏幕上仍带标记的行自相矛盾。
- 只改一句提示文案 + 一次只读计数；**未改投递、离线判定、队列、幂等与冲突逻辑**，未清任何队列。
- 新增 3 个断言：有待投递时不得出现「没有待投递的改动」、部分投递后仍要报剩下的、队列为空时保留原句。

### 2.5 没有改的（留给 Lead / 所有者决定，都是核心语义）

| 候选 | 一行/一处的位置 | 为什么没动 |
|---|---|---|
| 按刷新时清 `failures`（让被跳过的行重试） | `syncController.syncNow` 内 `failures.clear()` | 与注释一致，但属于**重试/投递语义**，本轮明令禁止改核心 |
| 给 `syncAll` / `syncMonth` / `pullConflicts` 补 `reportReachability` | `lib/offline/sync.ts` | 会改变离线判定来源，属于核心 |
| 增加第五个同步时机（成功查询后补投递 / 定时重试） | `syncController.startSyncTriggers` | 属于同步策略 |
| 本机地址（127.0.0.1）视为可达，无视 `navigator.onLine` | `connectivity.ts` | 直接推翻「二者任一即离线」的设计决定 |

### 2.6 所有者 5 分钟自查（用来分辨「历史遗留」还是「现在仍在小规模离线」）

1. `我的 → 下载管理 → 更多`（路由 `/downloads/more`）可看到离线日志；或 DevTools → Application → Local Storage / IndexedDB 里键 `offline-log`（`diagnostics.ts`，上限 200 条）。
2. 在日志里搜这几类行：`DIAGNOSTIC:unreachable`（判离线的那一刻）、`DIAGNOSTIC:write-local`（哪几笔写入被当成离线只写了本地）、`DIAGNOSTIC:sync-waiting`（哪次触发后还剩几条）。看时间戳是集中在 API 抖动窗口内，还是持续发生。
3. 离线横幅出现时在控制台执行 `navigator.onLine`：为 `false` 则本机确实没网，此时按设计所有写入都走本地队列。
4. 刷新一次页面后看红/绿标记是否消失：消失 = 会话内 attempts/permanent 或缺少触发点；仍不消失 = 回到第 3 步查 `navigator.onLine` / latch。

### 2.7 B 的未验证

- **没有在浏览器里复现账户模式的投递行为**（本机没有可用登录态，且不允许绕过登录；也没有做任何写入实验）。以上均为代码路径 + 只读事实。
- 「红色底」到底是不是 pending delete，还是所有者对旧版「淡红=新建未同步」的记忆，需要对照 2.1 的颜色表确认。

---

## 三、测试与构建

| 命令 | 结果 |
|---|---|
| `pnpm --filter @libellum/web typecheck` | exit 0 |
| `pnpm --filter @libellum/web test` | **66 个文件 / 619 个用例全部通过**（新增 3 个） |
| `pnpm --filter @libellum/web build` | exit 0（仅剩既有的 chunk >500kB 与 `INEFFECTIVE_DYNAMIC_IMPORT` 警告） |

---

## 四、改动清单与回滚

| commit | 主题 | 文件 |
|---|---|---|
| `7133082` | A：明细态月份行不再吃掉右上三个按钮的点击 | `apps/web/src/detail-motion.css`（+29） |
| `c3b1dde` | B：刷新反馈不再在仍有待投递改动时说「没有待投递的改动」 | `apps/web/src/components/ledger/refreshFeedback.ts`、`refreshFeedback.test.ts`、`apps/web/src/pages/DetailPage.tsx` |

- 都在分支 `s15c-localhost`（基线 `84a1caa`），**未合并、未 push**；整条分支与 worktree 可整体丢弃。
- 主工作区 `Desktop\工作\记账程序\记账程序v1` 只读、未改动；5173 / 3000 进程未被触碰；隔离 dev server 只用了 5174。
