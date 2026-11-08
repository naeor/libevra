/* 方案 C · Structured Editorial 精致排版（第二轮）
 * 正式版平面风格的精致升级：页面顺序与正式版一致，不用大号月份、不用报表式排布。
 * 手段只有四样：精确的对齐、清楚的分组、克制的分隔线、等宽数字。容器只用白底 + 一像素细边。 */
(function () {
  const LV = window.LV, esc = LV.esc, I = LV.icon;
  const S = LV.state;

  function row(e, opts = {}) {
    const c = LV.cat(e.category);
    const lead = [opts.flat ? LV.dayLabel(e.date) : "", e.time].filter(Boolean).join(" ");
    const sel = S.selecting ? `<span class="c-check" aria-hidden="true">${I("check", { size: 13, w: 2.4 })}</span>` : "";
    return `<li><button type="button" class="c-row" data-act="entry" data-id="${e.id}" ${S.selecting ? `aria-pressed="${S.selected.has(e.id)}"` : ""} aria-label="${esc(c.name)} ${esc(e.note)} ${LV.signed(e)}">${sel}<span class="c-mark" style="--hue:${c.hue}" aria-hidden="true">${esc(c.name.slice(0, 1))}</span><span class="c-row-main"><span class="c-row-t"><b>${esc(c.name)}</b>${e.note ? `<span class="c-row-note"> · ${esc(e.note)}</span>` : ""}</span><span class="c-row-s"><span class="c-time">${esc(lead)}</span> · ${esc(LV.pay(e.payment)?.name || "")}${e.attachments ? ` · ${I("clip", { size: 11 })}${e.attachments}` : ""}</span></span><span class="c-amt ${e.kind}">${LV.entryMoneyHTML(e)}</span></button></li>`;
  }

  function list(ctx) {
    const { groups, list: items } = ctx;
    if (!items.length) {
      const msg = S.searchOpen && S.query ? "没有符合条件的账目" : S.kind === "expense" ? "这个月还没有支出" : S.kind === "income" ? "这个月还没有收入" : "这个月还没有账目";
      return `<div class="c-empty"><p>${msg}</p>${S.searchOpen ? "" : '<button type="button" class="c-btn-line" data-act="menu-toggle">记一笔</button>'}</div>`;
    }
    if (!groups) return `<ul class="c-group">${items.map((e) => row(e, { flat: true })).join("")}</ul>`;
    return groups.map((g) => `<section class="c-day"><h3 class="c-day-h"><span>${g.label}</span><span class="c-day-sum">${g.income ? `<span class="inc">收入 ${LV.money(g.income, "CNY", { symbol: false })}</span>` : ""}${g.expense ? `<span>支出 ${LV.money(g.expense, "CNY", { symbol: false })}</span>` : ""}</span></h3><ul class="c-group">${g.entries.map((e) => row(e)).join("")}</ul></section>`).join("") + (S.month !== "all" ? '<button type="button" class="c-more" data-act="toast" data-msg="原型只载入了 9–11 月的示例数据">加载更早的记录</button>' : "");
  }

  function summary(ctx) {
    const s = ctx.summary;
    const m = (v) => LV.moneyHTML(v, s.currency, { symbol: false });
    return `<div class="c-sum">
      <div class="c-sum-head"><span>收支概览</span><button type="button" class="c-cur" data-act="currencies" aria-label="全部币种">${s.currency}${I("down", { size: 12 })}</button></div>
      <dl class="c-grid2">
        <div><dt>支出</dt><dd class="c-big">${m(s.expense)}</dd></div>
        <div><dt>收入</dt><dd class="c-big inc">${m(s.income)}</dd></div>
        <div class="c-sub"><dt>结余</dt><dd>${m(s.balance)}</dd></div>
        <div class="c-sub"><dt>日均支出</dt><dd>${s.daily == null ? "—" : m(s.daily)}<small>${s.days ? `按 ${s.days} 天计算` : "选择时间范围后显示"}</small></dd></div>
      </dl>
    </div>`;
  }

  function toolbar() {
    return `<div class="c-seg" role="group" aria-label="收支类型" data-kind-track style="--i:${["all", "expense", "income"].indexOf(S.kind)}"><i class="c-seg-pill" aria-hidden="true"></i>${[["all", "全部"], ["expense", "支出"], ["income", "收入"]].map(([v, l]) => `<button type="button" data-act="kind" data-kind-btn data-v="${v}" aria-pressed="${S.kind === v}">${l}</button>`).join("")}</div>`;
  }

  function tools(ctx) {
    if (S.selecting) return `<button type="button" class="c-textbtn c-strong" data-act="batch-exit" aria-label="退出批量操作">取消</button>`;
    return `<button type="button" class="c-icon" data-act="search-open" aria-label="搜索账目">${I("search", { size: 20 })}</button><button type="button" class="c-icon" data-act="sheet" data-type="sort" aria-label="排序 · ${ctx.sortLabel}">${I(S.sort.dir === "desc" ? "sortDesc" : "sortAsc", { size: 20 })}</button><button type="button" class="c-icon" data-act="batch-start" aria-label="批量操作">${I("batch", { size: 20 })}</button><button type="button" class="c-icon" data-act="more" aria-label="更多">${I("more", { size: 20 })}</button>`;
  }

  function entriesPage(ctx) {
    if (S.searchOpen) {
      return `<div class="scroll c-scroll"><header class="c-top c-top-search"><label class="c-search">${I("search", { size: 18 })}<input type="search" data-input="search" placeholder="搜索备注、分类、标签或金额" aria-label="搜索账目" value="${esc(S.query)}" enterkeyhint="search"></label><button type="button" class="c-textbtn" data-act="search-cancel">取消</button></header>
        <p class="c-scope" data-region="search-scope">${regions["search-scope"](ctx)}</p>
        <div class="c-toolbar" data-pin data-region="toolbar">${toolbar(ctx)}</div><div class="c-list" data-region="list">${list(ctx)}</div><div class="scroll-end"></div></div>`;
    }
    const fc = ctx.filterCount;
    const badge = fc ? `<i class="c-fbadge">筛选 ${fc}</i>` : "";
    return `<div class="scroll c-scroll">
      <header class="c-top c-top-entries">
        <button type="button" class="c-wordmark c-fade-out" data-act="toast" data-msg="前往账本空间（原型未包含该页）" aria-label="前往账本空间">Libevra</button>
        <button type="button" class="c-fade-in c-compact" data-act="sheet" data-type="filter" tabindex="-1" aria-hidden="true">${esc(ctx.timeLabel)}${badge}${I("down", { size: 14 })}</button>
        <div class="c-tools">${tools(ctx)}</div>
      </header>
      <div class="c-month-row" data-collapse><button type="button" class="c-month" data-act="sheet" data-type="filter" aria-haspopup="dialog" aria-label="筛选 · ${esc(ctx.timeLabel)}">${esc(ctx.timeLabel)}${badge}${I("down", { size: 16 })}</button></div>
      <section class="c-sum-wrap" data-region="summary">${summary(ctx)}</section>
      <div class="c-toolbar" data-pin data-region="toolbar">${toolbar(ctx)}</div>
      <div class="c-list" data-region="list">${list(ctx)}</div>
      <div class="scroll-end"></div></div>`;
  }

  /* ---------- 底部：说明行在纸色上，底栏为白色 + 顶部细线（与正式版同构） ---------- */
  function nav(ctx) {
    const cap = LV.showCaption() ? `<div class="c-caption-row"><button type="button" class="c-caption" data-act="sheet" data-type="ledger" aria-haspopup="dialog" aria-label="当前账本：${esc(ctx.ledger.name)}，切换账本"><span><span class="cap-k">当前账本：</span>${esc(ctx.ledger.name)}</span>${I("down", { size: 12 })}</button></div>` : "";
    return `<div class="c-dock">${cap}<nav class="c-nav" aria-label="主导航">${LV.TABS.map((t) => t.primary
      ? `<div class="c-plus-slot"><button type="button" class="c-plus" data-act="menu-toggle" aria-expanded="${S.entryMenu}" aria-label="${S.entryMenu ? "收起记账方式" : "展开记账方式"}">${I("plus", { size: 24, w: 2 })}</button></div>`
      : `<button type="button" class="c-tab" data-act="tab" data-to="${t.id}" ${S.route.name === t.id ? 'aria-current="page"' : ""}>${I(t.icon, { size: 22 })}<span>${LV.tabLabel(t)}</span></button>`).join("")}</nav></div>`;
  }
  function entryCards() {
    return `<div class="c-drawer" ${S.entryMenu ? "" : 'aria-hidden="true"'}><p class="c-drawer-t">记一笔</p><div class="c-drawer-row">${LV.ENTRY_ACTIONS.map((a) => `<button type="button" class="c-entry" data-act="menu-item" data-label="${a.label}" aria-label="${a.label}" ${S.entryMenu ? "" : 'tabindex="-1"'}>${I(a.icon, { size: 22 })}<span class="short">${a.short}</span><span class="full">${a.label}</span></button>`).join("")}</div></div>`;
  }
  function batchBar() { return `<div class="c-dock c-batch" data-region="batch">${regions.batch()}</div>`; }

  /* ---------- 分析：轻量卡片，保留数字排版 ---------- */
  const pct = (r) => (r == null ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(1)}%`);
  const yuan = (v) => LV.moneyHTML(v, "CNY", { symbol: false });
  const cardHead = (key) => `<button type="button" class="c-ch" data-act="card" data-key="${key}"><span class="c-ch-t">${LV.CARDS[key].title}</span><span class="c-ch-w">${LV.CARDS[key].window}</span>${I("right", { size: 15 })}</button>`;

  function chartFor(key, a, big) {
    switch (key) {
      case "where": {
        const top = a.where.cats.slice(0, 5), rest = a.where.cats.slice(5);
        const restV = rest.reduce((s, c) => s + c.value, 0);
        return `<div class="c-where ${big ? "big" : ""}"><div class="c-donut">${LV.chart.donut(a.where.cats, { size: big ? 150 : 116, thick: big ? 12 : 10, gap: 2, max: 6, label: "支出分类构成" })}<div class="c-donut-c"><span>本月支出</span><b>${LV.short(a.where.total)}</b></div></div><table class="c-table"><tbody>${top.map((c) => `<tr><td><i class="c-sw" style="--hue:${c.hue}"></i>${c.name}</td><td class="num">${LV.money(c.value, "CNY", { symbol: false })}</td><td class="num pct">${(c.share * 100).toFixed(0)}%</td></tr>`).join("")}${rest.length ? `<tr class="rest"><td>另有 ${rest.length} 项</td><td class="num">${LV.money(restV, "CNY", { symbol: false })}</td><td class="num pct">${((restV / a.where.total) * 100).toFixed(0)}%</td></tr>` : ""}</tbody></table></div>`;
      }
      case "overview": return `<dl class="c-grid2 c-grid2-flat"><div><dt>总支出</dt><dd class="c-big">${yuan(a.overview.total)}</dd></div><div><dt>较上期变化</dt><dd class="c-big ${a.overview.change > 0 ? "up" : "down"}">${pct(a.overview.change)}</dd></div><div class="c-sub"><dt>日均支出</dt><dd>${yuan(a.overview.daily)}</dd></div><div class="c-sub"><dt>支出笔数</dt><dd>${a.overview.count} 笔</dd></div></dl>`;
      case "daily": return `${LV.chart.bars(a.daily.days.map((d) => ({ label: d.label, value: d.value, hi: d.date === a.daily.max.date })), { cls: "c-bars", label: "近 7 天每日支出" })}<dl class="c-figrow"><div><dt>总支出</dt><dd>${yuan(a.daily.total)}</dd></div><div><dt>支出最多的一天</dt><dd>${a.daily.max.md} · ${yuan(a.daily.max.value)}</dd></div></dl>`;
      case "rise": case "fall": { const c = a[key]; return c ? `<p class="c-mini-n"><i class="c-sw" style="--hue:${c.hue}"></i>${c.name}</p><p class="c-mini-v ${key}">${c.diff >= 0 ? "+" : "−"}${yuan(Math.abs(c.diff))}</p><p class="c-mini-s">${c.rate == null ? "上期无支出" : pct(c.rate)} · 上期 ${LV.money(c.was, "CNY", { symbol: false })}</p>` : '<p class="c-mini-s">暂无数据</p>'; }
      case "large": return LV.chart.rank(a.large.map((e) => ({ id: e.id, name: e.note, value: e.amount, hue: LV.cat(e.category).hue, meta: `${LV.dayParts(e.date).md} · ${LV.cat(e.category).name} · ${LV.pay(e.payment).name}` })), { cls: "c-rank", act: "entry" });
      case "change": return LV.chart.diverge(a.changes);
      case "weekday": return LV.chart.bars(a.weekday.map((d) => ({ label: d.label, value: d.value })), { cls: "c-bars c-bars-alt", label: "按星期支出" });
      case "month": return `${LV.chart.flow(a.month.days, { cls: "c-flow" })}<dl class="c-figrow c-figrow-3"><div><dt>收入</dt><dd class="inc">${yuan(a.month.income)}</dd></div><div><dt>支出</dt><dd>${yuan(a.month.expense)}</dd></div><div><dt>差额</dt><dd>${yuan(a.month.net)}</dd></div></dl>`;
      case "weeks": return LV.chart.bars(a.weeks.map((w) => ({ label: w.label, value: w.value, partial: w.partial })), { cls: "c-bars c-bars-wide", label: "近 4 周每周支出" });
    }
    return "";
  }

  function statsFilter() {
    if (!S.statsFilterOpen) return "";
    const cats = LV.CATEGORIES.filter((c) => c.kind === "expense");
    return `<div class="c-card c-sf"><p class="c-label">分类</p><div class="c-chips">${cats.map((c) => `<button type="button" class="c-chip" data-act="stats-cat" data-id="${c.id}" aria-pressed="${S.statsDraft.includes(c.id)}"><i class="c-sw" style="--hue:${c.hue}"></i>${c.name}</button>`).join("")}</div><p class="c-note">不选即为全部分类。时间沿用每张卡片自己的范围。</p><div class="c-sf-act"><button type="button" class="c-btn-line" data-act="stats-revert">还原</button><button type="button" class="c-btn" data-act="stats-apply">应用</button></div></div>`;
  }

  const pageTop = (title, sub, right) => `<header class="c-top"><h1 class="c-page-t c-fade-out">${title}</h1><span class="c-fade-in c-compact c-compact-static" aria-hidden="true">${title}<small>${esc(sub)}</small></span><div class="c-tools">${right}</div></header>`;

  function statsPage(ctx) {
    const a = LV.analysis();
    const sumText = `按卡片各自时间 · ${S.statsCats.length ? `分类 ${S.statsCats.length} 项` : "全部分类"}`;
    return `<div class="scroll c-scroll">
      ${pageTop("分析", ctx.ledger.name, `<button type="button" class="c-icon ${S.statsFilterOpen ? "on" : ""}" data-act="stats-filter" aria-expanded="${S.statsFilterOpen}" aria-label="筛选">${I("funnel", { size: 20 })}${S.statsCats.length ? '<i class="c-dot"></i>' : ""}</button><button type="button" class="c-icon" data-act="stats-edit" aria-label="编辑布局">${I("pencil", { size: 20 })}</button>`)}
      <div class="c-intro" data-collapse><p class="c-dek">以下结果由已记录的账目计算得出。</p><div class="c-statline"><button type="button" class="c-linkbtn" data-act="stats-filter">${sumText}</button><button type="button" class="c-linkbtn c-linkbtn-r" data-act="stats-settings" aria-label="统计设置">CNY · 原币统计${I("sliders", { size: 14 })}</button></div><div data-region="stats-filter">${statsFilter()}</div></div>
      <div class="c-stack">
        <article class="c-card">${cardHead("where")}${chartFor("where", a)}</article>
        <article class="c-card">${cardHead("overview")}${chartFor("overview", a)}</article>
        <article class="c-card">${cardHead("daily")}${chartFor("daily", a)}</article>
        <article class="c-card c-split"><div>${cardHead("rise")}${chartFor("rise", a)}</div><div>${cardHead("fall")}${chartFor("fall", a)}</div></article>
        <div class="c-carousel-wrap"><div class="c-carousel" data-carousel>${["large", "change", "weekday"].map((k) => `<article class="c-card c-slide">${cardHead(k)}${chartFor(k, a)}</article>`).join("")}</div><div class="c-dots" role="tablist" aria-label="切换卡片">${[0, 1, 2].map((i) => `<button type="button" data-act="dot" data-i="${i}" aria-current="${i === 0}" aria-label="第 ${i + 1} 张"></button>`).join("")}</div></div>
        <article class="c-card">${cardHead("month")}${chartFor("month", a)}</article>
        <article class="c-card">${cardHead("weeks")}${chartFor("weeks", a)}</article>
      </div><div class="scroll-end"></div></div>`;
  }

  const innerTop = (back, title) => `<header class="c-top c-top-inner"><button type="button" class="c-back" data-act="back" aria-label="返回${back}">${I("left", { size: 20 })}<span>${back}</span></button><h1 class="c-inner-t">${title}</h1></header>`;

  function cardPage(ctx, key) {
    const a = LV.analysis(), src = LV.cardSource(key);
    return `<div class="scroll c-scroll">${innerTop("分析", LV.CARDS[key].title)}
      <div class="c-stack c-stack-inner"><p class="c-dek c-dek-pad">${LV.CARDS[key].window} · 按人民币原币统计</p>
      <article class="c-card">${chartFor(key, a, true)}</article>
      <h2 class="c-sec-t">来源账目<span>${src.length} 笔</span></h2><ul class="c-group">${src.map((e) => row(e, { flat: true })).join("")}</ul></div>
      <div class="scroll-end"></div></div>`;
  }

  /* ---------- 账本 ---------- */
  function ledgerPage(ctx) {
    const l = ctx.ledger, shared = l.members.length >= 2;
    return `<div class="scroll c-scroll">${pageTop(shared ? "协作" : "账本", l.name, `<button type="button" class="c-icon" data-act="toast" data-msg="账本设置子页面不在本轮范围" aria-label="账本设置">${I("gear", { size: 20 })}</button>`)}
      <div class="c-intro" data-collapse><p class="c-dek">${shared ? "共享账本" : "单人账本"}</p></div>
      <div class="c-stack">
        <article class="c-card"><p class="c-label">当前账本</p><h2 class="c-ident-n">${esc(l.name)}</h2><p class="c-ident-m"><span class="mono">${l.number}</span> · ${l.members.length} 人 · ${LV.ledgerEntries().length} 笔账目</p><div class="c-actions-row"><button type="button" class="c-btn" data-act="sheet" data-type="ledger">切换账本</button><button type="button" class="c-btn-line" data-act="toast" data-msg="账本详情子页面不在本轮范围">查看详情</button></div></article>
        <article class="c-card c-card-list"><div class="c-ch c-ch-static"><span class="c-ch-t">成员</span><span class="c-ch-w">${l.members.length} 人</span></div><ul class="c-people">${l.members.map((m) => `<li><span class="c-av" style="--hue:${m.tone}">${esc(m.name.slice(-1))}</span><span class="c-people-n">${esc(m.name)}${m.me ? '<em class="c-me">我</em>' : ""}</span><span class="c-people-r">${m.role}</span></li>`).join("")}</ul><button type="button" class="c-linkbtn" data-act="toast" data-msg="成员管理子页面不在本轮范围">成员管理 ›</button></article>
        <article class="c-card"><div class="c-ch c-ch-static"><span class="c-ch-t">邀请成员</span></div><p class="c-dek">输入账号编号或用户名发送邀请，对方接受后加入账本。</p><div class="c-invite"><input type="text" data-input="invite" placeholder="账号编号或用户名" aria-label="要邀请谁"><button type="button" class="c-btn" data-act="invite">邀请</button></div><p class="c-ok" data-region="invite-note" role="status">${esc(S.inviteNote)}</p><button type="button" class="c-linkbtn" data-act="toast" data-msg="邀请权限子页面不在本轮范围">选择对方的权限，或查看已发出的邀请 ›</button></article>
        <article class="c-card"><div class="c-ch c-ch-static"><span class="c-ch-t">编辑记录</span><button type="button" class="c-linkbtn c-linkbtn-r" data-act="toast" data-msg="完整编辑记录不在本轮范围">查看全部 ›</button></div><ol class="c-timeline">${LV.HISTORY.map((h) => `<li><span class="c-tl-what"><b>${esc(h.who)}</b> ${h.what} ${esc(h.target)}<span class="c-tl-when">${h.when}</span></span>${h.amount ? `<span class="c-tl-amt">${h.amount}</span>` : ""}</li>`).join("")}</ol></article>
      </div><div class="scroll-end"></div></div>`;
  }

  /* ---------- 我的 / 设置 ---------- */
  const idx = (it, act) => `<li><button type="button" class="c-idx" data-act="${act}" data-id="${it.id}" data-label="${it.label}">${I(it.icon, { size: 19, cls: "c-idx-ic" })}<span class="c-idx-m"><span class="c-idx-t">${it.label}</span>${it.hint ? `<span class="c-idx-h">${esc(it.hint)}</span>` : ""}</span>${I("right", { size: 15, cls: "c-chev" })}</button></li>`;
  function mePage(ctx) {
    const u = ctx.user;
    return `<div class="scroll c-scroll">${pageTop("我的", u.name, `<button type="button" class="c-icon" data-act="toast" data-msg="没有新的通知" aria-label="通知">${I("bell", { size: 20 })}</button>`)}
      <div class="c-profile" data-collapse><div class="c-avatar" aria-hidden="true">${I("leaf", { size: 32, w: 1.4 })}</div><p class="c-pname">${esc(u.name)}</p><p class="c-puser">@${u.username}</p></div>
      <div class="c-stack"><ul class="c-group c-menu">${LV.ME_LINKS().map((it) => idx(it, "me-link")).join("")}</ul>
      <button type="button" class="c-signout" data-act="signout">退出登录</button></div>
      <div class="scroll-end"></div></div>`;
  }
  function settingsPage() {
    return `<div class="scroll c-scroll">${innerTop("我的", "设置")}<div class="c-stack c-stack-inner">${LV.SETTINGS.map((g) => `<ul class="c-group c-menu">${g.map((it) => idx(it, "setting")).join("")}</ul>`).join("")}<p class="c-colophon">Libevra ${LV.USER.version}</p></div><div class="scroll-end"></div></div>`;
  }

  /* ---------- 账目详情 ---------- */
  function entryPage(ctx, e) {
    const c = LV.cat(e.category), p = LV.dayParts(e.date);
    const r = (k, v) => `<li class="c-field"><span class="c-field-k">${k}</span><span class="c-field-v">${v}</span></li>`;
    return `<div class="scroll c-scroll">${innerTop("明细", "记账详情")}
      <div class="c-stack c-stack-inner">
        <section class="c-card c-receipt"><p class="c-label"><span class="c-mark sm" style="--hue:${c.hue}">${esc(c.name.slice(0, 1))}</span>${esc(c.name)} · ${e.kind === "expense" ? "支出" : "收入"}</p><p class="c-receipt-amt ${e.kind}">${LV.entryMoneyHTML(e)}</p><p class="c-receipt-note">${esc(e.note) || "（无备注）"}</p></section>
        <ul class="c-group">${r("时间", `${e.date.replace(/-/g, "/")} ${e.time} ${p.weekday}`)}${r("分类", esc(c.name))}${r("支付方式", esc(LV.pay(e.payment).name))}${r("币种", `${e.currency} · ${LV.cur(e.currency).name}`)}${r("标签", e.tags.length ? e.tags.map((t) => `<span class="c-tag">${esc(LV.tag(t).name)}</span>`).join("") : '<span class="c-faint">没有标签</span>')}${r("记录人", esc(e.by))}${r("附件", e.attachments ? `${e.attachments} 个文件` : '<span class="c-faint">无</span>')}${r("编号", `<span class="mono">${e.number}</span>`)}</ul>
        <div class="c-actions-row"><button type="button" class="c-btn c-btn-lg" data-act="entry-edit">修改</button><button type="button" class="c-btn-line c-btn-lg" data-act="entry-copy">复制这一笔</button></div>
        <button type="button" class="c-danger" data-act="entry-delete" data-id="${e.id}">删除这笔记账</button>
      </div><div class="scroll-end"></div></div>`;
  }

  const regions = {
    list, summary, toolbar,
    "search-scope": (ctx) => `搜索范围：${esc(ctx.timeLabel)}${S.query ? ` · 找到 ${ctx.list.length} 笔` : ""}`,
    "stats-filter": () => statsFilter(),
    "invite-note": () => esc(S.inviteNote),
    batch: () => { const n = S.selected.size; return `<div class="c-batch-row"><span class="c-batch-n">已选 <b>${n}</b> 笔</span><button type="button" class="c-btn-line" data-act="batch-edit" ${n ? "" : "disabled"}>修改</button><button type="button" class="c-btn c-btn-danger" data-act="batch-delete" ${n ? "" : "disabled"}>删除</button></div>`; },
  };

  LV.registerStyle("c", {
    name: "Structured Editorial",
    collapseOffset: 8,
    entriesPage, statsPage, cardPage, ledgerPage, mePage, settingsPage, entryPage,
    nav, entryCards, batchBar, regions,
    background: () => "",
    sheetFrame: (inner, sh) => `<div class="sheet c-sheet c-sheet-${sh.type}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${inner}</div>`,
    dialogFrame: (inner) => `<div class="dialog c-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">${inner}</div>`,
    toast: (msg, action) => `<div class="c-toast"><span>${msg}</span>${action ? `<button type="button" data-act="toast-action">${action.label}</button>` : ""}</div>`,
  });
})();
