/**
 * **`@libellum/shared` 里写死的中文提示 → 当前界面语言。**
 *
 * shared 包同时被服务器和浏览器使用，它的 zod 校验信息、识别提示等是中文原文，服务器也会把同一句话
 * 原样放进错误响应。本轮不改 shared 的契约（API 文案不能因为翻译而变），所以在浏览器端按**原文**
 * 查表翻译：中文界面原样返回；英文界面查到就用英文，查不到就原样返回（并在开发环境告警，
 * 便于补齐）。带数字的句子用正则条目匹配。
 *
 * 收录范围（S16）：
 * - shared 的 zod 校验信息（账号、记账、统计、导出、编号、账本导入、不重复判断、邀请码）；
 * - shared 的识别 / 判断说明：粘贴与语音解析的提示（`transactionText`）、疑似重复的依据与设置校验
 *   （`duplicateDetection`）、图片识别与统计区间等标签；
 * - 服务器原样返回、界面会显示的提示：校验兜底句、CSV 导入的逐行错误、账单导入的提示与对账说明。
 *
 * 不收录：识别关键词与正则、导出文件表头、预置分类名（见 `lib/presetNames.ts`）、法律文本。
 * 覆盖情况由 `sharedMessages.test.ts` 扫描 shared 源码检查。
 */
import { isChineseLocale } from "./index.js";

/** 疑似重复依据里的字段名（句中用小写，单独显示时首字母大写）。 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  金额: "amount",
  币种: "currency",
  收支方向: "type",
  时间: "time",
  分类: "category",
  支付方式: "payment method",
  商户: "merchant",
  备注: "note",
  标签: "tags",
  账本: "ledger",
};

/** BOA 结单的分区名，用结单上的英文原名。 */
const BOA_SECTIONS: Readonly<Record<string, string>> = {
  存入: "Deposits and other additions",
  "ATM 与借记卡支出": "ATM and debit card subtractions",
  其他支出: "Other subtractions",
  服务费: "Service fees",
};

function capitalize(text: string): string {
  return text === "" ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** `金额、币种、时间` → `amount, currency and time`。 */
function fieldList(text: string): { readonly text: string; readonly count: number } {
  const items = text.split("、").map((item) => FIELD_LABELS[item] ?? item);
  if (items.length <= 1) return { text: items[0] ?? "", count: items.length };
  return { text: `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`, count: items.length };
}

/** 英文单复数：`1 row` / `3 rows`。 */
function plural(count: string, one: string, other: string): string {
  return count === "1" ? one.replace("#", count) : other.replace("#", count);
}

/** 清单作主语时的谓语：一项 `matches`，两项 `both match`，更多 `all match`。 */
function allMatch(count: number): string {
  if (count <= 1) return "matches";
  return count === 2 ? "both match" : "all match";
}

/** 原文完全相同才命中。 */
const EXACT: ReadonlyMap<string, string> = new Map<string, string>([
  // ---- 账号（auth.ts） ----
  ["用户名需为 3–20 位字母、数字或下划线", "Usernames must be 3–20 letters, numbers or underscores"],
  ["请填写昵称", "Enter a nickname"],
  ["请填写邀请码", "Enter an invite code"],
  ["协议内容标识格式不正确", "The agreement’s content ID isn’t valid"],
  ["请填写用户名", "Enter your username"],
  ["请填写密码", "Enter your password"],
  ["请填写恢复码", "Enter your recovery code"],
  ["请输入当前密码", "Enter your current password"],

  // ---- 记账与分类（ledger.ts） ----
  ["金额必须是整数（分）", "The amount must be a whole number in the currency’s smallest unit"],
  ["金额不能为负数", "The amount can’t be negative"],
  ["金额超出可记录的上限", "The amount is more than can be recorded"],
  ["标识格式不正确", "The ID isn’t valid"],
  ["请填写分类名称", "Enter a category name"],
  ["请填写支付方式名称", "Enter a payment method name"],
  ["请填写标签名称", "Enter a tag name"],
  ["颜色格式应为 #RRGGBB", "Use a color in #RRGGBB format"],
  ["日期格式应为 YYYY-MM-DD", "Enter the date as YYYY-MM-DD"],

  // ---- 统计（stats.ts） ----
  ["日期不存在", "That date doesn’t exist"],
  ["开始日期不能晚于结束日期", "The start date can’t be after the end date"],
  ["对比区间的起止日期必须同时提供", "Give both a start and an end date for the comparison period"],
  ["近一年", "Last 12 months"],

  // ---- 时间合同（timeCalendar.ts） ----
  ["时间区间不能为空", "The time range can’t be empty"],
  ["不是该时间桶的起点", "That date isn’t the start of a time bucket"],

  // ---- 时间序列（timeSeries.ts） ----
  [
    "金额必须是整数（以分为单位）",
    "The amount must be a whole number in the currency’s smallest unit",
  ],
  ["金额超出可安全表示的整数范围", "The amount is more than can be represented exactly"],

  // ---- 导出与编号（export.ts、refs.ts） ----
  ["月份格式应为 YYYY-MM", "Enter the month as YYYY-MM"],
  ["起始月份不能晚于结束月份", "The start month can’t be after the end month"],
  ["起始日期不能晚于结束日期", "The start date can’t be after the end date"],
  ["导出编号格式不正确", "The export reference isn’t valid"],
  ["导入编号格式不正确", "The import reference isn’t valid"],

  // ---- 账本导入（ledgerImport.ts） ----
  ["来源必须且只能是游客快照或正式账本 id 之一。", "Give exactly one source: a guest snapshot or a ledger ID."],
  ["正式账本来源不能把新账本作为目标。", "When importing from one of your ledgers, the target can’t be a new ledger."],
  ["来源账本和目标账本不能相同。", "The source and target ledgers can’t be the same."],
  ["来源账目 id 重复", "A source entry ID appears more than once"],
  [
    "增量预览必须且只能给出正式来源 id 或游客来源快照之一。",
    "An update preview needs exactly one source: a ledger ID or a guest snapshot.",
  ],

  // ---- 不重复判断（notDuplicateRelations.ts） ----
  ["逐对确认", "Confirmed pair by pair"],
  ["整组确认", "Confirmed as a group"],
  ["导入核对", "Import review"],
  ["配对的两笔交易 id 都不能为空。", "Both entries in a pair need an ID."],
  ["一笔交易不能和自己构成不重复关系。", "An entry can’t be marked as not a duplicate of itself."],
  [
    "请提供要确认的交易对（pairs）或一组互不重复的交易（transactionIds）。",
    "Provide the pairs to confirm (pairs) or a group of entries that aren’t duplicates (transactionIds).",
  ],

  // ---- 邀请码（invites.ts） ----
  ["该邀请码已被使用。", "That invite code has already been used."],
  ["该邀请码已被撤销。", "That invite code has been revoked."],
  ["该邀请码已过期，请向邀请你的人再要一个。", "That invite code has expired. Ask the person who invited you for a new one."],

  // ---- 图片识别标签（ocr.ts） ----
  ["微信", "WeChat"],
  ["支付宝", "Alipay"],
  ["银行", "Bank"],
  ["美团", "Meituan"],
  ["京东", "JD.com"],
  ["淘宝", "Taobao"],
  ["单笔详情", "Single transaction"],
  ["交易列表", "Transaction list"],
  ["无法判断", "Can’t tell"],
  ["支出", "Expense"],
  ["收入", "Income"],
  ["转账", "Transfer"],
  ["方向待确认", "Type to confirm"],

  // ---- 疑似重复：字段名、范围与设置校验（duplicateDetection.ts） ----
  ...Object.entries(FIELD_LABELS).map(([zh, en]): [string, string] => [zh, capitalize(en)]),
  ["账本（服务器）", "Ledger (server)"],
  ["本机已知数据", "Data on this device"],
  [
    "时间窗口必须是整数秒（不能是小数、NaN 或 Infinity）。",
    "The time window must be a whole number of seconds (not a decimal, NaN or Infinity).",
  ],
  ["重复检测设置必须是一个对象。", "Duplicate check settings must be an object."],
  ["重复检测设置不是对象，已使用默认值。", "Duplicate check settings weren’t an object, so the defaults were used."],

  // ---- 疑似重复：每条规则的判断说明（duplicateDetection.ts） ----
  ["重复提醒已关闭，本次不进行检测。", "Duplicate reminders are off, so nothing was checked."],
  ["缺少账本信息，无法判断是否同一本账。", "Ledger information is missing, so it’s unclear whether they’re in the same ledger."],
  ["两笔记录属于不同账本，不比较。", "The two entries are in different ledgers, so they weren’t compared."],
  ["同一账本。", "Same ledger."],
  ["收支方向匹配已关闭。", "Type matching is off."],
  ["收支方向未知，不能判断为同一笔。", "The type is unknown, so they can’t be treated as the same entry."],
  ["收支方向不同（收入与支出不会互为重复）。", "Different types (an income and an expense are never duplicates)."],
  ["收支方向相同。", "Same type."],
  ["金额匹配已关闭。", "Amount matching is off."],
  ["缺少金额，无法判断。", "An amount is missing, so they can’t be compared."],
  ["金额不是合法的正整数最小单位。", "An amount isn’t a valid positive whole number in the currency’s smallest unit."],
  ["金额不同。", "Different amounts."],
  ["金额完全相等。", "Exactly the same amount."],
  ["币种匹配已关闭。", "Currency matching is off."],
  ["缺少币种，无法判断。", "A currency is missing, so they can’t be compared."],
  ["币种不同（不做汇率折算）。", "Different currencies (no exchange-rate conversion)."],
  ["币种相同。", "Same currency."],
  ["时间匹配已关闭。", "Time matching is off."],
  ["缺少可解析的准确时间，但本地日期相同；按较弱依据比较。", "No exact time to compare, but the dates match, so this is weaker evidence."],
  ["本地日期不同，且缺少可比较的准确时间。", "The dates differ and there’s no exact time to compare."],
  [
    "缺少可解析的交易时间（也没有可用本地日期），无法核对时间窗口。",
    "There’s no usable time or date, so the time window can’t be checked.",
  ],
  ["分类匹配已关闭。", "Category matching is off."],
  ["至少一方没有分类，不因缺失排除。", "At least one entry has no category, which alone doesn’t rule it out."],
  ["分类不同。", "Different categories."],
  ["分类相同。", "Same category."],
  ["支付方式匹配已关闭。", "Payment method matching is off."],
  ["至少一方没有支付方式，不因缺失排除。", "At least one entry has no payment method, which alone doesn’t rule it out."],
  ["支付方式不同。", "Different payment methods."],
  ["支付方式相同。", "Same payment method."],
  ["至少一方缺少辅助字段，不因缺失排除。", "At least one entry is missing an extra field, which alone doesn’t rule it out."],
  ["辅助字段相同。", "Extra fields match."],
  ["已启用的辅助字段不同。", "An enabled extra field is different."],
  ["存在排除条件。", "A rule ruled this out."],

  // ---- 粘贴 / 语音解析提示（transactionText.ts） ----
  ["金额无法唯一确定，请核对。", "The amount isn’t certain. Please check it."],
  ["没有找到明确的交易金额，请手动填写。", "No clear amount was found. Please enter it."],
  ["没有明确的收支方向，已按支出预填，请核对。", "It’s not clear whether this is an expense or income, so it was filled in as an expense. Please check."],
  ["这笔看起来是转账，分类需要你确认，未按普通购物处理。", "This looks like a transfer, so it wasn’t treated as a regular purchase. Please confirm the category."],
  ["识别到退款，收支方向已按收入处理，请核对。", "This looks like a refund, so it was filled in as income. Please check."],
  ["没有看到币种，已按人民币预填，请核对。", "No currency was mentioned, so Chinese yuan was filled in. Please check."],
  ["没有足够依据判断分类，请手动选择。", "There isn’t enough to go on for a category. Please choose one."],
  ["文中出现多个可能的金额，请选择实际金额。", "There are several possible amounts. Choose the actual amount."],
  ["只听到大致时段，没有具体时间；时间留空，请按需要补充。", "Only a rough time of day was given, so the time was left blank. Add it if needed."],
  ["只说了星期，已按本周计算，请核对日期。", "Only a weekday was given, so this week was assumed. Please check the date."],
  ["没有说明年份，已按当前年份推算，请核对日期。", "No year was given, so the current year was assumed. Please check the date."],

  // ---- 服务器原样返回的校验信息 ----
  ["请求参数不合法", "Some of the submitted information isn’t valid"],
  ["给账号编号或用户名，二选一。", "Give either an account number or a username, not both."],
  ["账号编号应为 8 位数字", "Account numbers are 8 digits"],
  ["账本编号应为 8 位数字", "Ledger numbers are 8 digits"],

  // ---- 服务器：CSV / XLSX 文件导入的逐行错误 ----
  ["日期格式应为 YYYY-MM-DD。", "Enter the date as YYYY-MM-DD."],
  ["时间格式应为 HH:mm。", "Enter the time as HH:mm."],
  ["金额超出可记录的上限。", "The amount is more than can be recorded."],

  // ---- 服务器：账单导入的提示（微信 / 支付宝 / BOA / Libevra 账单） ----
  ["结单只提供过账日期，时间按当天 00:00 记录。", "The statement only shows posting dates, so the time is recorded as 00:00 that day."],
  ["描述里含 REFUND/RETURN，请核对这笔是否为退款。", "The description mentions REFUND/RETURN. Check whether this is a refund."],
  ["这笔金额为 0.00，请核对。", "This amount is 0.00. Please check."],
  [
    "没有读到期初或期末余额，无法完成「期初 + 存入 - 支出 = 期末」核对。",
    "The beginning or ending balance couldn’t be read, so “beginning + deposits − withdrawals = ending” couldn’t be checked.",
  ],
  ["这笔在支付宝里标记为「不计收支」，默认不导入。", "Alipay marks this as not counted as income or expense, so it won’t be imported by default."],
  ["这笔在微信里标记为「不计收支」，默认不导入。", "WeChat marks this as not counted as income or expense, so it won’t be imported by default."],
  ["文件只提供日期，时间按当天 00:00 记录。", "The file only has dates, so the time is recorded as 00:00 that day."],
  [
    "这笔没有交易单号，已按文件位置生成来源编号；换一份导出可能无法识别为同一笔。",
    "This transaction has no transaction number, so a source reference was made from its position in the file. A different export may not be recognized as the same transaction.",
  ],
  ["时间无法识别，已按当天 00:00 处理。", "The time couldn’t be read, so 00:00 that day was used."],
  [
    "候选配对数量较大，本次重复检测未覆盖所有组合；请缩小文件范围后继续核对。",
    "There are too many possible pairs, so not every combination was checked for duplicates. Use a file covering a shorter period and review again.",
  ],
  ["结单对账不一致，确认导入前需要先核对对账信息。", "The statement doesn’t reconcile. Check the reconciliation details before confirming the import."],
  ["金额格式不正确，无法转换为最小单位。", "The amount’s format isn’t valid."],
  ["收支方向未确定，请选择收入或支出。", "The type isn’t set. Choose income or expense."],
  ["日期不是有效的 YYYY-MM-DD。", "The date isn’t a valid YYYY-MM-DD date."],
  ["时间不是有效的 HH:mm 或 HH:mm:ss。", "The time isn’t a valid HH:mm or HH:mm:ss time."],
  ["只解析到日期的交易不能带时间。", "A transaction read with only a date can’t have a time."],
  ["这个账本缺少对应方向的系统分类，无法导入。", "This ledger is missing the built-in category for this type, so this can’t be imported."],
  ["所选分类不存在或已被删除。", "The selected category doesn’t exist or has been deleted."],
  ["所选支付方式不存在或已被删除。", "The selected payment method doesn’t exist or has been deleted."],
  ["无法把日期时间换算为绝对时间。", "The date and time couldn’t be converted to an exact moment."],
]);

/** 替换：字符串里的 `$1`、`$2` 按捕获组替换；函数收到各捕获组，返回整句译文。 */
type Replacement = string | ((...groups: string[]) => string);

/** 含变量的原文。正则都锚定整句（`^…$`），不加 `g` 标志。 */
const PATTERNS: readonly (readonly [RegExp, Replacement])[] = [
  // ---- 账号（auth.ts） ----
  [/^密码至少 (\d+) 位$/, "Passwords must be at least $1 characters"],
  [/^密码最多 (\d+) 位$/, "Passwords can be at most $1 characters"],
  [/^昵称最多 (\d+) 个字符$/, "Nicknames can be at most $1 characters"],

  // ---- 记账与分类（ledger.ts）：上限写在原文里，按数字匹配，常量改了也不失效 ----
  [/^分类名称最多 (\d+) 个字符$/, "Category names can be at most $1 characters"],
  [/^支付方式名称最多 (\d+) 个字符$/, "Payment method names can be at most $1 characters"],
  [/^标签名称最多 (\d+) 个字符$/, "Tag names can be at most $1 characters"],
  [/^备注最多 (\d+) 个字符$/, "Notes can be at most $1 characters"],
  [/^一笔账最多 (\d+) 个标签$/, "An entry can have at most $1 tags"],

  // ---- 统计（stats.ts） ----
  [/^统计区间最长 (\d+) 天$/, (days) => `The period can be at most ${plural(days, "# day", "# days")}`],
  [/^近 (\d+) 天$/, "Last $1 days"],

  // ---- 疑似重复：设置校验（duplicateDetection.ts） ----
  [/^缺少设置项：(\w+)。$/, "Missing setting: $1."],
  [/^(\w+) 必须是 true 或 false。$/, "$1 must be true or false."],
  [/^时间窗口不能小于 (\d+) 秒。$/, (seconds) => `The time window can’t be shorter than ${plural(seconds, "# second", "# seconds")}.`],
  [
    /^时间窗口不能大于 (\d+) 秒（(\d+) 天）。$/,
    (seconds, days) => `The time window can’t be longer than ${plural(seconds, "# second", "# seconds")} (${plural(days, "# day", "# days")}).`,
  ],
  [/^未知设置项：(.+)，已忽略。$/, "Unknown setting: $1. It was ignored."],
  [/^未知设置项：(.+)。$/, "Unknown setting: $1."],

  // ---- 疑似重复：判断说明（duplicateDetection.ts） ----
  [
    /^实际时间相差 (\d+(?:\.\d+)?) 秒，在 (\d+) 秒窗口内。$/,
    (apart, window) => `The times are ${plural(apart, "# second", "# seconds")} apart, within the ${window}-second window.`,
  ],
  [
    /^实际时间相差 (\d+(?:\.\d+)?) 秒，超过 (\d+) 秒窗口。$/,
    (apart, window) => `The times are ${plural(apart, "# second", "# seconds")} apart, outside the ${window}-second window.`,
  ],
  [
    /^(.+)均符合；请核对后决定是否保留。$/,
    (checked) => {
      const list = fieldList(checked);
      return `${capitalize(list.text)} ${allMatch(list.count)}. Review it and decide whether to keep it.`;
    },
  ],
  [
    /^(.+)符合；以下字段缺失，按较弱依据提示：(.+)。$/,
    (checked, missing) => {
      const list = fieldList(checked);
      return `${capitalize(list.text)} ${list.count > 1 ? "match" : "matches"}, but these fields are missing, so this is a weaker match: ${fieldList(missing).text}.`;
    },
  ],
  [
    /^(.+)均相同。$/,
    (checked) => {
      const list = fieldList(checked);
      return `${capitalize(list.text)} ${allMatch(list.count)}.`;
    },
  ],
  [
    /^(.+)相同；(.+)缺失，按较弱依据提示。$/,
    (checked, missing) => {
      const list = fieldList(checked);
      const gaps = fieldList(missing);
      return `${capitalize(list.text)} ${list.count > 1 ? "match" : "matches"}; ${gaps.text} ${gaps.count > 1 ? "are" : "is"} missing, so this is a weaker match.`;
    },
  ],

  // ---- 粘贴 / 语音解析（transactionText.ts） ----
  [
    /^文中出现多个可能的金额（(.+)），请选择实际金额。$/,
    (amounts) => `There are several possible amounts (${amounts.split("、").join(", ")}). Choose the actual amount.`,
  ],

  // ---- 服务器：CSV / XLSX 文件导入的逐行错误 ----
  [/^「(.*)」不是一个真实日期。$/, "“$1” isn’t a real date."],
  [/^「(.*)」不是有效金额。$/, "“$1” isn’t a valid amount."],
  [/^不支持的币种「(.*)」，可用：(.+)。$/, "Unsupported currency “$1”. Available: $2."],
  [/^无法识别的类型「(.*)」，应为「支出」或「收入」。$/, "Unrecognized type “$1”. Use the expense or income value from the export template."],
  [/^分类「(.*)」不存在。请先在应用里创建它，或把它改成一个已有分类。$/, "Category “$1” doesn’t exist. Create it in the app first, or change it to an existing category."],
  [/^支付方式「(.*)」不存在。$/, "Payment method “$1” doesn’t exist."],

  // ---- 服务器：账单导入 · 逐笔提示 ----
  [/^提交前需要处理：(.+)$/, (issue) => `Fix before submitting: ${translateSharedMessage(issue)}`],
  [/^不支持的币种「(.*)」。$/, "Unsupported currency “$1”."],
  [/^时区「(.*)」无效。$/, "Time zone “$1” isn’t valid."],
  [/^分类「(.*)」已归档。$/, "Category “$1” is archived."],
  [/^分类「(.*)」与收支方向不一致。$/, "Category “$1” doesn’t match the entry’s type."],
  [/^支付方式「(.*)」已归档。$/, "Payment method “$1” is archived."],
  [/^交易状态为「(.*)」，默认不导入。$/, "The transaction status is “$1”, so it won’t be imported by default."],
  [/^交易状态为「(.*)」，已保留原方向，请核对是否计入。$/, "The transaction status is “$1”. Its original type was kept; check whether it should count."],
  [
    /^收支方向「(.*)」无法识别，默认不导入。$/,
    (value) =>
      value === "空"
        ? "The income/expense value is blank, so it won’t be imported by default."
        : `The income/expense value “${value}” isn’t recognized, so it won’t be imported by default.`,
  ],
  [/^未找到匹配的支付方式「(.*)」，导入后需手动选择。$/, "No payment method matches “$1”. Choose one after importing."],
  [/^类型「(.*)」无法识别，默认不导入。$/, "Type “$1” isn’t recognized, so it won’t be imported by default."],
  [/^分类「(.*)」不在账本中，导入时将使用系统分类。$/, "Category “$1” isn’t in this ledger, so a built-in category will be used."],
  [/^支付方式「(.*)」不在账本中，导入后需手动选择。$/, "Payment method “$1” isn’t in this ledger. Choose one after importing."],
  [
    /^描述里出现日期 (\S+)（可能是消费日期），与过账日期 (\S+) 不同；本行按过账日期入账，请核对。$/,
    "The description mentions $1 (possibly the purchase date), which differs from the posting date $2. This row uses the posting date. Please check.",
  ],
  [/^文件内第 (\d+) 行使用了相同的来源身份，这一笔会被跳过。$/, "Row $1 of the file has the same source identity, so this one will be skipped."],
  [
    /^来源单号已存在（交易 #(\d+)，(\d{4}-\d{2}-\d{2})(，已删除)?），这一笔会被跳过。$/,
    (seq, date, deleted) =>
      `This source number already exists (entry #${seq}, ${date}${deleted === "" ? "" : ", deleted"}), so this one will be skipped.`,
  ],
  [/^流水编号对应的交易 #(\d+) 已在本账本中，这一笔会被跳过。$/, "Entry #$1 with this ID is already in this ledger, so this one will be skipped."],
  [/^与文件内第 (\d+) 行疑似重复，请核对。$/, "Possible duplicate of row $1 in the file. Please check."],
  [/^与账本已有交易 #(\d+)（(.+)）疑似重复，请核对。$/, "Possible duplicate of existing entry #$1 ($2). Please check."],
  [/^文件指纹与已有导入记录 (\S+) 相同，导入时会跳过。$/, "This file matches earlier import $1, so it will be skipped."],

  // ---- 服务器：账单导入 · 整份文件的提示 ----
  [/^第 (\d+) 页有一笔交易无法判断所属分区，已按金额方向导入。$/, "A transaction on page $1 couldn’t be matched to a section, so it was imported by the sign of its amount."],
  [
    /^有 (\d+) 行描述换行，已拼接到上一笔交易。$/,
    (count) => plural(count, "# description line wrapped and was joined to the transaction above.", "# description lines wrapped and were joined to the transactions above."),
  ],
  [
    /^有 (\d+) 行日期或金额无法识别，已跳过。$/,
    (count) => plural(count, "Skipped # row with an unreadable date or amount.", "Skipped # rows with an unreadable date or amount."),
  ],
  [
    /^有 (\d+) 行日期\/金额无法识别，已跳过。$/,
    (count) => plural(count, "Skipped # row with an unreadable date or amount.", "Skipped # rows with an unreadable date or amount."),
  ],
  [
    /^有 (\d+) 行无法识别交易时间或金额，已跳过。$/,
    (count) => plural(count, "Skipped # row with an unreadable transaction time or amount.", "Skipped # rows with an unreadable transaction time or amount."),
  ],
  [/^第 (\d+) 行的交易时间或金额无法识别，已跳过。$/, "Row $1: the transaction time or amount couldn’t be read, so it was skipped."],
  [/^第 (\d+) 行的日期、金额或币种无法识别，已跳过。$/, "Row $1: the date, amount or currency couldn’t be read, so it was skipped."],
  [/^说明区记录共 (\d+) 笔，实际识别 (\d+) 笔，请核对文件是否完整。$/, "The file’s summary lists $1 transactions, but $2 were read. Check that the file is complete."],
  [
    /^已默认排除 (\d+) 笔不计收支\/关闭交易，可在核对页逐笔勾选。$/,
    (count) =>
      plural(
        count,
        "Left out # transaction that’s closed or not counted as income or expense. You can select it on the review page.",
        "Left out # transactions that are closed or not counted as income or expense. You can select them one by one on the review page.",
      ),
  ],
  [
    /^有 (\d+) 笔带退款状态，已保留但需要核对。$/,
    (count) => plural(count, "# transaction has a refund status. It was kept but needs checking.", "# transactions have a refund status. They were kept but need checking."),
  ],
  [
    /^有 (\d+) 笔带退款\/退还状态，已保留但需要核对。$/,
    (count) =>
      plural(count, "# transaction has a refund or return status. It was kept but needs checking.", "# transactions have a refund or return status. They were kept but need checking."),
  ],
  [/^匹配范围超过 (\d+) 笔，历史重复检测仅覆盖最近部分记录。$/, "There are more than $1 entries to compare, so only the most recent ones were checked for duplicates."],
  [
    /^有 (\d+) 笔交易的来源身份已存在，导入时会跳过，不会重复写入。$/,
    (count) =>
      plural(
        count,
        "# transaction was already imported from the same source. It will be skipped, so nothing is added twice.",
        "# transactions were already imported from the same source. They will be skipped, so nothing is added twice.",
      ),
  ],
  [
    /^有 (\d+) 笔交易疑似重复，已标出但没有取消勾选。$/,
    (count) =>
      plural(count, "# transaction is a possible duplicate. It’s marked but still selected.", "# transactions are possible duplicates. They’re marked but still selected."),
  ],
  [
    /^这个文件在 (\S+) 已经导入过（(\d+) 笔），再次导入不会重复入账。$/,
    (date, count) => `This file was already imported on ${date} (${plural(count, "# entry", "# entries")}). Importing it again won’t add anything twice.`,
  ],

  // ---- 服务器：BOA 结单对账 ----
  [
    /^(存入|ATM 与借记卡支出|其他支出|服务费)在摘要页写 (\S+)、在明细末页写 (\S+)，两处合计不一致。$/,
    (section, summary, footer) =>
      `${BOA_SECTIONS[section] ?? section}: the summary page says ${summary} but the end of the details says ${footer}. The totals don’t match.`,
  ],
  [
    /^结单里没有(存入|ATM 与借记卡支出|其他支出|服务费)合计，但明细读到了 (\S+)，无法核对。$/,
    (section, sum) =>
      `The statement has no “${BOA_SECTIONS[section] ?? section}” total, but the details add up to ${sum}, so it can’t be reconciled.`,
  ],
  [
    /^(存入|ATM 与借记卡支出|其他支出|服务费)明细合计 (\S+) 与结单 (\S+) 不一致，请核对。$/,
    (section, sum, stated) =>
      `${BOA_SECTIONS[section] ?? section}: the details add up to ${sum}, but the statement says ${stated}. Please check.`,
  ],
  [
    /^明细合计与结单一致：存入 (\S+)、ATM (\S+)、其他 (\S+)、服务费 (\S+)。$/,
    "The details match the statement: deposits $1, ATM $2, other $3, service fees $4.",
  ],
  [
    /^期初 (\S+) \+ 存入 (\S+) - ATM (\S+) - 其他 (\S+) - 服务费 (\S+) = 期末 (\S+)，核对一致。$/,
    "Beginning balance $1 + deposits $2 − ATM $3 − other $4 − service fees $5 = ending balance $6. It reconciles.",
  ],
  [
    /^按明细计算期末应为 (\S+)，结单写的是 (\S+)，不一致，请核对。$/,
    "From the details, the ending balance should be $1, but the statement says $2. Please check.",
  ],
];

function matchPattern(message: string): string | null {
  for (const [pattern, replacement] of PATTERNS) {
    const match = pattern.exec(message);
    if (match === null) continue;
    if (typeof replacement === "string") return message.replace(pattern, replacement);
    return replacement(...match.slice(1).map((group) => group ?? ""));
  }
  return null;
}

const reported = new Set<string>();

export function translateSharedMessage(message: string): string {
  if (isChineseLocale()) return message;
  const exact = EXACT.get(message);
  if (exact !== undefined) return exact;
  const patterned = matchPattern(message);
  if (patterned !== null) return patterned;
  if (import.meta.env?.DEV === true && !reported.has(message)) {
    reported.add(message);
    console.warn(`[i18n] shared 提示没有译文：${message}`); // i18n-ignore：开发者日志
  }
  return message;
}

/** 测试用：查表是否命中（不看当前语言）。 */
export function hasSharedTranslation(message: string): boolean {
  return EXACT.has(message) || PATTERNS.some(([pattern]) => pattern.test(message));
}
