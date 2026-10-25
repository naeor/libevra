import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { recordBackPress } from "./backFallback.js";

/**
 * ⚠️ **`useOnlineStatus` used to live here, and it was deleted rather than kept.**
 *
 * It read `navigator.onLine`, which is a *guess* — and the wrong thing to base a decision on.
 * It says online in a lift, on a train, and on a Wi-Fi network whose router has stopped
 * forwarding; the app therefore waited, failed, and showed nothing while a good copy of the
 * ledger sat on the device.
 *
 * The owner's rule replaced it: **offline when either the browser says so or a request failed
 * to get an answer**, and online again only once the browser agrees *and* a request has
 * succeeded. That lives in `offline/connectivity.ts`, as one shared state, so every screen
 * gives the same answer.
 *
 * **Deleted, not deprecated**: nothing imported it any more, and a second way to ask "are we
 * online" is how two screens come to disagree about the answer.
 */

/**
 * ⚠️ **How a 返回 control decides where it goes.**
 *
 * * `history` — the default, and what every screen but two uses: back returns to the screen the
 *   reader actually came from, with the declared origin and then `backTo` as the fallbacks;
 * * `parent` — 父级是声明的那个（不按来路推断），返回时**把这一页自己的历史记录消耗掉**：
 *   有上一条就 pop，深链才 `replace` 到 `backTo`。只有账本设置与账本导入用（见 `useGoBack`）。
 *
 * ⚠️ **The default is `history`, deliberately**: a screen that forgets to choose keeps the
 * behaviour it had before this type existed. Only an explicit `backMode="parent"` changes anything.
 */
export type BackMode = "history" | "parent";

/**
 * ⚠️ **`parent` 模式的返回该做哪种动作，作为一个纯函数**（S15-C 第四轮）。
 *
 * 本仓库没有 DOM，`useGoBack` 里的分支无法靠渲染断言，所以"pop 还是 replace"这条规则
 * 单独抽出来，测试可以直接调用它。
 *
 * * **有上一条历史 → `pop`**：正常入口下，上一条就是声明的父级（账本设置总是从账本详情进来）；
 *   pop 会把这一页自己的记录一起消耗掉，不给后面的页面留下一条可以弹回去的"影子"。
 * * **会话第一条（`"default"`，即直接打开地址）→ `replace`**：没有上一条可回，
 *   就用声明的父级把自己换掉，而不是把父级再 push 一遍。
 */
export function parentBackAction(key: string): "pop" | "replace" {
  return key === "default" ? "replace" : "pop";
}

/**
 * Go back to wherever the user actually came from.
 *
 * The screens below the tabs are reachable from more than one place — 分类管理
 * is linked from 我的, and the same kind of link could appear in 设置. Sending
 * everyone to one fixed parent means somebody always lands somewhere they did
 * not come from, which reads as a bug even though the data is fine.
 *
 * React Router marks the first entry of the session with the key `"default"`;
 * there is nothing to go back to in that case, so the fallback is used — which
 * matters for a deep link opened directly.
 *
 * ⚠️ **⚠️ `location.state.from` wins over history, and the owner reported the bug that proves why**
 * (2026-10-13):
 *
 * > *"点击关于 libellum 时会出现那个经典的老 bug：从关于退出会进到设置，从设置退出又会回到关于界面."*
 *
 * ⚠️ **The bounce is a history loop, and it is not a mistake in any one screen.** 关于's `backTo` is
 * `/settings`; 设置 is reached from 我的. So 我的 → 设置 → 关于 → *back* goes to 设置, and 设置's own back
 * goes to 我的… **but when 关于 is opened from a *third* place, the two screens point at each other and
 * pressing back walks a circle.** The start page's footer was exactly that third place, and the owner
 * asked for it explicitly: *"从开始界面直接进入关于界面时，点击返回是返回开始界面."*
 *
 * ⚠️ **Why the origin has to be declared rather than inferred.** History knows *where you were*, not
 * *where you meant to return to* — for a screen reachable from several places, those are different
 * questions. `state.from` is the caller answering the second one, **and it is what makes 关于's back
 * deterministic instead of a function of how the reader arrived.**
 *
 * ⚠️ **Plain `navigate` here, not `navigate(-1)` and not `replace`.** Going back to a declared parent
 * is a real move: it should be a history entry, and the reader can then go forward again. Replacing
 * would erase the screen they came from.
 */
export function useGoBack(fallback: string, mode: BackMode = "history"): () => void {
  const navigate = useNavigate();
  const location = useLocation();

  /** ⚠️ Read defensively: this state is set by callers, and an untyped `unknown` must not crash a screen. */
  const declared = (location.state as { from?: unknown } | null)?.from;
  const from = typeof declared === "string" ? declared : null;

  return useCallback(() => {
    // Five presses in a row with nothing else touched: the user is stuck
    // rather than navigating, so send them somewhere real instead of letting
    // them bounce between two screens.
    if (recordBackPress()) {
      void navigate("/", { replace: true });
      return;
    }

    /**
      * ⚠️ **`parent` 模式：离开这一页，并把它的历史记录一起消耗掉**（S15-C，第四轮修正机制）。
      *
      * ⚠️ **它要解决的第一个循环是 导出 ⇄ 账本设置。** 设置 → 导出 pushes 导出; 导出's back used
      * history and returned to 设置; 设置's back then used history too, and the entry behind it *was*
      * 导出 — 两页于是可以走成环，和 关于/设置 在 `state.from` 之前一模一样。
      * **A screen whose parent never changes must not derive its parent from where the reader
      * happened to come from** — 所以这里不问"来路"，父级是声明的那个。
      *
      * ⚠️ **`location.state.from` 在这里被有意忽略**：那是调用方为它即将打开的页面声明来路；
      * `parent` 模式声明的是层级固定，接受别人的来路会把变化重新引进来。
      *
      * ⚠️ **第二版用 `replace` 把这一页换成父级，仍然会绕回**（2026-10-21，账本导入报告的循环）。
      * `replace` 不缩短历史，只把当前这一条改个地址：账本详情 → 设置(push) → 导入(push)，
      * 导入返回 push 一条设置，设置返回 replace 成详情——**详情脚下那条正是还没被消耗的导入页**，
      * 详情一按 `-1` 就回到导入。所以：
      *
      * * 有上一条历史就 **`navigate(-1)`**：pop 连同这一页的记录一起消耗，正常入口下落的正是
      *   账本详情（设置只从详情、或从它自己的子页进来；子页排在它前面，不在它后面）；
      * * 自己是会话第一条（深链）时才用声明的父级 **`replace`** 掉自己。
      *
      * ⚠️ **逃生口仍排在前面**，因为卡在一对互相返回的页面上的人依然需要一条出路。
      */
    if (mode === "parent") {
      if (parentBackAction(location.key) === "pop") {
        void navigate(-1);
        return;
      }
      void navigate(fallback, { replace: true });
      return;
    }

    /**
      * ⚠️ **A declared origin is used before history**, because the reader has already told us where
      * this screen was opened from — see the note above about the 关于/设置 loop.
      */
    if (from !== null) {
      void navigate(from);
      return;
    }

    if (location.key !== "default") {
      void navigate(-1);
      return;
    }

    /**
      * ⚠️ **会话第一条（深链 / 刷新）→ 用声明的父级 `replace` 自己，不是 push。**
      *
      * push 会留下「偏好 → 设置」这条记录；设置自己的返回走 `-1`，正好落回偏好，
      * 而偏好（会话第一条）的返回又会 push 设置——两屏来回走圈，正是所有者报过的那类
      * "返回总是在两个界面卡死"（2026-10-25 发布后由 `navigation-back-verify.mjs` 复现）。
      * replace 不给自己留影子，也如实回答"深链没有可回的历史"。
      */
    void navigate(fallback, { replace: true });
  }, [navigate, location.key, fallback, from, mode]);
}
