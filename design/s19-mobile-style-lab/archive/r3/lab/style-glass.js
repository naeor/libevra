/* B1 · Ambient Frost 柔和环境磨砂 / B2 · Layered Glass 分层透光玻璃
 * 两套共用页面结构（以第二轮 B 为基础，信息顺序与正式版一致），只通过「材质分配表」决定每个组件用哪种材质。
 * 五类材质（定义在 glass.css）：
 *   Canvas   页面背景            —— B1 朦胧柔和；B2 清晰的抽象光斑，不预先模糊
 *   Content  常规内容表面        —— 账目、长文字、设置多行、详情字段
 *   Satin    柔和釉面（近不透明）—— 重点信息容器
 *   Frosted  乳白磨砂玻璃        —— 操作层与浮层；局部模糊 + 环境透色 + 统一左上光源的边缘
 *   Accent   强调色玻璃          —— 只给中央记账按钮和主操作 */
(function () {
  const LV = window.LV, esc = LV.esc, I = LV.icon;
  const S = LV.state;

  /* ---------- 材质分配表 ---------- */
  const F = "m-frost", CTL = "m-frost f-ctl", BAR = "m-frost f-bar", SHEET = "m-frost f-sheet";
  const MAT = {
    b1: {
      tool: CTL, search: CTL, month: "", summary: "m-satin", summaryLayout: "grid", seg: CTL,
      group: "m-content", icon: "ico-flat", dock: BAR, dockFloat: false, plus: "m-accent-satin",
      sheet: SHEET, sheetFloat: false, shelf: F, shelfIcon: "m-content",
      setGroup: "m-content", meCard: "m-satin", meList: "m-content", signout: CTL,
      entryHero: "m-satin", entryFields: "m-content", primary: "m-accent-satin", secondary: CTL,
      statsHero: "m-content", statsOverview: "m-satin", card: "m-content", ledgerId: "m-satin",
      pill: CTL, toast: CTL, dialog: SHEET, capInDock: true,
    },
    b2: {
      tool: CTL, search: CTL, month: CTL, summary: F, summaryLayout: "split", seg: CTL,
      group: "m-content", icon: "ico-satin", dock: BAR, dockFloat: true, plus: "m-accent",
      sheet: SHEET, sheetFloat: true, shelf: F, shelfIcon: "m-satin",
      setGroup: F, meCard: F, meList: F, signout: CTL,
      entryHero: F, entryFields: "m-content", primary: "m-accent", secondary: CTL,
      statsHero: F, statsOverview: F, card: "m-content", ledgerId: F,
      pill: CTL, toast: CTL, dialog: SHEET, capInDock: true,
    },
  };
  const M = (k) => MAT[S.style][k];

  const ico = (c, cls = "") => `<span class="g-ico ${M("icon")} ${cls}" style="--hue:${c.hue}" aria-hidden="true">${esc(c.name.slice(0, 1))}</span>`;

  function row(e, opts = {}) {
    const c = LV.cat(e.category);
    const sub = [opts.flat ? LV.dayLabel(e.date) : "", e.time, LV.pay(e.payment)?.name].filter(Boolean).join(" · ");
    const sel = S.selecting ? `<span class="g-check" aria-hidden="true">${I("check", { size: 14, w: 2.4 })}</span>` : "";
    return `<li><button type="button" class="g-row" data-act="entry" data-id="${e.id}" ${S.selecting ? `aria-pressed="${S.selected.has(e.id)}"` : ""} aria-label="${esc(c.name)} ${esc(e.note)} ${LV.signed(e)}">${sel}${ico(c)}<span class="g-row-main"><span class="g-row-t">${esc(c.name)}${e.note ? `<span class="g-row-note"> · ${esc(e.note)}</span>` : ""}</span><span class="g-row-s">${esc(sub)}${e.attachments ? ` · ${I("clip", { size: 12 })}${e.attachments}` : ""}</span></span><span class="g-amt ${e.kind}">${LV.entryMoneyHTML(e)}</span></button></li>`;
  }

  function list(ctx) {
    const { groups, list: items } = ctx;
    if (!items.length) {
      const msg = S.searchOpen && S.query ? "没有符合条件的账目" : S.kind === "expense" ? "这个月还没有支出" : S.kind === "income" ? "这个月还没有收入" : "这个月还没有账目";
      return `<div class="g-empty"><p>${msg}</p>${S.searchOpen ? "" : `<button type="button" class="g-pill ${M("pill")}" data-act="menu-toggle">记一笔</button>`}</div>`;
    }
    if (!groups) return `<ul class="g-group ${M("group")}">${items.map((e) => row(e, { flat: true })).join("")}</ul>`;
    return groups.map((g) => `<section class="g-day"><h3 class="g-day-h"><span>${g.label}</span><span class="g-day-sum">${g.income ? `<span class="inc">收入 ${LV.money(g.income, "CNY", { symbol: false })}</span>` : ""}${g.expense ? `<span>支出 ${LV.money(g.expense, "CNY", { symbol: false })}</span>` : ""}</span></h3><ul class="g-group ${M("group")}">${g.entries.map((e) => row(e)).join("")}</ul></section>`).join("") + (S.month !== "all" ? `<button type="button" class="g-more" data-act="toast" data-msg="原型只载入了 9–11 月的示例数据">加载更早的记录</button>` : "");
  }

  /* 收支摘要：B1 一张 Satin 卡（2 × 2）；B2 主数字在玻璃卡上，次级两项为 Satin 小卡（与正式版“主卡 + 两张小卡”同构） */
  function summary(ctx) {
    const s = ctx.summary;
    const m = (v) => LV.moneyHTML(v, s.currency, { symbol: false });
    const head = `<div class="g-sum-head"><span>收支概览</span><button type="button" class="g-cur" data-act="currencies" aria-label="全部币种">${s.currency}${I("down", { size: 13 })}</button></div>`;
    const main = `<div><dt>支出</dt><dd class="g-big">${m(s.expense)}</dd></div><div><dt>收入</dt><dd class="g-big inc">${m(s.income)}</dd></div>`;
    const daily = `${s.daily == null ? "—" : m(s.daily)}<small>${s.days ? `按 ${s.days} 天计算` : "选择时间范围后显示"}</small>`;
    if (M("summaryLayout") === "split") {
      return `<div class="g-sum ${M("summary")}">${head}<dl class="g-sum-grid g-sum-main">${main}</dl></div>
        <dl class="g-mini-row"><div class="g-mini m-satin"><dt>结余</dt><dd>${m(s.balance)}</dd></div><div class="g-mini m-satin"><dt>日均支出</dt><dd>${daily}</dd></div></dl>`;
    }
    return `<div class="g-sum ${M("summary")}">${head}<dl class="g-sum-grid">${main}<div class="g-sub"><dt>结余</dt><dd>${m(s.balance)}</dd></div><div class="g-sub"><dt>日均支出</dt><dd>${daily}</dd></div></dl></div>`;
  }

  /* 分段：玻璃底板 + 更实更亮的选中片 */
  function toolbar() {
    return `<div class="g-seg ${M("seg")}" role="group" aria-label="收支类型" data-kind-track style="--i:${["all", "expense", "income"].indexOf(S.kind)}"><i class="g-seg-pill" aria-hidden="true"></i>${[["all", "全部"], ["expense", "支出"], ["income", "收入"]].map(([v, l]) => `<button type="button" data-act="kind" data-kind-btn data-v="${v}" aria-pressed="${S.kind === v}">${l}</button>`).join("")}</div>`;
  }

  /* 顶部工具：同一种玻璃小圆钮；非默认排序时排序钮为选中态 */
  function tools(ctx) {
    if (S.selecting) return `<button type="button" class="g-tool g-tool-text ${M("tool")}" data-act="batch-exit" aria-label="退出批量操作">取消</button>`;
    const sortOn = !(S.sort.field === "time" && S.sort.dir === "desc");
    return `<button type="button" class="g-tool ${M("tool")}" data-act="search-open" aria-label="搜索账目">${I("search", { size: 19 })}</button><button type="button" class="g-tool ${M("tool")} ${sortOn ? "on" : ""}" data-act="sheet" data-type="sort" aria-label="排序 · ${ctx.sortLabel}">${I(S.sort.dir === "desc" ? "sortDesc" : "sortAsc", { size: 19 })}</button><button type="button" class="g-tool ${M("tool")}" data-act="batch-start" aria-label="批量操作">${I("batch", { size: 19 })}</button><button type="button" class="g-tool ${M("tool")}" data-act="more" aria-label="更多">${I("more", { size: 19 })}</button>`;
  }

  function searchBar(ctx) {
    return `<header class="g-top g-top-search"><label class="g-searchbar ${M("search")}">${I("search", { size: 18 })}<input type="search" data-input="search" placeholder="搜索备注、分类、标签或金额" aria-label="搜索账目" value="${esc(S.query)}" enterkeyhint="search" autocomplete="off"><button type="button" class="g-clear" data-act="search-clear" data-search-clear aria-label="清除搜索内容" ${S.query ? "" : "hidden"}>${I("close", { size: 12, w: 2.4 })}</button></label><button type="button" class="g-cancel" data-act="search-cancel">取消</button></header>`;
  }

  function entriesPage(ctx) {
    if (S.searchOpen) {
      return `<div class="scroll g-scroll">${searchBar(ctx)}
        <p class="g-scope" data-region="search-scope">${regions["search-scope"](ctx)}</p>
        <div class="g-toolbar" data-pin data-region="toolbar">${toolbar(ctx)}</div><div class="g-list" data-region="list">${list(ctx)}</div><div class="scroll-end"></div></div>`;
    }
    const fc = ctx.filterCount;
    const badge = fc ? `<i class="g-badge">${fc}</i>` : "";
    return `<div class="scroll g-scroll">
      <header class="g-top g-top-entries">
        <button type="button" class="g-wordmark g-fade-out" data-act="toast" data-msg="前往账本空间（原型未包含该页）" aria-label="前往账本空间">Libevra</button>
        <button type="button" class="g-fade-in g-compact ${M("month")}" data-act="sheet" data-type="filter" tabindex="-1" aria-hidden="true">${esc(ctx.timeLabel)}${badge}${I("down", { size: 14 })}</button>
        <div class="g-tools">${tools(ctx)}</div>
      </header>
      <div class="g-month-row" data-collapse><button type="button" class="g-month ${M("month")}" data-act="sheet" data-type="filter" aria-haspopup="dialog" aria-label="筛选 · ${esc(ctx.timeLabel)}">${esc(ctx.timeLabel)}${badge}${I("down", { size: 16 })}</button></div>
      <section class="g-sum-wrap" data-region="summary">${summary(ctx)}</section>
      <div class="g-toolbar" data-pin data-region="toolbar">${toolbar(ctx)}</div>
      <div class="g-list" data-region="list">${list(ctx)}</div>
      <div class="scroll-end"></div></div>`;
  }

  /* ---------- 底部导航：一整块玻璃；内部图标不再单独包玻璃 ---------- */
  function nav(ctx) {
    const cap = LV.showCaption() ? `<button type="button" class="g-caption" data-act="sheet" data-type="ledger" aria-haspopup="dialog" aria-label="当前账本：${esc(ctx.ledger.name)}，切换账本"><span><span class="cap-k">当前账本：</span>${esc(ctx.ledger.name)}</span>${I("down", { size: 13 })}</button>` : "";
    return `<div class="g-dock ${M("dock")} ${M("dockFloat") ? "g-dock-float" : ""}">${cap}<nav class="g-tabs" aria-label="主导航">${LV.TABS.map((t) => t.primary
      ? `<div class="g-plus-slot"><button type="button" class="g-plus ${M("plus")}" data-act="menu-toggle" aria-expanded="${S.entryMenu}" aria-label="${S.entryMenu ? "收起记账方式" : "展开记账方式"}">${I("plus", { size: 26, w: 2.2 })}</button></div>`
      : `<button type="button" class="g-tab" data-act="tab" data-to="${t.id}" ${S.route.name === t.id ? 'aria-current="page"' : ""}><span class="g-tab-ic">${I(t.icon, { size: 22 })}</span><span>${LV.tabLabel(t)}</span></button>`).join("")}</nav></div>`;
  }
  function entryCards() {
    return `<div class="g-shelf ${M("shelf")}" ${S.entryMenu ? "" : 'aria-hidden="true"'}><p class="g-shelf-t">记一笔</p><div class="g-shelf-row">${LV.ENTRY_ACTIONS.map((a, i) => `<button type="button" class="g-app" style="--d:${i}" data-act="menu-item" data-label="${a.label}" aria-label="${a.label}" ${S.entryMenu ? "" : 'tabindex="-1"'}><span class="g-app-ic ${M("shelfIcon")}">${I(a.icon, { size: 23 })}</span><span class="short">${a.short}</span><span class="full">${a.label}</span></button>`).join("")}</div></div>`;
  }
  function batchBar() { return `<div class="g-dock ${M("dock")} ${M("dockFloat") ? "g-dock-float" : ""}" data-region="batch">${regions.batch()}</div>`; }

  /* ---------- 分析 ---------- */
  const cardHead = (key) => `<button type="button" class="g-ch" data-act="card" data-key="${key}"><span class="g-ch-t">${LV.CARDS[key].title}</span><span class="g-ch-w">${LV.CARDS[key].window}</span>${I("right", { size: 15 })}</button>`;
  const pct = (r) => (r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(1)}%`);
  const yuan = (v) => LV.moneyHTML(v, "CNY", { symbol: false });

  function chartFor(key, a, big) {
    switch (key) {
      case "where": {
        const top = a.where.cats.slice(0, 5), rest = a.where.cats.length - top.length;
        return `<div class="g-where ${big ? "big" : ""}"><div class="g-donut">${LV.chart.donut(a.where.cats, { size: big ? 168 : 136, thick: big ? 16 : 14, gap: 3, round: true, max: 6, label: "支出分类构成" })}<div class="g-donut-c"><span>本月支出</span><b>${yuan(a.where.total)}</b></div></div><ul class="g-legend">${top.map((c) => `<li><i style="--hue:${c.hue}"></i><span class="n">${c.name}</span><span class="v">${LV.short(c.value)}</span><span class="p">${(c.share * 100).toFixed(0)}%</span></li>`).join("")}${rest > 0 ? `<li class="rest">另有 ${rest} 项</li>` : ""}</ul></div>`;
      }
      case "overview": return `<dl class="g-sum-grid g-quad"><div><dt>总支出</dt><dd class="g-big">${yuan(a.overview.total)}</dd></div><div><dt>较上期变化</dt><dd class="g-big ${a.overview.change > 0 ? "up" : "down"}">${pct(a.overview.change)}</dd></div><div class="g-sub"><dt>日均支出</dt><dd>${yuan(a.overview.daily)}</dd></div><div class="g-sub"><dt>支出笔数</dt><dd>${a.overview.count}<small class="inline"> 笔</small></dd></div></dl>`;
      case "daily": return `${LV.chart.bars(a.daily.days.map((d) => ({ label: d.label, value: d.value, hi: d.date === a.daily.max.date })), { cls: "g-bars", label: "近 7 天每日支出" })}<dl class="g-pair"><div><dt>总支出</dt><dd>${yuan(a.daily.total)}</dd></div><div><dt>支出最多的一天</dt><dd>${a.daily.max.md} · ${yuan(a.daily.max.value)}</dd></div></dl>`;
      case "rise": case "fall": { const c = a[key]; return c ? `<p class="g-mini-name"><i style="--hue:${c.hue}"></i>${c.name}</p><p class="g-mini-v ${key}">${c.diff >= 0 ? "+" : "−"}${yuan(Math.abs(c.diff))}</p><p class="g-mini-s">${c.rate == null ? "上期无支出" : pct(c.rate)}</p>` : '<p class="g-mini-s">暂无数据</p>'; }
      case "large": return LV.chart.rank(a.large.map((e) => ({ id: e.id, name: e.note, value: e.amount, hue: LV.cat(e.category).hue, meta: `${LV.dayParts(e.date).md} · ${LV.cat(e.category).name} · ${LV.pay(e.payment).name}` })), { cls: "g-rank", act: "entry" });
      case "change": return LV.chart.diverge(a.changes);
      case "weekday": return LV.chart.bars(a.weekday.map((d) => ({ label: d.label, value: d.value })), { cls: "g-bars g-bars-alt", label: "按星期支出" });
      case "month": return `${LV.chart.flow(a.month.days, { cls: "g-flow" })}<dl class="g-trio"><div><dt>收入</dt><dd class="inc">${yuan(a.month.income)}</dd></div><div><dt>支出</dt><dd>${yuan(a.month.expense)}</dd></div><div><dt>差额</dt><dd>${yuan(a.month.net)}</dd></div></dl>`;
      case "weeks": return LV.chart.bars(a.weeks.map((w) => ({ label: w.label, value: w.value, partial: w.partial })), { cls: "g-bars g-bars-wide", label: "近 4 周每周支出" });
    }
    return "";
  }

  function statsFilter() {
    if (!S.statsFilterOpen) return "";
    const cats = LV.CATEGORIES.filter((c) => c.kind === "expense");
    return `<div class="g-card m-content g-sf"><p class="g-sf-t">分类</p><div class="g-chips">${cats.map((c) => `<button type="button" class="g-chip" data-act="stats-cat" data-id="${c.id}" aria-pressed="${S.statsDraft.includes(c.id)}"><i style="--hue:${c.hue}"></i>${c.name}</button>`).join("")}</div><p class="g-sf-hint">不选即为全部分类。时间沿用每张卡片自己的范围。</p><div class="g-sf-act"><button type="button" class="g-textbtn" data-act="stats-revert">还原</button><button type="button" class="g-pill ${M("primary")}" data-act="stats-apply">应用</button></div></div>`;
  }

  const pageTop = (title, sub, right) => `<header class="g-top"><h1 class="g-big-t g-fade-out">${title}</h1><span class="g-fade-in g-compact g-compact-static" aria-hidden="true">${title}<small>${esc(sub)}</small></span><div class="g-tools">${right}</div></header>`;

  function statsPage(ctx) {
    const a = LV.analysis();
    const sumText = `按卡片各自时间 · ${S.statsCats.length ? `分类 ${S.statsCats.length} 项` : "全部分类"}`;
    return `<div class="scroll g-scroll">
      ${pageTop("分析", ctx.ledger.name, `<button type="button" class="g-tool ${M("tool")} ${S.statsFilterOpen ? "on" : ""}" data-act="stats-filter" aria-expanded="${S.statsFilterOpen}" aria-label="筛选">${I("funnel", { size: 19 })}${S.statsCats.length ? '<i class="g-dot"></i>' : ""}</button><button type="button" class="g-tool ${M("tool")}" data-act="stats-edit" aria-label="编辑布局">${I("pencil", { size: 19 })}</button>`)}
      <div class="g-intro" data-collapse><p class="g-subtitle">以下结果由已记录的账目计算得出。</p><div class="g-statbar"><button type="button" class="g-sumline ${M("pill")}" data-act="stats-filter"><span>${sumText}</span></button><button type="button" class="g-pill ${M("pill")}" data-act="stats-settings" aria-label="统计设置">CNY · 原币统计${I("sliders", { size: 15 })}</button></div><div data-region="stats-filter">${statsFilter()}</div></div>
      <div class="g-stack">
        <article class="g-card ${M("statsHero")}">${cardHead("where")}${chartFor("where", a)}</article>
        <article class="g-card ${M("statsOverview")}">${cardHead("overview")}${chartFor("overview", a)}</article>
        <article class="g-card ${M("card")}">${cardHead("daily")}${chartFor("daily", a)}</article>
        <article class="g-card ${M("card")} g-pair-card"><div>${cardHead("rise")}${chartFor("rise", a)}</div><div>${cardHead("fall")}${chartFor("fall", a)}</div></article>
        <div class="g-carousel-wrap"><div class="g-carousel" data-carousel>${["large", "change", "weekday"].map((k) => `<article class="g-card ${M("card")} g-slide">${cardHead(k)}${chartFor(k, a)}</article>`).join("")}</div><div class="g-dots" role="tablist" aria-label="切换卡片">${[0, 1, 2].map((i) => `<button type="button" data-act="dot" data-i="${i}" aria-current="${i === 0}" aria-label="第 ${i + 1} 张"></button>`).join("")}</div></div>
        <article class="g-card ${M("card")}">${cardHead("month")}${chartFor("month", a)}</article>
        <article class="g-card ${M("card")}">${cardHead("weeks")}${chartFor("weeks", a)}</article>
      </div><div class="scroll-end"></div></div>`;
  }

  const innerTop = (back, title) => `<header class="g-top g-top-inner"><button type="button" class="g-back" data-act="back" aria-label="返回${back}">${I("left", { size: 21 })}<span>${back}</span></button><h1 class="g-inner-t">${title}</h1></header>`;

  function cardPage(ctx, key) {
    const a = LV.analysis(), src = LV.cardSource(key);
    return `<div class="scroll g-scroll">${innerTop("分析", LV.CARDS[key].title)}
      <div class="g-stack g-stack-inner"><p class="g-subtitle g-sub-pad">${LV.CARDS[key].window} · 按人民币原币统计</p>
      <article class="g-card ${key === "where" ? M("statsHero") : key === "overview" ? M("statsOverview") : M("card")}">${chartFor(key, a, true)}</article>
      <h2 class="g-sec-t">来源账目<span>${src.length} 笔</span></h2><ul class="g-group ${M("group")}">${src.map((e) => row(e, { flat: true })).join("")}</ul></div>
      <div class="scroll-end"></div></div>`;
  }

  /* ---------- 账本 ---------- */
  function ledgerPage(ctx) {
    const l = ctx.ledger, shared = l.members.length >= 2, t = shared ? "协作" : "账本";
    return `<div class="scroll g-scroll">${pageTop(t, l.name, `<button type="button" class="g-tool ${M("tool")}" data-act="toast" data-msg="账本设置子页面不在本轮范围" aria-label="账本设置">${I("gear", { size: 19 })}</button>`)}
      <div class="g-intro" data-collapse><p class="g-subtitle">${shared ? "共享账本" : "单人账本"}</p></div>
      <div class="g-stack">
        <article class="g-card ${M("ledgerId")}"><p class="g-eyebrow">当前账本</p><h2 class="g-book-title">${esc(l.name)}</h2><p class="g-book-meta"><span class="mono">${l.number}</span> · ${l.members.length} 人 · ${LV.ledgerEntries().length} 笔账目</p><div class="g-row-btns"><button type="button" class="g-pill ${M("primary")}" data-act="sheet" data-type="ledger">${I("swap", { size: 17 })}切换账本</button><button type="button" class="g-pill ${M("secondary")}" data-act="toast" data-msg="账本详情子页面不在本轮范围">查看详情</button></div></article>
        <section><h2 class="g-sec-t">成员<span>${l.members.length} 人</span></h2>
          <ul class="g-group ${M("group")}">${l.members.map((m) => `<li class="g-li g-li-static"><span class="g-av" style="--hue:${m.tone}">${esc(m.name.slice(-1))}</span><span class="g-li-m"><span class="g-li-t">${esc(m.name)}${m.me ? "<em>我</em>" : ""}</span></span><span class="g-li-r">${m.role}</span></li>`).join("")}<li><button type="button" class="g-li g-li-link" data-act="toast" data-msg="成员管理子页面不在本轮范围"><span class="g-li-m"><span class="g-li-t">成员管理</span></span>${I("right", { size: 16, cls: "g-chev" })}</button></li></ul></section>
        <section><h2 class="g-sec-t">邀请成员</h2>
          <div class="g-card ${M("card")}"><p class="g-hint-p">输入账号编号或用户名发送邀请，对方接受后加入账本。</p><div class="g-invite"><input type="text" data-input="invite" placeholder="账号编号或用户名" aria-label="要邀请谁"><button type="button" class="g-pill ${M("primary")}" data-act="invite">邀请</button></div><p class="g-ok" data-region="invite-note" role="status">${esc(S.inviteNote)}</p><button type="button" class="g-link" data-act="toast" data-msg="邀请权限子页面不在本轮范围">选择对方的权限，或查看已发出的邀请 ›</button></div></section>
        <section><h2 class="g-sec-t">编辑记录<button type="button" class="g-link g-link-r" data-act="toast" data-msg="完整编辑记录不在本轮范围">查看全部 ›</button></h2>
          <ul class="g-group ${M("group")}">${LV.HISTORY.map((h) => `<li class="g-li g-li-static g-hist"><span class="g-av sm" style="--hue:${(l.members.find((m) => m.name === h.who) || l.members[0]).tone}">${esc(h.who.slice(-1))}</span><span class="g-li-m"><span class="g-li-t"><b>${esc(h.who)}</b> ${h.what} ${esc(h.target)}</span><span class="g-li-h">${h.when}</span></span>${h.amount ? `<span class="g-li-r g-num">${h.amount}</span>` : ""}</li>`).join("")}</ul></section>
      </div><div class="scroll-end"></div></div>`;
  }

  /* ---------- 我的 / 设置 ---------- */
  const li = (it, act) => `<li><button type="button" class="g-li" data-act="${act}" data-id="${it.id}" data-label="${it.label}"><span class="g-li-ic">${I(it.icon, { size: 19 })}</span><span class="g-li-m"><span class="g-li-t">${it.label}</span>${it.hint ? `<span class="g-li-h">${esc(it.hint)}</span>` : ""}</span>${I("right", { size: 16, cls: "g-chev" })}</button></li>`;
  function mePage(ctx) {
    const u = ctx.user;
    return `<div class="scroll g-scroll">${pageTop("我的", u.name, `<button type="button" class="g-tool ${M("tool")}" data-act="toast" data-msg="没有新的通知" aria-label="通知">${I("bell", { size: 19 })}</button>`)}
      <div class="g-stack" data-collapse>
        <section class="g-card ${M("meCard")} g-me"><div class="g-avatar" aria-hidden="true">${I("leaf", { size: 34, w: 1.5 })}</div><p class="g-pname">${esc(u.name)}</p><p class="g-puser">@${u.username}</p></section>
        <ul class="g-group ${M("meList")}">${LV.ME_LINKS().map((it) => li(it, "me-link")).join("")}</ul>
        <button type="button" class="g-signout ${M("signout")}" data-act="signout">退出登录</button>
      </div><div class="scroll-end"></div></div>`;
  }
  function settingsPage() {
    return `<div class="scroll g-scroll">${innerTop("我的", "设置")}<div class="g-stack g-stack-inner">${LV.SETTINGS.map((g) => `<ul class="g-group ${M("setGroup")}">${g.map((it) => li(it, "setting")).join("")}</ul>`).join("")}<p class="g-foot-note">Libevra ${LV.USER.version}</p></div><div class="scroll-end"></div></div>`;
  }

  /* ---------- 账目详情 ---------- */
  function entryPage(ctx, e) {
    const c = LV.cat(e.category), p = LV.dayParts(e.date);
    const f = (k, v) => `<li class="g-li g-li-static g-field"><span class="g-li-k">${k}</span><span class="g-li-v">${v}</span></li>`;
    return `<div class="scroll g-scroll">${innerTop("明细", "记账详情")}
      <div class="g-stack g-stack-inner">
        <section class="g-card ${M("entryHero")} g-entry-hero">${ico(c, "lg")}<div><p class="g-entry-cat">${esc(c.name)} · ${p.md} ${p.weekday}</p><p class="g-entry-amt ${e.kind}">${LV.entryMoneyHTML(e)}</p><p class="g-entry-note">${esc(e.note) || "（无备注）"}</p></div></section>
        <ul class="g-group ${M("entryFields")}">${f("时间", `${e.date.replace(/-/g, "/")} ${e.time}`)}${f("分类", esc(c.name))}${f("支付方式", esc(LV.pay(e.payment).name))}${f("币种", `${e.currency} · ${LV.cur(e.currency).name}`)}${f("标签", e.tags.length ? e.tags.map((t) => `<span class="g-tag">${esc(LV.tag(t).name)}</span>`).join("") : '<span class="g-muted">没有标签</span>')}${f("记录人", esc(e.by))}${f("附件", e.attachments ? `${I("clip", { size: 14 })}${e.attachments} 个文件` : '<span class="g-muted">无</span>')}${f("编号", `<span class="mono">${e.number}</span>`)}</ul>
        <div class="g-actions"><button type="button" class="g-pill g-pill-lg ${M("primary")}" data-act="entry-edit">${I("pencil", { size: 18 })}修改</button><button type="button" class="g-pill g-pill-lg ${M("secondary")}" data-act="entry-copy">${I("copy", { size: 18 })}复制这一笔</button></div>
        <button type="button" class="g-danger-link" data-act="entry-delete" data-id="${e.id}">${I("trash", { size: 17 })}删除这笔记账</button>
      </div><div class="scroll-end"></div></div>`;
  }

  const regions = {
    list, summary, toolbar,
    "search-scope": (ctx) => `搜索范围：${esc(ctx.timeLabel)}${S.query ? ` · 找到 ${ctx.list.length} 笔` : ""}`,
    "stats-filter": () => statsFilter(),
    "invite-note": () => esc(S.inviteNote),
    batch: () => { const n = S.selected.size; return `<div class="g-batch-row"><span class="g-batch-n">已选 <b>${n}</b> 笔</span><button type="button" class="g-pill ${M("secondary")}" data-act="batch-edit" ${n ? "" : "disabled"}>${I("pencil", { size: 17 })}修改</button><button type="button" class="g-pill g-pill-danger ${M("secondary")}" data-act="batch-delete" ${n ? "" : "disabled"}>${I("trash", { size: 17 })}删除</button></div>`; },
  };

  /* B2 背景：清晰、未模糊的抽象光斑与色带（SVG）。光斑轮廓保持可辨，只在被玻璃覆盖处变柔和。 */
  const B2_CANVAS = `<div class="g-bg g-bg-clear" aria-hidden="true"><svg viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
    <defs>
      <linearGradient id="g2base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef3ef"/><stop offset=".55" stop-color="#f4f2ec"/><stop offset="1" stop-color="#eeeff1"/></linearGradient>
      <radialGradient id="g2sage"><stop offset="0" stop-color="#8fcbab"/><stop offset=".7" stop-color="#a2d4b9"/><stop offset="1" stop-color="#a2d4b9" stop-opacity="0"/></radialGradient>
      <radialGradient id="g2apricot"><stop offset="0" stop-color="#f1c39a"/><stop offset=".68" stop-color="#f4cfac"/><stop offset="1" stop-color="#f4cfac" stop-opacity="0"/></radialGradient>
      <radialGradient id="g2mist"><stop offset="0" stop-color="#a9c6e0"/><stop offset=".7" stop-color="#bcd3e7"/><stop offset="1" stop-color="#bcd3e7" stop-opacity="0"/></radialGradient>
      <radialGradient id="g2flare"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#fbfff9" stop-opacity=".95"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
      <linearGradient id="g2band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cfe5d8"/><stop offset="1" stop-color="#d6e2ee"/></linearGradient>
    </defs>
    <rect width="390" height="844" fill="url(#g2base)"/>
    <path d="M-20 548 C 80 470, 170 600, 270 520 S 400 450, 420 470 L 420 560 C 340 560, 300 640, 200 620 S 40 600, -20 650 Z" fill="url(#g2band)" opacity=".85"/>
    <ellipse cx="44" cy="262" rx="128" ry="104" fill="url(#g2apricot)"/>
    <circle cx="318" cy="186" r="126" fill="url(#g2sage)"/>
    <circle cx="292" cy="150" r="30" fill="url(#g2flare)"/>
    <circle cx="246" cy="70" r="22" fill="url(#g2flare)" opacity=".9"/>
    <circle cx="352" cy="772" r="160" fill="url(#g2mist)"/>
    <circle cx="46" cy="718" r="78" fill="url(#g2sage)" opacity=".8"/>
  </svg></div>`;
  const B1_CANVAS = `<div class="g-bg g-bg-fog" aria-hidden="true"><i class="g-fog f1"></i><i class="g-fog f2"></i><i class="g-fog f3"></i><i class="g-grain"></i></div>`;

  const def = (id) => ({
    name: id === "b1" ? "Ambient Frost" : "Layered Glass",
    collapseOffset: 8,
    entriesPage, statsPage, cardPage, ledgerPage, mePage, settingsPage, entryPage,
    nav, entryCards, batchBar, regions,
    background: () => (id === "b1" ? B1_CANVAS : B2_CANVAS),
    sheetFrame: (inner, sh) => `<div class="sheet g-sheet ${M("sheet")} ${M("sheetFloat") ? "g-sheet-float" : ""} g-sheet-${sh.type}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${inner}</div>`,
    dialogFrame: (inner) => `<div class="dialog g-dialog ${M("dialog")}" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">${inner}</div>`,
    toast: (msg, action) => `<div class="g-toast ${M("toast")}"><span>${msg}</span>${action ? `<button type="button" data-act="toast-action">${action.label}</button>` : ""}</div>`,
  });
  LV.registerStyle("b1", def("b1"));
  LV.registerStyle("b2", def("b2"));
  LV.GLASS_MAT = MAT;
})();
