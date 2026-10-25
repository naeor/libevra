import type { Messages } from "../../types.js";
import type zh from "../zh-CN/stats.js";

/** `stats` (English). Must mirror zh-CN key for key. */
const stats: Messages<typeof zh> = {
  title: "Insights",
  subtitle: "Calculated from the entries you’ve recorded.",
  range: {
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    "90d": "Last 90 days",
    "365d": "Last year",
  },
  thisMonth: "This month",
  rangeSummary: "{{from}} – {{to}} · {{currency}}",
  section: {
    trend: "Income & spending",
    categoryShare: "By category",
    comparison: "Compared with before",
    overview: "This period",
    heatmap: "Spending calendar ({{range}})",
    year: "Year overview ({{year}})",
  },
  overview: {
    averagePerDay: "Daily average spent",
    largestExpense: "Largest expense",
  },
  days_one: "{{count}} day",
  days_other: "{{count}} days",
  comparison: {
    noHistory: "There’s no earlier data to compare this period with, so no change is shown.",
    monthToDate:
      "Compared with the same days last month: {{current}} this period, {{previous}} before. This period isn’t over yet, so comparing it with a full month would be misleading.",
    fullPeriod: "Compared with the previous full period: {{current}} this period, {{previous}} before.",
    flat: "No change",
  },
  year: {
    totalExpense: "Total spent",
    totalIncome: "Total income",
    net: "Net",
    count: "Entries",
    chartTitle: "Monthly spending in {{currency}}",
    noSpending: "No spending recorded in this period, so there’s no monthly breakdown.",
    monthDetail: "{{month}}: spent {{amount}} {{currency}}",
  },
  trend: {
    chartTitle: "Income and spending trend in {{currency}}",
    tooltipExpense: "Spent {{amount}}",
    tooltipIncome: "Income {{amount}} {{currency}}",
  },
  donut: {
    chartTitle: "{{currency}} by category",
    total: "Total",
    others_one: "{{count}} other",
    others_other: "{{count}} others",
  },
  heatmap: {
    weekdays: {
      mon: "Mo",
      tue: "Tu",
      wed: "We",
      thu: "Th",
      fri: "Fr",
      sat: "Sa",
      sun: "Su",
    },
    dayLabel: "{{date}}: spent {{amount}} {{currency}}",
    less: "Less",
    more: "More",
    leftmostNone: "Leftmost = no spending",
    summary_one:
      "Spending on {{count}} day this period, {{total}} in total. Colors show how heavy a day was compared with the rest of this period.",
    summary_other:
      "Spending on {{count}} days this period, {{total}} in total. Colors show how heavy a day was compared with the rest of this period.",
    selected: "{{date}}: spent {{amount}} (level {{level}})",
    peak: "Your highest {{currency}} spending was on {{date}}: {{amount}}.",
  },
  notice: {
    empty: {
      expense: "No spending recorded in this period.",
      flow: "No income or spending recorded in this period.",
    },
    allZero: "There are entries in this period, but every amount is zero.",
    single: {
      expense: "There’s only one kind of spending in this period, so shares aren’t shown.",
      flow: "There’s only one entry type in this period, so shares aren’t shown.",
    },
  },
  lab: {
    title: "Component preview · developer page",
    intro: "This page exists only in development mode. It checks that charts and the saved screen stay readable with awkward data. It isn’t a product feature and needs no sign-in.",
    meHeader: "“Me” page header (avatar + name)",
    entrySaved: "Entry saved screen (after saving)",
    entrySavedBatch: "Entry saved screen · batch not finished (no way home mid-batch)",
    trend: "Trend lines (two series, touchable)",
    donut: "By category (tap to drill down)",
    comparisonMonthToDate: "Comparison (month not over, same days last month)",
    comparisonNone: "Comparison (nothing to compare with)",
    year: "Year overview",
    heatmap: "Spending calendar (one 10× outlier)",
    edgeCases: "Edge cases",
    noData: "No data at all",
    gapFilled: "No data, but the series was zero-filled (the bug fixed here: it used to say “every amount is zero”)",
    allZero: "Entries, all zero",
    singleCategory: "Only one category",
    yearAllZero: "Year overview, all zero",
    yearNegative: "Year overview with negative net",
    yen: "Japanese yen (no decimals)",
  },
};

export default stats;
