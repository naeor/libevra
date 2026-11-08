/** 有界、无文字的环境描述：仅可见几何与颜色，不克隆 DOM、不保存截图。 */
export interface AmbientShape { x: number; y: number; width: number; height: number; radius: number; fill: string; card: boolean }
export interface AmbientLayout { width: number; height: number; shapes: AmbientShape[] }
export const MAX_AMBIENT_SHAPES = 48;
export function describeLayout(plane: HTMLElement, options: { selectors: string; cardSelector?: string; scrollSelector?: string; bounds?: DOMRect }): AmbientLayout {
  const bounds = options.bounds ?? plane.getBoundingClientRect();
  const scroll = options.scrollSelector ? plane.querySelector<HTMLElement>(options.scrollSelector)?.getBoundingClientRect() ?? bounds : bounds;
  const shapes: AmbientShape[] = [];
  for (const node of plane.querySelectorAll<HTMLElement>(options.selectors)) {
    const box = node.getBoundingClientRect();
    const insideScroll = !!options.scrollSelector && !!node.closest(options.scrollSelector);
    const top = Math.max(box.top, insideScroll ? scroll.top : bounds.top);
    const bottom = Math.min(box.bottom, insideScroll ? scroll.bottom : bounds.bottom);
    if (bottom <= top || box.right <= bounds.left || box.left >= bounds.right) continue;
    const style = getComputedStyle(node);
    shapes.push({ x: Math.max(box.left, bounds.left) - bounds.left, y: top - bounds.top,
      width: Math.min(box.right, bounds.right) - Math.max(box.left, bounds.left), height: bottom - top,
      radius: Math.min(parseFloat(style.borderRadius) || 0, box.width / 2, (bottom - top) / 2),
      fill: style.backgroundColor, card: !options.cardSelector || node.matches(options.cardSelector) });
    if (shapes.length === MAX_AMBIENT_SHAPES) break;
  }
  return { width: bounds.width, height: bounds.height, shapes };
}
const xml = (value: string): string => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const num = (value: number): number => Number(value.toFixed(2));
// 同一张轻量 SVG 与浏览器滤镜用于 Lab / 正式 B2；没有 CPU 像素模糊。
export function layoutBackground(layout: AmbientLayout | undefined, visibility: number, blur: number, retreat: boolean, stroke = "currentColor"): string | null {
  if (!layout || layout.width <= 0 || layout.height <= 0 || visibility <= 0) return null;
  const shapes = layout.shapes.slice(0, MAX_AMBIENT_SHAPES).map(shape =>
    `<rect x="${num(shape.x)}" y="${num(shape.y)}" width="${num(shape.width)}" height="${num(shape.height)}" rx="${num(shape.radius)}" fill="${xml(shape.fill)}"${shape.card ? ` stroke="${xml(stroke)}" stroke-opacity=".22" stroke-width="2"` : ""}/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="none"><defs><filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${Math.max(0, blur)}"/></filter></defs><g opacity="${Math.max(0, Math.min(100, visibility)) / 100}" transform="translate(${retreat ? num(-layout.width * .15) : 0} 0)" filter="url(#soft)">${shapes}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
