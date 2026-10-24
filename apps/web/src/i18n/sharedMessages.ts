/**
 * **`@libellum/shared` 里写死的中文提示 → 当前界面语言。**
 *
 * shared 包同时被服务器和浏览器使用，它的 zod 校验信息、识别提示等是中文原文，服务器也会把同一句话
 * 原样放进错误响应。本轮不改 shared 的契约（API 文案不能因为翻译而变），所以在浏览器端按**原文**
 * 查表翻译：中文界面原样返回；英文界面查到就用英文，查不到就原样返回（并在开发环境告警，
 * 便于补齐）。带数字的句子用正则条目匹配。
 */
import { isChineseLocale } from "./index.js";

/** 原文完全相同才命中。 */
const EXACT: ReadonlyMap<string, string> = new Map<string, string>([]);

/** 含变量的原文：`$1`、`$2` 按捕获组替换。 */
const PATTERNS: readonly (readonly [RegExp, string])[] = [];

const reported = new Set<string>();

export function translateSharedMessage(message: string): string {
  if (isChineseLocale()) return message;
  const exact = EXACT.get(message);
  if (exact !== undefined) return exact;
  for (const [pattern, replacement] of PATTERNS) {
    if (pattern.test(message)) return message.replace(pattern, replacement);
  }
  if (import.meta.env?.DEV === true && !reported.has(message)) {
    reported.add(message);
    console.warn(`[i18n] shared 提示没有译文：${message}`);
  }
  return message;
}

/** 测试用：查表是否命中（不看当前语言）。 */
export function hasSharedTranslation(message: string): boolean {
  return EXACT.has(message) || PATTERNS.some(([pattern]) => pattern.test(message));
}
