/* 方案 B · Milky Frosted 乳白磨砂（第二轮）
 * 页面顺序与正式版一致。三类表面各司其职：
 *   Frosted —— 真正浮在内容上、需要透出下层的：底部导航、Bottom Sheet、对话框、提示、吸顶栏、记一笔面板；
 *   Satin   —— 基本不透明、带温润高光与柔和渐变的：收支摘要、重点控件（工具圆钮、分段滑块、主按钮、+）；
 *   Content —— 不透明的暖白内容面：账目分组、设置项、图表卡。
 * 普通卡片下面不再垫玻璃底板；雾面背景只在卡片之间和页面顶部露出来。 */
(function () {
  const LV = window.LV, esc = LV.esc, I = LV.icon;
  const S = LV.state;

  const bead = (c, cls = "") => `<span class="b-bead ${cls}" style="--hue:${c.hue}" aria-hidden="true">${esc(c.name.slice(0, 1))}</span>`;

  function row(e, opts = {}) {
    const c = LV.cat(e.category);
    const sub = [opts.flat ? LV.dayLabel(e.date) : "", e.time, LV.pay(e.payment)?.name].filter(Boolean).join(" · ");
    const sel = S.selecting ? `<span class="b-check" aria-hidden="true">${I("check", { size: 14, w: 2.4 })}</span>` : "";
    return `<li><button type="button" class="b-row" data-act="entry" data-id="${e.id}" ${S.selecting ? `aria-pressed="${S.selected.has(e.id)}"` : ""} aria-label="${esc(c.name)} ${esc(e.note)} ${LV.signed(e)}">${sel}${bead(c)}<span class="b-row-main"><span class="b-row-t">${esc(c.name)}${e.note ? `<span class="b-row-note"> · ${esc(e.note)}</span>` : ""}</span><span class="b-row-s">${esc(sub)}${e.attachments ? ` · ${I("clip", { size: 12 })}${e.attachments}` : ""}</span></span><span class="b-amt ${e.kind}">${LV.entryMoneyHTML(e)}</span></button></li>`;
  }

  function list(ctx) {
    const { groups, list: items } = ctx;
    if (!items.length) {
      const msg = S.searchOpen && S.query ? "没有符合条件的账目" : S.kind === "expense" ? "这个月还没有支出" : S.kind === "income" ? "这个月还没有收入" : "这个月还没有账目";
      return `<div class="b-empty"><p>${msg}</p>${S.searchOpen ? "" : '<button type="button" class="b-pill" data-act="menu-toggle">记一笔</button>'}</div>`;
    }
    if (!groups) return `<ul class="b-group">${items.map((e) => row(e, { flat: true })).join("")}</ul>`;
    return groups.map((g) => `<section class="b-day"><h3 class="b-day-h"><span>${g.label}</span><span class="b-day-sum">${g.income ? `<span class="inc">收入 ${LV.money(g.income, "CNY", { symbol: false })}</span>` : ""}${g.expense ? `<span>支出 ${LV.money(g.expense, "CNY", { symbol: false })}</span>` : ""}</span></h3><ul class="b-group">${g.entries.map((e) => row(e)).join("")}</ul></section>`).join("") + (S.month !== "all" ? '<button type="button" class="b-more" data-act="toast" data-msg="原型只载入了 9–11 月的示例数据">加载更早的记录</button>' : "");
  }

  /* Satin 摘要卡：主数字一行、次级数字一行，中间是一条“压进缎面”的刻线 */
  function summary(ctx) {
    const s = ctx.summary;
    const m = (v) => LV.moneyHTML(v, s.currency, { symbol: false });
    return `<div class="b-sum b-satin">
      <div class="b-sum-head"><span>收支概览</span><button type="button" class="b-cur" data-act="currencies" aria-label="全部币种">${s.currency}${I("down", { size: 13 })}</button></div>
      <dl class="b-sum-grid">
        <div><dt>支出</dt><dd class="b-big">${m(s.expense)}</dd></div>
        <div><dt>收入</dt><dd class="b-big inc">${m(s.income)}</dd></div>
        <div class="b-sub"><dt>结余</dt><dd>${m(s.balance)}</dd></div>
        <div class="b-sub"><dt>日均支出</dt><dd>${s.daily == null ? "—" : m(s.daily)}<small>${s.days ? `按 ${s.days} 天计算` : "选择时间范围后显示"}</small></dd></div>
      </dl>
    </div>`;
  }

  function toolbar() {
    return `<div class="b-seg" role="group" aria-label="收支类型" data-kind-track style="--i:${["all", "expense", "income"].indexOf(S.kind)}"><i class="b-seg-pill" aria-hidden="true"></i>${[["all", "全部"], ["expense", "支出"], ["income", "收入"]].map(([v, l]) => `<button type="button" data-act="kind" data-kind-btn data-v="${v}" aria-pressed="${S.kind === v}">${l}</button>`).join("")}</div>`;
  }

  function tools(ctx) {
    if (S.selecting) return `<button type="button" class="b-pill" data-act="batch-exit" aria-label="退出批量操作">取消</button>`;
    return `<button type="button" class="b-disc" data-act="search-open" aria-label="搜索账目">${I("search", { size: 19 })}</button><button type="button" class="b-disc" data-act="sheet" data-type="sort" aria-label="排序 · ${ctx.sortLabel}">${I(S.sort.dir === "desc" ? "sortDesc" : "sortAsc", { size: 19 })}</button><button type="button" class="b-disc" data-act="batch-start" aria-label="批量操作">${I("batch", { size: 19 })}</button><button type="button" class="b-disc" data-act="more" aria-label="更多">${I("more", { size: 19 })}</button>`;
  }

  function entriesPage(ctx) {
    if (S.searchOpen) {
      return `<div class="scroll b-scroll">
        <header class="b-top b-top-solid"><label class="b-search">${I("search", { size: 18 })}<input type="search" data-input="search" placeholder="搜索备注、分类、标签或金额" aria-label="搜索账目" value="${esc(S.query)}" enterkeyhint="search"></label><button type="button" class="b-text-btn" data-act="search-cancel">取消</button></header>
        <p class="b-scope" data-region="search-scope">${regions["search-scope"](ctx)}</p>
        <div class="b-toolbar" data-pin data-region="toolbar">${toolbar(ctx)}</div><div class="b-list" data-region="list">${list(ctx)}</div><div class="scroll-end"></div></div>`;
    }
    const fc = ctx.filterCount;
    const badge = fc ? `<i class="b-badge">${fc}</i>` : "";
    return `<div class="scroll b-scroll">
      <header class="b-top b-top-entries">
        <button type="button" class="b-wordmark b-fade-out" data-act="toast" data-msg="前往账本空间（原型未包含该页）" aria-label="前往账本空间">Libevra</button>
        <button type="button" class="b-fade-in b-compact" data-act="sheet" data-type="filter" tabindex="-1" aria-hidden="true">${esc(ctx.timeLabel)}${badge}${I("down", { size: 14 })}</button>
        <div class="b-tools">${tools(ctx)}</div>
      </header>
      <div class="b-month-row" data-collapse><button type="button" class="b-month" data-act="sheet" data-type="filter" aria-haspopup="dialog" aria-label="筛选 · ${esc(ctx.timeLabel)}">${esc(ctx.timeLabel)}${badge}${I("down", { size: 16 })}</button></div>
      <section class="b-sum-wrap" data-region="summary">${summary(ctx)}</section>
      <div class="b-toolbar" data-pin data-region="toolbar">${toolbar(ctx)}</div>
      <div class="b-list" data-region="list">${list(ctx)}</div>
      <div class="scroll-end"></div></div>`;
  }

  /* ---------- Frosted 底部停靠栏：当前账本说明 + 主导航 ---------- */
  function nav(ctx) {
    const cap = LV.showCaption() ? `<button type="button" class="b-caption" data-act="sheet" data-type="ledger" aria-haspopup="dialog" aria-label="当前账本：${esc(ctx.ledger.name)}，切换账本"><span><span class="cap-k">当前账本：</span>${esc(ctx.ledger.name)}</span>${I("down", { size: 13 })}</button>` : "";
    return `<div class="b-dock">${cap}<nav class="b-tabs" aria-label="主导航">${LV.TABS.map((t) => t.primary
      ? `<div class="b-plus-slot"><button type="button" class="b-plus" data-act="menu-toggle" aria-expanded="${S.entryMenu}" aria-label="${S.entryMenu ? "收起记账方式" : "展开记账方式"}">${I("plus", { size: 26, w: 2.1 })}</button></div>`
      : `<button type="button" class="b-tab" data-act="tab" data-to="${t.id}" ${S.route.name === t.id ? 'aria-current="page"' : ""}><span class="b-tab-ic">${I(t.icon, { size: 22 })}</span><span>${LV.tabLabel(t)}</span></button>`).join("")}</nav></div>`;
  }
  function entryCards() {
    return `<div class="b-shelf" ${S.entryMenu ? "" : 'aria-hidden="true"'}><p class="b-shelf-t">记一笔</p><div class="b-shelf-row">${LV.ENTRY_ACTIONS.map((a, i) => `<button type="button" class="b-app" style="--d:${i}" data-act="menu-item" data-label="${a.label}" aria-label="${a.label}" ${S.entryMenu ? "" : 'tabindex="-1"'}><span class="b-app-ic">${I(a.icon, { size: 24 })}</span><span class="short">${a.short}</span><span class="full">${a.label}</span></button>`).join("")}</div></div>`;
  }
  function batchBar() { return `<div class="b-dock b-batch" data-region="batch">${regions.batch()}</div>`; }

  /* ---------- 分析：Content 卡片直接放在背景上，只有「近 7 天概览」作为摘要用 Satin ---------- */
  const cardHead = (key) => `<button type="button" class="b-ch" data-act="card" data-key="${key}"><span class="b-ch-t">${LV.CARDS[key].title}</span><span class="b-ch-w">${LV.CARDS[key].window}</span>${I("right", { size: 15 })}</button>`;
  const pct = (r) => (r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(1)}%`);
  const yuan = (v) => LV.moneyHTML(v, "CNY", { symbol: false });

  function chartFor(key, a, big) {
    switch (key) {
      case "where": {
        const top = a.where.cats.slice(0, 5), rest = a.where.cats.length - top.length;
        return `<div class="b-where ${big ? "big" : ""}"><div class="b-donut">${LV.chart.donut(a.where.cats, { size: big ? 172 : 140, thick: big ? 18 : 16, gap: 3, round: true, max: 6, label: "支出分类构成" })}<div class="b-donut-c"><span>本月支出</span><b>${yuan(a.where.total)}</b></div></div><ul class="b-legend">${top.map((c) => `<li><i style="--hue:${c.hue}"></i><span class="n">${c.name}</span><span class="v">${LV.short(c.value)}</span><span class="p">${(c.share * 100).toFixed(0)}%</span></li>`).join("")}${rest > 0 ? `<li class="rest">另有 ${rest} 项</li>` : ""}</ul></div>`;
      }
      case "overview": return `<dl class="b-sum-grid b-quad"><div><dt>总支出</dt><dd class="b-big">${yuan(a.overview.total)}</dd></div><div><dt>较上期变化</dt><dd class="b-big ${a.overview.change > 0 ? "up" : "down"}">${pct(a.overview.change)}</dd></div><div class="b-sub"><dt>日均支出</dt><dd>${yuan(a.overview.daily)}</dd></div><div class="b-sub"><dt>支出笔数</dt><dd>${a.overview.count}<small class="inline"> 笔</small></dd></div></dl>`;
      case "daily": return `${LV.chart.bars(a.daily.days.map((d) => ({ label: d.label, value: d.value, hi: d.date === a.daily.max.date })), { cls: "b-bars", label: "近 7 天每日支出" })}<dl class="b-pair"><div><dt>总支出</dt><dd>${yuan(a.daily.total)}</dd></div><div><dt>支出最多的一天</dt><dd>${a.daily.max.md} · ${yuan(a.daily.max.value)}</dd></div></dl>`;
      case "rise": case "fall": { const c = a[key]; return c ? `<p class="b-mini-name"><i style="--hue:${c.hue}"></i>${c.name}</p><p class="b-mini-v ${key}">${c.diff >= 0 ? "+" : "−"}${yuan(Math.abs(c.diff))}</p><p class="b-mini-s">${c.rate == null ? "上期无支出" : pct(c.rate)}</p>` : '<p class="b-mini-s">暂无数据</p>'; }
      case "large": return LV.chart.rank(a.large.map((e) => ({ id: e.id, name: e.note, value: e.amount, hue: LV.cat(e.category).hue, meta: `${LV.dayParts(e.date).md} · ${LV.cat(e.category).name} · ${LV.pay(e.payment).name}` })), { cls: "b-rank", act: "entry" });
      case "change": return LV.chart.diverge(a.changes);
      case "weekday": return LV.chart.bars(a.weekday.map((d) => ({ label: d.label, value: d.value })), { cls: "b-bars b-bars-alt", label: "按星期支出" });
      case "month": return `${LV.chart.flow(a.month.days, { cls: "b-flow" })}<dl class="b-trio"><div><dt>收入</dt><dd class="inc">${yuan(a.month.income)}</dd></div><div><dt>支出</dt><dd>${yuan(a.month.expense)}</dd></div><div><dt>差额</dt><dd>${yuan(a.month.net)}</dd></div></dl>`;
      case "weeks": return LV.chart.bars(a.weeks.map((w) => ({ label: w.label, value: w.value, partial: w.partial })), { cls: "b-bars b-bars-wide", label: "近 4 周每周支出" });
    }
    return "";
  }

  function statsFilter() {
    if (!S.statsFilterOpen) return "";
    const cats = LV.CATEGORIES.filter((c) => c.kind === "expense");
    return `<div class="b-card b-sf"><p class="b-sf-t">分类</p><div class="b-chips">${cats.map((c) => `<button type="button" class="b-chip" data-act="stats-cat" data-id="${c.id}" aria-pressed="${S.statsDraft.includes(c.id)}"><i style="--hue:${c.hue}"></i>${c.name}</button>`).join("")}</div><p class="b-sf-hint">不选即为全部分类。时间沿用每张卡片自己的范围。</p><div class="b-sf-act"><button type="button" class="b-text-btn" data-act="stats-revert">还原</button><button type="button" class="b-pill b-jade" data-act="stats-apply">应用</button></div></div>`;
  }

  const pageTop = (title, sub, right) => `<header class="b-top"><h1 class="b-big-t b-fade-out">${title}</h1><span class="b-fade-in b-compact b-compact-static" aria-hidden="true">${title}<small>${esc(sub)}</small></span><div class="b-tools">${right}</div></header>`;

  function statsPage(ctx) {
    const a = LV.analysis();
    const sumText = `按卡片各自时间 · ${S.statsCats.length ? `分类 ${S.statsCats.length} 项` : "全部分类"}`;
    return `<div class="scroll b-scroll">
      ${pageTop("分析", ctx.ledger.name, `<button type="button" class="b-disc ${S.statsFilterOpen ? "on" : ""}" data-act="stats-filter" aria-expanded="${S.statsFilterOpen}" aria-label="筛选">${I("funnel", { size: 19 })}${S.statsCats.length ? '<i class="b-dot"></i>' : ""}</button><button type="button" class="b-disc" data-act="stats-edit" aria-label="编辑布局">${I("pencil", { size: 19 })}</button>`)}
      <div class="b-intro" data-collapse><p class="b-subtitle">以下结果由已记录的账目计算得出。</p><div class="b-statbar"><button type="button" class="b-sumline" data-act="stats-filter"><span>${sumText}</span></button><button type="button" class="b-pill" data-act="stats-settings" aria-label="统计设置">CNY · 原币统计${I("sliders", { size: 15 })}</button></div><div data-region="stats-filter">${statsFilter()}</div></div>
      <div class="b-stack">
        <article class="b-card">${cardHead("where")}${chartFor("where", a)}</article>
        <article class="b-card b-satin">${cardHead("overview")}${chartFor("overview", a)}</article>
        <article class="b-card">${cardHead("daily")}${chartFor("daily", a)}</article>
        <article class="b-card b-pair-card"><div>${cardHead("rise")}${chartFor("rise", a)}</div><div>${cardHead("fall")}${chartFor("fall", a)}</div></article>
        <div class="b-carousel-wrap"><div class="b-carousel" data-carousel>${["large", "change", "weekday"].map((k) => `<article class="b-card b-slide">${cardHead(k)}${chartFor(k, a)}</article>`).join("")}</div><div class="b-dots" role="tablist" aria-label="切换卡片">${[0, 1, 2].map((i) => `<button type="button" data-act="dot" data-i="${i}" aria-current="${i === 0}" aria-label="第 ${i + 1} 张"></button>`).join("")}</div></div>
        <article class="b-card">${cardHead("month")}${chartFor("month", a)}</article>
        <article class="b-card">${cardHead("weeks")}${chartFor("weeks", a)}</article>
      </div><div class="scroll-end"></div></div>`;
  }

  const innerTop = (back, title) => `<header class="b-top b-top-inner"><button type="button" class="b-back" data-act="back" aria-label="返回${back}">${I("left", { size: 21 })}<span>${back}</span></button><h1 class="b-inner-t">${title}</h1></header>`;

  function cardPage(ctx, key) {
    const a = LV.analysis(), src = LV.cardSource(key);
    return `<div class="scroll b-scroll">${innerTop("分析", LV.CARDS[key].title)}
      <div class="b-stack b-stack-inner"><p class="b-subtitle b-sub-pad">${LV.CARDS[key].window} · 按人民币原币统计</p>
      <article class="b-card ${key === "overview" ? "b-satin" : ""}">${chartFor(key, a, true)}</article>
      <h2 class="b-sec-t">来源账目<span>${src.length} 笔</span></h2><ul class="b-group">${src.map((e) => row(e, { flat: true })).join("")}</ul></div>
      <div class="scroll-end"></div></div>`;
  }

  /* ---------- 账本 / 协作 ---------- */
  function ledgerPage(ctx) {
    const l = ctx.ledger, shared = l.members.length >= 2, t = shared ? "协作" : "账本";
    return `<div class="scroll b-scroll">${pageTop(t, l.name, `<button type="button" class="b-disc" data-act="toast" data-msg="账本设置子页面不在本轮范围" aria-label="账本设置">${I("gear", { size: 19 })}</button>`)}
      <div class="b-intro" data-collapse><p class="b-subtitle">${shared ? "共享账本" : "单人账本"}</p></div>
      <div class="b-stack">
        <article class="b-card b-satin"><p class="b-eyebrow">当前账本</p><h2 class="b-book-title">${esc(l.name)}</h2><p class="b-book-meta"><span class="mono">${l.number}</span> · ${l.members.length} 人 · ${LV.ledgerEntries().length} 笔账目</p><div class="b-row-btns"><button type="button" class="b-pill b-jade" data-act="sheet" data-type="ledger">${I("swap", { size: 17 })}切换账本</button><button type="button" class="b-pill" data-act="toast" data-msg="账本详情子页面不在本轮范围">查看详情</button></div></article>
        <section><h2 class="b-sec-t">成员<span>${l.members.length} 人</span></h2>
          <ul class="b-group">${l.members.map((m) => `<li class="b-li b-li-static"><span class="b-av" style="--hue:${m.tone}">${esc(m.name.slice(-1))}</span><span class="b-li-m"><span class="b-li-t">${esc(m.name)}${m.me ? "<em>我</em>" : ""}</span></span><span class="b-li-r">${m.role}</span></li>`).join("")}<li><button type="button" class="b-li b-li-link" data-act="toast" data-msg="成员管理子页面不在本轮范围"><span class="b-li-m"><span class="b-li-t">成员管理</span></span>${I("right", { size: 16, cls: "b-chev" })}</button></li></ul></section>
        <section><h2 class="b-sec-t">邀请成员</h2>
          <div class="b-card"><p class="b-hint-p">输入账号编号或用户名发送邀请，对方接受后加入账本。</p><div class="b-invite"><input type="text" data-input="invite" placeholder="账号编号或用户名" aria-label="要邀请谁"><button type="button" class="b-pill b-jade" data-act="invite">邀请</button></div><p class="b-ok" data-region="invite-note" role="status">${esc(S.inviteNote)}</p><button type="button" class="b-link" data-act="toast" data-msg="邀请权限子页面不在本轮范围">选择对方的权限，或查看已发出的邀请 ›</button></div></section>
        <section><h2 class="b-sec-t">编辑记录<button type="button" class="b-link b-link-r" data-act="toast" data-msg="完整编辑记录不在本轮范围">查看全部 ›</button></h2>
          <ul class="b-group">${LV.HISTORY.map((h) => `<li class="b-li b-li-static b-hist"><span class="b-av sm" style="--hue:${(l.members.find((m) => m.name === h.who) || l.members[0]).tone}">${esc(h.who.slice(-1))}</span><span class="b-li-m"><span class="b-li-t"><b>${esc(h.who)}</b> ${h.what} ${esc(h.target)}</span><span class="b-li-h">${h.when}</span></span>${h.amount ? `<span class="b-li-r b-num">${h.amount}</span>` : ""}</li>`).join("")}</ul></section>
      </div><div class="scroll-end"></div></div>`;
  }

  /* ---------- 我的 / 设置：身份区用 Satin，列表用 Content ---------- */
  const li = (it, act) => `<li><button type="button" class="b-li" data-act="${act}" data-id="${it.id}" data-label="${it.label}"><span class="b-li-ic">${I(it.icon, { size: 19 })}</span><span class="b-li-m"><span class="b-li-t">${it.label}</span>${it.hint ? `<span class="b-li-h">${esc(it.hint)}</span>` : ""}</span>${I("right", { size: 16, cls: "b-chev" })}</button></li>`;
  function mePage(ctx) {
    const u = ctx.user;
    return `<div class="scroll b-scroll">${pageTop("我的", u.name, `<button type="button" class="b-disc" data-act="toast" data-msg="没有新的通知" aria-label="通知">${I("bell", { size: 19 })}</button>`)}
      <div class="b-stack" data-collapse>
        <section class="b-card b-satin b-me"><div class="b-avatar" aria-hidden="true">${I("leaf", { size: 36, w: 1.5 })}</div><p class="b-pname">${esc(u.name)}</p><p class="b-puser">@${u.username}</p></section>
        <ul class="b-group">${LV.ME_LINKS().map((it) => li(it, "me-link")).join("")}</ul>
        <button type="button" class="b-signout" data-act="signout">退出登录</button>
      </div><div class="scroll-end"></div></div>`;
  }
  function settingsPage() {
    return `<div class="scroll b-scroll">${innerTop("我的", "设置")}<div class="b-stack b-stack-inner">${LV.SETTINGS.map((g) => `<ul class="b-group">${g.map((it) => li(it, "setting")).join("")}</ul>`).join("")}<p class="b-foot-note">Libevra ${LV.USER.version}</p></div><div class="scroll-end"></div></div>`;
  }

  /* ---------- 账目详情 ---------- */
  function entryPage(ctx, e) {
    const c = LV.cat(e.category), p = LV.dayParts(e.date);
    const f = (k, v) => `<li class="b-li b-li-static b-field"><span class="b-li-k">${k}</span><span class="b-li-v">${v}</span></li>`;
    return `<div class="scroll b-scroll">${innerTop("明细", "记账详情")}
      <div class="b-stack b-stack-inner">
        <section class="b-card b-satin b-entry-hero">${bead(c, "lg")}<div><p class="b-entry-cat">${esc(c.name)} · ${p.md} ${p.weekday}</p><p class="b-entry-amt ${e.kind}">${LV.entryMoneyHTML(e)}</p><p class="b-entry-note">${esc(e.note) || "（无备注）"}</p></div></section>
        <ul class="b-group">${f("时间", `${e.date.replace(/-/g, "/")} ${e.time}`)}${f("分类", esc(c.name))}${f("支付方式", esc(LV.pay(e.payment).name))}${f("币种", `${e.currency} · ${LV.cur(e.currency).name}`)}${f("标签", e.tags.length ? e.tags.map((t) => `<span class="b-tag">${esc(LV.tag(t).name)}</span>`).join("") : '<span class="b-muted">没有标签</span>')}${f("记录人", esc(e.by))}${f("附件", e.attachments ? `${I("clip", { size: 14 })}${e.attachments} 个文件` : '<span class="b-muted">无</span>')}${f("编号", `<span class="mono">${e.number}</span>`)}</ul>
        <div class="b-actions"><button type="button" class="b-pill b-jade b-pill-lg" data-act="entry-edit">${I("pencil", { size: 18 })}修改</button><button type="button" class="b-pill b-pill-lg" data-act="entry-copy">${I("copy", { size: 18 })}复制这一笔</button></div>
        <button type="button" class="b-danger-link" data-act="entry-delete" data-id="${e.id}">${I("trash", { size: 17 })}删除这笔记账</button>
      </div><div class="scroll-end"></div></div>`;
  }

  const regions = {
    list, summary, toolbar,
    "search-scope": (ctx) => `搜索范围：${esc(ctx.timeLabel)}${S.query ? ` · 找到 ${ctx.list.length} 笔` : ""}`,
    "stats-filter": () => statsFilter(),
    "invite-note": () => esc(S.inviteNote),
    batch: () => { const n = S.selected.size; return `<div class="b-batch-row"><span class="b-batch-n">已选 <b>${n}</b> 笔</span><button type="button" class="b-pill" data-act="batch-edit" ${n ? "" : "disabled"}>${I("pencil", { size: 17 })}修改</button><button type="button" class="b-pill b-pill-danger" data-act="batch-delete" ${n ? "" : "disabled"}>${I("trash", { size: 17 })}删除</button></div>`; },
  };

  LV.registerStyle("b", {
    name: "Milky Frosted",
    collapseOffset: 8,
    entriesPage, statsPage, cardPage, ledgerPage, mePage, settingsPage, entryPage,
    nav, entryCards, batchBar, regions,
    background: () => `<div class="b-bg" aria-hidden="true"><i class="b-blob b1"></i><i class="b-blob b2"></i><i class="b-blob b3"></i><i class="b-blob b4"></i><i class="b-grain"></i></div>`,
    sheetFrame: (inner, sh) => `<div class="sheet b-sheet b-sheet-${sh.type}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${inner}</div>`,
    dialogFrame: (inner) => `<div class="dialog b-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">${inner}</div>`,
    toast: (msg, action) => `<div class="b-toast"><span>${msg}</span>${action ? `<button type="button" data-act="toast-action">${action.label}</button>` : ""}</div>`,
  });
})();
