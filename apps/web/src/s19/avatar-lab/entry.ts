// 只有独立 HTML 引用；不接入 App、用户资料或正式路由，也不进入正常生产构建。
if (import.meta.env.DEV) void import("./lab.js");
