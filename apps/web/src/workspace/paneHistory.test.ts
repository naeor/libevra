import { describe, expect, it } from "vitest";

import { entryFromPath, PaneHistory, type BrowserLike } from "./paneHistory.js";

/**
 * 一个只够用的假浏览器：一条历史栈 + popstate。`go` 像真浏览器一样异步触发 popstate，
 * 这里用 `flush()` 手动派发，测试里看得清先后。
 */
function fakeBrowser(initialPath = "/", initialState: unknown = null) {
  const stack: { state: unknown; url: string }[] = [{ state: initialState, url: initialPath }];
  let index = 0;
  const listeners = new Set<() => void>();
  let pending: number | null = null;
  const parse = (url: string) => {
    const parsed = new URL(url, "http://localhost");
    return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
  };
  const browser: BrowserLike & { stack: typeof stack; index: () => number; flush: () => void } = {
    stack,
    index: () => index,
    history: {
      get state() {
        return stack[index]?.state ?? null;
      },
      pushState(data, _unused, url) {
        stack.splice(index + 1);
        stack.push({ state: data, url: url ?? stack[index]!.url });
        index += 1;
      },
      replaceState(data, _unused, url) {
        stack[index] = { state: data, url: url ?? stack[index]!.url };
      },
      go(delta) {
        pending = delta;
      },
    },
    get location() {
      return parse(stack[index]!.url);
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    flush() {
      if (pending === null) return;
      const next = Math.min(stack.length - 1, Math.max(0, index + pending));
      pending = null;
      if (next === index) return;
      index = next;
      for (const listener of [...listeners]) listener();
    },
  };
  return browser;
}

describe("PaneHistory（内存模式：辅助工作区）", () => {
  it("第一页的 key 是 default，push / go(-1) 只在自己的栈里移动", () => {
    const history = new PaneHistory("w2", [entryFromPath("/workspace/start", "default")]);
    expect(history.location.key).toBe("default");
    history.push("/stats?range=month");
    expect(history.location.pathname).toBe("/stats");
    expect(history.location.search).toBe("?range=month");
    expect(history.canGoBack).toBe(true);
    history.go(-1);
    expect(history.location.pathname).toBe("/workspace/start");
    history.go(-1);
    expect(history.location.pathname).toBe("/workspace/start");
  });

  it("replace 不增加历史；相对路径按当前页解析", () => {
    const history = new PaneHistory("w2", [entryFromPath("/stats", "default")]);
    history.replace({ search: "?range=year" });
    expect(history.snapshot.length).toBe(1);
    expect(history.location.pathname).toBe("/stats");
    expect(history.location.search).toBe("?range=year");
  });

  it("外壳替换第一页时保留 default（页面的返回仍按「没有上一页」处理）", () => {
    const history = new PaneHistory("w2", [entryFromPath("/workspace/start", "default")]);
    history.open("/books/b1", { replace: true });
    expect(history.location.pathname).toBe("/books/b1");
    expect(history.location.key).toBe("default");
  });

  it("拦截器可以把 push 改送别处，本实例不动", () => {
    const history = new PaneHistory("w1", [entryFromPath("/", "default")]);
    const seen: string[] = [];
    history.setInterceptor(({ to }) => {
      seen.push(to.pathname);
      return to.pathname.startsWith("/transactions/");
    });
    history.push("/transactions/t1");
    expect(history.location.pathname).toBe("/");
    history.push("/stats");
    expect(history.location.pathname).toBe("/stats");
    expect(seen).toEqual(["/transactions/t1", "/stats"]);
  });

  it("reset 只留一页（换身份时辅助区不带上一个身份的页面）", () => {
    const history = new PaneHistory("w2", [entryFromPath("/", "default")]);
    history.push("/books/b1");
    history.reset("/workspace/start");
    expect(history.snapshot.length).toBe(1);
    expect(history.location.pathname).toBe("/workspace/start");
    expect(history.location.key).toBe("default");
  });

  it("序列化只保存路径与 key，恢复后位置一致", () => {
    const history = new PaneHistory("w2", [entryFromPath("/", "default")]);
    history.push("/stats");
    history.push("/me");
    history.go(-1);
    const restored = PaneHistory.restore("w2", history.serialize(), "/");
    expect(restored.location.pathname).toBe("/stats");
    expect(restored.snapshot.length).toBe(3);
    expect(restored.serialize()).toEqual(history.serialize());
  });
});

describe("PaneHistory（拥有地址栏：主工作区）", () => {
  it("载入时以地址栏为准，状态格式与 React Router 相同（usr / key / idx）", () => {
    const browser = fakeBrowser("/stats?range=month");
    const history = new PaneHistory("w1", [entryFromPath("/", "default")]);
    history.adopt(browser);
    expect(history.location.pathname).toBe("/stats");
    expect(history.location.key).toBe("default");
    expect(browser.history.state).toEqual({ idx: 0 });

    history.push("/transactions/t1", { from: "/stats" });
    expect(browser.stack.at(-1)?.url).toBe("/transactions/t1");
    const state = browser.history.state as { usr: unknown; key: string; idx: number };
    expect(state.idx).toBe(1);
    expect(state.usr).toEqual({ from: "/stats" });
    expect(state.key).toBe(history.location.key);
  });

  it("页面内返回交给浏览器后退（地址栏与栈一起退）", () => {
    const browser = fakeBrowser("/");
    const history = new PaneHistory("w1", [entryFromPath("/", "default")]);
    history.adopt(browser);
    history.push("/stats");
    history.go(-1);
    expect(history.location.pathname).toBe("/stats"); // 等待浏览器的 popstate
    browser.flush();
    expect(history.location.pathname).toBe("/");
    expect(browser.index()).toBe(0);
  });

  it("浏览器返回键：认识的记录对齐位置，不认识的记录以地址栏重新开始", () => {
    const browser = fakeBrowser("/");
    const history = new PaneHistory("w1", [entryFromPath("/", "default")]);
    history.adopt(browser);
    history.push("/stats");
    history.push("/me");
    browser.history.go(-1);
    browser.flush();
    expect(history.location.pathname).toBe("/stats");
    expect(history.snapshot.index).toBe(1);
  });

  it("晋升为主区后（takeOver），按返回回到自己的上一页，而不是原主区的页面", () => {
    const browser = fakeBrowser("/");
    const primary = new PaneHistory("w1", [entryFromPath("/", "default")]);
    primary.adopt(browser);
    primary.push("/stats");

    const secondary = new PaneHistory("w2", [entryFromPath("/workspace/start", "default")]);
    secondary.push("/me");
    secondary.push("/settings/appearance/language");

    primary.detach();
    secondary.takeOver(browser);
    expect(browser.location.pathname).toBe("/settings/appearance/language");

    secondary.go(-1);
    // 不经过浏览器（那条记录属于原主区）：在内存里后退，并改写当前地址。
    expect(secondary.location.pathname).toBe("/me");
    expect(browser.location.pathname).toBe("/me");
    expect(browser.stack.length).toBe(2);

    // 原主区不再响应地址栏变化。
    browser.history.go(-1);
    browser.flush();
    expect(primary.location.pathname).toBe("/stats");
  });

  it("浏览器回到另一实例写过的记录时，以地址栏重新开始而不是错位", () => {
    const browser = fakeBrowser("/");
    const primary = new PaneHistory("w1", [entryFromPath("/", "default")]);
    primary.adopt(browser);
    primary.push("/stats");
    const secondary = new PaneHistory("w2", [entryFromPath("/me", "default")]);
    primary.detach();
    secondary.takeOver(browser);

    browser.history.go(-1);
    browser.flush();
    expect(secondary.location.pathname).toBe("/");
    expect(secondary.snapshot.length).toBe(1);
  });

  it("刷新后页面里的「返回」交给浏览器后退（与原来的 BrowserRouter 相同，不改写当前记录）", () => {
    const browser = fakeBrowser("/", { usr: null, key: "k0", idx: 0 });
    browser.history.pushState({ usr: { from: "/" }, key: "k1", idx: 1 }, "", "/stats");
    browser.history.pushState({ usr: null, key: "k2", idx: 2 }, "", "/me");
    // 刷新：会话里保存过栈，但载入时只认地址栏这一页。
    const history = new PaneHistory("w1", [entryFromPath("/", "k0"), entryFromPath("/stats", "k1"), entryFromPath("/me", "k2")]);
    history.adopt(browser);
    expect(history.location.pathname).toBe("/me");
    expect(history.location.key).toBe("k2");

    history.go(-1);
    browser.flush();
    expect(history.location.pathname).toBe("/stats");
    expect(history.location.state).toEqual({ from: "/" });
    expect(browser.stack.length).toBe(3);
    expect(browser.index()).toBe(1);

    history.go(-1);
    browser.flush();
    expect(history.location.pathname).toBe("/");
    expect(browser.stack.map((entry) => entry.url)).toEqual(["/", "/stats", "/me"]);
  });

  it("浏览器拒绝写历史时（非序列化错误）改为整页导航，自己的栈不动", () => {
    const browser = fakeBrowser("/");
    const assigned: string[] = [];
    const failing: BrowserLike = {
      ...browser,
      history: {
        get state() {
          return browser.history.state;
        },
        pushState() {
          throw new Error("SecurityError: too many calls");
        },
        replaceState: (data, unused, url) => {
          browser.history.replaceState(data, unused, url);
        },
        go: (delta) => {
          browser.history.go(delta);
        },
      },
      location: {
        get pathname() {
          return browser.location.pathname;
        },
        get search() {
          return browser.location.search;
        },
        get hash() {
          return browser.location.hash;
        },
        assign: (url: string) => {
          assigned.push(url);
        },
      },
      addEventListener: (type, listener) => {
        browser.addEventListener(type, listener);
      },
      removeEventListener: (type, listener) => {
        browser.removeEventListener(type, listener);
      },
    };
    const history = new PaneHistory("w1", [entryFromPath("/", "default")]);
    history.adopt(failing);
    history.push("/stats");
    expect(assigned).toEqual(["/stats"]);
    expect(history.location.pathname).toBe("/");
    expect(history.canGoBack).toBe(false);
  });

  it("导航通知区分页面发起与浏览器返回", () => {
    const browser = fakeBrowser("/");
    const history = new PaneHistory("w1", [entryFromPath("/", "default")]);
    history.adopt(browser);
    const sources: string[] = [];
    history.onNavigate((navigation) => sources.push(`${navigation.action}:${navigation.source}`));
    history.push("/stats");
    browser.history.go(-1);
    browser.flush();
    expect(sources).toEqual(["PUSH:app", "POP:browser"]);
  });
});
