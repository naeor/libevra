/**
 * 首页底部的「获得新头像」轻提示条（S16 头像奖励系统）。
 *
 * 设计约束（所有者原话归纳）：
 *   - 轻量、非模态，悬在底部导航上方，不遮住「+」与导航按钮，不打断滚动；
 *   - 一次只出现一条：单款显示头像名，多款显示数量；最多展示约 4 秒后自动收起；
 *   - **先展示、后确认**：只有真的出现在屏幕上（或用户点了它/关了它）才回报确认，
 *     否则服务端会把没人看过的事件当成已读。
 *
 * ⚠️ **「+」入口卡片打开时立刻让开**：入口菜单展开的行与通知条在同一块位置，
 * 通知条压在上面会挡住记账入口；这里直接读 `useEntryMenu()`，菜单一开就隐藏，
 * 菜单收起后若还没确认会重新排出展示。
 *
 * ⚠️ **绝不注册成新的导航层**：它只是底部导航容器里的一个绝对定位兄弟节点，
 * 不固定到 viewport，也不抢焦点——所以 PWA、键盘与滚动都感觉不到它。
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useI18n } from "../i18n/index.js";
import { AVATAR_REWARDS_QUERY_KEY, confirmAvatarRewardEvents, useAvatarRewards } from "../lib/avatarRewards.js";
import { useQueryClient } from "@tanstack/react-query";
import { useEntryMenu } from "./Layouts.js";
import { UserAvatar, avatarLabel } from "./UserAvatar.js";

/** 展示时长：足够读完一行字，又不至于一直挡在列表上。 */
const VISIBLE_MS = 4_000;

export function AvatarRewardBanner(): React.JSX.Element | null {
  const { t } = useI18n();
  const navigate = useNavigate();
  const menu = useEntryMenu();
  const queryClient = useQueryClient();
  const { data } = useAvatarRewards();
  const [confirmedIds, setConfirmedIds] = useState<readonly string[]>([]);

  const pendingEvents = (data?.pendingEvents ?? []).filter(event => !confirmedIds.includes(event.id));
  const visible = pendingEvents.length > 0 && !menu.open;
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

  useEffect(() => {
    if (!visible) return;

    const timer = window.setTimeout(() => {
      markConfirmed(pendingKey.split("|").filter(id => id !== ""));
    }, VISIBLE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [visible, pendingKey, markConfirmed]);

  if (pendingEvents.length === 0) return null;

  const first = pendingEvents[0]!;
  const single = pendingEvents.length === 1;
  const title = single
    ? t("rewards.banner.singleTitle", { name: avatarLabel(first.avatarId) })
    : t("rewards.banner.multipleTitle", { count: pendingEvents.length });
  const body = single ? t("rewards.banner.singleBody") : t("rewards.banner.multipleBody");

  const confirmAll = (): void => {
    markConfirmed(pendingEvents.map(event => event.id));
  };

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+2.25rem)] z-20 flex justify-center px-3"
    >
      <div
        aria-hidden={!visible}
        className={`flex w-full max-w-md items-center gap-3 rounded-2xl bg-brand-dark px-3 py-2.5 text-on-brand shadow-lg transition-all duration-300 ease-out motion-reduce:transition-none ${
          visible ? "pointer-events-auto translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        {single ? (
          <UserAvatar avatarId={first.avatarId} className="size-9 shrink-0" />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-on-brand/15 text-helper font-semibold">
            {pendingEvents.length}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-helper font-semibold">{title}</p>
          <p className="truncate text-micro opacity-80">{body}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            confirmAll();
            navigate("/profile/avatar");
          }}
          className="shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold underline-offset-2 hover:underline"
        >
          {t("rewards.banner.cta")}
        </button>
        <button
          type="button"
          aria-label={t("rewards.banner.dismiss")}
          onClick={confirmAll}
          className="shrink-0 rounded-full p-1.5 opacity-70 transition hover:bg-on-brand/15 hover:opacity-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
            <path d="M6 6 18 18M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
