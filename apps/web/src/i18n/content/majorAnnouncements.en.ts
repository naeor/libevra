import type { MajorAnnouncementText } from "./types.js";

/**
 * 重大公告的英文译文，按公告 ID 对应 `@libellum/shared` 的 `consent.ts`（服务器下发的中文原文）。
 *
 * - 与同版本的更新公告（`updateAnnouncements.en.ts`）讲的是同一件事，措辞保持一致。
 * - 分节与条目的数量、顺序必须与中文完全一致；服务器下发的公告若已修订而这里没跟上，
 *   界面会整篇显示中文原文，而不是拼出一篇对不上的英文。
 * - 协议 / 法律文本（`TEST_LEGAL_DOCUMENT` 等）**不在这里翻译**。
 */
export const MAJOR_ANNOUNCEMENTS_EN: Readonly<Record<string, MajorAnnouncementText>> = {
  "major-1.14.18": {
    title: "Libevra 1.14.18",
    summary: "Move your entries freely, with more peace of mind at every step.",
    sections: [
      {
        heading: "Move entries between ledgers",
        items: [
          "You can now import records from a guest ledger into one of your ledgers, or import an eligible solo ledger into another solo ledger.",
          "Before importing, choose the target ledger, check the differences and resolve conflicts. The original ledger is never deleted automatically by an import.",
        ],
      },
      {
        heading: "Confirm before it’s final",
        items: [
          "Large imports are processed in batches, and an interrupted import can be resumed.",
          "After an import finishes, you have 10 minutes to decide whether to confirm it. If you cancel or the time runs out, Libevra tries to undo that import’s changes.",
          "Until the final confirmation, the ledgers involved are temporarily protected so other actions can’t interfere with the import or undo.",
        ],
      },
      {
        heading: "Clearer handling of duplicates",
        items: [
          "When you import data you’ve imported before, existing source records are recognized, so fewer duplicates are added.",
          "When a source record has changed, the import preview lets you keep what’s there or update it with the new content.",
        ],
      },
      {
        heading: "Other improvements",
        items: [
          "Improved status messages, error handling and recovery during imports.",
          "Strengthened protection for ledger and entry data.",
          "Improved rollback when a CSV import fails, so no partial records are left behind.",
          "Sign-up is still by invitation only; new accounts still need an invite code.",
        ],
      },
    ],
  },

  "major-1.15.00": {
    title: "Libevra 1.15.00",
    summary: "Smoother recording, more complete recognition.",
    sections: [
      {
        heading: "Smoother manual entry",
        items: [
          "The Manual entry fields have been reordered so the ones you use most, like amount and category, are closer together.",
          "Quick amounts stay collapsed until you need them. The new “Reuse last entry” carries over the last entry’s category, payment method, currency and tags.",
          "Switch currency right next to the amount, and the save area now flows more naturally into the bottom navigation.",
        ],
      },
      {
        heading: "Several entries from one screenshot",
        items: [
          "Scan can now read pages with several transactions, such as transaction lists and bank statements, not just single transaction details.",
          "Possible duplicates are flagged across images. When the page type is unclear, you’ll be asked whether to treat it as one entry or several.",
          "Results still appear as drafts for you to review and aren’t added to your ledger until you confirm.",
        ],
      },
      {
        heading: "Review in bulk, confirm once",
        items: [
          "A new review overview lets you filter by status, such as To review or Possible duplicate, and open any entry to edit it.",
          "When you’re done, confirm them all at once. Each entry is saved in turn and you get a summary of the results.",
          "The import complete page shows the running total for this session and lets you scan the next batch. Uncertain fields are still clearly marked.",
        ],
      },
      {
        heading: "Ledgers and everyday actions",
        items: [
          "Ledger import now picks the source and target from lists on the page.",
          "Fixed a loop when going back after opening settings and then import from a ledger’s details.",
          "Entries now lets you select, edit and delete several entries at once, with more accurate offline delete status and refresh feedback.",
        ],
      },
      {
        heading: "Interface and readability",
        items: [
          "Expand arrows, amount sizes and alignment now follow the same rules everywhere.",
          "Fixed some input fields having their font size overridden by global styles.",
          "Sign-up is still by invitation only; new accounts still need an invite code.",
        ],
      },
    ],
  },

  "local-test-major-2026-10": {
    title: "Important update test announcement",
    summary:
      "This is a local test of an important update, used to check that each account is reminded only once across devices.",
    sections: [
      {
        heading: "Test purpose",
        items: [
          "This announcement only appears in local development and is never included in a release.",
          "Once confirmed, it won’t pop up automatically for the same account on another device.",
        ],
      },
    ],
  },
};
