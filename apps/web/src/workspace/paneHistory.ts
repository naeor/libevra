/**
 * **S18：一个工作区实例自己的浏览历史。**
 *
 * 大屏上同时存在主工作区与辅助工作区，它们渲染**同一套页面与路由**，但必须各自拥有：当前页面、
 * 返回历史、查询参数（筛选）与导航动作。浏览器只有一条地址栏与一条历史栈，所以：
 *
 * - **地址栏只属于主工作区**（`attach` 之后的那一个实例）。它的 push / replace 同步写进
 *   `window.history`，浏览器返回键与系统返回手势走的也是它；与原来的 `BrowserRouter` 写法一致
 *   （`{ usr, key, idx }` 状态格式相同），所以刷新、深链与手机端行为保持不变。
 * - **辅助工作区只在内存里维护自己的历史**（未 `attach`），不写地址栏，不和主区抢浏览器返回键。
 * - **角色转换**（原辅助区晋升为主区）时，新的主区用 `takeOver` 把自己的当前页写进**当前这一条**
 *   浏览器记录（`replaceState`），不会改写或删除浏览器里更早的记录。
 *
 * ⚠️ **页面内的「返回」只走本实例自己的栈。** 每条记录记住「它是否直接压在上一条之上被写进了浏览器」
 * （`linked`）：是 → 交给浏览器 `history.go(-1)`，地址栏与栈同步后退；否（例如晋升前在内存里走过的
 * 记录）→ 在内存里后退并 `replaceState` 当前地址。这样晋升后的工作区按返回仍回到**它自己**上一页，
 * 而不是原主区的页面。
 *
 * ⚠️ **第一条记录的 key 是 `"default"`**（与 React Router 一致），`useGoBack` 据此判断「没有上一页，
 * 使用页面声明的上级」。
 *
 * 本模块不依赖 React，也不直接读全局 `window`（通过 `BrowserLike` 注入），所以可以在 node 测试里用
 * 假的浏览器对象完整验证。
 */
import { createPath, parsePath, type NavigateOptions, type Navigator, type Path, type To } from "react-router";

export type PaneAction = "POP" | "PUSH" | "REPLACE";

export interface PaneEntry {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly state: unknown;
  readonly key: string;
}

export interface PaneSnapshot {
  readonly location: PaneEntry;
  readonly action: PaneAction;
  readonly index: number;
  readonly length: number;
}

/** 本实例收到的一次导航（供工作区判断「用户是否在辅助区主动操作」）。 */
export interface PaneNavigation {
  readonly action: PaneAction;
  readonly location: PaneEntry;
  /** `app`：页面或外壳调用 push / replace / go；`browser`：浏览器返回键 / 手势。 */
  readonly source: "app" | "browser";
}

/** 主区 push 前的拦截（跟随模式把详情改送到辅助区）。返回 `true` 表示已在别处处理，本实例不再导航。 */
export type PaneInterceptor = (request: { readonly kind: "push"; readonly to: PaneEntry; readonly from: PaneEntry }) => boolean;

export interface BrowserLike {
  readonly history: {
    readonly state: unknown;
    pushState(data: unknown, unused: string, url?: string): void;
    replaceState(data: unknown, unused: string, url?: string): void;
    go(delta: number): void;
  };
  readonly location: {
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
    /** 写不进历史时的整页导航兜底（与 React Router 相同）。 */
    assign?(url: string): void;
  };
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

/** 可序列化的历史（会话内恢复用）：不保存 `state`，那可能是文件或其它不可序列化的对象。 */
export interface SerializedPaneHistory {
  readonly entries: readonly { readonly path: string; readonly key: string }[];
  readonly index: number;
}

interface BrowserState {
  readonly usr?: unknown;
  readonly key?: string | undefined;
  readonly idx?: number | undefined;
}

function readBrowserState(value: unknown): BrowserState {
  if (value === null || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    usr: record["usr"],
    key: typeof record["key"] === "string" ? record["key"] : undefined,
    idx: typeof record["idx"] === "number" ? record["idx"] : undefined,
  };
}

export function createKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function entryPath(entry: Pick<PaneEntry, "pathname" | "search" | "hash">): string {
  return createPath({ pathname: entry.pathname, search: entry.search, hash: entry.hash });
}

/** 把一个路径字符串变成记录（新 key）；`key` 传 `"default"` 表示这一工作区的第一页。 */
export function entryFromPath(path: string, key: string = createKey(), state: unknown = null): PaneEntry {
  const parsed = parsePath(path);
  return {
    pathname: parsed.pathname ?? "/",
    search: parsed.search ?? "",
    hash: parsed.hash ?? "",
    state,
    key,
  };
}

function resolveEntry(current: PaneEntry, to: To, state: unknown): PaneEntry {
  const partial: Partial<Path> = typeof to === "string" ? parsePath(to) : to;
  const pathname = partial.pathname ?? current.pathname;
  return {
    pathname: pathname.startsWith("/") ? pathname : `/${pathname}`,
    search: partial.search ?? "",
    hash: partial.hash ?? "",
    state: state ?? null,
    key: createKey(),
  };
}

export class PaneHistory implements Navigator {
  readonly id: string;
  private entries: PaneEntry[];
  /** `linked[i]`：第 i 条是在本实例拥有地址栏时直接压在第 i-1 条之上写进浏览器的。 */
  private linked: boolean[];
  private index: number;
  private action: PaneAction = "POP";
  private current: PaneSnapshot;
  private readonly listeners = new Set<(snapshot: PaneSnapshot) => void>();
  private readonly navigationListeners = new Set<(navigation: PaneNavigation) => void>();
  private browser: BrowserLike | null = null;
  /** 当前记录在浏览器栈里的位置（`state.idx`），仅在拥有地址栏时有意义。 */
  private browserIndex = 0;
  /** 第一条记录之前，浏览器里是否还有本应用的记录（刷新后的情形）。 */
  private browserBehind = false;
  private interceptor: PaneInterceptor | null = null;

  constructor(id: string, entries: readonly PaneEntry[], index = entries.length - 1) {
    this.id = id;
    this.entries = entries.length === 0 ? [entryFromPath("/", "default")] : [...entries];
    this.linked = this.entries.map(() => false);
    this.index = Math.min(Math.max(index, 0), this.entries.length - 1);
    this.current = this.makeSnapshot();
  }

  // ---------------------------------------------------------------------------
  // 读
  // ---------------------------------------------------------------------------

  get snapshot(): PaneSnapshot {
    return this.current;
  }

  get location(): PaneEntry {
    return this.current.location;
  }

  get attached(): boolean {
    return this.browser !== null;
  }

  /** 本实例自己的栈里能否后退（不含浏览器里属于别的实例的记录）。 */
  get canGoBack(): boolean {
    return this.index > 0;
  }

  subscribe = (listener: (snapshot: PaneSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onNavigate(listener: (navigation: PaneNavigation) => void): () => void {
    this.navigationListeners.add(listener);
    return () => {
      this.navigationListeners.delete(listener);
    };
  }

  setInterceptor(interceptor: PaneInterceptor | null): void {
    this.interceptor = interceptor;
  }

  serialize(): SerializedPaneHistory {
    return { entries: this.entries.map((entry) => ({ path: entryPath(entry), key: entry.key })), index: this.index };
  }

  static restore(id: string, saved: SerializedPaneHistory | null | undefined, fallbackPath: string): PaneHistory {
    if (saved === null || saved === undefined || saved.entries.length === 0) {
      return new PaneHistory(id, [entryFromPath(fallbackPath, "default")]);
    }
    const entries = saved.entries.map((entry) => entryFromPath(entry.path, entry.key));
    return new PaneHistory(id, entries, saved.index);
  }

  // ---------------------------------------------------------------------------
  // Navigator（React Router 通过它导航）
  // ---------------------------------------------------------------------------

  createHref = (to: To): string => (typeof to === "string" ? to : createPath(to));

  encodeLocation = (to: To): Path => {
    const href = typeof to === "string" ? to : createPath(to);
    const url = new URL(href.replace(/ $/, "%20"), "http://localhost");
    return { pathname: url.pathname, search: url.search, hash: url.hash };
  };

  push = (to: To, state?: unknown, _opts?: NavigateOptions): void => {
    const next = resolveEntry(this.location, to, state);
    if (this.interceptor !== null && this.interceptor({ kind: "push", to: next, from: this.location })) return;
    this.pushEntry(next);
  };

  replace = (to: To, state?: unknown, _opts?: NavigateOptions): void => {
    const next = resolveEntry(this.location, to, state);
    if (!this.writeBrowser("replace", next, this.browserIndex)) return;
    this.entries[this.index] = next;
    this.commit("REPLACE", "app");
  };

  go = (delta: number): void => {
    if (delta === 0 || !Number.isFinite(delta)) return;
    const target = this.index + delta;

    if (this.browser === null) {
      if (target < 0 || target >= this.entries.length) return;
      this.index = target;
      this.commit("POP", "app");
      return;
    }

    if (target < 0) {
      // 本实例的栈到底了：只有刷新前留下的本应用记录才交给浏览器后退。
      if (this.index === 0 && this.browserBehind) this.browser.history.go(delta);
      return;
    }
    if (target >= this.entries.length) {
      this.browser.history.go(delta);
      return;
    }

    const step = delta < 0 ? -1 : 1;
    let allLinked = true;
    for (let i = this.index; i !== target; i += step) {
      const upper = step < 0 ? i : i + 1;
      if (this.linked[upper] !== true) allLinked = false;
    }

    if (allLinked) {
      // 浏览器会触发 popstate，再由 `handlePop` 对齐位置。
      this.browser.history.go(delta);
      return;
    }

    const entry = this.entries[target] as PaneEntry;
    if (!this.writeBrowser("replace", entry, this.browserIndex)) return;
    this.index = target;
    this.commit("POP", "app");
  };

  /** 外壳直接打开某页（辅助区导航、拖入、跟随）：与 push 相同，但不经过拦截器。 */
  open(path: string, options: { readonly replace?: boolean; readonly state?: unknown } = {}): void {
    if (options.replace === true) {
      // 替换的是这个工作区的第一页时保留 `"default"`：页面的「返回」仍按「没有上一页，回到声明的上级」处理。
      const key = this.location.key === "default" ? "default" : createKey();
      const next = entryFromPath(path, key, options.state ?? null);
      if (!this.writeBrowser("replace", next, this.browserIndex)) return;
      this.entries[this.index] = next;
      this.commit("REPLACE", "app");
      return;
    }
    this.pushEntry(entryFromPath(path, createKey(), options.state ?? null));
  }

  /** 清空本实例的历史，只留一页（退出登录 / 换账号时，辅助区不能带着上一个身份的页面）。 */
  reset(path: string): void {
    this.entries = [entryFromPath(path, "default")];
    this.linked = [false];
    this.index = 0;
    this.commit("REPLACE", "app", false);
  }

  // ---------------------------------------------------------------------------
  // 地址栏归属
  // ---------------------------------------------------------------------------

  /**
   * **页面载入时**接管地址栏：地址栏就是真相，只保留地址栏这一页。
   *
   * ⚠️ 刷新前的记录仍在浏览器自己的历史栈里（同样的 `{ usr, key, idx }`），所以页面里的「返回」在这里交给
   * 浏览器后退——与原来的 `BrowserRouter` 完全相同；退回到的那一页由 `handlePop` 按地址栏重新建立。
   * 不用会话里保存的栈去猜浏览器栈的形状：猜错一次就会把当前记录改写成别的页面。
   */
  adopt(browser: BrowserLike): void {
    this.detach();
    const state = readBrowserState(browser.history.state);
    const url = browser.location;
    const here: PaneEntry = {
      pathname: url.pathname || "/",
      search: url.search,
      hash: url.hash,
      state: state.usr ?? null,
      key: state.key ?? "default",
    };
    this.entries = [here];
    this.linked = [false];
    this.index = 0;

    if (state.idx === undefined) {
      browser.history.replaceState({ ...(browser.history.state as object | null), idx: 0 }, "");
      this.browserIndex = 0;
    } else {
      this.browserIndex = state.idx;
    }
    this.browserBehind = this.index === 0 && this.browserIndex > 0;
    this.bind(browser);
    this.commit("POP", "browser", false);
  }

  /** **角色转换时**接管地址栏：把本实例的当前页写进浏览器的当前这一条记录。 */
  takeOver(browser: BrowserLike): void {
    this.detach();
    const state = readBrowserState(browser.history.state);
    this.browserIndex = state.idx ?? 0;
    this.linked = this.entries.map(() => false);
    this.browserBehind = false;
    const entry = this.entries[this.index] as PaneEntry;
    this.bind(browser);
    this.writeBrowser("replace", entry, this.browserIndex);
  }

  detach(): void {
    if (this.browser === null) return;
    this.browser.removeEventListener("popstate", this.handlePop);
    this.browser = null;
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private bind(browser: BrowserLike): void {
    this.browser = browser;
    browser.addEventListener("popstate", this.handlePop);
  }

  private handlePop = (): void => {
    const browser = this.browser;
    if (browser === null) return;
    const state = readBrowserState(browser.history.state);
    const key = state.key ?? "default";
    const found = key === "default" ? -1 : this.entries.findIndex((entry) => entry.key === key);

    if (found >= 0) {
      this.index = found;
      if (state.idx !== undefined) this.browserIndex = state.idx;
      this.commit("POP", "browser");
      return;
    }

    // 浏览器回到了本实例不认识的记录（另一实例晋升前的页面，或刷新前的页面）：以地址栏为准重新开始。
    const url = browser.location;
    this.entries = [{ pathname: url.pathname || "/", search: url.search, hash: url.hash, state: state.usr ?? null, key }];
    this.linked = [false];
    this.index = 0;
    this.browserIndex = state.idx ?? 0;
    this.browserBehind = this.browserIndex > 0;
    this.commit("POP", "browser");
  };

  private pushEntry(next: PaneEntry): void {
    // 先写浏览器、成功后再改自己的栈：写失败（iOS 的 pushState 频率限制等）时页面与地址栏不会错位。
    if (!this.writeBrowser("push", next, this.browserIndex + 1)) return;
    this.entries = this.entries.slice(0, this.index + 1);
    this.linked = this.linked.slice(0, this.index + 1);
    this.entries.push(next);
    this.linked.push(this.browser !== null);
    this.index += 1;
    if (this.browser !== null) this.browserIndex += 1;
    this.commit("PUSH", "app");
  }

  /**
   * 拥有地址栏时写浏览器历史；不拥有时什么都不做。返回 `false` 表示没有写进去（这次导航已改为整页导航或放弃），
   * 调用方不应再改自己的栈。与 React Router 相同：`DataCloneError`（状态不可序列化）照常抛出，其它错误整页导航。
   */
  private writeBrowser(kind: "push" | "replace", entry: PaneEntry, idx: number): boolean {
    const browser = this.browser;
    if (browser === null) return true;
    const data: BrowserState = { usr: entry.state, key: entry.key, idx };
    try {
      if (kind === "push") browser.history.pushState(data, "", entryPath(entry));
      else browser.history.replaceState(data, "", entryPath(entry));
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "DataCloneError") throw error;
      browser.location.assign?.(entryPath(entry));
      return false;
    }
  }

  private makeSnapshot(): PaneSnapshot {
    return {
      location: this.entries[this.index] as PaneEntry,
      action: this.action,
      index: this.index,
      length: this.entries.length,
    };
  }

  private commit(action: PaneAction, source: "app" | "browser", notifyNavigation = true): void {
    this.action = action;
    this.current = this.makeSnapshot();
    for (const listener of [...this.listeners]) listener(this.current);
    if (!notifyNavigation) return;
    const navigation: PaneNavigation = { action, location: this.current.location, source };
    for (const listener of [...this.navigationListeners]) listener(navigation);
  }
}
