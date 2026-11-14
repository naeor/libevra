/**
 * **提示条（Toast）停留多久**——1.19.66 统一提示条的时长规则（方案 §2.4，所有者 2026-11-14 按推荐确认）。
 *
 * 停留时长不是动效：不进 Motion Token，也不受“减少动态效果”影响（那只改出现 / 消失的动画）。
 * 原来五套实现各写各的：2.6 / 3 / 3.2 / 4 / 5 秒，这里收成一套按类型与文字长短决定的规则：
 *
 * | 类型 | 停留 | 暂停后恢复时至少还剩 |
 * |---|---|---|
 * | 信息 / 成功 | clamp(4s, 1.5s + 0.12s × 可读长度, 8s) | 2s |
 * | 警告 | 同式，下限 6s、上限 10s | 3s |
 * | 带操作（任何类型） | 固定 10s，不按文字缩短 | 4s |
 * | 错误 | 不自动消失（有 ×；被同 key 的消息替换或用户关闭才消失） | — |
 * | 错误·回声（页面已常驻显示同一结果） | 8s | 3s |
 *
 * 可读长度 = 中文（含日文、韩文）字数 + 其他文字的词数 × 2：一个英文词大约要两个汉字的阅读时间。
 */
import type { ToastTone } from "./types.js";

/** 信息 / 成功：下限、上限。 */
export const NORMAL_DWELL = { min: 4_000, max: 8_000 } as const;
/** 警告：下限、上限。 */
export const WARNING_DWELL = { min: 6_000, max: 10_000 } as const;
/** 公式：基础 + 每个可读单位。 */
export const DWELL_BASE_MS = 1_500;
export const DWELL_PER_UNIT_MS = 120;
/** 带操作的提示固定停留时长（原撤销条 5s，按 WCAG 2.2.1 与方案提高到 10s，且悬停 / 聚焦时暂停）。 */
export const ACTION_DWELL_MS = 10_000;
/** 错误回声（例如拍照导入全部失败：完成页上已经常驻显示结果）的停留时长。 */
export const ECHO_ERROR_DWELL_MS = 8_000;

/** 暂停（悬停、聚焦、页面切到后台、弹层打开）结束后，至少还要再显示多久。 */
export const RESUME_FLOOR = { normal: 2_000, warning: 3_000, action: 4_000, echoError: 3_000 } as const;

/** 等待位里的普通消息最多等多久就丢弃——它说的是“刚刚发生的事”，晚 10 秒出现会误导。错误不过期。 */
export const WAIT_LIMIT = { normal: 3_000, warning: 6_000 } as const;

/** 同一个 key 在这段时间里重复出现，只播报一次（读屏不被连续触发刷屏）。 */
export const ANNOUNCE_REPEAT_MS = 1_000;

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/gu;

/** 可读长度：中日韩字数 + 其余文字的词数 × 2。标点、空白不计。 */
export function readableLength(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const rest = text.replace(CJK, " ");
  const words = rest.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "").length;
  return cjk + words * 2;
}

export interface DwellInput {
  readonly tone: ToastTone;
  readonly text: string;
  readonly detail?: string | undefined;
  readonly hasAction: boolean;
  readonly echo: boolean;
}

/** 停留时长（毫秒）；`null` 表示不自动消失（错误）。 */
export function dwellMs({ tone, text, detail, hasAction, echo }: DwellInput): number | null {
  if (tone === "error") return echo ? ECHO_ERROR_DWELL_MS : null;
  if (hasAction) return ACTION_DWELL_MS;
  const units = readableLength(text) + (detail === undefined ? 0 : readableLength(detail));
  const raw = DWELL_BASE_MS + DWELL_PER_UNIT_MS * units;
  const range = tone === "warning" ? WARNING_DWELL : NORMAL_DWELL;
  return Math.round(Math.min(range.max, Math.max(range.min, raw)));
}

/** 暂停结束后至少还剩多久（毫秒）。 */
export function resumeFloorMs({ tone, hasAction, echo }: Pick<DwellInput, "tone" | "hasAction" | "echo">): number {
  if (tone === "error") return echo ? RESUME_FLOOR.echoError : 0;
  if (hasAction) return RESUME_FLOOR.action;
  return tone === "warning" ? RESUME_FLOOR.warning : RESUME_FLOOR.normal;
}

/** 在等待位最多等多久；`null` 表示不过期（错误）。 */
export function waitLimitMs(tone: ToastTone): number | null {
  if (tone === "error") return null;
  return tone === "warning" ? WAIT_LIMIT.warning : WAIT_LIMIT.normal;
}
