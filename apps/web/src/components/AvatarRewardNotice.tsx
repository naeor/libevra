/**
 * 首页「获得新头像」通知（S16 头像奖励系统；1.19.66 起走统一提示条）。
 *
 * 原来是底栏容器里绝对定位的品牌深色横幅（五套提示实现之一），现在只是一个**无界面的控制器**：有待通知事件时
 * 交给 `useToast()`，外观、位置、让开、播报都由统一提示条负责（所有者决定第 19 条）。
 *
 * 保留的约束（所有者原话归纳）：
 *   - 轻量、非模态，在底部导航之上，不遮住「+」与导航按钮（宿主量底栏、“+”与账本胶囊决定位置）；
 *   - 一次只出现一条：单款显示头像名，多款显示数量（同一个 key，新事件到来时原位更新）；
 *   - **先展示、后确认**：只有真的出现在屏幕上**累计满 4 秒**（`onSeen`：弹层或“+”菜单打开让开时、页面切到后台时不计），
 *     或用户点了「查看」/ 关了它，才回报确认；被别的提示替换、或离开明细页时没看够 4 秒就**不**回报，下次同步仍会再来；
 *   - **「+」入口菜单打开时让开**：记一笔菜单展开时宿主让所有提示退场并暂停（`data-toast-yield`），收起后再出现。
 *
 * 停留时长按带操作的提示（10 秒，悬停 / 聚焦暂停）；“已读”仍在可见满 4 秒时回报，与原来同一时点。
 * 只在明细首页挂载（页面作用域）：离开明细首页即撤下。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { useI18n } from "../i18n/index.js";
import { AVATAR_REWARDS_QUERY_KEY, confirmAvatarRewardEvents, useAvatarRewards } from "../lib/avatarRewards.js";
import type { AvatarRewardEvent } from "@libellum/shared";
import { useToast, type AppToastOptions } from "./toast/ToastProvider.js";
import { UserAvatar, avatarLabel } from "./UserAvatar.js";

/** 可见满多久才回报已读（与原横幅相同）。 */
export const AVATAR_REWARD_SEEN_MS = 4_000;
/** 同一个 key：新的待通知事件到来时原位更新，不叠第二条。 */
export const AVATAR_REWARD_TOAST_KEY = "avatar-reward";

type Translate = ReturnType<typeof useI18n>["t"];

/**
 * 交给统一提示条的选项（纯函数，便于单测）：同一个 key、页面作用域、带「查看」；
 * 可见满 4 秒、点「查看」、点 × 都回报已读，其余结束方式（被替换、离开页面、到时间）不回报。
 */
export function avatarRewardToast(
  events: readonly Pick<AvatarRewardEvent, "id" | "avatarId">[],
  translate: Translate,
  handlers: { readonly confirm: (ids: readonly string[]) => void; readonly view: () => void },
): AppToastOptions {
  const ids = events.map(event => event.id);
  const first = events[0]!;
  const single = events.length === 1;
  const confirm = (): void => {
    handlers.confirm(ids);
  };
  return {
    tone: "info",
    key: AVATAR_REWARD_TOAST_KEY,
    scope: "page",
    text: single
      ? translate("rewards.banner.singleTitle", { name: avatarLabel(first.avatarId) })
      : translate("rewards.banner.multipleTitle", { count: events.length }),
    detail: single ? translate("rewards.banner.singleBody") : translate("rewards.banner.multipleBody"),
    leading: single ? (
      <UserAvatar avatarId={first.avatarId} className="size-9" />
    ) : (
      <span className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-helper font-semibold text-brand-dark">
        {events.length}
      </span>
    ),
    action: {
      label: translate("rewards.banner.cta"),
      alternative: "我的 → 个人资料 → 头像收藏", // i18n-ignore 开发者注记（ToastAction.alternative），不显示
      run: () => {
        confirm();
        handlers.view();
      },
    },
    onSeen: { afterMs: AVATAR_REWARD_SEEN_MS, run: confirm },
    onEnd: reason => {
      if (reason === "closed") confirm();
    },
  };
}

export function AvatarRewardNotice(): null {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useAvatarRewards();
  const [confirmedIds, setConfirmedIds] = useState<readonly string[]>([]);

  const pendingEvents = (data?.pendingEvents ?? []).filter(event => !confirmedIds.includes(event.id));
  const pendingKey = pendingEvents.map(event => event.id).join("|");

  const markConfirmed = useCallback(
    (ids: readonly string[]): void => {
      if (ids.length === 0) return;

      setConfirmedIds(current => [...current, ...ids.filter(id => !current.includes(id))]);
      void confirmAvatarRewardEvents(ids)
        .then(() => {
          // 服务端已确认，缓存里那条待通知事件已经过期；重新读一次状态，
          // 顺带让头像页的解锁列表也跟上。
          void queryClient.invalidateQueries({ queryKey: AVATAR_REWARDS_QUERY_KEY });
        })
        .catch(() => {
          // 失败就把“已确认”撤回来，下一轮同步仍会重发同一条事件。
          setConfirmedIds(current => current.filter(id => !ids.includes(id)));
        });
    },
    [queryClient],
  );

  // 回调里总用最新的导航与确认函数；提示本身只在待通知事件变化时重发。
  const latest = useRef({ navigate, markConfirmed, pendingEvents, t });
  latest.current = { navigate, markConfirmed, pendingEvents, t };

  useEffect(() => {
    if (pendingKey === "") return;
    // 提示被我们自己的“已读”确认后，待通知列表变空：不撤下，让它照常停留到时间（已读时点仍是可见满 4 秒）。
    toast.show(
      avatarRewardToast(latest.current.pendingEvents, latest.current.t, {
        confirm: ids => {
          latest.current.markConfirmed(ids);
        },
        view: () => {
          void latest.current.navigate("/profile/avatar");
        },
      }),
    );
  }, [pendingKey, toast]);

  return null;
}
