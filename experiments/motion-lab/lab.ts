import { PaneHistory } from "../../apps/web/src/workspace/paneHistory.js";
import { BackdropStore, ambientCss, defaults, directionFor, type BackdropContext, type Material, type MotionOptions, type Scene, type VisualScope } from "../../apps/web/src/s19/motion/backdrop.js";
import { MotionEngine, percentile } from "../../apps/web/src/s19/motion/engine.js";
import { DEFAULT_GLASS_BLUR, glassMaterial, motionBlur } from "../../apps/web/src/s19/material.js";
import { B2_GLASS_PRESETS, B2_GLASS_PRESET_NAMES, B2_OLD_PAGE_RETREAT, b2GlassMaterial, type B2GlassMode, type B2GlassPreset } from "../../apps/web/src/s19/b2Glass.js";
import { describePlane, layoutBackground, type AmbientLayout } from "./ambient.js";
import "../../apps/web/src/s19/motion/motion.css";
import "./lab.css";

// 独立 HTML 入口，不加载 App、业务查询、登录、同步或底部 Tab 实验。
const root = document.querySelector<HTMLElement>("#motion-lab")!;
document.documentElement.dataset.motionLab = "true";
root.innerHTML = `
  <aside class="ml-tools"><div class="ml-brand"><b>Libevra <span>Motion Lab</span></b><small>本机实验 · 示例数据</small></div>
    <details open><summary>比较与测试</summary><div class="ml-options">
      <label>渲染方案<select id="scheme"><option value="hybrid">D · Hybrid Snapshot + Ambient</option><option value="native">B · Native Snapshot</option><option value="ambient">C · Shared Ambient</option><option value="live">A · Live DOM Blur</option></select></label>
      <label>材质<select id="material"><option value="b2">B2 · Layered Glass</option><option value="b1">B1 · Ambient Frost</option><option value="a">A · Soft Spatial</option><option value="c">C · Classic Refined</option></select></label>
      <label>时长<select id="duration"><option>180</option><option selected>200</option><option>220</option></select></label>
      <label>背景继承<select id="inheritance"><option value="source">来源页面描述</option><option value="shared">固定环境（对照）</option><option value="off">各页默认（对照）</option></select></label>
      <label class="ml-check"><input type="checkbox" id="retreat">旧页左退 15%（B2 默认关闭）</label>
      <label class="ml-check"><input type="checkbox" id="blur" checked>模糊交接</label>
      <label class="ml-check"><input type="checkbox" id="handoff" checked>B → C 渐隐交接（D）</label>
    </div>
    <fieldset id="transparency-controls" class="ml-blur-controls"><legend>玻璃透视比例 · B2</legend>
      <div class="ml-actions">${B2_GLASS_PRESET_NAMES.map(key => `<button data-glass-preset="${key}">${({ clear: "清透", balanced: "均衡", soft: "柔和" })[key]}</button>`).join("")}</div><p id="glass-mode"></p>
      <label for="ambient-opacity">旧页透出强度 <span id="ambient-opacity-value"></span></label>
      <input id="ambient-opacity" type="range" min="0" max="100" aria-describedby="ambient-opacity-hint">
      <p id="ambient-opacity-hint">旧页模糊环境与空间轮廓：0 隐藏 → 100 完整透出。</p>
      <label for="content-transparency">内容玻璃透明度 <span id="content-transparency-value"></span></label>
      <input id="content-transparency" type="range" min="0" max="100" aria-describedby="content-transparency-hint">
      <p id="content-transparency-hint">资料、列表、概览、设置与阅读卡片：0 实心 → 100 透明；文字不变淡。</p>
      <label for="chrome-transparency">顶底栏玻璃透明度 <span id="chrome-transparency-value"></span></label>
      <input id="chrome-transparency" type="range" min="0" max="100" aria-describedby="chrome-transparency-hint">
      <p id="chrome-transparency-hint">顶底栏、语言分段、选中 Tab、胶囊、返回与加号操作块：0 实心 → 100 透明。</p>
      <div class="ml-actions"><button id="transparency-reset">恢复默认（均衡）</button></div>
      <p>仅本实验会话，四种渲染方案共用；刷新恢复默认，不写入外观偏好。</p>
    </fieldset>
    <div id="blur-tools"><fieldset id="blur-controls" class="ml-blur-controls"><legend>玻璃模糊程度 · B1 / B2</legend>
      <label for="glass-blur">清晰 ← <span id="glass-blur-value"></span> → 朦胧</label>
      <input id="glass-blur" type="range" min="0" max="100" step="1" aria-label="玻璃模糊强度">
      <div class="ml-actions"><button type="button" data-blur="35">较低模糊</button><button type="button" data-blur="${DEFAULT_GLASS_BLUR}">新默认</button><button type="button" data-blur="100">旧版模糊</button></div>
      <p>与正式 B2 预设共用四项参数映射；本实验自由调整，不改账号的外观偏好。</p>
    </fieldset><p id="glass-parameters"></p></div><p id="scheme-note"></p>
    <details id="review-tools"><summary>逐帧检查（不计性能）</summary><label class="ml-check"><input type="checkbox" id="review-enabled">下一次 B / D 转场暂停检查</label><label>进度 <input id="review-progress" type="range" min="0" max="100" value="50"></label><button id="review-resume">继续动画</button><p>暂停最多 20 秒。拖动检查卡片轮廓、环境颜色和最后一帧；任何导航仍可立即中断。</p></details>
    <div class="ml-actions"><button id="back">返回一层</button><button id="forward">浏览器前进</button><button id="rapid">快速进入并反向</button><button id="scope">切换模拟账本</button><button id="tab">切换模拟主 Tab</button></div>
    <div class="ml-actions"><button id="focus">全屏体验</button><button id="selfcheck">功能自检</button><button id="benchmark">3 分钟比较</button><button id="stop">停止</button><button id="download">保存本机数据</button></div>
    <p id="bench-note">手动：A→B→A；A→C 与 B→C；B→C→D→C；A→B→C→D→C→B→A。长页向下滚动后再进入 D。</p>
    <a class="ml-pilot" href="/me?motion=1&s19=b2">进入真实路径试点：我的 → 设置 → 语言</a>
    <p><a id="abc-lab" class="ml-pilot">A / B1 / C 转场与 A 底栏实验（独立服务 5193）</a></p>
    </details>
    <output id="state" aria-live="polite"></output>
    <details><summary>测量边界与结果</summary><pre id="metrics"></pre><p>3 分钟比较仅运行 B / C / D，每种约 1 分钟。首帧是提交后的首个 rAF；输入开放估计取原生 ready / DOM 提交时刻，不是实测点击延迟；交接帧窗口取 ready 后 40%–95%。均非 GPU 合成成本或屏幕呈现 FPS。原生快照只报告申请数与 RGBA 下限，不伪报 GPU 占用。后台会停止测试。</p><label>真机主观评价（机型、系统、闪白/残影、流畅度）<textarea id="device-notes" rows="3" placeholder="尚未真机评价；与本机 JSON 一起保存"></textarea></label></details>
  </aside><section class="ml-preview" aria-label="手机转场实验"><div id="motion-stage"></div></section><button class="ml-return-tools" id="tools">实验参数</button>`;
const stage = document.querySelector<HTMLElement>("#motion-stage")!;
const output = document.querySelector<HTMLOutputElement>("#state")!;
const metrics = document.querySelector<HTMLElement>("#metrics")!;
const note = document.querySelector<HTMLElement>("#scheme-note")!;
const benchNote = document.querySelector<HTMLElement>("#bench-note")!;
const options: MotionOptions = { ...defaults, scheme: "hybrid", retreat: B2_OLD_PAGE_RETREAT, blurStrength: B2_GLASS_PRESETS.balanced.blur };
const transparency = { ...B2_GLASS_PRESETS.balanced } as { ambient: number; content: number; chrome: number; blur: number };
let glassMode: B2GlassMode = "balanced";
const abcUrl = new URL(window.location.href); abcUrl.port = "5193"; abcUrl.pathname = "/"; abcUrl.search = ""; abcUrl.hash = "";
document.querySelector<HTMLAnchorElement>("#abc-lab")!.href = abcUrl.href;
// 与真实 entry key 同寿命；只存来源当时可见的无文字轮廓，最多 64 × 48 个几何块。
const layouts = new Map<string, AmbientLayout>();
const store = new BackdropStore();
const history = new PaneHistory("motion-lab", []);
history.adopt(window);
window.history.scrollRestoration = "manual";
const edges = [["A", "B"], ["A", "C"], ["B", "C"], ["C", "D"]] as const;
const names: Record<string, string> = { A: "我的", B: "设置", C: "语言与阅读", D: "更新说明" };
let scopeNumber = 1;
const scope = (): VisualScope => ({ workspace: history.id, account: "lab-local", ledger: `demo-${scopeNumber}`, style: `${options.material}:${options.inheritance}` });
const pageOf = (search: string): string => {
  const page = new URLSearchParams(search).get("page") ?? "A";
  return Object.hasOwn(names, page) ? page : "A";
};
let current = store.ensure(history.location.key, pageOf(history.location.search), scope(), undefined, options.inheritance);
let plane: HTMLElement;
let retained: HTMLElement | null = null;
let pendingBack = false;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let benchToken = 0;
let benchmarkRunning = false;
let benchmarkSummary: Record<string, unknown> = {};
let benchmarkSamples: Record<string, typeof engine.samples> = {};
let maxPlanes = 0;
let maxSnapshots = 0;
const engine = new MotionEngine(updatePanel);

function materialParameters() {
  return options.material === "b2" ? b2GlassMaterial(transparency, glassMode) : options.material === "b1" ? glassMaterial("b1", options.blurStrength) : null;
}
function environment(scene: Scene): string { return ambientCss(scene.ambient, materialParameters()?.environmentSpread ?? 1); }
function backdrop(context: BackdropContext): string {
  if (options.material !== "b2") return environment(context);
  const geometry = layoutBackground(layouts.get(context.entryKey), transparency.ambient,
    motionBlur("b2", options.blurStrength, options.blur).outgoingBlur, options.retreat);
  // 同一底层用于普通 DOM、原生快照组与 D 的交接终点。
  const veil = `color-mix(in srgb, var(--color-canvas) ${b2GlassMaterial(transparency).ambientVeil}, transparent)`;
  return [geometry, `linear-gradient(${veil}, ${veil})`, environment(context)].filter(Boolean).join(", ");
}
function paintBackdrop(): void {
  const background = backdrop(current);
  stage.style.background = background;
  document.documentElement.style.setProperty("--ml-transition-backdrop", background);
}
function applyTransparency(): void {
  const mapped = b2GlassMaterial(transparency, glassMode);
  document.documentElement.style.setProperty("--ml-content-fill", String(mapped.contentFill));
  document.documentElement.style.setProperty("--ml-chrome-fill", String(mapped.chromeFill));
  document.documentElement.style.setProperty("--ml-chrome-blur", `${mapped.chromeBlur}px`);
  document.documentElement.style.setProperty("--ml-carry", String(mapped.carry));
  document.querySelector("#glass-mode")!.textContent = `当前：${({ clear: "清透", balanced: "均衡", soft: "柔和", custom: "自定义" })[glassMode]}`;
  for (const button of document.querySelectorAll<HTMLElement>("[data-glass-preset]")) button.setAttribute("aria-pressed", String(button.dataset.glassPreset === glassMode));
  for (const [key, id] of [["ambient", "ambient-opacity"], ["content", "content-transparency"], ["chrome", "chrome-transparency"]] as const) {
    document.querySelector<HTMLInputElement>(`#${id}`)!.value = String(transparency[key]);
    document.querySelector(`#${id}-value`)!.textContent = `${transparency[key]}%`;
  }
  paintBackdrop();
}
function applyMaterial(): void {
  const params = materialParameters();
  stage.style.setProperty("--ml-surface-blur", `${params?.surfaceBlur ?? 14}px`);
  stage.style.setProperty("--ml-milk", String(params?.milk ?? 1));
  document.querySelector<HTMLFieldSetElement>("#blur-controls")!.disabled = !params;
  document.querySelector<HTMLFieldSetElement>("#transparency-controls")!.disabled = options.material !== "b2";
  document.documentElement.dataset.mlTransparency = String(options.material === "b2");
  applyTransparency();
  document.querySelector<HTMLOptionElement>('#scheme option[value="hybrid"]')!.disabled = options.material !== "b2";
  document.querySelector<HTMLInputElement>("#handoff")!.disabled = options.scheme !== "hybrid";
  document.querySelector<HTMLInputElement>("#glass-blur")!.value = String(options.blurStrength);
  document.querySelector("#glass-blur-value")!.textContent = `${options.blurStrength} / 100`;
  for (const button of document.querySelectorAll<HTMLElement>("[data-blur]")) button.setAttribute("aria-pressed", String(Number(button.dataset.blur) === options.blurStrength));
  document.querySelector("#glass-parameters")!.textContent = params
    ? `环境扩散 ${params.environmentSpread} · 玻璃 ${params.surfaceBlur}px · 旧页上限 ${options.blur ? params.outgoingBlur : 0}px${options.material === "b2" ? ` · 顶底栏 ${b2GlassMaterial(transparency, glassMode).chromeBlur}px · 卡片填充 ${100 - transparency.content}% · 操作层填充 ${100 - transparency.chrome}%` : ` · 乳白 ${params.milk}`}`
    : "A / C 材质不受实验玻璃参数影响。";
}

function button(page: string, title: string, hint: string): string {
  return `<button class="ml-row" data-page="${page}"><span><strong>${title}</strong><small>${hint}</small></span><span aria-hidden="true">›</span></button>`;
}
function makePlane(scene: Scene, interactive: boolean): HTMLElement {
  const node = document.createElement("article");
  node.className = "ml-plane";
  node.dataset.page = scene.page;
  node.dataset.material = options.material;
  node.innerHTML = `<div class="ml-environment" style="background:${environment(scene)}"></div>
    <header class="ml-top"><button data-back aria-label="返回">‹</button><span>${names[scene.page]}</span><span class="ml-pill">${scene.page}</span></header>
    <div class="ml-scroll"><h1 tabindex="-1">${names[scene.page]}</h1><p class="ml-subtitle">${scene.page === "A" ? "把日常收进生活里" : "Libevra · 你的偏好，随时调整"}</p>
    ${scene.page === "A" ? `<section class="ml-card ml-profile"><span class="ml-avatar">N</span><div><h2>naeor</h2><p>日常账本 · 本地演示</p></div><span class="ml-pulse" aria-hidden="true"></span></section><div class="ml-card">${button("B", "设置", "外观、语言与使用偏好")}${button("C", "语言与阅读", "直接进入 C · 对比来源 A")}</div><section class="ml-card"><h2>这个月的小计划</h2><p>多走一段路，多记录一点生活。</p><div class="ml-bars"><i></i><i></i><i></i><i></i><i></i><i></i></div></section><section class="ml-card"><h2>最近记录</h2><div class="ml-record">☕ 早餐与咖啡 <b>¥ 28.00</b></div><div class="ml-record">🌿 周末出行 <b>¥ 126.00</b></div></section>` : ""}
    ${scene.page === "B" ? `<section class="ml-card"><h2>外观与使用</h2>${button("C", "语言与阅读", "进入 C · 背景继承设置页 B")}<div class="ml-record">外观主题 <b>森林绿</b></div><div class="ml-record">文字大小 <b>标准</b></div></section><section class="ml-card ml-warm"><h2>属于你的界面</h2><p>在不同设备上保留习惯。这里的卡片和暖色轮廓，帮助观察下一层玻璃的交接。</p><div class="ml-bars"><i></i><i></i><i></i></div></section>` : ""}
    ${scene.page === "C" ? `<section class="ml-card"><h2>界面语言</h2><div role="radiogroup" aria-label="实验语言"><button class="ml-row" data-language="跟随系统" role="radio" aria-checked="true">跟随系统 <span>✓</span></button><button class="ml-row" data-language="简体中文" role="radio" aria-checked="false">简体中文</button><button class="ml-row" data-language="English" role="radio" aria-checked="false">English</button></div></section><section class="ml-card">${button("D", "更新说明", "进入 D 后返回，检查 C 的背景身份")}</section>${Array.from({ length: 12 }, (_, i) => `<section class="ml-card"><h2>阅读偏好 ${i + 1}</h2><p>柔和的背景保留颜色与结构，前景文字仍然清晰。滚动到这里，再进入下一层。</p>${i === 5 || i === 11 ? button("D", "从这里进入更新说明", "返回后保持当前滚动位置") : ""}</section>`).join("")}` : ""}
    ${scene.page === "D" ? Array.from({ length: 20 }, (_, i) => `<section class="ml-card"><small>更新说明 · ${String(i + 1).padStart(2, "0")}</small><h2>${["更轻盈的日常", "让记录保持连续", "为每一页保留来路"][i % 3]}</h2><p>这些是固定的实验数据。你可以滚动、返回、快速进入；导航先完成，动画可以随时被新操作中断。</p><p>玻璃卡片透出柔和的环境，而文字保持在前景。返回语言页时，应恢复原来的来源与滚动位置。</p></section>`).join("") : ""}
    <p class="ml-footnote">独立实验 · 不写入真实账本</p></div>
    ${scene.page === "A" ? `<footer class="ml-footer"><span>明细</span><span>分析</span><span class="ml-plus">＋</span><span>协作</span><b>我的</b></footer>` : `<footer class="ml-footer ml-small">本机示例 · 背景来源按 entry key 保存</footer>`}`;
  node.inert = !interactive;
  node.querySelector('[role="radiogroup"]')?.classList.add("ml-segmented");
  node.querySelector(".ml-footer b")?.classList.add("ml-tab-active");
  if (!interactive) node.setAttribute("aria-hidden", "true");
  if (interactive) node.addEventListener("click", event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button");
    if (!target) return;
    if (target.hasAttribute("data-back")) back();
    if (target.dataset.page) push(target.dataset.page);
    if (target.dataset.language) {
      for (const radio of node.querySelectorAll("[role=radio]")) radio.setAttribute("aria-checked", String(radio === target));
    }
  });
  return node;
}
function scroller(node: HTMLElement): HTMLElement { return node.querySelector<HTMLElement>(".ml-scroll")!; }
function sceneOf(context: BackdropContext): Scene { return { page: context.page, scroll: context.scroll, ambient: context.ambient }; }
function dropRetained(): void { retained?.remove(); retained = null; }
function retain(node: HTMLElement): void {
  dropRetained();
  node.inert = true; node.setAttribute("aria-hidden", "true"); node.classList.add("ml-retained");
  node.style.zIndex = "0";
  node.style.transform = options.retreat ? "translateX(-15%)" : "none";
  node.style.filter = options.blur ? `blur(${motionBlur(options.material, options.blurStrength, true).outgoingBlur}px) contrast(.56) saturate(.8)` : "none";
  if (options.material === "b2") node.style.opacity = String(transparency.ambient / 100);
  stage.prepend(node); retained = node;
}
function restoreBackdrop(): void {
  dropRetained();
  if (options.scheme === "live" && current.sourceScene && options.inheritance === "source" && ["b1", "b2"].includes(options.material) && !document.hidden) {
    const source = makePlane(current.sourceScene, false);
    retain(source); scroller(source).scrollTop = current.sourceScene.scroll;
  }
}
function renderInitial(): void {
  applyMaterial();
  dropRetained();
  plane = makePlane(sceneOf(current), true);
  stage.replaceChildren(plane); paintBackdrop();
  scroller(plane).scrollTop = current.scroll;
  restoreBackdrop(); updatePanel();
}
function push(page: string): void {
  if (page === current.page || !edges.some(([a, b]) => a === current.page && b === page)) return;
  history.push(`/motion-lab.html?page=${page}`);
}
function back(): void {
  if (pendingBack) return;
  if (!history.canGoBack && history.previousBrowserIndex === undefined) {
    history.replace("/motion-lab.html?page=A"); return;
  }
  pendingBack = true;
  pendingTimer = setTimeout(() => { pendingBack = false; }, 250);
  history.go(-1);
}
history.subscribe(next => {
  engine.cancel();
  pendingBack = false; if (pendingTimer) clearTimeout(pendingTimer);
  current.scroll = scroller(plane).scrollTop;
  const from = current;
  const targetPage = pageOf(next.location.search);
  const known = store.get(next.location.key);
  const acceptedSource = next.action === "PUSH" && edges.some(([a, b]) => a === from.page && b === targetPage) ? from : undefined;
  current = known ?? store.ensure(next.location.key, targetPage, scope(), acceptedSource, options.inheritance);
  if (!known && acceptedSource && options.material === "b2" && options.inheritance === "source") {
    layouts.set(current.entryKey, describePlane(plane));
  }
  store.prune(history.serialize().entries.map(entry => entry.key));
  for (const key of layouts.keys()) if (!store.get(key)) layouts.delete(key);
  const direction = directionFor(from, current, next.action, edges, true);
  const old = plane;
  const target = makePlane(sceneOf(current), true);
  const isLive = options.scheme === "live" && options.inheritance === "source" && ["b1", "b2"].includes(options.material);
  const commit = (): void => {
    dropRetained(); old.inert = true; old.setAttribute("aria-hidden", "true");
    plane = target;
    if (options.scheme === "native" || options.scheme === "hybrid") stage.replaceChildren(target);
    else { stage.append(target); old.style.zIndex = direction === "pop" ? "2" : "0"; target.style.zIndex = "1"; }
    paintBackdrop();
    scroller(target).scrollTop = current.scroll;
    target.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  };
  const settle = (): void => {
    old.remove();
    if (isLive && direction === "push") { retain(old); }
    else restoreBackdrop();
    updatePanel();
  };
  engine.run(options, direction, commit, { old, next: target, settle }, { ambient: backdrop(current) });
});

function summary(): Record<string, unknown> {
  const rows = engine.samples.filter(row => !row.inspection);
  const frames = rows.flatMap(row => row.frames);
  const fmt = (n: number | null): number | null => n === null ? null : Math.round(n * 10) / 10;
  return {
    samples: rows.length, firstRafP95Ms: fmt(percentile(rows.flatMap(r => r.firstRafMs === null ? [] : [r.firstRafMs]), .95)),
    frameP95Ms: fmt(percentile(frames, .95)), frameP99Ms: fmt(percentile(frames, .99)), longFramesOver50Ms: frames.filter(n => n > 50).length,
    completionP95Ms: fmt(percentile(rows.filter(r => !r.interrupted && !r.fallback).map(r => r.elapsedMs), .95)),
    commitP95Ms: fmt(percentile(rows.flatMap(r => r.commitMs === null ? [] : [r.commitMs]), .95)),
    inputReadyP95Ms: fmt(percentile(rows.flatMap(r => r.inputReadyMs === null ? [] : [r.inputReadyMs]), .95)),
    captureReadyP95Ms: fmt(percentile(rows.flatMap(r => r.captureReadyMs === null ? [] : [r.captureReadyMs]), .95)),
    handoffFrameP95Ms: fmt(percentile(rows.flatMap(r => r.handoffFrames), .95)),
    handoffLongFramesOver50Ms: rows.flatMap(r => r.handoffFrames).filter(n => n > 50).length,
    ambientFallbacks: rows.filter(r => r.fallbackMode === "ambient").length,
    interruptions: engine.interruptions, fallbacks: engine.fallbacks, descriptions: store.size,
    activeNativeSnapshots: engine.snapshots, maxNativeSnapshots: maxSnapshots, livePlanes: stage.querySelectorAll(".ml-plane").length,
    maxLivePlanes: maxPlanes, bitmapCacheBytes: 0, domNodes: stage.querySelectorAll("*").length,
    ambientLayouts: layouts.size, ambientShapes: layouts.get(current.entryKey)?.shapes.length ?? 0, transparency: { ...transparency }, glassMode,
    nativeRgbaLowerBoundBytes: Math.round(stage.clientWidth * stage.clientHeight * devicePixelRatio ** 2 * 4 * engine.snapshots),
    descriptionEvictions: store.evictions,
  };
}
function updatePanel(): void {
  if (!plane) return;
  maxPlanes = Math.max(maxPlanes, stage.querySelectorAll(".ml-plane").length);
  maxSnapshots = Math.max(maxSnapshots, engine.snapshots);
  const state = {
    page: current.page, entryKey: current.entryKey, sourceKey: current.sourceKey,
    backdrop: current.ambient, sourceType: current.sourceType, scheme: options.scheme,
    state: engine.active ? "running" : "idle", phase: engine.phase, snapshots: engine.snapshots, descriptions: store.size,
    livePlanes: stage.querySelectorAll(".ml-plane").length, scope: scopeNumber,
  };
  // 仅实验页的只读诊断，供浏览器回归；不暴露业务数据。
  Object.assign(window, { __motionLabState: state });
  output.textContent = `${current.page} · ${names[current.page]}  /  ${state.state} · ${state.phase}\nentry ${current.entryKey} ← ${current.sourceKey ?? "直接进入"}\n背景：${current.sourceType} · 色相 ${current.ambient.hue} · 描述 ${store.size}\n原生快照 ${engine.snapshots} / DOM 页面 ${state.livePlanes} / 位图缓存 0\n来源可见轮廓 ${layouts.get(current.entryKey)?.shapes.length ?? 0}（不含旧文字）`;
  metrics.textContent = JSON.stringify({ ...summary(), benchmark: benchmarkSummary }, null, 2);
  note.textContent = options.scheme === "hybrid"
    ? options.handoff ? "D · B2：透明前景快照透出模糊旧图，旧图在 85% 前淡出；底层承接来源的可见卡片、头像与图表轮廓。稳态不保留旧文字、DOM 或快照，只有无文字几何环境。直达 / 刷新无来源时仅显示默认渐变。" : "D 的交接已关闭：按 B 的原生快照路径比较，结束后仍释放快照。"
    : options.scheme === "live"
    ? "A 保留一张旧 DOM（仍有样式/动画成本），最多两张页面。返回时按示例数据、滚动和环境描述重建旧页；深层背景被压平，非精确像素恢复。"
    : options.scheme === "native"
      ? "B 捕获前景画面，仅在转场期间有效。B2 的透明前景透出旧图；停留与返回使用同一份无文字来源轮廓，不保存精确像素。无 API 时即时切换。"
      : "C 旧 DOM 模糊淡出后释放。B2 的稳定环境与 D 相同：来源渐变 + 无文字可见轮廓。其它材质沿用环境渐变。";
}
function changeOptions(): void {
  stopBenchmark(); engine.cancel(); current.scroll = scroller(plane).scrollTop;
  const previousMaterial = options.material;
  options.scheme = (document.querySelector<HTMLSelectElement>("#scheme")!).value as MotionOptions["scheme"];
  options.material = (document.querySelector<HTMLSelectElement>("#material")!).value as Material;
  if (previousMaterial !== options.material) document.querySelector<HTMLInputElement>("#retreat")!.checked = options.material === "b2" ? B2_OLD_PAGE_RETREAT : defaults.retreat;
  if (options.material === "b2") options.blurStrength = transparency.blur;
  if (options.scheme === "hybrid" && options.material !== "b2") {
    options.scheme = "native"; document.querySelector<HTMLSelectElement>("#scheme")!.value = "native";
  }
  options.duration = Number((document.querySelector<HTMLSelectElement>("#duration")!).value) as MotionOptions["duration"];
  options.inheritance = (document.querySelector<HTMLSelectElement>("#inheritance")!).value as MotionOptions["inheritance"];
  options.retreat = document.querySelector<HTMLInputElement>("#retreat")!.checked;
  options.blur = document.querySelector<HTMLInputElement>("#blur")!.checked;
  options.handoff = document.querySelector<HTMLInputElement>("#handoff")!.checked;
  if (store.setScope(scope())) { layouts.clear(); current = store.ensure(history.location.key, current.page, scope(), undefined, options.inheritance); }
  renderInitial();
}
for (const control of document.querySelectorAll(".ml-options input,.ml-options select")) control.addEventListener("change", changeOptions);
document.querySelector<HTMLInputElement>("#review-enabled")!.addEventListener("change", event => {
  if ((event.target as HTMLInputElement).checked) engine.seekInspection(Number(document.querySelector<HTMLInputElement>("#review-progress")!.value) / 100);
  else engine.resumeInspection();
});
document.querySelector<HTMLInputElement>("#review-progress")!.addEventListener("input", event => {
  if (document.querySelector<HTMLInputElement>("#review-enabled")!.checked) engine.seekInspection(Number((event.target as HTMLInputElement).value) / 100);
});
document.querySelector("#review-resume")!.addEventListener("click", () => { document.querySelector<HTMLInputElement>("#review-enabled")!.checked = false; engine.resumeInspection(); });
function changeBlur(strength: number): void {
  if (strength === options.blurStrength) return;
  stopBenchmark(); engine.cancel(); options.blurStrength = strength;
  if (options.material === "b2") { transparency.blur = strength; glassMode = "custom"; }
  applyMaterial();
  // 只刷新材质，不重建页面、不清历史、不改变已保留快照的生命周期。
  paintBackdrop();
  plane.querySelector<HTMLElement>(".ml-environment")!.style.background = environment(current);
  if (retained && current.sourceScene) {
    retained.querySelector<HTMLElement>(".ml-environment")!.style.background = environment(current.sourceScene);
    retained.style.filter = options.blur ? `blur(${motionBlur(options.material, strength, true).outgoingBlur}px) contrast(.56) saturate(.8)` : "none";
  }
}
document.querySelector<HTMLInputElement>("#glass-blur")!.addEventListener("input", event => changeBlur(Number((event.target as HTMLInputElement).value)));
for (const button of document.querySelectorAll<HTMLElement>("[data-blur]")) button.addEventListener("click", () => changeBlur(Number(button.dataset.blur)));
for (const [key, id] of [["ambient", "ambient-opacity"], ["content", "content-transparency"], ["chrome", "chrome-transparency"]] as const) {
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("input", event => {
    stopBenchmark(); engine.cancel(); transparency[key] = Number((event.target as HTMLInputElement).value); glassMode = "custom"; applyTransparency();
    if (retained) retained.style.opacity = String(transparency.ambient / 100);
    updatePanel();
  });
}
function chooseGlassPreset(preset: B2GlassPreset): void {
  stopBenchmark(); engine.cancel(); Object.assign(transparency, B2_GLASS_PRESETS[preset]); glassMode = preset;
  options.blurStrength = transparency.blur; applyMaterial();
  if (retained) {
    retained.style.opacity = String(transparency.ambient / 100);
    retained.style.filter = options.blur ? `blur(${b2GlassMaterial(transparency).outgoingBlur}px) contrast(.56) saturate(.8)` : "none";
  }
  updatePanel();
}
document.querySelector("#transparency-reset")!.addEventListener("click", () => chooseGlassPreset("balanced"));
for (const button of document.querySelectorAll<HTMLElement>("[data-glass-preset]")) button.addEventListener("click", () => chooseGlassPreset(button.dataset.glassPreset as B2GlassPreset));
document.querySelector("#back")!.addEventListener("click", back);
document.querySelector("#focus")!.addEventListener("click", () => stage.scrollIntoView({ block: "start" }));
document.querySelector("#tools")!.addEventListener("click", () => document.querySelector(".ml-tools")!.scrollIntoView({ block: "start" }));
document.querySelector("#forward")!.addEventListener("click", () => history.go(1));
document.querySelector("#rapid")!.addEventListener("click", () => {
  if (current.page === "A") push("B");
  if (current.page === "B") push("C");
  if (current.page === "C") push("D");
  back();
});
document.querySelector("#scope")!.addEventListener("click", () => {
  stopBenchmark(); engine.cancel(); scopeNumber = scopeNumber === 1 ? 2 : 1;
  store.setScope(scope()); layouts.clear(); current = store.ensure(history.location.key, current.page, scope(), undefined, options.inheritance); renderInitial();
});
document.querySelector("#tab")!.addEventListener("click", () => { stopBenchmark(); engine.cancel(); history.replace("/motion-lab.html?page=A"); });
// 输入只取消视觉，事件照常送达真实当前页；不重放 click，不阻塞业务按钮。
const cancelOnInput = (event: Event): void => { if (!(event.target instanceof Element) || !event.target.closest("#review-tools")) engine.cancel(); };
document.addEventListener("pointerdown", cancelOnInput, true);
document.addEventListener("keydown", cancelOnInput, true);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
reduced.addEventListener("change", () => engine.cancel());
window.addEventListener("resize", () => engine.cancel());
window.visualViewport?.addEventListener("resize", () => engine.cancel());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { stopBenchmark(); engine.cancel(); dropRetained(); updatePanel(); }
  else { restoreBackdrop(); updatePanel(); }
});
window.addEventListener("pagehide", () => { stopBenchmark(); engine.dispose(); store.clear(); layouts.clear(); dropRetained(); history.detach(); });
function stopBenchmark(): void { benchToken++; benchmarkRunning = false; }
document.querySelector("#stop")!.addEventListener("click", () => { stopBenchmark(); benchNote.textContent = "已停止；保留本轮测量。"; });
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
document.querySelector("#benchmark")!.addEventListener("click", () => { void benchmark(); });
async function benchmark(): Promise<void> {
  stopBenchmark();
  if (options.material !== "b2") { benchNote.textContent = "B / C / D 比较请先选择 B2 材质。"; return; }
  const token = benchToken; benchmarkRunning = true; benchmarkSummary = {}; benchmarkSamples = {};
  engine.resumeInspection(); document.querySelector<HTMLInputElement>("#review-enabled")!.checked = false;
  stage.scrollIntoView({ block: "start" });
  for (const scheme of ["native", "ambient", "hybrid"] as const) {
    if (token !== benchToken) return;
    engine.cancel(); options.scheme = scheme;
    document.querySelector<HTMLSelectElement>("#scheme")!.value = scheme;
    engine.samples = []; engine.interruptions = 0; engine.fallbacks = 0; maxPlanes = 0; maxSnapshots = 0;
    history.replace("/motion-lab.html?page=A"); renderInitial();
    const end = performance.now() + 60_000;
    let step = 0;
    while (performance.now() < end && token === benchToken) {
      benchNote.textContent = `${scheme} · 剩余 ${Math.ceil((end - performance.now()) / 1000)} 秒；可随时停止。`;
      switch (step++ % 8) {
        case 0: push("B"); break;
        case 1: push("C"); break;
        case 2: scroller(plane).scrollTop = 650; push("D"); break;
        case 3: scroller(plane).scrollTop = 900; back(); break;
        case 4: back(); break;
        case 5: back(); break;
        case 6: push("C"); push("D"); back(); break;
        case 7: back(); break;
      }
      await wait(900);
    }
    if (token !== benchToken) return;
    engine.cancel(); benchmarkSummary[scheme] = { ...summary(), options: { ...options }, transparency: { ...transparency } };
    benchmarkSamples[scheme] = structuredClone(engine.samples);
  }
  benchmarkRunning = false; benchNote.textContent = "约 3 分钟比较完成。可保存本机 JSON；请继续用手指体验。"; updatePanel();
}
document.querySelector("#selfcheck")!.addEventListener("click", () => { void selfcheck(); });
async function selfcheck(): Promise<void> {
  stopBenchmark(); const token = benchToken;
  engine.resumeInspection(); document.querySelector<HTMLInputElement>("#review-enabled")!.checked = false;
  const results: string[] = [];
  stage.scrollIntoView({ block: "start" });
  const check = (ok: boolean, message: string): void => { if (!ok) throw new Error(message); };
  const settled = async (page: string): Promise<void> => {
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline && (current.page !== page || engine.active)) await wait(10);
    if (token !== benchToken) throw new Error("已取消");
    check(current.page === page && !engine.active, `导航未完成：${page}`);
    check(stage.querySelectorAll(".ml-plane").length <= 2, "页面层数超过两层");
    check(engine.snapshots === 0, "原生快照未释放");
    check(stage.querySelectorAll(".ml-plane:not([inert])").length === 1, "可交互页面不是一层");
    check(layouts.size <= store.size, "轮廓描述未随历史裁剪");
  };
  try {
    for (const scheme of options.material === "b2" ? ["live", "native", "ambient", "hybrid"] as const : ["live", "native", "ambient"] as const) {
      engine.cancel(); options.scheme = scheme;
      document.querySelector<HTMLSelectElement>("#scheme")!.value = scheme;
      applyMaterial();
      history.replace("/motion-lab.html?page=A"); await settled("A");
      push("C"); await settled("C"); const fromA = structuredClone(current.ambient);
      back(); await settled("A"); push("B"); await settled("B"); push("C"); await settled("C");
      check(JSON.stringify(fromA) !== JSON.stringify(current.ambient), "A→C 与 B→C 背景相同");
      const identity = JSON.stringify({ key: current.entryKey, source: current.sourceKey, ambient: current.ambient });
      const savedLayout = JSON.stringify(layouts.get(current.entryKey));
      scroller(plane).scrollTop = 650; const y = scroller(plane).scrollTop;
      push("D"); await settled("D"); back(); await settled("C");
      check(identity === JSON.stringify({ key: current.entryKey, source: current.sourceKey, ambient: current.ambient }), "返回 C 背景身份改变");
      check(savedLayout === JSON.stringify(layouts.get(current.entryKey)), "返回 C 来源轮廓改变");
      check(Math.abs(scroller(plane).scrollTop - y) < 2, "返回 C 滚动未恢复");
      back(); await settled("B"); back(); await settled("A");
      const before = history.snapshot.length;
      push("B"); push("B"); push("C"); push("D"); back(); await settled("C");
      check(history.snapshot.length <= before + 3, "相同入口重复入栈");
      for (let i = 0; i < 6; i++) { push("D"); await settled("D"); back(); await settled("C"); }
      window.history.back(); await settled("B"); check(store.size <= store.limit, "描述缓存超预算");
      results.push(`${scheme}：来源区别 / 多级恢复 / 滚动 / 连点反向 / 浏览器返回 / 两层上限 / 资源释放通过`);
      benchNote.textContent = results.join("\n");
    }
  } catch (error) { results.push(`未通过：${error instanceof Error ? error.message : String(error)}`); }
  benchNote.textContent = results.join("\n"); benchmarkSummary["selfcheck"] = results; updatePanel();
}
document.querySelector("#download")!.addEventListener("click", () => {
  const payload = { recordedAt: new Date().toISOString(), userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight, devicePixelRatio], options, transparency, benchmarkRunning, summary: summary(), benchmark: benchmarkSummary, benchmarkSamples, samples: engine.samples, deviceNotes: document.querySelector<HTMLTextAreaElement>("#device-notes")!.value };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "libevra-motion-lab.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
renderInitial();
