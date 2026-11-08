// i18n-ignore-file 独立本机材质实验的中文错误提示。
import { makeLensBackground } from "./lens.js";
import { DEFAULT_STAGE, glassLayout, usesTexture, type BackgroundPattern, type SceneMotion, type StageConfig } from "./optics-model.js";
import { createOpticsRenderer, type OpticsRenderer } from "./optics-renderer.js";
export interface StageSnapshot { mode: StageConfig["mode"]; width: number; height: number; dpr: number; viewportScale: number; contextLosses: number; failure: string; renderer: ReturnType<OpticsRenderer["stats"]> | null }
export interface OpticalStage { configure(config: StageConfig): void; frame(motion: SceneMotion, elapsed: number): void; snapshot(): StageSnapshot; dispose(): void }
export function createOpticalStage(host: HTMLDivElement, onFailure: (message: string) => void = () => {}): OpticalStage {
  let pattern: BackgroundPattern = "scene", source = makeLensBackground(pattern), url = source.toDataURL();
  const background = document.createElement("div"), surfaces = document.createElement("div");
  background.className = "ol-optics-background"; surfaces.className = "ol-optics-surfaces";
  background.setAttribute("aria-hidden", "true"); surfaces.setAttribute("aria-hidden", "true");
  host.append(background, surfaces);
  let config: StageConfig = DEFAULT_STAGE, renderer: OpticsRenderer | null = null, canvas: HTMLCanvasElement | null = null;
  let width = 0, height = 0, contextLosses = 0, failure = "", disposed = false, dirty = true, lastMotion: SceneMotion = "static", lastTime = 0;
  const release = () => { renderer?.dispose(); renderer = null; canvas?.remove(); canvas = null; };
  const fail = (message: string) => { if (disposed) return; if (message.includes("上下文丢失")) contextLosses++; failure = message; release(); config = { ...config, mode: "baseline" }; dirty = true; draw("static", 0); onFailure(message); };
  const prepareBackground = () => {
    const count = config.compare ? 2 : 1;
    if (background.childElementCount !== count) {
      background.replaceChildren(...Array.from({ length: count }, () => { const pane = document.createElement("div"); pane.style.backgroundImage = `url("${url}")`; return pane; }));
    }
    background.style.gridTemplateColumns = `repeat(${count},1fr)`;
    for (const pane of background.children) { (pane as HTMLElement).style.backgroundSize = `${height}px ${height}px`; (pane as HTMLElement).style.backgroundImage = `url("${url}")`; }
  };
  const draw = (motion: SceneMotion, elapsed: number) => {
    if (disposed || !width || !height || (!dirty && motion === "static" && lastMotion === "static")) return;
    lastMotion = motion; lastTime = elapsed; dirty = false;
    const shift = motion === "background" ? -(elapsed / 1000 * 26) % height : 0;
    for (const pane of background.children) (pane as HTMLElement).style.backgroundPosition = `center ${shift}px`;
    const glasses = glassLayout(width, height, config, motion, elapsed);
    if (usesTexture(config.mode) && renderer) { surfaces.hidden = true; renderer.render(config, glasses, shift); return; }
    surfaces.hidden = false;
    if (surfaces.childElementCount !== glasses.length) surfaces.replaceChildren(...glasses.map(() => {
      const shell = document.createElement("div"); shell.className = "ol-optics-shell lv-material-effects"; shell.append(document.createElement("span")); return shell;
    }));
    glasses.forEach((item, i) => {
      const shell = surfaces.children[i] as HTMLElement;
      shell.dataset.enhanced = String(config.mode === "css" && !item.reference);
      shell.dataset.frosted = String(config.mode === "css" && config.material === "frosted");
      shell.style.width = `${item.halfWidth * 2}px`; shell.style.height = `${item.halfHeight * 2}px`; shell.style.borderRadius = `${item.radius}px`;
      shell.style.transform = `translate(${item.x - item.halfWidth}px,${item.y - item.halfHeight}px)`;
      shell.style.setProperty("--ol-scatter", `${config.optics.roughness * 7}px`);
      shell.style.setProperty("--ol-angle", `${config.optics.angle}deg`);
    });
  };
  const resize = () => {
    if (disposed) return;
    const bounds = host.getBoundingClientRect(); width = host.clientWidth; height = host.clientHeight;
    if (!bounds.width || !height) return;
    renderer?.resize(width, height, config); prepareBackground(); dirty = true; draw(lastMotion, lastTime);
  };
  const observer = new ResizeObserver(resize); observer.observe(host); window.addEventListener("resize", resize);
  const configure = (next: StageConfig) => {
    if (disposed) return; config = { ...next, optics: { ...next.optics } }; failure = ""; dirty = true;
    if ((config.pattern ?? "scene") !== pattern) { pattern = config.pattern ?? "scene"; source = makeLensBackground(pattern); url = source.toDataURL(); release(); }
    if (!usesTexture(config.mode)) release();
    else if (!renderer) {
      canvas = document.createElement("canvas"); canvas.className = "ol-optics-canvas"; canvas.setAttribute("aria-hidden", "true"); host.append(canvas);
      try { renderer = createOpticsRenderer(canvas, source, fail); } catch (error) { fail(error instanceof Error ? error.message : "光学绘制不可用，已退回普通玻璃。"); }
    }
    resize();
  };
  configure({ ...DEFAULT_STAGE, mode: "baseline" });
  return { configure, frame: draw, snapshot: () => ({ mode: config.mode, width, height, dpr: devicePixelRatio, viewportScale: window.visualViewport?.scale ?? 1, contextLosses, failure, renderer: renderer?.stats() ?? null }),
    dispose() { if (disposed) return; disposed = true; observer.disconnect(); window.removeEventListener("resize", resize); release(); background.remove(); surfaces.remove(); },
  };
}
