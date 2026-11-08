// 独立 HTML 的测试入口；正常 App 不引用，正式构建不包含此入口。
if (import.meta.env.DEV || __S19_STYLE_LAB__) void import("../../../../../experiments/motion-lab/lab.js");
