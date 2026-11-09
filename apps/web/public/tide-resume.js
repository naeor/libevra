/*
 * 切换账本时的整页重新载入（1.19.47 / 1.19.48）：上一页的账本空间海浪转场盖满整屏后，把最后一帧存进 sessionStorage
 * （见 src/s19/motion/tide.ts）。本脚本在 <head> 里同步执行、早于新页面第一次绘制，把这一帧铺满屏幕，
 * 所以重新载入期间看到的是同一道海浪，而不是白屏；入口（main.tsx）在第一次渲染前换成会动的浪，协调器挂载后接着划过。
 * 等待稍久时浪里的提示（::before）也在这里接上：位置、颜色、投影来自交接帧，淡入按上一页定下的同一时刻计时。
 *
 * 普通（非模块）脚本：生产环境的 CSP 只允许同源脚本（不允许内联）。只读 sessionStorage，不发请求。
 * 安全阀：12 秒后仍没有接手（脚本载入失败等）就淡出铺底。开发服务器经局域网载入可能要好几秒，不能太短。
 */
(function () {
  try {
    var raw = sessionStorage.getItem("libevra.tide-resume");
    if (!raw) return;
    var frame = JSON.parse(raw);
    if (!frame || !frame.image || Date.now() - frame.at > 10000) { sessionStorage.removeItem("libevra.tide-resume"); return; }
    var root = document.documentElement;
    root.setAttribute("data-tide-resume", "");
    root.style.setProperty("--tide-resume-image", 'url("' + frame.image + '")');
    root.style.setProperty("--tide-resume-color", frame.color || "transparent");
    if (typeof frame.hint === "string" && frame.hint && !/[\u0000-\u001f"\\]/.test(frame.hint)) {
      root.style.setProperty("--tide-resume-hint", '"' + frame.hint + '"');
      root.style.setProperty("--tide-resume-hint-y", (Math.min(0.9, Math.max(0.1, Number(frame.hintY) || 0.5)) * 100).toFixed(2) + "%");
      if (frame.hintColor) root.style.setProperty("--tide-resume-hint-color", frame.hintColor);
      if (frame.hintShadow) root.style.setProperty("--tide-resume-hint-shadow", frame.hintShadow);
      root.style.setProperty("--tide-resume-hint-fade", (Number(frame.hintFade) || 200) + "ms");
      root.style.setProperty("--tide-resume-hint-delay", Math.round((Number(frame.hintAt) || 0) - Date.now()) + "ms");
    }
    setTimeout(function () {
      if (!root.hasAttribute("data-tide-resume")) return;
      root.setAttribute("data-tide-resume", "fade");
      setTimeout(function () {
        if (root.getAttribute("data-tide-resume") !== "fade") return;
        root.removeAttribute("data-tide-resume");
        ["--tide-resume-image", "--tide-resume-color", "--tide-resume-hint", "--tide-resume-hint-y", "--tide-resume-hint-color",
          "--tide-resume-hint-shadow", "--tide-resume-hint-fade", "--tide-resume-hint-delay"].forEach(function (name) { root.style.removeProperty(name); });
      }, 220);
    }, 12000);
  } catch (e) { /* 存储不可用：照常载入 */ }
})();
