/**
 * 让 `t("...")` 的键在类型检查时就被核对：写错 / 不存在的键直接报错。
 * 键的定义来自源语言 `zh-CN`。
 */
import "i18next";

import type { TranslationResource } from "./resources/index.js";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: TranslationResource;
    };
    returnNull: false;
  }
}
