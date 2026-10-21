/**
 * 批次内「疑似重复」检测（S15-B 第 6 层的前端部分）。
 *
 * **S15-E2 起，判定规则不再写在这里。** 金额、币种、收支方向、时间窗口、分类与
 * 支付方式全部交给共享核心 `@libellum/shared` 的 `evaluateDuplicatePair`；本文件是
 * **OCR 入口的适配层**，只保留 OCR 专属的两条前置条件：
 *
 *  - **交易单号**：双方都读出单号且不同 → 直接判定为不同交易；单号相同但金额不同 →
 *    仍然提示“疑似同一笔，请核对”；
 *  - **商户文字**：双方都读出商户且相似度低于 0.85 → 不提示（OCR 的文字差异不应
 *    把同一笔拆成两笔）。
 *
 * 分组（同图 / 跨图）与展示文案仍由本文件负责；它不产生任何写入决定。
 *
 * ⚠️ **与旧实现的有意差异**（详见 `docs/specs/features/S15-E2-统一重复检测规则-设计决定.md`）：
 *  - 时间按真实时间戳比较，因此 23:59:30 与次日 00:00:20 在 60 秒窗口内会命中，
 *    旧实现要求 `occurredLocalDate` 字符串相同；
 *  - 分类/支付方式按核心默认规则参与比较（双方都有且不同 → 不提示），
 *    旧实现完全不看；
 *  - 时间窗口与开关来自用户设置，不再是模块常量。
 */

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  decimalsFor,
  evaluateDuplicatePair,
  parseAmountToMinor,
  type DuplicateCandidateFields,
  type DuplicateDetectionSettings,
} from "@libellum/shared";

import type { OcrBatchCandidate } from "./types.js";

/** 默认时间窗口（秒）。保留导出是为了让旧测试/调用方仍能引用同一个数字。 */
export const DUPLICATE_TIME_TOLERANCE_SECONDS = 60;

/** 与 Python `dedupe.MERCHANT_SIMILARITY` 相同。 */
export const MERCHANT_SIMILARITY = 0.85;

/** 没有账本上下文（旧测试、极旧批次）时使用的占位账本键。 */
const OCR_BATCH_BOOK_ID = "ocr-batch";

export interface OcrDuplicateOptions {
  /** 用户设置；缺省用统一默认值（开启、60 秒、比较分类与支付方式）。 */
  readonly settings?: DuplicateDetectionSettings;
  /** 批次所属账本；同一批次内所有候选必须相同。 */
  readonly bookId?: string;
}

export interface OcrDuplicateGroup {
  groupId: string;
  kind: "same-image" | "cross-image";
  candidateIds: string[];
  reason: string;
  message: string;
}

function amountMinor(item: OcrBatchCandidate): number | null {
  if (item.amount === null || item.currency === null) return null;

  const normalized = item.amount.replace(/,/g, "").trim();
  if (normalized === "") return null;

  try {
    return parseAmountToMinor(normalized, decimalsFor(item.currency));
  } catch {
    // 金额无法用该币种的最小单位精确表示时，不猜、不按浮点近似。
    return null;
  }
}

/**
 * 把「本地日期 + HH:mm」变成带偏移的 ISO 时间戳。
 *
 * 浏览器知道这台设备的时区与夏令时规则；`Date` 的本地构造会把这些算进去，
 * `toISOString()` 再给出绝对时刻。日期/时间格式不合法或日历日不存在时返回 `null`
 * ——核心会把它记为“时间缺失”，而不是把中午 12:00 当成真实时间。
 */
function instantFromLocal(date: string | null, time: string | null): string | null {
  if (date === null || time === null) return null;

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (dateMatch === null || timeMatch === null) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute
  ) {
    return null;
  }

  return value.toISOString();
}

function toCoreCandidate(
  item: OcrBatchCandidate,
  bookId: string,
): DuplicateCandidateFields {
  const instant = instantFromLocal(item.occurredLocalDate, item.occurredTime);

  return {
    id: item.candidateId,
    bookId,
    kind: item.direction,
    amountCents: amountMinor(item),
    currency: item.currency,
    occurredAt: instant,
    occurredAtPrecision: instant === null ? "day" : "minute",
    occurredLocalDate: item.occurredLocalDate,
    categoryId: item.categoryId,
    paymentMethodId: item.paymentMethodId,
  };
}

function merchantKey(text: string | null): string {
  if (text === null) return "";
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z\u4e00-\u9fff]+/g, "");
}

/** Levenshtein distance, for the same 0.85 similarity floor Python uses. */
function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex] ?? 0;
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      previous[rightIndex] = Math.min(
        (previous[rightIndex - 1] ?? 0) + 1,
        above + 1,
        diagonal + cost,
      );
      diagonal = above;
    }
  }

  return previous[right.length] ?? 0;
}

function merchantsComparable(left: string | null, right: string | null): boolean {
  const leftKey = merchantKey(left);
  const rightKey = merchantKey(right);
  if (leftKey === "" || rightKey === "") return true;
  if (leftKey === rightKey) return true;
  if (
    leftKey.length >= 2 &&
    rightKey.length >= 2 &&
    (leftKey.includes(rightKey) || rightKey.includes(leftKey))
  ) {
    return true;
  }
  const longest = Math.max(leftKey.length, rightKey.length);
  return 1 - editDistance(leftKey, rightKey) / longest >= MERCHANT_SIMILARITY;
}

/**
 * 两笔为什么像同一笔；`null` 表示不像。
 *
 * 顺序：OCR 专属的“单号”前置 → 商户相似度 → 统一核心规则。核心返回的 `matched`
 * 已经包含金额/币种/方向/时间/分类/支付方式；这里只负责把结果翻译成批次界面用的
 * 中文说明。
 */
export function duplicateReason(
  left: OcrBatchCandidate,
  right: OcrBatchCandidate,
  options: OcrDuplicateOptions = {},
): string | null {
  const settings = options.settings ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS;

  // 关闭提醒时，连单号这种强证据也不提示：用户要的是“不打扰”。
  if (!settings.enabled) return null;

  if (left.serial !== null && right.serial !== null) {
    if (left.serial !== right.serial) return null;
    if (left.amount !== right.amount) return "交易单号相同但金额不同，疑似同一笔，请核对";
    return "交易单号相同";
  }

  if (!merchantsComparable(left.merchant, right.merchant)) return null;

  const bookId = options.bookId ?? OCR_BATCH_BOOK_ID;
  const result = evaluateDuplicatePair(
    toCoreCandidate(left, bookId),
    toCoreCandidate(right, bookId),
    settings,
  );

  if (!result.matched) return null;

  const leftInstant = instantFromLocal(left.occurredLocalDate, left.occurredTime);
  const rightInstant = instantFromLocal(right.occurredLocalDate, right.occurredTime);

  if (leftInstant === null || rightInstant === null) {
    return "金额、币种、方向、日期相同（时间缺失，可能无法区分同日多笔）";
  }
  if (left.occurredLocalDate === right.occurredLocalDate) {
    return "金额、币种、方向、日期、时间都相同";
  }

  const seconds =
    result.timeDifferenceSeconds === null ? 0 : Math.round(result.timeDifferenceSeconds);
  return `金额、币种、方向相同，时间相差 ${String(seconds)} 秒（跨日）`;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(node: string): string {
    const current = this.parent.get(node) ?? node;
    this.parent.set(node, current);
    if (current === node) return node;
    const root = this.find(current);
    this.parent.set(node, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
}

function groupsFromPairs(
  pairs: readonly { left: string; right: string; reason: string }[],
  kind: OcrDuplicateGroup["kind"],
  order: ReadonlyMap<string, number>,
): OcrDuplicateGroup[] {
  if (pairs.length === 0) return [];

  const forest = new UnionFind();
  for (const pair of pairs) forest.union(pair.left, pair.right);

  const members = new Map<string, string[]>();
  for (const pair of pairs) {
    for (const candidateId of [pair.left, pair.right]) {
      const root = forest.find(candidateId);
      const list = members.get(root) ?? [];
      if (!list.includes(candidateId)) list.push(candidateId);
      members.set(root, list);
    }
  }

  const groups: OcrDuplicateGroup[] = [];
  for (const list of members.values()) {
    const candidateIds = [...list].sort(
      (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
    );
    if (candidateIds.length < 2) continue;

    const reason =
      pairs.find(
        (pair) => candidateIds.includes(pair.left) && candidateIds.includes(pair.right),
      )?.reason ?? "特征相同";

    groups.push({
      groupId: `${kind === "same-image" ? "dup-same" : "dup-cross"}-${groups.length + 1}`,
      kind,
      candidateIds,
      reason,
      message:
        kind === "cross-image"
          ? "这些交易可能来自截图重叠或重复上传，被标记为可能重复，请核对后决定保留哪些。"
          : "同一张截图里出现了可能相同的交易，请核对是否为截图重叠或 OCR 重复。",
    });
  }

  return groups;
}

/** 批次内全部重复分组：先图片内，再跨图片。纯函数，不改输入。 */
export function findSuspectedDuplicates(
  items: readonly OcrBatchCandidate[],
  options: OcrDuplicateOptions = {},
): OcrDuplicateGroup[] {
  if (!(options.settings ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS).enabled) return [];

  const order = new Map(items.map((item, index) => [item.candidateId, index]));

  const sameImage: { left: string; right: string; reason: string }[] = [];
  const crossImage: { left: string; right: string; reason: string }[] = [];

  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex];
    if (left === undefined) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const right = items[rightIndex];
      if (right === undefined) continue;

      const reason = duplicateReason(left, right, options);
      if (reason === null) continue;

      const pair = { left: left.candidateId, right: right.candidateId, reason };
      if (left.imageIndex === right.imageIndex) sameImage.push(pair);
      else crossImage.push(pair);
    }
  }

  return [
    ...groupsFromPairs(sameImage, "same-image", order),
    ...groupsFromPairs(crossImage, "cross-image", order),
  ];
}

/**
 * 重新计算整批的重复标记，返回新数组（不修改传入对象）。
 *
 * 每次编辑候选后都调用，所以把金额改掉后“疑似重复”会立刻消失，不会留下过期提示。
 * 分组只用于展示，不进入 `issues`，因此不会在详情页里被当成“已修复的识别问题”。
 */
export function withDuplicateMarks(
  items: readonly OcrBatchCandidate[],
  options: OcrDuplicateOptions = {},
): { items: OcrBatchCandidate[]; groups: OcrDuplicateGroup[] } {
  const groups = findSuspectedDuplicates(items, options);
  const byCandidate = new Map<string, string[]>();

  for (const group of groups) {
    for (const candidateId of group.candidateIds) {
      const list = byCandidate.get(candidateId) ?? [];
      list.push(group.groupId);
      byCandidate.set(candidateId, list);
    }
  }

  return {
    items: items.map((item) => {
      const groupIds = byCandidate.get(item.candidateId) ?? [];
      return {
        ...item,
        duplicateSuspected: groupIds.length > 0,
        duplicateGroupIds: groupIds,
      };
    }),
    groups,
  };
}

/** 某一笔所属的重复分组，用于详情页说明“和哪几笔像”。 */
export function groupsForCandidate(
  groups: readonly OcrDuplicateGroup[],
  candidateId: string,
): OcrDuplicateGroup[] {
  return groups.filter((group) => group.candidateIds.includes(candidateId));
}
