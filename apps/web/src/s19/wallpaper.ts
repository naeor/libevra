/** 壁纸属于本机外观偏好，与主题、视觉风格和按账号保存的玻璃参数独立。 */
export const WALLPAPERS = ["aurora", "luminous", "quiet"] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];
export const DEFAULT_WALLPAPER: Wallpaper = "aurora";
export const WALLPAPER_STORAGE_KEY = "libevra.wallpaper";

export function parseWallpaper(raw: string | null | undefined): Wallpaper {
  return WALLPAPERS.includes(raw as Wallpaper) ? raw as Wallpaper : DEFAULT_WALLPAPER;
}
