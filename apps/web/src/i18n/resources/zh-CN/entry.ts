/**
 * `entry` 文案：记一笔（手动记账、识别核对、记账成功）、账目详情与批量记账（源语言：简体中文）。
 *
 * 键结构即全部语言的键定义。中文一字不改地搬自原来的组件；分类名、支付方式名、备注、标签名等
 * **数据**不在这里（显示预置名请用 `lib/presetNames.ts`）。
 */
const entry = {
  /** 金额校验与精度提示：币种名由 `currencyName()` 传入。 */
  amount: {
    integerOnly: "{{currency}}不支持小数，请输入整数金额。",
    invalid: "金额格式不正确，{{currency}}最多两位小数。",
    positive: "金额需要大于 0。",
    required: "请填写金额。",
    integerHint: "{{currency}}不保留小数，金额按整数记录。",
  },
  /** 手动记账页（`/add`）。 */
  add: {
    offlineSave: "当前离线，共享账本暂时只能查看。恢复网络后可以继续记账。",
    offlineNotice: "当前离线，共享账本暂时只能查看。恢复网络后可以继续记账；之前尚未同步的改动会保留。",
    categoryHint: "{{name}}包含哪些支出",
    duplicateTitle: "这笔账好像已经记过了",
    notDuplicateNoBook: "找不到当前账本，无法记录「不是同一笔」。",
    notDuplicateNoPair: "没有可记录的交易对。",
    notDuplicateFailed: "这笔账已保存，但「不是同一笔」没有记住：{{reason}}",
  },
  /** 手动记账的疑似重复轻提醒。 */
  duplicate: {
    save: "仍然保存",
    saveHint: "两笔都留下（也许是两次一样的消费）",
    confirmNotDuplicate: "确认不是同一笔",
    confirmNotDuplicateHint: "两笔都留，并记住这一对：以后不再提示",
    cancel: "取消，我再看看",
    fallbackBasis: "金额、收支方向和时间与已有账目相符。",
    foundCount_one: "共找到 {{count}} 笔相似记录。",
    foundCount_other: "共找到 {{count}} 笔相似记录。",
    localScope: "本次只比对了本机已知数据。",
  },
  /** 「沿用上一笔」与「快捷金额」那一行。 */
  quick: {
    inherit: "沿用上一笔",
    amounts: "快捷金额",
    inheritDone: "已沿用上一笔的分类、支付方式、币种与标签。",
    refusal: {
      "no-record": "这个账本还没有可沿用的记录。",
      "no-compatible": "还没有同方向的上一笔记录。",
      "ledger-unavailable": "分类与支付方式还没加载完，稍后再试。",
    },
  },
  amountField: {
    currencyButton: "币种：{{name}}（{{code}}），点按切换",
  },
  currencySheet: {
    title: "选择币种",
  },
  /** 「更多选项」：支付方式、备注、标签。 */
  more: {
    title: "更多选项",
    notePlaceholder: "可不填",
    tagsHeading: "标签（最多 {{max}} 个，已选 {{selected}} 个）",
    hasNote: "有备注",
    tagCount_one: "{{count}} 个标签",
    tagCount_other: "{{count}} 个标签",
  },
  /** 记账成功页。 */
  saved: {
    title: "已记账",
    again: "再记一笔",
    continueBatch_one: "继续记账（还有 {{count}} 张）",
    continueBatch_other: "继续记账（还有 {{count}} 张）",
    home: "返回主页",
    undo: "撤销这次记账",
  },
  /** 拍照 / 语音识别后的核对表单（`ReviewStep`）。 */
  review: {
    remaining_one: "还有 {{count}} 张需要核对",
    remaining_other: "还有 {{count}} 张需要核对",
    paymentUnselected: "未选择",
    notePlaceholder: "可不填",
    confirmSave: "确认并保存",
    switchToManual: "识别得不对？改成手动记账",
  },
  /** 账目详情 / 修改（`/transactions/:id`）。 */
  detail: {
    title: "记账详情",
    editTitle: "修改记账",
    deletedSubtitle: "这笔账目已删除",
    deletedLine: "{{kind}} · 已删除",
    recordOf: "{{date}} 的记录",
    deletedAt: "删除时间：{{time}}",
    removedByImport: "通过账本导入移除",
    showImportId: "查看导入任务编号",
    restoreNote: "恢复后将保留原账目编号。账本须仍然存在，且你有编辑权限。",
    restoring: "正在恢复…",
    restore: "恢复账目",
    backToHistory: "返回历史记录",
    deletedUndo: "已删除这笔记账",
    edit: "修改",
    offlineReadOnly: "当前离线，共享账本暂时只能查看。恢复网络后可以修改或删除这笔记录；之前尚未同步的改动会保留。",
    tagsHeading: "标签（最多 {{max}} 个）",
    batchAdd: "批量记账",
    saveChanges: "保存修改",
    notRecorded: "未记录",
    number: "编号",
    noTags: "没有标签",
    copy: "复制这一笔",
    checking: "正在检测…",
    checkDuplicates: "重复账目检测",
    checkScope: "只检查这一笔与本账本的历史记录；不会删除、合并或修改任何账目。",
    checkDisabled: "（重复提醒已关闭，需要先到设置里打开。）",
    noDuplicates: "没有发现符合当前规则的疑似重复。",
    localScopeNote: "（本次只比对了本机已知数据，不能据此认为账本里没有重复。）",
    foundSimilar_one: "找到 {{count}} 笔相似记录。疑似重复不会自动处理。",
    foundSimilar_other: "找到 {{count}} 笔相似记录。疑似重复不会自动处理。",
    noNote: "（无备注）",
    marking: "正在记录…",
    notSame: "这两笔不是同一笔",
    notSamePairInvalid: "这两笔无法建立「不是同一笔」关系。",
    notSameFailed: "「不是同一笔」没有记住：{{reason}}",
    delete: "删除这笔记账",
    deleteTitle: "删除这笔账目？",
    deleteDescription: "即将删除这笔 {{amount}} 的记录。",
    deleteRestore: "删除后，可从编辑历史打开账目并恢复；账本须仍然存在，且你有编辑权限",
    deleteRecalc: "本月的总额、笔数与结余会立即重新计算",
    deleteUndo: "删除后的几秒内仍可在底部选择「撤销」",
    confirmDelete: "确认删除",
  },
  /** 账目详情里的「批量记账」面板。 */
  batch: {
    title: "批量记账",
    saveAll: "仍然保存全部",
    timeInvalid: "请选择有效的时间。",
    noteTooLong: "备注最多 {{max}} 个字符。",
    tooManyTags: "每笔最多选择 {{max}} 个标签。",
    ledgerLoading: "账本还没有加载完成，请稍后再试。",
    hasErrors: "有账目还没有填好，请检查标出的项目。",
    noneSaved: "没有新增账目：{{reason}}",
    retryLater: "请稍后重试。",
    partlySaved_one: "已新增 {{count}} 笔，其余没有保存。请重试未保存的账目。",
    partlySaved_other: "已新增 {{count}} 笔，其余没有保存。请重试未保存的账目。",
    saved_one: "已新增 {{count}} 笔账目。",
    saved_other: "已新增 {{count}} 笔账目。",
    intro: "第一笔已带入当前账目；可修改或继续添加。保存前不会写入账本。",
    addCard: "再记一笔",
    settings: "记账设置",
    cardCount_one: "共 {{count}} 笔",
    cardCount_other: "共 {{count}} 笔",
    mixedCurrencies: "多币种，不合计",
    total: "合计 {{currency}} {{amount}}",
    saveCount_one: "保存 {{count}} 笔",
    saveCount_other: "保存 {{count}} 笔",
    removeTitle: "删除这张卡片？",
    removeDescription: "这张卡片已经填了内容。",
    removeConsequence: "只删除这次批量记账里的卡片，不会删除已保存的账目。",
    removeConfirm: "删除卡片",
    duplicateTitle: "有账目可能重复",
    duplicateDescription_one:
      "检测到 {{count}} 笔与账本里的已有账目相似。疑似重复不会被自动处理；可以选择仍然保存全部，或返回检查。",
    duplicateDescription_other:
      "检测到 {{count}} 笔与账本里的已有账目相似。疑似重复不会被自动处理；可以选择仍然保存全部，或返回检查。",
    cardTitle: "第 {{number}} 笔",
    removeCard: "删除第 {{number}} 笔",
    uncategorized: "未分类",
    noPayment: "未记录",
  },
};

export default entry;
