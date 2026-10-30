import type { InstanceId } from "./model.js";

export type EntryNavigate = (path: string, prepare?: () => void) => void;

export function entrySourceLedger(primary: InstanceId, key: string, entries: Readonly<Record<string, string>>, ledgers: Readonly<Record<InstanceId, string | null>>, device: string | null): string | null {
  return entries[`${primary}:${key}`] ?? ledgers[primary] ?? device;
}

interface Box { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** 以内容边界定位；连接点始终追随按钮中心，靠近视口边缘时与主体一起重新计算。 */
export function entryMenuPosition(trigger: Box, contentLeft: number, viewport: { width: number; height: number }, height: number) {
  const margin = 12;
  const width = Math.min(224, Math.max(0, viewport.width - contentLeft - margin));
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const actualHeight = Math.min(height, maxHeight);
  const center = trigger.top + trigger.height / 2;
  const top = Math.max(margin, Math.min(center - actualHeight / 2, viewport.height - actualHeight - margin));
  return { left: contentLeft, top, width, maxHeight, connector: Math.max(24, Math.min(center - top, actualHeight - 24)) };
}

export function entryTarget(view: { readonly splitVisible: boolean; readonly mode: "follow" | "independent"; readonly primary: InstanceId; readonly secondary: InstanceId | null }): InstanceId {
  return view.splitVisible && view.mode === "follow" && view.secondary !== null ? view.secondary : view.primary;
}

/** 仅跟随发起的既有记账流程可继续跟随；主导航／设置等不在白名单内。 */
export function isEntryFlowPath(path: string): boolean {
  return ["/add", "/scan", "/record", "/paste", "/voice/review", "/paste/review", "/import", "/ocr/overview"].includes(path) || /^\/ocr\/overview\/[^/]+$/.test(path);
}

/** 会话内的来源标记，不新增工作区持久化模型，也不把普通辅助区导航误认成跟随。 */
export class FollowEntryFlow {
  private readonly keys = new Set<string>();
  has(instance: InstanceId, key: string): boolean { return this.keys.has(`${instance}:${key}`); }
  start(instance: InstanceId, key: string): void { this.keys.add(`${instance}:${key}`); }
  continue(instance: InstanceId, before: string, next: { readonly key: string; readonly pathname: string }): boolean {
    if (!this.has(instance, before)) return false;
    // 保存／取消后的明细落点只是结束流程，不是主动的辅助区主导航。
    if (next.pathname === "/") return true;
    if (!isEntryFlowPath(next.pathname)) return false;
    this.start(instance, next.key);
    return true;
  }
}
