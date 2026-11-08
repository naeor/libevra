// 独立开发 HTML；正式 App 与正常构建不引用，不读取或保存用户偏好。
if (import.meta.env.DEV) {
  document.documentElement.dataset.themeMode = "light";
  document.documentElement.dataset.themePalette = "green";
  void import("./lab.js");
}
