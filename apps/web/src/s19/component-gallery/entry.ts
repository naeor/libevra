// 独立开发文档。正式主题/存储不参与样板。
if (import.meta.env.DEV) {
  const root = document.documentElement;
  root.dataset.themeMode = "light";
  root.dataset.themePalette = "green";
  root.dataset.componentGallery = "true";
  if (new URLSearchParams(location.search).get("shot") === "dark-study") {
    // 现有四风格结构、选中和运动只在 light 开门。此键仅选择原呈现器，暗色由独立候选令牌提供。
    root.dataset.darkStudy = "true";
    root.style.colorScheme = "dark";
    void import("./DarkStudy.js");
  } else {
    void import("./Gallery.js");
  }
}