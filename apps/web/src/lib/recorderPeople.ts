import { useMemo } from "react";
import { useAuthOptional } from "../auth/AuthProvider.js";
import { useBookMembers, type BookMemberView } from "./queries.js";

export interface RecorderPeople {
  readonly self: string | null;
  readonly members: readonly BookMemberView[];
  /** 当前成员的账号 id；名单还没取到时为 `null`（“已退出的成员”此时不命中）。 */
  readonly memberIds: readonly string[] | null;
}

/**
 * 记录人筛选用的成员名单与“我”（1.19.55，明细与分析共用）。只在 `enabled`（设了记录人条件或打开了
 * 记录人选项）时请求成员名单，平时不多发请求。
 */
export function useRecorderPeople(enabled: boolean): RecorderPeople {
  const self = useAuthOptional()?.user?.id ?? null;
  const query = useBookMembers(undefined, { enabled });
  const members = query.data?.members;
  return useMemo(() => ({ self, members: members ?? [], memberIds: members === undefined ? null : members.map(m => m.userId) }), [self, members]);
}
