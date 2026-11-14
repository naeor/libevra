/**
 * **提示条队列规则**（1.19.66，方案 §2.3 的 R1–R7）。纯函数：不碰计时器、不碰 DOM，便于单测锁定。
 *
 * - R1 一次一条：同时只显示一条。
 * - R2 合并：与当前（或等待中）的提示 key 相同 → 原位更新（槽位不变、合并次数 +1），旧的那条以 `replaced` 结束。
 * - R3 抢占：新提示是错误或带操作 → 立即替换当前。被替换的若是未关闭的错误 → 放回等待位（错误不会悄悄消失）；
 *   被替换的若是带操作的提示 → 操作结束（`replaced`），不再恢复——每个带操作的调用点都有常设替代路径。
 * - R4 普通提示：当前没有或也是普通提示 → 立即替换；当前是错误或带操作 → 进等待位。
 * - R5 等待位只保留一条：错误优先于普通，同级留最新；普通消息最多等 3 秒、警告 6 秒，过期丢弃；错误不过期。
 * - R6 每条有唯一 id，计时按 id 管理（连续删除两笔时，第二条的计时重新开始）。
 * - R7 页面作用域的提示随发出者卸载撤下，不触发操作。
 * （R8 弹层与“+”菜单打开时让开，由控制器的暂停与宿主的显示判断实现。）
 */
import type { ToastEndReason, ToastOptions, ToastScope, ToastTone } from "./types.js";
import { waitLimitMs } from "./timing.js";

export interface QueueEntry<Leading = unknown> {
  readonly id: number;
  readonly slot: number;
  readonly revision: number;
  readonly createdAt: number;
  readonly key: string;
  readonly tone: ToastTone;
  readonly scope: ToastScope;
  readonly owner: symbol | null;
  readonly options: ToastOptions<Leading>;
}

export interface QueueState<Leading = unknown> {
  readonly current: QueueEntry<Leading> | null;
  readonly waiting: QueueEntry<Leading> | null;
}

export interface Ended<Leading = unknown> {
  readonly entry: QueueEntry<Leading>;
  readonly reason: ToastEndReason;
}

export interface QueueResult<Leading = unknown> {
  readonly state: QueueState<Leading>;
  readonly ended: readonly Ended<Leading>[];
}

export const EMPTY_QUEUE: QueueState<never> = { current: null, waiting: null };

/** 默认合并键：带操作的提示各自唯一；其余按类型 + 文字。 */
export function defaultKey(id: number, tone: ToastTone, options: Pick<ToastOptions, "key" | "action" | "text">): string {
  if (options.key !== undefined) return options.key;
  if (options.action !== undefined) return `#${String(id)}`;
  return `${tone}:${options.text}`;
}

/** 错误（非回声）：不自动消失，被替换时放回等待位。 */
export function isPersistentError(entry: QueueEntry<unknown>): boolean {
  return entry.tone === "error" && entry.options.echo !== true;
}

/** 抢占型：错误或带操作。 */
export function isUrgent(entry: QueueEntry<unknown>): boolean {
  return entry.tone === "error" || entry.options.action !== undefined;
}

/** 等待位的优先级：未关闭的错误 2、普通 1（带操作与回声错误不进等待位）。 */
function waitRank(entry: QueueEntry<unknown>): number {
  return isPersistentError(entry) ? 2 : 1;
}

/** 在等待位里的截止时间；`null` 表示不过期。 */
export function waitDeadline(entry: QueueEntry<unknown>): number | null {
  const limit = waitLimitMs(entry.tone);
  return limit === null || isPersistentError(entry) ? null : entry.createdAt + limit;
}

/** 把 `candidate` 放进等待位：与已有的比较，输掉的一条以 `expired` 结束。 */
function placeWaiting<L>(waiting: QueueEntry<L> | null, candidate: QueueEntry<L>, ended: Ended<L>[]): QueueEntry<L> {
  if (waiting === null) return candidate;
  const keepCandidate =
    waitRank(candidate) > waitRank(waiting) || (waitRank(candidate) === waitRank(waiting) && candidate.createdAt >= waiting.createdAt);
  ended.push({ entry: keepCandidate ? waiting : candidate, reason: "expired" });
  return keepCandidate ? candidate : waiting;
}

/** 新来一条（`entry.slot` 由调用方分配新槽位；合并时这里换成原槽位）。 */
export function enqueue<L>(state: QueueState<L>, entry: QueueEntry<L>): QueueResult<L> {
  const ended: Ended<L>[] = [];
  const current = state.current;
  let waiting = state.waiting;

  // R2：合并到当前这一条——原位更新。
  if (current !== null && current.key === entry.key) {
    ended.push({ entry: current, reason: "replaced" });
    return { state: { current: { ...entry, slot: current.slot, revision: current.revision + 1 }, waiting }, ended };
  }
  // R2：等待中的那一条与新来的同 key——旧的作废；新来的若本来也要进等待位，就直接顶替它。
  if (waiting !== null && waiting.key === entry.key) {
    ended.push({ entry: waiting, reason: "replaced" });
    waiting = null;
    if (current !== null && isUrgent(current) && !isUrgent(entry)) return { state: { current, waiting: entry }, ended };
  }

  if (current === null) return { state: { current: entry, waiting }, ended };

  // R3：错误或带操作，立即替换。
  if (isUrgent(entry)) {
    let nextWaiting = waiting;
    if (isPersistentError(current)) nextWaiting = placeWaiting(waiting, current, ended);
    else ended.push({ entry: current, reason: "replaced" });
    return { state: { current: entry, waiting: nextWaiting }, ended };
  }

  // R4：普通提示。
  if (!isUrgent(current)) {
    ended.push({ entry: current, reason: "replaced" });
    return { state: { current: entry, waiting }, ended };
  }
  return { state: { current, waiting: placeWaiting(waiting, entry, ended) }, ended };
}

/** 当前这一条结束后，把等待位里的提上来（过期的丢弃）。 */
function promote<L>(waiting: QueueEntry<L> | null, now: number, ended: Ended<L>[]): QueueState<L> {
  if (waiting === null) return { current: null, waiting: null };
  const deadline = waitDeadline(waiting);
  if (deadline !== null && now >= deadline) {
    ended.push({ entry: waiting, reason: "expired" });
    return { current: null, waiting: null };
  }
  return { current: waiting, waiting: null };
}

/** 结束 id 这一条（当前或等待中）。不存在时原样返回。 */
export function finish<L>(state: QueueState<L>, id: number, reason: ToastEndReason, now: number): QueueResult<L> {
  const ended: Ended<L>[] = [];
  if (state.current?.id === id) {
    ended.push({ entry: state.current, reason });
    return { state: promote(state.waiting, now, ended), ended };
  }
  if (state.waiting?.id === id) {
    ended.push({ entry: state.waiting, reason });
    return { state: { current: state.current, waiting: null }, ended };
  }
  return { state, ended };
}

/** R7：页面作用域的发出者卸载——撤下它发出的提示，不触发操作。 */
export function removeOwner<L>(state: QueueState<L>, owner: symbol, now: number): QueueResult<L> {
  const ended: Ended<L>[] = [];
  const owned = (entry: QueueEntry<L> | null): boolean => entry !== null && entry.scope === "page" && entry.owner === owner;
  let waiting = state.waiting;
  if (owned(waiting)) {
    ended.push({ entry: waiting!, reason: "unmounted" });
    waiting = null;
  }
  if (owned(state.current)) {
    ended.push({ entry: state.current!, reason: "unmounted" });
    return { state: promote(waiting, now, ended), ended };
  }
  return { state: { current: state.current, waiting }, ended };
}

/** R5：丢弃等待位里过期的提示。 */
export function expireWaiting<L>(state: QueueState<L>, now: number): QueueResult<L> {
  const waiting = state.waiting;
  if (waiting === null) return { state, ended: [] };
  const deadline = waitDeadline(waiting);
  if (deadline === null || now < deadline) return { state, ended: [] };
  return { state: { current: state.current, waiting: null }, ended: [{ entry: waiting, reason: "expired" }] };
}
