// 独立开发入口，与现有 Motion / Avatar Lab 共用 Vite；正常生产入口不引用。
if (import.meta.env.DEV) void import("./lab.js");
