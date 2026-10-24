/**
 * `auth` 文案：登录、创建账号、找回密码、恢复归档账本、账号入口切换、密码框、恢复码卡片
 * （源语言：简体中文）。键结构即全部语言的键定义。
 */
const auth = {
  field: {
    username: "用户名",
    password: "密码",
    confirmPassword: "确认密码",
    newPassword: "新密码",
    inviteCode: "邀请码",
    recoveryCode: "恢复码",
    passwordMin: "至少 {{min}} 位",
  },
  /** 账号入口（登录 / 创建账号）切换。 */
  switcher: {
    label: "账号入口",
    login: "登录",
    register: "创建账号",
  },
  /** 密码框右侧的显示 / 隐藏按钮（读屏名称）。 */
  passwordToggle: {
    show: "显示密码",
    hide: "隐藏密码",
  },
  guestEntry: "以游客身份继续",
  login: {
    title: "登录",
    subtitle: "使用用户名和密码继续。",
    forgotPassword: "忘记密码",
    recoverArchive: "恢复已注销账号的归档账本",
    sessionAccountClosed: "这个账号已注销，无法继续使用。",
    sessionAccountDisabled: "该账号目前已停用，本设备的登录状态已结束。",
    sessionExpired: "登录状态已失效，请重新登录。",
    missingFields: "请填写用户名和密码。",
    submit: "登录",
    submitting: "登录中…",
  },
  register: {
    title: "创建账号",
    recoveryTitle: "恢复码",
    recoverySubtitle: "账号已创建。请现在保存这个恢复码。",
    checkingSubtitle: "正在确认当前的注册方式。",
    checking: "正在确认当前的注册方式…",
    configFailed: "暂时无法确认当前的注册方式。请检查网络后重试。",
    retry: "重试",
    agreementsFailed: "暂时无法读取当前协议文件。请刷新页面或稍后再试。",
    agreementsLoading: "正在读取当前协议文件…",
    inviteMissing: "请填写邀请码。",
    invalid: "请检查填写的内容。",
    passwordMismatch: "两次输入的密码不一致。",
    agreementsRequired: "请先阅读并分别同意每一份当前适用的协议。",
    subtitleInvite: "创建账号需要邀请码。",
    subtitleOpen: "创建你的 Libevra 账号。",
    inviteHint: "由已有账号在「设置 → 账号安全」生成，或由管理员发放。",
    usernameHint: "3–20 位字母、数字或下划线，用于登录，全站唯一",
    /** `<link>` 是协议文件的链接，`{{title}}` 是协议文件自己的标题（中文原文，不翻译）。 */
    agree: "我已阅读并同意 <link>{{title}}</link>。",
    documentVersion: "版本 {{version}}",
    submit: "创建账号",
    submitting: "创建中…",
    haveAccount: "已经有一个账号？",
    goLogin: "去登录",
    inviteNotice: "为了保持稳定的使用体验，目前新账号通过邀请开放。",
    inviteNoticeDetail: "邀请码与账本无关；它只用于创建一个独立的账号。",
  },
  recover: {
    title: "找回密码",
    subtitle: "输入用户名与恢复码，即可设置新密码。",
    doneTitle: "密码已重置",
    doneSubtitle: "原密码已失效，请使用新密码登录。",
    backToLogin: "返回登录",
    recoveryCodeHint: "不区分大小写，可省略连字符",
    invalid: "请检查填写的内容。",
    submit: "重置密码",
    submitting: "提交中…",
  },
  /** 公开的「恢复已注销账号的归档账本」申请页。 */
  archive: {
    title: "恢复归档账本",
    intro:
      "账号注销时如果选择了保留归档账本，会得到一条一次性恢复凭证。提交后需要管理员核验，不会仅凭账本编号直接恢复。",
    accountNumber: "原账号编号",
    credential: "一次性恢复凭证",
    bookNumber: "原账本编号",
    targetAccountNumber: "接收账本的账号编号（可选）",
    submit: "提交恢复申请",
    submitting: "提交中…",
    submitted: "申请已提交。管理员核验后才会恢复；审核截止 {{deadline}}。",
    /** `<mono>` 包住申请编号（等宽字体）。 */
    requestId: "申请编号：<mono>{{id}}</mono>",
    backToLogin: "返回登录",
  },
  /** 新恢复码只显示一次的卡片（创建账号、找回密码、重新生成恢复码共用）。 */
  recoveryCard: {
    notice: "请妥善保存以下恢复码。它仅显示一次，是忘记密码时重置密码的唯一凭据。",
    copy: "复制恢复码",
    copied: "已复制",
    confirm: "我已妥善保存该恢复码",
    done: "完成",
  },
};

export default auth;
