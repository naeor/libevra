import type { Messages } from "../../types.js";
import type zh from "../zh-CN/format.js";

/** `format` (English). Must mirror zh-CN key for key. */
const format: Messages<typeof zh> = {
  today: "Today",
  yesterday: "Yesterday",
  currency: {
    CNY: "Chinese yuan",
    USD: "US dollar",
    EUR: "Euro",
    JPY: "Japanese yen",
    HKD: "Hong Kong dollar",
    GBP: "British pound",
  },
};

export default format;
