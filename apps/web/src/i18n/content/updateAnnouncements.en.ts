import type { UpdateAnnouncementText } from "./types.js";

/**
 * 更新公告的英文译文，按版本号对应 `lib/updateAnnouncements.ts` 里已发布的每一条。
 *
 * - 只翻译文字；版本号、发布日期、是否重大更新都取自中文原文，这里不重复。
 * - 分节与条目的数量、顺序必须与中文完全一致（`announcements.test.ts` 检查）。
 * - 界面路径用英文界面里的名称：Settings → Display & data → Appearance、Settings → Recording；
 *   底栏与入口名按术语表：Entries、Insights、Add、Ledger、Me；Scan / Voice / Paste / Manual / Import。
 * - 中文公告修订后，这里要同步修订；对不上结构时界面会整篇显示中文原文。
 */
export const UPDATE_ANNOUNCEMENTS_EN: Readonly<Record<string, UpdateAnnouncementText>> = {
  "1.16.08": {
    title: "Seven themes and dark mode",
    summary:
      "Adds seven theme colors with light, dark and system modes, and tidies up the Settings home and appearance previews.",
    sections: [
      {
        heading: "New features",
        items: [
          "In Settings → Display & data → Appearance, choose Forest, Honey, Walnut, Mist, Dusk, Ember or Celadon. Theme color and light, dark or system mode can be set separately, and changes apply right away.",
          "Dark mode puts content on neutral backgrounds and cards, with the brand color highlighting what you can tap. The Your ledgers page keeps its four layers of waves in each theme’s colors.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Recording preferences now have their own page off the Settings home; the default currency is still set in Recording.",
          "The Appearance page shows phone-sized previews of Your ledgers and Entries side by side, updating live as you change the theme. On small screens, the mode buttons and theme colors come first.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "Appearance preferences are saved in this browser and stay after refreshing or changing pages, but don’t sync across devices. The colors for income, expenses and categories mean the same in every theme.",
        ],
      },
    ],
  },

  "1.16.03": {
    title: "Consistent pages and clearer wording",
    summary:
      "Makes sub-page layouts and navigation consistent, tidies up wording across the app, and corrects several high-risk messages.",
    sections: [
      {
        heading: "Improvements",
        items: [
          "Second- and third-level pages now share the same header, back button, scrolling and list spacing. The bottom navigation, the central Add button and existing page addresses are unchanged.",
          "Easily misunderstood explanations on pages such as deleting and restoring, importing, scanning and account data have been rewritten more directly, and technical terms and developer notes have been replaced with plain explanations.",
          "Updates keeps each past version’s original release date, version number and important-update status while showing the revised text. Old announcements aren’t sent again as new releases.",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed inaccurate descriptions of where data is stored and of currency decimal places on the About page, and legal pages that still described the live product as not yet launched.",
          "Fixed wording in ledger import that could be read as “only adds, never deletes”. It now makes clear that source ledger records may be skipped, removed or deleted.",
          "Fixed some descriptions in the change history showing internal field names or extra spaces.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "How past amount changes are shown is unchanged for now under the current versioning policy, and past amounts are never guessed from the current currency. The amounts and currencies of current entries aren’t affected.",
        ],
      },
    ],
  },

  "1.15.05": {
    title: "Paste and voice parsing",
    summary:
      "Adds Paste to read entries from text, lets you edit a voice transcript and parse it again, and shortens the five entry methods’ names on narrow screens.",
    sections: [
      {
        heading: "New features",
        items: [
          "The new Paste page reads the amount, date, currency, category and more from text, then takes you to review before saving.",
          "Text that contains several entries is split into separate candidates. When it can’t be split reliably, you’re asked to paste them one at a time.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Voice and Paste use the same rules for reading amounts, dates, merchants and categories. You can edit a voice transcript and parse it again without recording again.",
          "The central Add menu offers five methods—Paste, Voice, Manual, Scan and Import—with Manual kept in the middle. Narrow screens show short names.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "Review recognized results before saving. Voice results can still be affected by background noise, speaking speed and accent.",
        ],
      },
    ],
  },

  "1.15.04": {
    title: "Fix for outdated important-update notices",
    summary:
      "After you update, important-update notices older than the version you’re running no longer pop up. Past announcements are still there to read.",
    sections: [
      {
        heading: "Bug fixes",
        items: [
          "Fixed old important-update notices still appearing after an app update: important announcements older than the running version no longer pop up.",
          "Past announcements stay in Updates. Your account’s confirmations are unchanged, and your entries aren’t affected.",
        ],
      },
    ],
  },

  "1.15.03": {
    title: "Duplicate checks and statement import",
    summary:
      "Makes duplicate alerts consistent across every way of adding entries, adds a whole-ledger check, and lets you review and import WeChat, Alipay, BOA and Libevra statement files.",
    sections: [
      {
        heading: "New features",
        items: [
          "Check a whole ledger for possible duplicates, follow its progress and cancel at any time. The check only lists candidates; it never deletes, merges or overwrites entries.",
          "Mark two entries as “Not a duplicate” and the decision is saved for that ledger. You can view and undo it, and it no longer applies if key fields change.",
          "Statement import supports WeChat XLSX, Alipay CSV, BOA PDF and Libevra CSV, recognizes the source from the file’s contents, and uses a single preview and review flow.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Manual, Voice, Scan and statement import all use the same duplicate rules. You decide whether to keep a possible duplicate; nothing is deselected or deleted automatically.",
          "In Settings → Recording, turn duplicate alerts on or off, choose which fields to match and set the time window: 1 minute by default, anywhere from 1 minute to 30 days. Each ledger is checked on its own.",
          "While reviewing a statement, you can edit the amount, date, time, type, category, payment method, note and tags. After editing or reselecting, check again before submitting.",
          "Importing the same source records again skips the ones already there; similar records from a different source are only flagged as possible duplicates.",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed confirming the same group as “Not a duplicate” from two places at once sometimes failing.",
          "Fixed being able to skip the re-check after reviewing a statement and submit an out-of-date review.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "BOA PDFs must contain a text layer; scanned copies aren’t supported. You’ll be asked to check when dates aren’t precise enough, fields are missing or totals don’t add up.",
          "Duplicate check settings are saved in this browser and don’t sync across devices. Turning alerts off doesn’t affect protection against double submission, same-source detection, permission checks or offline sync.",
        ],
      },
    ],
  },

  "1.15.00": {
    title: "Multi-entry scanning and recording changes",
    summary:
      "Scan can now read several entries from one image and review them together, Manual entry can reuse your last entry, and Entries gains bulk actions and better back navigation.",
    sections: [
      {
        heading: "New features",
        items: [
          "Scan now handles pages with several transactions, such as transaction lists and bank statements, and flags possible duplicates across images. When the page type is unclear, you can choose to treat it as one entry or several.",
          "A new batch overview lets you filter by status, such as To review or Possible duplicate, edit individual entries, then confirm and import them all at once.",
          "Manual entry adds “Reuse last entry”, which carries over the category, payment method, currency and tags.",
          "Entries now lets you select, edit and delete several entries at once.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Manual entry fields have been reordered, quick amounts are collapsed by default, and you can switch currency right next to the amount.",
          "The import complete page shows the running total for this session and lets you scan the next batch. Uncertain fields stay marked.",
          "Ledger import now picks the source and target from lists on the page, with consistent expand arrows, amount sizes and alignment.",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed a possible loop when going back after opening settings and import from a ledger’s details.",
          "Improved the offline delete status and refresh feedback, and fixed some input fields having their font size overridden by global styles.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "Recognized results aren’t recorded until you confirm; then each one is saved and the results are shown. Cross-image duplicate alerts only cover the current scan, not the whole ledger.",
          "Sign-up is still by invitation only; new accounts need an invite code.",
        ],
      },
    ],
  },

  "1.14.20": {
    title: "Fix for Scan failing to start",
    summary:
      "Fixes the server’s image recognition service failing to start, and reports a failure promptly when startup goes wrong.",
    sections: [
      {
        heading: "Bug fixes",
        items: [
          "Fixed payment screenshots failing to scan because the server was missing a component needed for image recognition.",
          "If the recognition service exits before it’s ready, you now get a failure message right away instead of waiting out the 60-second startup timeout, and it can try to start again afterwards.",
        ],
      },
      {
        heading: "Notes",
        items: ["This release doesn’t change the voice recognition model and doesn’t include the voice speed-up."],
      },
    ],
  },

  "1.14.18": {
    title: "Ledger import, undo and source management",
    summary:
      "Import from a guest ledger or an eligible solo ledger, with batched imports, undo before confirming and checks for changed source records.",
    sections: [
      {
        heading: "New features",
        items: [
          "Import a guest ledger into one of your ledgers, or an eligible solo ledger into another solo ledger. When the source is one of your ledgers, both source and target must meet the solo-ledger requirements, and you need to create and choose the target ledger before importing.",
          "Preview the differences before importing, choosing to import or skip each source entry and to keep or remove each target entry. The source ledger is never deleted automatically.",
          "Large imports run on the server in batches; if one is interrupted, you can check the task and continue it. Importing again recognizes sources already handled and checks source records for changes.",
          "After an import is confirmed, you can separately review the guest records that were moved and clean them up yourself, or retire a source ledger under the usual ledger lifecycle rules. Records that weren’t moved aren’t deleted by the guest cleanup.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Once all batches are written, you have 10 minutes to confirm. If you undo or the time runs out, Libevra tries to roll back the changes from that import. The ledgers involved can’t be edited until the final confirmation.",
          "When a source record has changed, you can keep the target as it is or, where updates are allowed, apply the change to the target entry.",
        ],
      },
      {
        heading: "Bug fixes",
        items: ["Fixed new tags sometimes not being rolled back along with the entries when a CSV/XLSX file import failed."],
      },
      {
        heading: "Notes",
        items: [
          "Ledger import and CSV/XLSX file import are separate processes; file import doesn’t have the 10-minute confirmation and undo described above.",
          "If an undo fails, the ledger may stay locked for editing until the failure is dealt with. Retiring and restoring a source ledger follows the existing restore deadlines. Sign-up is still by invitation only.",
        ],
      },
    ],
  },

  "1.13.15": {
    title: "Account closure and ledger recovery",
    summary:
      "Adds account closure, ledger archiving and recovery requests, and records key operations to help check restores from older backups.",
    sections: [
      {
        heading: "New features",
        items: [
          "Added account closure and server data deletion, showing what will happen to each ledger before you confirm. Shared and solo ledgers each follow their own rules.",
          "Added ledger archiving, self-service restore within a time limit, and manual recovery requests. The ledger recovery keys issued when you close an account are separate from your account recovery code.",
          "Added important-update notices and agreement confirmation. Regular release notes don’t need confirming; confirmations of important announcements are saved per account.",
          "Added a record of key operations, which lowers the risk that restoring an older backup accidentally undoes deleted ledgers, account status or permission changes.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Backup restores now check key states and data integrity, with monitoring for related problems.",
          "Release note details now link to the previous and next versions, and past announcements are still available.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "Ledger recovery is subject to time limits and the existing process, and recovery keys can’t restore a closed account. The agreement confirmation feature going live doesn’t mean a formal Privacy Policy or Terms of Use is available yet.",
        ],
      },
    ],
  },

  "1.13.09": {
    title: "Updates page and release history",
    summary:
      "The Updates page shows the version you’re running and the latest release notes, and adds a history list, release details and runtime info.",
    sections: [
      {
        heading: "New features",
        items: [
          "The Updates page shows the version you’re running and the latest official release notes.",
          "Added a release history list and a details page for each version, which you can open directly and refresh.",
          "The More menu in the top-right corner lets you copy version info and view runtime info.",
        ],
      },
    ],
  },

  "1.13.08": {
    title: "Current ledger card layout",
    summary: "Reworks the ledger switcher for solo and shared ledgers, and wraps long ledger names.",
    sections: [
      {
        heading: "Improvements",
        items: [
          "The solo ledger card now has a side-by-side layout with the switch ledger button on the right.",
          "Switching shared ledgers now uses a compact bar that takes up less height.",
          "Long ledger names now wrap instead of being cut off.",
        ],
      },
    ],
  },

  "1.13.07": {
    title: "Ledger settings and collaboration",
    summary:
      "Reorganizes ledger details and settings, manages categories, tags and payment methods per ledger, and clarifies what shared ledgers show offline.",
    sections: [
      {
        heading: "Improvements",
        items: [
          "Account, settings and ledger details now each have a clearer role, and categories, tags and payment methods are managed separately in each ledger.",
          "Personal ledgers still support recording offline. Shared ledgers are view-only while offline; changes waiting to sync are kept and handled once you’re back online.",
          "Updated how ledger member permissions, edit history and management actions are shown.",
        ],
      },
    ],
  },
};
