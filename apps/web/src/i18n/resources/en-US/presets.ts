import type { Messages } from "../../types.js";
import type zh from "../zh-CN/presets.js";

/** `presets` (English): display names for the built-in categories and payment methods only. */
const presets: Messages<typeof zh> = {
  category: {
    餐饮: "Food & drink",
    娱乐: "Entertainment",
    服务: "Services",
    购物: "Shopping",
    教育: "Education",
    转账: "Transfers",
    生活缴费: "Bills & utilities",
    交通: "Transport",
    其他: "Other",
    工资: "Salary",
    奖金: "Bonus",
    理财: "Investments",
    退款: "Refunds",
    暂无分类: "Uncategorized",
  },
  categoryDescription: {
    expense: {
      餐饮: "Everyday meals and drinks",
      娱乐: "Games, streaming and leisure",
      服务: "Phone, memberships and other services",
      购物: "Household items and other purchases",
      教育: "Tuition, courses and training",
      转账: "Money sent to other people",
      生活缴费: "Rent, utilities, building fees and other fixed costs",
      交通: "Commuting, fuel and travel",
      其他: "Spending that fits none of the above",
    },
    income: {
      转账: "Money received from other people",
      工资: "Wages and pay for work",
      奖金: "Year-end bonuses and other rewards",
      理财: "Investment returns, interest and dividends",
      退款: "Returns and refunded charges",
      其他: "Income that fits none of the above",
    },
    暂无分类: "Entries saved without a category",
  },
  paymentMethod: {
    微信: "WeChat Pay",
    支付宝: "Alipay",
    银行卡: "Bank card",
    现金: "Cash",
    其他: "Other",
  },
};

export default presets;
