/**
 * `nav` 文案：底部导航、中央记账菜单、页面返回栏、通用加载 / 错误状态与几个通用小部件
 * （源语言：简体中文）。键结构即全部语言的键定义。
 */
const nav = {
  /** 底部导航。第四格按成员数显示「账本」或「协作」。 */
  tabs: {
    entries: "明细",
    insights: "分析",
    add: "记账",
    ledger: "账本",
    shared: "协作",
    me: "我的",
  },
  mainNav: "主导航",
  /** 中央 + 展开的五种记账方式：`label` 是完整名（也是读屏名），`short` 是窄屏时的可见短名。 */
  entry: {
    paste: { label: "粘贴识别", short: "粘贴" },
    voice: { label: "语音记账", short: "语音" },
    manual: { label: "手动记账", short: "手动" },
    scan: { label: "拍照识别", short: "拍照" },
    import: { label: "导入账单", short: "导入" },
    needsAccount: "{{label}}，需要正式账号",
    unavailable: "{{label}}，{{reason}}",
    comingSoon: "即将开放",
    expand: "展开记账方式",
    collapse: "收起记账方式",
  },
  page: {
    nav: "页面导航",
    back: "返回",
  },
  state: {
    loadFailed: "加载失败",
    retry: "重试",
  },
  message: {
    collapse: "收起",
    expand: "展开全文",
    dismiss: "关闭提示",
  },
  copy: {
    copy: "复制",
    copied: "已复制",
    manual: "请长按复制",
  },
  sheet: {
    close: "关闭{{title}}",
  },
  choice: {
    placeholder: "未选择",
    current: "{{label}}：{{value}}",
  },
  errorBoundary: {
    title: "页面无法显示",
    body: "页面暂时无法显示，请重新加载或返回明细。",
    details: "查看错误详情",
    reload: "刷新页面",
    home: "回到明细",
  },
  splash: "载入中…",
  version: {
    unknown: "(未知)",
    localTime: "{{time}}（本机时间 {{zone}}）",
  },
};

export default nav;
