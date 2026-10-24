/**
 * `format` 文案：日期、货币等格式化时需要的词（源语言：简体中文）。
 *
 * ⚠️ 数字、日期、月份名称本身由 `Intl` 按语言生成，这里只放 `Intl` 给不了或产品有固定说法的词。
 */
const format = {
  today: "今天",
  yesterday: "昨天",
  currency: {
    CNY: "人民币",
    USD: "美元",
    EUR: "欧元",
    JPY: "日元",
    HKD: "港币",
    GBP: "英镑",
  },
};

export default format;
