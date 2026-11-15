/**
 * 总览卡片的右键菜单（1.19.101，候选清单 F1）：右键、Shift+F10 或菜单键打开。
 *
 * - 只放界面上别处已有的命令（desktop-ui skill 规则 3）：打开、卡片设置、调整尺寸、移动、复制、删除——
 *   后四项就是编辑菜单里的同一组动作，选了会先进入编辑（仍要点「完成」才保存，可撤销）。
 * - 容器里的卡片不能单独调尺寸、移动、复制、删除（与编辑菜单一致），只有打开与卡片设置。
 * - 卡片里选中了文字时不拦截浏览器自己的菜单（可以复制金额与备注）。
 */
import { useCallback, useRef, useState } from "react";

import { useI18n } from "../i18n/index.js";
import type { MenuAction } from "../statsWorkbench/Sheets.js";
import { DesktopPopover, moveFocusInList } from "./DesktopPopover.js";

interface MenuState {
  readonly objectId: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  /** 打开菜单前有焦点的元素（关闭后焦点回去）。 */
  readonly returnTo: HTMLElement | null;
}

export function useCardContextMenu({ act, isRootObject }: {
  readonly act: (objectId: string, action: MenuAction | "settings") => void;
  readonly isRootObject: (objectId: string) => boolean;
}): {
  readonly onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  readonly menu: React.ReactNode;
} {
  const { t } = useI18n();
  const [state, setState] = useState<MenuState | null>(null);
  const anchor = useRef<HTMLSpanElement | null>(null);
  const close = useCallback(() => {
    setState((current) => {
      current?.returnTo?.focus({ preventScroll: true });
      return null;
    });
  }, []);

  const openFor = (card: HTMLElement, x: number, y: number): void => {
    const objectId = card.dataset["cardId"];
    if (objectId === undefined) return;
    setState({ objectId, label: card.getAttribute("aria-label") ?? "", x, y, returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  };

  const onContextMenu = (event: React.MouseEvent<HTMLElement>): void => {
    const card = (event.target as Element).closest<HTMLElement>("[data-card-id]");
    if (card === null) return;
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed && card.contains(selection.anchorNode)) return;
    event.preventDefault();
    openFor(card, event.clientX, event.clientY);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
    const card = (document.activeElement as Element | null)?.closest<HTMLElement>("[data-card-id]") ?? null;
    if (card === null) return;
    event.preventDefault();
    const box = card.getBoundingClientRect();
    openFor(card, box.left + 16, box.top + 24);
  };

  const run = (action: MenuAction | "settings" | "open"): void => {
    if (state === null) return;
    const { objectId } = state;
    setState(null);
    if (action === "open") document.getElementById(`sw-card-${objectId}`)?.click();
    else act(objectId, action);
  };

  const root = state === null ? false : isRootObject(state.objectId);
  const openable = state === null ? false : document.getElementById(`sw-card-${state.objectId}`) !== null;
  const items: readonly { readonly action: MenuAction | "settings" | "open"; readonly label: string; readonly danger?: boolean }[] = state === null ? [] : [
    ...(openable ? [{ action: "open" as const, label: t("desktop.dashboard.menu.open") }] : []),
    { action: "settings", label: t("desktop.dashboard.menu.settings") },
    ...(root ? [
      { action: "resize" as const, label: t("statsWorkbench.menu.resize") },
      { action: "move" as const, label: t("statsWorkbench.menu.move") },
      { action: "duplicate" as const, label: t("statsWorkbench.menu.duplicate") },
      { action: "remove" as const, label: t("statsWorkbench.menu.remove"), danger: true },
    ] : []),
  ];

  const menu = state === null ? null : (
    <>
      <span ref={anchor} aria-hidden="true" style={{ position: "fixed", left: state.x, top: state.y, width: 1, height: 1 }} />
      <DesktopPopover anchor={anchor} label={t("desktop.dashboard.menu.label", { name: state.label })} placement="bottom-start" width={200} role="menu" onClose={close}>
        <ul className="p-1.5" onKeyDown={(event) => moveFocusInList(event)}>
          {items.map((item) => (
            <li key={item.action}>
              <button type="button" role="menuitem" className={`lv-desk-menu-row ${item.danger === true ? "text-danger" : ""}`} onClick={() => run(item.action)}>
                <span className="flex-1 text-left text-body">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
        {root ? null : <p className="px-3 pb-2 text-helper text-muted">{t("desktop.dashboard.menu.inContainer")}</p>}
      </DesktopPopover>
    </>
  );

  return { onContextMenu, onKeyDown, menu };
}
