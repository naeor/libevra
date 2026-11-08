/* 方案 A · Soft Spatial 柔和空间（第二轮）
 * 页面顺序与正式版一致：字标+工具 → 月份 → 收支摘要 → 全部/支出/收入 → 按日分组列表 → 当前账本说明 + 底栏。
 * 只有一种白色表面，靠两级投影区分：摘要卡（悬浮）与其它内容卡（贴近背景）。不再叠加容器。 */
(function () {
  const LV = window.LV, esc = LV.esc, I = LV.icon;
  const S = LV.state;

  const ico = (e) => { const c = LV.cat(e.category); return `<span class="a-ico" style="--hue:${c.hue}" aria-hidden="true">${esc(c.name.slice(0, 1))}</span>`; };

  function row(e, opts = {}) {
    const c = LV.cat(e.category);
    const sub = [opts.flat ? LV.dayLabel(e.date) : "", e.time, LV.pay(e.payment)?.name].filter(Boolean).join(" · ");
    const sel = S.selecting ? `<span class="a-check" aria-hidden="true">${I("check", { size: 14, w: 2.4 })}</span>` : "";
    return `<li><button type="button" class="a-row" data-act="entry" data-id="${e.id}" ${S.selecting ? `aria-pressed="${S.selected.has(e.id)}"` : ""} aria-label="${esc(c.name)} ${esc(e.note)} ${LV.signed(e)}">${sel}${ico(e)}<span class="a-row-main"><span class="a-row-t">${esc(c.name)}${e.note ? `<span class="a-row-note"> · ${esc(e.note)}</span>` : ""}</span><span class="a-row-s">${esc(sub)}${e.attachments ? ` · ${I("clip", { size: 12 })}${e.attachments}` : ""}</span></span><span class="a-amt ${e.kind}">${LV.entryMoneyHTML(e)}</span></button></li>`;
  }

  function list(ctx) {
    const { groups, list: items } = ctx;
    if (!items.length) {
      const msg = S.searchOpen && S.query ? "没有符合条件的账目" : S.kind === "expense" ? "这个月还没有支出" : S.kind === "income" ? "这个月还没有收入" : S.month === "all" ? "还没有账目" : "这个月还没有账目";
      return `<div class="a-empty"><p>${msg}</p>${S.searchOpen ? "" : '<button type="button" class="a-btn-soft" data-act="menu-toggle">记一笔</button>'}</div>`;
    }
    if (!groups) return `<ul class="a-group a-flat">${items.map((e) => row(e, { flat: true })).join("")}</ul>`;
    return groups.map((g) => `<section class="a-day"><h3 class="a-day-h"><span>${g.label}</span><span class="a-day-sum">${g.income ? `<span class="inc">收入 ${LV.money(g.income, "CNY", { symbol: false })}</span>` : ""}${g.expense ? `<span>支出 ${LV.money(g.expense, "CNY", { symbol: false })}</span>` : ""}</span></h3><ul class="a-group">${g.entries.map((e) => row(e)).join("")}</ul></section>`).join("") + (S.month !== "all" ? '<button type="button" class="a-more" data-act="toast" data-msg="原型只载入了 9–11 月的示例数据">加载更早的记录</button>' : "");
  }

  /* 一张卡、一层白色：主数字一行，次级数字一行，中间只用一条细线 */
  function summary(ctx) {
    const s = ctx.summary;
    const m = (v) => LV.moneyHTML(v, s.currency, { symbol: false });
    return `<div class="a-sum">
      <div class="a-sum-head"><span>收支概览</span><button type="button" class="a-cur" data-act="currencies" aria-label="全部币种">${s.currency}${I("down", { size: 14 })}</button></div>
      <dl class="a-sum-grid">
        <div><dt>支出</dt><dd class="a-big">${m(s.expense)}</dd></div>
        <div><dt>收入</dt><dd class="a-big inc">${m(s.income)}</dd></div>
        <div class="a-sub"><dt>结余</dt><dd>${m(s.balance)}</dd></div>
        <div class="a-sub"><dt>日均支出</dt><dd>${s.daily == null ? "—" : m(s.daily)}<small>${s.days ? `按 ${s.days} 天计算` : "选择时间范围后显示"}</small></dd></div>
      </dl>
    </div>`;
  }

  function toolbar() {
    return `<div class="a-seg" role="group" aria-label="收支类型" data-kind-track style="--i:${["all", "expense", "income"].indexOf(S.kind)}"><i class="a-seg-pill" aria-hidden="true"></i>${[["all", "全部"], ["expense", "支出"], ["income", "收入"]].map(([v, l]) => `<button type="button" data-act="kind" data-kind-btn data-v="${v}" aria-pressed="${S.kind === v}">${l}</button>`).join("")}</div>`;
  }

  function tools(ctx) {
    if (S.selecting) return `<button type="button" class="a-pill-btn" data-act="batch-exit" aria-label="退出批量操作">取消</button>`;
    return `<button type="button" class="a-tool" data-act="search-open" aria-label="搜索账目">${I("search", { size: 20 })}</button><button type="button" class="a-tool" data-act="sheet" data-type="sort" aria-label="排序 · ${ctx.sortLabel}">${I(S.sort.dir === "desc" ? "sortDesc" : "sortAsc", { size: 20 })}</button><button type="button" class="a-tool" data-act="batch-start" aria-label="批量操作">${I("batch", { size: 20 })}</button><button type="button" class="a-tool" data-act="more" aria-label="更多">${I("more", { size: 20 })}</button>`;
  }

  const monthText = (ctx) => (S.range ? esc(ctx.timeLabel) : esc(ctx.timeLabel));

  function entriesPage(ctx) {
    if (S.searchOpen) {
      return `<div class="scroll a-scroll"><div class="a-field" aria-hidden="true"></div>
        <header class="a-top a-top-search"><label class="a-search">${I("search", { size: 18 })}<input type="search" data-input="search" placeholder="搜索备注、分类、标签或金额" aria-label="搜索账目" value="${esc(S.query)}" enterkeyhint="search"></label><button type="button" class="a-text-btn" data-act="search-cancel">取消</button></header>
        <p class="a-scope" data-region="search-scope">${regions["search-scope"](ctx)}</p>
        <div class="a-toolbar" data-pin data-region="toolbar">${toolbar(ctx)}</div><div class="a-list" data-region="list">${list(ctx)}</div><div class="scroll-end"></div></div>`;
    }
    const fc = ctx.filterCount;
    const badge = fc ? `<i class="a-badge">筛选 ${fc}</i>` : "";
    return `<div class="scroll a-scroll"><div class="a-field" aria-hidden="true"></div>
      <header class="a-top a-top-entries">
        <div class="a-top-brand"><button type="button" class="a-wordmark" data-act="toast" data-msg="前往账本空间（原型未包含该页）" aria-label="前往账本空间">Libevra</button></div>
        <button type="button" class="a-top-compact" data-act="sheet" data-type="filter" tabindex="-1" aria-hidden="true">${monthText(ctx)}${badge}${I("down", { size: 14 })}</button>
        <div class="a-tools">${tools(ctx)}</div>
      </header>
      <div class="a-month-row" data-collapse><button type="button" class="a-month" data-act="sheet" data-type="filter" aria-haspopup="dialog" aria-label="筛选 · ${esc(ctx.timeLabel)}">${monthText(ctx)}${badge}${I("down", { size: 16 })}</button></div>
      <section class="a-sum-wrap" data-region="summary">${summary(ctx)}</section>
      <div class="a-toolbar" data-pin data-region="toolbar">${toolbar(ctx)}</div>
      <div class="a-list" data-region="list">${list(ctx)}</div>
      <div class="scroll-end"></div></div>`;
  }

  /* ---------- 底部：当前账本说明 + 主导航，同一块从底部升起的白色表面 ---------- */
  function nav(ctx) {
    const cap = LV.showCaption() ? `<button type="button" class="a-caption" data-act="sheet" data-type="ledger" aria-haspopup="dialog" aria-label="当前账本：${esc(ctx.ledger.name)}，切换账本"><span><span class="cap-k">当前账本：</span>${esc(ctx.ledger.name)}</span>${I("down", { size: 13 })}</button>` : "";
    return `<div class="a-dock">${cap}<nav class="a-nav" aria-label="主导航">${LV.TABS.map((t) => t.primary
      ? `<div class="a-plus-slot"><button type="button" class="a-plus" data-act="menu-toggle" aria-expanded="${S.entryMenu}" aria-label="${S.entryMenu ? "收起记账方式" : "展开记账方式"}">${I("plus", { size: 26, w: 2.2 })}</button></div>`
      : `<button type="button" class="a-tab" data-act="tab" data-to="${t.id}" ${S.route.name === t.id ? 'aria-current="page"' : ""}>${I(t.icon, { size: 23 })}<span>${LV.tabLabel(t)}</span></button>`).join("")}</nav></div>`;
  }
  function entryCards() {
    return `<div class="a-cards" ${S.entryMenu ? "" : 'aria-hidden="true"'}>${LV.ENTRY_ACTIONS.map((a, i) => `<button type="button" class="a-card-btn" style="--d:${i}" data-act="menu-item" data-label="${a.label}" aria-label="${a.label}" ${S.entryMenu ? "" : 'tabindex="-1"'}><span class="a-card-ic">${I(a.icon, { size: 22 })}</span><span class="short">${a.short}</span><span class="full">${a.label}</span></button>`).join("")}</div>`;
  }
  function batchBar() { return `<div class="a-dock a-batch" data-region="batch">${regions.batch()}</div>`; }

  /* ---------- 分析 ---------- */
  const cardHead = (key) => `<button type="button" class="a-ch" data-act="card" data-key="${key}"><span class="a-ch-t">${LV.CARDS[key].title}</span><span class="a-ch-w">${LV.CARDS[key].window}</span>${I("right", { size: 16 })}</button>`;
  const pct = (r) => (r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(1)}%`);
  const yuan = (v) => LV.moneyHTML(v, "CNY", { symbol: false });

  function chartFor(key, a, big) {
    switch (key) {
      case "where": {
        const top = a.where.cats.slice(0, 5), rest = a.where.cats.length - top.length;
        return `<div class="a-where ${big ? "big" : ""}"><div class="a-donut">${LV.chart.donut(a.where.cats, { size: big ? 168 : 128, thick: big ? 18 : 14, gap: 2.5, max: 6, label: "支出分类构成" })}<div class="a-donut-c"><span>本月支出</span><b>${LV.short(a.where.total)}</b></div></div><ul class="a-legend">${top.map((c) => `<li><i style="--hue:${c.hue}"></i><span class="n">${c.name}</span><span class="p">${(c.share * 100).toFixed(0)}%</span></li>`).join("")}${rest > 0 ? `<li class="rest">另有 ${rest} 项</li>` : ""}</ul></div>`;
      }
      case "overview": return `<dl class="a-quad"><div><dt>总支出</dt><dd>${yuan(a.overview.total)}</dd></div><div><dt>较上期变化</dt><dd class="${a.overview.change > 0 ? "up" : "down"}">${pct(a.overview.change)}</dd></div><div><dt>日均支出</dt><dd>${yuan(a.overview.daily)}</dd></div><div><dt>支出笔数</dt><dd>${a.overview.count}<small> 笔</small></dd></div></dl>`;
      case "daily": return `${LV.chart.bars(a.daily.days.map((d) => ({ label: d.label, value: d.value, hi: d.date === a.daily.max.date })), { cls: "a-bars", label: "近 7 天每日支出" })}<dl class="a-pair"><div><dt>总支出</dt><dd>${yuan(a.daily.total)}</dd></div><div><dt>支出最多的一天</dt><dd>${a.daily.max.md} · ${yuan(a.daily.max.value)}</dd></div></dl>`;
      case "rise": case "fall": { const c = a[key]; return c ? `<p class="a-mini-name"><i style="--hue:${c.hue}"></i>${c.name}</p><p class="a-mini-v ${key}">${c.diff >= 0 ? "+" : "−"}${yuan(Math.abs(c.diff))}</p><p class="a-mini-s">${c.rate == null ? "上期无支出" : pct(c.rate)} · 上期 ${LV.money(c.was, "CNY", { symbol: false })}</p>` : '<p class="a-mini-s">暂无数据</p>'; }
      case "large": return LV.chart.rank(a.large.map((e) => ({ id: e.id, name: e.note, value: e.amount, hue: LV.cat(e.category).hue, meta: `${LV.dayParts(e.date).md} · ${LV.cat(e.category).name} · ${LV.pay(e.payment).name}` })), { cls: "a-rank", act: "entry" });
      case "change": return LV.chart.diverge(a.changes);
      case "weekday": return LV.chart.bars(a.weekday.map((d) => ({ label: d.label, value: d.value })), { cls: "a-bars a-bars-soft", label: "按星期支出" });
      case "month": return `${LV.chart.flow(a.month.days, { cls: "a-flow" })}<dl class="a-trio"><div><dt>收入</dt><dd class="inc">${yuan(a.month.income)}</dd></div><div><dt>支出</dt><dd>${yuan(a.month.expense)}</dd></div><div><dt>差额</dt><dd>${yuan(a.month.net)}</dd></div></dl>`;
      case "weeks": return LV.chart.bars(a.weeks.map((w) => ({ label: w.label, value: w.value, partial: w.partial })), { cls: "a-bars a-bars-wide", label: "近 4 周每周支出" });
    }
    return "";
  }

  function statsFilter() {
    if (!S.statsFilterOpen) return "";
    const cats = LV.CATEGORIES.filter((c) => c.kind === "expense");
    return `<div class="a-sf"><p class="a-sf-t">分类</p><div class="a-chips">${cats.map((c) => `<button type="button" class="a-chip" data-act="stats-cat" data-id="${c.id}" aria-pressed="${S.statsDraft.includes(c.id)}"><i style="--hue:${c.hue}"></i>${c.name}</button>`).join("")}</div><p class="a-sf-hint">不选即为全部分类。时间沿用每张卡片自己的范围。</p><div class="a-sf-act"><button type="button" class="a-text-btn" data-act="stats-revert">还原</button><button type="button" class="a-btn" data-act="stats-apply">应用</button></div></div>`;
  }

  const pageTop = (title, sub, right) => `<header class="a-top"><div class="a-top-brand"><h1 class="a-top-title">${title}</h1></div><div class="a-top-compact a-top-compact-static" aria-hidden="true">${title}<small>${esc(sub)}</small></div><div class="a-tools">${right}</div></header>`;

  function statsPage(ctx) {
    const a = LV.analysis();
    const sumText = `按卡片各自时间 · ${S.statsCats.length ? `分类 ${S.statsCats.length} 项` : "全部分类"}`;
    return `<div class="scroll a-scroll"><div class="a-field" aria-hidden="true"></div>
      ${pageTop("分析", ctx.ledger.name, `<button type="button" class="a-tool ${S.statsFilterOpen ? "on" : ""}" data-act="stats-filter" aria-expanded="${S.statsFilterOpen}" aria-label="筛选">${I("funnel", { size: 20 })}${S.statsCats.length ? '<i class="a-dot"></i>' : ""}</button><button type="button" class="a-tool" data-act="stats-edit" aria-label="编辑布局">${I("pencil", { size: 20 })}</button>`)}
      <div class="a-intro" data-collapse><p class="a-subtitle">以下结果由已记录的账目计算得出。</p>
        <div class="a-statbar"><button type="button" class="a-sumline" data-act="stats-filter"><span>${sumText}</span></button><button type="button" class="a-cur-chip" data-act="stats-settings" aria-label="统计设置">CNY · 原币统计${I("sliders", { size: 15 })}</button></div>
        <div data-region="stats-filter">${statsFilter()}</div>
      </div>
      <div class="a-grid">
        <article class="a-card">${cardHead("where")}${chartFor("where", a)}</article>
        <article class="a-card">${cardHead("overview")}${chartFor("overview", a)}</article>
        <article class="a-card">${cardHead("daily")}${chartFor("daily", a)}</article>
        <article class="a-card a-split"><div>${cardHead("rise")}${chartFor("rise", a)}</div><div>${cardHead("fall")}${chartFor("fall", a)}</div></article>
        <div class="a-carousel-wrap"><div class="a-carousel" data-carousel>${["large", "change", "weekday"].map((k) => `<article class="a-card a-card-slide">${cardHead(k)}${chartFor(k, a)}</article>`).join("")}</div><div class="a-dots" role="tablist" aria-label="切换卡片">${[0, 1, 2].map((i) => `<button type="button" data-act="dot" data-i="${i}" aria-current="${i === 0}" aria-label="第 ${i + 1} 张"></button>`).join("")}</div></div>
        <article class="a-card">${cardHead("month")}${chartFor("month", a)}</article>
        <article class="a-card">${cardHead("weeks")}${chartFor("weeks", a)}</article>
      </div>
      <div class="scroll-end"></div></div>`;
  }

  const innerTop = (back, title) => `<header class="a-top a-top-inner"><button type="button" class="a-back" data-act="back" aria-label="返回${back}">${I("left", { size: 22 })}<span>${back}</span></button><h1 class="a-inner-t">${title}</h1></header>`;

  function cardPage(ctx, key) {
    const a = LV.analysis(), src = LV.cardSource(key);
    return `<div class="scroll a-scroll"><div class="a-field" aria-hidden="true"></div>${innerTop("分析", LV.CARDS[key].title)}
      <div class="a-grid a-grid-inner"><p class="a-subtitle a-sub-pad">${LV.CARDS[key].window} · 按人民币原币统计</p>
      <article class="a-card a-card-detail">${chartFor(key, a, true)}</article>
      <h2 class="a-sec-t">来源账目<span>${src.length} 笔</span></h2><ul class="a-group a-flat">${src.map((e) => row(e, { flat: true })).join("")}</ul></div>
      <div class="scroll-end"></div></div>`;
  }

  /* ---------- 账本 / 协作 ---------- */
  function ledgerPage(ctx) {
    const l = ctx.ledger, shared = l.members.length >= 2, t = shared ? "协作" : "账本";
    return `<div class="scroll a-scroll"><div class="a-field" aria-hidden="true"></div>
      ${pageTop(t, l.name, `<button type="button" class="a-tool" data-act="toast" data-msg="账本设置子页面不在本轮范围" aria-label="账本设置">${I("gear", { size: 20 })}</button>`)}
      <div class="a-intro" data-collapse><p class="a-subtitle">${shared ? "共享账本" : "单人账本"}</p></div>
      <div class="a-grid">
        <article class="a-card"><p class="a-eyebrow">当前账本</p><h2 class="a-book-title">${esc(l.name)}</h2><p class="a-book-meta"><span class="mono">${l.number}</span> · ${l.members.length} 人 · ${LV.ledgerEntries().length} 笔账目</p><div class="a-book-actions"><button type="button" class="a-btn" data-act="sheet" data-type="ledger">${I("swap", { size: 17 })}切换账本</button><button type="button" class="a-btn-soft" data-act="toast" data-msg="账本详情子页面不在本轮范围">查看详情</button></div></article>
        <article class="a-card a-card-list"><div class="a-ch a-ch-static"><span class="a-ch-t">成员</span><span class="a-ch-w">${l.members.length} 人</span></div><ul class="a-members">${l.members.map((m) => `<li><span class="a-av" style="--hue:${m.tone}">${esc(m.name.slice(-1))}</span><span class="a-mem-n">${esc(m.name)}${m.me ? "<em>我</em>" : ""}</span><span class="a-mem-r">${m.role}</span></li>`).join("")}</ul><button type="button" class="a-link" data-act="toast" data-msg="成员管理子页面不在本轮范围">成员管理 ›</button></article>
        <article class="a-card"><div class="a-ch a-ch-static"><span class="a-ch-t">邀请成员</span></div><p class="a-hint-p">输入账号编号或用户名发送邀请，对方接受后加入账本。</p><div class="a-invite"><input type="text" data-input="invite" placeholder="账号编号或用户名" aria-label="要邀请谁"><button type="button" class="a-btn" data-act="invite">邀请</button></div><p class="a-ok" data-region="invite-note" role="status">${esc(S.inviteNote)}</p><button type="button" class="a-link" data-act="toast" data-msg="邀请权限子页面不在本轮范围">选择对方的权限，或查看已发出的邀请 ›</button></article>
        <article class="a-card"><div class="a-ch a-ch-static"><span class="a-ch-t">编辑记录</span><button type="button" class="a-link a-link-r" data-act="toast" data-msg="完整编辑记录不在本轮范围">查看全部 ›</button></div><ul class="a-hist">${LV.HISTORY.map((h) => `<li><span class="a-av sm" style="--hue:${(l.members.find((m) => m.name === h.who) || l.members[0]).tone}">${esc(h.who.slice(-1))}</span><span class="a-hist-m"><span><b>${esc(h.who)}</b> ${h.what} ${esc(h.target)}</span><span class="a-hist-s">${h.when}</span></span>${h.amount ? `<span class="a-hist-a">${h.amount}</span>` : ""}</li>`).join("")}</ul></article>
      </div><div class="scroll-end"></div></div>`;
  }

  /* ---------- 我的 / 设置：与列表同一种白色分组 ---------- */
  const listRow = (it, act) => `<li><button type="button" class="a-li" data-act="${act}" data-id="${it.id}" data-label="${it.label}"><span class="a-li-ic">${I(it.icon, { size: 19 })}</span><span class="a-li-m"><span class="a-li-t">${it.label}</span>${it.hint ? `<span class="a-li-h">${esc(it.hint)}</span>` : ""}</span>${I("right", { size: 17, cls: "a-li-chev" })}</button></li>`;
  function mePage(ctx) {
    const u = ctx.user;
    return `<div class="scroll a-scroll"><div class="a-field" aria-hidden="true"></div>
      ${pageTop("我的", u.name, `<button type="button" class="a-tool" data-act="toast" data-msg="没有新的通知" aria-label="通知">${I("bell", { size: 20 })}</button>`)}
      <div class="a-profile" data-collapse><div class="a-avatar" aria-hidden="true">${I("leaf", { size: 40, w: 1.5 })}</div><p class="a-pname">${esc(u.name)}</p><p class="a-puser">@${u.username}</p></div>
      <div class="a-grid"><ul class="a-group a-menu">${LV.ME_LINKS().map((it) => listRow(it, "me-link")).join("")}</ul>
      <button type="button" class="a-signout" data-act="signout">退出登录</button></div>
      <div class="scroll-end"></div></div>`;
  }
  function settingsPage() {
    return `<div class="scroll a-scroll"><div class="a-field" aria-hidden="true"></div>${innerTop("我的", "设置")}
      <div class="a-grid a-grid-inner">${LV.SETTINGS.map((g) => `<ul class="a-group a-menu">${g.map((it) => listRow(it, "setting")).join("")}</ul>`).join("")}<p class="a-foot-note">Libevra ${LV.USER.version}</p></div><div class="scroll-end"></div></div>`;
  }

  /* ---------- 账目详情 ---------- */
  function entryPage(ctx, e) {
    const c = LV.cat(e.category), p = LV.dayParts(e.date);
    const field = (k, v) => `<div class="a-f"><dt>${k}</dt><dd>${v}</dd></div>`;
    return `<div class="scroll a-scroll"><div class="a-field" aria-hidden="true"></div>${innerTop("明细", "记账详情")}
      <div class="a-grid a-grid-inner">
        <article class="a-sum a-entry-hero"><span class="a-ico lg" style="--hue:${c.hue}">${esc(c.name.slice(0, 1))}</span><p class="a-entry-cat">${esc(c.name)}</p><p class="a-entry-amt ${e.kind}">${LV.entryMoneyHTML(e)}</p><p class="a-entry-note">${esc(e.note) || "（无备注）"}</p></article>
        <dl class="a-group a-fields">
          ${field("时间", `${e.date.replace(/-/g, "/")} ${e.time} · ${p.weekday}`)}${field("分类", esc(c.name))}${field("支付方式", esc(LV.pay(e.payment).name))}${field("币种", `${e.currency} · ${LV.cur(e.currency).name}`)}
          ${field("标签", e.tags.length ? e.tags.map((t) => `<span class="a-tag">${esc(LV.tag(t).name)}</span>`).join("") : '<span class="a-muted">没有标签</span>')}${field("记录人", esc(e.by))}${field("附件", e.attachments ? `${I("clip", { size: 14 })} ${e.attachments} 个文件` : '<span class="a-muted">无</span>')}${field("编号", `<span class="mono">${e.number}</span>`)}
        </dl>
        <div class="a-entry-actions"><button type="button" class="a-btn a-btn-lg" data-act="entry-edit">${I("pencil", { size: 18 })}修改</button><button type="button" class="a-btn-soft a-btn-lg" data-act="entry-copy">${I("copy", { size: 18 })}复制这一笔</button></div>
        <button type="button" class="a-danger-link" data-act="entry-delete" data-id="${e.id}">${I("trash", { size: 17 })}删除这笔记账</button>
      </div><div class="scroll-end"></div></div>`;
  }

  const regions = {
    list, summary, toolbar,
    "search-scope": (ctx) => `搜索范围：${esc(ctx.timeLabel)}${S.query ? ` · 找到 ${ctx.list.length} 笔` : ""}`,
    "stats-filter": () => statsFilter(),
    "invite-note": () => esc(S.inviteNote),
    batch: () => { const n = S.selected.size; return `<div class="a-batch-row"><span class="a-batch-n">已选 <b>${n}</b> 笔</span><button type="button" class="a-btn-soft" data-act="batch-edit" ${n ? "" : "disabled"}>${I("pencil", { size: 17 })}修改</button><button type="button" class="a-btn-danger" data-act="batch-delete" ${n ? "" : "disabled"}>${I("trash", { size: 17 })}删除</button></div>`; },
  };

  LV.registerStyle("a", {
    name: "Soft Spatial",
    collapseOffset: 8,
    entriesPage, statsPage, cardPage, ledgerPage, mePage, settingsPage, entryPage,
    nav, entryCards, batchBar, regions,
    background: () => "",
    sheetFrame: (inner, sh) => `<div class="sheet a-sheet a-sheet-${sh.type}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${inner}</div>`,
    dialogFrame: (inner) => `<div class="dialog a-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">${inner}</div>`,
    toast: (msg, action) => `<div class="a-toast"><span>${msg}</span>${action ? `<button type="button" data-act="toast-action">${action.label}</button>` : ""}</div>`,
  });
})();
