const DOCK_KEY = "libevra.s19-lab-dock";

/**
 * S19 开发风格把手是否显示（1.19.49 起默认不显示）：正式的风格切换在“设置 → 外观 → 视觉风格”。
 * 只认地址参数 `?s19lab=1`（记在本标签页的 sessionStorage，之后的页面切换与刷新都保持），`?s19lab=0` 关闭。
 * 存储不可用时不显示。
 */
export function wantsStyleLabDock(search: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): boolean {
  try {
    const flag = new URLSearchParams(search).get("s19lab");
    if (flag === "1") storage?.setItem(DOCK_KEY, "1");
    if (flag === "0") storage?.removeItem(DOCK_KEY);
    return storage?.getItem(DOCK_KEY) === "1";
  } catch { return false; }
}
