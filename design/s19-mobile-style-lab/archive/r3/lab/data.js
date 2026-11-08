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
        { name: "周屿", role: "可查看", tone: "#4a7fb5" },
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

  LV.HISTORY = [
    { who: "林夏", what: "新增", target: "购物 · 孩子的冬季外套", amount: "−¥459.00", when: "今天 10:41" },
    { who: "周以安", what: "修改", target: "餐饮 · 周末午饭 金额 ¥180.00 → ¥186.00", amount: "", when: "今天 12:52" },
    { who: "林夏", what: "新增", target: "日用 · 超市 · 洗衣液和纸巾", amount: "−¥89.40", when: "昨天 18:47" },
    { who: "周屿", what: "加入了账本", target: "", amount: "", when: "11 月 2 日" },
  ];
})();
