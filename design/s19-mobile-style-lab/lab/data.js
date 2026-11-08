/* Libevra S19 Style Lab — 共享示例数据（三套方案完全相同）
 * 金额一律用最小货币单位（分）。“今天”固定为 2026-11-07（周六），保证三套截图可比。 */
(function () {
  const LV = (window.LV = window.LV || {});
  LV.TODAY = "2026-11-07";

  LV.CATEGORIES = [
    { id: "food", name: "餐饮", kind: "expense", hue: "#c0843a" },
    { id: "transport", name: "交通", kind: "expense", hue: "#4a7fb5" },
    { id: "shopping", name: "购物", kind: "expense", hue: "#a86f9a" },
    { id: "daily", name: "日用", kind: "expense", hue: "#4f8c86" },
    { id: "housing", name: "住房", kind: "expense", hue: "#8a6c56" },
    { id: "fun", name: "娱乐", kind: "expense", hue: "#7a6bb0" },
    { id: "medical", name: "医疗", kind: "expense", hue: "#b8574f" },
    { id: "utility", name: "水电燃气", kind: "expense", hue: "#3f8fa6" },
    { id: "phone", name: "通讯", kind: "expense", hue: "#66788a" },
    { id: "edu", name: "学习", kind: "expense", hue: "#8a8f4c" },
    { id: "salary", name: "工资", kind: "income", hue: "#3f7a5f" },
    { id: "invest", name: "理财收益", kind: "income", hue: "#55997a" },
    { id: "refund", name: "退款", kind: "income", hue: "#5e9c86" },
  ];
  LV.PAYMENTS = [
    { id: "wechat", name: "微信支付" },
    { id: "alipay", name: "支付宝" },
    { id: "cmb", name: "招商银行信用卡" },
    { id: "card", name: "工资卡" },
    { id: "cash", name: "现金" },
  ];
  LV.TAGS = [
    { id: "home", name: "家庭" },
    { id: "kid", name: "孩子" },
    { id: "weekend", name: "周末" },
    { id: "reimb", name: "报销" },
    { id: "trip", name: "旅行" },
  ];
  LV.CURRENCIES = [
    { id: "CNY", name: "人民币", symbol: "¥" },
    { id: "USD", name: "美元", symbol: "$" },
    { id: "JPY", name: "日元", symbol: "JP¥" },
  ];

  LV.USER = { name: "周以安", username: "zhouyian", account: "1029 4471", version: "1.19.1" };

  LV.LEDGERS = [
    {
      id: "family", name: "家庭日常", number: "2048 7731", currency: "CNY",
      members: [
        { name: "周以安", role: "所有者", me: true, tone: "#55997a" },
        { name: "林夏", role: "可编辑", tone: "#c0843a" },
        { name: "周屿", role: "仅查看", tone: "#4a7fb5" },
      ],
    },
    { id: "solo", name: "我的个人账本", number: "2048 5106", currency: "CNY", members: [{ name: "周以安", role: "所有者", me: true, tone: "#55997a" }] },
    {
      id: "trip", name: "旅行基金", number: "3301 0925", currency: "CNY",
      members: [
        { name: "周以安", role: "所有者", me: true, tone: "#55997a" },
        { name: "林夏", role: "可编辑", tone: "#c0843a" },
      ],
    },
  ];

  /* ---- 十一月（手写，保证文案自然） ---------------------------------- */
  // [date, time, cat, note, yuan, pay, tags, by, attachments, currency?]
  const NOV = [
    ["2026-11-07", "16:05", "transport", "打车回家", 27.6, "alipay", [], "林夏", 0],
    ["2026-11-07", "15:20", "fun", "电影票 ×3", 132, "wechat", ["weekend"], "周以安", 0],
    ["2026-11-07", "12:35", "food", "周末午饭 · 巷口小馆", 186, "cmb", ["home", "weekend"], "周以安", 1],
    ["2026-11-07", "10:40", "shopping", "孩子的冬季外套", 459, "alipay", ["kid"], "林夏", 1],
    ["2026-11-07", "09:12", "food", "早餐 · 豆浆油条", 14, "wechat", [], "周以安", 0],
    ["2026-11-06", "21:10", "edu", "线上课程续费", 199, "alipay", [], "周以安", 0],
    ["2026-11-06", "19:30", "food", "晚饭 · 外卖", 58.5, "alipay", [], "林夏", 0],
    ["2026-11-06", "18:45", "daily", "超市 · 洗衣液和纸巾", 89.4, "cmb", ["home"], "林夏", 1],
    ["2026-11-06", "12:10", "food", "午饭 · 公司楼下", 32, "wechat", [], "周以安", 0],
    ["2026-11-06", "08:30", "transport", "地铁", 6, "alipay", [], "周以安", 0],
    ["2026-11-05", "20:15", "shopping", "书房台灯", 239, "cmb", [], "周以安", 1],
    ["2026-11-05", "17:50", "phone", "话费充值", 100, "alipay", [], "林夏", 0],
    ["2026-11-05", "12:20", "food", "午饭", 30, "wechat", [], "周以安", 0],
    ["2026-11-05", "09:00", "salary", "十月工资", 12800, "card", [], "周以安", 0],
    ["2026-11-05", "08:20", "transport", "地铁", 6, "alipay", [], "周以安", 0],
    ["2026-11-04", "22:00", "fun", "视频会员", 25, "alipay", [], "林夏", 0],
    ["2026-11-04", "19:40", "medical", "药店 · 感冒药", 67.8, "alipay", ["home"], "林夏", 0],
    ["2026-11-04", "12:15", "food", "午饭", 28, "wechat", [], "周以安", 0],
    ["2026-11-04", "07:55", "food", "咖啡", 22, "wechat", [], "周以安", 0],
    ["2026-11-03", "18:20", "daily", "菜市场", 76.3, "wechat", ["home"], "林夏", 0],
    ["2026-11-03", "12:30", "food", "午饭", 35, "wechat", [], "周以安", 0],
    ["2026-11-03", "10:10", "refund", "运动鞋退货退款", 129, "alipay", [], "周以安", 0],
    ["2026-11-03", "08:25", "transport", "地铁", 6, "alipay", [], "周以安", 0],
    ["2026-11-02", "20:30", "shopping", "云存储年度订阅", 9.99, "cmb", [], "周以安", 0, "USD"],
    ["2026-11-02", "19:05", "utility", "电费 · 十月", 186.25, "alipay", ["home"], "林夏", 1],
    ["2026-11-02", "12:00", "food", "午饭", 31, "wechat", [], "周以安", 0],
    ["2026-11-02", "09:00", "housing", "物业费 · 十一月", 286, "card", ["home"], "周以安", 1],
    ["2026-11-01", "19:20", "food", "晚饭食材", 128.6, "wechat", ["home"], "林夏", 0],
    ["2026-11-01", "16:40", "transport", "加油", 300, "cmb", [], "周以安", 0],
    ["2026-11-01", "14:00", "shopping", "周末采购 · 家居店", 412, "cmb", ["home", "weekend"], "林夏", 1],
    ["2026-11-01", "11:15", "food", "早午餐", 96, "wechat", ["weekend"], "周以安", 0],
    ["2026-11-01", "10:30", "invest", "余额宝收益", 36.42, "alipay", [], "周以安", 0],
  ];

  /* ---- 九、十月（确定性生成，供分析页做上期比较） ---------------------- */
  function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function generateMonth(year, month, days, seed, weights) {
    const r = rng(seed);
    const out = [];
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    for (let d = 1; d <= days; d++) {
      const date = `${year}-${pad(month)}-${pad(d)}`;
      const dow = new Date(year, month - 1, d).getDay();
      const weekend = dow === 0 || dow === 6;
      if (!weekend) {
        out.push([date, "08:2" + Math.floor(r() * 9), "transport", "地铁", 6, "alipay", [], "周以安", 0]);
        out.push([date, "12:" + pad(10 + Math.floor(r() * 40)), "food", pick(["午饭", "午饭 · 公司楼下", "午饭 · 便当"]), Math.round(26 + r() * 14), "wechat", [], "周以安", 0]);
      }
      if (r() < 0.55) out.push([date, "19:" + pad(Math.floor(r() * 59)), "food", pick(["晚饭 · 外卖", "晚饭食材", "晚饭 · 小馆"]), Math.round((weekend ? 90 : 45) + r() * 80 * weights.food), pick(["wechat", "alipay"]), weekend ? ["home"] : [], "林夏", 0]);
      if (r() < 0.32) out.push([date, "18:" + pad(Math.floor(r() * 59)), "daily", pick(["超市", "菜市场", "日用品补货"]), Math.round(40 + r() * 90), pick(["wechat", "cmb"]), ["home"], "林夏", 0]);
      if (r() < 0.16 * weights.shopping) out.push([date, "20:" + pad(Math.floor(r() * 59)), "shopping", pick(["网购 · 衣物", "家居小件", "数码配件", "书"]), Math.round(80 + r() * 380), "cmb", [], pick(["周以安", "林夏"]), r() < 0.4 ? 1 : 0]);
      if (weekend && r() < 0.6) out.push([date, "15:" + pad(Math.floor(r() * 59)), "fun", pick(["电影", "展览门票", "桌游店", "公园划船"]), Math.round(40 + r() * 140 * weights.fun), "wechat", ["weekend"], "周以安", 0]);
      if (r() < 0.12) out.push([date, "21:" + pad(Math.floor(r() * 59)), "transport", "打车", Math.round(18 + r() * 40), "alipay", [], "林夏", 0]);
    }
    out.push([`${year}-${pad(month)}-02`, "09:00", "housing", `物业费 · ${month}月`, 286, "card", ["home"], "周以安", 1]);
    out.push([`${year}-${pad(month)}-05`, "09:00", "salary", `${month - 1}月工资`, 12800, "card", [], "周以安", 0]);
    out.push([`${year}-${pad(month)}-01`, "10:30", "invest", "余额宝收益", 34 + Math.round(r() * 6), "alipay", [], "周以安", 0]);
    out.push([`${year}-${pad(month)}-03`, "19:05", "utility", "电费", Math.round(150 + r() * 60), "alipay", ["home"], "林夏", 0]);
    out.push([`${year}-${pad(month)}-12`, "17:40", "phone", "话费充值", 100, "alipay", [], "林夏", 0]);
    out.push([`${year}-${pad(month)}-1${Math.floor(r() * 9)}`, "16:20", "transport", "加油", 280 + Math.round(r() * 60), "cmb", [], "周以安", 0]);
    if (weights.medical) out.push([`${year}-${pad(month)}-2${Math.floor(r() * 8)}`, "10:15", "medical", "体检", 420, "card", [], "周以安", 1]);
    if (weights.edu) out.push([`${year}-${pad(month)}-0${4 + Math.floor(r() * 5)}`, "21:00", "edu", "绘本和练习册", 168, "alipay", ["kid"], "林夏", 0]);
    return out;
  }
  // 十月初是国庆长假：出行与娱乐偏多，十一月同期自然回落
  const GOLDEN_WEEK = [
    ["2026-10-01", "07:40", "transport", "高铁 · 去杭州 ×3", 1128, "alipay", ["trip", "home"], "周以安", 1],
    ["2026-10-02", "10:20", "fun", "景区门票 ×3", 360, "wechat", ["trip"], "林夏", 0],
    ["2026-10-02", "18:30", "food", "西湖边晚饭", 420, "cmb", ["trip"], "周以安", 0],
    ["2026-10-03", "21:00", "fun", "民宿两晚", 1280, "cmb", ["trip"], "周以安", 1],
    ["2026-10-04", "16:10", "shopping", "龙井茶和点心", 268, "wechat", ["trip"], "林夏", 0],
    ["2026-10-05", "17:20", "transport", "高铁 · 返程 ×3", 1128, "alipay", ["trip", "home"], "周以安", 1],
  ];
  const LATE_OCT = [
    ["2026-10-26", "18:10", "transport", "加油", 296, "cmb", [], "周以安", 0],
    ["2026-10-28", "22:40", "shopping", "双十一预售定金", 680, "alipay", ["home"], "林夏", 0],
    ["2026-10-31", "19:30", "food", "朋友聚餐", 426, "cmb", ["weekend"], "周以安", 1],
  ];
  const OCT = generateMonth(2026, 10, 31, 1031, { food: 1.1, shopping: 1.1, fun: 1.2, medical: 1, edu: 1 }).concat(GOLDEN_WEEK, LATE_OCT);
  const SEP = generateMonth(2026, 9, 30, 930, { food: 1, shopping: 1, fun: 1, medical: 0, edu: 1 });

  function soloRows() {
    const r = rng(77);
    const rows = [];
    for (let d = 7; d >= 1; d--) {
      const date = `2026-11-0${d}`;
      rows.push([date, "12:" + pad(10 + Math.floor(r() * 40)), "food", "午饭", Math.round(24 + r() * 16), "wechat", [], "周以安", 0]);
      if (r() < 0.5) rows.push([date, "21:" + pad(Math.floor(r() * 59)), "edu", "电子书", Math.round(12 + r() * 30), "alipay", [], "周以安", 0]);
      if (r() < 0.4) rows.push([date, "08:3" + Math.floor(r() * 9), "food", "咖啡", 22, "wechat", [], "周以安", 0]);
    }
    rows.push(["2026-11-03", "15:00", "shopping", "跑鞋", 569, "cmb", [], "周以安", 1]);
    rows.push(["2026-11-05", "10:00", "invest", "基金分红", 213.6, "alipay", [], "周以安", 0]);
    return rows.concat(generateMonth(2026, 10, 31, 2210, { food: 0.6, shopping: 0.8, fun: 0.5, medical: 0, edu: 1 }).filter((x) => !["housing", "salary", "utility"].includes(x[2])));
  }
  function tripRows() {
    return [
      ["2026-11-06", "22:10", "transport", "春节返乡高铁票 ×2", 1186, "alipay", ["trip"], "林夏", 1],
      ["2026-11-02", "20:00", "salary", "本月存入", 2000, "card", ["trip"], "周以安", 0],
      ["2026-11-02", "20:05", "salary", "本月存入", 2000, "card", ["trip"], "林夏", 0],
      ["2026-10-18", "14:30", "fun", "温泉酒店定金", 600, "cmb", ["trip"], "周以安", 1],
      ["2026-10-02", "20:00", "salary", "本月存入", 4000, "card", ["trip"], "周以安", 0],
    ];
  }

  let seq = 0;
  function toEntries(rows, ledgerId) {
    return rows.map((x) => {
      const [date, time, cat, note, yuan, pay, tags, by, att, cur] = x;
      const c = LV.CATEGORIES.find((k) => k.id === cat);
      seq += 1;
      return {
        id: `${ledgerId}-${String(seq).padStart(4, "0")}`,
        ledgerId, date, time, category: cat, kind: c.kind, note,
        amount: Math.round(yuan * 100), currency: cur || "CNY", payment: pay, tags, by, attachments: att,
        number: `E${String(48210 + seq)}`,
      };
    });
  }
  LV.ENTRIES = [
    ...toEntries(NOV, "family"), ...toEntries(OCT, "family"), ...toEntries(SEP, "family"),
    ...toEntries(soloRows(), "solo"), ...toEntries(tripRows(), "trip"),
  ];

  /* ---- 稳定的“技术编号”：只用于编辑记录的原始数据（主列表不显示） ---- */
  function uuid(seed) {
    const r = rng(seed * 7919 + 17);
    const h = () => Math.floor(r() * 65536).toString(16).padStart(4, "0");
    return `${h()}${h()}-${h()}-4${h().slice(1)}-${(8 + Math.floor(r() * 4)).toString(16)}${h().slice(1)}-${h()}${h()}${h()}`;
  }
  LV.uuid = uuid;
  LV.ENTRIES.forEach((e, i) => (e.uuid = uuid(1000 + i)));
  LV.CATEGORIES.forEach((c, i) => (c.uuid = uuid(50 + i)));
  LV.PAYMENTS.forEach((p, i) => (p.uuid = uuid(80 + i)));
  LV.TAGS.forEach((t, i) => (t.uuid = uuid(90 + i)));
  LV.MEMBER_IDS = { 周以安: uuid(7), 林夏: uuid(8), 周屿: uuid(9) };

  /* ---- 编辑记录：按服务器事件的真实形状保存（kind / changes 原始值），由界面负责“说人话” ----
   * changes 的原始值与正式版一致：金额是最小货币单位；分类、支付方式、标签是 UUID；附件是对象数组；
   * 时间是 UTC 时间戳。currency 只有部分事件保存了（null = 当时没有记下币种，界面不能猜）。 */
  const E = (id) => LV.ENTRIES.find((x) => x.id === id);
  const C = (id) => LV.CATEGORIES.find((x) => x.id === id).uuid;
  const P = (id) => LV.PAYMENTS.find((x) => x.id === id).uuid;
  const T = (id) => LV.TAGS.find((x) => x.id === id).uuid;
  const utc = (local) => { const d = new Date(local + ":00+08:00"); return d.toISOString(); };
  const hand = [
    { at: "2026-11-07T16:20", kind: "updated", actor: "林夏", entry: "family-0001", currency: "CNY", changes: { amountCents: { from: 2500, to: 2760 }, note: { from: "打车", to: "打车回家" } } },
    { at: "2026-11-07T12:52", kind: "updated", actor: "周以安", entry: "family-0003", currency: "CNY", changes: { amountCents: { from: 18000, to: 18600 }, attachments: { from: [], to: [{ id: uuid(501), name: "IMG_2041.jpg", size: 482113, mime: "image/jpeg" }] } } },
    { at: "2026-11-07T10:58", kind: "updated", actor: "林夏", entry: "family-0004", currency: "CNY", changes: { tags: { from: [], to: [T("kid")] } } },
    { at: "2026-11-07T09:20", kind: "updated", actor: "周以安", entry: "family-0005", currency: null, changes: { note: { from: "早餐", to: "早餐 · 豆浆油条" }, amountCents: { from: 1200, to: 1400 } } },
    { at: "2026-11-06T22:06", kind: "deleted", actor: "林夏", seq: 48190, deletedLabel: "晚饭 · 外卖（重复）" },
    { at: "2026-11-06T19:46", kind: "updated", actor: "林夏", entry: "family-0007", currency: null, changes: { amountCents: { from: 5200, to: 5850 } } },
    { at: "2026-11-06T18:52", kind: "updated", actor: "林夏", entry: "family-0008", currency: "CNY", changes: { paymentMethodId: { from: P("wechat"), to: P("cmb") }, tags: { from: [uuid(97)], to: [T("home")] } } },
    { at: "2026-11-05T20:31", kind: "updated", actor: "周以安", entry: "family-0011", currency: "CNY", changes: { occurredAt: { from: utc("2026-11-05T20:30"), to: utc("2026-11-05T20:15") }, categoryId: { from: C("daily"), to: C("shopping") }, attachments: { from: [], to: [{ id: uuid(502), name: "发票.pdf", size: 91320, mime: "application/pdf" }] }, ocrHint: { from: null, to: { v: 2, conf: 0.82 } } } },
    { at: "2026-11-05T09:04", kind: "restored", actor: "周以安", entry: "family-0014" },
    { at: "2026-11-05T09:03", kind: "deleted", actor: "周以安", entry: "family-0014" },
    { at: "2026-11-02T21:05", kind: "member_changed", actor: "周以安", changes: { role: { from: "viewer", to: "editor" }, member: { from: null, to: "林夏" } } },
    { at: "2026-11-02T21:00", kind: "member_changed", actor: "周以安", changes: { joined: { from: null, to: "周屿" }, role: { from: null, to: "viewer" } } },
  ];
  // 其余“新增”事件由账目本身生成（记账后一分钟内）
  const created = LV.ENTRIES.filter((e) => e.ledgerId === "family" && e.date >= "2026-11-01").map((e) => {
    const [h, m] = e.time.split(":").map(Number);
    const mm = (m + 1) % 60, hh = m + 1 >= 60 ? h + 1 : h;
    return { at: `${e.date}T${pad(hh)}:${pad(mm)}`, kind: "created", actor: e.by, entry: e.id };
  });
  LV.EVENTS = [...hand, ...created].map((ev, i) => {
    const e = ev.entry ? E(ev.entry) : null;
    return {
      id: "evt_" + uuid(3000 + i).replace(/-/g, "").slice(0, 20),
      ledgerId: "family",
      kind: ev.kind, at: ev.at, occurredAt: utc(ev.at),
      actor: ev.actor, actorId: LV.MEMBER_IDS[ev.actor],
      entryId: e ? e.id : null,
      transactionId: e ? e.uuid : ev.seq ? uuid(9000 + ev.seq) : null,
      transactionSeq: e ? Number(e.number.slice(1)) : ev.seq || null,
      label: e ? e.note : ev.deletedLabel || null,
      category: e ? e.category : null,
      currency: ev.currency === undefined ? (e ? e.currency : null) : ev.currency,
      changes: ev.changes || {},
    };
  }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  /* ---- 设置：区分导航项、开关项、操作项（含禁用与危险语义） ---- */
  LV.SETTINGS = [
    { items: [
      { id: "preferences", label: "记账偏好", hint: "默认币种、重复提醒与汇率折算", icon: "wallet", type: "nav", to: "/me/settings/preferences" },
      { id: "theme", label: "外观", value: "跟随系统", icon: "sun", type: "nav" },
      { id: "language", label: "语言", value: "简体中文", icon: "globe", type: "nav" },
    ] },
    { items: [
      { id: "security", label: "账号与安全", hint: "密码、恢复码与邀请码", icon: "shield", type: "nav" },
      { id: "data", label: "账号与数据", hint: "导出、删除数据与注销账号", icon: "database", type: "nav", to: "/me/settings/data" },
    ] },
    { items: [{ id: "about", label: "关于 Libevra", value: "1.19.1", icon: "info", type: "nav" }] },
  ];
  LV.SUBSETTINGS = {
    preferences: { title: "记账偏好", groups: [
      { items: [
        { id: "currency", label: "默认币种", value: "人民币 CNY", type: "nav" },
        { id: "dup", label: "重复记账提醒", hint: "同一分类、同一金额 10 分钟内再次记账时提醒", type: "toggle" },
      ] },
      { title: "统计", foot: "综合折算需要汇率数据。本机还没有取得汇率，联网同步后才能开启。", items: [
        { id: "fx", label: "综合折算", hint: "把其他币种按汇率折成人民币一起统计", type: "toggle", disabled: true },
      ] },
    ] },
    data: { title: "账号与数据", groups: [
      { items: [
        { id: "export", label: "导出账目", hint: "按账本导出 CSV 或 Excel", type: "nav" },
        { id: "downloads", label: "下载管理", value: "3 个月 · 18.4 MB", type: "nav" },
      ] },
      { title: "删除与注销", foot: "注销后，账号与你创建的账本会在 30 天后永久删除；期间登录即可撤销。", items: [
        { id: "clear", label: "清除本机缓存", hint: "只删除这台设备上的离线数据，云端账目不受影响", type: "action", tone: "warn" },
        { id: "close", label: "注销账号", type: "action", tone: "danger" },
      ] },
    ] },
  };
  LV.TOGGLES = { dup: true, fx: false };
})();
