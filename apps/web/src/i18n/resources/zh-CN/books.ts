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
  thisLedger: "此账本",
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
    empty: "暂无账本。创建账本后即可记账。",
    createFirst: "新建第一本账",
    newName: "新账本的名称",
    creating: "正在创建……",
    createAndEnter: "创建并进入",
    retired: {
      title: "已弃置",
      description: "已归档账本的数据仍保留，恢复后可继续使用。",
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
    targetMissing: "此账本已不可用，可能已被弃置或已移除访问权限。",
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
    lifecycle: "退出、归档或删除账本",
  },
  /** 目标账本打不开时（账本详情 / 账本设置共用）。 */
  unreadable: {
    title: "无法打开账本",
    hint: "账本可能已被弃置或访问权限已移除。请选择其他账本。",
    back: "返回账本空间",
    chooseOther: "选择其他账本",
  },
  detail: {
    title: "账本详情",
    factsTitle: "账本资料",
    factsFooter: "收支汇总可在“分析”中查看。",
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
    noCurrentBody: "请选择账本，再管理分类、标签和支付方式。",
  },
  settings: {
    title: "账本设置",
    managing: "正在管理",
    viewerNotice: "仅有查看权限，无法修改账本名称。",
    section: {
      bookkeeping: "记账管理",
      data: "数据管理",
      danger: "危险操作",
    },
    row: {
      categories: { label: "分类管理", hint: "支出、收入的分类；归档不影响已有记录" },
      tags: { label: "标签管理", hint: "跨分类标记，例如「出差」「可报销」" },
      paymentMethods: { label: "支付方式", hint: "微信、支付宝、银行卡、现金等" },
      export: { label: "导出数据", hint: "导出此账本为 CSV / Excel" },
      import: { label: "导入历史账", hint: "从 CSV 文件导入账目" },
      importLedger: { label: "导入账本", hint: "从游客账本或其他单人账本导入，导入前可预览" },
      duplicates: { label: "重复账目检测", hint: "检查历史账目中的疑似重复，按组核对处理" },
    },
    lifecycleLoading: "正在读取账本状态…",
    sharedNote: "退出后将失去此账本的访问权限。已记录的账目和历史保留，其他成员不受影响。",
    needsSuccessor: "退出前需指定其他编辑者接管账本。请先邀请编辑者或修改现有成员权限。",
    leave: "退出账本",
    lastMemberNote:
      "你是这本账的最后一位有效成员。可以归档并在 60 天内自行恢复；超过 60 天只能申请人工恢复；归档满 365 天后清理。永久删除会立即进入清理流程。",
    archive: "归档账本",
    delete: "永久删除账本",
    membersElsewhere: "成员与邀请、分享链接在账本空间的齿轮面板里，和以前一样。",
    rename: {
      title: "重命名账本",
      description: "新名称对所有成员可见。",
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
      unchanged: "账本名称、分类和标签保持不变",
      cancelReturns: "取消可以回来继续编辑",
      confirm: "不保存，切换",
      cancel: "留下继续编辑",
    },
    leaveDialog: {
      title: "退出「{{name}}」？",
      description: "退出后，此账本将从列表中移除，无法再查看其中的账目。",
      revoke: "撤销此账本的访问与同步权限",
      keep: "已记录的账目与历史保留",
      others: "其他成员的数据与成员关系不受影响",
    },
    archiveDialog: {
      title: "归档「{{name}}」？",
      description: "归档后，账本将从常用列表中移除，数据保留。60 天内可自行恢复。",
      serverTime: "归档日期以服务器时间为准",
      restore: "60 天内可自行恢复",
      cleanup: "满 365 天后由服务器清理，只留下不含账目内容的删除记录",
    },
    deleteDialog: {
      title: "永久删除「{{name}}」？",
      description: "此账本的账目、分类、标签、留言和关联数据将立即进入永久删除流程，无法自行恢复。",
      cleanup: "服务器将清理账本内容",
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
    inviteHow: "输入账号编号或用户名，选择权限后发送邀请。对方接受后加入账本。",
    inviteEnters: "进入“{{name}}”后可发送成员邀请。",
    goInvite: "去邀请",
    scopeNote: "成员与邀请仅适用于此账本，不影响其他账本。",
  },
  /** 齿轮面板打开的「分享链接」（目标账本）。 */
  share: {
    title: "分享链接",
    intro: "通过链接可加入此账本，<b>无法访问其他账本</b>。",
    otherWays:
      "指定成员可在“成员与邀请”中邀请。注册邀请码用于创建账号，可在“设置 → 账号安全”生成（终身限 3 个），也可由管理员发放。",
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
    displayGroup: "展示卡片",
    exportRow: { label: "导出为文件", detail: "按时间和条件导出 CSV 或 Excel 文件。" },
    filterGroup: "筛选与查找",
    filterRow: { label: "回到明细页筛选", detail: "按时间、分类、标签、支付方式、币种或附件筛选账目。" },
    syncing: "正在同步…",
    serverSync: "进行服务器同步",
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
      nothingDeleted: "本机账目和服务器数据均保留",
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
    totalLedgers: "账本总数",
    ledgers_one: "{{count}} 本",
    ledgers_other: "{{count}} 本",
    storageNote: "存储空间为估算值，可在账本详情查看。",
    toSpace: "前往账本空间 ›",
  },
  membersPage: {
    title: "成员管理",
  },
};

export default books;
