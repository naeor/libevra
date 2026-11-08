import type { BackgroundPattern } from "./optics-model.js";
/** 自有、静态的测试背景。只在切换测试图时重画，不抓取 DOM 或做 CPU 像素模糊。 */
export function makeLensBackground(pattern: BackgroundPattern = "scene"): HTMLCanvasElement {
  const source = document.createElement("canvas"); source.width = 512; source.height = 512;
  const ctx = source.getContext("2d")!;
  const colors = getComputedStyle(document.documentElement);
  const token = (name: string) => colors.getPropertyValue(`--color-${name}`).trim();
  ctx.fillStyle = token("surface"); ctx.fillRect(0, 0, 512, 512);
  if (pattern !== "scene") {
    ctx.strokeStyle = token("ink"); ctx.fillStyle = token("ink"); ctx.lineWidth = 2;
    if (pattern === "line") { ctx.beginPath(); ctx.moveTo(255, 0); ctx.lineTo(255, 512); ctx.stroke(); }
    if (pattern === "circle") { ctx.beginPath(); ctx.arc(256, 256, 75, 0, Math.PI * 2); ctx.stroke(); }
    if (pattern === "text") { ctx.font = `500 36px ${colors.getPropertyValue("--font-sans")}`; ctx.textAlign = "center"; ctx.fillText("Aa 123", 256, 268); }
    if (pattern === "grid") for (let i = 0; i <= 512; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke(); }
    return source;
  }
  ctx.fillStyle = token("brand-soft"); ctx.fillRect(0, 0, 512, 250);
  ctx.fillStyle = token("warn-soft"); ctx.beginPath(); ctx.arc(95, 155, 105, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = token("info-soft"); ctx.fillRect(320, 220, 192, 292);
  ctx.strokeStyle = token("muted"); ctx.globalAlpha = .32; ctx.lineWidth = 1;
  for (let i = 0; i <= 512; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke(); }
  ctx.globalAlpha = 1; ctx.strokeStyle = token("brand-dark"); ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(24, 370); ctx.lineTo(488, 100); ctx.stroke();
  ctx.strokeStyle = token("ink"); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(256, 256, 93, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = token("brand"); ctx.beginPath(); ctx.arc(324, 285, 37, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = token("ink"); ctx.font = `500 28px ${colors.getPropertyValue("--font-sans")}`;
  ctx.fillText("09 / HOME", 140, 95); ctx.fillText("Aa  123", 145, 280);
  ctx.font = `16px ${colors.getPropertyValue("--font-sans")}`; ctx.fillText("01     02     03     04", 140, 451);
  return source;
}

