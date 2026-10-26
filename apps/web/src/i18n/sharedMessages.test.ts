import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  DUPLICATE_SCOPE_LABELS,
  EXPORT_COLUMNS,
  INVITE_REJECTION_MESSAGE,
  NOT_DUPLICATE_DECISION_SOURCE_LABELS,
  OCR_CHANNEL_LABELS,
  OCR_DIRECTION_LABELS,
  OCR_PAGE_TYPE_LABELS,
  RANGE_LABELS,
  UNCATEGORISED_NAME,
  describeDuplicateMatch,
  evaluateDuplicatePair,
  parseTransactionText,
  passwordSchema,
  recoverDuplicateDetectionSettings,
  statsQuerySchema,
  validateDuplicateDetectionSettings,
  type DuplicateCandidateFields,
} from "@libellum/shared";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "./index.js";
import { hasSharedTranslation, translateSharedMessage } from "./sharedMessages.js";

/**
 * S16：`@libellum/shared` 与服务器写死的中文提示在英文界面下的译文。
 *
 * 1. **扫描 shared 源码**：把会显示给用户的中文字面量（模板字符串按示例值展开）全部找出来，
 *    逐条要求有译文。shared 新增一句提示却没写译文，这里就会失败。
 * 2. **服务器原样返回的提示**（校验兜底句、CSV 导入逐行错误、账单导入提示与对账说明）：
 *    服务器源码里的句子结构多样，这里用按源码整理的示例句逐条核对。
 * 3. **真实输出**：调用 shared 的函数 / schema，确认实际产生的句子在英文下没有残留中文。
 */

const SHARED_SRC = fileURLToPath(new URL("../../../../packages/shared/src/", import.meta.url));
const CJK = /[㐀-鿿豈-﫿]/u;

/** shared 每个源文件的处理方式。新增文件必须在这里归类（见最后一条测试）。 */
const FULL_FILES = [
  "admin.ts",
  "auth.ts",
  "billImport.ts",
  "calendarHeatmap.ts",
  "categorySeries.ts",
  "duplicateDetection.ts",
  "duplicateReview.ts",
  "export.ts",
  "fx.ts",
  "fxHistory.ts",
  "health.ts",
  "index.ts",
  "invites.ts",
  "ledger.ts",
  "ledgerImport.ts",
  "messages.ts",
  "money.ts",
  "multiMonthComparison.ts",
  "notDuplicateRelations.ts",
  "ocr.ts",
  "periodComparison.ts",
  "profile.ts",
  "refs.ts",
  "spreadsheet.ts",
  "stats.ts",
  "timeCalendar.ts",
  "timeSeries.ts",
  "version.ts",
  "voiceParsing.ts",
  "weekdayPattern.ts",
] as const;
/** 识别规则文件：大量中文是关键词（不翻译），只检查以“。”结尾的提示句。 */
const SENTENCE_FILES = ["categoryMatch.ts", "chineseNumerals.ts", "speech.ts", "transactionText.ts"] as const;
/** 不经过本表的文件：预置名称走 `lib/presetNames.ts`；公告走 `i18n/content/`，法律文本不翻译。 */
const EXCLUDED_FILES = ["consent.ts", "presets.ts", "avatarIds.ts", "rewards.ts"] as const;

/** 不是界面文字的中文：导出文件表头（文件格式不随语言变化）、系统分类的名字（数据）。 */
const NOT_UI_TEXT = new Set<string>([...EXPORT_COLUMNS.map((column) => column.header), UNCATEGORISED_NAME]);

// ---------------------------------------------------------------------------
// 一个够用的 TS 词法扫描：跳过注释与正则字面量，取出字符串与模板字符串。
// ---------------------------------------------------------------------------

interface Literal {
  readonly text: string;
  readonly template: boolean;
}

function scanQuoted(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length && source[index] !== quote) index += source[index] === "\\" ? 2 : 1;
  return index;
}

function scanBraces(source: string, open: number): number {
  let depth = 0;
  let index = open;
  while (index < source.length) {
    const char = source[index]!;
    if (char === '"' || char === "'") index = scanQuoted(source, index, char);
    else if (char === "`") index = scanTemplate(source, index);
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return index;
}

function scanTemplate(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\") index += 2;
    else if (char === "`") return index;
    else if (char === "$" && source[index + 1] === "{") index = scanBraces(source, index + 1) + 1;
    else index += 1;
  }
  return index;
}

function scanRegex(source: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < source.length && source[index] !== "\n") {
    const char = source[index]!;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) return index;
    index += 1;
  }
  return index;
}

function regexAllowedAfter(source: string, index: number, previous: string): boolean {
  if (previous === "" || "(,=:[!&|?{};+-*%<>~^".includes(previous)) return true;
  return /(?:^|[^\w$])(?:return|typeof|case|void|in|of|delete|throw|yield|await)\s*$/.test(
    source.slice(Math.max(0, index - 16), index),
  );
}

function stringLiterals(source: string): Literal[] {
  const literals: Literal[] = [];
  let previous = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      index = end < 0 ? source.length : end;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
    } else if (char === '"' || char === "'") {
      const end = scanQuoted(source, index, char);
      literals.push({ text: source.slice(index + 1, end), template: false });
      index = end + 1;
      previous = char;
    } else if (char === "`") {
      const end = scanTemplate(source, index);
      literals.push({ text: source.slice(index + 1, end), template: true });
      index = end + 1;
      previous = char;
    } else if (char === "/" && regexAllowedAfter(source, index, previous)) {
      index = scanRegex(source, index) + 1;
      previous = "/";
    } else {
      if (!/\s/.test(char)) previous = char;
      index += 1;
    }
  }
  return literals;
}

/** 模板字符串里的 `${…}` 换成示例值：候选金额、字段清单、设置项名或数字。 */
function instantiate(template: string): string {
  let out = "";
  let index = 0;
  while (index < template.length) {
    if (template[index] === "$" && template[index + 1] === "{") {
      const end = scanBraces(template, index + 1);
      const expression = template.slice(index + 2, end).trim();
      if (/alternatives/.test(expression)) out += "38、40";
      else if (/join\(|checked|Summary/.test(expression)) out += "金额、币种";
      else if (/^(?:field|key)$/.test(expression)) out += "enabled";
      else out += "8";
      index = end + 1;
    } else {
      out += template[index];
      index += 1;
    }
  }
  return out;
}

function userVisibleSharedMessages(): Map<string, string> {
  const found = new Map<string, string>();
  const collect = (file: string, onlySentences: boolean): void => {
    for (const literal of stringLiterals(readFileSync(path.join(SHARED_SRC, file), "utf8"))) {
      if (!CJK.test(literal.text)) continue;
      const sample = literal.template ? instantiate(literal.text) : literal.text;
      if (onlySentences && !sample.endsWith("。")) continue;
      if (NOT_UI_TEXT.has(sample)) continue;
      found.set(sample, file);
    }
  };
  for (const file of FULL_FILES) collect(file, false);
  for (const file of SENTENCE_FILES) collect(file, true);
  return found;
}

const sharedMessages = userVisibleSharedMessages();

/** 服务器原样返回、界面会显示的提示（按服务器源码整理的示例句，变量用 ASCII 示例值）。 */
const SERVER_MESSAGES: readonly string[] = [
  // lib/errors.ts、routes/books.ts、routes/lifecycle.ts：校验信息
  "请求参数不合法",
  "给账号编号或用户名，二选一。",
  "账号编号应为 8 位数字",
  "账本编号应为 8 位数字",
  // routes/import.ts：CSV / XLSX 导入逐行错误
  "日期格式应为 YYYY-MM-DD。",
  "「2026-02-30」不是一个真实日期。",
  "时间格式应为 HH:mm。",
  "「12.3.4」不是有效金额。",
  "金额超出可记录的上限。",
  "不支持的币种「XYZ」，可用：CNY / USD / EUR / JPY / HKD / GBP。",
  "无法识别的类型「foo」，应为「支出」或「收入」。",
  "分类「Coffee」不存在。请先在应用里创建它，或把它改成一个已有分类。",
  "支付方式「Card」不存在。",
  // import/service.ts：逐笔核对问题与整份文件提示
  "提交前需要处理：金额格式不正确，无法转换为最小单位。",
  "提交前需要处理：分类「Coffee」已归档。",
  "不支持的币种「XYZ」。",
  "金额格式不正确，无法转换为最小单位。",
  "收支方向未确定，请选择收入或支出。",
  "日期不是有效的 YYYY-MM-DD。",
  "时间不是有效的 HH:mm 或 HH:mm:ss。",
  "只解析到日期的交易不能带时间。",
  "时区「Mars/Base」无效。",
  "这个账本缺少对应方向的系统分类，无法导入。",
  "所选分类不存在或已被删除。",
  "分类「Coffee」已归档。",
  "分类「Coffee」与收支方向不一致。",
  "所选支付方式不存在或已被删除。",
  "支付方式「Card」已归档。",
  "无法把日期时间换算为绝对时间。",
  "这个文件在 2026-10-20 已经导入过（12 笔），再次导入不会重复入账。",
  "这个文件在 2026-10-20 已经导入过（1 笔），再次导入不会重复入账。",
  "文件指纹与已有导入记录 IMP-20261020-ABCD 相同，导入时会跳过。",
  "结单对账不一致，确认导入前需要先核对对账信息。",
  // import/alipay.ts、import/wechat.ts
  "第 12 行的交易时间或金额无法识别，已跳过。",
  "这笔在支付宝里标记为「不计收支」，默认不导入。",
  "这笔在微信里标记为「不计收支」，默认不导入。",
  "交易状态为「closed」，默认不导入。",
  "收支方向「/」无法识别，默认不导入。",
  "收支方向「空」无法识别，默认不导入。",
  "交易状态为「refunded」，已保留原方向，请核对是否计入。",
  "未找到匹配的支付方式「Card」，导入后需手动选择。",
  "文件只提供日期，时间按当天 00:00 记录。",
  "这笔没有交易单号，已按文件位置生成来源编号；换一份导出可能无法识别为同一笔。",
  "说明区记录共 20 笔，实际识别 19 笔，请核对文件是否完整。",
  "已默认排除 3 笔不计收支/关闭交易，可在核对页逐笔勾选。",
  "已默认排除 1 笔不计收支/关闭交易，可在核对页逐笔勾选。",
  "有 2 行无法识别交易时间或金额，已跳过。",
  "有 1 笔带退款状态，已保留但需要核对。",
  "有 4 笔带退款/退还状态，已保留但需要核对。",
  // import/libevra.ts
  "第 7 行的日期、金额或币种无法识别，已跳过。",
  "类型「transfer」无法识别，默认不导入。",
  "时间无法识别，已按当天 00:00 处理。",
  "分类「Coffee」不在账本中，导入时将使用系统分类。",
  "支付方式「Card」不在账本中，导入后需手动选择。",
  "有 2 行日期/金额无法识别，已跳过。",
  // import/boa.ts
  "第 3 页有一笔交易无法判断所属分区，已按金额方向导入。",
  "结单只提供过账日期，时间按当天 00:00 记录。",
  "描述里出现日期 10/03（可能是消费日期），与过账日期 2026-10-04 不同；本行按过账日期入账，请核对。",
  "描述里含 REFUND/RETURN，请核对这笔是否为退款。",
  "这笔金额为 0.00，请核对。",
  "有 2 行描述换行，已拼接到上一笔交易。",
  "有 1 行日期或金额无法识别，已跳过。",
  "存入在摘要页写 $1,234.56、在明细末页写 $1,234.00，两处合计不一致。",
  "结单里没有服务费合计，但明细读到了 $-12.00，无法核对。",
  "ATM 与借记卡支出明细合计 $-300.00 与结单 $-310.00 不一致，请核对。",
  "明细合计与结单一致：存入 $1,000.00、ATM $-200.00、其他 $-50.00、服务费 $0.00。",
  "没有读到期初或期末余额，无法完成「期初 + 存入 - 支出 = 期末」核对。",
  "期初 $100.00 + 存入 $1,000.00 - ATM $200.00 - 其他 $50.00 - 服务费 $0.00 = 期末 $850.00，核对一致。",
  "按明细计算期末应为 $850.00，结单写的是 $860.00，不一致，请核对。",
  // import/duplicates.ts
  "文件内第 4 行使用了相同的来源身份，这一笔会被跳过。",
  "来源单号已存在（交易 #42，2026-10-01），这一笔会被跳过。",
  "来源单号已存在（交易 #42，2026-10-01，已删除），这一笔会被跳过。",
  "流水编号对应的交易 #42 已在本账本中，这一笔会被跳过。",
  "匹配范围超过 5000 笔，历史重复检测仅覆盖最近部分记录。",
  "候选配对数量较大，本次重复检测未覆盖所有组合；请缩小文件范围后继续核对。",
  "与文件内第 9 行疑似重复，请核对。",
  "与账本已有交易 #42（2026-10-01 38.00 CNY）疑似重复，请核对。",
  "有 3 笔交易的来源身份已存在，导入时会跳过，不会重复写入。",
  "有 1 笔交易疑似重复，已标出但没有取消勾选。",
];

function candidate(id: string, overrides: Partial<DuplicateCandidateFields> = {}): DuplicateCandidateFields {
  return {
    id,
    bookId: "book-1",
    kind: "expense",
    amountCents: 3800,
    currency: "CNY",
    occurredAt: "2026-10-20T12:00:00+08:00",
    occurredLocalDate: "2026-10-20",
    categoryId: "c-food",
    paymentMethodId: "p-wechat",
    ...overrides,
  };
}

/** 调用 shared 实际产生的提示句。 */
function realSharedOutputs(): string[] {
  const out: string[] = [];
  const settings = { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS };
  const pairs: [DuplicateCandidateFields, DuplicateCandidateFields][] = [
    [candidate("a"), candidate("b", { occurredAt: "2026-10-20T12:00:20+08:00" })],
    [candidate("a"), candidate("b", { occurredAt: null, categoryId: null })],
    [candidate("a"), candidate("b", { amountCents: 3900 })],
    [candidate("a"), candidate("b", { occurredAt: "2026-10-21T12:00:00+08:00" })],
    [candidate("a"), candidate("b", { kind: "income" })],
  ];
  for (const [left, right] of pairs) {
    const result = evaluateDuplicatePair(left, right, settings);
    out.push(result.reason, describeDuplicateMatch(result), ...result.rules.map((rule) => rule.detail));
  }
  const off = evaluateDuplicatePair(candidate("a"), candidate("b"), { ...settings, enabled: false });
  out.push(off.reason, describeDuplicateMatch(off));

  for (const input of [
    { enabled: "yes", unknownThing: 1, timeWindowSeconds: 0.5 },
    { ...settings, timeWindowSeconds: 0 },
    { ...settings, timeWindowSeconds: 99_999_999 },
    { matchCategory: true },
    null,
  ]) {
    const validation = validateDuplicateDetectionSettings(input);
    if (!validation.ok) out.push(...validation.issues.map((issue) => issue.message));
  }
  for (const issue of recoverDuplicateDetectionSettings({ legacy: true, timeWindowSeconds: 0 }).issues) out.push(issue.message);
  for (const issue of recoverDuplicateDetectionSettings("nope").issues) out.push(issue.message);

  const now = new Date("2026-10-25T10:00:00+08:00");
  for (const text of ["午饭", "38 或 40 块", "周三 打车 25", "10月3日 收到退款 12", "转账给小王 200", "下午 买菜 30 美元"]) {
    for (const issue of parseTransactionText(text, { now }).issues) out.push(issue.message);
  }

  const password = passwordSchema.safeParse("a");
  if (!password.success) out.push(...password.error.issues.map((issue) => issue.message));
  const stats = statsQuerySchema.safeParse({ from: "2020-01-01", to: "2026-01-01", currency: "CNY" });
  if (!stats.success) out.push(...stats.error.issues.map((issue) => issue.message));

  out.push(
    ...Object.values(INVITE_REJECTION_MESSAGE),
    ...Object.values(OCR_CHANNEL_LABELS),
    ...Object.values(OCR_PAGE_TYPE_LABELS),
    ...Object.values(OCR_DIRECTION_LABELS),
    ...Object.values(RANGE_LABELS),
    ...Object.values(NOT_DUPLICATE_DECISION_SOURCE_LABELS),
    ...Object.values(DUPLICATE_SCOPE_LABELS),
  );
  return out.filter((message) => message !== "");
}

afterEach(() => {
  applyLocale("zh-CN");
});

describe("shared 提示的译文", () => {
  it("扫描本身是有效的（防止词法扫描失效后测试空转）", () => {
    expect(sharedMessages.size).toBeGreaterThan(100);
    expect(sharedMessages.has("请填写昵称")).toBe(true);
    expect(sharedMessages.has("密码至少 8 位")).toBe(true);
    expect(sharedMessages.has("金额、币种均相同。")).toBe(true);
    expect(sharedMessages.has("没有说明年份，已按当前年份推算，请核对日期。")).toBe(true);
    // 关键词与文件表头不算界面提示。
    expect(sharedMessages.has("花了")).toBe(false);
    expect(sharedMessages.has("流水编号")).toBe(false);
  });

  it("shared 里每一句界面提示都有英文", () => {
    const missing = [...sharedMessages].filter(([message]) => !hasSharedTranslation(message)).map(([message, file]) => `${file}: ${message}`);
    expect(missing).toEqual([]);
  });

  it("shared 的每个源文件都已归类（新增文件不会被漏查）", () => {
    const classified = new Set<string>([...FULL_FILES, ...SENTENCE_FILES, ...EXCLUDED_FILES]);
    const files = readdirSync(SHARED_SRC).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(files.filter((name) => !classified.has(name))).toEqual([]);
  });

  it("服务器原样返回的提示都有英文", () => {
    expect(SERVER_MESSAGES.filter((message) => !hasSharedTranslation(message))).toEqual([]);
  });

  it("英文下没有残留中文，中文下原样返回", () => {
    const all = [...sharedMessages.keys(), ...SERVER_MESSAGES, ...realSharedOutputs()];
    applyLocale("en-US");
    const leaked = all.map((message) => [message, translateSharedMessage(message)] as const).filter(([, text]) => CJK.test(text));
    expect(leaked).toEqual([]);
    applyLocale("zh-CN");
    expect(all.filter((message) => translateSharedMessage(message) !== message)).toEqual([]);
  });

  it("带数字、清单与单复数的句子按英文语法拼出", () => {
    applyLocale("en-US");
    expect(translateSharedMessage("密码至少 8 位")).toBe("Passwords must be at least 8 characters");
    expect(translateSharedMessage("统计区间最长 366 天")).toBe("The period can be at most 366 days");
    expect(translateSharedMessage("金额、币种、收支方向、时间均相同。")).toBe("Amount, currency, type and time all match.");
    expect(translateSharedMessage("金额、币种均相同。")).toBe("Amount and currency both match.");
    expect(translateSharedMessage("金额均相同。")).toBe("Amount matches.");
    expect(translateSharedMessage("时间窗口不能小于 1 秒。")).toBe("The time window can’t be shorter than 1 second.");
    expect(translateSharedMessage("实际时间相差 12.5 秒，在 60 秒窗口内。")).toBe(
      "The times are 12.5 seconds apart, within the 60-second window.",
    );
    expect(translateSharedMessage("金额、币种相同；时间、分类缺失，按较弱依据提示。")).toBe(
      "Amount and currency match; time and category are missing, so this is a weaker match.",
    );
    expect(translateSharedMessage("文中出现多个可能的金额（38、40），请选择实际金额。")).toBe(
      "There are several possible amounts (38, 40). Choose the actual amount.",
    );
    expect(translateSharedMessage("有 1 笔交易疑似重复，已标出但没有取消勾选。")).toBe(
      "1 transaction is a possible duplicate. It’s marked but still selected.",
    );
    expect(translateSharedMessage("有 3 笔交易疑似重复，已标出但没有取消勾选。")).toBe(
      "3 transactions are possible duplicates. They’re marked but still selected.",
    );
    expect(translateSharedMessage("提交前需要处理：分类「餐饮」已归档。")).toBe("Fix before submitting: Category “餐饮” is archived.");
    expect(translateSharedMessage("存入在摘要页写 $1,234.56、在明细末页写 $1,234.00，两处合计不一致。")).toBe(
      "Deposits and other additions: the summary page says $1,234.56 but the end of the details says $1,234.00. The totals don’t match.",
    );
  });

  it("查不到的句子原样返回（不吞掉信息）", () => {
    applyLocale("en-US");
    expect(translateSharedMessage("一句没有收录的新提示")).toBe("一句没有收录的新提示");
    expect(hasSharedTranslation("一句没有收录的新提示")).toBe(false);
  });
});
