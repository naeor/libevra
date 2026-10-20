/**
 * 概览页候选原型的演示数据。
 *
 * ⚠️ **不是真实账单，也没有接过真实识别结果**。这些条目是按 Python 侧
 * `overview.py` 的输出形状手写的合成数据，用途只有一个：让所有者在验收前先看到
 * 概览页的汇总、卡片、筛选与「有疑问」标记长什么样。
 *
 * 正式接入时，这些数据应由 `POST /api/v1/recognize` 的新能力（或等价的内部模块）
 * 提供，并经过所有者对保存边界（设计方向 §10.5）的确认。
 */

import type { OcrCandidateView } from "./ocrOverview.js";

function demoCandidate(
  overrides: Partial<OcrCandidateView> & { readonly candidateId: string },
): OcrCandidateView {
  return {
    imageIndex: 0,
    amount: null,
    currency: null,
    direction: "unknown",
    occurredLocalDate: null,
    occurredTime: null,
    merchant: null,
    sourcePlatform: null,
    account: null,
    note: null,
    status: null,
    isRefund: false,
    isTransfer: false,
    issues: [],
    duplicateSuspected: false,
    duplicateGroupIds: [],
    isComplete: false,
    isQuestionable: false,
    ...overrides,
  };
}

/**
 * 6 笔：2 笔完整可直接确认、2 笔缺字段、2 笔跨图疑似重复。
 *
 * 数量刻意做成与设计方向 §3.3 的例子对应（20 笔里 16 笔完整、4 笔有疑问），
 * 用缩小版让「只重点核对有疑问的」这个交互成立。
 */
export function demoOcrOverviewItems(): OcrCandidateView[] {
  return [
    demoCandidate({
      candidateId: "img0-1",
      imageIndex: 0,
      amount: "20.00",
      currency: "CNY",
      direction: "expense",
      occurredLocalDate: "2026-10-09",
      occurredTime: "12:34",
      merchant: "老王便利店",
      sourcePlatform: "WECHAT",
      account: "零钱",
      note: "扫二维码付款",
      status: "posted",
      isComplete: true,
    }),
    demoCandidate({
      candidateId: "img1-1",
      imageIndex: 1,
      amount: "1280.00",
      currency: "CNY",
      direction: "income",
      occurredLocalDate: "2026-10-09",
      occurredTime: "08:15",
      merchant: "张*",
      sourcePlatform: "ALIPAY",
      account: "余额",
      note: "10 月房租",
      status: "posted",
      isComplete: true,
    }),
    demoCandidate({
      candidateId: "img1-2",
      imageIndex: 1,
      amount: "98.00",
      currency: "CNY",
      direction: "expense",
      occurredLocalDate: null,
      occurredTime: "12:29",
      merchant: "上海米哈游网络科技股份有限公司",
      sourcePlatform: "ALIPAY",
      issues: [
        {
          code: "missing_year",
          message: "只读到「10月8日」没有年份，请确认是哪一年。",
          field: "date",
        },
        {
          code: "layout_unverified",
          message: "版式「支付宝交易记录列表」未验证（缺少真实样本），这一笔的字段请核对。",
          field: null,
        },
      ],
      isQuestionable: true,
    }),
    demoCandidate({
      candidateId: "img1-3",
      imageIndex: 1,
      amount: "35.60",
      currency: "CNY",
      direction: "unknown",
      occurredLocalDate: "2026-10-08",
      occurredTime: "11:02",
      merchant: null,
      sourcePlatform: "ALIPAY",
      issues: [
        { code: "missing_merchant", message: "没有读出商户/交易对象，请填写。", field: "merchant" },
        {
          code: "direction_unclear",
          message: "没有读出收支方向，请确认是收入还是支出。",
          field: "direction",
        },
      ],
      isQuestionable: true,
    }),
    demoCandidate({
      candidateId: "img2-1",
      imageIndex: 2,
      amount: "35.60",
      currency: "CNY",
      direction: "expense",
      occurredLocalDate: "2026-10-08",
      occurredTime: "11:02",
      merchant: "美团外卖",
      sourcePlatform: "ALIPAY",
      duplicateSuspected: true,
      duplicateGroupIds: ["dup-cross-1"],
      issues: [
        {
          code: "duplicate_suspected",
          message: "这些交易可能来自截图重叠或重复上传，被标记为可能重复，请核对后决定保留哪些。",
          field: null,
        },
      ],
      isComplete: true,
      isQuestionable: true,
    }),
    demoCandidate({
      candidateId: "img3-1",
      imageIndex: 3,
      amount: "35.60",
      currency: "CNY",
      direction: "expense",
      occurredLocalDate: "2026-10-08",
      occurredTime: "11:02",
      merchant: "美团外卖",
      sourcePlatform: "ALIPAY",
      duplicateSuspected: true,
      duplicateGroupIds: ["dup-cross-1"],
      issues: [
        {
          code: "duplicate_suspected",
          message: "这些交易可能来自截图重叠或重复上传，被标记为可能重复，请核对后决定保留哪些。",
          field: null,
        },
      ],
      isComplete: true,
      isQuestionable: true,
    }),
  ];
}
