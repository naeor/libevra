/**
 * 批次内「疑似重复」检测（S15-B 第 6 层的前端部分）。
 *
 * 判定口径与 Python `dedupe.py` 的**图片内 / 跨图片**两条规则一致：金额、币种、
 * 收支方向、日期都相同；时间差在 60 秒以内（任一方没读出时间时视为弱证据，不否决）；
 * 商户文字足够相似；两张截图都读出交易单号且不同时，直接判定为不同交易。
 *
 * 为什么前端也要有一份：第一版批次数据只存在于浏览器 sessionStorage，没有数据库、
 * 没有新的批量接口；而用户在详情页改了金额或日期后，重复标记必须实时失效。Python 的
 * 实现继续作为离线验证/样本评估的参考口径，两边用同一组固定样本各自回归。
 *
 * 这不是“合并/删除”逻辑：只产出一个提示分组，是否两笔都导入由用户确认。
 */

import type { OcrBatchCandidate } from "./types.js";

/** 与 Python `dedupe.DUPLICATE_TIME_TOLERANCE_SECONDS` 相同。 */
export const DUPLICATE_TIME_TOLERANCE_SECONDS = 60;

/** 与 Python `dedupe.MERCHANT_SIMILARITY` 相同。 */
export const MERCHANT_SIMILARITY = 0.85;

export interface OcrDuplicateGroup {
  groupId: string;
  kind: "same-image" | "cross-image";
  candidateIds: string[];
  reason: string;
  message: string;
}

function amountValue(item: OcrBatchCandidate): number | null {
  if (item.amount === null) return null;
  const value = Number(item.amount.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
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

function timeToSeconds(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

function timesClose(left: string | null, right: string | null): boolean {
  const leftSeconds = timeToSeconds(left);
  const rightSeconds = timeToSeconds(right);
  if (leftSeconds === null || rightSeconds === null) return true;
  return Math.abs(leftSeconds - rightSeconds) <= DUPLICATE_TIME_TOLERANCE_SECONDS;
}

/** 两笔为什么像同一笔；`null` 表示不像。 */
export function duplicateReason(
  left: OcrBatchCandidate,
  right: OcrBatchCandidate,
): string | null {
  if (left.serial !== null && right.serial !== null) {
    if (left.serial !== right.serial) return null;
    if (left.amount !== right.amount) return "交易单号相同但金额不同，疑似同一笔，请核对";
    return "交易单号相同";
  }

  const leftAmount = amountValue(left);
  const rightAmount = amountValue(right);
  if (leftAmount === null || rightAmount === null || leftAmount !== rightAmount) return null;
  if (left.currency === null || right.currency === null || left.currency !== right.currency) {
    return null;
  }
  if (left.occurredLocalDate === null || right.occurredLocalDate === null) return null;
  if (left.occurredLocalDate !== right.occurredLocalDate) return null;
  if (left.direction === "unknown" || right.direction === "unknown") return null;
  if (left.direction !== right.direction) return null;
  if (!timesClose(left.occurredTime, right.occurredTime)) return null;
  if (!merchantsComparable(left.merchant, right.merchant)) return null;

  if (left.occurredTime === null || right.occurredTime === null) {
    return "金额、币种、方向、日期相同（时间缺失，可能无法区分同日多笔）";
  }
  return "金额、币种、方向、日期、时间都相同";
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
): OcrDuplicateGroup[] {
  const order = new Map(items.map((item, index) => [item.candidateId, index]));

  const sameImage: { left: string; right: string; reason: string }[] = [];
  const crossImage: { left: string; right: string; reason: string }[] = [];

  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex];
    if (left === undefined) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const right = items[rightIndex];
      if (right === undefined) continue;

      const reason = duplicateReason(left, right);
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
): { items: OcrBatchCandidate[]; groups: OcrDuplicateGroup[] } {
  const groups = findSuspectedDuplicates(items);
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
