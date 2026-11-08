/** 读取共享 CSS 边缘令牌，不采样截图或页面像素。原生工具栏最终由浏览器决定。 */
export function startWallpaperEdges(): void {
  const root = document.documentElement;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.append(meta); }
  const probe = document.createElement("span"); probe.hidden = true; probe.style.color = "var(--lv-wallpaper-edge-top)";
  document.body.append(probe);
  const update = () => {
    const color = getComputedStyle(probe).color;
    const srgb = color.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    meta!.content = srgb ? `#${srgb.slice(1, 4).map(value => Math.round(Number(value) * 255).toString(16).padStart(2, "0")).join("")}` : color;
  };
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ["data-wallpaper", "data-visual-style", "data-theme-mode", "data-theme-palette", "style"] });
  update();
}
