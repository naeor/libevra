import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { t } from "../i18n/index.js";
import { ToastController, type ToastClock } from "../lib/toast/controller.js";
import type { ToastEndReason } from "../lib/toast/types.js";

/**
 * 「获得新头像」通知（S16-H）1.19.66 起走统一提示条。原横幅的约束在这里逐条守住：
 * - **先展示、后确认**：可见累计满 4 秒才回报已读；“+”菜单展开（宿主让开）期间不计时；
 * - 被别的提示替换、或离开明细页时没看够 4 秒，不回报（下次同步仍会再来）；
 * - 点「查看」或 × 立即回报；多个事件合并成一条；
 * - 控制器本身不渲染任何东西（外观、位置、让开都由统一提示条负责）。
 * 浏览器里的完整交互由 `tools/e2e/avatar-rewards-verify.mjs` 覆盖（需要测试夹具）。
 */
vi.mock("../lib/avatarRewards.js", () => ({
  AVATAR_REWARDS_QUERY_KEY: ["avatar-rewards"],
  useAvatarRewards: () => ({ data: { pendingEvents: [{ id: "event-1", avatarId: "descent-special" }] } }),
  confirmAvatarRewardEvents: () => Promise.resolve(),
}));

import { AVATAR_REWARD_SEEN_MS, AvatarRewardNotice, avatarRewardToast } from "./AvatarRewardNotice.js";
import { ToastProvider } from "./toast/ToastProvider.js";

class FakeClock implements ToastClock {
  time = 0;
  private timers: { at: number; run: () => void; id: number }[] = [];
  private seq = 0;
  now = (): number => this.time;
  setTimeout = (run: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.push({ at: this.time + ms, run, id });
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = due.at;
      due.run();
    }
    this.time = end;
  }
}

const one = [{ id: "event-1", avatarId: "descent-special" as const }];
const two = [...one, { id: "event-2", avatarId: "descent-special" as const }];

function setup(events = one) {
  const clock = new FakeClock();
  const controller = new ToastController<React.ReactNode>(clock);
  const confirm = vi.fn<(ids: readonly string[]) => void>();
  const view = vi.fn();
  const options = avatarRewardToast(events, t, { confirm, view });
  return { clock, controller, confirm, view, options };
}

describe("AvatarRewardNotice（统一提示条）", () => {
  it("控制器本身不渲染任何东西", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ToastProvider>
            <AvatarRewardNotice />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(html).toBe("");
  });

  it("交给提示条的选项：信息类型、页面作用域、固定 key、头像作前置图、「查看」操作", () => {
    const { options } = setup();
    expect(options).toMatchObject({ tone: "info", scope: "page", key: "avatar-reward" });
    expect(options.text).toContain("获得新头像");
    expect(options.leading).toBeTruthy();
    expect(options.action?.label).toBe(t("rewards.banner.cta"));
    expect(options.onSeen?.afterMs).toBe(AVATAR_REWARD_SEEN_MS);
    expect(AVATAR_REWARD_SEEN_MS).toBe(4_000);
  });

  it("多个事件合并成一条，显示数量", () => {
    const { options } = setup(two);
    expect(options.text).toBe(t("rewards.banner.multipleTitle", { count: 2 }));
  });

  it("可见满 4 秒才回报已读；之后提示仍停留到时间", () => {
    const { clock, controller, confirm, options } = setup();
    controller.show(options);
    clock.advance(3_999);
    expect(confirm).not.toHaveBeenCalled();
    clock.advance(1);
    expect(confirm).toHaveBeenCalledWith(["event-1"]);
    expect(controller.getSnapshot().current).not.toBeNull();
    clock.advance(6_000);
    expect(controller.getSnapshot().current).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("“+”菜单展开（宿主让开）期间不计入可见时间", () => {
    const { clock, controller, confirm, options } = setup();
    controller.show(options);
    clock.advance(2_000);
    controller.setPause("yield", true);
    clock.advance(30_000);
    expect(confirm).not.toHaveBeenCalled();
    controller.setPause("yield", false);
    clock.advance(2_000);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("没看够 4 秒就被替换或离开页面：不回报", () => {
    const replaced = setup();
    replaced.controller.show(replaced.options);
    replaced.clock.advance(1_000);
    replaced.controller.show({ text: "已删除这笔记账", action: { label: "撤销", run: () => undefined, alternative: "编辑历史" } });
    replaced.clock.advance(20_000);
    expect(replaced.confirm).not.toHaveBeenCalled();

    const left = setup();
    const page = Symbol("detail");
    left.controller.show(left.options, page);
    left.clock.advance(1_000);
    left.controller.dismissOwner(page);
    left.clock.advance(20_000);
    expect(left.confirm).not.toHaveBeenCalled();
  });

  it("点 × 或「查看」立即回报；查看还会进入头像页", () => {
    const closed = setup();
    const id = closed.controller.show(closed.options);
    closed.controller.close(id);
    expect(closed.confirm).toHaveBeenCalledWith(["event-1"]);

    const viewed = setup();
    const viewId = viewed.controller.show(viewed.options);
    viewed.controller.runAction(viewId);
    expect(viewed.confirm).toHaveBeenCalledWith(["event-1"]);
    expect(viewed.view).toHaveBeenCalledTimes(1);
  });

  it("其余结束方式不回报", () => {
    for (const reason of ["timeout", "replaced", "expired", "unmounted", "dismissed"] as ToastEndReason[]) {
      const { confirm, options } = setup();
      options.onEnd?.(reason);
      expect(confirm).not.toHaveBeenCalled();
    }
  });
});
