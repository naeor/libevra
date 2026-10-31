/**
 * 主展示区 + 情境辅助栏的宽度规则（纯函数，便于测试）。
 *
 * - 辅助栏默认 320px，可拖到 280–520px；
 * - 主展示区至少保留 `MIN_MAIN`。放不下用户选的宽度时先把辅助栏收窄，收到最窄仍放不下就不并排显示——
 *   这时由页面把辅助内容放进主展示区（桌面式详情 + 返回），而不是缩成一条看不清的窄栏。
 */
export const PANEL_DEFAULT = 320;
export const PANEL_MIN = 280;
export const PANEL_MAX = 520;
export const MIN_MAIN = 520;
export const PANEL_WIDTH_KEY = "libevra.desktop.panel-width:v1";

export function clampPanel(width: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT;
  return Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width)));
}

export interface SplitLayout {
  readonly fits: boolean;
  readonly panelWidth: number;
  /** 当前空间下辅助栏能拖到的最大宽度。 */
  readonly maxPanel: number;
}

export function splitLayout(containerWidth: number, preferred: number): SplitLayout {
  const wanted = clampPanel(preferred);
  // 还没量到尺寸（首帧）：按偏好显示，量到后再调整。
  if (containerWidth <= 0) return { fits: true, panelWidth: wanted, maxPanel: PANEL_MAX };
  const maxPanel = Math.min(PANEL_MAX, containerWidth - MIN_MAIN);
  if (maxPanel < PANEL_MIN) return { fits: false, panelWidth: wanted, maxPanel: PANEL_MIN };
  return { fits: true, panelWidth: Math.min(wanted, maxPanel), maxPanel };
}

export function readPanelWidth(): number {
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
    return raw === null ? PANEL_DEFAULT : clampPanel(Number(raw));
  } catch {
    return PANEL_DEFAULT;
  }
}

export function writePanelWidth(width: number): void {
  try {
    if (width === PANEL_DEFAULT) window.localStorage.removeItem(PANEL_WIDTH_KEY);
    else window.localStorage.setItem(PANEL_WIDTH_KEY, String(clampPanel(width)));
  } catch {
    // 存不下只是下次回到默认宽度。
  }
}
