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
    switchTo: "切换到这本账",
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
    follow: "跟随模式：在主工作区点开的账单详情会显示在这里，主工作区保留列表。",
    independent: "独立模式：这里有自己的页面与返回历史，主工作区的点击不会改变这里。",
    choose: "在这里打开",
  },
  mode: {
    follow: "跟随模式：主工作区点开的详情显示在辅助工作区",
    independent: "独立模式：两个工作区各自浏览",
    nowFollow: "已切换为跟随模式",
    nowIndependent: "已切换为独立模式",
    autoIndependent: "已切换为独立模式，主工作区的点击不会替换这里",
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
    open: "点这里打开第二个工作区；也可以长按左侧导航项，拖到右侧（竖屏拖到下方）",
    split: "完整矩形表示跟随：主区点开的详情显示在这里；分开的两块表示独立。拖动分界线调整大小，拖过 30% 松手可收起一侧。",
    dismiss: "知道了",
  },
  ledger: {
    offlineWrite: "这个工作区查看的不是本机的当前账本，离线时不能写入。请联网后再保存，或在这个工作区改为查看当前账本。",
    onlyCurrentTitle: "这项功能只用于当前账本",
    onlyCurrentBody: "这个工作区正在查看「{{name}}」。拍照 / 语音 / 粘贴记账、导入导出、批量操作与离线下载只作用于这台设备的当前账本「{{current}}」。",
    useCurrent: "在这个工作区改看当前账本",
    title: "这个工作区的账本",
    hint: "只改变这个工作区看的账本，另一个工作区不受影响。",
    current: "本机当前账本",
    foreignNote: "这本账只在线查看与写入；离线可用的是本机当前账本。",
  },
  discard: {
    title: "有尚未保存的修改",
    primary: "主工作区里有尚未保存的修改。继续打开新页面会丢弃这些修改。",
    secondary: "辅助工作区里有尚未保存的修改。继续打开新页面会丢弃这些修改。",
    reload: "有工作区里还有尚未保存的修改。切换账本会重新载入整个应用，这些修改会丢失。",
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
