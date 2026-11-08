// 独立开发入口，无业务初始化、偏好写入、路由注册或生产构建入口。
if (import.meta.env.DEV) {
  document.documentElement.dataset.themeMode = "light";
  document.documentElement.dataset.themePalette = "green";
  document.documentElement.dataset.componentGallery = "true";
  void import("./Gallery.js");
}
