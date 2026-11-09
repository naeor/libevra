/*
 * 切换账本时的整页重新载入（1.19.47）：上一页的账本空间海浪转场盖满整屏后，把最后一帧存进 sessionStorage
 * （见 src/s19/motion/tide.ts）。本脚本在 <head> 里同步执行、早于新页面第一次绘制，把这一帧铺满屏幕，
 * 所以重新载入期间看到的是同一道海浪，而不是白屏；协调器挂载后从同一帧接着向下划过、撤掉这层铺底。
 *
 * 普通（非模块）脚本：生产环境的 CSP 只允许同源脚本（不允许内联）。只读 sessionStorage，不发请求。
 * 安全阀：4 秒后无论如何撤掉铺底（协调器没有接手时，例如换了风格或尺寸）。
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
    setTimeout(function () {
      root.removeAttribute("data-tide-resume");
      root.style.removeProperty("--tide-resume-image");
      root.style.removeProperty("--tide-resume-color");
    }, 4000);
  } catch (e) { /* 存储不可用：照常白屏载入 */ }
})();
