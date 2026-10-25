/**
 * **特典头像奖励的前端访问层（S16）。**
 *
 * ⚠️ **前端不判定“该不该发”。** 这里只负责：读服务端算好的状态、补领、以及把
 * “已经向用户展示过”的事件回报回去。界面上的锁定说明来自 `activities`，
 * 但它只是显示层；真正决定能不能保存的是 `PATCH /auth/profile` 的服务端校验。
 */
import {
  avatarRewardMakeUpResponseSchema,
  avatarRewardsResponseSchema,
  type AvatarRewardEvent,
  type AvatarRewardsResponse,
  type SpecialAvatarId,
} from "@libellum/shared";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../auth/AuthProvider.js";
import { apiFetch } from "./api.js";

/** 与 queryKey 一起集中，避免页头通知与头像页各拼一份缓存。 */
export const AVATAR_REWARDS_QUERY_KEY = ["avatar-rewards"] as const;

export async function fetchAvatarRewards(): Promise<AvatarRewardsResponse> {
  const payload = await apiFetch<unknown>("/avatar-rewards");

  return avatarRewardsResponseSchema.parse(payload);
}

/**
 * 读取解锁状态与待通知事件。
 *
 * ⚠️ 这条 GET 同时会让服务端跑一次自动发放判定（登录后第一次请求、纪念日当天）。
 * 因此它不能被“只在头像页打开时调用”限制——页头通知在首页挂载时就会用它。
 */
export function useAvatarRewards(): UseQueryResult<AvatarRewardsResponse> {
  const { user } = useAuth();

  return useQuery({
    queryKey: AVATAR_REWARDS_QUERY_KEY,
    queryFn: fetchAvatarRewards,
    enabled: user !== null,
    // 解锁是新发生的事，不需要秒级新鲜；但窗口重新获得焦点时应该立刻看一次。
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** 用掉那唯一一次“补领过去错过的特典头像”的机会。 */
export async function requestAvatarRewardMakeUp(avatarId: SpecialAvatarId): Promise<AvatarRewardEvent[]> {
  const payload = await apiFetch<unknown>(`/avatar-rewards/${avatarId}/make-up`, { method: "POST" });

  return avatarRewardMakeUpResponseSchema.parse(payload).pendingEvents;
}

/**
 * 确认这些事件已经真的展示给用户了。
 *
 * ⚠️ **先展示、再确认**：服务端只有收到确认才会把事件从“待通知”移走；
 * 提前确认等于把一条没人看过的消息静默吃掉。
 *
 * 失败不向界面抛——下一轮同步还会把同一条事件再下发一次，界面按 eventId 去重，
 * 用户最多再看一遍，不会丢。批量补领的事件也走这里。
 */
export async function confirmAvatarRewardEvents(eventIds: readonly string[]): Promise<void> {
  await Promise.all(
    eventIds.map(eventId =>
      apiFetch<unknown>(`/avatar-rewards/${encodeURIComponent(eventId)}/confirm`, { method: "POST" }),
    ),
  );
}
