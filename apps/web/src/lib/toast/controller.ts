/**
 * **应用级提示条控制器**（1.19.66）：队列（`queue.ts`）＋计时（`timing.ts`）＋暂停＋播报，不依赖 React 与 DOM。
 *
 * 挂在 `App.tsx` 原 `UndoProvider` 的位置（登录状态之内、路由与外壳之外），所以“删除一笔后返回列表时撤销仍在”
 * 这个性质不变。显示由每个外壳里的宿主（`components/toast/ToastViewport`）负责，它订阅这里的快照。
 *
 * 计时有两条：
 * - **停留计时**：任何暂停原因（悬停、焦点在提示里、页面切到后台、弹层或“+”菜单打开）成立时暂停；
 *   恢复时至少还剩 `resumeFloorMs`。错误没有停留计时。
 * - **可见计时**（`onSeen`）：只在真正出现在屏幕上时累计（不在让开、页面没有切到后台）；悬停、聚焦照常累计。
 */
import { ANNOUNCE_REPEAT_MS, dwellMs, resumeFloorMs } from "./timing.js";
import { defaultKey, enqueue, EMPTY_QUEUE, expireWaiting, finish, removeOwner, waitDeadline, type Ended, type QueueEntry, type QueueResult, type QueueState } from "./queue.js";
import type { ToastAnnouncement, ToastEndReason, ToastOptions, ToastPauseReason, ToastSnapshot, ToastView } from "./types.js";

export interface ToastClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_CLOCK: ToastClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export class ToastController<Leading = unknown> {
  private queue: QueueState<Leading> = EMPTY_QUEUE;
  private nextId = 1;
  private nextSlot = 1;
  private readonly pauses = new Set<ToastPauseReason>();
  /** 当前这一条的剩余停留时间；`null` = 不自动消失。 */
  private remaining: number | null = null;
  private runningSince: number | null = null;
  private seenMs = 0;
  private seenSince: number | null = null;
  private seenFired = false;
  private timer: unknown = null;
  private serial = 0;
  private announcement: ToastAnnouncement | null = null;
  /** 已经播报过的那一条（id + 合并次数），避免重复播报；同 key 1 秒内也只播一次。 */
  private announced: { readonly id: number; readonly revision: number } | null = null;
  private lastAnnounce: { readonly key: string; readonly at: number } | null = null;
  private snapshot: ToastSnapshot<Leading> = { current: null, visible: false, announcement: null };
  private readonly listeners = new Set<() => void>();
  /** 宿主登记的“现在该不该让开”判断：新提示进来时先问一次，弹层打开时新提示不会先播报再让开。 */
  private yieldProbe: (() => boolean) | null = null;
  /** 当前槽位第几次出现在屏幕上（让开后再出现要重播入场）。 */
  private appearance = 0;
  private lastSlot: number | null = null;
  private lastVisible = false;

  constructor(private readonly clock: ToastClock = REAL_CLOCK) {}

  // ---------------------------------------------------------------- 订阅

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ToastSnapshot<Leading> => this.snapshot;

  // ---------------------------------------------------------------- 调用接口

  /** 显示一条提示，返回它的 id。`owner` 只对页面作用域有意义（发出它的组件）。 */
  show(options: ToastOptions<Leading>, owner: symbol | null = null): number {
    if (this.yieldProbe !== null) {
      const yielded = this.yieldProbe();
      if (yielded !== this.pauses.has("yield")) {
        this.accrue(this.clock.now());
        if (yielded) this.pauses.add("yield");
        else this.pauses.delete("yield");
      }
    }
    const id = this.nextId++;
    const tone = options.tone ?? "info";
    const entry: QueueEntry<Leading> = {
      id,
      slot: this.nextSlot++,
      revision: 0,
      createdAt: this.clock.now(),
      key: defaultKey(id, tone, options),
      tone,
      scope: options.scope ?? "app",
      owner: (options.scope ?? "app") === "page" ? owner : null,
      options,
    };
    this.apply(() => enqueue(this.queue, entry));
    return id;
  }

  /** 调用方自己撤下（不触发操作）。 */
  dismiss(id: number, reason: ToastEndReason = "dismissed"): void {
    this.apply((now) => finish(this.queue, id, reason, now));
  }

  /** 用户点了 × 或按了 Esc。 */
  close(id: number): void {
    this.dismiss(id, "closed");
  }

  /** 用户点了操作：先让提示消失，再执行（与原撤销条一致）。 */
  runAction(id: number): void {
    const action = this.queue.current?.id === id ? this.queue.current.options.action : undefined;
    if (action === undefined) return;
    this.dismiss(id, "action");
    void action.run();
  }

  /** 页面作用域的发出者卸载。 */
  dismissOwner(owner: symbol): void {
    this.apply((now) => removeOwner(this.queue, owner, now));
  }

  /** 暂停原因成立 / 解除。 */
  setPause(reason: ToastPauseReason, on: boolean): void {
    if (this.pauses.has(reason) === on) return;
    const now = this.clock.now();
    this.accrue(now);
    const wasPaused = this.pauses.size > 0;
    if (on) this.pauses.add(reason);
    else this.pauses.delete(reason);
    // 恢复时至少还剩一段（方案 §2.4），避免焦点刚离开就消失。
    if (wasPaused && this.pauses.size === 0 && this.remaining !== null && this.queue.current !== null) {
      this.remaining = Math.max(this.remaining, resumeFloorMs(this.timingInput(this.queue.current)));
    }
    this.reschedule(now);
    this.maybeAnnounce(now);
    this.publish();
  }

  /** 宿主登记 / 注销让开判断。 */
  setYieldProbe(probe: (() => boolean) | null): void {
    this.yieldProbe = probe;
  }

  isPaused(reason: ToastPauseReason): boolean {
    return this.pauses.has(reason);
  }

  /** 测试与调试：当前剩余停留时间。 */
  remainingMs(): number | null {
    this.accrue(this.clock.now());
    return this.remaining;
  }

  // ---------------------------------------------------------------- 内部

  private timingInput(entry: QueueEntry<Leading>) {
    return { tone: entry.tone, text: entry.options.text, detail: entry.options.detail, hasAction: entry.options.action !== undefined, echo: entry.options.echo === true };
  }

  private get visible(): boolean {
    return this.queue.current !== null && !this.pauses.has("yield") && !this.pauses.has("hidden");
  }

  private apply(change: (now: number) => QueueResult<Leading>): void {
    const now = this.clock.now();
    this.accrue(now);
    const before = this.queue.current;
    const result = change(now);
    this.queue = result.state;
    const after = this.queue.current;
    if (after !== null && (before === null || before.id !== after.id)) this.startCurrent(after);
    else if (after === null && before !== null) this.clearCurrent();
    this.reschedule(now);
    this.maybeAnnounce(now);
    this.publish();
    this.notifyEnded(result.ended);
  }

  /** 新的当前条：计时从头开始（合并也是新 id，计时重置）。 */
  private startCurrent(entry: QueueEntry<Leading>): void {
    this.remaining = dwellMs(this.timingInput(entry));
    this.runningSince = null;
    this.seenMs = 0;
    this.seenSince = null;
    this.seenFired = false;
    // 焦点、悬停是对上一条的，不带给新的一条（被替换的元素不会再收到 pointerleave / focusout）。
    this.pauses.delete("hover");
    this.pauses.delete("focus");
  }

  private clearCurrent(): void {
    this.remaining = null;
    this.runningSince = null;
    this.seenSince = null;
    this.pauses.delete("hover");
    this.pauses.delete("focus");
  }

  private accrue(now: number): void {
    if (this.runningSince !== null && this.remaining !== null) {
      this.remaining = Math.max(0, this.remaining - (now - this.runningSince));
      this.runningSince = now;
    }
    if (this.seenSince !== null) {
      this.seenMs += now - this.seenSince;
      this.seenSince = now;
    }
  }

  private reschedule(now: number): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    const current = this.queue.current;
    const dwellRunning = current !== null && this.remaining !== null && this.pauses.size === 0;
    const seen = current?.options.onSeen;
    const seenRunning = current !== null && seen !== undefined && !this.seenFired && this.visible;
    this.runningSince = dwellRunning ? now : null;
    this.seenSince = seenRunning ? now : null;

    const deadlines: number[] = [];
    if (dwellRunning) deadlines.push(now + this.remaining!);
    if (seenRunning) deadlines.push(now + Math.max(0, seen.afterMs - this.seenMs));
    const waiting = this.queue.waiting === null ? null : waitDeadline(this.queue.waiting);
    if (waiting !== null) deadlines.push(waiting);
    if (deadlines.length === 0) return;
    const next = Math.min(...deadlines);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.tick();
    }, Math.max(0, next - now));
  }

  private tick(): void {
    const now = this.clock.now();
    this.accrue(now);
    const current = this.queue.current;
    const seen = current?.options.onSeen;
    if (current !== null && seen !== undefined && !this.seenFired && this.seenMs >= seen.afterMs) {
      this.seenFired = true;
      seen.run();
    }
    if (this.queue.current !== null && this.remaining !== null && this.remaining <= 0 && this.pauses.size === 0) {
      this.apply((at) => finish(this.queue, this.queue.current!.id, "timeout", at));
      return;
    }
    const expired = expireWaiting(this.queue, now);
    if (expired.ended.length > 0) {
      this.queue = expired.state;
      this.reschedule(now);
      this.publish();
      this.notifyEnded(expired.ended);
      return;
    }
    this.reschedule(now);
  }

  private maybeAnnounce(now: number): void {
    const current = this.queue.current;
    if (current === null || !this.visible) return;
    if (this.announced?.id === current.id && this.announced.revision === current.revision) return;
    this.announced = { id: current.id, revision: current.revision };
    if (current.options.announce === false) return;
    if (this.lastAnnounce !== null && this.lastAnnounce.key === current.key && now - this.lastAnnounce.at < ANNOUNCE_REPEAT_MS) return;
    this.lastAnnounce = { key: current.key, at: now };
    this.serial += 1;
    this.announcement = {
      serial: this.serial,
      text: current.options.text,
      politeness: current.tone === "error" && current.options.echo !== true ? "alert" : "status",
      tone: current.tone,
      detail: current.options.detail,
      actionLabel: current.options.action?.label,
    };
  }

  private publish(): void {
    const current = this.queue.current;
    const visible = this.visible;
    if (current === null) {
      this.lastSlot = null;
      this.appearance = 0;
    } else if (current.slot !== this.lastSlot) {
      this.lastSlot = current.slot;
      this.appearance = visible ? 1 : 0;
    } else if (visible && !this.lastVisible) {
      this.appearance += 1;
    }
    this.lastVisible = visible;
    const view: ToastView<Leading> | null =
      current === null
        ? null
        : {
            id: current.id,
            slot: current.slot,
            appearance: this.appearance,
            revision: current.revision,
            tone: current.tone,
            text: current.options.text,
            detail: current.options.detail,
            leading: current.options.leading,
            action: current.options.action,
            closable: current.tone === "error" || current.options.action !== undefined,
            echo: current.options.echo === true,
          };
    const previous = this.snapshot;
    const same =
      previous.visible === this.visible &&
      previous.announcement === this.announcement &&
      (previous.current === null
        ? view === null
        : view !== null && previous.current.id === view.id && previous.current.revision === view.revision && previous.current.appearance === view.appearance);
    if (same) return;
    this.snapshot = { current: view, visible: this.visible, announcement: this.announcement };
    for (const listener of [...this.listeners]) listener();
  }

  private notifyEnded(ended: readonly Ended<Leading>[]): void {
    for (const { entry, reason } of ended) entry.options.onEnd?.(reason);
  }
}
