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
          "You can now import entries from a guest ledger into one of your ledgers, or import an eligible solo ledger into another solo ledger.",
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
          "When you import data you’ve imported before, existing source entries are recognized, so fewer duplicates are added.",
          "When a source entry has changed, the import preview lets you keep what’s there or update it with the new content.",
        ],
      },
      {
        heading: "Other improvements",
        items: [
          "Improved status messages, error handling and recovery during imports.",
          "Strengthened protection for ledger and entry data.",
          "Improved rollback when a CSV import fails, so no partial entries are left behind.",
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
          "The import-complete page shows the running total for this session and lets you scan the next batch. Uncertain fields are still clearly marked.",
        ],
      },
      {
        heading: "Ledgers and everyday actions",
        items: [
          "Ledger import now picks the source and target from lists on the page.",
          "Fixed a navigation loop when returning from settings or the import page opened from a ledger’s details.",
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

  "major-1.17.11": {
    title: "Libevra 1.17.11",
    summary: "Turn every entry into a financial workbench of your own.",
    sections: [
      {
        heading: "The analysis workbench arrives",
        items: [
          "Insights is now a financial workbench you can shape: all 38 analysis cards read real data, and browse, filter and edit are three states of the same page.",
          "Cards can be dragged, swapped, resized, copied and deleted; the layout is saved on this device per account and survives a refresh.",
          "Every card explains the data behind it, and opening one shows its details; going back restores your previous scroll position.",
        ],
      },
      {
        heading: "Filters, custom cards and composite cards",
        items: [
          "Three new multi-select filters — category, payment method and tag — now apply together with time and currency to the summary, all cards, cards with fixed windows and previous-period comparisons; filters live in the address bar, so links can be shared, refreshed and opened directly.",
          "Custom cards offer 81 / 84 metrics and 31 chart families, and composite cards place several numbers and charts in one card, preview at the device's real grid pixel size whether everything fits, and show the rest on the details page.",
          "Exchange-rate conversion covers all 38 cards; when rates are missing, totals show only the converted subtotal, counts and days still count, ratios and extremes explain their uncertainty, and trends and the heatmap mark unknown periods as “unknown” instead of 0.",
        ],
      },
      {
        heading: "Offline, details and the Halloween limited avatar",
        items: [
          "The monthly offline history limit rises from 4,000 to about 50,000 entries and now distinguishes complete from truncated, so a partial month is never written into the local ledger as a full month.",
          "Fixed the “Categories with spending” unit, amount truncation from auto-shrink, narrow-screen legends and number columns, negative ratio rounding and right-column composite-card saves; the daily startup scripts now always open http://localhost:5173 and no longer drift to 5174.",
          "The special collection adds a “Halloween” limited avatar: sign in on October 31 in your account's local time to claim it permanently; it cannot be claimed later, and it shows as locked until unlocked.",
        ],
      },
      {
        heading: "Before you upgrade",
        items: [
          "This update includes database migration 61, which only widens the CHECK allowlists for avatar choices, unlock records and reward notices; no tables, entries, ledgers or member permissions change, and it runs automatically.",
          "About 50,000 entries per month is a temporary offline limit, not a permanent specification; a month over the limit is explicitly marked incomplete and analyses depending on it report an incomplete source.",
          "Exchange-rate conversion still protects the per-entry 50,000 limit and never truncates; S17-C's P05 / P07 / P21, cross-device sync (W6) and site-wide adaptive layout (S18) are not in this version.",
          "Older clients show halloween-special as the “flower” avatar as a safe fallback, without errors or data loss; refresh once after upgrading to load the new assets. The service restarts briefly during release, and saved data is unaffected.",
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
