import { ROLE_RANK, type BookRoleValue, type AssignableBookRole } from "@libellum/shared";
import { useAuthOptional } from "../auth/AuthProvider.js";
import { useBookMembers } from "./queries.js";

/**
 * 账本权限分级（所有者 2026-11-10 决定，1.19.56）在界面上的读法。**只决定显示哪些按钮**——真正的判断在
 * 服务器（`apps/api/src/ledger/access.ts`），界面藏起按钮不是权限检查。
 *
 * 从低到高：只读 `viewer` → 记账 `recorder` → 编辑全部 `editor`（旧值 `owner` 同编辑全部）；另有每本账一位管理员。
 */
export function roleRank(role: string | undefined | null): number {
  return role !== undefined && role !== null && role in ROLE_RANK ? ROLE_RANK[role as BookRoleValue] : -1;
}

export function canRecordRole(role: string | undefined | null): boolean {
  return roleRank(role) >= ROLE_RANK.recorder;
}

export function canEditAllRole(role: string | undefined | null): boolean {
  return roleRank(role) >= ROLE_RANK.editor;
}

/** 能不能修改 / 删除这一笔：编辑全部可以改所有账目；记账只能改自己记的（不知道记录人时不显示修改）。 */
export function canEditEntryAs(role: string | undefined | null, self: string | null, recorderId: string | undefined): boolean {
  if (canEditAllRole(role)) return true;
  return canRecordRole(role) && self !== null && recorderId !== undefined && recorderId === self;
}

/** 邀请时可以给出的权限：不高于自己（`ASSIGNABLE_BOOK_ROLES` 从低到高）。 */
export function invitableRoles(role: string | undefined | null): readonly AssignableBookRole[] {
  const rank = roleRank(role);
  return (["viewer", "recorder", "editor"] as const).filter(item => ROLE_RANK[item] <= rank);
}

export interface LedgerPermissions {
  readonly role: string;
  readonly self: string | null;
  readonly canRecord: boolean;
  readonly canEditAll: boolean;
  readonly isAdmin: boolean;
  readonly inviteAdminOnly: boolean;
  /** 能不能邀请别人（“只有管理员能邀请”打开时只有管理员可以）。 */
  readonly canInvite: boolean;
  readonly canEditEntry: (recorderId: string | undefined) => boolean;
  /** 成员的显示名（记录人提示用）；不在当前成员里时为 `null`。 */
  readonly memberName: (userId: string | undefined) => string | null;
}

/**
 * 当前（或指定）账本里我的权限。成员名单还没取到时返回 `null`，调用方按“先不显示修改入口”或原来的样子处理。
 * 游客的本机账本只有自己，按管理员处理。
 */
export function useLedgerPermissions(bookId?: string): LedgerPermissions | null {
  const self = useAuthOptional()?.user?.id ?? null;
  const members = useBookMembers(bookId);
  const data = members.data as ({ readonly myRole: string; readonly isAdmin?: boolean; readonly inviteAdminOnly?: boolean } | undefined);
  if (data === undefined) return null;
  const role = data.myRole;
  const guest = role === "owner" && data.isAdmin === undefined;
  const isAdmin = guest || data.isAdmin === true;
  const inviteAdminOnly = data.inviteAdminOnly === true;
  return {
    role,
    self,
    canRecord: canRecordRole(role),
    canEditAll: canEditAllRole(role),
    isAdmin,
    inviteAdminOnly,
    canInvite: !inviteAdminOnly || isAdmin,
    canEditEntry: (recorderId) => guest || canEditEntryAs(role, self, recorderId),
    memberName: (userId) => (members.data?.members ?? []).find(member => member.userId === userId)?.displayName ?? null,
  };
}
