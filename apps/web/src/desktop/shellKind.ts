/**
 * **电脑版外壳还是原有外壳（手机 / 平板工作区）。**
 *
 * 按「输入能力 × 窗口大小」判断，不按设备型号（S18-B P-06、§3.7）：
 *
 * - 主要指针能精确悬停（`(hover: hover) and (pointer: fine)`，即鼠标 / 触控板为主）**而且**窗口够大 → 电脑版；
 * - 其它情况（触屏为主的平板、手机、很窄的电脑窗口）→ 原有 `WorkspaceShell`，它再自己区分手机与平板大屏。
 *
 * 接了触控板的 iPad 通常报告 `pointer: coarse`，继续使用平板工作区；触屏笔记本以触控板为主，进入电脑版。
 * 进入与退出用不同的宽度（迟滞），窗口在临界宽度附近拖动时不会来回切换。
 *
 * 开发与验收可以用地址参数 `?shell=desktop|workspace|auto` 指定，选择记在本机。
 */
export type ShellKind = "desktop" | "workspace";
export type ShellOverride = "auto" | "desktop" | "workspace";

export const DESKTOP_ENTER_WIDTH = 760;
export const DESKTOP_EXIT_WIDTH = 720;
export const DESKTOP_MIN_HEIGHT = 480;

export const SHELL_OVERRIDE_KEY = "libevra.shell:v1";

export function shellKindFor(input: {
  readonly fine: boolean;
  readonly width: number;
  readonly height: number;
  readonly override: ShellOverride;
  readonly previous: ShellKind | null;
}): ShellKind {
  if (input.override !== "auto") return input.override;
  if (!input.fine || input.height < DESKTOP_MIN_HEIGHT) return "workspace";
  const threshold = input.previous === "desktop" ? DESKTOP_EXIT_WIDTH : DESKTOP_ENTER_WIDTH;
  return input.width >= threshold ? "desktop" : "workspace";
}

export function parseShellOverride(value: string | null | undefined): ShellOverride | null {
  return value === "auto" || value === "desktop" || value === "workspace" ? value : null;
}

/** 读地址参数（并记住）或本机记录；都没有时为 `auto`。 */
export function readShellOverride(): ShellOverride {
  if (typeof window === "undefined") return "auto";
  const fromUrl = parseShellOverride(new URLSearchParams(window.location.search).get("shell"));
  try {
    if (fromUrl !== null) {
      if (fromUrl === "auto") window.localStorage.removeItem(SHELL_OVERRIDE_KEY);
      else window.localStorage.setItem(SHELL_OVERRIDE_KEY, fromUrl);
      return fromUrl;
    }
    return parseShellOverride(window.localStorage.getItem(SHELL_OVERRIDE_KEY)) ?? "auto";
  } catch {
    return fromUrl ?? "auto";
  }
}
