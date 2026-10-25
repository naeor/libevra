/**
 * `stats` 文案：分析页、图表（趋势 / 分类占比 / 环比 / 年度总览 / 日历热力）、图表空状态与开发验证页
 * （源语言：简体中文）。键结构即全部语言的键定义。
 *
 * ⚠️ 时段按钮的名字按**时段 ID**（`7d` / `30d` / `90d` / `365d`）取，不按 `@libellum/shared` 里
 * `RANGE_LABELS` 的中文取——那份中文是 shared 的常量，这里只在显示时换成当前语言。
 */
const stats = {
  title: "分析",
  subtitle: "以下结果由已记录的账目计算得出。",
  range: {
    "7d": "近 7 天",
    "30d": "近 30 天",
    "90d": "近 90 天",
    "365d": "近一年",
  },
  thisMonth: "本月",
  /** 时段与币种说明。中文界面的日期保持 `YYYY-MM-DD` 原样（与以前一致）。 */
  rangeSummary: "{{from}} 至 {{to}}，币种为{{currency}}。",
  section: {
    trend: "收支趋势",
    categoryShare: "分类占比",
    comparison: "环比对比",
    overview: "本期概览",
    heatmap: "日历热力（{{range}}）",
    year: "年度总览（{{year}}）",
  },
  overview: {
    averagePerDay: "日均支出",
    largestExpense: "最大单笔",
  },
  days_one: "{{count}} 天",
  days_other: "{{count}} 天",
  comparison: {
    noHistory: "所选时段没有可对比的历史数据，因此不显示变化幅度。",
    monthToDate: "对比为“上月同期”：本期 {{current}}，对比上期 {{previous}}。本期尚未结束，与完整月份比较会失真。",
    fullPeriod: "对比为上一完整周期：本期 {{current}}，对比上期 {{previous}}。",
    flat: "持平",
  },
  year: {
    totalExpense: "总支出",
    totalIncome: "总收入",
    net: "结余",
    count: "笔数",
    chartTitle: "{{currency}} 各月支出",
    noSpending: "所选时段暂无支出记录，因此不显示各月分布。",
    /** 点某个月的柱子后显示。中文界面 `month` 是月份数字（`10`），其它语言是月份名。 */
    monthDetail: "{{month}} 月支出 {{amount}} {{currency}}",
  },
  trend: {
    chartTitle: "{{currency}}收支趋势",
    tooltipExpense: "支出 {{amount}}",
    tooltipIncome: "收入 {{amount}} {{currency}}",
  },
  donut: {
    chartTitle: "{{currency}} 分类占比",
    total: "合计",
    others_one: "其它 {{count}} 项",
    others_other: "其它 {{count}} 项",
  },
  heatmap: {
    weekdays: {
      mon: "一",
      tue: "二",
      wed: "三",
      thu: "四",
      fri: "五",
      sat: "六",
      sun: "日",
    },
    dayLabel: "{{date}} 支出 {{amount}} {{currency}}",
    less: "少",
    more: "多",
    leftmostNone: "最左为无支出",
    summary_one: "本期共 {{count}} 天有支出，合计 {{total}}。颜色表示“在本期内的相对高低”。",
    summary_other: "本期共 {{count}} 天有支出，合计 {{total}}。颜色表示“在本期内的相对高低”。",
    selected: "{{date}} 支出 {{amount}}（第 {{level}} 档）",
    peak: "{{currency}}支出最多的一天是 {{date}}，{{amount}}。",
  },
  /** 图表画不出来时的说明。按主题 ID 取：`expense` = 支出，`flow` = 收支。 */
  notice: {
    empty: {
      expense: "所选时段暂无支出记录。",
      flow: "所选时段暂无收支记录。",
    },
    allZero: "所选时段已有记录，但金额均为零。",
    single: {
      expense: "所选时段仅有一项支出，占比分析暂不适用。",
      flow: "所选时段仅有一项收支，占比分析暂不适用。",
    },
  },
  /** `/dev/charts` 开发验证页（只在开发模式存在）。 */
  lab: {
    title: "组件预览 · 开发验证页",
    intro: "这个页面只在开发模式下存在，用来确认图表与完成页在异常数据下仍然可读。它不是产品功能，也不需要登录。",
    meHeader: "「我的」页头部（头像 + 名字）",
    entrySaved: "记账完成页（保存后出现）",
    entrySavedBatch: "记账完成页 · 一批还没做完（中途没有返回主页）",
    trend: "趋势折线（双系列，可触摸）",
    donut: "分类占比（点分类下钻）",
    comparisonMonthToDate: "环比对比（月未结束，对比上月同期）",
    comparisonNone: "环比对比（没有可对比的数据）",
    year: "年度总览",
    heatmap: "日历热力（含一个 10 倍极值）",
    edgeCases: "异常状态",
    noData: "没有任何数据",
    gapFilled: "没有数据，但序列被补过零（这是本次修掉的 bug：以前会误报\"金额均为零\"）",
    allZero: "有记录但全为零",
    singleCategory: "只有一个分类",
    yearAllZero: "全零的年度总览",
    yearNegative: "含负结余的年度总览",
    yen: "日元（没有小数位）",
  },
};

export default stats;
