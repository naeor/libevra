/* Libevra S19 Style Lab — 共享引擎
 * 状态、数据选择、路由、区域刷新、浮层、对话框、事件委托。
 * 三套风格只负责“如何呈现”：页面模板 + 浮层外壳 + 样式。功能、文案、数据完全一致。 */
(function () {
  const LV = (window.LV = window.LV || {});
  LV.styles = {};
  LV.registerStyle = (id, def) => { LV.styles[id] = def; };

  /* ---------------- 基础工具 ---------------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  LV.esc = esc;
  const pad = (n) => String(n).padStart(2, "0");
  const groupDigits = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const CUR = (id) => LV.CURRENCIES.find((c) => c.id === id) || { id, symbol: "", name: id };
  LV.cur = CUR;

  /** 金额拆成可排版的几段：符号、货币符号、整数、小数。 */
  LV.moneyParts = function (minor, currency = "CNY", sign = "none") {
    const neg = minor < 0;
    const abs = Math.abs(minor);
    const dec = currency === "JPY" ? 0 : 2;
    const whole = groupDigits(String(dec ? Math.floor(abs / 100) : abs));
    const frac = dec ? String(abs % 100).padStart(2, "0") : "";
    let s = "";
    if (sign === "kind-expense") s = "−";
    else if (sign === "kind-income") s = "+";
    else if (neg) s = "−";
    return { sign: s, sym: CUR(currency).symbol, whole, frac, dec };
  };
  /** 普通文本金额。opts.symbol=false 去掉货币符号（摘要卡里币种统一标在卡头）。 */
  LV.money = function (minor, currency = "CNY", opts = {}) {
    const p = LV.moneyParts(minor, currency, opts.sign || "none");
    return `${p.sign}${opts.symbol === false ? "" : p.sym}${p.whole}${p.dec ? "." + p.frac : ""}`;
  };
  LV.signed = (e) => LV.money(e.amount, e.currency, { sign: e.kind === "expense" ? "kind-expense" : "kind-income" });
  /** 带小数弱化的金额 HTML（三套都用，类名由各自样式决定）。 */
  LV.moneyHTML = function (minor, currency = "CNY", opts = {}) {
    const p = LV.moneyParts(minor, currency, opts.sign || "none");
    const sym = opts.symbol === false ? "" : `<span class="m-sym">${esc(p.sym)}</span>`;
    return `<span class="m">${p.sign ? `<span class="m-sign">${p.sign}</span>` : ""}${sym}<span class="m-int">${p.whole}</span>${p.dec ? `<span class="m-frac">.${p.frac}</span>` : ""}</span>`;
  };
  LV.entryMoneyHTML = (e) => LV.moneyHTML(e.amount, e.currency, { sign: e.kind === "expense" ? "kind-expense" : "kind-income" });

  /* ---------------- 日期 ---------------- */
  const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const toDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };
  LV.date = { toDate, iso, addDays, WEEK };
  LV.weekday = (s) => WEEK[toDate(s).getDay()];
  LV.dayLabel = function (s) {
    if (s === LV.TODAY) return "今天";
    if (s === addDays(LV.TODAY, -1)) return "昨天";
    const d = toDate(s);
    const y = d.getFullYear() === toDate(LV.TODAY).getFullYear() ? "" : `${d.getFullYear()} 年 `;
    return `${y}${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEK[d.getDay()]}`;
  };
  LV.dayParts = function (s) {
    const d = toDate(s);
    const rel = s === LV.TODAY ? "今天" : s === addDays(LV.TODAY, -1) ? "昨天" : "";
    return { day: pad(d.getDate()), dayN: d.getDate(), month: d.getMonth() + 1, weekday: WEEK[d.getDay()], rel, md: `${d.getMonth() + 1} 月 ${d.getDate()} 日` };
  };
  LV.monthLabel = (m) => (m === "all" ? "全部时间" : `${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月`);
  LV.monthShort = (m) => (m === "all" ? "全部" : `${Number(m.slice(5))}月`);
  const daysInMonth = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate();

  /* ---------------- 状态 ---------------- */
  const S = (LV.state = {
    style: "a",
    route: { name: "entries" },
    ledgerId: "family",
    month: "2026-11",
    range: null,
    filters: { categories: [], tags: [], payments: [], currencies: [], attachment: "any" },
    kind: "all",
    query: "",
    searchOpen: false,
    sort: { field: "time", dir: "desc" },
    selecting: false,
    selected: new Set(),
    deleted: new Set(),
    sheet: null,
    dialog: null,
    entryMenu: false,
    statsFilterOpen: false,
    statsCats: [],
    statsDraft: [],
    carousel: 0,
    invite: { status: "idle", msg: "", target: null },
    historyState: "ready",
    historyDemo: null,
    toggles: { ...(LV.TOGGLES || {}) },
    liveEvents: [],
  });

  /* ---------------- 选择器 ---------------- */
  const cat = (id) => LV.CATEGORIES.find((c) => c.id === id);
  const pay = (id) => LV.PAYMENTS.find((p) => p.id === id);
  const tag = (id) => LV.TAGS.find((t) => t.id === id);
  LV.cat = cat; LV.pay = pay; LV.tag = tag;
  LV.ledger = (id = S.ledgerId) => LV.LEDGERS.find((l) => l.id === id);
  LV.ledgerTabLabel = (l = LV.ledger()) => (l.members.length >= 2 ? "协作" : "账本");
  const ledgerEntries = (id = S.ledgerId) => LV.ENTRIES.filter((e) => e.ledgerId === id && !S.deleted.has(e.id));
  LV.ledgerEntries = ledgerEntries;

  function inTime(e, f = S) {
    if (f.range) return e.date >= f.range.from && e.date <= f.range.to;
    if (f.month === "all") return true;
    return e.date.startsWith(f.month);
  }
  function passFilters(e, f = S.filters) {
    if (f.categories.length && !f.categories.includes(e.category)) return false;
    if (f.payments.length && !f.payments.includes(e.payment)) return false;
    if (f.tags.length && !e.tags.some((t) => f.tags.includes(t))) return false;
    if (f.currencies.length && !f.currencies.includes(e.currency)) return false;
    if (f.attachment === "has" && !e.attachments) return false;
    if (f.attachment === "none" && e.attachments) return false;
    return true;
  }
  function matchesQuery(e, q) {
    if (!q) return true;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const hay = [cat(e.category).name, e.note, pay(e.payment)?.name, ...e.tags.map((t) => tag(t)?.name), (e.amount / 100).toFixed(2), String(e.amount / 100)].join(" ").toLowerCase();
    return hay.includes(needle);
  }
  LV.activeFilterCount = function (f = S.filters, range = S.range) {
    return ["categories", "tags", "payments", "currencies"].filter((k) => f[k].length).length + (f.attachment !== "any" ? 1 : 0) + (range ? 1 : 0);
  };
  LV.scoped = () => ledgerEntries().filter((e) => inTime(e) && passFilters(e));
  LV.visible = function () {
    let list = LV.scoped().filter((e) => (S.kind === "all" ? true : e.kind === S.kind) && matchesQuery(e, S.searchOpen ? S.query : ""));
    const { field, dir } = S.sort;
    const k = dir === "desc" ? -1 : 1;
    list.sort((a, b) => {
      if (field === "amount") return (a.amount - b.amount) * k || (a.date + a.time < b.date + b.time ? 1 : -1);
      const ka = a.date + a.time, kb = b.date + b.time;
      return ka < kb ? -k : ka > kb ? k : 0;
    });
    return list;
  };
  LV.groups = function (list) {
    if (S.sort.field !== "time") return null; // 按金额排序时为平铺列表（与正式版 presentation.flat 一致）
    const map = new Map();
    for (const e of list) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    }
    return [...map.entries()].map(([date, entries]) => ({
      date, entries,
      label: LV.dayLabel(date), parts: LV.dayParts(date),
      expense: entries.filter((e) => e.kind === "expense" && e.currency === LV.ledger().currency).reduce((s, e) => s + e.amount, 0),
      income: entries.filter((e) => e.kind === "income" && e.currency === LV.ledger().currency).reduce((s, e) => s + e.amount, 0),
    }));
  };
  function rangeDays() {
    if (S.range) return Math.round((toDate(S.range.to) - toDate(S.range.from)) / 864e5) + 1;
    if (S.month === "all") return null;
    if (LV.TODAY.startsWith(S.month)) return toDate(LV.TODAY).getDate();
    return daysInMonth(S.month);
  }
  LV.summary = function (currency = LV.ledger().currency) {
    const list = LV.scoped().filter((e) => e.currency === currency);
    const expense = list.filter((e) => e.kind === "expense").reduce((s, e) => s + e.amount, 0);
    const income = list.filter((e) => e.kind === "income").reduce((s, e) => s + e.amount, 0);
    const days = rangeDays();
    return {
      currency, expense, income, balance: income - expense,
      count: LV.scoped().length,
      expenseCount: list.filter((e) => e.kind === "expense").length,
      daily: days ? Math.round(expense / days) : null, days,
    };
  };
  LV.currencySummaries = function () {
    const set = new Set(LV.scoped().map((e) => e.currency));
    set.add(LV.ledger().currency);
    return [...set].map((c) => LV.summary(c));
  };
  LV.timeLabel = () => (S.range ? `${S.range.from} 至 ${S.range.to}` : LV.monthLabel(S.month));

  /* ---------------- 分析页数据（与正式版「新手」预设一一对应） ---------------- */
  LV.analysis = function () {
    const led = LV.ledger();
    const base = ledgerEntries().filter((e) => e.currency === led.currency && (S.statsCats.length ? S.statsCats.includes(e.category) : true));
    const exp = (from, to) => base.filter((e) => e.kind === "expense" && e.date >= from && e.date <= to);
    const sum = (l) => l.reduce((s, e) => s + e.amount, 0);
    const T = LV.TODAY;
    const mtdFrom = T.slice(0, 8) + "01";
    const prevMonth = (() => { const d = toDate(mtdFrom); d.setMonth(d.getMonth() - 1); return iso(d); })();
    const prevMtdTo = addDays(prevMonth, toDate(T).getDate() - 1);
    const l7From = addDays(T, -6), p7From = addDays(T, -13), p7To = addDays(T, -7);

    const byCat = (list) => {
      const m = new Map();
      for (const e of list) m.set(e.category, (m.get(e.category) || 0) + e.amount);
      return [...m.entries()].map(([id, v]) => ({ id, name: cat(id).name, hue: cat(id).hue, value: v })).sort((a, b) => b.value - a.value);
    };
    const mtd = exp(mtdFrom, T);
    const cats = byCat(mtd);
    const mtdTotal = sum(mtd);
    cats.forEach((c) => (c.share = mtdTotal ? c.value / mtdTotal : 0));

    const last7 = exp(l7From, T), prev7 = exp(p7From, p7To);
    const days7 = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(l7From, i);
      return { date: d, label: LV.weekday(d).slice(1), md: `${toDate(d).getMonth() + 1}/${toDate(d).getDate()}`, value: sum(exp(d, d)) };
    });
    const maxDay = days7.reduce((m, d) => (d.value > m.value ? d : m), days7[0]);

    const prevCats = byCat(exp(prevMonth, prevMtdTo));
    const allIds = new Set([...cats.map((c) => c.id), ...prevCats.map((c) => c.id)]);
    const changes = [...allIds].map((id) => {
      const now = cats.find((c) => c.id === id)?.value || 0;
      const was = prevCats.find((c) => c.id === id)?.value || 0;
      return { id, name: cat(id).name, hue: cat(id).hue, now, was, diff: now - was, rate: was ? (now - was) / was : null };
    }).sort((a, b) => b.diff - a.diff);
    const rise = changes[0];
    const fall = [...changes].sort((a, b) => a.diff - b.diff)[0];

    const large = [...mtd].sort((a, b) => b.amount - a.amount).slice(0, 5);

    // 最近 4 周（周一至周日）
    const dow = (toDate(T).getDay() + 6) % 7; // 周一=0
    const thisMon = addDays(T, -dow);
    const weeks = Array.from({ length: 4 }, (_, i) => {
      const from = addDays(thisMon, -7 * (3 - i));
      const to = i === 3 ? T : addDays(from, 6);
      const d = toDate(from);
      return { from, to, label: `${d.getMonth() + 1}/${d.getDate()}`, value: sum(exp(from, to)), partial: i === 3 };
    });
    const wkFrom = weeks[0].from;
    const weekday = ["一", "二", "三", "四", "五", "六", "日"].map((label, i) => ({
      label, value: sum(base.filter((e) => e.kind === "expense" && e.date >= wkFrom && e.date <= T && (toDate(e.date).getDay() + 6) % 7 === i)),
    }));

    const monthDays = Array.from({ length: toDate(T).getDate() }, (_, i) => {
      const d = addDays(mtdFrom, i);
      return {
        date: d, label: String(i + 1),
        income: sum(base.filter((e) => e.kind === "income" && e.date === d)),
        expense: sum(exp(d, d)),
      };
    });
    const mInc = sum(base.filter((e) => e.kind === "income" && e.date >= mtdFrom && e.date <= T));

    return {
      currency: led.currency,
      where: { cats, total: mtdTotal, label: "本月至今" },
      overview: {
        total: sum(last7), change: sum(prev7) ? (sum(last7) - sum(prev7)) / sum(prev7) : null,
        prev: sum(prev7), daily: Math.round(sum(last7) / 7), count: last7.length, label: "近 7 天",
      },
      daily: { days: days7, total: sum(last7), max: maxDay },
      rise, fall, changes: changes.filter((c) => c.diff !== 0).slice(0, 3).concat(changes.filter((c) => c.diff < 0).slice(-3)).filter((c, i, a) => a.indexOf(c) === i),
      large, weekday,
      month: { days: monthDays, income: mInc, expense: mtdTotal, net: mInc - mtdTotal },
      weeks,
    };
  };

  /* 分析卡片目录：标题与时间口径来自正式版「新手」预设。 */
  LV.CARDS = {
    where: { title: "支出分类", window: "本月至今" },
    overview: { title: "近 7 天概览", window: "近 7 天" },
    daily: { title: "每日支出", window: "近 7 天" },
    rise: { title: "增加最多的分类", window: "本月至今 · 对比上月同期" },
    fall: { title: "减少最多的分类", window: "本月至今 · 对比上月同期" },
    large: { title: "大额支出", window: "本月至今" },
    change: { title: "分类变化", window: "本月至今 · 对比上月同期" },
    weekday: { title: "按星期支出", window: "近 4 周" },
    month: { title: "本月收支", window: "本月至今" },
    weeks: { title: "每周支出", window: "近 4 周" },
  };
  LV.cardSource = function (key) {
    const a = LV.analysis();
    const led = LV.ledger();
    const base = ledgerEntries().filter((e) => e.currency === led.currency);
    const T = LV.TODAY;
    const from = key === "overview" || key === "daily" ? addDays(T, -6) : key === "weekday" || key === "weeks" ? a.weeks[0].from : T.slice(0, 8) + "01";
    let list = base.filter((e) => e.date >= from && e.date <= T);
    if (key !== "month") list = list.filter((e) => e.kind === "expense");
    if (key === "rise" && a.rise) list = list.filter((e) => e.category === a.rise.id);
    if (key === "fall" && a.fall) list = list.filter((e) => e.category === a.fall.id);
    if (key === "large") list = [...list].sort((x, y) => y.amount - x.amount).slice(0, 5);
    else list.sort((x, y) => (x.date + x.time < y.date + y.time ? 1 : -1));
    return list;
  };

  /* ---------------- 编辑记录：把服务器事件变成“人话” ----------------
   * 原则：只说数据能证明的事。没有保存当时币种的金额改动，只说“金额有改动”，不猜数值；
   * 认不出的分类 / 标签 / 字段，只说有变化，原始值留在“技术信息”里。 */
  const LOG_KIND = {
    created: { verb: "新增了", icon: "plus", tone: "add", label: "新增" },
    updated: { verb: "修改了", icon: "pencil", tone: "edit", label: "修改" },
    deleted: { verb: "删除了", icon: "trash", tone: "del", label: "删除" },
    restored: { verb: "恢复了", icon: "restore", tone: "add", label: "恢复" },
    member_changed: { verb: "调整了", icon: "people", tone: "member", label: "成员" },
  };
  LV.LOG_KIND = LOG_KIND;
  const ROLE = { owner: "所有者", editor: "可编辑", viewer: "仅查看" };
  const clip = (t, n = 14) => { t = String(t ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; };
  const byUuid = (list, u) => list.find((x) => x.uuid === u);
  const shTime = (isoUtc) => { const d = new Date(Date.parse(isoUtc) + 8 * 3600e3); return { md: `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`, hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, day: d.toISOString().slice(0, 10) }; };
  function logLines(ev) {
    const out = [];
    let other = 0;
    const ch = ev.changes || {};
    for (const [k, v] of Object.entries(ch)) {
      const from = v?.from, to = v?.to;
      switch (k) {
        case "amountCents":
          out.push(ev.currency ? { text: `金额 ${LV.money(from, ev.currency)} → ${LV.money(to, ev.currency)}` } : { text: "金额有改动", hint: "这条记录没有保存当时的币种，所以不显示数值" });
          break;
        case "note": out.push({ text: `备注「${clip(from)}」→「${clip(to)}」` }); break;
        case "kind": out.push({ text: `类型 ${from === "income" ? "收入" : "支出"} → ${to === "income" ? "收入" : "支出"}` }); break;
        case "currency": out.push({ text: `币种 ${from} → ${to}` }); break;
        case "categoryId": case "paymentMethodId": {
          const list = k === "categoryId" ? LV.CATEGORIES : LV.PAYMENTS, label = k === "categoryId" ? "分类" : "支付方式";
          const a = byUuid(list, from), b = byUuid(list, to);
          out.push(a && b ? { text: `${label} ${a.name} → ${b.name}` } : { text: `${label}有改动`, hint: "原来的选项已被删除，无法显示名称" });
          break;
        }
        case "occurredAt": {
          const a = shTime(from), b = shTime(to);
          out.push({ text: a.day === b.day ? `时间 ${a.hm} → ${b.hm}` : `时间 ${a.md} ${a.hm} → ${b.md} ${b.hm}` });
          break;
        }
        case "tags": {
          const f = from || [], t = to || [];
          const added = t.filter((x) => !f.includes(x)), removed = f.filter((x) => !t.includes(x));
          const names = (ids) => ids.map((id) => byUuid(LV.TAGS, id)?.name).filter(Boolean);
          if (names(added).length) out.push({ text: `添加了标签 ${names(added).join("、")}` });
          if (names(removed).length) out.push({ text: `移除了标签 ${names(removed).join("、")}` });
          const lost = removed.length - names(removed).length + added.length - names(added).length;
          if (lost) out.push({ text: `${added.length - names(added).length ? "添加" : "移除"}了 ${lost} 个已不存在的标签` });
          break;
        }
        case "attachments": {
          const f = from || [], t = to || [];
          const added = t.filter((x) => !f.some((y) => y.id === x.id)), removed = f.filter((x) => !t.some((y) => y.id === x.id));
          if (added.length) out.push({ text: added.length === 1 && added[0].name ? `添加了附件 ${added[0].name}` : `添加了 ${added.length} 个附件` });
          if (removed.length) out.push({ text: `移除了 ${removed.length} 个附件` });
          break;
        }
        case "joined": out.push({ text: `${to} 加入了账本${ch.role?.to ? `，权限为「${ROLE[ch.role.to] || ch.role.to}」` : ""}` }); break;
        case "removed": out.push({ text: `移除了成员 ${from}` }); break;
        case "left": out.push({ text: `${from} 退出了账本` }); break;
        case "role": if (!ch.joined) out.push({ text: `${ch.member?.to ? ch.member.to + " 的" : ""}权限「${ROLE[from] || from}」→「${ROLE[to] || to}」` }); break;
        case "member": break;
        default: other += 1;
      }
    }
    if (other) out.push({ text: `另有 ${other} 项内部字段变化`, muted: true });
    return out;
  }
  function eventsFor(ledgerId) {
    const own = LV.EVENTS.filter((e) => e.ledgerId === ledgerId);
    const base = own.length ? own : ledgerEntries(ledgerId).filter((e) => e.date >= "2026-11-01").map((e) => ({
      id: "evt_" + e.uuid.slice(0, 18).replace(/-/g, ""), ledgerId, kind: "created", at: `${e.date}T${e.time}`, occurredAt: `${e.date}T${e.time}:00+08:00`,
      actor: e.by, actorId: LV.MEMBER_IDS[e.by], entryId: e.id, transactionId: e.uuid, transactionSeq: Number(e.number.slice(1)), label: e.note, category: e.category, currency: e.currency, changes: {},
    }));
    return [...S.liveEvents.filter((e) => e.ledgerId === ledgerId), ...base];
  }
  LV.historyItems = function (limit = Infinity, ledgerId = S.ledgerId) {
    return eventsFor(ledgerId).slice(0, limit).map((ev) => {
      const k = LOG_KIND[ev.kind] || LOG_KIND.updated;
      const e = ev.entryId ? LV.ENTRIES.find((x) => x.id === ev.entryId) : null;
      const c = ev.category ? cat(ev.category) : null;
      const gone = !e || S.deleted.has(e.id) || ev.kind === "deleted";
      const day = ev.at.slice(0, 10);
      return {
        id: ev.id, kind: ev.kind, icon: k.icon, tone: k.tone, kindLabel: k.label,
        actor: ev.actor, verb: ev.kind === "member_changed" ? "调整了" : k.verb,
        subject: ev.kind === "member_changed" ? "账本成员" : [c?.name, ev.label].filter(Boolean).join(" · ") || "一笔账目",
        number: ev.transactionSeq ? "#" + String(ev.transactionSeq).padStart(6, "0") : null,
        entryId: e && !S.deleted.has(e.id) ? e.id : null, gone,
        day, dayLabel: ev.live ? "今天" : LV.dayLabel(day), time: ev.live ? "刚刚" : ev.at.slice(11, 16), lines: logLines(ev), raw: ev,
      };
    });
  };
  LV.historyGroups = function (items) {
    const map = new Map();
    for (const it of items) { if (!map.has(it.day)) map.set(it.day, { day: it.day, label: it.dayLabel, items: [] }); map.get(it.day).items.push(it); }
    return [...map.values()];
  };
  LV.historyCount = (ledgerId = S.ledgerId) => eventsFor(ledgerId).length;
  function rawEvent(ev) {
    const o = { id: ev.id, kind: ev.kind, occurredAt: ev.occurredAt, actor: { id: ev.actorId || null, name: ev.actor }, transactionId: ev.transactionId, transactionSeq: ev.transactionSeq, currency: ev.currency, changes: ev.changes };
    return JSON.stringify(o, null, 2);
  }
  LV.rawEvent = rawEvent;
  function loadHistory() {
    if (S.historyDemo) { S.historyState = S.historyDemo; return; }
    if (S.historyState === "ready" && S._historyLoaded) return;
    S.historyState = "loading";
    clearTimeout(S._ht);
    S._ht = setTimeout(() => { S._historyLoaded = true; S.historyState = "ready"; LV.refresh(["history", "ledger-log"]); }, 700);
  }

  /* ---------------- 邀请成员：输入 → 发送中 → 成功 / 失败 ---------------- */
  LV.DIRECTORY = [
    { name: "王桐", username: "wangtong", account: "10295520" },
    { name: "陈默", username: "chenmo", account: "10297731" },
    { name: "林夏", username: "linxia", account: "10294472" },
    { name: "周屿", username: "zhouyu", account: "10294473" },
  ];
  function inviteCheck(v) {
    const q = v.replace(/\s+/g, "").toLowerCase();
    if (!/^\d{8}$/.test(q) && !/^[a-z][a-z0-9_]{2,}$/.test(q)) return { ok: false, msg: "请输入完整的 8 位账号编号，或完整的用户名。" };
    const who = LV.DIRECTORY.find((u) => u.account === q || u.username === q);
    if (!who) return { ok: false, msg: "没有找到这个账号。请确认编号或用户名是完整的。" };
    if (LV.ledger().members.some((m) => m.name === who.name)) return { ok: false, msg: `${who.name} 已经在这本账里了。` };
    return { ok: true, who, msg: `已向 ${who.name}（@${who.username}）发出邀请。对方接受后，会以「可编辑」身份加入「${LV.ledger().name}」。` };
  }

  /* ---------------- 视图上下文 ---------------- */
  LV.ctx = function () {
    const list = LV.visible();
    return {
      S, ledger: LV.ledger(), ledgers: LV.LEDGERS, tabLabel: LV.ledgerTabLabel(),
      summary: LV.summary(), list, groups: LV.groups(list),
      timeLabel: LV.timeLabel(), monthShort: S.range ? "自定义" : LV.monthShort(S.month),
      year: S.month === "all" ? "" : S.month.slice(0, 4),
      filterCount: LV.activeFilterCount(),
      sortLabel: `${S.sort.field === "time" ? "时间" : "金额"} · ${S.sort.dir === "desc" ? "倒序" : "正序"}`,
      user: LV.USER,
    };
  };

  /* ---------------- 共享小部件文案 ---------------- */
  LV.ENTRY_ACTIONS = [
    { id: "paste", label: "粘贴识别", short: "粘贴", icon: "clipboard" },
    { id: "voice", label: "语音记账", short: "语音", icon: "mic" },
    { id: "manual", label: "手动记账", short: "手动", icon: "pen" },
    { id: "scan", label: "拍照识别", short: "拍照", icon: "camera" },
    { id: "import", label: "导入账单", short: "导入", icon: "fileUp" },
  ];
  LV.TABS = [
    { id: "entries", label: "明细", icon: "list" },
    { id: "stats", label: "分析", icon: "chart" },
    { id: "add", label: "记账", icon: "plus", primary: true },
    { id: "ledger", label: "账本", icon: "people" },
    { id: "me", label: "我的", icon: "person" },
  ];
  LV.tabLabel = (t) => (t.id === "ledger" ? LV.ledgerTabLabel() : t.label);
  LV.ME_LINKS = () => [
    { id: "profile", label: "个人资料", icon: "person" },
    { id: "book", label: "当前账本详情", hint: LV.ledger().name, icon: "book" },
    { id: "downloads", label: "下载管理", hint: "离线能看哪些月份，以及占用多少空间", icon: "download" },
    { id: "update", label: "软件更新", hint: `版本 ${LV.USER.version} · 查看更新记录`, icon: "sparkle" },
    { id: "settings", label: "设置", hint: "默认币种、账号安全、显示与数据", icon: "gear" },
  ];
  LV.FILTER_DIMS = [
    { id: "time", label: "时间" }, { id: "categories", label: "分类" }, { id: "tags", label: "标签" },
    { id: "payments", label: "支付方式" }, { id: "currencies", label: "币种" }, { id: "attachments", label: "附件" },
  ];

  /* ---------------- 路由 ---------------- */
  const TAB_ROUTES = ["entries", "stats", "ledger", "me"];
  function parseHash() {
    const h = (location.hash || "#/").slice(1);
    const parts = h.split("/").filter(Boolean);
    if (!parts.length) return { name: "entries" };
    if (parts[0] === "stats" && parts[1] === "card") return { name: "card", key: parts[2], depth: 1, parent: "stats" };
    if (parts[0] === "stats") return { name: "stats" };
    if (parts[0] === "ledger" && parts[1] === "history") return { name: "history", depth: 1, parent: "ledger", parentPath: "/ledger" };
    if (parts[0] === "ledger") return { name: "ledger" };
    if (parts[0] === "me" && parts[1] === "settings" && parts[2]) return { name: "subsettings", sub: parts[2], depth: 2, parent: "me", parentPath: "/me/settings" };
    if (parts[0] === "me" && parts[1] === "settings") return { name: "settings", depth: 1, parent: "me", parentPath: "/me" };
    if (parts[0] === "me") return { name: "me" };
    if (parts[0] === "entry") {
      const from = parts[2] || "entries";
      const parentPath = from === "history" ? "/ledger/history" : from === "ledger" ? "/ledger" : from === "stats" ? "/stats" : "/";
      return { name: "entry", id: parts[1], depth: from === "history" ? 2 : 1, parent: from, parentPath };
    }
    return { name: "entries" };
  }
  LV.isTab = (r = S.route) => TAB_ROUTES.includes(r.name);
  /** 与正式版一致：明细与分析页在底栏上方显示「当前账本：…」，批量操作时让位给操作栏。 */
  LV.showCaption = () => LV.isTab() && !S.selecting && ["entries", "stats"].includes(S.route.name);
  LV.go = (path) => { if (location.hash !== "#" + path) location.hash = path; };
  LV.back = () => {
    if (history.length > 1 && S._pushed) history.back();
    else LV.go(S.route.parentPath || (S.route.parent === "entries" || !S.route.parent ? "/" : "/" + S.route.parent));
  };
  const ROUTE_PATH = { entries: "/", stats: "/stats", ledger: "/ledger", me: "/me" };

  /* ---------------- 渲染 ---------------- */
  const scrollMemory = new Map();
  let root, pagesEl, navEl, menuEl, sheetEl, dialogEl, toastEl;
  const style = () => LV.styles[S.style];

  function routeKey(r) { return r.name + (r.id ? ":" + r.id : "") + (r.key ? ":" + r.key : "") + (r.sub ? ":" + r.sub : ""); }
  function currentPage() { return pagesEl.querySelector(".page:not(.leaving)"); }

  function pageHTML(r, ctx) {
    const st = style();
    if (r.name === "entry") {
      const e = LV.ENTRIES.find((x) => x.id === r.id);
      return e ? st.entryPage(ctx, e) : st.entriesPage(ctx);
    }
    if (r.name === "card") return st.cardPage(ctx, r.key);
    if (r.name === "subsettings") return LV.SUBSETTINGS[r.sub] ? st.subSettingsPage(ctx, r.sub) : st.settingsPage(ctx);
    const fn = { entries: st.entriesPage, stats: st.statsPage, ledger: st.ledgerPage, history: st.historyPage, me: st.mePage, settings: st.settingsPage }[r.name];
    return fn(ctx);
  }

  function render(mode = "replace") {
    const ctx = LV.ctx();
    const r = S.route;
    const old = currentPage();
    const keepScroll = mode === "same" && old;
    const prevScroll = old?.querySelector(".scroll")?.scrollTop ?? 0;
    if (old) scrollMemory.set(old.dataset.key, prevScroll);
    const el = document.createElement("section");
    el.className = "page";
    el.dataset.route = r.name;
    el.dataset.key = routeKey(r);
    el.innerHTML = pageHTML(r, ctx);
    if (mode === "push" || mode === "pop" || mode === "tab") {
      el.classList.add("enter-" + mode);
      if (old) {
        old.classList.add("leaving", "leave-" + mode);
        old.setAttribute("aria-hidden", "true");
        old.setAttribute("inert", "");
        const done = () => old.remove();
        if (LV.reduced()) done(); else setTimeout(done, mode === "tab" ? 180 : 360);
      }
      pagesEl.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("enter-" + mode)));
    } else {
      if (old) old.remove();
      pagesEl.appendChild(el);
    }
    const sc = el.querySelector(".scroll");
    if (sc) {
      const remembered = keepScroll ? prevScroll : (mode === "pop" || mode === "tab" || mode === "replace") ? scrollMemory.get(el.dataset.key) || 0 : 0;
      sc.scrollTop = remembered;
      bindScroll(el, sc);
    }
    renderNav(ctx);
    style().afterRender?.(el, ctx);
    if (S.searchOpen && r.name === "entries") {
      const input = el.querySelector("[data-input=search]");
      if (input) { input.focus({ preventScroll: true }); const v = input.value; input.value = ""; input.value = v; }
    }
    postToParent();
  }
  LV.render = render;

  function bindScroll(pageEl, sc) {
    let ticking = false;
    // 标题区（data-collapse）基本被吸顶栏盖住时，切换为紧凑标题
    const at = () => {
      const s = pageEl.querySelector("[data-collapse]");
      if (!s) return 24;
      const top = s.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      const bar = pageEl.querySelector(".scroll > header");
      return Math.max(8, top + s.offsetHeight - (bar ? bar.offsetHeight : 0) - (style().collapseOffset ?? 8));
    };
    let threshold = at();
    const pinAt = () => {
      const p = pageEl.querySelector("[data-pin]");
      if (!p) return Infinity;
      return p.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (parseFloat(getComputedStyle(p).top) || 0) - 1;
    };
    let pin = Infinity;
    const update = () => {
      ticking = false;
      const on = sc.scrollTop > threshold;
      if ((pageEl.dataset.scrolled === "true") !== on) pageEl.dataset.scrolled = on ? "true" : "false";
      const pinned = sc.scrollTop >= pin;
      if ((pageEl.dataset.pinned === "true") !== pinned) pageEl.dataset.pinned = pinned ? "true" : "false";
      const top = sc.scrollTop > 2;
      if ((pageEl.dataset.top === "false") !== top) pageEl.dataset.top = top ? "false" : "true";
    };
    let postT = 0;
    sc.addEventListener("scroll", () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
      if (window.parent !== window && !LV._quietScroll) { clearTimeout(postT); postT = setTimeout(() => window.parent.postMessage({ lv: "scroll", top: sc.scrollTop, route: location.hash || "#/" }, "*"), 60); }
    }, { passive: true });
    const measure = () => { const keep = sc.scrollTop; threshold = at(); pin = pinAt(); sc.scrollTop = keep; update(); };
    pageEl._measure = measure;
    setTimeout(measure, 0);
    update();
  }

  /** 局部刷新：只替换带 data-region 的区域，保留滚动与输入焦点。 */
  LV.refresh = function (names) {
    const page = currentPage();
    if (!page) return;
    const st = style();
    const ctx = LV.ctx();
    for (const n of names) {
      const fn = st.regions?.[n];
      page.querySelectorAll(`[data-region="${n}"]`).forEach((node) => { if (fn) node.innerHTML = fn(ctx); });
    }
    page.querySelectorAll("[data-kind-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === S.kind)));
    page.querySelectorAll("[data-kind-track]").forEach((t) => t.style.setProperty("--i", ["all", "expense", "income"].indexOf(S.kind)));
    renderNav(ctx);
    page._measure?.();
    postToParent();
  };

  function renderNav(ctx = LV.ctx()) {
    const st = style();
    const show = LV.isTab();
    root.dataset.nav = show ? (S.selecting ? "batch" : "tabs") : "none";
    root.dataset.cap = LV.showCaption() ? "true" : "false";
    navEl.innerHTML = !show ? "" : S.selecting ? st.batchBar(ctx) : st.nav(ctx);
    menuEl.innerHTML = show && !S.selecting ? st.entryCards(ctx) : "";
    root.dataset.menu = S.entryMenu ? "open" : "closed";
    postToParent();
  }
  LV.renderNav = renderNav;

  /* ---------------- 浮层（Bottom Sheet） ---------------- */
  let lastFocus = null;
  LV.openSheet = function (type, extra = {}) {
    S.entryMenu = false;
    lastFocus = document.activeElement;
    if (type === "filter") S.sheet = { type, tab: "time", draft: { month: S.month, range: S.range ? { ...S.range } : null, rangeMode: !!S.range, filters: JSON.parse(JSON.stringify(S.filters)), year: Number((S.month === "all" ? LV.TODAY : S.month).slice(0, 4)), search: "" } };
    else S.sheet = { type, ...extra };
    renderSheet(true);
    renderNav();
  };
  LV.closeSheet = function () {
    if (!S.sheet) return;
    const box = sheetEl.firstElementChild;
    S.sheet = null;
    if (box && !LV.reduced()) {
      sheetEl.dataset.state = "closing";
      setTimeout(() => { if (!S.sheet) { sheetEl.innerHTML = ""; sheetEl.dataset.state = "closed"; } }, 280);
    } else { sheetEl.innerHTML = ""; sheetEl.dataset.state = "closed"; }
    lastFocus?.focus?.({ preventScroll: true });
    postToParent();
  };
  function renderSheet(fresh) {
    if (!S.sheet) return;
    const inner = LV.sheetContent(S.sheet);
    const scrollers = [...sheetEl.querySelectorAll("[data-keep-scroll]")].map((n) => n.scrollTop);
    sheetEl.innerHTML = `<div class="scrim" data-act="sheet-close" aria-hidden="true"></div>${style().sheetFrame(inner, S.sheet)}`;
    sheetEl.querySelectorAll("[data-keep-scroll]").forEach((n, i) => (n.scrollTop = scrollers[i] || 0));
    if (fresh) {
      sheetEl.dataset.state = "opening";
      requestAnimationFrame(() => requestAnimationFrame(() => (sheetEl.dataset.state = "open")));
      setTimeout(() => { const pnl = sheetEl.querySelector(".sheet"); if (pnl) { pnl.tabIndex = -1; pnl.focus({ preventScroll: true }); } }, 30);
      bindDrag();
    }
    postToParent();
  }
  LV.renderSheet = renderSheet;

  function bindDrag() {
    const panel = sheetEl.querySelector(".sheet");
    if (!panel) return;
    let y0 = null, dy = 0;
    panel.addEventListener("pointerdown", (e) => {
      if (!e.target.closest("[data-drag]")) return;
      y0 = e.clientY; dy = 0; panel.setPointerCapture(e.pointerId); panel.style.transition = "none";
    });
    panel.addEventListener("pointermove", (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.clientY - y0);
      panel.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (y0 === null) return;
      y0 = null; panel.style.transition = ""; panel.style.transform = "";
      if (dy > 90) LV.closeSheet();
    };
    panel.addEventListener("pointerup", end);
    panel.addEventListener("pointercancel", end);
  }

  /* 浮层内容：结构共享，外壳与质感由风格决定。 */
  LV.sheetContent = function (sh) {
    const icon = LV.icon;
    const head = (title, sub = "") => `<header class="sh-head" data-drag><div class="sh-grip" aria-hidden="true"></div><div class="sh-titlebar"><div><h2 class="sh-title" id="sheet-title">${title}</h2>${sub ? `<p class="sh-sub">${sub}</p>` : ""}</div><button type="button" class="sh-close" data-act="sheet-close" aria-label="关闭">${icon("close", { size: 18 })}</button></div></header>`;
    if (sh.type === "sort") {
      const opt = (act, v, label, on) => `<button type="button" class="sh-opt" data-act="${act}" data-v="${v}" aria-pressed="${on}"><span>${label}</span><span class="sh-check">${icon("check", { size: 18 })}</span></button>`;
      return `${head("排序")}<div class="sh-body"><div class="sh-group">${opt("sort-field", "time", "时间", S.sort.field === "time")}${opt("sort-field", "amount", "金额", S.sort.field === "amount")}</div><h3 class="sh-label">排序方向</h3><div class="sh-group">${opt("sort-dir", "desc", S.sort.field === "time" ? "倒序 · 从新到旧" : "倒序 · 从大到小", S.sort.dir === "desc")}${opt("sort-dir", "asc", S.sort.field === "time" ? "正序 · 从旧到新" : "正序 · 从小到大", S.sort.dir === "asc")}</div></div>`;
    }
    if (sh.type === "ledger") {
      const rows = LV.LEDGERS.map((l) => `<button type="button" class="sh-book" data-act="pick-ledger" data-id="${l.id}" aria-pressed="${l.id === S.ledgerId}"><span class="sh-book-main"><span class="sh-book-name">${esc(l.name)}</span><span class="sh-book-meta"><span class="mono">${l.number}</span><span>·</span><span>${l.members.length} 人</span>${l.id === S.ledgerId ? '<span class="sh-badge">当前记账</span>' : ""}</span></span><span class="sh-check">${icon("check", { size: 20 })}</span></button>`).join("");
      return `${head("选择账本", "切换当前账本，继续在本页查看。")}<div class="sh-body"><div class="sh-group">${rows}</div></div><footer class="sh-foot sh-foot-link"><button type="button" class="sh-link" data-act="toast" data-msg="原型未包含「账本空间」页面">管理全部账本</button></footer>`;
    }
    if (sh.type === "currencies") {
      const rows = LV.currencySummaries().map((c) => `<div class="sh-cur"><div class="sh-cur-head"><span class="sh-cur-code">${c.currency}</span><span class="sh-cur-name">${CUR(c.currency).name}${c.currency === LV.ledger().currency ? " · 主币种" : ""}</span></div><dl class="sh-cur-grid"><div><dt>支出</dt><dd>${LV.money(c.expense, c.currency)}</dd></div><div><dt>收入</dt><dd>${LV.money(c.income, c.currency)}</dd></div><div><dt>结余</dt><dd>${LV.money(c.balance, c.currency)}</dd></div></dl></div>`).join("");
      return `${head("全部币种", LV.timeLabel())}<div class="sh-body">${rows}<p class="sh-note">各币种分别统计，不做汇率折算。</p></div>`;
    }
    if (sh.type === "stats-settings") {
      return `${head("统计设置")}<div class="sh-body"><h3 class="sh-label">统计方式与币种</h3><div class="sh-group"><button type="button" class="sh-opt" aria-pressed="true"><span>原币统计 · CNY</span><span class="sh-check">${icon("check", { size: 18 })}</span></button><button type="button" class="sh-opt" data-act="toast" data-msg="综合折算需要汇率数据，原型中未接入"><span>综合折算</span><span class="sh-check">${icon("check", { size: 18 })}</span></button></div><p class="sh-note">按人民币原币统计，不做汇率折算。</p></div>`;
    }
    if (sh.type === "filter") return filterSheet(sh, head);
    if (sh.type === "log") {
      const it = LV.historyItems().find((x) => x.id === sh.id);
      if (!it) return head("记录详情");
      const lines = it.lines.length ? it.lines : [{ text: it.kind === "created" ? "新建了这笔账目" : it.kind === "deleted" ? "删除了这笔账目，可在账目详情中恢复" : it.kind === "restored" ? "把这笔账目恢复到删除前的状态" : "没有记录到具体字段" , muted: true }];
      const ic = icon(it.icon, { size: 16 });
      return `${head("记录详情", `${it.dayLabel} ${it.time}`)}<div class="sh-body"><div class="sh-group sh-log">
        <div class="sh-log-head"><span class="u-log-ic tone-${it.tone}">${ic}</span><p><b>${esc(it.actor)}</b> ${it.verb} ${esc(it.subject)}${it.number ? ` <span class="u-num">${it.number}</span>` : ""}</p></div>
        <ul class="sh-log-lines">${lines.map((l) => `<li class="${l.muted ? "muted" : ""}">${esc(l.text)}${l.hint ? `<small>${esc(l.hint)}</small>` : ""}</li>`).join("")}</ul></div>
        ${it.entryId ? `<button type="button" class="sh-wide" data-act="log-open" data-id="${it.entryId}">${icon("note", { size: 18 })}查看这笔账目</button>` : it.raw.transactionId ? `<p class="sh-note">这笔账目已删除，可在“已删除的账目”中恢复（原型未包含）。</p>` : ""}
        <div class="sh-raw" data-open="false"><button type="button" class="sh-raw-t" data-act="raw-toggle" aria-expanded="false">${icon("code", { size: 16 })}<span>技术信息</span><small>事件编号、原始字段</small>${icon("down", { size: 16, cls: "sh-raw-chev" })}</button><div class="sh-raw-body"><pre>${esc(rawEvent(it.raw))}</pre><button type="button" class="sh-link" data-act="raw-copy">复制原始记录</button></div></div>
      </div>`;
    }
    return head("");
  };

  function filterSheet(sh, head) {
    const d = sh.draft;
    const icon = LV.icon;
    const chipsFor = () => {
      const out = [];
      if (d.rangeMode && d.range?.from) out.push(["time", `${d.range.from} 至 ${d.range.to || "…"}`]);
      else out.push(["time", LV.monthLabel(d.month)]);
      const names = { categories: (id) => cat(id).name, tags: (id) => tag(id).name, payments: (id) => pay(id).name, currencies: (id) => id };
      for (const k of ["categories", "tags", "payments", "currencies"]) if (d.filters[k].length) out.push([k, d.filters[k].length === 1 ? names[k](d.filters[k][0]) : `${LV.FILTER_DIMS.find((x) => x.id === k).label} · ${d.filters[k].length}`]);
      if (d.filters.attachment !== "any") out.push(["attachments", d.filters.attachment === "has" ? "有附件" : "无附件"]);
      return out.map(([k, label]) => `<button type="button" class="sh-chip" data-act="f-chip" data-key="${k}" ${k === "time" ? 'data-fixed="true"' : ""} aria-label="${k === "time" ? "时间" : "移除" + esc(label) + "筛选"}"><span>${esc(label)}</span>${k === "time" ? "" : icon("close", { size: 12, w: 2 })}</button>`).join("");
    };
    const active = (k) => (k === "time" ? d.rangeMode || d.month !== S.month : k === "attachments" ? d.filters.attachment !== "any" : d.filters[k].length > 0);
    const nav = LV.FILTER_DIMS.map((x) => `<button type="button" role="tab" class="sh-ftab" data-act="f-tab" data-v="${x.id}" aria-selected="${sh.tab === x.id}"><span>${x.label}</span>${active(x.id) && x.id !== "time" ? '<i class="sh-dot" aria-hidden="true"></i>' : ""}</button>`).join("");
    let body = "";
    if (sh.tab === "time") {
      const months = Array.from({ length: 12 }, (_, i) => {
        const m = `${d.year}-${pad(i + 1)}`;
        const disabled = m > LV.TODAY.slice(0, 7) || m < "2026-09";
        return `<button type="button" class="sh-month" data-act="f-month" data-v="${m}" aria-pressed="${!d.rangeMode && d.month === m}" ${disabled ? "disabled" : ""}>${i + 1} 月</button>`;
      }).join("");
      body = `<div class="sh-seg" role="group" aria-label="时间方式"><button type="button" data-act="f-mode" data-v="month" aria-pressed="${!d.rangeMode}">按月</button><button type="button" data-act="f-mode" data-v="range" aria-pressed="${d.rangeMode}">日期范围</button></div>` +
        (d.rangeMode
          ? `<div class="sh-range"><label><span>开始日期</span><input type="text" inputmode="numeric" placeholder="YYYY-MM-DD" data-input="range-from" value="${esc(d.range?.from || "")}"></label><label><span>结束日期</span><input type="text" inputmode="numeric" placeholder="YYYY-MM-DD" data-input="range-to" value="${esc(d.range?.to || "")}"></label><p class="sh-note">年-月-日，如 2026-10-01</p></div>`
          : `<button type="button" class="sh-opt sh-opt-all" data-act="f-month" data-v="all" aria-pressed="${d.month === "all"}"><span>全部时间</span><span class="sh-check">${icon("check", { size: 18 })}</span></button><div class="sh-year"><button type="button" class="sh-icon" data-act="f-year" data-d="-1" aria-label="上一年">${icon("left", { size: 18 })}</button><span>${d.year}</span><button type="button" class="sh-icon" data-act="f-year" data-d="1" aria-label="下一年" ${d.year >= 2026 ? "disabled" : ""}>${icon("right", { size: 18 })}</button></div><div class="sh-months">${months}</div><p class="sh-note">灰色月份本机暂无记录。</p>`);
    } else if (sh.tab === "attachments") {
      const o = (v, l) => `<button type="button" class="sh-opt" data-act="f-att" data-v="${v}" aria-pressed="${d.filters.attachment === v}"><span>${l}</span><span class="sh-check">${icon("check", { size: 18 })}</span></button>`;
      body = `<div class="sh-group">${o("any", "不限")}${o("has", "有附件")}${o("none", "无附件")}</div>`;
    } else {
      const k = sh.tab;
      const items = k === "categories" ? LV.CATEGORIES.map((c) => ({ id: c.id, name: c.name, meta: c.kind === "income" ? "收入" : "支出", hue: c.hue }))
        : k === "tags" ? LV.TAGS.map((t) => ({ id: t.id, name: t.name }))
          : k === "payments" ? LV.PAYMENTS.map((p) => ({ id: p.id, name: p.name }))
            : LV.CURRENCIES.map((c) => ({ id: c.id, name: `${c.id} · ${c.name}` }));
      const q = (sh.search || "").trim();
      const shown = items.filter((i) => !q || i.name.includes(q));
      body = `<input type="search" class="sh-search" placeholder="搜索选项" aria-label="搜索选项" data-input="f-search" value="${esc(q)}"><div class="sh-group"><button type="button" class="sh-opt" data-act="f-unlimited" data-key="${k}" aria-pressed="${d.filters[k].length === 0}"><span>不限</span><span class="sh-check">${icon("check", { size: 18 })}</span></button>${shown.map((i) => `<button type="button" class="sh-opt" data-act="f-toggle" data-key="${k}" data-id="${i.id}" aria-pressed="${d.filters[k].includes(i.id)}"><span>${i.hue ? `<i class="sh-swatch" style="--hue:${i.hue}"></i>` : ""}${esc(i.name)}${i.meta ? `<em class="sh-meta">${i.meta}</em>` : ""}</span><span class="sh-check">${icon("check", { size: 18 })}</span></button>`).join("")}${shown.length ? "" : '<p class="sh-note">没有匹配的选项</p>'}</div>`;
    }
    const preview = previewCount(d);
    return `${head("筛选")}<div class="sh-chips" aria-label="已选条件">${chipsFor()}</div><div class="sh-filter"><nav class="sh-fnav" role="tablist" aria-label="筛选维度">${nav}</nav><div class="sh-fbody" role="tabpanel" data-keep-scroll>${body}</div></div><footer class="sh-foot"><button type="button" class="sh-reset" data-act="f-reset">重置</button><button type="button" class="sh-apply m-accent" data-act="f-apply">查看结果<span class="sh-apply-n">${preview} 笔</span></button></footer>`;
  }
  function previewCount(d) {
    const f = { month: d.rangeMode ? "all" : d.month, range: d.rangeMode && d.range?.from && d.range?.to ? d.range : null };
    return ledgerEntries().filter((e) => inTime(e, f) && passFilters(e, d.filters)).length;
  }

  /* ---------------- 对话框与提示 ---------------- */
  LV.confirm = function (opts) {
    S.dialog = opts;
    lastFocus = document.activeElement;
    dialogEl.innerHTML = `<div class="scrim" aria-hidden="true"></div>${style().dialogFrame(`<h2 class="dl-title" id="dialog-title">${opts.title}</h2>${opts.desc ? `<p class="dl-desc">${opts.desc}</p>` : ""}${opts.consequences ? `<ul class="dl-list">${opts.consequences.map((c) => `<li>${c}</li>`).join("")}</ul>` : ""}<div class="dl-actions"><button type="button" class="dl-btn dl-cancel" data-act="dialog-cancel">取消</button><button type="button" class="dl-btn dl-confirm ${opts.danger ? "danger" : "m-accent"}" data-act="dialog-confirm" data-autofocus>${opts.confirmLabel || "确认"}</button></div>`)}`;
    dialogEl.dataset.state = "opening";
    requestAnimationFrame(() => requestAnimationFrame(() => (dialogEl.dataset.state = "open")));
    setTimeout(() => dialogEl.querySelector(".dl-cancel")?.focus(), 30);
    postToParent();
  };
  LV.closeDialog = function () {
    S.dialog = null;
    dialogEl.dataset.state = "closing";
    setTimeout(() => { if (!S.dialog) { dialogEl.innerHTML = ""; dialogEl.dataset.state = "closed"; } }, LV.reduced() ? 0 : 200);
    lastFocus?.focus?.({ preventScroll: true });
    postToParent();
  };
  let toastTimer;
  LV.toast = function (msg, action) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = style().toast(esc(msg), action);
    toastEl._action = action?.fn;
    toastEl.dataset.state = "open";
    toastTimer = setTimeout(() => (toastEl.dataset.state = "closed"), action ? 4200 : 2400);
  };

  /* ---------------- 事件 ---------------- */
  const A = {};
  LV.actions = A;
  A.tab = (el) => {
    S.entryMenu = false;
    if (el.dataset.to === S.route.name) { currentPage()?.querySelector(".scroll")?.scrollTo({ top: 0, behavior: LV.reduced() ? "auto" : "smooth" }); return; }
    LV.go(ROUTE_PATH[el.dataset.to]);
  };
  A.back = () => LV.back();
  A.entry = (el) => {
    if (S.selecting) { const id = el.dataset.id; S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); LV.refresh(["list", "batch"]); return; }
    S._pushed = true;
    const from = el.dataset.from || (S.route.name === "card" ? "stats" : S.route.name === "history" ? "history" : S.route.name === "ledger" ? "ledger" : "");
    LV.go(`/entry/${el.dataset.id}${from ? "/" + from : ""}`);
  };
  A.kind = (el) => { S.kind = el.dataset.v; LV.refresh(["list", "summary", "toolbar"]); };
  A["search-open"] = () => { S.searchOpen = true; S.query = ""; render("same"); };
  A["search-cancel"] = () => { S.searchOpen = false; S.query = ""; render("same"); };
  A["search-clear"] = () => {
    S.query = "";
    const input = currentPage()?.querySelector("[data-input=search]");
    if (input) { input.value = ""; input.focus(); }
    document.querySelectorAll("[data-search-clear]").forEach((b) => (b.hidden = true));
    LV.refresh(["list", "search-scope", "toolbar"]);
  };
  A.sheet = (el) => LV.openSheet(el.dataset.type);
  A["sheet-close"] = () => LV.closeSheet();
  A["sort-field"] = (el) => { S.sort.field = el.dataset.v; renderSheet(); LV.refresh(["list", "toolbar"]); };
  A["sort-dir"] = (el) => { S.sort.dir = el.dataset.v; renderSheet(); LV.refresh(["list", "toolbar"]); setTimeout(() => LV.closeSheet(), 160); };
  A["pick-ledger"] = (el) => {
    const id = el.dataset.id;
    if (id === S.ledgerId) { LV.closeSheet(); return; }
    S.ledgerId = id; S.selected.clear();
    LV.closeSheet();
    render("same");
    LV.toast(`已切换到「${LV.ledger().name}」`);
  };
  A["menu-toggle"] = () => { S.entryMenu = !S.entryMenu; renderNav(); };
  A["menu-item"] = (el) => { S.entryMenu = false; renderNav(); LV.toast(`「${el.dataset.label}」记账流程不在本轮视觉实验范围`); };
  A["batch-start"] = () => { S.selecting = true; S.selected.clear(); S.entryMenu = false; render("same"); };
  A["batch-exit"] = () => { S.selecting = false; S.selected.clear(); render("same"); };
  A["batch-edit"] = () => LV.toast(S.selected.size ? `批量修改 ${S.selected.size} 笔：原型中未实现编辑表单` : "请先选择账目");
  A["batch-delete"] = () => {
    if (!S.selected.size) { LV.toast("请先选择账目"); return; }
    const n = S.selected.size;
    LV.confirm({
      title: `删除 ${n} 笔账目？`, desc: "删除后可以在账本的编辑记录中恢复。", confirmLabel: "删除", danger: true,
      onConfirm: () => { const ids = [...S.selected]; ids.forEach((id) => S.deleted.add(id)); S.selected.clear(); S.selecting = false; render("same"); LV.toast(`已删除 ${n} 笔`, { label: "撤销", fn: () => { ids.forEach((id) => S.deleted.delete(id)); render("same"); } }); },
    });
  };
  A.more = () => LV.toast("「明细更多」：导出账目与数据维护（原型未包含该页）");
  A["entry-edit"] = () => LV.toast("修改表单不在本轮视觉实验范围");
  A["entry-copy"] = () => LV.toast("已复制这一笔，原型不会新建记录");
  A["entry-delete"] = (el) => {
    const id = el.dataset.id;
    LV.confirm({
      title: "删除这笔记账？", desc: "删除后可以在账本的编辑记录中恢复。", confirmLabel: "删除", danger: true,
      onConfirm: () => {
        S.deleted.add(id);
        const e = LV.ENTRIES.find((x) => x.id === id);
        S.liveEvents.unshift({ id: "evt_live_" + Date.now(), ledgerId: e.ledgerId, kind: "deleted", at: LV.TODAY + "T23:59", occurredAt: new Date().toISOString(), live: true, actor: LV.USER.name, actorId: LV.MEMBER_IDS[LV.USER.name], entryId: e.id, transactionId: e.uuid, transactionSeq: Number(e.number.slice(1)), label: e.note, category: e.category, currency: e.currency, changes: {} });
        LV.back();
        setTimeout(() => LV.toast("已删除这笔记账", { label: "撤销", fn: () => { S.deleted.delete(id); S.liveEvents.shift(); render("same"); } }), 60);
      },
    });
  };
  A["dialog-cancel"] = () => LV.closeDialog();
  A["dialog-confirm"] = () => { const fn = S.dialog?.onConfirm; LV.closeDialog(); fn?.(); };
  A["toast-action"] = () => { toastEl._action?.(); toastEl.dataset.state = "closed"; };
  A.toast = (el) => LV.toast(el.dataset.msg);
  A.currencies = () => LV.openSheet("currencies");
  // 筛选浮层
  const D = () => S.sheet.draft;
  A["f-tab"] = (el) => { S.sheet.tab = el.dataset.v; S.sheet.search = ""; renderSheet(); };
  A["f-mode"] = (el) => { D().rangeMode = el.dataset.v === "range"; if (D().rangeMode && !D().range) D().range = { from: "", to: "" }; renderSheet(); };
  A["f-month"] = (el) => { D().month = el.dataset.v; D().rangeMode = false; renderSheet(); };
  A["f-year"] = (el) => { D().year += Number(el.dataset.d); renderSheet(); };
  A["f-att"] = (el) => { D().filters.attachment = el.dataset.v; renderSheet(); };
  A["f-unlimited"] = (el) => { D().filters[el.dataset.key] = []; renderSheet(); };
  A["f-toggle"] = (el) => { const arr = D().filters[el.dataset.key]; const i = arr.indexOf(el.dataset.id); i >= 0 ? arr.splice(i, 1) : arr.push(el.dataset.id); renderSheet(); };
  A["f-chip"] = (el) => {
    const k = el.dataset.key;
    if (k === "time") { S.sheet.tab = "time"; }
    else if (k === "attachments") D().filters.attachment = "any";
    else D().filters[k] = [];
    renderSheet();
  };
  A["f-reset"] = () => { const d = D(); d.month = LV.TODAY.slice(0, 7); d.rangeMode = false; d.range = null; d.filters = { categories: [], tags: [], payments: [], currencies: [], attachment: "any" }; renderSheet(); };
  A["f-apply"] = () => {
    const d = D();
    const ok = !d.rangeMode || (/^\d{4}-\d{2}-\d{2}$/.test(d.range?.from || "") && /^\d{4}-\d{2}-\d{2}$/.test(d.range?.to || "") && d.range.from <= d.range.to);
    if (!ok) { LV.toast("请输入有效的起止日期，结束日期不得早于开始日期。"); return; }
    S.month = d.rangeMode ? "all" : d.month; S.range = d.rangeMode ? { ...d.range } : null; S.filters = d.filters;
    LV.closeSheet(); render("same");
  };
  // 分析页
  A["stats-filter"] = () => { S.statsFilterOpen = !S.statsFilterOpen; S.statsDraft = [...S.statsCats]; render("same"); };
  A["stats-cat"] = (el) => { const id = el.dataset.id; const i = S.statsDraft.indexOf(id); i >= 0 ? S.statsDraft.splice(i, 1) : S.statsDraft.push(id); LV.refresh(["stats-filter"]); };
  A["stats-apply"] = () => { S.statsCats = [...S.statsDraft]; S.statsFilterOpen = false; render("same"); };
  A["stats-revert"] = () => { S.statsDraft = [...S.statsCats]; LV.refresh(["stats-filter"]); };
  A["stats-edit"] = () => LV.toast("布局编辑（拖放、预设）沿用 S17/S18 成果，本轮只比较视觉");
  A["stats-settings"] = () => LV.openSheet("stats-settings");
  A.card = (el) => { S._pushed = true; LV.go(`/stats/card/${el.dataset.key}`); };
  A.dot = (el) => { const track = currentPage().querySelector("[data-carousel]"); const k = track?.children[Number(el.dataset.i)]; if (k) track.scrollTo({ left: k.offsetLeft - (parseFloat(getComputedStyle(track).paddingLeft) || 0), behavior: LV.reduced() ? "auto" : "smooth" }); };
  // 我的 / 设置 / 账本
  A["me-link"] = (el) => {
    const id = el.dataset.id;
    if (id === "settings") { S._pushed = true; LV.go("/me/settings"); return; }
    if (id === "book") { LV.go("/ledger"); return; }
    LV.toast(`「${el.dataset.label}」子页面不在本轮范围`);
  };
  A.setting = (el) => { if (el.dataset.to) { S._pushed = true; LV.go(el.dataset.to); return; } LV.toast(`「${el.dataset.label}」子页面不在本轮范围`); };
  A.signout = () => LV.confirm({ title: "退出登录？", desc: "退出后需重新登录。账目数据不会删除。", consequences: ["本设备上的登录状态会立即失效", "如果忘记密码，需要用恢复码重置"], confirmLabel: "退出登录", danger: true, onConfirm: () => LV.toast("原型不会真的退出登录") });
  function inviteUI() {
    const f = currentPage()?.querySelector("[data-invite]");
    if (!f) return;
    const st = S.invite.status;
    f.dataset.state = st;
    const input = f.querySelector("[data-input=invite]"), btn = f.querySelector("[data-invite-submit]");
    if (input) { input.readOnly = st === "sending"; input.setAttribute("aria-invalid", String(st === "error")); }
    if (btn) { btn.disabled = st === "sending" || !(input?.value.trim()); btn.setAttribute("aria-busy", String(st === "sending")); }
    const msg = f.querySelector("[data-region=invite-status]");
    if (msg) msg.innerHTML = style().regions["invite-status"](LV.ctx());
  }
  LV.inviteUI = inviteUI;
  A.invite = () => {
    const input = currentPage().querySelector("[data-input=invite]");
    const v = input?.value.trim();
    if (!v || S.invite.status === "sending") { input?.focus(); return; }
    S.invite = { status: "sending", msg: "", target: v };
    inviteUI();
    setTimeout(() => {
      const r = inviteCheck(v);
      S.invite = { status: r.ok ? "sent" : "error", msg: r.msg, target: v };
      if (r.ok && input) input.value = "";
      inviteUI();
      if (!r.ok) input?.focus();
    }, LV.reduced() ? 50 : 900);
  };
  A["history-all"] = () => { S._pushed = true; LV.go("/ledger/history"); };
  A["history-retry"] = () => { S.historyDemo = null; S._historyLoaded = false; loadHistory(); LV.refresh(["history", "ledger-log"]); };
  A["log-detail"] = (el) => LV.openSheet("log", { id: el.dataset.id });
  A["log-open"] = (el) => { LV.closeSheet(); setTimeout(() => { S._pushed = true; LV.go(`/entry/${el.dataset.id}/history`); }, 120); };
  A["raw-toggle"] = (el) => { const box = el.closest(".sh-raw"); const open = box.dataset.open !== "true"; box.dataset.open = String(open); el.setAttribute("aria-expanded", String(open)); };
  A["raw-copy"] = () => LV.toast("已复制原始记录");
  A.toggle = (el) => {
    const id = el.dataset.id;
    if (el.getAttribute("aria-disabled") === "true") { LV.toast(el.dataset.reason || "这一项暂时不能修改"); return; }
    S.toggles[id] = !S.toggles[id];
    el.setAttribute("aria-checked", String(S.toggles[id]));
    const v = el.closest(".u-li")?.querySelector("[data-toggle-state]");
    if (v) v.textContent = S.toggles[id] ? "已开启" : "已关闭";
  };
  A["setting-action"] = (el) => {
    if (el.dataset.id === "close") LV.confirm({ title: "注销账号？", desc: "账号会先进入 30 天冷静期，期间重新登录即可撤销。", consequences: ["你创建的账本会在冷静期结束后永久删除", "共享账本里的其他成员会失去这些账本", "此操作不会自动导出数据，请先导出"], confirmLabel: "继续注销", danger: true, onConfirm: () => LV.toast("原型不会真的注销账号") });
    else LV.confirm({ title: "清除本机缓存？", desc: "只删除这台设备上的离线数据，云端账目不受影响。下次打开会重新下载。", confirmLabel: "清除", onConfirm: () => LV.toast("已清除本机缓存（演示）") });
  };

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]");
    if (S.entryMenu && !ev.target.closest(".menu-layer") && !(el && el.dataset.act === "menu-toggle")) { S.entryMenu = false; renderNav(); if (!el) return; }
    if (!el || el.disabled) return;
    const fn = A[el.dataset.act];
    if (fn) { ev.preventDefault(); fn(el, ev); }
  });
  document.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.dataset.input === "invite") { if (S.invite.status !== "sending" && S.invite.status !== "idle") S.invite = { status: "idle", msg: "", target: null }; inviteUI(); }
    if (t.dataset.input === "search") { S.query = t.value; document.querySelectorAll("[data-search-clear]").forEach((b) => (b.hidden = !S.query)); LV.refresh(["list", "search-scope", "toolbar"]); }
    if (t.dataset.input === "f-search") { S.sheet.search = t.value; const pos = t.selectionStart; renderSheet(); const n = sheetEl.querySelector("[data-input=f-search]"); n?.focus(); n?.setSelectionRange(pos, pos); }
    if (t.dataset.input === "range-from" || t.dataset.input === "range-to") { const d = D(); d.range = d.range || { from: "", to: "" }; d.range[t.dataset.input === "range-from" ? "from" : "to"] = t.value.trim(); }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (S.dialog) LV.closeDialog();
      else if (S.sheet) LV.closeSheet();
      else if (S.entryMenu) { S.entryMenu = false; renderNav(); }
      else if (S.searchOpen) A["search-cancel"]();
    }
    if (ev.key === "Tab" && (S.sheet || S.dialog)) {
      const box = (S.dialog ? dialogEl : sheetEl).querySelector(S.dialog ? ".dialog" : ".sheet");
      const f = [...box.querySelectorAll("button:not([disabled]),input,[tabindex='0']")];
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f.at(-1).focus(); }
      else if (!ev.shiftKey && document.activeElement === f.at(-1)) { ev.preventDefault(); f[0].focus(); }
    }
    if (ev.key === "Enter" && ev.target.dataset?.input === "invite") A.invite();
  });

  /* 轮播指示点随滑动更新（只改一个属性，不重绘） */
  document.addEventListener("scroll", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement) || !t.matches("[data-carousel]")) return;
    const kids = [...t.children];
    const pl = parseFloat(getComputedStyle(t).paddingLeft) || 0;
    let i = 0, best = Infinity;
    kids.forEach((k, n) => { const d = Math.abs(k.offsetLeft - pl - t.scrollLeft); if (d < best) { best = d; i = n; } });
    if (t.scrollLeft + t.clientWidth >= t.scrollWidth - 4) i = kids.length - 1;
    t.closest(".page")?.querySelectorAll("[data-act=dot]").forEach((d) => d.setAttribute("aria-current", String(Number(d.dataset.i) === i)));
  }, true);

  window.addEventListener("hashchange", () => {
    const prev = S.route;
    const next = parseHash();
    S.route = next;
    if (S.sheet) LV.closeSheet();
    if (S.dialog) LV.closeDialog();
    if (!LV.isTab(next) || next.name !== prev.name) { S.searchOpen = false; S.query = ""; }
    if (S.selecting && next.name !== "entries") { S.selecting = false; S.selected.clear(); }
    S.entryMenu = false;
    const mode = (next.depth || 0) > (prev.depth || 0) ? "push" : (next.depth || 0) < (prev.depth || 0) ? "pop" : routeKey(next) === routeKey(prev) ? "same" : "tab";
    if (mode === "pop") S._pushed = false;
    if (next.name === "history" || next.name === "ledger") loadHistory();
    if (next.name !== "ledger") S.invite = { status: "idle", msg: "", target: null };
    render(mode);
  });

  /* ---------------- 实验室接口：对照页同步 / 参数 ---------------- */
  LV.reduced = () => root?.classList.contains("reduce") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search);
  LV.framed = params.has("frame");
  function postToParent() {
    if (window.parent === window) return;
    window.parent.postMessage({ lv: "state", style: S.style, route: location.hash || "#/", sheet: S.sheet?.type || null, dialog: !!S.dialog, menu: S.entryMenu, search: S.searchOpen, scroll: currentPage()?.querySelector(".scroll")?.scrollTop || 0 }, "*");
  }
  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m || m.lv !== "cmd") return;
    if (m.route != null && m.route !== (location.hash || "#/")) location.hash = m.route.replace(/^#/, "");
    if (m.sheet !== undefined) {
      if (m.sheet === null) { if (S.sheet) LV.closeSheet(); if (S.dialog) LV.closeDialog(); if (S.entryMenu) { S.entryMenu = false; renderNav(); } }
      else if (m.sheet === "menu") { if (S.sheet) LV.closeSheet(); S.entryMenu = true; renderNav(); }
      else if (m.sheet === "delete") { const e = LV.visible()[0]; if (e) LV.confirm({ title: "删除这笔记账？", desc: "删除后可以在账本的编辑记录中恢复。", confirmLabel: "删除", danger: true, onConfirm: () => {} }); }
      else if (m.sheet === "log") setTimeout(() => { const it = LV.historyItems().find((x) => x.lines.length > 1) || LV.historyItems()[0]; if (it) LV.openSheet("log", { id: it.id }); }, 60);
      else if (S.sheet?.type !== m.sheet) setTimeout(() => LV.openSheet(m.sheet), S.route.name === "entries" ? 0 : 40);
    }
    if (m.search !== undefined && !!m.search !== S.searchOpen) { if (location.hash && location.hash !== "#/") location.hash = "/"; setTimeout(() => { S.searchOpen = !!m.search; S.query = m.query || ""; render("same"); }, 40); }
    if (m.batch !== undefined && !!m.batch !== S.selecting) setTimeout(() => A[m.batch ? "batch-start" : "batch-exit"](), 40);
    if (m.style && m.style !== S.style) LV.setStyle(m.style);
    if (m.brand !== undefined || m.dark !== undefined) LV.setTheme({ brand: m.brand, dark: m.dark });
    if (m.demo !== undefined) { S.historyDemo = m.demo || null; S._historyLoaded = !m.demo; S.historyState = m.demo || "ready"; if (!m.demo) loadHistory(); LV.refresh(["history", "ledger-log", "list"]); }
    if (m.invite) setTimeout(() => { const input = currentPage()?.querySelector("[data-input=invite]"); if (!input) return; input.value = m.invite === "error" ? "10000000" : m.invite === "member" ? "linxia" : "wangtong"; S.invite = { status: "idle", msg: "", target: null }; inviteUI(); if (m.invite === "focus") { input.value = ""; inviteUI(); input.focus(); input.scrollIntoView({ block: "center" }); return; } input.scrollIntoView({ block: "center" }); A.invite(); }, 60);
    if (m.month) { S.month = m.month; S.range = null; render("same"); }
    if (m.glass) { root.style.setProperty("--gk-a", m.glass.a); root.style.setProperty("--gk-b", m.glass.b); }
    if (m.nofx !== undefined) root.classList.toggle("nofx", !!m.nofx);
    if (m.reduce !== undefined) root.classList.toggle("reduce", !!m.reduce);
    if (m.scroll !== undefined) { LV._quietScroll = true; currentPage()?.querySelector(".scroll")?.scrollTo({ top: m.scroll }); setTimeout(() => (LV._quietScroll = false), 120); }
  });

  /* ---------------- 风格热切换：保留页面、浮层与滚动位置 ---------------- */
  LV.setStyle = function (id) {
    if (!LV.styles[id] || id === S.style) return;
    const keep = currentPage()?.querySelector(".scroll")?.scrollTop || 0;
    const apply = () => {
      S.style = id;
      root.dataset.style = id;
      document.documentElement.dataset.style = id;
      root.querySelector(".app-bg").innerHTML = style().background ? style().background() : "";
      LV._quietScroll = true;
      render("same");
      const sc = currentPage()?.querySelector(".scroll");
      if (sc) { sc.scrollTop = keep; currentPage()._measure?.(); }
      setTimeout(() => (LV._quietScroll = false), 150);
      if (S.sheet) renderSheet();
      if (S.route.name === "ledger") inviteUI();
      document.title = document.title.replace(/·[^·]*$/, "· " + id.toUpperCase());
      postToParent();
    };
    const link = document.getElementById("theme-css");
    if (!link) { apply(); return; }
    const next = link.cloneNode();
    next.removeAttribute("id");
    next.href = `lab/theme-${id}.css`;
    next.onload = () => { link.remove(); next.id = "theme-css"; apply(); };
    link.after(next);
  };
  LV.setTheme = function ({ brand, dark } = {}) {
    if (brand) root.style.setProperty("--brand", brand);
    if (dark !== undefined && dark !== null) root.dataset.scheme = dark ? "dark" : "light";
  };

  /* ---------------- 启动 ---------------- */
  LV.boot = function (styleId) {
    if (!LV.styles[styleId]) styleId = "a";
    S.style = styleId;
    const themeLink = document.getElementById("theme-css");
    if (themeLink && !themeLink.getAttribute("href").endsWith(`theme-${styleId}.css`)) themeLink.setAttribute("href", `lab/theme-${styleId}.css`);
    document.documentElement.dataset.style = styleId;
    if (LV.framed) document.documentElement.classList.add("framed");
    if (params.get("frame") === "classic") document.documentElement.classList.add("classic");
    root = document.createElement("div");
    root.className = "app";
    root.dataset.style = styleId;
    if (params.has("nofx")) root.classList.add("nofx");
    if (params.has("reduce")) root.classList.add("reduce");
    if (params.get("brand")) root.style.setProperty("--brand", "#" + params.get("brand").replace("#", ""));
    root.dataset.scheme = params.has("dark") ? "dark" : "light";
    root.innerHTML = `<div class="app-bg" aria-hidden="true">${style().background ? style().background() : ""}</div><div class="pages"></div><div class="menu-layer" aria-live="polite"></div><div class="nav-layer"></div><div class="sheet-layer" data-state="closed" role="presentation"></div><div class="dialog-layer" data-state="closed"></div><div class="toast-layer" data-state="closed" role="status" aria-live="polite"></div>${LV.framed ? `<div class="device-status" aria-hidden="true"><span>9:41</span><span class="ds-right"><i class="ds-sig"></i><i class="ds-wifi"></i><i class="ds-bat"></i></span></div><div class="device-home" aria-hidden="true"></div>` : ""}`;
    document.body.appendChild(root);
    pagesEl = root.querySelector(".pages");
    navEl = root.querySelector(".nav-layer");
    menuEl = root.querySelector(".menu-layer");
    sheetEl = root.querySelector(".sheet-layer");
    dialogEl = root.querySelector(".dialog-layer");
    toastEl = root.querySelector(".toast-layer");
    toastEl.addEventListener("click", (e) => { if (e.target.closest("[data-act=toast-action]")) return; });
    if (params.get("page")) location.hash = params.get("page");
    S.route = parseHash();
    if (S.route.name === "history" || S.route.name === "ledger") { S._historyLoaded = S.route.name === "ledger"; loadHistory(); }
    render("replace");
    if (!LV.framed && window.parent === window) mountLabSwitch(styleId);
    if (params.get("sheet")) setTimeout(() => LV.openSheet(params.get("sheet")), 60);
  };

  function mountLabSwitch(id) {
    const el = document.createElement("div");
    el.className = "lab-switch";
    el.innerHTML = `<button type="button" class="lab-switch-btn" aria-expanded="false" aria-label="切换方案">${id.toUpperCase()}</button><div class="lab-switch-menu" hidden>${["a", "b1", "b2", "c"].map((s) => `<a href="#" data-style-to="${s}" ${s === id ? 'aria-current="page"' : ""}><b>${s.toUpperCase()}</b>${{ a: "柔和空间", c: "经典精修", b1: "柔和环境磨砂", b2: "分层透光玻璃" }[s]}</a>`).join("")}<a href="index.html">对照页</a></div>`;
    document.body.appendChild(el);
    const btn = el.querySelector("button"), menu = el.querySelector(".lab-switch-menu");
    btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
    menu.querySelectorAll("a[data-style-to]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); const to = a.dataset.styleTo;
      LV.setStyle(to); btn.textContent = to.toUpperCase(); menu.hidden = true;
      menu.querySelectorAll("a[data-style-to]").forEach((x) => (x.dataset.styleTo === to ? x.setAttribute("aria-current", "page") : x.removeAttribute("aria-current")));
      try { history.replaceState(null, "", `${to}.html${location.search}${location.hash}`); } catch (err) { /* file:// 下不允许改路径，忽略 */ }
    }));
    document.addEventListener("click", (e) => { if (!el.contains(e.target)) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
  }
})();
