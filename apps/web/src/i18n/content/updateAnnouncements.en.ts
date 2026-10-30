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
  "1.18.02": {
    title: "Dual workspaces on tablets and adaptive Insights layouts",
    summary: "Compare different ledgers in two tablet workspaces, with Insights cards arranged for the space available; the editing toolbar is lighter, and iPad dragging and backup alerts are improved.",
    sections: [
      { heading: "New features", items: [
        "Tablets support side-by-side workspaces in landscape and stacked workspaces in portrait. Each can show a different ledger with independent navigation and scrolling. Follow or browse independently, resize the split, collapse and restore a workspace, or swap primary and secondary roles.",
        "Long-press a navigation item or entry and drag it into the target workspace. The secondary workspace also has compact navigation; phones keep their existing entry points.",
        "Improves flashing and unexpected cancellation when long-pressing and dragging entries in iPad Safari, while preserving ordinary taps, scrolling and drag cancellation.",
      ] },
      { heading: "Improvements", items: [
        "Insights cards arrange automatically using their workspace's actual width, reducing misplaced cards and large gaps on wide screens. The editor offers automatic columns or a slider for manual adjustment.",
        "Position and size changes can be saved for the current column count. Adding or removing a card establishes a new base layout from the current arrangement. Changing devices or rotating the screen does not automatically rewrite saved layouts.",
        "The editing toolbar starts collapsed and opens the card library when needed. Its width and height fit the workspace, retaining categories, search, custom cards, containers, presets and drag-to-add. Frequent confirmation buttons on review screens are also easier to reach.",
      ] },
      { heading: "Bug fixes", items: [
        "Unexpected backup exits use one failure-alert path. Runs that skip required steps or cannot acquire the lock are no longer treated as complete successes.",
        "Backups check permissions in advance and use a private directory for sensitive temporary configuration, with cleanup on exit. Monitor requests have bounded retries, and delivery problems are recorded separately from the backup result.",
      ] },
      { heading: "Notes", items: [
        "Accounts still using the complete old default Insights layout follow the new beginner layout, while customized layouts are kept.",
        "The server briefly restarts during this update; existing registration and access controls do not change.",
      ] },
    ],
  },
  "1.17.15": {
    title: "Nested categories, workbench sync and a collapsing header",
    summary:
      "Categories can now be nested into a hierarchy, with new hierarchy structure and hierarchy Sankey analyses; workbench layouts and personal presets start syncing per account, with JSON configuration import and export; Entries, Insights, Ledger and Me share a collapsing sticky header, and the bottom-tab highlight and theme buttons are corrected.",
    sections: [
      {
        heading: "New features",
        items: [
          "Categories support multiple levels: edit a category, create a child or move a whole subtree from its “More” menu, up to 64 levels. Existing category and entry IDs stay unchanged; duplicates are refused within the same parent, while the same name may appear in different branches.",
          "Adds P05 “Category hierarchy structure” and P07 “Category hierarchy Sankey”, with parent-category roll-ups and hierarchy flows calculated from the same scope; the official metric list grows to 83 items.",
          "Workbench layouts and personal presets start syncing per account: the main layout, independent archives, composite card slots and templates, drawer position and fixed or relative time windows are saved to the server with the account; offline edits still work locally and merge once the connection returns.",
          "The workbench supports configuration files: export the saved workbench, a single personal preset or a preset collection as versioned JSON; imports are validated item by item with a preview, and can be added as a new preset or applied to the current editing session.",
          "Account export includes the personal workbench configuration; deleting an account also clears the configuration, sync metadata and recovery copies on the server and on this device.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Insights, Ledger and Me (including guest mode) share one collapsing sticky header: it follows the scroll and snaps to the expanded or compact end when released. The compact state keeps the title and actions, scrolling back to the top expands it, Me keeps its expanded avatar layout, and reduced motion and safe areas are respected.",
          "The Insights editing toolbar becomes a bottom drawer, the stats controls collapse into one row with a “Statistics settings” panel, the metric catalogue is more compact, and the fifth group is renamed “Other professional analyses”.",
          "Layout presets are new: system presets for beginners, advanced and professional use, plus up to 10 personal presets; preview then apply, swipe horizontally to switch, and relative time windows resolve when the preset is applied.",
          "Custom cards grow from 50 to 81 selectable metrics (83 in the full catalogue) and chart families to 31; the active bottom tab is marked with a light circular background centred on the combined icon and label.",
          "Theme details are corrected: on light themes such as Honey Gold the detail-page action buttons regain a clear circular background, the Insights tab shows its theme-selected colour like other pages, and buttons, selected states and text contrast were checked across all seven palettes in light and dark appearance.",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed the Insights bottom tab not showing its selected state.",
          "Fixed detail-page top action buttons losing their background and showing only icons on light themes such as Honey Gold, Red and Purple.",
          "Fixed category hierarchy edge cases: historical paths and filter encodings stay consistent after moving a subtree, and zero-amount descendants no longer break Sankey conservation.",
          "Fixed workbench configuration being silently overwritten when both sides changed at once: conflicts now let you choose the cloud or local version and keep a recovery copy of the other.",
          "Fixed personal workbench configuration, sync metadata and recovery copies being left behind after account deletion.",
          "CSV import now matches categories by both income/expense direction and category path; older files without a “Type” column that name a category opposite to the direction inferred from the amount sign now fail with a clear row-numbered error instead of importing an entry into the wrong direction.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "This update includes database migrations 62 and 63: a new workbench configuration table, plus parent and colour columns and a hierarchy validation trigger for categories. Migrations run automatically during the upgrade and do not rewrite existing categories or entries.",
          "If the service later needs to be rolled back to 1.17.11, nested categories and workbench configurations created in the meantime are kept; the older interface does not show the hierarchy or sync features, and entries and ledgers are unaffected.",
          "The category hierarchy supports up to 64 levels; deleting a parent category asks for confirmation and by default promotes its children one level up while keeping their entries.",
          "Workbench sync is an account-level feature of the installed app; there is no public share code or template marketplace yet. Imported configuration files are validated item by item, and damaged, unknown or oversized files are rejected without touching the existing configuration.",
          "The hierarchy, collapsing header and sync flows have not been verified on iOS Safari or a real PWA device; desktop or Android is recommended for now.",
          "This update restarts the service briefly (seconds to about half a minute); saved data is unaffected. PWA users only need one refresh after upgrading to load the new version.",
        ],
      },
    ],
  },
  "1.17.11": {
    title: "The analysis workbench and the Halloween limited avatar",
    summary:
      "Insights becomes a financial workbench you can shape: 38 analysis cards, category / payment method / tag filters, 81 custom metrics and composite cards now available; offline history reading rises to about 50,000 entries per month with an explicit “incomplete” state; plus a Halloween limited avatar and a group of startup and layout fixes.",
    sections: [
      {
        heading: "New features",
        items: [
          "Insights is now a modular financial workbench: the bottom Insights tab opens it directly, and browse / filter / edit are three states of the same page. Cards can be dragged, swapped, resized, copied and deleted; the layout is saved on this device per account and survives a refresh. Opening a card shows its details, and going back restores your previous scroll position.",
          "All 38 analysis cards read real data: total expense, total income, net, daily average, largest single entry, category breakdown and ranking, trends over time, cumulative totals, calendar heatmap, payment-method breakdown, multi-category history and previous-period comparison. Each card's title, explanation and numbers come from the same filter scope.",
          "Exchange-rate conversion covers all 38 cards: each entry is converted once at the historical rate for its date before analysis. When rates are missing, totals show only the converted subtotal, counts and days still count, averages, medians and ratios are reported as indeterminate, extremes note they may not be the global result, and trends and the heatmap mark dates with missing rates as “unknown” instead of 0.",
          "Three new multi-select filters — category, payment method and tag — now apply together with time and currency to the summary, all 38 cards, cards with fixed windows and previous-period comparisons. Filters are stored in the address bar, so links can be shared, refreshed and opened directly; choosing an empty set shows “nothing selected” instead of all data.",
          "Custom cards grow from 50 to 81 / 84 metrics and from a handful to 31 chart families: number, line, area, bar, donut, ranked bars, table, calendar heatmap, histogram, box plot, scatter, bubble, treemap, Pareto, small multiples and more.",
          "Composite cards are new: several numbers and charts live in one card, and the editor browses or searches metrics by group (numbers / trends and time / breakdown and ranking / distribution and relationships / advanced and combined), with multi-select, reorder, replace and delete. T1–T8 recommended templates, a live preview at the device's real grid pixel size that marks “fits / N items don't fit”, remaining items shown on the card as “N more · open to view”, and everything shown in full on the details page.",
          "31 S17-C analyses join the workbench: large-expense details, change attribution, share change, category and large-expense concentration, expense distribution, streak of no-spend days, category change ranking, category × month / weekday / payment method matrices, payment-method trends, treemap, Pareto, rank change, scatter, bubble, category box plots, monthly pivot table, small multiples, full-year calendar, currency counts, converted currency mix, rate observations / coverage / fallback, change waterfall, monthly box plots and share slope.",
          "The monthly offline history limit rises from 4,000 to about 50,000 entries (500 pages × 100 at most) and now distinguishes “complete” from “truncated”: when the limit is reached, an incomplete state is recorded and the fetched count is kept for resuming and retrying, so a partial month is never written into the local ledger as if it were the whole month.",
          "The special collection adds a “Halloween” limited avatar: sign in on October 31 in your account's local time to claim it, and it is yours permanently. Until unlocked, the avatar picker shows it as locked and saving it is refused.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Time filtering is unified as custom, last 7 / 30 / 90 days, last year and a specific month; custom dates expand on demand, ranges over 400 days are explicitly refused, and time and currency collapse into one horizontally scrolling row instead of taking up card space.",
          "The edit-state bottom tab becomes an expandable card drawer (cards: Recommended / All analyses / My custom; containers: sliding group / split group / blank placeholder), with valid and invalid drop previews while dragging, and a “+” to place a card into the first empty slot.",
          "Amounts and charts adapt to the available space: amounts in narrow cards shrink to a size that shows them in full (one smaller step is new), charts are drawn to the card's body height, the “incomplete data” note collapses into a “!” badge in small cells, donut charts shrink with height and list only the fitting legend, charts that need a taller plot have a minimum height and suggest a larger size, and single-item cards show a mini trend at short heights.",
          "The unit of “Categories with spending” (B16) changes from entries to categories; other count cards still say entries.",
          "The Chinese and English captions of Jade Vase, Ingot and “Sun” lose their trailing period; Boo's tilde and exclamation mark stay.",
          "The daily startup scripts are rewritten: they open http://localhost:5173 and wait for the API health check before opening the browser, keep the window open, show the running service's version when 5173 is already in use instead of starting a second instance, and fail explicitly on a port conflict instead of silently moving to 5174.",
          "A new start-dev-lan-https.cmd is only for phones on the same Wi-Fi that need a secure context for recording or offline features; when certificates are missing it prints how to create them and exits instead of opening an HTTP port over HTTPS.",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed the startup window closing after about 6 seconds and Edge opening https://localhost:5173 with ERR_SSL_PROTOCOL_ERROR, leaving no error message.",
          "Fixed Vite silently switching to port 5174 when 5173 was taken by an old process, which made the page show an old version for a long time.",
          "Fixed “Save changes” failing on a right-column 1×1 composite card that needed to grow to 2×1: it now moves to the start of the row and pushes its neighbour along, still as one undo step, and a failed save explains itself instead of failing silently.",
          "Fixed the amount auto-shrink leaving a 1px margin, which cut “¥14,222.41” down to “¥14,222....” at desktop widths; the check is now strict and one smaller font step was added.",
          "Fixed composite cards at 320px: multi-category legends wrapping, amount truncation from a too-narrow number column, and 1×1 double numbers showing only “N more”.",
          "Fixed negative rounding in ratio text (−50% appeared as −49.9%) and the software-update page's handling of two-digit patch numbers (1.17.09 / 1.17.10).",
          "Fixed entries in a personal ledger staying in the saving state when offline or on an unstable network because the duplicate check waited for a connection; detection and saving now happen locally first and sync once back online.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "This update includes database migration 61, which only widens the CHECK allowlists for user avatar choices, unlock records and reward notices (adding halloween-special); it changes no tables, entries, ledgers or member permissions and runs automatically.",
          "The Halloween avatar is granted only when you sign in (or authenticate online) on October 31 in your account's local time, and cannot be claimed later; not signing in that day does not grant or backfill it.",
          "Older clients show halloween-special as the “flower” avatar as a safe fallback, without errors or data loss; refresh once after upgrading to load the new assets.",
          "The roughly 50,000 entries per month offline limit is a temporary increase, not a permanent specification; a month over the limit is marked “incomplete”, is never treated as a full month, and analyses depending on it report an incomplete source.",
          "Exchange-rate conversion still protects the per-entry 50,000 limit: cards that depend on per-entry data explain the limit and never truncate, while cards whose aggregates are exact keep their results.",
          "Among S17-C analyses, P05 / P07 (which need a category hierarchy model) and P21 (which needs per-slot dimension parameters) are not available in this release; per-slot time and filters in composite cards, cross-device sync (W6) and site-wide adaptive layout (S18) are not in this version either.",
          "This update restarts the service briefly (seconds to about half a minute); saved data is unaffected. If a page is blank, make sure your local service is running and refresh; PWA users only need one refresh after upgrading to load the new version.",
          "Reference rates are for viewing and totals; the amount actually settled by your bank or payment provider may differ.",
        ],
      },
    ],
  },
  "1.16.22": {
    title: "Four new avatars join the Classic Collection",
    summary: "Jade Vase, Boo, Ingot and 「Sun」 join the Classic Collection, available to everyone.",
    sections: [
      {
        heading: "New features",
        items: [
          "Jade Vase: a slender vase resting above a gentle ripple. Caption: Gentle dew, a willow sprig, and a moment of peace.",
          "Boo: a soft little ghost, floating gently by your side. Caption: Boo… don’t be scared!",
          "Ingot: full, rounded and softly turned up at the sides. Caption: A little ingot, a little luck.",
          "「Sun」: a simple fried egg; the 「」 brackets are part of its name. Caption: A little “sun” for breakfast, and warmth all day.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "Open the avatar picker from Me → Profile, choose an avatar and save. All four belong to the Classic Collection and require no unlock.",
          "The new avatars support all seven themes, light and dark appearances, and Chinese and English names and captions. Existing classic avatars, special avatars and unlock records are kept.",
        ],
      },
    ],
  },
  "1.16.21": {
    title: "Exchange-rate conversion and cross-currency totals",
    summary:
      "Adds an optional exchange-rate view that converts entries into your default currency at the historical rate for their date, while analyses and details keep the original amounts; also fixes entries getting stuck while saving offline.",
    sections: [
      {
        heading: "New features",
        items: [
          "An optional “Exchange-rate conversion” mode, off by default. When you turn it on under Settings → Display & data → Exchange rate, the entry list shows both the converted and original amounts; Insights gains a combined view that totals different currencies in your default currency, and you can switch back to per-currency analysis at any time.",
          "Conversion uses the historical reference rate for each entry's date (ECB rates via Frankfurter); on weekends and holidays it falls back to the most recent available date, and the entry details show the trade date, the actual reference date, the source and the rate used.",
          "The conversion setting is stored per account on this device and stays separate when you switch accounts, ledgers or target currencies; it only affects what this device displays, while other members' data and permissions stay unchanged."
        ]
      },
      {
        heading: "Improvements",
        items: [
          "Entries, editing, exports and the amounts stored in shared ledgers always keep their original currency and amount; converted values are for viewing and totals only and are never written back to any record.",
          "When rates are missing, you are offline, or the locally stored period is incomplete, totals are marked as incomplete with the affected entries listed instead of showing misleading percentages, and the converted part is shown as a separate subtotal.",
          "The Settings home and the Display & data entry were tidied up alongside the new exchange-rate screen, with matching Chinese and English copy."
        ]
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed an issue where adding an entry in a personal ledger could stay in the saving state when offline or on an unstable network, because the duplicate check waited for a connection; detection and saving now happen locally first and sync once you're back online."
        ]
      },
      {
        heading: "Notes",
        items: [
          "This update includes database migration 59, which only adds a public reference-rate cache table and leaves entries, ledgers and member permissions unchanged; it runs automatically.",
          "Exchange-rate conversion is off by default, so existing screens and data look the same after upgrading; converted amounts appear only after you turn it on.",
          "Reference rates are for viewing and totals; the amount actually settled by your bank or payment provider may differ."
        ]
      }
    ]
  },
  "1.16.18": {
    title: "New brand tagline, message quotes and avatar page polish",
    summary:
      "Unifies the brand tagline as “Bookkeeping, your way.”; messages in shared ledgers can quote an entry or an edit, or start from the saved-entry screen; plus a set of refinements to the avatar picker and message board.",
    sections: [
      {
        heading: "New features",
        items: [
          "Messages in shared ledgers can now be about an entry or an edit: tap the quote button beside the message box and pick one from recent entries or the edit history; you can also quote the entry you just saved from the save-success screen. Quoting stays optional — a plain message still works exactly as before.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "The brand tagline is now “Bookkeeping, your way.” in English (with its Chinese counterpart in the Chinese interface); the opening screen and the appearance preview use it too.",
          "The message shortcut on the save-success screen moved into the success info block as a quiet “Message about this” pill; tapping it opens the message composer with the entry already quoted. Nothing is sent automatically and no empty message is created.",
          "The quote icon is now a theme-colored light circle with a white opening quotation mark; the quote picker and message sheet slide up from the bottom and back down when closing.",
          "The avatar picker centers its preview text with the artwork, wraps long captions naturally, orders special avatars by unlock state, desaturates locked avatars with a small lock badge, and keeps the save bar clear of the device safe area.",
          "The message board now reads top-to-bottom with the newest message at the bottom, opens scrolled to the latest, and the ledger message card shows the two newest messages.",
          "Chinese and English copy was updated together; category names on quote cards follow the interface language.",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed “This page can’t be displayed” that could appear on the Ledger (collaboration) or message board page after upgrading: messages cached by the previous version had no quote field. The old cache is discarded on upgrade and a missing field is now treated as “no quote”.",
          "Fixed the quote button, message box and send button not sharing the same height or bottom edge.",
          "Fixed the ledger message card showing the two oldest messages instead of the two newest.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "This update includes database migration 58, which only adds nullable columns and checks the reference kind; existing messages and ledger data stay unchanged, and the migration runs automatically.",
          "The first load after upgrading refreshes this device's query cache; your signed-in state and ledger data are unaffected.",
          "Older clients will show quoted messages as plain messages; the quote card appears after the app refreshes to this version.",
        ],
      },
    ],
  },
  "1.16.16": {
    title: "Back-navigation fix and copy tweaks",
    summary:
      "Fixes the back button bouncing between two pages when the app opens a subpage from a link, notification or refresh, and adds a hint to the update entry.",
    sections: [
      {
        heading: "Bug fixes",
        items: [
          "Fixed the back button bouncing between two pages after opening a subpage from a shared link, notification or refresh; the first back now returns to the parent page without leaving an extra history entry.",
        ],
      },
      {
        heading: "Improvements",
        items: ["The version hint under Me → Updates now explains that tapping it opens the update history."],
      },
      {
        heading: "Notes",
        items: ["This is a patch update with no database or migration changes; existing accounts and ledger data are unaffected."],
      },
    ],
  },
  "1.16.15": {
    title: "Bilingual UI, system avatars and memorial rewards",
    summary:
      "Adds a Chinese/English interface, nine system avatars with special-avatar rewards, and improves the Settings experience and offline messaging.",
    sections: [
      {
        heading: "New features",
        items: [
          "The interface now supports Chinese and English: choose Follow system, Chinese or English in Settings → Display & data → Language. Changes apply immediately, and dates and numbers follow the selected language.",
          "Nine system avatars in Classic Collection and Special Collection, each with a one-line caption that updates as you preview.",
          "Special avatars are now memorial rewards: Descent is granted automatically after your first sign-in, and The Hanged can be earned by signing in on the third Thursday of November (World Philosophy Day) in your account's time zone. The server grants them permanently; the avatar page shows the unlock date and a creation note.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Changing recording preferences while offline now fails immediately with a notice instead of waiting silently for the network.",
          "Clear all data on this device now also covers language and appearance preferences; switching, closing or deleting an account clears that account's device-level leftovers.",
          "With Reduce motion enabled, skeletons and button spinners no longer pulse or rotate.",
          "Unified text hierarchy and spacing, and corrected line heights in some chart captions.",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed new or switched ledgers showing local records from another ledger; this release includes the same ledger data isolation fix as 1.16.09.",
          "Fixed sync or downloads still in flight during a ledger switch using the wrong ledger.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "Language and appearance preferences are stored in this browser and don't sync across devices; special-avatar unlocks are stored on the server account.",
          "Make-up grants follow server-side rules (granted when eligible and not owned yet); this version has no manual make-up entry.",
        ],
      },
    ],
  },

  "1.16.09": {
    title: "Ledger data isolation fix",
    summary:
      "Fixes new or switched ledgers showing records from another ledger, and corrects where local caches and sync were attributed during a switch.",
    sections: [
      {
        heading: "Bug fixes",
        items: [
          "Fixed details and insights sometimes mixing in local records from another ledger after creating or switching ledgers. The app now resolves the account and ledger before reading their data on startup.",
          "Fixed sync or downloads still in flight during a ledger switch being filed under the wrong ledger. Requests and local saves now stay bound to the ledger they started in.",
          "Stopped copying old caches whose ownership cannot be confirmed into a new ledger. Local copies with provably wrong ownership are kept aside, and unsynced originals are never deleted automatically.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "If an older version left local data with unclear ownership, keep the original device data for review. Do not clear local data to work around it, as unsynced records could be lost.",
          "This fix does not delete or rewrite historical entries on the server.",
        ],
      },
    ],
  },

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
          "Appearance preferences are saved in this browser and stay after refreshing or changing pages, but don’t sync across devices. The colors for income, expenses and categories mean the same thing in every theme.",
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
          "Fixed wording in ledger import that could be read as “only adds, never deletes”. It now makes clear that source ledger entries may be skipped, removed or deleted.",
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
          "The central Add menu offers five methods — Paste, Voice, Manual, Scan and Import — with Manual in the middle. Narrow screens show short names.",
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
          "Importing the same source entries again skips the ones already there; similar entries from a different source are only flagged as possible duplicates.",
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
    title: "Multi-entry scanning and entry changes",
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
          "The import-complete page shows the running total for this session and lets you scan the next batch. Uncertain fields stay marked.",
          "Ledger import now picks the source and target from lists on the page, with consistent expand arrows, amount sizes and alignment.",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed a possible navigation loop when returning from settings or the import page opened from a ledger’s details.",
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
      "Import from a guest ledger or an eligible solo ledger, with batched imports, undo before confirming and checks for changed source entries.",
    sections: [
      {
        heading: "New features",
        items: [
          "Import a guest ledger into one of your ledgers, or an eligible solo ledger into another solo ledger. When the source is one of your ledgers, both source and target must meet the solo-ledger requirements, and you need to create and choose the target ledger before importing.",
          "Preview the differences before importing, choosing to import or skip each source entry and to keep or remove each target entry. The source ledger is never deleted automatically.",
          "Large imports run on the server in batches; if one is interrupted, you can check the task and continue it. Importing again recognizes sources already handled and checks source entries for changes.",
          "After an import is confirmed, you can separately review the guest entries that were moved and clean them up yourself, or retire a source ledger under the usual ledger lifecycle rules. Entries that weren’t moved aren’t deleted by the guest ledger cleanup.",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Once all batches are written, you have 10 minutes to confirm. If you undo or the time runs out, Libevra tries to roll back the changes from that import. The ledgers involved can’t be edited until the final confirmation.",
          "When a source entry has changed, you can keep the target as it is or, where updates are allowed, apply the change to the target entry.",
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
          "Added ledger archiving, self-service restore within a time limit, and manual recovery requests. The ledger recovery credentials issued when you close an account are separate from your account recovery code.",
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
          "Ledger recovery is subject to time limits and the existing process, and recovery credentials can’t restore a closed account. The agreement confirmation feature going live doesn’t mean a formal Privacy Policy or Terms of Use is available yet.",
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

/**
 * 1.16.09 发布候选：英文译文先以候选形式保留。上面的 `UPDATE_ANNOUNCEMENTS_EN` 只对应
 * 已发布公告，发布 1.16.09 时把这一条并入其中（`announcements.test.ts` 会检查多余译文）。
 */
export const UPDATE_ANNOUNCEMENTS_EN_DRAFT: Readonly<Record<string, UpdateAnnouncementText>> = {
  "1.16.09": {
    title: "Ledger data isolation fixes",
    summary:
      "Fixes other ledgers’ entries appearing after creating or switching ledgers, and keeps local caches and syncs assigned to the correct ledger during a switch.",
    sections: [
      {
        heading: "Bug fixes",
        items: [
          "Fixed entries and statistics showing locally stored records from another ledger after creating or switching ledgers. The account and ledger are now identified before their data is loaded.",
          "Fixed unfinished syncs and downloads using the wrong ledger during a switch. Requests and local saves remain bound to the original ledger.",
          "Old caches with unknown ownership are no longer copied into new ledgers. Local copies known to belong to another ledger are kept separately; unsynced originals are not automatically deleted.",
        ],
      },
      {
        heading: "Notes",
        items: [
          "If an older version left local data with unknown ownership, keep the data on the original device for investigation. Clearing local data could lose entries that have not synced yet.",
          "This fix does not automatically delete or rewrite historical entries on the server.",
        ],
      },
    ],
  },
};
