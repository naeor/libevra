/**
 * `workspace` 文案：S18 大屏多工作区（全局侧栏、辅助工作区、分界线、跟随／独立）。
 * （源语言：简体中文）。键结构即全部语言的键定义。
 */
const workspace = {
  rail: {
    label: "全局导航",
    collapse: "收起侧栏",
    expand: "展开侧栏",
    add: "记一笔",
    addMenu: "选择记账方式",
    closeAddMenu: "收起记账方式",
    books: "我的账本",
    booksToggle: "展开或收起账本列表",
    current: "当前账本",
    newBook: "新建账本",
    switching: "正在切换账本…",
    switchFailed: "切换账本失败：{{message}}",
    itemMenu: "{{label}}的更多操作",
    bookDetail: "查看账本详情",
    bookDetailInSecondary: "在辅助工作区查看账本详情",
    bookWorkspaceInSecondary: "在辅助工作区打开明细",
    switchTo: "切换账本",
    secondaryNav: "辅助工作区：{{title}}",
    secondaryNavLabel: "辅助工作区导航",
    booksCurrent: "{{label}}：{{name}}",
    home: "主工作区回到明细",
  },
  pane: {
    primary: "主工作区",
    secondary: "辅助工作区",
    identity: "{{page}} · {{book}}",
    /** 拖动时盖在工作区上的身份标签：「主工作区 · 明细」。 */
    label: "{{pane}} · {{page}}",
    page: {
      entries: "明细",
      insights: "分析",
      ledger: "账本",
      me: "我的",
      add: "记账",
      detail: "账单详情",
      other: "页面",
      start: "辅助工作区",
    },
  },
  entry: {
    target: "记入账本：{{name}}",
    loading: "正在读取…",
  },
  secondary: {
    back: "辅助工作区返回上一页",
    close: "收起辅助工作区",
    open: "打开辅助工作区",
    restore: "恢复辅助工作区：{{title}}",
    /** 辅助区右下角导航按钮的读屏名 / 提示。 */
    navButton: "辅助工作区导航：{{title}}",
    destinations: "前往",
  },
  start: {
    title: "辅助工作区",
    follow: "主工作区打开的账目详情显示在此处，主工作区保留列表。",
    independent: "独立浏览页面和返回历史，不随主工作区切换。",
    choose: "打开页面",
  },
  mode: {
    follow: "跟随模式：主工作区点开的详情显示在辅助工作区",
    independent: "独立模式：两个工作区各自浏览",
    nowFollow: "已切换为跟随模式",
    nowIndependent: "已切换为独立模式",
    autoIndependent: "已切换为独立模式，不再随主工作区切换。",
    /** 胶囊按钮的读屏名：当前状态 + 按下会怎样。 */
    buttonFollow: "当前为跟随模式：主工作区点开的详情显示在辅助工作区。按下切换为独立模式",
    buttonIndependent: "当前为独立模式：两个工作区各自浏览。按下切换为跟随模式",
  },
  divider: {
    label: "调整两个工作区的大小",
    hint: "拖动分界线调整大小；拖过边界松手可收起一侧；也可用方向键调整",
    release: "释放以收起此工作区",
    expand: "将占据全部空间",
  },
  drop: {
    inPrimary: "在主工作区打开",
    inSecondary: "在辅助工作区打开",
    createSecondary: "新建辅助工作区并打开",
    right: "在右侧新建辅助工作区",
    below: "在下方新建辅助工作区",
    cancel: "取消",
    releaseCancel: "松手取消",
  },
  toast: {
    followBlocked: "辅助工作区有未保存的修改，详情已在主工作区打开",
    collapsedSecondary: "已收起辅助工作区，可从边缘的按钮恢复",
    promoted: "{{title}}已成为主工作区，原工作区已保留，可随时恢复",
  },
  hint: {
    open: "打开辅助工作区，或长按左侧导航项并拖至右侧（竖屏为下方）。",
    split: "完整矩形表示跟随主区详情，分离矩形表示独立浏览。拖动分界线可调整大小，拖过 30% 后松开可收起一侧。",
    dismiss: "知道了",
  },
  ledger: {
    offlineWrite: "此工作区未使用本机当前账本，离线时无法保存。请联网，或切换至当前账本。",
    onlyCurrentTitle: "这项功能只用于当前账本",
    onlyCurrentBody: "正在查看“{{name}}”。图片、语音、文本识别，以及导入导出、批量操作和离线下载仅适用于本机当前账本“{{current}}”。",
    useCurrent: "在这个工作区改看当前账本",
    title: "这个工作区的账本",
    hint: "只改变这个工作区看的账本，另一个工作区不受影响。",
    current: "本机当前账本",
    foreignNote: "此账本仅支持在线读写。本机当前账本可离线使用。",
  },
  discard: {
    title: "有尚未保存的修改",
    primary: "主工作区里有尚未保存的修改。继续打开新页面会丢弃这些修改。",
    secondary: "辅助工作区里有尚未保存的修改。继续打开新页面会丢弃这些修改。",
    reload: "工作区有未保存的修改。切换账本将重新加载应用并丢弃这些修改。",
    confirm: "丢弃并继续",
    cancel: "返回修改",
  },
  newBook: {
    title: "新建账本",
    name: "账本名称",
    create: "创建并进入",
    cancel: "取消",
  },
};

export default workspace;
