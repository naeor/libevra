/**
 * `books` 文案：账本空间（开始页）、账本切换面板、齿轮管理面板、账本详情、账本设置、目标账本的
 * 成员 / 分享页、旧地址兼容页、明细 · 更多、账本信息与成员管理（源语言：简体中文）。
 * 键结构即全部语言的键定义。
 *
 * ⚠️ 账本名是用户数据，从不翻译；这里只有界面文字。`defaultLedgerName` 只用于**新建**账本时名称留空的
 * 默认值，已有账本永远不会被改名。
 */
const books = {
  /** 新建账本时名称留空所用的默认名（也是输入框的占位提示）。 */
  defaultLedgerName: "我的账本",
  thisLedger: "这本账",
  noNumber: "（未分配编号）",
  /** 成员人数（复数）。注意与下面的 `members`（成员与邀请页）不是同一个键。 */
  people_one: "{{count}} 人",
  people_other: "{{count}} 人",
  current: "当前",
  currentAccounting: "当前记账账本",
  manageNamed: "管理「{{name}}」",
  goToSpace: "去账本空间",
  loadingShort: "正在读取……",
  /** 开始页 / 账本空间。 */
  space: {
    /** 品牌标语（海浪上的那一行）。 */
    slogan: "记账，按你的方式",
    expandList: "展开账本列表",
    pullUp: "上滑进入我的账本",
    listLabel: "账本列表",
    switching: "正在切换到那本账……",
    heading: "我的账本",
    count_one: "共 {{count}} 本",
    count_other: "共 {{count}} 本",
    newLedger: "新建账本",
    guestNote: "游客账本只保存在当前设备，不会自动上传或合并。登录后可在目标账本设置中导入。",
    numberNote: "账本编号用于核对账本，不能用于搜索或加入。加入账本需要邀请。",
    guestLocal: "仅本机 · 游客本地账本",
    empty: "当前账号尚无账本。创建第一本之后即可开始记账，也可以邀请别人一起记。",
    createFirst: "新建第一本账",
    newName: "新账本的名称",
    creating: "正在创建……",
    createAndEnter: "创建并进入",
    retired: {
      title: "已弃置",
      description: "这些账本的数据都还在，只是不再出现在列表里。恢复后立刻可以使用。",
      restore: "恢复",
    },
    footer: {
      about: "关于 Libevra",
      privacy: "隐私政策",
      terms: "使用条款",
      tagline: "Libevra 是一个离线优先的记账工具，AGPL-3.0 开源。",
    },
  },
  /** 账本切换面板（账本详情 / 账本设置顶部的「切换」）。 */
  switcher: {
    title: "选择账本",
    close: "关闭账本列表",
    hint: {
      view: "此处只切换正在查看的账本，不会更改当前记账账本。",
      manage: "此处只切换正在管理的账本，不会更改当前记账账本。",
    },
    loadFailed: "读不到账本列表：{{error}}",
    empty: "这个账号下还没有可切换的账本。",
    targetMissing: "正在查看的这本账已不在列表里：它可能已被弃置，或者你已经不在其中。",
  },
  identity: {
    switch: "切换",
    rename: "修改账本名称",
  },
  /** 账本空间里每本账的齿轮面板。 */
  sheet: {
    info: "账本详情",
    rename: "重命名",
    settings: "账本设置",
    members: "成员与邀请",
    share: "分享链接",
    close: "关闭管理面板",
    lifecycle: "退出、归档或删除这本账",
  },
  /** 目标账本打不开时（账本详情 / 账本设置共用）。 */
  unreadable: {
    title: "打不开这本账",
    hint: "它可能已经被弃置，或者你已经不在其中。这一页不会自动换成你当前的账本。",
    back: "返回账本空间",
    chooseOther: "选择其他账本",
  },
  detail: {
    title: "账本详情",
    factsTitle: "这本账的资料",
    factsFooter: "这些数字来自服务器，只用于认出这本账；收支合计不在这里，见「分析」。",
    memberCount: "成员数量",
    createdAt: "创建日期",
    entryCount: "账目数量",
    eventCount: "编辑记录",
    events_one: "{{count}} 条",
    events_other: "{{count}} 条",
    storage: "占用空间",
    storageValue: "约 {{size}}",
    settingsRow: { label: "账本设置", detail: "管理账本资料、分类、标签和支付方式" },
    spaceRow: { label: "前往账本空间", detail: "切换、新建或整理全部账本" },
  },
  redirect: {
    opening: "正在打开账本……",
    noCurrentTitle: "还没有当前账本",
    noCurrentBody: "这个入口管理的是「当前账本」的分类、标签或支付方式。先选一本账本进去，再回来就能用了。",
  },
  settings: {
    title: "账本设置",
    managing: "正在管理",
    viewerNotice: "你对这本账只有查看权限，所以账本名称不能在这里修改。",
    section: {
      bookkeeping: "记账管理",
      data: "数据管理",
      danger: "危险操作",
    },
    row: {
      categories: { label: "分类管理", hint: "支出、收入的分类；归档不影响已有记录" },
      tags: { label: "标签管理", hint: "跨分类标记，例如「出差」「可报销」" },
      paymentMethods: { label: "支付方式", hint: "微信、支付宝、银行卡、现金等" },
      export: { label: "导出数据", hint: "把这本账导出为 CSV / Excel" },
      import: { label: "导入历史账", hint: "从 CSV 批量导入这本账" },
      importLedger: { label: "导入账本", hint: "从本机游客账本或你的另一本单人账本导入（先预览）" },
      duplicates: { label: "重复账目检测", hint: "扫描这本账的历史记录，按组查看疑似重复并逐组处理" },
    },
    lifecycleLoading: "正在读取账本状态…",
    sharedNote: "这本账还有其他成员。退出协作只会撤销你的访问权限，你的账目与历史会保留，其他成员的数据不受影响。",
    needsSuccessor: "你是这本账的管理者，但还没有其他编辑者可以接手。请先在成员设置中增加编辑者，或让其他成员成为编辑者。",
    leave: "退出这本账",
    lastMemberNote:
      "你是这本账的最后一位有效成员。可以归档并在 60 天内自行恢复；超过 60 天只能申请人工恢复；归档满 365 天后清理。永久删除会立即进入清理流程。",
    archive: "归档这本账",
    delete: "永久删除这本账",
    membersElsewhere: "成员与邀请、分享链接在账本空间的齿轮面板里，和以前一样。",
    rename: {
      title: "重命名这本账",
      description: "改名之后，这本账的所有成员看到的都是新名称。",
      saving: "正在保存……",
      save: "保存",
      field: "账本名称",
      empty: "账本名称不能为空。",
      tooLong: "账本名称最多 40 个字。",
    },
    switchDraft: {
      title: "换个账本继续？",
      description: "正在修改的账本名称还没有保存。",
      notSaved: "切换后这个名称不会被保存",
      unchanged: "这本账的名称、分类与标签都保持不变",
      cancelReturns: "取消可以回来继续编辑",
      confirm: "不保存，切换",
      cancel: "留下继续编辑",
    },
    leaveDialog: {
      title: "退出「{{name}}」？",
      description: "退出后这本账不再出现在你的列表里，你也就看不到它的账目了。",
      revoke: "仅撤销你在这本账的访问与同步权限",
      keep: "你记过的账目与历史会保留",
      others: "其他成员的数据与成员关系不受影响",
    },
    archiveDialog: {
      title: "归档「{{name}}」？",
      description: "归档后这本账暂时离开普通账本列表，数据保留。你可以在 60 天内自行恢复。",
      serverTime: "归档日期以服务器时间为准",
      restore: "60 天内可自行恢复",
      cleanup: "满 365 天后由服务器清理，只留下不含账目内容的删除记录",
    },
    deleteDialog: {
      title: "永久删除「{{name}}」？",
      description: "这本账的账目、分类、标签、留言和关联数据会立即进入永久删除流程，不能由你恢复。",
      cleanup: "服务器会清理这本账的内容",
      record: "保留不含账目正文的删除记录",
      others: "其他账本与其他成员的数据不受影响",
      devices: "旧设备恢复联网后会收到账本已删除状态并停止同步",
      confirm: "永久删除",
    },
  },
  /** 齿轮面板打开的「成员与邀请」（目标账本）。 */
  members: {
    title: "成员与邀请",
    inviteTitle: "邀请新成员",
    inviteHow: "按对方账号编号或用户名找到他，选好权限，发一条邀请。他接受之后才真正加入这本账。",
    inviteEnters: "邀请要在一本账里面发起。点下面的按钮会先进入「{{name}}」，然后在那个页面上邀请。",
    goInvite: "去邀请",
    scopeNote: "成员管理属于当前打开的这本账。邀请别人加入某一本账，不会把你或他加入其他账本。",
  },
  /** 齿轮面板打开的「分享链接」（目标账本）。 */
  share: {
    title: "分享链接",
    intro: "分享链接让别人自己加入这本账。加入进来的人会成为这本账的成员，<b>与你的其他账本没有关系</b>。",
    otherWays:
      "想按名字邀请某个人，用「成员与邀请」；用于注册账号的邀请码与账本无关，在「设置 → 账号安全」生成（终身 3 个），或由管理员在管理后台发放。",
  },
  /** 明细 · 更多。 */
  more: {
    title: "明细 · 更多",
    device: "这台设备 · ",
    loading: "正在读取…",
    months_one: "{{count}} 个月",
    months_other: "{{count}} 个月",
    entries_one: "{{count}} 笔",
    entries_other: "{{count}} 笔",
    /** `months` / `entries` 是上面两条复数文案的结果。 */
    stored: "本机已保存 {{months}}的 {{entries}}账目。",
    exportGroup: "导出账目",
    exportRow: { label: "导出为文件", detail: "按时间和条件导出 CSV 或 Excel 文件。" },
    filterGroup: "筛选与查找",
    filterRow: { label: "回到明细页筛选", detail: "按月份、收支或分类筛选账目。暂不支持文字搜索。" },
    maintenanceGroup: "数据维护",
    clearMarks: "清空「待同步」印记",
    cleared: "已清空待同步印记",
    clearDetail: "尚未同步的修改和删除将不再提交，并请求将冲突按服务器版本处理。此操作不删除账目；重新获取列表时，服务器已删除的账目会从本机移除。",
    reloadRow: { label: "重新加载应用", detail: "重新打开当前页面，不会清除本机账目或修复服务器数据。" },
    reload: {
      title: "重新加载应用？",
      description: "页面会像重新打开一样再加载一次，用来恢复界面异常。",
      formLost: "未保存的表单内容会丢失",
      importInterrupted: "正在进行的导入可能中断",
      nothingDeleted: "不会清除本机账目，也不会删除服务器上的任何数据",
      confirm: "重新加载",
    },
  },
  /** 「账本 / 协作」Tab 下的二级页：账本信息、成员管理。 */
  info: {
    title: "账本信息",
    name: "账本名称",
    number: "账本编号",
    unassigned: "（未分配）",
    memberCount: "成员数量",
    createdAt: "创建时间",
    entryCount: "账目数量",
    eventCount: "编辑记录",
    totalLedgers: "你的账本总数",
    ledgers_one: "{{count}} 本",
    ledgers_other: "{{count}} 本",
    storageNote: "占用空间没有列在这里：它是一个估算值，而在这一页里它会被当成精确值来读。需要时主页面上有一行「约 …」的提示。",
    toSpace: "前往账本空间 ›",
  },
  membersPage: {
    title: "成员管理",
  },
};

export default books;
