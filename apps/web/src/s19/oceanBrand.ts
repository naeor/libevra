import { oceanEdge } from "../lib/oceanGeometry.js";
import { clamp01 } from "../lib/transitionPhysics.js";
import { contentLag } from "./oceanLayers.js";

export interface OceanBrandSize { height: number; width: number; shortHeight: number; brandHeight: number; brandWidth: number }
/** 品牌当下读到的两层进度：1 号（B1 印在它上面）与 4 号（B2 最外一层玻璃）。缺省等于主进度。 */
export interface OceanBrandLayers { readonly first: number; readonly last: number }

const softReveal = (value: number) => { const p = clamp01(value); return p * p * (3 - 2 * p); };

/**
 * 只读取海浪几何与各层进度；返回品牌的绘制坐标 / 显现度，绝不反写海浪进度。
 *
 * - B1：大字印在 1 号瓷片上，跟随 1 号浪沿的实际位移（分层转场后 1 号有自己的进度）。
 * - B2：大字固定在底面；4 号玻璃盖住它的比例决定它是否参与显现（其余层次由混合模式逐像素决定）。
 */
export function oceanBrandPresentation(p: number, seconds: number, size: OceanBrandSize, layers: OceanBrandLayers = { first: p, last: p }) {
  const welcome = size.height * .8;
  const seaAt = (q: number) => welcome * (1 - q) + size.shortHeight * q;
  const centre = welcome * .34;
  const firstAtWelcome = oceanEdge(0, .5, 0, seconds) * welcome;
  const firstNow = oceanEdge(0, .5, clamp01(layers.first), seconds) * seaAt(layers.first);
  const firstAtList = oceanEdge(0, .5, 1, seconds) * size.shortHeight;
  const travel = firstAtWelcome - firstAtList;
  // 短横屏的最小海浪高度会限制可用行程；只扩大印刷坐标的行程，让大字完整离开顶部。
  const printTravel = Math.max(travel, centre + size.brandHeight * 1.25 + 16);
  const printY = centre - (firstAtWelcome - firstNow) * printTravel / Math.max(travel, 1);
  const porcelainCompact = softReveal(-(printY + size.brandHeight / 2) / Math.max(size.brandHeight * .75, 1)) * softReveal((p - .68) / .32);

  // 底面大字的中心不读 p 或时间；短横屏让它与最终顶部栏保持足够距离。
  const glassY = Math.max(centre, size.shortHeight + size.brandHeight * .75);
  const halfWidth = Math.min(.49, size.brandWidth / Math.max(size.width, 1) / 2);
  const lastSea = seaAt(layers.last);
  const outerEdge = Math.max(...[.5 - halfWidth, .5, .5 + halfWidth].map(x => oceanEdge(3, x, clamp01(layers.last), seconds) * lastSea));
  const covered = clamp01((outerEdge - (glassY - size.brandHeight / 2)) / Math.max(size.brandHeight, 1));
  // 大字由 4 号玻璃（上行时最后离开的一层）决定何时退场：玻璃还盖着它就保持显现。
  // 安全兜底：列表内容（含分层落差 contentLag）的真实上沿逼近大字下缘 30px 以内才开始淡出，到 6px 前完全消失。
  const sea = seaAt(p);
  const contentTop = sea + size.height * .2 * (1 - clamp01(p)) + Math.max(24, sea * .07) + contentLag(p, layers.last, { height: size.height, short: size.shortHeight });
  const crowded = clamp01((glassY + size.brandHeight / 2 + 30 - contentTop) / 24);
  const glassReveal = softReveal(covered) * (1 - softReveal(crowded));
  const glassCompact = clamp01((.12 - covered) / .12) * softReveal((p - .84) / .16);
  return { printY, glassY, porcelainCompact, glassCompact, glassReveal };
}
