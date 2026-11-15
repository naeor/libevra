/** 临时区只拆宿主。默认比例 55:45 的小 iPad 继续使用原面板。 */
export type TemporaryContent = "short" | "filter" | "editor" | "detail";

const WIDTHS = {
  short:  { host: 320, min: 260, ideal: 320 },
  filter: { host: 336, min: 332, ideal: 460 },
  editor: { host: 352, min: 360, ideal: 470 },
  detail: { host: 336, min: 332, ideal: 440 },
} as const;

/** 返回附属列像素宽度，0 表示使用原呈现。只在进入时加余量，退出时仍守住内容最小宽度。 */
export function temporaryWidth(kind: TemporaryContent, hostWidth: number, height: number, areaWidth: number, split: boolean, open = false): number {
  const limits = WIDTHS[kind];
  if (height <= 0 || areaWidth <= 0) return 0;
  const margin = open ? 0 : 18;
  if (hostWidth < limits.host + limits.min + margin || hostWidth / areaWidth < (open ? 0.43 : 0.47)
    || hostWidth / height < (open ? 0.62 : 0.66) || height < (open ? 240 : 280)) return 0;
  // 横排筛选给选项更多空间，但宿主仍保留至少一半左右的内容。双区只压本宿主，两个正式区域的比例由外壳管理。
  const share = kind === "filter" ? 0.48 : 0.43;
  const ideal = split ? Math.min(limits.ideal, 420) : limits.ideal;
  return Math.round(Math.min(ideal, hostWidth - limits.host, Math.max(limits.min, hostWidth * share)));
}
