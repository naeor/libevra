/* Libevra S19 Style Lab · 第四轮：四种风格共用的页面模板
 * 产品逻辑、信息顺序、操作入口完全一致；差异只来自：
 *   1) MAT —— 每个组件在该风格下使用哪种材质角色（Canvas / Content / Elevated / Satin / Frosted / Accent / Overlay）
 *   2) V   —— 少量有明确理由的布局变体（见每项注释）
 * 外观（颜色、圆角、阴影、玻璃参数、主题色）全部来自 lab/theme-*.css 的语义变量。 */
(function () {
  const LV = window.LV, esc = LV.esc, I = LV.icon;
  const S = LV.state;

  /* ---------- 布局变体（只保留有理由的差异） ----------
   * 四套共用：顶部工具、搜索栏、月份、分段、底栏 + 居中“+”、Bottom Sheet、记一笔面板的位置与结构。
   * sum   split = 主卡（支出 / 收入）+ 两张次级小卡（结余 / 日均）；classic = 正式版：一个主数字 + 一行次级数字
   * zone  brand = C 的主题色顶区（正文以“纸面”压在顶区下沿）
   * card  inline = C 的当前账本卡：信息在左、紧凑“切换”在右 */
  const V = {
    a: { zone: "canvas", sum: "split", ledgerCard: "stack", icon: "hue" },
    b1: { zone: "canvas", sum: "split", ledgerCard: "stack", icon: "hue" },
    b2: { zone: "canvas", sum: "split", ledgerCard: "stack", icon: "glaze" },
    c: { zone: "brand", sum: "classic", ledgerCard: "inline", icon: "brand" },
  };
  const F = "m-frost f-ctl", FLAT = "m-frost f-ctl f-flat", GLASS = "m-frost f-card";
  /* ---------- 材质分配表 ----------
   * A  独立的柔和卡片（Content），关键卡片 Elevated；账目与编辑记录是贴合的明细行卡（t-tickets，标准明细行）
   * B1 顶栏 / 底栏 / 操作层是奶油感玻璃；信息卡片与列表是瓷片（Satin）
   * B2 同一骨架；信息卡片换成透明磨砂玻璃（f-card）；“+”与主操作仍是瓷片强调色
   * C  纸面：白卡 + 细边，不悬浮 */
  const MAT = {
    a: {
      tool: "u-lift", search: "u-lift", month: "", summary: "m-elevated", mini: "m-content", seg: "u-seg-soft",
      group: "t-tickets", dock: "m-elevated u-dock-a", sheet: "m-overlay", dialog: "m-overlay", toast: "u-toast-ink", shelf: "m-overlay", shelfIcon: "u-tint",
      hero: "m-elevated", card: "m-content", statsHero: "m-elevated", members: "m-content", log: "t-tickets", invite: "m-content", input: "u-input u-input-soft",
      setGroup: "m-content", fields: "m-content", primary: "m-accent", secondary: "u-btn-soft", secondaryIn: "u-btn-soft", signout: "u-btn-soft is-danger",
    },
    b1: {
      tool: F, search: F, month: "", summary: "m-satin", mini: "m-satin", seg: F,
      group: "m-satin", dock: "m-frost f-bar", sheet: "m-frost f-sheet", dialog: "m-frost f-sheet", toast: F, shelf: "m-frost f-panel", shelfIcon: "m-satin",
      hero: "m-satin", card: "m-satin", statsHero: "m-satin", members: "m-satin", log: "m-satin", invite: "m-satin", input: "u-input u-input-glass",
      setGroup: "m-satin", fields: "m-satin", primary: "m-accent", secondary: F, secondaryIn: FLAT, signout: F + " is-danger",
    },
    b2: {
      tool: F, search: F, month: "", summary: GLASS, mini: GLASS, seg: F,
      group: GLASS, dock: "m-frost f-bar", sheet: "m-frost f-sheet", dialog: "m-frost f-sheet", toast: F, shelf: "m-frost f-panel", shelfIcon: FLAT,
      hero: GLASS, card: GLASS, statsHero: GLASS, members: GLASS, log: GLASS, invite: GLASS, input: "u-input u-input-solid",
      setGroup: GLASS, fields: GLASS, primary: "m-accent", secondary: F, secondaryIn: FLAT, signout: F + " is-danger",
    },
    c: {
      tool: "u-onbrand", search: "u-onbrand-field", month: "", summary: "u-onbrand-card", mini: "m-content", seg: "u-seg-classic",
      group: "m-content", dock: "u-dock-c", sheet: "m-overlay", dialog: "m-overlay", toast: "u-toast-ink", shelf: "m-overlay", shelfIcon: "u-tint",
      hero: "m-content", card: "m-content", statsHero: "m-content", members: "m-content", log: "m-content", invite: "m-content", input: "u-input u-input-classic",
      setGroup: "m-content", fields: "m-content", primary: "m-accent", secondary: "u-btn-tint", secondaryIn: "u-btn-tint", signout: "u-btn-tint is-danger",
    },
  };
  const v = () => V[S.style];
  const M = (k) => MAT[S.style][k] ?? MAT[S.style].card ?? "";

  /* ---------- 小部件 ---------- */
  const ico = (c, cls = "") => `<span class="u-ico ico-${v().icon} ${cls}" style="--hue:${c.hue}" aria-hidden="true">${esc(c.name.slice(0, 1))}</span>`;
  const btn = (label, act, mat, extra = "", icon = "") => `<button type="button" class="u-btn ${mat}" data-act="${act}" ${extra}>${icon ? I(icon, { size: 17 }) : ""}<span>${label}</span></button>`;
  const yuan = (val) => LV.moneyHTML(val, "CNY", { symbol: false });

  /** 区块：标题在容器外，每个区块是自己的容器（材质由 MAT 决定）。 */
  function secHead(s) {
    if (!s.title) return "";
    return `<h2 class="u-sec-h"><span>${s.title}</span>${s.meta ? `<em>${s.meta}</em>` : ""}${s.aside || ""}</h2>`;
  }
  function sections(list) {
    const body = (s) => (s.box === false ? s.body : `<div class="u-box ${s.mat || ""} ${s.boxCls || ""}" ${s.region ? `data-region="${s.region}"` : ""}>${s.body}</div>`);
    const html = list.filter(Boolean).map((s) => `<section class="u-sec ${s.cls || ""}" ${s.id ? `id="${s.id}"` : ""}>${secHead(s)}${body(s)}${s.foot ? `<p class="u-sec-foot">${s.foot}</p>` : ""}</section>`).join("");
    return `<div class="u-stack">${html}</div>`;
  }
  const hero = (html, mat, cls = "") => `<div class="u-hero-wrap"><section class="u-hero ${mat} ${cls}">${html}</section></div>`;

  /* ---------- 顶栏 ---------- */
  function tabTop(title, compactSub, tools) {
    return `<header class="u-top"><h1 class="u-big-t g-fade-out">${title}</h1><span class="u-compact g-fade-in" aria-hidden="true"><b>${title}</b>${compactSub ? `<small>${esc(compactSub)}</small>` : ""}</span><div class="u-tools">${tools}</div></header>`;
  }
  function innerTop(back, title, right = "") {
    return `<header class="u-top u-top-inner"><button type="button" class="u-back" data-act="back" aria-label="返回${back}">${I("left", { size: 21 })}<span>${back}</span></button><span class="u-inner-t g-fade-in" aria-hidden="true">${title}</span><div class="u-tools">${right}</div></header>`;
  }
  const tool = (icon, act, label, extra = "") => `<button type="button" class="u-tool ${M("tool")}" data-act="${act}" aria-label="${label}" ${extra}>${I(icon, { size: 19 })}</button>`;
  /* 色区 + 正文：正文容器从这里开始，到页面末尾的 scroll-end 结束（C 用它做压在顶区下沿的纸面） */
  const zone = (html) => `<div class="u-zone">${html}</div><div class="u-body">`;

  /* ================= 明细 ================= */
  function row(e, opts = {}) {
    const c = LV.cat(e.category);
    const sub = [opts.flat ? LV.dayLabel(e.date) : "", e.time, LV.pay(e.payment)?.name].filter(Boolean).join(" · ");
    const sel = S.selecting ? `<span class="u-check" aria-hidden="true">${I("check", { size: 14, w: 2.4 })}</span>` : "";
    return `<li><button type="button" class="u-row" data-act="entry" data-id="${e.id}" ${opts.from ? `data-from="${opts.from}"` : ""} ${S.selecting ? `aria-pressed="${S.selected.has(e.id)}"` : ""} aria-label="${esc(c.name)} ${esc(e.note)} ${LV.signed(e)}">${sel}${ico(c)}<span class="u-row-main"><span class="u-row-t">${esc(c.name)}${e.note ? `<span class="u-row-note"> · ${esc(e.note)}</span>` : ""}</span><span class="u-row-s">${esc(sub)}${e.attachments ? ` · ${I("clip", { size: 12 })}${e.attachments}` : ""}</span></span><span class="u-amt ${e.kind}">${LV.entryMoneyHTML(e)}</span></button></li>`;
  }
  function emptyState(title, desc, action = "") {
    return `<div class="u-empty"><span class="u-empty-ic">${I("note", { size: 22 })}</span><p class="u-empty-t">${title}</p>${desc ? `<p class="u-empty-d">${desc}</p>` : ""}${action}</div>`;
  }
  function list(ctx) {
    const { groups, list: items } = ctx;
    if (!items.length) {
      if (S.searchOpen && S.query) return emptyState("没有符合条件的账目", "换个关键词试试，或检查上方的时间范围。");
      const t = S.kind === "expense" ? "这段时间还没有支出" : S.kind === "income" ? "这段时间还没有收入" : "这段时间还没有账目";
      return emptyState(t, LV.activeFilterCount() ? "当前筛选条件下没有结果，可以调整筛选。" : "记下的账目会按日期出现在这里。", S.searchOpen ? "" : LV.activeFilterCount() ? btn("调整筛选", "sheet", M("secondary"), 'data-type="filter"') : btn("记一笔", "menu-toggle", M("primary"), "", "plus"));
    }
    if (!groups) return `<ul class="u-group ${M("group")}">${items.map((e) => row(e, { flat: true })).join("")}</ul>`;
    return groups.map((g) => `<section class="u-day"><h3 class="u-day-h"><span>${g.label}</span><span class="u-day-sum">${g.income ? `<span class="inc">收入 ${LV.money(g.income, "CNY", { symbol: false })}</span>` : ""}${g.expense ? `<span>支出 ${LV.money(g.expense, "CNY", { symbol: false })}</span>` : ""}</span></h3><ul class="u-group ${M("group")}">${g.entries.map((e) => row(e)).join("")}</ul></section>`).join("") + (S.month !== "all" ? `<button type="button" class="u-more" data-act="toast" data-msg="原型只载入了 9–11 月的示例数据">加载更早的记录</button>` : "");
  }

  function summary(ctx) {
    const s = ctx.summary;
    const m = (val) => LV.moneyHTML(val, s.currency, { symbol: false });
    const cur = LV.cur(s.currency);
    const daily = s.daily == null ? "—" : m(s.daily);
    if (v().sum === "classic") {
      // C：与正式版同构 —— 币种与时间、一个主数字、下方一行次级数字
      return `<div class="u-sum u-sum-c ${M("summary")}"><div class="u-sum-head"><span>${cur.name} · ${S.range ? "所选时间" : S.month === "all" ? "全部时间" : "本月"}支出</span><button type="button" class="u-cur" data-act="currencies">全部币种${I("right", { size: 13 })}</button></div>
        <p class="u-sum-big"><span class="u-sum-sym">${cur.symbol}</span>${m(s.expense)}</p>
        <dl class="u-sum-row"><div><dt>收入</dt><dd>${m(s.income)}</dd></div><div><dt>结余</dt><dd>${m(s.balance)}</dd></div><div><dt>日均支出</dt><dd>${daily}</dd></div></dl></div>`;
    }
    // A / B1 / B2：主卡 + 两张次级小卡（同一层级用同一材质，避免“小卡更白更实”）
    return `<div class="u-sum ${M("summary")}"><div class="u-sum-head"><span>收支概览</span><button type="button" class="u-cur" data-act="currencies" aria-label="全部币种">${s.currency}${I("down", { size: 13 })}</button></div>
      <dl class="u-sum-grid u-sum-main"><div><dt>支出</dt><dd class="u-big">${m(s.expense)}</dd></div><div><dt>收入</dt><dd class="u-big inc">${m(s.income)}</dd></div></dl></div>
      <dl class="u-mini-row"><div class="u-mini ${M("mini")}"><dt>结余</dt><dd>${m(s.balance)}</dd></div><div class="u-mini ${M("mini")}"><dt>日均支出</dt><dd>${daily}${s.days ? `<small>按 ${s.days} 天计算</small>` : ""}</dd></div></dl>`;
  }

  function toolbar() {
    return `<div class="u-seg ${M("seg")}" role="group" aria-label="收支类型" data-kind-track style="--i:${["all", "expense", "income"].indexOf(S.kind)}"><i class="u-seg-pill" aria-hidden="true"></i>${[["all", "全部"], ["expense", "支出"], ["income", "收入"]].map(([val, l]) => `<button type="button" data-act="kind" data-kind-btn data-v="${val}" aria-pressed="${S.kind === val}">${l}</button>`).join("")}</div>`;
  }
  function tools(ctx) {
    if (S.selecting) return `<button type="button" class="u-tool u-tool-text ${M("tool")}" data-act="batch-exit" aria-label="退出批量操作">取消</button>`;
    const sortOn = !(S.sort.field === "time" && S.sort.dir === "desc");
    return tool("search", "search-open", "搜索账目") + tool(S.sort.dir === "desc" ? "sortDesc" : "sortAsc", "sheet", `排序 · ${ctx.sortLabel}`, `data-type="sort" ${sortOn ? 'aria-pressed="true"' : ""}`) + tool("batch", "batch-start", "批量操作") + tool("more", "more", "更多");
  }
  function searchBar() {
    return `<header class="u-top u-top-search"><label class="u-searchbar ${M("search")}">${I("search", { size: 18 })}<input type="search" data-input="search" placeholder="搜索备注、分类、标签或金额" aria-label="搜索账目" value="${esc(S.query)}" enterkeyhint="search" autocomplete="off"><button type="button" class="u-clear" data-act="search-clear" data-search-clear aria-label="清除搜索内容" ${S.query ? "" : "hidden"}>${I("close", { size: 12, w: 2.4 })}</button></label><button type="button" class="u-cancel" data-act="search-cancel">取消</button></header>`;
  }
  function listArea(ctx) {
    const inner = `<div class="u-toolbar" data-pin data-region="toolbar">${toolbar(ctx)}</div><div class="u-list" data-region="list">${list(ctx)}</div>`;
    return inner;
  }
  function entriesPage(ctx) {
    if (S.searchOpen) {
      return `<div class="scroll u-scroll" data-page="search">${searchBar()}${zone(`<p class="u-scope" data-region="search-scope">${regions["search-scope"](ctx)}</p>`)}${listArea(ctx)}<div class="scroll-end"></div></div></div>`;
    }
    const fc = ctx.filterCount;
    const badge = fc ? `<i class="u-badge">${fc}</i>` : "";
    return `<div class="scroll u-scroll" data-page="entries">
      <header class="u-top u-top-tab">
        <button type="button" class="u-wordmark g-fade-out" data-act="toast" data-msg="前往账本空间（原型未包含该页）" aria-label="前往账本空间">Libevra</button>
        <button type="button" class="u-compact u-compact-month g-fade-in ${M("month")}" data-act="sheet" data-type="filter" tabindex="-1" aria-hidden="true">${esc(ctx.timeLabel)}${badge}${I("down", { size: 14 })}</button>
        <div class="u-tools">${tools(ctx)}</div>
      </header>
      ${zone(`<div class="u-month-row" data-collapse><button type="button" class="u-month ${M("month")}" data-act="sheet" data-type="filter" aria-haspopup="dialog" aria-label="筛选 · ${esc(ctx.timeLabel)}">${esc(ctx.timeLabel)}${badge}${I("down", { size: 16 })}</button></div>
      <section class="u-sum-wrap" data-region="summary">${summary(ctx)}</section>`)}
      ${listArea(ctx)}
      <div class="scroll-end"></div></div></div>`;
  }

  /* ================= 底部导航 / 记一笔 / 批量 ================= */
  function nav(ctx) {
    const cap = LV.showCaption() ? `<button type="button" class="u-caption" data-act="sheet" data-type="ledger" aria-haspopup="dialog" aria-label="当前账本：${esc(ctx.ledger.name)}，切换账本"><span><span class="cap-k">当前账本：</span>${esc(ctx.ledger.name)}</span>${I("down", { size: 13 })}</button>` : "";
    return `<div class="u-dock ${M("dock")}">${cap}<nav class="u-tabs" aria-label="主导航">${LV.TABS.map((t) => t.primary
      ? `<div class="u-plus-slot"><button type="button" class="u-plus ${M("primary")}" data-act="menu-toggle" aria-expanded="${S.entryMenu}" aria-label="${S.entryMenu ? "收起记账方式" : "展开记账方式"}">${I("plus", { size: 26, w: 2.1 })}</button></div>`
      : `<button type="button" class="u-tab" data-act="tab" data-to="${t.id}" ${S.route.name === t.id ? 'aria-current="page"' : ""}><span class="u-tab-ic">${I(t.icon, { size: 22 })}</span><span>${LV.tabLabel(t)}</span></button>`).join("")}</nav></div>`;
  }
  function entryCards() {
    return `<div class="u-shelf ${M("shelf")}" ${S.entryMenu ? "" : 'aria-hidden="true"'}><p class="u-shelf-t">记一笔</p><div class="u-shelf-row">${LV.ENTRY_ACTIONS.map((a) => `<button type="button" class="u-app" data-act="menu-item" data-label="${a.label}" aria-label="${a.label}" ${S.entryMenu ? "" : 'tabindex="-1"'}><span class="u-app-ic ${M("shelfIcon")}">${I(a.icon, { size: 23 })}</span><span class="short">${a.short}</span><span class="full">${a.label}</span></button>`).join("")}</div></div>`;
  }
  function batchBar() { return `<div class="u-dock ${M("dock")}" data-region="batch">${regions.batch()}</div>`; }

  /* ================= 分析 ================= */
  const cardHead = (key) => `<button type="button" class="u-ch" data-act="card" data-key="${key}"><span class="u-ch-t">${LV.CARDS[key].title}</span><span class="u-ch-w">${LV.CARDS[key].window}</span>${I("right", { size: 15 })}</button>`;
  const pct = (r) => (r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(1)}%`);
  function chartFor(key, a, big) {
    switch (key) {
      case "where": {
        const top = a.where.cats.slice(0, 5), rest = a.where.cats.length - top.length;
        return `<div class="u-where ${big ? "big" : ""}"><div class="u-donut">${LV.chart.donut(a.where.cats, { size: big ? 168 : 132, thick: big ? 16 : 13, gap: 3, round: true, max: 6, label: "支出分类构成" })}<div class="u-donut-c"><span>本月支出</span><b>${yuan(a.where.total)}</b></div></div><ul class="u-legend">${top.map((c) => `<li><i style="--hue:${c.hue}"></i><span class="n">${c.name}</span><span class="v">${LV.short(c.value)}</span><span class="p">${(c.share * 100).toFixed(0)}%</span></li>`).join("")}${rest > 0 ? `<li class="rest">另有 ${rest} 项</li>` : ""}</ul></div>`;
      }
      case "overview": return `<dl class="u-sum-grid u-quad"><div><dt>总支出</dt><dd class="u-big">${yuan(a.overview.total)}</dd></div><div><dt>较上期变化</dt><dd class="u-big ${a.overview.change > 0 ? "up" : "down"}">${pct(a.overview.change)}</dd></div><div class="u-sub"><dt>日均支出</dt><dd>${yuan(a.overview.daily)}</dd></div><div class="u-sub"><dt>支出笔数</dt><dd>${a.overview.count}<small class="inline"> 笔</small></dd></div></dl>`;
      case "daily": return `${LV.chart.bars(a.daily.days.map((d) => ({ label: d.label, value: d.value, hi: d.date === a.daily.max.date })), { cls: "u-bars", label: "近 7 天每日支出" })}<dl class="u-pair"><div><dt>总支出</dt><dd>${yuan(a.daily.total)}</dd></div><div><dt>支出最多的一天</dt><dd>${a.daily.max.md} · ${yuan(a.daily.max.value)}</dd></div></dl>`;
      case "rise": case "fall": { const c = a[key]; return c ? `<p class="u-mini-name"><i style="--hue:${c.hue}"></i>${c.name}</p><p class="u-mini-v ${key}">${c.diff >= 0 ? "+" : "−"}${yuan(Math.abs(c.diff))}</p><p class="u-mini-s">${c.rate == null ? "上期无支出" : pct(c.rate)}</p>` : '<p class="u-mini-s">暂无数据</p>'; }
      case "large": return LV.chart.rank(a.large.map((e) => ({ id: e.id, name: e.note, value: e.amount, hue: LV.cat(e.category).hue, meta: `${LV.dayParts(e.date).md} · ${LV.cat(e.category).name} · ${LV.pay(e.payment).name}` })), { cls: "u-rank", act: "entry" });
      case "change": return LV.chart.diverge(a.changes);
      case "weekday": return LV.chart.bars(a.weekday.map((d) => ({ label: d.label, value: d.value })), { cls: "u-bars u-bars-alt", label: "按星期支出" });
      case "month": return `${LV.chart.flow(a.month.days, { cls: "u-flow" })}<dl class="u-trio"><div><dt>收入</dt><dd class="inc">${yuan(a.month.income)}</dd></div><div><dt>支出</dt><dd>${yuan(a.month.expense)}</dd></div><div><dt>差额</dt><dd>${yuan(a.month.net)}</dd></div></dl>`;
      case "weeks": return LV.chart.bars(a.weeks.map((w) => ({ label: w.label, value: w.value, partial: w.partial })), { cls: "u-bars u-bars-wide", label: "近 4 周每周支出" });
    }
    return "";
  }
  function statsFilter() {
    if (!S.statsFilterOpen) return "";
    const cats = LV.CATEGORIES.filter((c) => c.kind === "expense");
    return `<div class="u-sf ${M("hero")}"><p class="u-sf-t">分类</p><div class="u-chips">${cats.map((c) => `<button type="button" class="u-chip" data-act="stats-cat" data-id="${c.id}" aria-pressed="${S.statsDraft.includes(c.id)}"><i style="--hue:${c.hue}"></i>${c.name}</button>`).join("")}</div><p class="u-sf-hint">不选即为全部分类。时间沿用每张卡片自己的范围。</p><div class="u-sf-act"><button type="button" class="u-textbtn" data-act="stats-revert">还原</button>${btn("应用", "stats-apply", M("primary"))}</div></div>`;
  }
  function statsPage(ctx) {
    const a = LV.analysis();
    const sumText = `按卡片各自时间 · ${S.statsCats.length ? `分类 ${S.statsCats.length} 项` : "全部分类"}`;
    const carousel = `<div class="u-carousel-wrap"><div class="u-carousel" data-carousel>${["large", "change", "weekday"].map((k) => `<article class="u-slide ${M("card")}">${cardHead(k)}${chartFor(k, a)}</article>`).join("")}</div><div class="u-dots" role="tablist" aria-label="切换卡片">${[0, 1, 2].map((i) => `<button type="button" data-act="dot" data-i="${i}" aria-current="${i === 0}" aria-label="第 ${i + 1} 张"></button>`).join("")}</div></div>`;
    const pair = `<div class="u-pair-card">${["rise", "fall"].map((k) => `<div>${cardHead(k)}${chartFor(k, a)}</div>`).join("")}</div>`;
    const secs = [
      { body: cardHead("overview") + chartFor("overview", a), mat: M("statsOverview"), cls: "u-stat" },
      { body: cardHead("daily") + chartFor("daily", a), mat: M("card"), cls: "u-stat" },
      { body: pair, mat: M("card"), cls: "u-stat", boxCls: "u-box-pair" },
      { body: carousel, box: false, cls: "u-stat u-stat-carousel" },
      { body: cardHead("month") + chartFor("month", a), mat: M("card"), cls: "u-stat" },
      { body: cardHead("weeks") + chartFor("weeks", a), mat: M("card"), cls: "u-stat" },
    ];
    return `<div class="scroll u-scroll" data-page="stats">
      ${tabTop("分析", ctx.ledger.name, `<button type="button" class="u-tool ${M("tool")}" data-act="stats-filter" aria-pressed="${S.statsFilterOpen || S.statsCats.length > 0}" aria-label="筛选">${I("funnel", { size: 19 })}${S.statsCats.length ? '<i class="u-dot"></i>' : ""}</button>` + tool("pencil", "stats-edit", "编辑布局"))}
      ${zone(`<div class="u-intro" data-collapse><p class="u-subtitle">以下结果由已记录的账目计算得出。</p><div class="u-statbar"><button type="button" class="u-sumline ${M("tool")}" data-act="stats-filter"><span>${sumText}</span></button><button type="button" class="u-pill ${M("tool")}" data-act="stats-settings" aria-label="统计设置">CNY · 原币${I("sliders", { size: 15 })}</button></div><div data-region="stats-filter">${statsFilter()}</div></div>`)}
      ${hero(cardHead("where") + chartFor("where", a), M("statsHero"), "u-stat-hero")}
      ${sections(secs)}
      <div class="scroll-end"></div></div></div>`;
  }
  function cardPage(ctx, key) {
    const a = LV.analysis(), src = LV.cardSource(key);
    return `<div class="scroll u-scroll" data-page="card">${innerTop("分析", LV.CARDS[key].title)}${zone(`<div class="u-intro" data-collapse><h1 class="u-title">${LV.CARDS[key].title}</h1><p class="u-subtitle">${LV.CARDS[key].window} · 按人民币原币统计</p></div>`)}
      ${hero(chartFor(key, a, true), key === "where" ? M("statsHero") : key === "overview" ? (M("statsOverview") || M("hero")) : M("hero"), "u-stat-hero")}
      ${sections([{ title: "来源账目", meta: `${src.length} 笔`, body: `<ul class="u-group">${src.map((e) => row(e, { flat: true, from: "stats" })).join("")}</ul>`, mat: M("group") }])}
      <div class="scroll-end"></div></div></div>`;
  }

  /* ================= 账本 / 协作 ================= */
  const ROLE_TONE = { 所有者: "owner", 可编辑: "editor", 仅查看: "viewer" };
  function member(m) {
    const u = LV.DIRECTORY.find((d) => d.name === m.name) || { username: LV.USER.username };
    return `<li class="u-li u-member"><span class="u-av" style="--hue:${m.tone}">${esc(m.name.slice(-1))}</span><span class="u-li-m"><span class="u-li-t">${esc(m.name)}${m.me ? '<em class="u-me-tag">我</em>' : ""}</span><span class="u-li-h">@${m.me ? LV.USER.username : u.username}</span></span><span class="u-role role-${ROLE_TONE[m.role] || "viewer"}">${m.role}</span></li>`;
  }

  /** Activity Log：首先是“记录”，其次才可点击。整行打开对应账目；右侧小按钮看完整变更与技术信息。 */
  function logItem(it) {
    const changes = it.lines.slice(0, 2).map((l) => esc(l.text)).join("；") + (it.lines.length > 2 ? `；另 ${it.lines.length - 2} 项` : "");
    const body = `<span class="u-log-ic tone-${it.tone}" aria-hidden="true">${I(it.icon, { size: 13, w: 2.1 })}</span><span class="u-log-body"><span class="u-log-line"><span class="u-log-s"><b>${esc(it.actor)}</b> <span class="u-log-v">${it.verb}</span> ${esc(it.subject)}</span><time class="u-log-time">${it.time}</time></span>${changes ? `<span class="u-log-sub"><span class="u-log-ch">${changes}</span></span>` : it.number ? `<span class="u-log-sub"><span class="u-num">${it.number}</span></span>` : ""}</span>`;
    const label = `${it.actor}${it.verb}${it.subject}，${it.time}`;
    const main = it.entryId
      ? `<button type="button" class="u-log-main" data-act="entry" data-id="${it.entryId}" data-from="history" aria-label="${esc(label)}，打开这笔账目">${body}</button><button type="button" class="u-log-more" data-act="log-detail" data-id="${it.id}" aria-label="查看这条记录的全部变更">${I("info", { size: 17 })}</button>`
      : `<button type="button" class="u-log-main" data-act="log-detail" data-id="${it.id}" aria-label="${esc(label)}，查看记录详情">${body}</button>`;
    return `<li class="u-log-item${it.gone && it.kind !== "member_changed" ? " is-gone" : ""}">${main}</li>`;
  }
  function logState(embedded) {
    if (S.historyState === "loading") return `<ol class="u-log is-loading" aria-busy="true" aria-label="正在加载编辑记录">${[0, 1, 2].map(() => `<li class="u-log-item"><span class="u-log-main"><span class="u-log-ic u-skel"></span><span class="u-log-body"><span class="u-skel u-skel-l"></span><span class="u-skel u-skel-s"></span></span></span></li>`).join("")}</ol>`;
    if (S.historyState === "error") return `<div class="u-state is-error" role="alert"><span class="u-state-ic">${I("cloudOff", { size: 20 })}</span><div><p class="u-state-t">编辑记录没有加载出来</p><p class="u-state-d">网络不稳定或服务器暂时没有响应。账目本身不受影响。</p></div>${btn("重试", "history-retry", M(embedded ? "secondaryIn" : "secondary"))}</div>`;
    return null;
  }
  function recentLog() {
    const st = logState(true);
    if (st) return st;
    const items = LV.historyItems(4);
    return items.length ? `<ol class="u-log">${items.map(logItem).join("")}</ol>` : `<p class="u-state-d u-pad">这本账还没有编辑记录。新增、修改、删除账目后会出现在这里。</p>`;
  }
  function inviteForm() {
    const st = S.invite.status;
    return `<form class="u-invite" data-invite data-state="${st}" onsubmit="return false">
      <label class="u-label" for="invite-input">账号编号或用户名</label>
      <div class="u-invite-row"><span class="u-input-wrap ${M("input")}">${I("userPlus", { size: 18 })}<input id="invite-input" type="text" data-input="invite" placeholder="如 10295520 或 wangtong" autocomplete="off" aria-describedby="invite-status" ${st === "sending" ? "readonly" : ""}></span>
      <button type="button" class="u-btn u-btn-invite ${M("primary")}" data-act="invite" data-invite-submit disabled><span class="u-spin" aria-hidden="true"></span><span class="u-btn-l">邀请</span><span class="u-btn-busy">发送中</span></button></div>
      <p class="u-help" id="invite-status" data-region="invite-status" aria-live="polite">${regions["invite-status"]()}</p>
      <button type="button" class="u-link" data-act="toast" data-msg="邀请权限与已发出的邀请在子页面中（原型未包含）">选择对方的权限，或查看已发出的邀请 ›</button>
    </form>`;
  }
  function ledgerPage(ctx) {
    const l = ctx.ledger, shared = l.members.length >= 2, t = shared ? "协作" : "账本";
    const meta = `<span class="mono">${l.number}</span> · ${l.members.length} 人 · ${LV.ledgerEntries().length} 笔账目`;
    const card = v().ledgerCard === "inline"
      // C：信息在左，紧凑的“切换”在右；不再用整块巨大的切换区域
      ? `<div class="u-book u-book-inline"><div class="u-book-main"><p class="u-eyebrow">当前账本</p><h2 class="u-book-t">${esc(l.name)}</h2><p class="u-book-meta">${meta}</p><button type="button" class="u-link" data-act="toast" data-msg="账本详情子页面不在本轮范围">查看详情 ›</button></div>${btn("切换", "sheet", M("secondary") + " u-book-swap", 'data-type="ledger" aria-label="切换账本"', "swap")}</div>`
      : `<div class="u-book"><p class="u-eyebrow">当前账本</p><h2 class="u-book-t">${esc(l.name)}</h2><p class="u-book-meta">${meta}</p><div class="u-book-acts">${btn("切换账本", "sheet", M("secondaryIn"), 'data-type="ledger"', "swap")}<button type="button" class="u-textbtn" data-act="toast" data-msg="账本详情子页面不在本轮范围">查看详情 ›</button></div></div>`;
    const secs = [
      { title: "成员", meta: `${l.members.length} 人`, aside: `<button type="button" class="u-sec-link" data-act="toast" data-msg="成员管理子页面不在本轮范围">管理</button>`, body: `<ul class="u-list-plain">${l.members.map(member).join("")}</ul>`, mat: M("members") },
      { title: "编辑记录", aside: `<button type="button" class="u-sec-link" data-act="history-all">查看全部 ›</button>`, body: recentLog(), mat: M("log"), region: "ledger-log" },
      { title: "邀请成员", body: inviteForm(), mat: M("invite"), boxCls: "u-box-form" },
    ];
    return `<div class="scroll u-scroll" data-page="ledger">${tabTop(t, l.name, tool("bell", "toast", "通知", 'data-msg="没有新的通知"') + tool("gear", "toast", "账本设置", 'data-msg="账本设置子页面不在本轮范围"'))}
      ${zone(`<div class="u-intro" data-collapse><p class="u-subtitle">${shared ? `共享账本 · ${l.members.length} 位成员可以看到这本账` : "这本账目前只有你一个人在用。"}</p></div>`)}
      ${hero(card, M("hero"), "u-hero-book")}${sections(secs)}<div class="scroll-end"></div></div></div>`;
  }

  function historyPage(ctx) {
    const st = logState(false);
    const groups = st ? null : LV.historyGroups(LV.historyItems());
    const body = st ? sections([{ body: st, mat: M("log") }])
      : sections(groups.map((g) => ({ title: g.label, meta: `${g.items.length} 条`, body: `<ol class="u-log">${g.items.map(logItem).join("")}</ol>`, mat: M("log") }))) + `<p class="u-foot-note">已显示全部 ${LV.historyCount()} 条记录</p>`;
    return `<div class="scroll u-scroll" data-page="history">${innerTop(ctx.ledger.members.length >= 2 ? "协作" : "账本", "编辑记录")}${zone(`<div class="u-intro" data-collapse><h1 class="u-title">编辑记录</h1><p class="u-subtitle">${esc(ctx.ledger.name)} · 谁在什么时候改了哪一笔</p></div>`)}
      <div data-region="history">${body}</div><div class="scroll-end"></div></div></div>`;
  }

  /* ================= 我的 / 设置 ================= */
  const navLi = (it, act) => `<li><button type="button" class="u-li u-li-nav" data-act="${act}" data-id="${it.id}" data-label="${it.label}" ${it.to ? `data-to="${it.to}"` : ""}>${it.icon ? `<span class="u-li-ic">${I(it.icon, { size: 19 })}</span>` : ""}<span class="u-li-m"><span class="u-li-t">${it.label}</span>${it.hint ? `<span class="u-li-h">${esc(it.hint)}</span>` : ""}</span>${it.value ? `<span class="u-li-val">${esc(it.value)}</span>` : ""}${I("right", { size: 16, cls: "u-chev" })}</button></li>`;
  function settingLi(it) {
    if (it.type === "toggle") {
      const on = !!S.toggles[it.id];
      return `<li class="u-li u-li-toggle ${it.disabled ? "is-disabled" : ""}"><span class="u-li-m"><span class="u-li-t" id="t-${it.id}">${it.label}</span>${it.hint ? `<span class="u-li-h">${esc(it.hint)}</span>` : ""}</span><span class="sr" data-toggle-state>${on ? "已开启" : "已关闭"}</span><button type="button" class="u-switch" role="switch" data-act="toggle" data-id="${it.id}" aria-checked="${on}" aria-labelledby="t-${it.id}" ${it.disabled ? 'aria-disabled="true" data-reason="需要先联网取得汇率数据"' : ""}><i></i></button></li>`;
    }
    if (it.type === "action") return `<li><button type="button" class="u-li u-li-action tone-${it.tone}" data-act="setting-action" data-id="${it.id}"><span class="u-li-m"><span class="u-li-t">${it.label}</span>${it.hint ? `<span class="u-li-h">${esc(it.hint)}</span>` : ""}</span></button></li>`;
    return navLi(it, "setting");
  }
  const settingGroups = (groups) => sections(groups.map((g) => ({ title: g.title, body: `<ul class="u-list-plain">${g.items.map(settingLi).join("")}</ul>`, mat: M("setGroup"), foot: g.foot })));
  function mePage(ctx) {
    const u = ctx.user;
    const card = `<div class="u-me"><div class="u-avatar" aria-hidden="true">${I("leaf", { size: 32, w: 1.5 })}</div><div class="u-me-m"><p class="u-pname">${esc(u.name)}</p><p class="u-puser">@${u.username} · <span class="mono">${u.account}</span></p></div></div>`;
    return `<div class="scroll u-scroll" data-page="me">${tabTop("我的", u.name, tool("bell", "toast", "通知", 'data-msg="没有新的通知"'))}${zone(`<div class="u-intro" data-collapse></div>`)}
      ${hero(card, M("hero"), "u-hero-me")}
      ${sections([{ body: `<ul class="u-list-plain">${LV.ME_LINKS().map((it) => navLi(it, "me-link")).join("")}</ul>`, mat: M("setGroup") }, { body: `<button type="button" class="u-btn u-btn-wide ${M("signout")}" data-act="signout">退出登录</button>`, box: false, cls: "u-sec-act" }])}
      <div class="scroll-end"></div></div></div>`;
  }
  function settingsPage() {
    return `<div class="scroll u-scroll" data-page="settings">${innerTop("我的", "设置")}${zone(`<div class="u-intro" data-collapse><h1 class="u-title">设置</h1></div>`)}${settingGroups(LV.SETTINGS)}<p class="u-foot-note">Libevra ${LV.USER.version}</p><div class="scroll-end"></div></div></div>`;
  }
  function subSettingsPage(ctx, sub) {
    const d = LV.SUBSETTINGS[sub];
    return `<div class="scroll u-scroll" data-page="subsettings">${innerTop("设置", d.title)}${zone(`<div class="u-intro" data-collapse><h1 class="u-title">${d.title}</h1></div>`)}${settingGroups(d.groups)}<div class="scroll-end"></div></div></div>`;
  }

  /* ================= 账目详情 ================= */
  function entryPage(ctx, e) {
    const c = LV.cat(e.category), p = LV.dayParts(e.date);
    const back = { history: "编辑记录", ledger: "协作", stats: "分析" }[S.route.parent] || "明细";
    const f = (k, val) => `<li class="u-li u-field"><span class="u-li-k">${k}</span><span class="u-li-v">${val}</span></li>`;
    const by = LV.ledger().members.find((m) => m.name === e.by);
    const head = `<div class="u-entry"><div class="u-entry-top">${ico(c)}<span class="u-entry-cat">${esc(c.name)} · ${p.md} ${p.weekday} ${e.time}</span></div><p class="u-entry-amt ${e.kind}">${LV.entryMoneyHTML(e)}</p><p class="u-entry-note">${esc(e.note) || "（无备注）"}</p></div>`;
    const fields = `<ul class="u-list-plain">${f("支付方式", esc(LV.pay(e.payment).name))}${f("币种", `${LV.cur(e.currency).name} ${e.currency}`)}${f("标签", e.tags.length ? e.tags.map((t) => `<span class="u-tag">${esc(LV.tag(t).name)}</span>`).join("") : '<span class="u-muted">没有标签</span>')}${f("附件", e.attachments ? `<span class="u-file">${I("clip", { size: 14 })}${e.attachments} 个文件</span>` : '<span class="u-muted">无</span>')}${f("记录人", `${by ? `<span class="u-av sm" style="--hue:${by.tone}">${esc(by.name.slice(-1))}</span>` : ""}${esc(e.by)}`)}${f("编号", `<span class="u-num">#${e.number.slice(1).padStart(6, "0")}</span>`)}</ul>`;
    return `<div class="scroll u-scroll" data-page="entry">${innerTop(back, "记账详情")}${zone(`<div class="u-intro" data-collapse><h1 class="u-title">记账详情</h1></div>`)}
      ${hero(head, M("hero"), "u-hero-entry")}
      ${sections([
        { body: fields, mat: M("fields") },
        { body: `<div class="u-actions">${btn("修改", "entry-edit", M("primary"), "", "pencil")}${btn("复制这一笔", "entry-copy", M("secondary"), "", "copy")}</div><button type="button" class="u-danger-link" data-act="entry-delete" data-id="${e.id}">${I("trash", { size: 17 })}删除这笔记账</button>`, box: false, cls: "u-sec-act" },
      ])}<div class="scroll-end"></div></div></div>`;
  }

  /* ================= 局部刷新区域 ================= */
  const regions = {
    list, summary, toolbar,
    "search-scope": (ctx) => `搜索范围：${esc(ctx.timeLabel)}${S.query ? ` · 找到 ${ctx.list.length} 笔` : ""}`,
    "stats-filter": () => statsFilter(),
    "ledger-log": () => recentLog(),
    history: (ctx) => {
      const st = logState(false);
      if (st) return sections([{ body: st, mat: M("log") }]);
      return sections(LV.historyGroups(LV.historyItems()).map((g) => ({ title: g.label, meta: `${g.items.length} 条`, body: `<ol class="u-log">${g.items.map(logItem).join("")}</ol>`, mat: M("log") }))) + `<p class="u-foot-note">已显示全部 ${LV.historyCount()} 条记录</p>`;
    },
    "invite-status": () => {
      const st = S.invite.status;
      if (st === "sent") return `<span class="u-msg is-ok">${I("check", { size: 15, w: 2.2 })}<span>${esc(S.invite.msg)}</span></span>`;
      if (st === "error") return `<span class="u-msg is-err">${I("alert", { size: 15 })}<span>${esc(S.invite.msg)}</span></span>`;
      if (st === "sending") return `<span class="u-msg">正在查找并发送邀请…</span>`;
      return `对方会收到一条邀请，接受之后才会真正加入。默认权限为「可编辑」。`;
    },
    batch: () => { const n = S.selected.size; return `<div class="u-batch-row"><span class="u-batch-n">已选 <b>${n}</b> 笔</span>${btn("修改", "batch-edit", M("secondaryIn"), n ? "" : "disabled", "pencil")}${btn("删除", "batch-delete", M("secondaryIn") + " is-danger", n ? "" : "disabled", "trash")}</div>`; },
  };

  /* ---------- 背景（Canvas） ---------- */
  const BG = {
    a: `<div class="bg-a"><i class="bg-a-light"></i></div>`,
    b1: `<div class="bg-b1"><i class="fog f1"></i><i class="fog f2"></i><i class="fog f3"></i><i class="grain"></i></div>`,
    b2: `<div class="bg-b2"><svg viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
      <defs>
        <linearGradient id="g2base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s-base1"/><stop offset=".55" class="s-base2"/><stop offset="1" class="s-base3"/></linearGradient>
        <radialGradient id="g2brand"><stop offset="0" class="s-brand" stop-opacity=".78"/><stop offset=".7" class="s-brand" stop-opacity=".62"/><stop offset="1" class="s-brand" stop-opacity="0"/></radialGradient>
        <radialGradient id="g2warm"><stop offset="0" class="s-warm"/><stop offset=".68" class="s-warm" stop-opacity=".85"/><stop offset="1" class="s-warm" stop-opacity="0"/></radialGradient>
        <radialGradient id="g2mist"><stop offset="0" class="s-mist"/><stop offset=".7" class="s-mist" stop-opacity=".85"/><stop offset="1" class="s-mist" stop-opacity="0"/></radialGradient>
        <radialGradient id="g2flare"><stop offset="0" class="s-flare"/><stop offset=".55" class="s-flare" stop-opacity=".9"/><stop offset="1" class="s-flare" stop-opacity="0"/></radialGradient>
        <linearGradient id="g2band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="s-band1"/><stop offset="1" class="s-band2"/></linearGradient>
      </defs>
      <rect width="390" height="844" fill="url(#g2base)"/>
      <path d="M-20 548 C 80 470, 170 600, 270 520 S 400 450, 420 470 L 420 560 C 340 560, 300 640, 200 620 S 40 600, -20 650 Z" fill="url(#g2band)" opacity=".8"/>
      <ellipse cx="40" cy="250" rx="120" ry="98" fill="url(#g2warm)"/>
      <circle cx="322" cy="176" r="122" fill="url(#g2brand)"/>
      <circle cx="292" cy="140" r="26" fill="url(#g2flare)"/>
      <circle cx="352" cy="772" r="160" fill="url(#g2mist)"/>
      <circle cx="46" cy="718" r="74" fill="url(#g2brand)" opacity=".7"/>
    </svg></div>`,
    c: `<div class="bg-c"></div>`,
  };

  const def = (id) => ({
    name: { a: "Soft Spatial", b1: "Ambient Frost", b2: "Layered Glass", c: "Classic Refined" }[id],
    collapseOffset: 8,
    entriesPage, statsPage, cardPage, ledgerPage, historyPage, mePage, settingsPage, subSettingsPage, entryPage,
    nav, entryCards, batchBar, regions,
    background: () => BG[id],
    sheetFrame: (inner, sh) => `<div class="sheet u-sheetp ${M("sheet")} u-sheet-${sh.type}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${inner}</div>`,
    dialogFrame: (inner) => `<div class="dialog u-dialog ${M("dialog")}" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">${inner}</div>`,
    toast: (msg, action) => `<div class="u-toast ${M("toast")}"><span>${msg}</span>${action ? `<button type="button" data-act="toast-action">${action.label}</button>` : ""}</div>`,
  });
  ["a", "b1", "b2", "c"].forEach((id) => LV.registerStyle(id, def(id)));
  LV.UI = { MAT, V };
})();
